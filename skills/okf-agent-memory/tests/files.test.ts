import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyChanges } from "../scripts/lib/files.ts";

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
