import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConcept, initBundle, loadBundle, relateConcepts } from "../scripts/lib/bundle.ts";
import { validate } from "../scripts/lib/validate.ts";

let root: string;
const now = new Date("2026-09-20T12:00:00Z");
const meta = { type: "knowledge", title: "Auth", description: "Explains auth." };
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "okf-validate-")); await initBundle(root, { now }); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const check = async (strict = true, drift = true) => validate(await loadBundle(root), { strict, drift, now, projectRoot: root });

test("a synchronized document passes strict drift validation without any findings", async () => {
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src/auth.ts"), "export {};\n");
  await createConcept(root, "knowledge/auth", { ...meta, code_refs: ["src/auth.ts", "src/**/*.ts"] }, "# Auth\n", { now });
  expect(await check()).toMatchObject({ declared_version: "0.2", concept_count: 1, errors: [], warnings: [], gate_findings: [], broken_links: [], orphans: [], stale_count: 0, is_conformant: true, gate_passed: true });
});
test("drift reports changed index descriptions and missing project-relative references", async () => {
  await createConcept(root, "knowledge/auth", { ...meta, code_refs: ["src/missing.ts", "src/**/*.go"] }, "", { now });
  await writeFile(join(root, "knowledge/index.md"), "# Index\n* [Auth](auth.md) - Outdated description.\n");
  const result = await check();
  expect(result.errors).toEqual([]);
  expect(result.warnings).toHaveLength(3);
  expect(result.warnings.join("\n")).toContain("description");
  expect(result.gate_passed).toBe(false);
  expect((await check(false)).gate_passed).toBe(true);
  expect((await check(true, false)).gate_passed).toBe(true);
});
test("strict rejects broken links and orphans; relate resolves connectivity", async () => {
  await createConcept(root, "knowledge/a", meta, "[Missing](missing.md)\n", { now });
  await createConcept(root, "knowledge/b", meta, "", { now });
  const before = await check();
  expect(before.broken_links).toHaveLength(1);
  expect(before.orphans).toEqual(["knowledge/a", "knowledge/b"]);
  expect(before.gate_passed).toBe(false);
  expect((await check(false)).gate_passed).toBe(true);
  await createConcept(root, "knowledge/missing", meta, "", { now });
  await relateConcepts(root, "knowledge/a", "knowledge/b", "Related", { now });
  expect((await check()).gate_passed).toBe(true);
});
test("expired deadlines and superseded human reviews fail strict but remain readable", async () => {
  await createConcept(root, "knowledge/a", { ...meta, stale_after: "2026-09-20T21:00:00+09:00", verified: [{ by: "human:const", at: "2026-09-19T00:00:00Z" }] }, "", { now });
  const result = await check();
  expect(result.stale_count).toBe(1);
  expect(result.warnings).toHaveLength(2);
  expect(result.gate_passed).toBe(false);
  expect((await check(false)).gate_passed).toBe(true);
  expect((await validate(await loadBundle(root), { stale: true, now })).gate_passed).toBe(false);
});
test("malformed documents and wrong type directories are errors even without strict", async () => {
  await writeFile(join(root, "knowledge/bad.md"), "No frontmatter");
  await writeFile(join(root, "knowledge/misplaced.md"), "---\ntype: rule\ntitle: Rule\ndescription: Keep it.\n---\n");
  const result = await check(false);
  expect(result.errors).toHaveLength(2);
  expect(result.is_conformant).toBe(false);
  expect(result.gate_passed).toBe(false);
});
test("detects legacy fields, dangling source IDs and malformed navigation documents", async () => {
  await createConcept(root, "knowledge/a", { ...meta, timestamp: "legacy", sources: [{ id: "actual", resource: "https://example.com" }] }, "Fact.[^missing]\n# Citations\nOld\n```md\n[^example]\n```", { now });
  await writeFile(join(root, "knowledge/index.md"), "---\ntype: index\n---\n[Auth](a.md)\n");
  await writeFile(join(root, "log.md"), "---\ntype: log\n---\n## yesterday\n");
  const result = await check();
  expect(result.gate_findings).toHaveLength(2);
  expect(result.warnings.some(w => w.includes("[^missing]"))).toBe(true);
  expect(result.warnings.some(w => w.includes("[^example]"))).toBe(false);
  expect(result.warnings.some(w => w.includes("log.md"))).toBe(true);
  expect(result.warnings.some(w => w.includes("frontmatter"))).toBe(true);
  expect(result.gate_passed).toBe(false);
});
test("missing root version, missing indexes and unsorted inputs produce stable diagnostics", async () => {
  await createConcept(root, "knowledge/z", meta, "", { now, noIndex: true });
  await createConcept(root, "knowledge/a", meta, "", { now, noIndex: true });
  await writeFile(join(root, "index.md"), "# Missing version\n");
  const result = await check();
  expect(result.warnings.some(w => w.includes("okf_version"))).toBe(true);
  expect(result.warnings.filter(w => w.includes("not listed"))).toHaveLength(2);
  expect(result).toEqual(await check());
});
