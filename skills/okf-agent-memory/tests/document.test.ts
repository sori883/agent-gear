import { expect, test } from "bun:test";
import { parseDocument, serializeDocument, validateMetadata } from "../scripts/lib/document.ts";

const required = { type: "knowledge", title: "認証", description: "認証の構造を説明する。" };
test("parses YAML, preserves body and unknown metadata across a round trip", () => {
  const text = '\uFEFF---\r\ntype: knowledge\r\ntitle: 認証\r\ndescription: 認証の構造。\r\nsources:\r\n  - resource: "https://example.com/a:b"\r\ncustom:\r\n  flags: [true, 3]\r\n---\r\n\r\n# 本文\r\n\r\n---\r\n';
  const parsed = parseDocument(text);
  expect(parsed.metadata.custom).toEqual({ flags: [true, 3] });
  expect(parsed.body).toBe("\r\n# 本文\r\n\r\n---\r\n");
  expect(parseDocument(serializeDocument(parsed))).toEqual(parsed);
});
test.each(["# No metadata", "---\ntype: rule", "---\n- item\n---\n", "---\na: [\n---\n"])("rejects malformed frontmatter %s", text => {
  expect(() => parseDocument(text)).toThrow();
});
test("requires the agreed profile and accepts complete provenance", () => {
  expect(validateMetadata({}).errors).toHaveLength(3);
  expect(validateMetadata({ ...required, type: "Fact" }).errors).toHaveLength(1);
  const metadata = { ...required, tags: ["auth"], generated: { by: "agent:codex", at: "2026-09-20T01:00:00Z" }, verified: [{ by: "human:const", at: "2026-09-20T02:00:00+00:00" }], sources: [{ resource: "src/auth.ts", id: "code", usage_count: 1 }], governance: "constraint", code_refs: ["src/**/*.ts"] };
  expect(validateMetadata(metadata)).toEqual({ errors: [], warnings: [] });
});
test.each([
  { tags: ["a", "a"] }, { code_refs: ["../secret"] }, { code_refs: ["/tmp/code"] },
  { stale_after: "2026-09-20" }, { stale_after: "2026-02-30T00:00:00Z" },
  { verified: [{ by: "agent:codex", at: "2026-09-20T00:00:00Z" }] },
  { generated: { by: "writer", at: "2026-09-20T00:00:00Z" } },
  { sources: [{ title: "missing resource" }] }, { status: "active" }, { governance: "must" },
])("rejects invalid profile metadata %j", patch => {
  expect(validateMetadata({ ...required, ...patch }).errors.length).toBeGreaterThan(0);
});
test("reports stale content and verification that predates the current revision", () => {
  const result = validateMetadata({ ...required, stale_after: "2026-09-01T00:00:00Z", generated: { by: "agent:codex", at: "2026-09-02T00:00:00Z" }, verified: [{ by: "human:const", at: "2026-09-01T00:00:00Z" }] }, new Date("2026-09-20T00:00:00Z"));
  expect(result.errors).toEqual([]);
  expect(result.warnings).toHaveLength(2);
});
