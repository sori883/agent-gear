#!/usr/bin/env bun
import { bootstrap } from "./bootstrap.ts";

try {
  if (await bootstrap()) {
    const child = Bun.spawn([process.execPath, "--no-install", ...process.argv.slice(1)], { cwd: process.cwd(), stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    process.exit(await child.exited);
  }
  const { main } = await import("./lib/cli.ts");
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  const result = { ok: false, error: { code: "BOOTSTRAP_FAILED", message: error instanceof Error ? error.message : String(error) } };
  if (process.argv.includes("--json")) process.stdout.write(JSON.stringify(result) + "\n"); else process.stderr.write(result.error.message + "\n");
  process.exitCode = 1;
}
