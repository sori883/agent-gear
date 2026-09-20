import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyChanges } from "../scripts/lib/files.ts";

test("preflight rejects stale deletions before any other file is changed", async () => {
  const root = await mkdtemp(join(tmpdir(), "okf-delete-preflight-"));
  try {
    await writeFile(join(root, "target.md"), "modified by another writer");
    await expect(applyChanges(root, [
      { relative: "other.md", after: "must not be created" },
      { relative: "target.md", before: "stale snapshot", after: null },
    ])).rejects.toMatchObject({ writtenPaths: [] });
    expect(await Bun.file(join(root, "other.md")).exists()).toBe(false);
    expect(await readFile(join(root, "target.md"), "utf8")).toBe("modified by another writer");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("a log failure after unlink reports the deleted path as already changed", async () => {
  const root = await mkdtemp(join(tmpdir(), "okf-delete-partial-"));
  try {
    await mkdir(join(root, "knowledge"));
    await writeFile(join(root, "knowledge/target.md"), "target");
    await writeFile(join(root, "log.md"), "old history");
    await chmod(root, 0o555);
    await expect(applyChanges(root, [
      { relative: "knowledge/target.md", before: "target", after: null },
      { relative: "log.md", before: "old history", after: "deletion event" },
    ])).rejects.toMatchObject({ writtenPaths: ["knowledge/target.md"] });
    expect(await Bun.file(join(root, "knowledge/target.md")).exists()).toBe(false);
    expect(await readFile(join(root, "log.md"), "utf8")).toBe("old history");
  } finally { await chmod(root, 0o755); await rm(root, { recursive: true, force: true }); }
});

test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("partial write failure names exactly the files already written", async () => {
  const root = await mkdtemp(join(tmpdir(), "okf-partial-"));
  try {
    await mkdir(join(root, "knowledge"));
    await writeFile(join(root, "index.md"), "old");
    await chmod(root, 0o555);
    let error: unknown;
    try {
      await applyChanges(root, [{ relative: "knowledge/a.md", after: "created" }, { relative: "index.md", before: "old", after: "new" }]);
    } catch (e) { error = e; }
    expect(error).toMatchObject({ writtenPaths: ["knowledge/a.md"] });
    expect(await readFile(join(root, "knowledge/a.md"), "utf8")).toBe("created");
    expect(await readFile(join(root, "index.md"), "utf8")).toBe("old");
  } finally { await chmod(root, 0o755); await rm(root, { recursive: true, force: true }); }
});
