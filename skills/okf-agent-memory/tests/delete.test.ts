import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConcept, deleteConcept, initBundle, loadBundle, relateConcepts } from "../scripts/lib/bundle.ts";
import { validate } from "../scripts/lib/validate.ts";

let root: string;
const metadata = { type: "knowledge", title: "Target", description: "Deletion fixture." };
const options = { actor: "agent:codex", now: new Date("2026-09-20T01:02:03Z") };
const later = { actor: "agent:deleter", now: new Date("2026-09-21T02:03:04Z") };
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "okf-delete-")); await initBundle(root, options); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
async function snapshot() {
  const b = await loadBundle(root);
  return [...b.concepts.values()].map(c => [c.path, c.raw]).concat([...b.indexes], [...b.logs]);
}

test("delete removes the file, incoming/outgoing relations and index entries while keeping history", async () => {
  await createConcept(root, "knowledge/nested/target", metadata, "", options);
  const verified = [{ by: "human:reader", at: options.now.toISOString() }];
  await createConcept(root, "knowledge/source", { ...metadata, verified, custom: { keep: true } }, "# Source\n", options);
  await createConcept(root, "knowledge/other", metadata, "Keep unchanged.\n", options);
  await relateConcepts(root, "knowledge/source", "knowledge/nested/target", "Reason", options);
  await relateConcepts(root, "knowledge/nested/target", "knowledge/other", "Forward", options);
  const other = await readFile(join(root, "knowledge/other.md"), "utf8");
  const result = await deleteConcept(root, "knowledge/nested/target.md", later);
  expect(result.updated_concepts).toEqual(["knowledge/source"]);
  expect(result.new_orphans).toEqual(["knowledge/other", "knowledge/source"]);
  expect(result.removed_relations).toEqual([
    { source: "knowledge/nested/target", target: "knowledge/other" },
    { source: "knowledge/source", target: "knowledge/nested/target" },
  ]);
  const b = await loadBundle(root);
  expect(b.concepts.has("knowledge/nested/target")).toBe(false);
  expect(b.brokenLinks).toEqual([]);
  expect(b.indexes.get("knowledge/nested/index.md")).not.toContain("target.md");
  expect(b.indexes.get("knowledge/index.md")).toContain("nested/index.md");
  const source = b.concepts.get("knowledge/source")!;
  expect(source.body).toBe("# Source\n");
  expect(source.metadata).toMatchObject({ verified, custom: { keep: true }, generated: { by: later.actor, at: later.now.toISOString() } });
  expect(await readFile(join(root, "knowledge/other.md"), "utf8")).toBe(other);
  const log = b.logs.get("log.md")!;
  expect(log).toContain("**Creation**: Target (`knowledge/nested/target`).");
  expect(log).not.toContain("](knowledge/nested/target.md)");
  expect(log).toContain("**Deletion**");
  for (const value of [later.actor, later.now.toISOString(), "knowledge/nested/target", "knowledge/source"]) expect(log).toContain(value);
  const validation = await validate(b, { strict: true, drift: true });
  expect(validation).toMatchObject({ errors: [], broken_links: [], gate_passed: false });
  expect(validation.warnings).toEqual(["knowledge/source.md: verified[0]: verification predates generated.at (superseded verification)."]);
});

test("delete unlinks prose, preserves other links and code, and resolves encoded/anchored paths", async () => {
  await createConcept(root, "knowledge/a b", metadata, "", options);
  await createConcept(root, "knowledge/keep", metadata, "", options);
  const untouched = '```md\n[Example](a%20b.md)\n```\n`[Inline](a%20b.md)`\n<!-- [Hidden](a%20b.md) -->\n![Image](a%20b.md)\n[External](https://example.com/a%20b.md)\n';
  await createConcept(root, "knowledge/source", metadata,
    'Refer to [Target](<a%20b.md#section> "Title") and [Keep](keep.md).\n' + untouched +
    '# Related Concepts\n- [Target](a%20b.md): see [Keep](keep.md).\n# After\nKeep this.\n', options);
  await deleteConcept(root, "knowledge/a b", later);
  const b = await loadBundle(root);
  const body = b.concepts.get("knowledge/source")!.body;
  expect(body).toContain("Refer to Target and [Keep](keep.md).");
  expect(body).toContain(untouched);
  expect(body).toContain("- Target: see [Keep](keep.md).");
  expect(body).toContain("# After\nKeep this.");
  expect(b.graph.get("knowledge/source")).toEqual(["knowledge/keep"]);
  expect(await validate(b, { strict: true, drift: true })).toMatchObject({ gate_passed: true });
});

test("dry run reports the same planned changes without changing content or provenance", async () => {
  await createConcept(root, "knowledge/target", metadata, "", options);
  await createConcept(root, "knowledge/source", metadata, "", options);
  await relateConcepts(root, "knowledge/source", "knowledge/target", "Reason", options);
  const before = await snapshot();
  const preview = await deleteConcept(root, "knowledge/target", { ...later, dryRun: true });
  expect(await snapshot()).toEqual(before);
  expect(await Bun.file(join(root, ".okf-write-lock")).exists()).toBe(false);
  expect(await deleteConcept(root, "knowledge/target", later)).toEqual(preview);
  const after = await snapshot();
  await expect(deleteConcept(root, "knowledge/target", later)).rejects.toThrow(/not found/i);
  expect(await snapshot()).toEqual(after);
});

test("delete preserves CRLF, escaped links and code spans with multiple backticks", async () => {
  await createConcept(root, "knowledge/target", metadata, "", options);
  const body = '# Notes\r\n``[Code](target.md)`` and \\[Escaped](target.md)\r\n' +
    '<!-- comment --> [Visible](target.md)\r\n# Related Concepts\r\n\r\n# After\r\nKeep.\r\n';
  await createConcept(root, "knowledge/source", metadata, body, options);
  await deleteConcept(root, "knowledge/target", later);
  const c = (await loadBundle(root)).concepts.get("knowledge/source")!;
  expect(c.body).toBe(body.replace('[Visible](target.md)', 'Visible'));
});

test("delete rejects unsafe or reserved targets without modifying the bundle", async () => {
  const before = await snapshot();
  for (const id of ["../escape", "/absolute", "index", "log", "knowledge/index", "AGENTS", "knowledge/missing"]) {
    await expect(deleteConcept(root, id, later)).rejects.toThrow();
  }
  for (const actor of ["", "   ", "unknown"]) await expect(deleteConcept(root, "knowledge/missing", { ...later, actor })).rejects.toThrow(/actor/);
  expect(await snapshot()).toEqual(before);
});

test("malformed surviving documents block deletion before writes; a malformed target can be removed", async () => {
  await createConcept(root, "knowledge/target", metadata, "", options);
  await writeFile(join(root, "knowledge/broken.md"), "---\n[invalid YAML\n---\n[Target](target.md)\n");
  const before = await snapshot();
  await expect(deleteConcept(root, "knowledge/target", later)).rejects.toThrow(/knowledge\/broken/);
  expect(await snapshot()).toEqual(before);
  await deleteConcept(root, "knowledge/broken", later);
  expect((await loadBundle(root)).concepts.has("knowledge/broken")).toBe(false);
});

test("delete respects the write lock and rejects symlinked bookkeeping before changing files", async () => {
  await createConcept(root, "knowledge/target", metadata, "", options);
  const before = await snapshot();
  await mkdir(join(root, ".okf-write-lock"));
  await expect(deleteConcept(root, "knowledge/target", later)).rejects.toThrow(/lock/);
  await rm(join(root, ".okf-write-lock"), { recursive: true });
  expect(await snapshot()).toEqual(before);
  const original = await readFile(join(root, "log.md"), "utf8");
  await writeFile(join(root, "history.txt"), original);
  await rm(join(root, "log.md"));
  await symlink(join(root, "history.txt"), join(root, "log.md"));
  await expect(deleteConcept(root, "knowledge/target", later)).rejects.toThrow(/symlink/i);
  expect(await Bun.file(join(root, "knowledge/target.md")).exists()).toBe(true);
  expect(await readFile(join(root, "history.txt"), "utf8")).toBe(original);
});

test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("failed unlink reports previous changes and never records a successful deletion", async () => {
  await createConcept(root, "knowledge/target", metadata, "", { ...options, noIndex: true });
  await chmod(join(root, "knowledge"), 0o555);
  try {
    await expect(deleteConcept(root, "knowledge/target", later)).rejects.toMatchObject({ writtenPaths: [] });
    expect(await Bun.file(join(root, "knowledge/target.md")).exists()).toBe(true);
    expect(await readFile(join(root, "log.md"), "utf8")).not.toContain("**Deletion**");
  } finally { await chmod(join(root, "knowledge"), 0o755); }
});
