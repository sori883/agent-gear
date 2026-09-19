// Set OKF_REFERENCE_BIN to a binary built from upstream commit
// 9413d7780714165dcb8e82fff73b9f966feb653a. No downloads occur during tests.
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createConcept, initBundle, loadBundle, relateConcepts, updateConcept } from "../scripts/lib/bundle.ts";
import { search, searchForPath } from "../scripts/lib/search.ts";
import type { SearchResult } from "../scripts/lib/search.ts";

const reference = process.env.OKF_REFERENCE_BIN;
async function invoke(executable: string[], args: string[]) {
  const p = Bun.spawn([...executable, ...args, "--json"], { stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  expect(err).toBe(""); expect(code).toBe(0);
  return JSON.parse(out);
}
const upstreamTest = test.skipIf(!reference);
// MiniSearch intentionally changes scoring/ranking and Japanese tokenization.
// Compare the shared ASCII retrieval contract and provenance, not the old formula.
const comparable = (hits: SearchResult[] | null) => (hits ?? []).map(({ score, matched_on, ...hit }) => ({
  ...hit, matched_on: [...matched_on].sort(),
})).sort((a, b) => a.concept_id < b.concept_id ? -1 : a.concept_id > b.concept_id ? 1 : 0);
upstreamTest("ASCII search matches and provenance remain compatible with the pinned Go executable", async () => {
  const root = await mkdtemp(join(tmpdir(), "okf-reference-"));
  try {
    await initBundle(root);
    await createConcept(root, "knowledge/auth", { type: "knowledge", title: "Authentication", description: "Explains authentication.", tags: ["security", "auth"], governance: "context", code_refs: ["src/auth/login.ts"] }, "auth auth auth auth auth auth 日本語の認証\n");
    await createConcept(root, "rules/freeze", { type: "rule", title: "Freeze", description: "Wait for review.", governance: "hold", code_refs: ["src/auth/"] }, "# Rule\n");
    await createConcept(root, "rules/auth", { type: "rule", title: "Authentication policy", description: "Authentication is required.", governance: "constraint", code_refs: ["src/**/*.ts"] }, "security auth\n");
    await relateConcepts(root, "rules/auth", "knowledge/auth", "Background");
    const b = await loadBundle(root);
    for (const query of ["auth", "AUTH security", "Freeze", "nonexistent", "auth auth"]) {
      expect(comparable(search(b, query, 3))).toEqual(comparable(await invoke([reference!], ["search", query, root, "--limit", "3"])));
    }
    for (const path of ["src/auth/login.ts", "src/auth/other.go", "src/a.ts", "src/nothing.js"]) {
      expect(comparable(searchForPath(b, path, "auth", 100))).toEqual(comparable(await invoke([reference!], ["search", "auth", root, "--for-path", path, "--limit", "100"])));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
upstreamTest("Go and Bun can read and update each other's documents and bookkeeping", async () => {
  const root = await mkdtemp(join(tmpdir(), "okf-interchange-"));
  const cli = [process.execPath, resolve(import.meta.dir, "../scripts/okf.ts")];
  try {
    await initBundle(root);
    await invoke([reference!], ["create", "knowledge/from-go", root, "--type", "knowledge", "--title", "From Go", "--desc", "Shared document.", "--body", "# Source\n"]);
    expect((await invoke(cli, ["show", "knowledge/from-go", root])).body).toContain("# Source");
    await updateConcept(root, "knowledge/from-go", { description: "Updated in Bun." });
    expect((await invoke([reference!], ["show", "knowledge/from-go", root])).description).toBe("Updated in Bun.");
    await createConcept(root, "knowledge/from-bun", { type: "knowledge", title: "From Bun", description: "Other document.", custom: { retained: true } }, "# Bun\n");
    await invoke([reference!], ["update", "knowledge/from-bun", root, "--desc", "Updated in Go."]);
    const doc = await invoke(cli, ["show", "knowledge/from-bun", root]);
    expect(doc.description).toBe("Updated in Go.");
    expect(doc.extra).toEqual({ custom: { retained: true } });
    await relateConcepts(root, "knowledge/from-bun", "knowledge/from-go", "Interchange");
    const go = await invoke([reference!], ["validate", root, "--strict", "--drift"]);
    const bun = await invoke(cli, ["validate", root, "--strict", "--drift"]);
    expect(go).toMatchObject({ concept_count: 2, errors: [], warnings: [], gate_passed: true });
    expect(bun).toMatchObject({ concept_count: 2, errors: [], warnings: [], gate_passed: true });
  } finally { await rm(root, { recursive: true, force: true }); }
});
