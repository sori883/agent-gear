import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, tmpdir, totalmem } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Request, State, Unit } from "../skills/orch/scripts/lib/model.ts";

// Repository-only experiment: every state change goes through the real CLI.
// The generated fixtures and stores are separate from actual task bookkeeping.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = join(repository, "skills/orch/scripts");
const { values } = parseArgs({ args: Bun.argv.slice(2), strict: true, options: {
  sizes: { type: "string", default: "10,100,300" },
  samples: { type: "string", default: "5" },
  out: { type: "string" },
  "keep-temp": { type: "boolean", default: false },
  help: { type: "boolean" },
} });
if (values.help) {
  console.log("bun scripts/bench-orch.ts [--sizes 10,100,300] [--samples 5] [--out result.json] [--keep-temp]\nSizes count child units, excluding the one root. Runs actual CLI processes; keeps all history. Output contains individual timings, hashes, counts, and concurrency assertions.");
  process.exit(0);
}
const sizes = values.sizes.split(",").map(Number);
const sampleCount = Number(values.samples);
if (!sizes.length || sizes.some((n, i) => !Number.isSafeInteger(n) || n < 1 || n > 10000 || (i > 0 && n <= sizes[i - 1]!)) || !Number.isSafeInteger(sampleCount) || sampleCount < 1 || sampleCount > 100) {
  throw new Error("sizes must be increasing integers between 1 and 10000; samples must be between 1 and 100");
}
const actor = { actor: "bench-coordinator", session: "bench-session-1" };
const project = await mkdtemp(join(tmpdir(), "orch-benchmark-"));
const store = join(project, "store");
const runtime = join(project, "runtime");
const cli = join(runtime, "task.ts");
const startedAt = new Date().toISOString();
const started = performance.now();
let sequence = 0;
let cliCalls = 0;
let lockRetries = 0;
const cache = new Map<string, Unit>();

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function sha256(text: string | Uint8Array) { return createHash("sha256").update(text).digest("hex"); }
async function sourceHashes(path: string, prefix = ""): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === "node_modules") continue;
    const relative = join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(hashes, await sourceHashes(join(path, entry.name), relative));
    else if (entry.isFile()) hashes[relative] = sha256(await readFile(join(path, entry.name)));
  }
  return hashes;
}
const hashesBefore = await sourceHashes(sourceDirectory);
await cp(sourceDirectory, runtime, { recursive: true, filter: source => !source.split(sep).includes("node_modules") });
assert(JSON.stringify(hashesBefore) === JSON.stringify(await sourceHashes(runtime)), "Sources changed while copying the CLI; rerun the benchmark");

type Response = { ok: boolean; revision: number; data: any; replayed?: boolean; error?: { code: string; message: string } };
type CallResult = { response: Response; ms: number; tries: number };
function request(command: string, id?: string, input: Record<string, unknown> = {}, stage?: string): Request {
  const u = id ? cache.get(id) : undefined;
  return { command, id, input, stage, ...actor, operationId: `bench-${++sequence}`, ifVersion: u?.version, attempt: u?.currentAttempt };
}
async function call(r: Request, retries = 8): Promise<CallResult> {
  const args = [process.execPath, cli, "--json", "--store", store, "--input", "-"];
  for (const [flag, field] of [["actor", r.actor], ["session", r.session], ["operation-id", r.operationId], ["if-version", r.ifVersion], ["attempt", r.attempt]] as const) {
    if (field !== undefined) args.push(`--${flag}`, String(field));
  }
  args.push(...r.command.split(" "));
  if (r.id) args.push(r.id);
  if (r.stage) args.push(r.stage);
  const begin = performance.now();
  for (let tries = 1; tries <= retries + 1; tries++) {
    cliCalls++;
    const child = Bun.spawn(args, { cwd: project, stdin: new Blob([JSON.stringify(r.input ?? {})]), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new globalThis.Response(child.stdout).text(), new globalThis.Response(child.stderr).text(), child.exited]);
    let response: Response;
    try { response = JSON.parse(stdout); } catch { throw new Error(`CLI returned invalid JSON (${code}): ${stdout}\n${stderr}`); }
    if (!response.ok && response.error?.code === "LOCKED" && tries <= retries) {
      lockRetries++;
      await Bun.sleep(Math.min(10 * (2 ** (tries - 1)), 250));
      continue; // The exact request and operation ID are retained.
    }
    assert(code === 0 && response.ok, `${r.command} ${r.id ?? ""} failed (${code}): ${JSON.stringify(response.error)} ${stderr}`);
    return { response, ms: performance.now() - begin, tries };
  }
  throw new Error("Unreachable retry exit");
}
async function mutate(r: Request): Promise<CallResult> {
  const result = await call(r);
  const data = result.response.data;
  if (data?.attempts && typeof data.version === "number") cache.set(data.id, structuredClone(data));
  else if (r.id && ["ledger record", "unit submit", "unit accept", "unit return"].includes(r.command)) cache.get(r.id)!.version++;
  return result;
}
const condition = { id: "delivery", description: "Observed result and limitations are reported", purpose: "delivery", required: true, allowed: ["pass"], target: "report" };
const stages = { review: { selection: "execute", reason: "Review of generated benchmark fixture" } };
async function add(id: string, root = false) {
  await mutate(request("unit add", id, {
    ...(root ? {} : { parent: "root" }), size: "small", purpose: `Benchmark fixture ${id}`, owner: actor,
    scope: [`output-${id}.md`], conditions: [condition], stages,
  }));
}
async function complete(id: string) {
  await mutate(request("unit stage", id, { selection: "execute", reason: "Synthetic review complete", state: "completed" }, "review"));
  const check = await mutate(request("ledger record", id, {
    condition: "delivery", verdict: "pass", target: { id: "report", kind: "files", files: [`output-${id}.md`] },
    evidence: [`proof-${id}.md`], method: "Read generated output fixture", environment: `${platform()} ${arch()} local filesystem`, observedAt: new Date().toISOString(),
  }));
  const sub = await mutate(request("unit submit", id, { checks: [check.response.data.id], report: `Fixture ${id} was reviewed; this is synthetic benchmark work.`, refs: [`proof-${id}.md`] }));
  await mutate(request("unit accept", id, { submission: sub.response.data.id, reason: "Synthetic delivery condition met" }));
}
async function seed(index: number) {
  const id = `u-${String(index).padStart(5, "0")}`;
  await writeFile(join(project, `output-${id}.md`), `# Output ${index}\n\n${"Result detail. ".repeat(80)}\n`);
  await writeFile(join(project, `proof-${id}.md`), `# Proof ${index}\n\nGenerated fixture was checked.\n`);
  await add(id);
  await mutate(request("unit start", id));
  if (index % 5 === 0) {
    await complete(id);
    if (index % 10 === 0) {
      await mutate(request("unit reopen", id, { reason: "Synthetic second attempt to retain actual historical records" }));
      await mutate(request("unit start", id));
      await complete(id);
    }
  } else if (index % 5 === 1) {
    await mutate(request("unit set", id, { state: "paused", reason: "Synthetic interruption", next: "Resume after external input is available" }));
  } else if (index % 5 === 2) {
    await mutate(request("inbox push", id, { kind: "report", body: "Fixture review is in progress", refs: [`output-${id}.md`] }));
  }
}
function measurements(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return { samplesMs: samples, minMs: sorted[0]!, medianMs, p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1]!, maxMs: sorted.at(-1)! };
}
async function byteCount(path: string): Promise<number> {
  let bytes = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    bytes += entry.isDirectory() ? await byteCount(join(path, entry.name)) : (await stat(join(path, entry.name))).size;
  }
  return bytes;
}
async function snapshot() {
  const text = await readFile(join(store, "state.json"), "utf8");
  const state = JSON.parse(text) as State;
  return { state, digest: sha256(text), bytes: Buffer.byteLength(text) };
}

try {
  const initialized = await mutate(request("init", undefined, { project }));
  await add("root", true);
  await mutate(request("unit start", "root"));
  const results: unknown[] = [];
  let seeded = 0;
  for (const size of sizes) {
    const seedStarted = performance.now();
    while (seeded < size) { await seed(++seeded); if (seeded % 25 === 0) process.stderr.write(`seeded ${seeded}/${sizes.at(-1)} child units\n`); }
    const setupMs = performance.now() - seedStarted;
    const before = await snapshot();
    const times: Record<string, number[]> = { status: [], ready: [], update: [], export: [] };
    for (let i = 0; i < sampleCount; i++) {
      times.status!.push((await call({ command: "status", input: {} })).ms);
      times.ready!.push((await call({ command: "unit ready", input: {} })).ms);
    }
    assert((await snapshot()).digest === before.digest, "Read commands changed state.json");
    for (let i = 0; i < sampleCount; i++) {
      times.update!.push((await mutate(request("unit stage", "root", { selection: "execute", reason: `Integration progress sample ${size}/${i}`, state: "running" }, "review"))).ms);
      times.export!.push((await call({ command: "export", ...actor, input: {} })).ms);
    }
    const after = await snapshot();
    const counts: Record<string, number> = {};
    for (const u of after.state.units) { const name = u.attempts.find(a => a.number === u.currentAttempt)!.state; counts[name] = (counts[name] ?? 0) + 1; }
    const result = {
      requestedChildUnits: size, totalUnits: after.state.units.length, states: counts,
      attempts: after.state.units.reduce((n, u) => n + u.attempts.length, 0), checks: after.state.checks.length,
      submissions: after.state.submissions.length, operations: after.state.operations.length, messages: after.state.messages.length,
      revision: after.state.revision, stateBytes: after.bytes, storeBytes: await byteCount(store), stateSha256: after.digest,
      incrementalSeedingMs: setupMs, timings: Object.fromEntries(Object.entries(times).map(([name, ms]) => [name, measurements(ms)])),
    };
    results.push(result);
    process.stderr.write(`measured ${size} child units: ${after.bytes} bytes; status median ${measurements(times.status!).medianMs.toFixed(1)} ms\n`);
  }
  // Distinct processes start at once and write different operation IDs to one unit.
  // inbox push does not advance the unit version, so lock retries keep the exact request.
  const concurrentRequests = Array.from({ length: 6 }, (_, i) => request("inbox push", "root", { kind: "report", body: `Concurrent report ${i}` }));
  const parallelBefore = await snapshot();
  const parallelStarted = performance.now();
  const parallel = await Promise.all(concurrentRequests.map(r => call(r)));
  const parallelMs = performance.now() - parallelStarted;
  const parallelAfter = await snapshot();
  for (const r of concurrentRequests) {
    assert(parallelAfter.state.operations.filter(op => op.id === r.operationId).length === 1, `Operation was lost or duplicated: ${r.operationId}`);
    assert(parallelAfter.state.messages.filter(m => m.body === r.input!.body).length === 1, `Message was lost or duplicated: ${r.operationId}`);
  }
  assert(parallelAfter.state.revision === parallelBefore.state.revision + concurrentRequests.length, "Unexpected concurrent revision count");
  const replay = await call(concurrentRequests[0]!);
  assert(replay.response.replayed === true, "Exact retry did not replay");
  assert((await snapshot()).digest === parallelAfter.digest, "Idempotent retry changed the persisted state");
  const doctor = await call({ command: "doctor", input: {} });
  assert(doctor.response.data.problems.length === 0 && doctor.response.data.lock === null, "Final doctor found a problem");
  const hashesAfter = await sourceHashes(dirname(cli));
  assert(JSON.stringify(hashesBefore) === JSON.stringify(hashesAfter), "CLI sources changed during the benchmark; rerun before comparing results");
  const result = {
    schemaVersion: 1, startedAt, finishedAt: new Date().toISOString(), elapsedMs: performance.now() - started,
    environment: { bun: Bun.version, platform: platform(), release: release(), arch: arch(), cpuModel: cpus()[0]?.model, logicalCpus: cpus().length, totalMemoryBytes: totalmem() },
    command: { sizes, sampleCount, keepTemp: values["keep-temp"] }, cliSources: hashesBefore,
    methodology: "CLI scripts are copied without node_modules to isolate the measured source version. Each command is a fresh Bun process invoking the copied task.ts. State was built only through CLI mutations; timings include process startup and parsing. Filesystem caches are not flushed. 20% of children completed; half of those have two attempts. 20% paused, 60% running; one running root is included. No dependency edges or network references. Export is newly generated at each sampled revision.",
    initializedMs: initialized.ms, results,
    concurrency: { processes: parallel.length, wallMs: parallelMs, calls: parallel.map(p => ({ ms: p.ms, tries: p.tries })), revisionBefore: parallelBefore.state.revision, revisionAfter: parallelAfter.state.revision, allOperationsPresentExactlyOnce: true, allMessagesPresentExactlyOnce: true, exactRetryReplayedWithoutStateChange: true },
    final: { revision: parallelAfter.state.revision, stateBytes: parallelAfter.bytes, stateSha256: parallelAfter.digest, cliCalls, lockRetries, doctorProblems: doctor.response.data.problems, doctorMs: doctor.ms },
    temporaryProject: values["keep-temp"] ? project : null,
  };
  const serialized = JSON.stringify(result, null, 2) + "\n";
  if (values.out) { const path = resolve(values.out); await mkdir(dirname(path), { recursive: true }); await writeFile(path, serialized); }
  process.stdout.write(serialized);
  if (!values["keep-temp"]) await rm(project, { recursive: true, force: true });
} catch (error) {
  process.stderr.write(`Benchmark failed; generated fixtures retained for diagnosis: ${project}\n`);
  throw error;
}
