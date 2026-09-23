import { afterEach, expect, test } from "bun:test";
import { cp, mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { watch } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSetup } from "../scripts/lib/setup.ts";

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "setup-test-")); roots.push(root);
  const pluginRoot = join(root, "plugin"), project = join(root, "consumer");
  await mkdir(join(pluginRoot, "templates"), { recursive: true }); await mkdir(project);
  const files = [
    { source: "templates/rule.md", destination: ".space/babel/vendor/agent-gear/rules/rule.md", mode: "copy" },
    { source: "templates/instructions.md", destination: "AGENTS.md", mode: "managed-block" }
  ];
  const manifest = { schemaVersion: 1, plugin: "agent-gear", product: "codex", version: "1.0.0", files };
  await writeFile(join(pluginRoot, "setup-manifest.json"), JSON.stringify(manifest));
  await writeFile(join(pluginRoot, "templates/rule.md"), "version one\n");
  await writeFile(join(pluginRoot, "templates/instructions.md"), "Use {{SKILL_ROOT}} and {{VENDOR_BUNDLE}}.\n");
  const run = (command: "plan" | "apply" | "status") => runSetup({ command, project, pluginRoot });
  return { root, project, pluginRoot, manifest, run, copy: join(project, files[0]!.destination) };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

test("plan is read-only; apply creates files once and preserves existing instructions", async () => {
  const f = await fixture(); await writeFile(join(f.project, "AGENTS.md"), "User instructions\n");
  const plan = await f.run("plan"); expect(plan.conflicts).toEqual([]);
  expect(await Bun.file(f.copy).exists()).toBe(false);
  await f.run("apply");
  const first = await readFile(join(f.project, "AGENTS.md"), "utf8");
  expect(first).toStartWith("User instructions\n"); expect(first).toContain(join(f.pluginRoot, "skills"));
  await f.run("apply"); expect(await readFile(join(f.project, "AGENTS.md"), "utf8")).toBe(first);
  expect((await f.run("status")).actions.every((a: any) => a.action === "unchanged")).toBe(true);
});

test("updates managed source and preserves edits outside its instruction block", async () => {
  const f = await fixture(); await f.run("apply");
  await writeFile(join(f.project, "AGENTS.md"), "BEFORE\n" + await readFile(join(f.project, "AGENTS.md"), "utf8") + "AFTER\n");
  await writeFile(join(f.pluginRoot, "templates/rule.md"), "version two\n");
  await writeFile(join(f.pluginRoot, "templates/instructions.md"), "New instructions\n");
  await f.run("apply"); expect(await readFile(f.copy, "utf8")).toBe("version two\n");
  const result = await readFile(join(f.project, "AGENTS.md"), "utf8");
  expect(result).toStartWith("BEFORE\n"); expect(result).toEndWith("AFTER\n"); expect(result).toContain("New instructions");
});

test("local conflict prevents every destination write", async () => {
  const f = await fixture(); await f.run("apply");
  const instructions = await readFile(join(f.project, "AGENTS.md"), "utf8");
  await writeFile(f.copy, "local edit\n"); await writeFile(join(f.pluginRoot, "templates/instructions.md"), "NEW\n");
  expect((await f.run("plan")).conflicts).toHaveLength(1);
  await expect(f.run("apply")).rejects.toThrow("conflict");
  expect(await readFile(join(f.project, "AGENTS.md"), "utf8")).toBe(instructions);
  expect(await readFile(f.copy, "utf8")).toBe("local edit\n");
});

test("refuses source and destination traversal and symlinks", async () => {
  const f = await fixture();
  f.manifest.files[0]!.source = "../outside.md";
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(f.manifest));
  await expect(f.run("plan")).rejects.toThrow();
  f.manifest.files[0]!.source = "templates/rule.md";
  f.manifest.files[0]!.destination = ".space/babel/vendor/agent-gear/../other/rule.md";
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(f.manifest));
  await expect(f.run("apply")).rejects.toThrow();
  f.manifest.files[0]!.destination = ".space/babel/vendor/agent-gear/rules/rule.md";
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(f.manifest));
  await symlink(join(f.pluginRoot, "templates"), join(f.project, ".space"));
  await expect(f.run("apply")).rejects.toThrow("symlink");
});

test("removed sources are retained in destination", async () => {
  const f = await fixture(); await f.run("apply"); f.manifest.files.shift();
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(f.manifest));
  const result = await f.run("apply"); expect(result.actions.some((a: any) => a.action === "retain")).toBe(true);
  expect(await readFile(f.copy, "utf8")).toBe("version one\n");
});

test("refuses source symlinks, leaf destination symlinks, and unknown destinations", async () => {
  const f = await fixture();
  await rm(join(f.pluginRoot, "templates/rule.md")); await symlink(join(f.pluginRoot, "templates/instructions.md"), join(f.pluginRoot, "templates/rule.md"));
  await expect(f.run("plan")).rejects.toThrow("symlink");
  await rm(join(f.pluginRoot, "templates/rule.md")); await writeFile(join(f.pluginRoot, "templates/rule.md"), "ok");
  await symlink(join(f.pluginRoot, "templates/instructions.md"), join(f.project, "AGENTS.md"));
  await expect(f.run("plan")).rejects.toThrow("symlink");
  await rm(join(f.project, "AGENTS.md")); f.manifest.files[0]!.destination = "src/app.ts";
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(f.manifest));
  await expect(f.run("plan")).rejects.toThrow("outside allowed");
});

test("an edited or duplicated managed block is a conflict; unrelated existing files survive", async () => {
  const f = await fixture(); await f.run("apply");
  const path = join(f.project, "AGENTS.md"), original = await readFile(path, "utf8");
  await writeFile(path, original.replace("Use ", "My local edit "));
  expect((await f.run("plan")).conflicts).toHaveLength(1);
  await writeFile(path, original + original);
  expect((await f.run("plan")).conflicts).toHaveLength(1);
  await writeFile(path, original); await writeFile(join(f.project, "untouched.md"), "user-owned");
  await f.run("apply"); expect(await readFile(join(f.project, "untouched.md"), "utf8")).toBe("user-owned");
});

test("existing unmanaged file conflicts before any metadata or destination is written", async () => {
  const f = await fixture(); await mkdir(join(f.project, ".space/babel/vendor/agent-gear/rules"), { recursive: true });
  await writeFile(f.copy, "user-owned"); await expect(f.run("apply")).rejects.toThrow("conflict");
  expect(await Bun.file(join(f.project, "AGENTS.md")).exists()).toBe(false);
  expect(await Bun.file(join(f.project, ".space/setup/agent-gear-codex.json")).exists()).toBe(false);
  expect(await readFile(f.copy, "utf8")).toBe("user-owned");
});

test("locked apply preserves lock; broken state is not replaced", async () => {
  const f = await fixture(); await mkdir(join(f.project, ".space/setup"), { recursive: true });
  const lock = join(f.project, ".space/setup/agent-gear.lock"); await writeFile(lock, "external lock");
  expect((await f.run("status")).locked).toBe(true); await expect(f.run("apply")).rejects.toThrow("locked");
  expect(await readFile(lock, "utf8")).toBe("external lock"); await rm(lock);
  const state = join(f.project, ".space/setup/agent-gear-codex.json"); await writeFile(state, "not JSON");
  await expect(f.run("apply")).rejects.toThrow(); expect(await readFile(state, "utf8")).toBe("not JSON");
});

test("overlapping and case-equivalent destinations fail before writing", async () => {
  const f = await fixture();
  f.manifest.files.push({ ...f.manifest.files[0]!, destination: f.manifest.files[0]!.destination + "/child.md" });
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(f.manifest));
  await expect(f.run("apply")).rejects.toThrow("overlapping");
  f.manifest.files[2]!.destination = f.manifest.files[0]!.destination.replace("rule.md", "RULE.md");
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(f.manifest));
  await expect(f.run("plan")).rejects.toThrow("Duplicate");
  expect(await Bun.file(f.copy).exists()).toBe(false);
});

test("Claude configuration writes CLAUDE.md and refuses Codex agents", async () => {
  const f = await fixture(), manifest = { ...f.manifest, product: "claude-code", files: f.manifest.files.map(e => ({ ...e, destination: e.destination === "AGENTS.md" ? "CLAUDE.md" : e.destination })) };
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(manifest));
  await writeFile(join(f.project, "CLAUDE.md"), "local Claude instructions\n");
  await f.run("apply"); expect(await readFile(join(f.project, "CLAUDE.md"), "utf8")).toStartWith("local Claude instructions\n");
  expect(await Bun.file(join(f.project, "AGENTS.md")).exists()).toBe(false);
  manifest.files.push({ source: "templates/rule.md", destination: ".codex/agents/test.toml", mode: "copy" });
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(manifest));
  await expect(f.run("plan")).rejects.toThrow("outside allowed");
});

test("Codex agent definition preserves user files and updates only managed content", async () => {
  const f = await fixture();
  f.manifest.files.push({ source: "templates/rule.md", destination: ".codex/agents/helper.toml", mode: "copy" });
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(f.manifest));
  await mkdir(join(f.project, ".codex/agents"), { recursive: true }); await writeFile(join(f.project, ".codex/agents/custom.toml"), "custom");
  await f.run("apply"); expect(await readFile(join(f.project, ".codex/agents/helper.toml"), "utf8")).toBe("version one\n");
  expect(await readFile(join(f.project, ".codex/agents/custom.toml"), "utf8")).toBe("custom");
});

test("both products converge on identical vendor updates while protecting different local edits", async () => {
  const f = await fixture(), claudeRoot = join(f.root, "claude");
  await cp(f.pluginRoot, claudeRoot, { recursive: true });
  const claudeManifest = { ...f.manifest, product: "claude-code", files: f.manifest.files.map(e => ({ ...e, destination: e.destination === "AGENTS.md" ? "CLAUDE.md" : e.destination })) };
  await writeFile(join(claudeRoot, "setup-manifest.json"), JSON.stringify(claudeManifest));
  const runClaude = (command: "apply" | "status") => runSetup({ command, project: f.project, pluginRoot: claudeRoot });
  await f.run("apply"); await runClaude("apply");
  f.manifest.version = "2.0.0"; claudeManifest.version = "2.0.0";
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(f.manifest));
  await writeFile(join(claudeRoot, "setup-manifest.json"), JSON.stringify(claudeManifest));
  await writeFile(join(f.pluginRoot, "templates/rule.md"), "version two\n");
  await writeFile(join(claudeRoot, "templates/rule.md"), "version two\n");
  await f.run("apply");
  const result = await runClaude("apply"); expect(result.conflicts).toEqual([]);
  expect(result.actions.find(a => a.destination === f.manifest.files[0]!.destination)?.action).toBe("unchanged");
  for (const product of ["codex", "claude-code"]) expect(JSON.parse(await readFile(join(f.project, `.space/setup/agent-gear-${product}.json`), "utf8")).version).toBe("2.0.0");
  expect((await f.run("status")).conflicts).toEqual([]); expect((await runClaude("status")).conflicts).toEqual([]);
  await writeFile(f.copy, "local content differs from both versions\n");
  await expect(f.run("apply")).rejects.toThrow("conflict"); await expect(runClaude("apply")).rejects.toThrow("conflict");
  expect(await readFile(f.copy, "utf8")).toBe("local content differs from both versions\n");
});

async function copyCLI(f: Awaited<ReturnType<typeof fixture>>) {
  const scripts = join(f.pluginRoot, "skills/setup/scripts");
  await cp(join(import.meta.dir, "../scripts"), scripts, { recursive: true, filter: path => !path.split("/").includes("node_modules") });
  return join(scripts, "setup.ts");
}
async function cli(entry: string, args: string[], cwd: string) {
  const process = Bun.spawn([Bun.which("bun")!, entry, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
  return { code, out, err, data: JSON.parse(out) };
}

test("copied real CLI uses its own manifest/runtime and requires explicit project", async () => {
  const f = await fixture(), entry = await copyCLI(f);
  await writeFile(join(f.project, "package.json"), '{"name":"consumer"}\n');
  const missing = await cli(entry, ["plan", "--json"], f.project); expect(missing.code).toBe(2); expect(missing.data.error.code).toBe("INPUT");
  const plan = await cli(entry, ["plan", "--project", f.project, "--json"], f.root); expect(plan.code).toBe(0); expect(plan.data.data.actions).toHaveLength(2);
  expect(await Bun.file(join(f.project, ".space/setup/agent-gear-codex.json")).exists()).toBe(false);
  const applied = await cli(entry, ["apply", "--project", f.project, "--json"], f.root); expect(applied.code).toBe(0);
  expect(await readFile(join(f.project, "package.json"), "utf8")).toBe('{"name":"consumer"}\n');
  expect(await Bun.file(join(f.pluginRoot, "skills/setup/scripts/node_modules/.setup-bootstrap.json")).exists()).toBe(true);
  const unknown = await cli(entry, ["plan", "--project", f.project, "--force", "--json"], f.root); expect(unknown.code).toBe(2);
});

test("actual killed CLI leaves recoverable pending writes and does not replace unrelated edits", async () => {
  const f = await fixture(), entry = await copyCLI(f); await f.run("apply");
  await cli(entry, ["status", "--project", f.project, "--json"], f.root);
  const folder = join(f.project, ".space/babel/vendor/agent-gear/rules");
  for (let i = 0; i < 40; i++) {
    const source = `templates/extra-${i}.md`, destination = `.space/babel/vendor/agent-gear/rules/extra-${i}.md`;
    f.manifest.files.push({ source, destination, mode: "copy" }); await writeFile(join(f.pluginRoot, source), `content-${i}\n`.repeat(1000));
  }
  await writeFile(join(f.pluginRoot, "setup-manifest.json"), JSON.stringify(f.manifest));
  let killed = false;
  const process = Bun.spawn([Bun.which("bun")!, entry, "apply", "--project", f.project, "--json"], { stdout: "pipe", stderr: "pipe" });
  const observer = watch(folder, (_event, name) => { if (name === "extra-0.md") { killed = true; process.kill("SIGKILL"); } });
  try { await process.exited; } finally { observer.close(); }
  expect(killed).toBe(true);
  const pendingPath = join(f.project, ".space/setup/agent-gear-codex.pending.json"); expect(await Bun.file(pendingPath).exists()).toBe(true);
  expect((await f.run("status")).pending).toBe(true);
  // Only after the writer is confirmed stopped may its abandoned lock be removed.
  await rm(join(f.project, ".space/setup/agent-gear.lock"));
  const first = join(folder, "extra-0.md"), original = await readFile(first); await writeFile(first, "local edit after interruption");
  await expect(f.run("apply")).rejects.toThrow("conflict"); expect(await readFile(first, "utf8")).toBe("local edit after interruption");
  await writeFile(first, original); await f.run("apply");
  expect(await Bun.file(pendingPath).exists()).toBe(false); expect((await f.run("status")).conflicts).toEqual([]);
  expect(await readFile(join(folder, "extra-39.md"), "utf8")).toBe("content-39\n".repeat(1000));
}, 10000);
