import { expect, test } from "bun:test";
import type { Bundle, Concept } from "../scripts/lib/bundle.ts";
import { matchCodeRef, search, searchForPath } from "../scripts/lib/search.ts";

export function corpus(): Bundle {
  const data = [
    ["rules/freeze", "Freeze", "Wait for review.", "", "hold", ["src/auth/"]],
    ["rules/auth", "Authentication policy", "Authenticate every request.", "security auth auth", "constraint", ["src/**/*.ts"]],
    ["knowledge/auth", "Authentication", "Authentication overview.", "auth auth auth auth auth auth 日本語の認証", "context", ["src/auth/login.ts"]],
  ] as const;
  const concepts = new Map<string, Concept>(data.map(([id, title, description, body, governance, code_refs]) => [id, {
    id, path: `${id}.md`, raw: "", body,
    metadata: { type: id.startsWith("rules/") ? "rule" : "knowledge", title, description, governance, code_refs: [...code_refs], tags: ["security"] },
  }]));
  return { root: "/unused", version: "0.2", concepts, indexes: new Map(), logs: new Map(), graph: new Map(), inbound: new Map(), brokenLinks: [], orphans: [] };
}

test("prefix search includes matched fields and supports multiple keywords", () => {
  const result = search(corpus(), "auth", 3);
  expect(result.map(r => r.concept_id).sort()).toEqual(["knowledge/auth", "rules/auth"]);
  expect(result.every(r => r.score > 0 && Number.isFinite(r.score))).toBe(true);
  expect(result.find(r => r.concept_id === "knowledge/auth")?.matched_on).toEqual(["title", "description", "id", "body"]);
  expect(search(corpus(), "日本語")[0]?.concept_id).toBe("knowledge/auth");
  expect(search(corpus(), "security nonexistent")).toHaveLength(3);
  expect(search(corpus(), "??")).toEqual([]);
});

function documents(entries: { id: string; title?: string; description?: string; tags?: string[]; body?: string }[]): Bundle {
  const b = corpus();
  b.concepts = new Map(entries.map(({ id, body = "", ...metadata }) => [id, {
    id, path: `${id}.md`, raw: "", body, metadata: { type: "knowledge", ...metadata },
  }]));
  return b;
}

test("Japanese words inside titles, descriptions, tags, IDs and bodies are searchable", () => {
  const b = documents([
    { id: "rules/auth-guard", title: "認証変更の保留ルール" },
    { id: "knowledge/summary", description: "架空の認証仕様の変更を一時保留するサンプルルール。" },
    { id: "knowledge/tag", tags: ["認証ルール"] },
    { id: "knowledge/認証ルール" },
    { id: "knowledge/body", body: "これはCLI確認用の架空ルールです。" },
    { id: "knowledge/unrelated", title: "画像の保存先" },
  ]);
  const hits = new Map(search(b, "ルール").map(r => [r.concept_id, r.matched_on]));
  expect(hits.size).toBe(5);
  expect(hits.get("rules/auth-guard")).toEqual(["title"]);
  expect(hits.get("knowledge/summary")).toEqual(["description"]);
  expect(hits.get("knowledge/tag")).toEqual(["tags"]);
  expect(hits.get("knowledge/認証ルール")).toEqual(["id"]);
  expect(hits.get("knowledge/body")).toEqual(["body"]);
  expect(search(b, "認証ルール").some(r => r.concept_id === "rules/auth-guard")).toBe(true);
});

test("normalizes width, composed kana and case for Japanese and mixed code terms without changing documents", () => {
  const b = documents([{ id: "knowledge/mixed", title: "ＡＰＩキーとｶﾞｰﾄﾞ", body: "TypeScriptの認証をsnake_caseで定義する。" }]);
  const before = JSON.stringify([...b.concepts]);
  for (const query of ["api", "APIキー", "ガード", "カ\u3099ード", "typescript", "case"]) {
    expect(search(b, query).map(r => r.concept_id)).toEqual(["knowledge/mixed"]);
  }
  expect(search(b, "ａｐｉ")).toEqual(search(b, "API"));
  expect(JSON.stringify([...b.concepts])).toBe(before);
});

test("common Japanese particles do not retrieve unrelated documents; meaningful negation remains searchable", () => {
  const b = documents([
    { id: "rules/a", title: "認証のルール" },
    { id: "knowledge/b", title: "画像の形式" },
    { id: "rules/c", title: "検証を省略しない。例外はない" },
  ]);
  expect(search(b, "認証のルール").map(r => r.concept_id)).toEqual(["rules/a"]);
  expect(search(b, "の は を")).toEqual([]);
  expect(search(b, "ない").map(r => r.concept_id)).toEqual(["rules/c"]);
  expect(search(b, "しない").map(r => r.concept_id)).toEqual(["rules/c"]);
});

test("BM25 length normalization ranks focused bodies above long bodies with the same term frequency", () => {
  const b = documents([
    { id: "knowledge/a-long", title: "Notes", body: `needle ${Array.from({ length: 200 }, (_, i) => `filler${i}`).join(" ")}` },
    { id: "knowledge/z-short", title: "Notes", body: "needle detail" },
  ]);
  const hits = search(b, "needle");
  expect(hits.map(r => r.concept_id)).toEqual(["knowledge/z-short", "knowledge/a-long"]);
  expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
});

test("title matches outrank body matches with otherwise equivalent documents", () => {
  const b = documents([
    { id: "knowledge/a-body", title: "Other", body: "needle" },
    { id: "knowledge/z-title", title: "needle", body: "Other" },
  ]);
  expect(search(b, "needle").map(r => r.concept_id)).toEqual(["knowledge/z-title", "knowledge/a-body"]);
});

test("search bounds the query and handles empty bundles", () => {
  const b = documents([{ id: "knowledge/a", title: "needle" }]);
  expect(search(b, `${"unused ".repeat(50)}needle`)).toEqual([]);
  expect(search(b, `${" ".repeat(1000)}needle`)).toEqual([]);
  expect(search(documents([]), "ルール")).toEqual([]);
});
test("path ranking preserves holds even when query only matches contextual documents", () => {
  const result = searchForPath(corpus(), "src/auth/login.ts", "overview", 100);
  expect(result.map(r => r.governance)).toEqual(["hold", "constraint", "context"]);
  expect(result[0]?.score).toBe(30);
  expect(result[0]?.matched_on).toEqual(["code_refs"]);
  expect(result[2]?.matched_on).toEqual(["code_refs", "description"]);
  expect(searchForPath(corpus(), "src/unrelated.js", "auth")).toEqual([]);
});
test.each([
  ["src/auth", "src/auth/login.ts", true], ["src/auth/", "src/auth/login.ts", true],
  ["src/auth", "src/authentication/a.ts", false], ["src/**/*.ts", "src/login.ts", true],
  ["src/**/*.ts", "src/auth/login.ts", true], ["src/*.ts", "src/auth/login.ts", false],
  ["src/**/*.go", "src/auth/login.ts", false], ["./src/a.ts", "src/a.ts", true],
  ["src/auth", "/workspace/src/auth/a.ts", true],
])("matches code_ref %s against %s", (ref, path, expected) => expect(matchCodeRef(ref, path)).toBe(expected));
test("ties are lexically stable independent of insertion order and limits are bounded", () => {
  const b = corpus();
  b.concepts.clear();
  for (let i = 120; i >= 0; i--) {
    const id = `knowledge/${String(i).padStart(3, "0")}`;
    b.concepts.set(id, { id, path: `${id}.md`, raw: "", body: "", metadata: { type: "knowledge", title: "Equal", description: "Same." } });
  }
  expect(search(b, "equal", 1000)).toHaveLength(100);
  expect(search(b, "equal", 0)).toHaveLength(10);
  expect(search(b, "equal", 2).map(r => r.concept_id)).toEqual(["knowledge/000", "knowledge/001"]);
  expect(search(b, "equal", 1)[0]?.governance).toBe("context");
});
