import { beforeEach, afterEach, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

let project: string;
const source = resolve(import.meta.dir, "../scripts");
beforeEach(async () => { project = await mkdtemp(join(tmpdir(), "orch-cli-")); });
afterEach(async () => { await rm(project, { recursive: true, force: true }); });
async function run(args: string[], cli = join(source, "task.ts"), stdin?: string) {
  const child = Bun.spawn([process.execPath, "--no-install", cli, ...args], { cwd: project, stdin: stdin === undefined ? "ignore" : new Blob([stdin]), stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, stdout, stderr };
}
test("copied CLI initializes in the calling project and does not alter its package files", async () => {
  const copied = join(project, "installed-skill/scripts");
  await cp(source, copied, { recursive: true, filter: path => !path.includes("node_modules") });
  await writeFile(join(project, "package.json"), '{"name":"consumer","private":true}\n');
  const cli = join(copied, "task.ts"); const store = join(project, ".space/tasks/.orch");
  const flags = ["--store", store, "--actor", "parent", "--session", "s1", "--json"];
  const init = await run([...flags, "--operation-id", "init", "init", "--project", project], cli);
  expect(init.code).toBe(0); expect(init.stderr).toBe(""); expect(JSON.parse(init.stdout).data.project).toBe(project);
  const marker = join(copied, "node_modules/.orch-bootstrap.json"); const firstTime = (await stat(marker)).mtimeMs;
  expect((await run([...flags, "status"], cli)).code).toBe(0); expect((await stat(marker)).mtimeMs).toBe(firstTime);
  expect(await readFile(join(project, "package.json"), "utf8")).toBe('{"name":"consumer","private":true}\n');
  expect(await Bun.file(join(project, "bun.lock")).exists()).toBe(false);
  expect(await Bun.file(join(copied, "state.json")).exists()).toBe(false);
});

test("JSON stdin preserves shell characters; invalid flags and missing stores return structured errors", async () => {
  const store = join(project, "store"); const flags = ["--store", store, "--actor", "parent", "--session", "s1", "--json"];
  expect((await run([...flags, "init", "--project", project, "--operation-id", "init"])).code).toBe(0);
  const purpose = "Explain `code`, $(literal), $HOME and 日本語";
  const payload = { size: "small", purpose, owner: { actor: "parent", session: "s1" }, scope: ["docs"], conditions: [{ id: "report", description: "Report", purpose: "delivery", required: true, target: "report" }], stages: { review: { selection: "execute", reason: "Review only" } } };
  const added = await run([...flags, "unit", "add", "review", "--operation-id", "add", "--input", "-"], undefined, JSON.stringify(payload));
  expect(added.code).toBe(0); expect(JSON.parse(added.stdout).data.purpose).toBe(purpose);
  const bad = await run([...flags, "status", "--force"]); expect(bad.code).toBe(2); expect(JSON.parse(bad.stdout).error.code).toBe("INVALID_INPUT");
  expect((await run(["--json", "--store", join(project, "missing"), "status"])).code).toBe(2);
});

test("bootstrap observes manifest changes and rejects missing locks when dependencies are added", async () => {
  const copied = join(project, "skill/scripts"); await cp(source, copied, { recursive: true, filter: path => !path.includes("node_modules") });
  const cli = join(copied, "task.ts"); expect((await run(["--help"], cli)).code).toBe(0);
  const packagePath = join(copied, "package.json"); const manifest = JSON.parse(await readFile(packagePath, "utf8")); manifest.description = "Reconfigured"; await writeFile(packagePath, JSON.stringify(manifest));
  const marker = join(copied, "node_modules/.orch-bootstrap.json"); const before = await readFile(marker, "utf8");
  expect((await run(["--help"], cli)).code).toBe(0); expect(await readFile(marker, "utf8")).not.toBe(before);
  manifest.dependencies = { "missing-runtime-fixture": "1.0.0" }; await writeFile(packagePath, JSON.stringify(manifest));
  const failure = await run(["--help", "--json"], cli); expect(failure.code).toBe(1); expect(JSON.parse(failure.stdout).error.code).toBe("BOOTSTRAP_FAILED");
});

test("copied bootstrap installs locked local dependencies and notices a changed lockfile", async () => {
  const copied = join(project, "skill/scripts"); await cp(source, copied, { recursive: true, filter: path => !path.includes("node_modules") });
  const fixture = join(copied, "fixtures/probe"); await mkdir(fixture, { recursive: true });
  await writeFile(join(fixture, "package.json"), JSON.stringify({ name: "orch-test-probe", version: "1.0.0", main: "index.js" }));
  await writeFile(join(fixture, "index.js"), "export default 42;\n");
  const manifestPath = join(copied, "package.json"); const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.dependencies = { "orch-test-probe": "file:fixtures/probe" }; await writeFile(manifestPath, JSON.stringify(manifest));
  const install = Bun.spawn([process.execPath, "install", "--ignore-scripts"], { cwd: copied, stdout: "pipe", stderr: "pipe" });
  expect(await install.exited).toBe(0);
  const lockPath = join(copied, "bun.lock"); const lockText = await readFile(lockPath, "utf8");
  await rm(join(copied, "node_modules"), { recursive: true, force: true });
  const cli = join(copied, "task.ts"); expect((await run(["--help"], cli)).code).toBe(0);
  const marker = join(copied, "node_modules/.orch-bootstrap.json"); const oldMarker = await readFile(marker, "utf8");
  expect(await Bun.file(join(copied, "node_modules/orch-test-probe/package.json")).exists()).toBe(true);
  await writeFile(lockPath, lockText + "\n");
  await rm(join(copied, "node_modules/orch-test-probe"), { recursive: true, force: true });
  expect((await run(["--help"], cli)).code).toBe(0);
  expect(await readFile(marker, "utf8")).not.toBe(oldMarker);
  expect(await Bun.file(join(copied, "node_modules/orch-test-probe/package.json")).exists()).toBe(true);
  expect(await Bun.file(join(project, "bun.lock")).exists()).toBe(false);
});

test("simultaneous first boots restart before importing freshly installed dependencies", async () => {
  const copied = join(project, "concurrent/scripts"); await cp(source, copied, { recursive: true, filter: path => !path.includes("node_modules") });
  const fixture = join(copied, "fixtures/probe"); await mkdir(fixture, { recursive: true });
  await writeFile(join(fixture, "package.json"), JSON.stringify({ name: "orch-test-probe", version: "1.0.0", main: "index.js" }));
  await writeFile(join(fixture, "index.js"), "export default 42;\n");
  const packagePath = join(copied, "package.json"); const manifest = JSON.parse(await readFile(packagePath, "utf8"));
  manifest.dependencies = { "orch-test-probe": "file:fixtures/probe" }; await writeFile(packagePath, JSON.stringify(manifest));
  const install = Bun.spawn([process.execPath, "install", "--ignore-scripts"], { cwd: copied, stdout: "pipe", stderr: "pipe" });
  expect(await install.exited).toBe(0);
  await writeFile(join(copied, "lib/cli.ts"), 'import probe from "orch-test-probe";\nexport async function main() { console.log(probe); return 0; }\n');
  await rm(join(copied, "node_modules"), { recursive: true, force: true });
  const results = await Promise.all(Array.from({ length: 4 }, () => run([], join(copied, "task.ts"))));
  for (const result of results) { expect(result).toEqual({ code: 0, stdout: "42\n", stderr: "" }); }
});
