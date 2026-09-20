import { afterEach, beforeEach, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const cli = resolve(import.meta.dir, "../scripts/okf.ts");
let project: string;
beforeEach(async () => { project = await mkdtemp(join(tmpdir(), "okf-cli-")); });
afterEach(async () => { await rm(project, { recursive: true, force: true }); });
async function run(args: string[], executable = cli) {
  const p = Bun.spawn([process.execPath, "--no-install", executable, ...args], { cwd: project, stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code, stdout, stderr };
}
async function success(args: string[]) {
  const result = await run([...args, "--json"]);
  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);
  return JSON.parse(result.stdout);
}
const create = (id: string, type = "knowledge") => success(["create", id, "--type", type, "--title", "Auth", "--desc", "Explains auth.", "--actor", "agent:codex"]);

test("CLI previews and deletes a concept with relations, indexes and a deletion log", async () => {
  const bundle = join(project, "custom bundle");
  await success(["init", bundle]);
  for (const id of ["knowledge/source", "knowledge/target"]) {
    await success(["create", id, bundle, "--type", "knowledge", "--title", "Example", "--desc", "Example concept."]);
  }
  await success(["relate", "knowledge/source", "knowledge/target", bundle, "--desc", "Reason"]);
  expect(await success(["delete", "knowledge/target", bundle, "--dry-run"])).toMatchObject({ status: "preview", concept_id: "knowledge/target", updated_concepts: ["knowledge/source"] });
  expect(await success(["show", "knowledge/target", bundle])).toMatchObject({ id: "knowledge/target" });
  expect(await success(["delete", "knowledge/target", bundle, "--actor", "human:tester"])).toMatchObject({ status: "success", concept_id: "knowledge/target" });
  expect(await success(["validate", bundle, "--strict", "--drift"])).toMatchObject({ gate_passed: true, concept_count: 1 });
  expect((await success(["search", "--type", "knowledge", bundle, "--all"])).map((r: { concept_id: string }) => r.concept_id)).toEqual(["knowledge/source"]);
  expect(await readFile(join(bundle, "log.md"), "utf8")).toContain("human:tester");
  const missing = await run(["delete", "knowledge/target", bundle, "--json"]);
  expect(missing.code).toBe(1);
  expect(JSON.parse(missing.stdout)).toMatchObject({ status: "error" });
  for (const flag of ["--no-log", "--no-index"]) expect((await run(["delete", "knowledge/source", bundle, flag])).code).toBe(1);
  expect((await run(["delete", "--help"])).stdout).toContain("--dry-run");
});

test("CLI completes default-bundle workflow with provenance, graph and strict validation", async () => {
  expect(await success(["init"])).toMatchObject({ status: "success" });
  expect(await create("knowledge/auth")).toMatchObject({ concept_id: "knowledge/auth", path: "knowledge/auth.md" });
  await success(["update", "knowledge/auth", "--body", "# Authentication\n", "--status", "draft", "--tags", "auth,security", "--actor", "agent:codex"]);
  const doc = await success(["show", "knowledge/auth.md"]);
  expect(doc).toMatchObject({ type: "knowledge", status: "draft", tags: ["auth", "security"], body: "# Authentication\n", generated: { by: "agent:codex" }, inbound: [], outbound: [] });
  expect(doc.verified).toBeUndefined();
  expect(await success(["search", "auth", "--limit", "3"])).toHaveLength(1);
  await create("procedures/test", "procedure");
  await success(["relate", "knowledge/auth", "procedures/test", "--desc", "How to test"]);
  expect((await success(["show", "knowledge/auth"])).outbound).toEqual(["procedures/test"]);
  expect(await success(["validate", "--strict", "--drift"])).toMatchObject({ errors: [], warnings: [], gate_passed: true });
  const raw = await run(["show", "knowledge/auth", "--raw"]);
  expect(raw.stdout).toBe(await readFile(join(project, ".space/babel/knowledge/auth.md"), "utf8"));
});
test("metadata files support every profile field, flag overrides, preservation and explicit removal", async () => {
  const bundle = join(project, "custom bundle");
  await success(["init", bundle]);
  const file = join(project, "metadata.json");
  await writeFile(file, JSON.stringify({ type: "rule", title: "Frozen", description: "Review before edits.", governance: "hold", code_refs: ["src/**"], resource: "src", sources: [{ resource: "https://example.com", id: "ref" }], custom: { retained: true } }));
  await success(["create", "rules/freeze", bundle, "--metadata-file", file, "--title", "Freeze"]);
  expect((await success(["search", "--for-path", "src/a.ts", bundle]))[0]).toMatchObject({ governance: "hold", title: "Freeze" });
  await success(["update", "rules/freeze", bundle, "--desc", "New summary.", "--unset", "resource"]);
  const doc = await success(["show", "rules/freeze", bundle]);
  expect(doc.sources).toEqual([{ resource: "https://example.com", id: "ref" }]);
  expect(doc.extra).toEqual({ custom: { retained: true } });
  expect(doc.resource).toBeUndefined();
  const before = await readFile(join(bundle, "rules/freeze.md"), "utf8");
  const log = await readFile(join(bundle, "log.md"), "utf8");
  await success(["update", "rules/freeze", bundle, "--desc", "New summary."]);
  expect(await readFile(join(bundle, "rules/freeze.md"), "utf8")).toBe(before);
  expect(await readFile(join(bundle, "log.md"), "utf8")).toBe(log);
  await writeFile(file, JSON.stringify({ generated: { by: "human:fake", at: "2020-01-01T00:00:00Z" } }));
  expect((await run(["update", "rules/freeze", bundle, "--metadata-file", file])).code).toBe(1);
});
test("CLI finds Japanese rules and reflects direct Markdown edits on the next search", async () => {
  await success(["init"]);
  await success(["create", "rules/auth-guard", "--type", "rule", "--title", "認証変更の保留ルール", "--desc", "架空の仕様。", "--body", "ＡＰＩキーを管理する。"]);
  const path = join(project, ".space/babel/rules/auth-guard.md");
  const before = await readFile(path, "utf8");
  const hits = await success(["search", "ルール", "--limit", "10"]);
  expect(hits).toHaveLength(1);
  expect(hits[0]).toMatchObject({ concept_id: "rules/auth-guard", matched_on: ["title"] });
  expect(await success(["search", "apiキー"])).toHaveLength(1);
  expect(await readFile(path, "utf8")).toBe(before);
  await writeFile(path, before.replace("認証変更の保留ルール", "画像の保存方針"));
  expect(await success(["search", "ルール"])).toEqual([]);
  expect(await success(["search", "保存"])).toHaveLength(1);
});
test("body-file and YAML metadata work without shell interpolation; empty body is a valid update", async () => {
  await success(["init"]);
  await writeFile(join(project, "meta.yaml"), "type: knowledge\ntitle: YAML\ndescription: Read from file.\n");
  const body = "# 本文\n`$HOME` and $(example) stay literal.\n";
  await writeFile(join(project, "body.md"), body);
  await success(["create", "knowledge/file", "--metadata-file", "meta.yaml", "--body-file", "body.md"]);
  expect((await success(["show", "knowledge/file"])).body).toBe(body);
  await success(["update", "knowledge/file", "--body", ""]);
  expect((await success(["show", "knowledge/file"])).body).toBe("");
});
test("CLI lists every supported type without keywords and lets callers retrieve the discovered rule", async () => {
  await success(["init"]);
  for (const [type, directory] of [["rule", "rules"], ["principle", "principles"], ["knowledge", "knowledge"], ["procedure", "procedures"], ["decision", "decisions"]]) {
    await create(`${directory}/example`, type);
  }
  for (const [type, directory] of [["rule", "rules"], ["principle", "principles"], ["knowledge", "knowledge"], ["procedure", "procedures"], ["decision", "decisions"]]) {
    const hits = await success(["search", "--type", type!]);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ concept_id: `${directory}/example`, type, matched_on: ["type"] });
  }
  const rules = await success(["search", "--type", "rule", ".space/babel", "--limit", "100"]);
  expect(await success(["show", rules[0].concept_id])).toMatchObject({ type: "rule", title: "Auth" });
  expect(await success(["search", "Auth", "--type", "rule"])).toHaveLength(1);
  expect(await success(["search", "unmatched", "--type", "rule"])).toEqual([]);
});
test("CLI combines type with explicit bundles, keywords and path discovery", async () => {
  const bundle = join(project, "custom bundle");
  await success(["init", bundle]);
  await writeFile(join(project, "meta.json"), JSON.stringify({ type: "rule", title: "Freeze", description: "Wait for review.", governance: "hold", code_refs: ["src/**"] }));
  await success(["create", "rules/freeze", bundle, "--metadata-file", "meta.json"]);
  await success(["create", "knowledge/overview", bundle, "--type", "knowledge", "--title", "Overview", "--desc", "Auth."]);
  expect(await success(["search", "--type", "rule", bundle])).toHaveLength(1);
  expect(await success(["search", "Freeze", bundle, "--type", "rule"])).toHaveLength(1);
  expect(await success(["search", "", bundle, "--type", "rule"])).toHaveLength(1);
  const pathArgs = ["--type", "rule", "--for-path", "src/auth.ts"];
  expect((await success(["search", bundle, ...pathArgs]))[0]).toMatchObject({ concept_id: "rules/freeze", governance: "hold" });
  expect((await success(["search", "Overview", bundle, ...pathArgs]))[0]).toMatchObject({ concept_id: "rules/freeze", matched_on: ["code_refs", "type"] });
  expect((await run(["search", "", "missing-bundle", "--type", "rule", "--json"])).code).toBe(2);
  for (const type of ["rules", "RULE", "", "unknown", "toString"]) {
    const result = await run(["search", "--type", type, "--json"]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "error", error: expect.stringContaining("--type") });
  }
  expect((await run(["search", "--help"])).stdout).toContain("--type");
});
test("strict warnings, invalid input and bundle loading have meaningful exit codes and JSON errors", async () => {
  expect((await run(["validate", "absent", "--json"])).code).toBe(2);
  await success(["init"]);
  await create("knowledge/a");
  await create("knowledge/b");
  const validation = await run(["validate", "--strict", "--json"]);
  expect(validation.code).toBe(1);
  expect(JSON.parse(validation.stdout).orphans).toHaveLength(2);
  const bad = await run(["create", "../escape", "--json"]);
  expect(bad.code).toBe(1);
  expect(JSON.parse(bad.stdout).status).toBe("error");
  expect(await Bun.file(join(project, "escape.md")).exists()).toBe(false);
  for (const args of [["search"], ["search", "auth", "--limit", "x"], ["show", "knowledge/a", "--json", "--raw"], ["create", "knowledge/a", "--unknown"], ["relate", "knowledge/a", "knowledge/b"], ["mcp"]]) {
    expect((await run(args)).code).toBe(1);
  }
});
test("CLI --all discovers more than 100 rules with descriptions before callers choose a body", async () => {
  await success(["init"]);
  for (let i = 0; i < 105; i++) {
    await writeFile(join(project, `.space/babel/rules/${String(i).padStart(3, "0")}.md`), `---\ntype: rule\ntitle: Rule ${i}\ndescription: 認証を変更するときに適用する条件${i}。\ncode_refs: [src/auth.ts]\n---\n本文${i}\n`);
  }
  await create("knowledge/other");
  const hits = await success(["search", "--type", "rule", "--all"]);
  expect(hits).toHaveLength(105);
  expect(hits.at(-1)).toMatchObject({ concept_id: "rules/104", description: "認証を変更するときに適用する条件104。" });
  expect(hits.every((hit: Record<string, unknown>) => hit.body === undefined)).toBe(true);
  expect(await success(["show", hits.at(-1).concept_id])).toMatchObject({ body: "本文104\n" });
  expect(await success(["search", "認証", ".space/babel", "--type", "rule", "--all"])).toHaveLength(105);
  expect(await success(["search", "--type", "rule", "--for-path", "src/auth.ts", ".space/babel", "--all"])).toHaveLength(105);
  expect(await success(["search", "--type", "rule", "--limit", "1000"])).toHaveLength(100);
  expect(await success(["search", "--type", "rule"])).toHaveLength(10);
  const plain = await run(["search", "--type", "rule", "--all"]);
  expect(plain.code).toBe(0);
  expect(plain.stdout).toContain("認証を変更するときに適用する条件104。");
  const conflict = await run(["search", "--type", "rule", "--all", "--limit", "100", "--json"]);
  expect(conflict.code).toBe(1);
  expect(JSON.parse(conflict.stdout).error).toContain("--all and --limit");
  expect((await run(["search", "--all"])).code).toBe(1);
});
test.each(["init", "search", "show", "create", "update", "delete", "relate", "validate"])("%s help has usable options", async command => {
  const help = await run([command, "--help"]);
  expect(help.code).toBe(0);
  expect(help.stdout).toContain(`okf ${command}`);
  expect(help.stdout).toContain("--json");
});
test("distributed skill runs offline with its installed dependency outside this repository", async () => {
  const distributed = join(project, "distributed");
  await cp(resolve(import.meta.dir, "../scripts"), join(distributed, "scripts"), { recursive: true });
  await cp(resolve(import.meta.dir, "../package.json"), join(distributed, "package.json"));
  // Stage the already-installed package so this test neither downloads nor relies on Bun auto-install.
  const dependency = resolve(dirname(Bun.resolveSync("minisearch", import.meta.dir)), "../..");
  await cp(dependency, join(distributed, "node_modules/minisearch"), { recursive: true });
  const copied = join(distributed, "scripts/okf.ts");
  const version = await run(["version", "--json"], copied);
  expect(version.stderr).toBe("");
  expect(version.code).toBe(0);
  expect(JSON.parse(version.stdout)).toMatchObject({ version: "0.1.0", okf_version: "0.2" });
  expect((await run(["init", "portable", "--json"], copied)).code).toBe(0);
  expect(await Bun.file(join(project, "portable/index.md")).exists()).toBe(true);
  expect((await run(["create", "rules/example", "portable", "--type", "rule", "--title", "認証変更の保留ルール", "--desc", "配布先での確認。", "--json"], copied)).code).toBe(0);
  const hits = await run(["search", "ルール", "portable", "--json"], copied);
  expect(hits.stderr).toBe("");
  expect(hits.code).toBe(0);
  expect(JSON.parse(hits.stdout)[0]).toMatchObject({ concept_id: "rules/example", matched_on: ["title"] });
  const rules = await run(["search", "--type", "rule", "portable", "--all", "--json"], copied);
  expect(rules.code).toBe(0);
  expect(JSON.parse(rules.stdout)[0]).toMatchObject({ concept_id: "rules/example", matched_on: ["type"] });
  const preview = await run(["delete", "rules/example", "portable", "--dry-run", "--json"], copied);
  expect(preview.code).toBe(0);
  expect(JSON.parse(preview.stdout)).toMatchObject({ status: "preview", concept_id: "rules/example" });
  const deletion = await run(["delete", "rules/example", "portable", "--json"], copied);
  expect(deletion.code).toBe(0);
  expect(await Bun.file(join(project, "portable/rules/example.md")).exists()).toBe(false);
  expect(JSON.parse((await run(["validate", "portable", "--strict", "--drift", "--json"], copied)).stdout)).toMatchObject({ gate_passed: true, concept_count: 0 });
});
