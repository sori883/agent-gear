import { beforeEach, afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execute } from "../scripts/lib/engine.ts";
import { load, writeTransaction } from "../scripts/lib/store.ts";
import type { Unit } from "../scripts/lib/model.ts";

let project: string, store: string;
const actor = { actor: "parent", session: "one" };
const spec = { purpose: "Inspect one artifact", size: "small", owner: actor, scope: ["artifact.md"], conditions: [{ id: "done", description: "Inspection delivered", purpose: "delivery", required: true, target: "artifact" }], stages: { review: { selection: "execute", reason: "Review request" } } };
beforeEach(async () => { project = await mkdtemp(join(tmpdir(), "orch-storage-")); store = join(project, "store"); await execute(store, { command: "init", ...actor, operationId: "init", input: { project } }); });
afterEach(async () => { await rm(project, { recursive: true, force: true }); });

test("a failed save keeps the old state and releases the lock", async () => {
  const before = await readFile(join(store, "state.json"), "utf8");
  await expect(writeTransaction(store, async () => { const state = await load(store); state.revision++; return { state, result: null }; }, { beforeReplace: async () => { throw new Error("disk failure"); } })).rejects.toThrow("disk failure");
  expect(await readFile(join(store, "state.json"), "utf8")).toBe(before);
  expect(await Bun.file(join(store, ".orch.lock")).exists()).toBe(false);
});

test("concurrent independent writes conflict or succeed without losing either unit", async () => {
  const requests = ["a", "b"].map(id => ({ command: "unit add", id, ...actor, operationId: `add-${id}`, input: spec }));
  const results = await Promise.allSettled(requests.map(r => execute(store, r)));
  for (let i = 0; i < results.length; i++) if (results[i]!.status === "rejected") { expect((results[i] as PromiseRejectedResult).reason.code).toBe("LOCKED"); await execute(store, requests[i]!); }
  expect((await load(store)).units.map(u => u.id).sort()).toEqual(["a", "b"]);
});

test("a stale update cannot overwrite a newer progress change", async () => {
  const added = (await execute(store, { command: "unit add", id: "a", ...actor, operationId: "add", input: spec })).data as Unit;
  await execute(store, { command: "unit start", id: "a", ...actor, operationId: "start", ifVersion: added.version, attempt: 1 });
  await expect(execute(store, { command: "unit set", id: "a", ...actor, operationId: "stale", ifVersion: added.version, attempt: 1, input: { state: "cancelled", reason: "Outdated view" } })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  expect((await load(store)).units[0]!.attempts[0]!.state).toBe("running");
});

test("a lock is reported and never stolen by an update", async () => {
  const content = JSON.stringify({ pid: process.pid, token: "owner", createdAt: new Date().toISOString() });
  await writeFile(join(store, ".orch.lock"), content);
  await expect(execute(store, { command: "unit add", id: "a", ...actor, operationId: "add", input: spec })).rejects.toMatchObject({ code: "LOCKED" });
  expect((await execute(store, { command: "doctor" })).data).toMatchObject({ lock: { token: "owner" } });
  expect(await readFile(join(store, ".orch.lock"), "utf8")).toBe(content);
});

test("malformed or future stores are not overwritten even by init", async () => {
  for (const text of ["{broken", JSON.stringify({ schemaVersion: 999 })]) {
    await writeFile(join(store, "state.json"), text);
    await expect(execute(store, { command: "init", ...actor, operationId: "reinit", input: { project } })).rejects.toBeDefined();
    expect(await readFile(join(store, "state.json"), "utf8")).toBe(text);
  }
});

test("exports share a revision; status is read-only and repeated export is idempotent", async () => {
  await execute(store, { command: "unit add", id: "a", ...actor, operationId: "add", input: spec });
  const before = await readFile(join(store, "state.json"), "utf8");
  await execute(store, { command: "status" }); expect(await readFile(join(store, "state.json"), "utf8")).toBe(before);
  const first = await execute(store, { command: "export", ...actor }); const second = await execute(store, { command: "export", ...actor }); expect(second).toEqual(first);
  const directory = (first.data as { directory: string }).directory;
  expect(await readFile(join(directory, "units.tsv"), "utf8")).toContain(`\n${first.revision}\t`);
  expect(await readFile(join(directory, "status.md"), "utf8")).toContain(`revision: ${first.revision}`);
  expect(await readFile(join(store, "state.json"), "utf8")).toBe(before);
});

test("killing a writer before commit preserves the readable state and leaves a diagnosable lock", async () => {
  const before = await readFile(join(store, "state.json"), "utf8");
  const modulePath = resolve(import.meta.dir, "../scripts/lib/store.ts");
  const code = `import { load, writeTransaction } from ${JSON.stringify(modulePath)};
    await writeTransaction(${JSON.stringify(store)}, async () => {
      const state = await load(${JSON.stringify(store)}); state.revision++;
      return { state, result: null };
    }, { beforeReplace: async () => { console.log("ready"); await new Promise(() => {}); } });`;
  const child = Bun.spawn([process.execPath, "-e", code], { stdout: "pipe", stderr: "pipe" });
  try {
    const reader = child.stdout.getReader(); const output = await reader.read(); reader.releaseLock();
    expect(new TextDecoder().decode(output.value)).toContain("ready");
    child.kill("SIGKILL"); await child.exited;
    expect(await readFile(join(store, "state.json"), "utf8")).toBe(before);
    expect((await execute(store, { command: "doctor" })).data).toMatchObject({ lock: { pid: child.pid } });
    await expect(execute(store, { command: "unit add", id: "recovered", ...actor, operationId: "recover", input: spec })).rejects.toMatchObject({ code: "LOCKED" });
    await rm(join(store, ".orch.lock"));
    await execute(store, { command: "unit add", id: "recovered", ...actor, operationId: "recover", input: spec });
    expect((await load(store)).units[0]!.id).toBe("recovered");
  } finally { child.kill(); await child.exited; }
});
