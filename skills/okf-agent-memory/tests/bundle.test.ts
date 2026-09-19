import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConcept, initBundle, loadBundle, relateConcepts, updateConcept } from "../scripts/lib/bundle.ts";

let root: string;
const metadata = { type: "knowledge", title: "Authentication", description: "Explains authentication." };
const options = { actor: "agent:codex", now: new Date("2026-09-20T01:02:03Z") };
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "okf-bundle-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test("init is non-destructive and create synchronizes nested indexes and log", async () => {
  await initBundle(root, options);
  await initBundle(root, options);
  await createConcept(root, "knowledge/auth/overview", metadata, "\n# 認証\n", options);
  const b = await loadBundle(root);
  expect(b.version).toBe("0.2");
  expect(b.concepts.get("knowledge/auth/overview")?.metadata.generated).toEqual({ by: "agent:codex", at: options.now.toISOString() });
  expect(b.indexes.get("knowledge/auth/index.md")).toContain("[Authentication](overview.md) - Explains authentication.");
  expect(b.indexes.get("knowledge/index.md")).toContain("(auth/index.md)");
  expect(b.indexes.get("index.md")).toContain("(knowledge/index.md)");
  const log = await readFile(join(root, "log.md"), "utf8");
  expect(log.match(/Initialized/g)).toHaveLength(1);
  expect(log).toContain("knowledge/auth/overview.md");
  await expect(createConcept(root, "knowledge/auth/overview", metadata, "overwrite", options)).rejects.toThrow(/exist/i);
  expect((await loadBundle(root)).concepts.get("knowledge/auth/overview")?.body).toBe("\n# 認証\n");
});
test("updates preserve unknown metadata, old verification and untouched body; no-op does not log", async () => {
  await initBundle(root, options);
  const body = "\r\n# Notes\r\nkeep spaces  \r\n";
  const verified = [{ by: "human:const", at: "2026-09-01T00:00:00Z" }];
  await createConcept(root, "knowledge/auth", { ...metadata, verified, custom: { flags: [1, true] } }, body, options);
  await updateConcept(root, "knowledge/auth", { title: "Updated auth", description: "Updated description." }, undefined, options);
  const c = (await loadBundle(root)).concepts.get("knowledge/auth")!;
  expect(c.body).toBe(body);
  expect(c.metadata.custom).toEqual({ flags: [1, true] });
  expect(c.metadata.verified).toEqual(verified);
  expect(await readFile(join(root, "knowledge/index.md"), "utf8")).toContain("Updated description.");
  const log = await readFile(join(root, "log.md"), "utf8");
  await updateConcept(root, "knowledge/auth", { title: "Updated auth" }, undefined, options);
  expect(await readFile(join(root, "log.md"), "utf8")).toBe(log);
  await expect(updateConcept(root, "knowledge/auth", { title: "" }, undefined, options)).rejects.toThrow(/title/);
  expect((await loadBundle(root)).concepts.get("knowledge/auth")?.metadata.title).toBe("Updated auth");
});
test("relate builds directed links and is idempotent, including the log", async () => {
  await initBundle(root, options);
  await createConcept(root, "knowledge/auth", metadata, "# Auth\n", options);
  await createConcept(root, "procedures/tests", { ...metadata, type: "procedure", title: "Test procedure" }, "# Tests\n", options);
  await relateConcepts(root, "knowledge/auth", "procedures/tests", "How to test", options);
  const b = await loadBundle(root);
  expect(b.graph.get("knowledge/auth")).toEqual(["procedures/tests"]);
  expect(b.inbound.get("procedures/tests")).toEqual(["knowledge/auth"]);
  expect(b.orphans).toEqual([]);
  expect(b.concepts.get("knowledge/auth")?.body).toContain("[Test procedure](../procedures/tests.md): How to test");
  const log = await readFile(join(root, "log.md"), "utf8");
  await relateConcepts(root, "knowledge/auth", "procedures/tests", "How to test", options);
  expect(await readFile(join(root, "log.md"), "utf8")).toBe(log);
  await expect(relateConcepts(root, "knowledge/auth", "knowledge/auth", "", options)).rejects.toThrow(/itself/);
});
test("relate inserts inside an existing section even after multiline HTML comments", async () => {
  await initBundle(root, options);
  const intro = "<!--\nhidden\n-->\n# Intro\ntext\n";
  await createConcept(root, "knowledge/a", metadata, intro + "# Related Concepts\n\n# After\nKeep this.\n", options);
  await createConcept(root, "knowledge/b", metadata, "", options);
  await relateConcepts(root, "knowledge/a", "knowledge/b", "Background", options);
  const body = (await loadBundle(root)).concepts.get("knowledge/a")!.body;
  expect(body).toContain(intro);
  expect(body).toContain("# Related Concepts\n\n- [Authentication](b.md): Background\n# After\nKeep this.");
});
test("explicit sync repairs bookkeeping without pretending the content was regenerated", async () => {
  await initBundle(root, options);
  const c = await createConcept(root, "knowledge/auth", metadata, "Original body", { ...options, noIndex: true, noLog: true });
  await updateConcept(root, c.id, {}, undefined, { ...options, sync: true, now: new Date("2026-09-21T01:00:00Z") });
  const b = await loadBundle(root);
  expect(b.concepts.get(c.id)?.raw).toBe(c.raw);
  expect(b.indexes.get("knowledge/index.md")).toContain("[Authentication](auth.md) - Explains authentication.");
  expect(b.logs.get("log.md")).toContain("**Synchronization**");
  const log = b.logs.get("log.md");
  await updateConcept(root, c.id, {}, undefined, { ...options, sync: true });
  expect((await loadBundle(root)).logs.get("log.md")).toBe(log);
});
test("graph ignores fenced examples and external links, detects missing/reserved links and orphans", async () => {
  await initBundle(root, options);
  await createConcept(root, "knowledge/a", metadata, '[Missing](missing.md)\n[Nav](index.md)\n[External](https://example.com/file.md)\n```md\n[Ignored](no.md)\n```\n', options);
  await createConcept(root, "knowledge/b", metadata, "No links", options);
  const b = await loadBundle(root);
  expect(b.brokenLinks.map(link => link.target_href)).toEqual(["missing.md", "index.md"]);
  expect(b.orphans).toEqual(["knowledge/a", "knowledge/b"]);
});
test.each(["../escape", "/abs", "knowledge/../../escape", "knowledge/hidden/../x", "knowledge/.secret", "knowledge/index", "log", "AGENTS"])("rejects unsafe/reserved ID %s", async id => {
  await expect(createConcept(root, id, metadata, "", options)).rejects.toThrow();
});
test("preflights symlinked bookkeeping before writing a document", async () => {
  await mkdir(join(root, "knowledge"));
  const outside = await mkdtemp(join(tmpdir(), "okf-outside-"));
  try {
    const target = join(outside, "log.md");
    await writeFile(target, "unchanged");
    await symlink(target, join(root, "log.md"));
    await expect(createConcept(root, "knowledge/a", metadata, "", options)).rejects.toThrow(/symlink/i);
    expect(await Bun.file(join(root, "knowledge/a.md")).exists()).toBe(false);
    expect(await readFile(target, "utf8")).toBe("unchanged");
    await symlink(outside, join(root, "knowledge/escape"));
    await expect(createConcept(root, "knowledge/escape/a", metadata, "", options)).rejects.toThrow(/symlink/i);
  } finally { await rm(outside, { recursive: true, force: true }); }
});
