import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { build, checkBuild } from "../../scripts/build.ts";

let root: string;
async function put(path: string, body: string) { await mkdir(join(root, path, ".."), { recursive: true }); await writeFile(join(root, path), body); }
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "gear-build-"));
  await put("package.json", JSON.stringify({ version: "1.2.3" }));
  for (const product of ["codex", "claude-code"]) {
    await put(`packaging/${product}/plugin.json`, JSON.stringify({ name: "agent-gear", description: "Development tools", author: { name: "author" } }));
    await put(`packaging/${product}/marketplace.json`, JSON.stringify({ name: "agent-gear", plugins: [] }));
    await put(`packaging/${product}/templates/${product === "codex" ? "AGENTS.md" : "CLAUDE.md"}`, "Use {{SKILL_ROOT}}\n");
  }
  await put("skills/example/SKILL.md", "---\nname: example\ndescription: Example\n---\n\nSee [guide](references/guide.md).\n");
  await put("skills/example/references/guide.md", "# Guide\n");
  await put("skills/example/scripts/main.ts", "export {};\n");
  await put("skills/example/scripts/package.json", '{"dependencies":{}}\n');
  await put("skills/example/tests/private.test.ts", "Do not distribute\n");
  await put("skills/example/scripts/node_modules/private/index.js", "Do not distribute\n");
  await put("docs/private.md", "Maintainer notes\n");
  await put(".space/babel/private.md", "Project knowledge\n");
  await put("space/babel/index.md", "# Shared knowledge\n");
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test("builds both self-contained products and creates catalogs with the root version", async () => {
  await build(root);
  for (const product of ["codex", "claude-code"]) {
    const dist = join(root, "dist", product, "agent-gear");
    const manifest = JSON.parse(await readFile(join(dist, product === "codex" ? ".codex-plugin/plugin.json" : ".claude-plugin/plugin.json"), "utf8"));
    expect(manifest.version).toBe("1.2.3");
    expect(await Bun.file(join(dist, "skills/example/scripts/main.ts")).exists()).toBe(true);
    for (const path of ["docs/private.md", ".space/babel/private.md", "skills/example/tests/private.test.ts", "skills/example/scripts/node_modules/private/index.js"]) expect(await Bun.file(join(dist, path)).exists()).toBe(false);
    const setup = JSON.parse(await readFile(join(dist, "setup-manifest.json"), "utf8"));
    expect(setup.files).toContainEqual({ source: "space/babel/index.md", destination: ".space/babel/vendor/agent-gear/index.md", mode: "copy" });
    expect(setup.product).toBe(product);
  }
  const codex = JSON.parse(await readFile(join(root, ".agents/plugins/marketplace.json"), "utf8"));
  expect(codex.plugins[0].source.path).toBe("./dist/codex/agent-gear");
  const claude = JSON.parse(await readFile(join(root, ".claude-plugin/marketplace.json"), "utf8"));
  expect(claude.plugins[0].source).toBe("./dist/claude-code/agent-gear");
  expect(await checkBuild(root)).toEqual([]);
});

test("check detects extra untracked files, changed content, and missing generated files", async () => {
  await build(root);
  await put("dist/codex/agent-gear/untracked.txt", "extra\n");
  await put("dist/claude-code/agent-gear/skills/example/SKILL.md", "edited\n");
  await rm(join(root, "dist/codex/agent-gear/skills/example/references/guide.md"));
  expect(await checkBuild(root)).toEqual(expect.arrayContaining([
    "extra: dist/codex/agent-gear/untracked.txt",
    "changed: dist/claude-code/agent-gear/skills/example/SKILL.md",
    "missing: dist/codex/agent-gear/skills/example/references/guide.md",
  ]));
  await build(root); expect(await checkBuild(root)).toEqual([]);
});

test("rejects missing links and symlinked inputs before replacing an existing build", async () => {
  await build(root);
  const path = join(root, "dist/codex/agent-gear/skills/example/SKILL.md"); const before = await readFile(path, "utf8");
  await put("skills/example/SKILL.md", "[missing](references/no.md)\n");
  await expect(build(root)).rejects.toThrow("link");
  expect(await readFile(path, "utf8")).toBe(before);
  await put("skills/example/SKILL.md", "# Example\n");
  await symlink(join(root, "docs/private.md"), join(root, "skills/example/references/leak.md"));
  await expect(build(root)).rejects.toThrow("Symlink");
  expect(await readFile(path, "utf8")).toBe(before);
});
