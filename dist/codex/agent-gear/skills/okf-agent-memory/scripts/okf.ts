#!/usr/bin/env bun
import { bootstrap } from "./bootstrap.ts";

export async function main(args: string[]): Promise<number> {
  try {
    if (await bootstrap()) {
      const child = Bun.spawn([process.execPath, "--no-install", import.meta.path, ...args], { cwd: process.cwd(), stdin: "inherit", stdout: "inherit", stderr: "inherit" });
      return await child.exited;
    }
    const cli = await import("./lib/cli.ts");
    return await cli.main(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.includes("--json")) process.stdout.write(JSON.stringify({ status: "error", error: message }) + "\n");
    else process.stderr.write(`Error: ${message}\n`);
    return 1;
  }
}
if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
