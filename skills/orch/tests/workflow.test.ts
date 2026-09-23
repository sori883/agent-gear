import { beforeEach, afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execute } from "../scripts/lib/engine.ts";
import { current, type Request, type Unit, type Check, type Submission, type State } from "../scripts/lib/model.ts";

let project: string, store: string;
const boss = { actor: "coordinator", session: "parent-1" };
const worker = { actor: "worker", session: "worker-1" };
beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "orch-workflow-")); store = join(project, ".space/tasks/.orch");
  await writeFile(join(project, "proof.md"), "Observed result\n");
  await writeFile(join(project, "output.md"), "Result version one\n");
  await writeFile(join(project, "handoff.md"), "Old session stopped; existing task delegated to successor.\n");
  await execute(store, { command: "init", ...boss, operationId: crypto.randomUUID(), input: { project } });
});
afterEach(async () => { await rm(project, { recursive: true, force: true }); });
async function get(id: string) { return (await execute(store, { command: "unit get", id })).data as Unit; }
async function change(command: string, id: string, input: Record<string, unknown> = {}, by = worker, extra: Partial<Request> = {}) {
  const u = await get(id);
  return execute(store, { command, id, ...by, operationId: crypto.randomUUID(), ifVersion: u.version, attempt: u.currentAttempt, input, ...extra });
}
async function add(id: string, input: Record<string, unknown> = {}) {
  return execute(store, { command: "unit add", id, ...boss, operationId: crypto.randomUUID(), input: {
    size: "small", purpose: "Report the observed result", owner: worker, scope: ["output.md"],
    conditions: [
      { id: "report", description: "Report findings", purpose: "delivery", required: true, allowed: ["pass"], target: "report" },
      { id: "quality", description: "Assess target", purpose: "assessment", required: false, allowed: ["pass"], target: "report" },
    ], stages: { review: { selection: "execute", reason: "Review-only request" } }, ...input,
  } });
}
async function check(id: string, condition = "report", verdict = "pass", extra: Record<string, unknown> = {}) {
  return (await change("ledger record", id, { condition, verdict, target: { id: "report", kind: "files", files: ["output.md"] }, evidence: ["proof.md"], method: "read and compare", environment: "local fixture", observedAt: new Date().toISOString(), ...extra })).data as Check;
}
async function finish(id: string, checks: string[]) {
  await change("unit stage", id, { selection: "execute", reason: "Review-only request", state: "completed" }, worker, { stage: "review" });
  return (await change("unit submit", id, { checks, report: "Findings and limits were reported", refs: ["proof.md"] })).data as Submission;
}
async function accepted(id: string) {
  await change("unit start", id);
  const c = await check(id); const s = await finish(id, [c.id]);
  await change("unit accept", id, { submission: s.id, reason: "Compared report with delivery condition" }, boss);
  return s;
}

test("review completion, failed assessment, and parent acceptance remain separate", async () => {
  await add("review"); await change("unit start", "review");
  const delivery = await check("review"); const quality = await check("review", "quality", "fail");
  const submitted = await finish("review", [delivery.id, quality.id]);
  expect(current(await get("review")).state).toBe("completed");
  expect(submitted.acceptance.state).toBe("pending");
  await change("unit accept", "review", { submission: submitted.id, reason: "Report is complete; target remains failed" }, boss);
  const summary = await execute(store, { command: "ledger check", id: "review" });
  expect(JSON.stringify(summary.data)).toContain('"fail"');
  const messages = await execute(store, { command: "inbox list", input: { recipient: boss.actor } });
  expect(messages.data).toEqual([]);
});

test("resume cannot replace frozen dependency inputs; reopen starts an empty new attempt", async () => {
  await add("a"); await accepted("a"); await add("b");
  await change("dependency add", "b", { on: "a", reason: "Use accepted report" }, boss);
  await change("unit start", "b"); await check("b"); await change("unit set", "b", { state: "paused", reason: "Pause" });
  const before = await get("b");
  await change("unit reopen", "a", { reason: "New information" }); await accepted("a");
  await expect(change("unit start", "b")).rejects.toMatchObject({ code: "INPUTS_CHANGED" });
  expect(current(await get("b")).inputs).toEqual(current(before).inputs);
  await change("unit reopen", "b", { reason: "Recheck against new upstream" }); await change("unit start", "b");
  expect((await get("b")).currentAttempt).toBe(2);
  expect(JSON.stringify((await execute(store, { command: "ledger check", id: "b" })).data)).toContain('"unknown"');
});

test("a superseded pass cannot be submitted after a failing recheck", async () => {
  await add("repair"); await change("unit start", "repair");
  const pass = await check("repair");
  const fail = await check("repair", "report", "fail", { supersedes: pass.id });
  await expect(check("repair", "report", "pass", { supersedes: pass.id })).rejects.toMatchObject({ code: "SUPERSEDED_CHECK" });
  await expect(finish("repair", [pass.id])).rejects.toMatchObject({ code: "SUPERSEDED_CHECK" });
  await expect(change("unit submit", "repair", { checks: [fail.id], report: "Failed", refs: ["proof.md"] })).rejects.toMatchObject({ code: "CONDITIONS_UNMET" });
});

test("reopen obsoletes a pending completion notification without accepting or deleting it", async () => {
  await add("revise"); await change("unit start", "revise");
  const c = await check("revise"); const s = await finish("revise", [c.id]);
  await change("unit reopen", "revise", { reason: "Correct the report" });
  expect((await execute(store, { command: "inbox list" })).data).toEqual([]);
  const state = JSON.parse(await readFile(join(store, "state.json"), "utf8"));
  expect(state.messages[0]).toMatchObject({ state: "obsolete", submission: s.id });
  expect(state.submissions[0]).toMatchObject({ active: false, successor: null, acceptance: { state: "pending" } });
  await expect(change("unit accept", "revise", { submission: s.id, reason: "Old" }, boss)).rejects.toMatchObject({ code: "STALE_SUBMISSION" });
});

test("new coordinator session may hand off once, but may not bypass ordinary session checks", async () => {
  await add("root", { owner: boss });
  const next = { actor: boss.actor, session: "parent-2" };
  await expect(change("unit start", "root", {}, next)).rejects.toMatchObject({ code: "SESSION_MISMATCH" });
  await expect(change("unit assign", "root", { coordinator: next }, next)).rejects.toMatchObject({ code: "HANDOFF_REQUIRED" });
  const oldVersion = (await get("root")).version;
  await change("unit assign", "root", { coordinator: next, handoff: { previousSession: boss.session, stoppedRef: "handoff.md", authorityRef: "handoff.md" }, reason: "Resume in successor session" }, next);
  await expect(change("unit start", "root", {}, boss)).rejects.toMatchObject({ code: "SESSION_MISMATCH" });
  await expect(change("unit assign", "root", { coordinator: { ...next, session: "parent-3" }, handoff: { previousSession: boss.session, stoppedRef: "handoff.md", authorityRef: "handoff.md" }, reason: "Race" }, { ...next, session: "parent-3" }, { ifVersion: oldVersion })).rejects.toBeDefined();
  await change("unit start", "root", {}, next);
});

test("an unchanged paused attempt resumes without discarding checks", async () => {
  await add("resume"); await change("unit start", "resume"); const c = await check("resume");
  await change("unit set", "resume", { state: "paused", reason: "Session continues later" });
  await change("unit start", "resume");
  expect((await get("resume")).currentAttempt).toBe(1);
  await finish("resume", [c.id]);
});

test("operation retries do not create duplicate submissions even with an old version", async () => {
  await add("retry"); await change("unit start", "retry"); const c = await check("retry");
  await change("unit stage", "retry", { selection: "execute", reason: "Done", state: "completed" }, worker, { stage: "review" });
  const u = await get("retry");
  const request: Request = { command: "unit submit", id: u.id, ...worker, operationId: "submit-once", ifVersion: u.version, attempt: 1, input: { checks: [c.id], report: "Done", refs: ["proof.md"] } };
  const first = await execute(store, request); const second = await execute(store, request);
  expect(second.data).toEqual(first.data); expect(second.replayed).toBe(true);
  await expect(execute(store, { ...request, input: { ...request.input, report: "Changed" } })).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
});

test("parent-child completion edges participate in cycle detection", async () => {
  await add("parent", { owner: boss });
  await add("child", { parent: "parent" });
  await expect(change("dependency add", "child", { on: "parent", reason: "Impossible cycle" }, boss)).rejects.toMatchObject({ code: "DEPENDENCY_CYCLE" });
});

test("changed output or evidence cannot reuse an old pass", async () => {
  await add("changed"); await change("unit start", "changed"); const c = await check("changed");
  await writeFile(join(project, "output.md"), "A different result\n");
  await expect(finish("changed", [c.id])).rejects.toMatchObject({ code: "ARTIFACT_CHANGED" });
});

test("a superseded record cannot be laundered through reuse in a new attempt", async () => {
  await add("reuse"); await change("unit start", "reuse");
  const first = await check("reuse"); await check("reuse", "report", "fail", { supersedes: first.id });
  await change("unit set", "reuse", { state: "paused", reason: "Reconsider" });
  await change("unit reopen", "reuse", { reason: "Recheck" }); await change("unit start", "reuse");
  await expect(check("reuse", "report", "pass", { reusedFrom: first.id, reuseReason: "Reuse older pass" })).rejects.toMatchObject({ code: "INVALID_REUSE" });
});

test("coordinator handoff invalidates the old session across its other active units", async () => {
  await add("first", { owner: boss }); await add("second", { owner: boss });
  await change("unit start", "second", {}, boss);
  const next = { actor: boss.actor, session: "parent-2" };
  await change("unit assign", "first", { coordinator: next, handoff: { previousSession: boss.session, stoppedRef: "handoff.md", authorityRef: "handoff.md" }, reason: "Parent session ended" }, next);
  await expect(change("unit set", "second", { state: "cancelled", reason: "Delayed old update" }, boss)).rejects.toMatchObject({ code: "SESSION_MISMATCH" });
  await change("unit start", "second", {}, next);
});

test("a decision gate blocks only its unit and resolving it does not resume work", async () => {
  await add("gated"); await add("independent");
  const gated = await get("gated");
  const gate = await execute(store, { command: "gate park", id: "choice", ...worker, operationId: "park", ifVersion: gated.version, attempt: 1, input: { unit: "gated", question: "Which option?", options: ["A", "B"], recommendation: "A", respondent: "human" } });
  await expect(change("unit start", "gated")).rejects.toMatchObject({ code: "GATE_OPEN" });
  await change("unit start", "independent");
  await execute(store, { command: "gate resolve", id: "choice", ...boss, operationId: "resolve", ifVersion: (gate.data as { version: number }).version, input: { answer: "B", evidence: ["proof.md"] } });
  expect(current(await get("gated")).state).toBe("pending");
  await change("unit start", "gated");
});

test("accepted failure reports do not satisfy dependencies requiring a passing assessment", async () => {
  await add("review"); await change("unit start", "review");
  const report = await check("review"); const quality = await check("review", "quality", "fail");
  const submitted = await finish("review", [report.id, quality.id]);
  await change("unit accept", "review", { submission: submitted.id, reason: "Report meets the request" }, boss);
  await add("downstream");
  await change("dependency add", "downstream", { on: "review", reason: "Quality must pass", checks: [{ condition: "quality", verdict: "pass" }] }, boss);
  await expect(change("unit start", "downstream")).rejects.toMatchObject({ code: "DEPENDENCY_UNMET" });
});

test("ordinary ack cannot consume a completion message and a child cannot accept its own work", async () => {
  await add("child"); await change("unit start", "child"); const c = await check("child"); const sub = await finish("child", [c.id]);
  const messages = (await execute(store, { command: "inbox list" })).data as { id: string }[];
  await expect(execute(store, { command: "inbox ack", id: messages[0]!.id, ...boss, operationId: "ack", input: { reason: "Read" } })).rejects.toMatchObject({ code: "DECISION_REQUIRED" });
  await expect(change("unit accept", "child", { submission: sub.id, reason: "My own work" })).rejects.toMatchObject({ code: "NOT_OWNER" });
  expect((await execute(store, { command: "inbox list" })).data).toHaveLength(1);
});

test("handoff proofs and affected units are retained in the audit history", async () => {
  await add("root", { owner: boss }); await add("second", { owner: boss });
  const next = { actor: boss.actor, session: "parent-2" };
  await change("unit assign", "root", { coordinator: next, handoff: { previousSession: boss.session, stoppedRef: "handoff.md", authorityRef: "handoff.md" }, reason: "Resume delegated work" }, next);
  const history = (await execute(store, { command: "unit get", id: "second", input: { history: true } })).data as { operations: State["operations"] };
  const operation = history.operations.find(o => o.command === "unit assign");
  expect(operation).toMatchObject({ request: { input: { handoff: { previousSession: boss.session, stoppedRef: "handoff.md", authorityRef: "handoff.md" } } }, affectedUnits: ["root", "second"], evidence: [{ ref: "handoff.md", digest: expect.any(String) }] });
});

test("checks cannot be recorded before the attempt has frozen its inputs", async () => {
  await add("early"); await change("unit set", "early", { state: "waiting", reason: "Not started" });
  await expect(check("early")).rejects.toMatchObject({ code: "START_REQUIRED" });
});

test("changed dependencies invalidate current check display and prevent new checks until reopen", async () => {
  await add("a"); await accepted("a"); await add("b");
  await change("dependency add", "b", { on: "a", reason: "Accepted input" }, boss);
  await change("unit start", "b"); const previous = await check("b");
  await change("unit reopen", "a", { reason: "New input" }); await accepted("a");
  expect((await execute(store, { command: "ledger check", id: "b" })).data).toMatchObject({ conditions: [{ verdict: "unknown", recordedVerdict: "pass", stale: true }, { verdict: "unknown" }] });
  await expect(check("b", "report", "pass", { supersedes: previous.id })).rejects.toMatchObject({ code: "INPUTS_CHANGED" });
});

test("parent integration requires accepted children and becomes stale when a child reopens", async () => {
  await add("parent", { owner: boss }); await add("child", { parent: "parent" });
  await change("unit start", "parent", {}, boss);
  const parentCheck = (await change("ledger record", "parent", { condition: "report", verdict: "pass", target: { id: "report", kind: "files", files: ["output.md"] }, evidence: ["proof.md"], method: "integration", environment: "local", observedAt: new Date().toISOString() }, boss)).data as Check;
  await change("unit stage", "parent", { selection: "integrate", reason: "Combine child result", state: "completed" }, boss, { stage: "review" });
  const submission = { checks: [parentCheck.id], report: "Integrated", refs: ["proof.md"] };
  await expect(change("unit submit", "parent", submission, boss)).rejects.toMatchObject({ code: "DEPENDENCY_UNMET" });
  await accepted("child");
  const parentSubmission = (await change("unit submit", "parent", submission, boss)).data as Submission;
  await change("unit accept", "parent", { submission: parentSubmission.id, reason: "Final delivery checked" }, boss);
  await change("unit reopen", "child", { reason: "Correct findings" });
  const status = (await execute(store, { command: "status" })).data as { units: { id: string; acceptance: string; acceptanceValid: boolean }[] };
  expect(status.units.find(u => u.id === "parent")).toMatchObject({ acceptance: "accepted", acceptanceValid: false });
});

test("one submission cannot mix different versions of the same external target", async () => {
  await add("mixed"); await change("unit start", "mixed");
  const first = await check("mixed", "report", "pass", { target: { id: "report", kind: "external", ref: "release", version: "v1" } });
  const second = await check("mixed", "quality", "pass", { target: { id: "report", kind: "external", ref: "release", version: "v2" } });
  await expect(finish("mixed", [first.id, second.id])).rejects.toMatchObject({ code: "TARGET_VERSION_CONFLICT" });
});

test("unit inspection and doctor expose evidence that changed after acceptance", async () => {
  await add("inspect"); await accepted("inspect");
  await rm(join(project, "proof.md"));
  expect((await execute(store, { command: "unit get", id: "inspect" })).data).toMatchObject({ status: { acceptance: "accepted", acceptanceValid: false, conditions: [{ recordedVerdict: "pass", verdict: "unknown", stale: true }, { verdict: "unknown" }] } });
  expect((await execute(store, { command: "doctor" })).data).toMatchObject({ problems: expect.arrayContaining([expect.stringContaining("inspect: target or evidence changed/missing")]) });
});
