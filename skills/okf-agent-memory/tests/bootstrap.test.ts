import { afterEach, beforeEach, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let project: string, scripts: string, cli: string;
beforeEach(async () => {
  project = await realpath(await mkdtemp(join(tmpdir(), "okf-bootstrap-")));
  scripts = join(project, "installed/okf/scripts"); cli = join(scripts, "okf.ts");
  await cp(resolve(import.meta.dir, "../scripts"), scripts, { recursive: true, filter: path => !path.includes("node_modules") });
});
afterEach(async () => { await rm(project, { recursive: true, force: true }); });
async function run(args: string[]) {
  const child = Bun.spawn([process.execPath, "--no-install", cli, ...args, "--json"], { cwd: project, stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, stdout, stderr };
}
const marker = () => join(scripts, "node_modules/.okf-bootstrap.json");

test("a fresh copied CLI installs its own locked dependency, preserves caller files and reuses it", async () => {
  const consumer = '{"name":"consumer","private":true}\n';
  await writeFile(join(project, "package.json"), consumer);
  const initialized = await run(["init"]);
  expect(initialized.code).toBe(0); expect(initialized.stderr).toBe("");
  expect(JSON.parse(initialized.stdout)).toMatchObject({ status: "success", bundle_path: join(project, ".space/babel") });
  expect(await Bun.file(join(scripts, "node_modules/minisearch/package.json")).exists()).toBe(true);
  const first = (await stat(marker())).mtimeMs;
  expect((await run(["create", "knowledge/bootstrap", "--type", "knowledge", "--title", "認証", "--desc", "独立配置での検索確認。"])).code).toBe(0);
  const search = await run(["search", "認証"]);
  expect(search.code).toBe(0); expect(JSON.parse(search.stdout)[0].concept_id).toBe("knowledge/bootstrap");
  expect((await stat(marker())).mtimeMs).toBe(first);
  expect(await readFile(join(project, "package.json"), "utf8")).toBe(consumer);
  expect(await Bun.file(join(project, "bun.lock")).exists()).toBe(false);
  expect(await stat(join(project, "node_modules")).then(() => true, () => false)).toBe(false);
});

test("a changed lockfile causes installation again before the real search CLI runs", async () => {
  expect((await run(["version"])).code).toBe(0);
  const original = await readFile(marker(), "utf8");
  const lockPath = join(scripts, "bun.lock");
  await writeFile(lockPath, await readFile(lockPath, "utf8") + "\n");
  await rm(join(scripts, "node_modules/minisearch"), { recursive: true, force: true });
  expect((await run(["version"])).code).toBe(0);
  expect(await readFile(marker(), "utf8")).not.toBe(original);
  expect(await Bun.file(join(scripts, "node_modules/minisearch/package.json")).exists()).toBe(true);
});

test("missing or incompatible lockfiles report a JSON error without initializing caller data", async () => {
  const lockPath = join(scripts, "bun.lock");
  await rm(lockPath, { force: true });
  const missing = await run(["init"]);
  expect(missing.code).toBe(1);
  expect(JSON.parse(missing.stdout)).toMatchObject({ status: "error", error: expect.stringContaining("bun.lock") });
  expect(await Bun.file(join(project, ".space/babel/index.md")).exists()).toBe(false);
  await writeFile(lockPath, "not a lockfile\n");
  const broken = await run(["init"]);
  expect(broken.code).toBe(1); expect(JSON.parse(broken.stdout).status).toBe("error");
  expect(await Bun.file(marker()).exists()).toBe(false);
  expect(await Bun.file(join(project, ".space/babel/index.md")).exists()).toBe(false);
});

test("simultaneous first invocations share installation safely", async () => {
  const results = await Promise.all([run(["version"]), run(["version"])]);
  for (const result of results) {
    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(result.stdout)).toMatchObject({ version: "0.1.0" });
  }
  expect(await Bun.file(marker()).exists()).toBe(true);
  expect(await Bun.file(join(scripts, "node_modules/.okf-bootstrap.lock")).exists()).toBe(false);
});

test("a stale bootstrap lock is reported without being stolen", async () => {
  await mkdir(join(scripts, "node_modules"), { recursive: true });
  const locked = join(scripts, "node_modules/.okf-bootstrap.lock");
  await writeFile(locked, '{"pid":999999,"at":"2000-01-01T00:00:00Z"}\n');
  const result = await run(["init"]);
  expect(result.code).toBe(1); expect(JSON.parse(result.stdout).error).toContain("locked");
  expect(await Bun.file(locked).exists()).toBe(true);
  expect(await Bun.file(join(project, ".space/babel/index.md")).exists()).toBe(false);
}, 10000);

test("missing installed dependencies are repaired without running package lifecycle scripts", async () => {
  const packagePath = join(scripts, "package.json");
  const manifest = JSON.parse(await readFile(packagePath, "utf8"));
  manifest.scripts = { preinstall: "touch hook-ran", postinstall: "touch hook-ran" };
  await writeFile(packagePath, JSON.stringify(manifest));
  expect((await run(["version"])).code).toBe(0);
  expect(await Bun.file(join(scripts, "hook-ran")).exists()).toBe(false);
  await rm(join(scripts, "node_modules/minisearch"), { recursive: true, force: true });
  expect((await run(["version"])).code).toBe(0);
  expect(await Bun.file(join(scripts, "node_modules/minisearch/package.json")).exists()).toBe(true);
  expect(await Bun.file(join(scripts, "hook-ran")).exists()).toBe(false);
});

test("a manifest dependency change without its matching lock fails before running commands", async () => {
  const packagePath = join(scripts, "package.json");
  const manifest = JSON.parse(await readFile(packagePath, "utf8"));
  manifest.dependencies.minisearch = "7.1.2";
  await writeFile(packagePath, JSON.stringify(manifest));
  const result = await run(["init"]);
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: "error", error: expect.stringContaining("frozen") });
  expect(await Bun.file(marker()).exists()).toBe(false);
  expect(await Bun.file(join(project, ".space/babel/index.md")).exists()).toBe(false);
});

test("workspace membership is rejected before Bun can write consumer dependency directories", async () => {
  const consumer = '{"name":"consumer","private":true,"workspaces":["installed/*/scripts"]}\n';
  await writeFile(join(project, "package.json"), consumer);
  const result = await run(["init"]);
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: "error", error: expect.stringContaining("ancestor workspace") });
  expect(await readFile(join(project, "package.json"), "utf8")).toBe(consumer);
  expect(await stat(join(project, "node_modules")).then(() => true, () => false)).toBe(false);
  expect(await Bun.file(join(project, "bun.lock")).exists()).toBe(false);
  expect(await Bun.file(join(project, ".space/babel/index.md")).exists()).toBe(false);
});
