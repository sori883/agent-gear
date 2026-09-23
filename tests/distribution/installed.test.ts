import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { distribution } from "../../scripts/build.ts";

const temporary: string[] = [];
afterEach(async () => { for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true }); });
async function run(cli: string, args: string[], cwd: string) {
  const child = Bun.spawn([process.execPath, "--no-install", cli, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, out, err };
}

for (const product of ["codex", "claude-code"]) test(`${product} installs outside the repository, preserves user content, and runs all three CLIs`, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "gear-install-"))); temporary.push(root);
  const plugin = join(root, "plugin"), project = join(root, "consumer"); await mkdir(project);
  const prefix = `dist/${product}/agent-gear/`;
  for (const [path, body] of await distribution(resolve(import.meta.dir, "../.."))) {
    if (!path.startsWith(prefix)) continue;
    const target = join(plugin, path.slice(prefix.length)); await mkdir(dirname(target), { recursive: true }); await writeFile(target, body);
  }
  const instruction = product === "codex" ? "AGENTS.md" : "CLAUDE.md";
  await writeFile(join(project, instruction), "# Existing project\n\nKeep these user instructions.\n");
  await writeFile(join(project, "package.json"), '{"name":"consumer","private":true}\n');
  const setup = join(plugin, "skills/setup/scripts/setup.ts");
  const plan = await run(setup, ["plan", "--project", project, "--json"], project);
  expect(plan.code).toBe(0); expect(await Bun.file(join(project, ".space/babel/vendor/agent-gear/index.md")).exists()).toBe(false);
  const apply = await run(setup, ["apply", "--project", project, "--json"], project); expect(apply.code).toBe(0);
  const instructions = await readFile(join(project, instruction), "utf8");
  expect(instructions).toContain("Keep these user instructions."); expect(instructions).toContain(join(plugin, "skills")); expect(instructions).not.toContain("{{");
  expect((await run(setup, ["apply", "--project", project, "--json"], project)).code).toBe(0);
  expect(await readFile(join(project, instruction), "utf8")).toBe(instructions);
  const okf = join(plugin, "skills/okf-agent-memory/scripts/okf.ts"), vendor = join(project, ".space/babel/vendor/agent-gear");
  const principles = await run(okf, ["search", "--type", "principle", "--all", vendor, "--json"], project);
  expect(principles.code).toBe(0); expect(JSON.parse(principles.out)).toHaveLength(23);
  const validation = await run(okf, ["validate", vendor, "--drift", "--json"], project);
  expect(validation.code).toBe(0);
  expect(JSON.parse(validation.out)).toMatchObject({ concept_count: 23, errors: [], warnings: [], broken_links: [], is_conformant: true });
  // The curated principles have no concept-to-concept links; strict mode reports that existing limitation.
  const strict = await run(okf, ["validate", vendor, "--strict", "--drift", "--json"], project);
  expect(strict.code).toBe(1); expect(JSON.parse(strict.out).orphans).toHaveLength(23);
  const personal = join(project, ".space/babel");
  expect((await run(okf, ["init", personal, "--json"], project)).code).toBe(0);
  expect((await run(okf, ["create", "knowledge/consumer", personal, "--type", "knowledge", "--title", "Consumer", "--desc", "Project-specific knowledge", "--json"], project)).code).toBe(0);
  expect(await Bun.file(join(vendor, "knowledge/consumer.md")).exists()).toBe(false);
  const ownPrinciples = await run(okf, ["search", "--type", "principle", "--all", personal, "--json"], project);
  expect(JSON.parse(ownPrinciples.out)).toEqual([]);
  const orch = join(plugin, "skills/orch/scripts/task.ts"), store = join(project, ".space/tasks/.orch");
  expect((await run(orch, ["init", "--store", store, "--project", project, "--actor", "parent", "--session", "one", "--operation-id", "init", "--json"], project)).code).toBe(0);
  const status = await run(orch, ["status", "--store", store, "--json"], project); expect(status.code).toBe(0); expect(JSON.parse(status.out).data.units).toEqual([]);
  expect(await readFile(join(project, "package.json"), "utf8")).toBe('{"name":"consumer","private":true}\n');
  expect(await Bun.file(join(project, "bun.lock")).exists()).toBe(false);
  const edited = join(vendor, "principles/minimize-reader-load.md"); const modified = (await readFile(edited, "utf8")) + "\nLocal addition.\n"; await writeFile(edited, modified);
  expect((await run(setup, ["apply", "--project", project, "--json"], project)).code).not.toBe(0);
  expect(await readFile(edited, "utf8")).toBe(modified);
  expect(await readFile(join(project, instruction), "utf8")).toBe(instructions);
}, 20000);
