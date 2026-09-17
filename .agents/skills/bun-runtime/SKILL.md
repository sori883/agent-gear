---
name: bun-runtime
description: Bun as runtime, package manager, bundler, and test runner. When to choose Bun vs Node, migration notes, and Vercel support.
license: MIT
metadata:
  source: https://github.com/affaan-m/ecc
  upstream-ref: 8321021c54d670126ce3b2969d5deb880b4b0c2a
---

# Bun Runtime

Bun is a fast all-in-one JavaScript runtime and toolkit: runtime, package manager, bundler, and test runner.

## When to Use

- **Prefer Bun** for: new JS/TS projects, scripts where install/run speed matters, Vercel deployments with Bun runtime, and when you want a single toolchain (run + install + test + build).
- **Prefer Node** for: maximum ecosystem compatibility, legacy tooling that assumes Node, or when a dependency has known Bun issues.

Use when: adopting Bun, migrating from Node, writing or debugging Bun scripts/tests, or configuring Bun on Vercel or other platforms.

## Project Workflow

Read the repository instructions, `package.json`, lockfile, `tsconfig.json`, and `bunfig.toml` when present. Check `bun --version` and follow the version pinned by the project. Adopting Bun or migrating a package manager must be part of the task; an existing Node project does not need migration merely because this skill is available.

Prefer existing scripts for development, type checking, tests, and builds. Keep lockfile changes scoped to intended dependency changes; use `bun install --frozen-lockfile` in CI. Check dependency and test-runner compatibility during migrations, rather than assuming every Node or Jest API behaves identically.

## TypeScript Checks

Bun executes TypeScript by transpiling it; `bun run`, `bun test`, and `bun build` do not replace the TypeScript compiler's type checking. Run the project's separate typecheck command alongside affected tests.

For a new Bun TypeScript project, install `typescript` and `@types/bun` as development dependencies if absent. A typical script is `"typecheck": "tsc --noEmit"`, invoked with `bun run typecheck`. Use the project's existing compiler configuration; for a new Bun runtime project, consult the [official TypeScript configuration](https://bun.com/docs/typescript), including `types: ["bun"]` when needed. Do not apply Bun-specific configuration to a package targeting another runtime.

For a one-shot test run use `bun test`; use watch mode only during interactive development. Choose a build target explicitly: `--target=bun` for Bun applications, `--target=node` for Node applications, or `--target=browser` for browser assets.

## How It Works

- **Runtime**: JavaScriptCore-based runtime with Node.js compatibility. Check the [compatibility documentation](https://bun.com/docs/runtime/nodejs-apis) for the APIs used by the project.
- **Package manager**: `bun install` is significantly faster than npm/yarn. Lockfile is `bun.lock` (text) by default in current Bun; older versions used `bun.lockb` (binary).
- **Bundler**: Built-in bundler and transpiler for apps and libraries.
- **Test runner**: Built-in `bun test` with Jest-like API.

**Migration from Node**: Replace `node script.js` with `bun run script.js` or `bun script.js`. Run `bun install` in place of `npm install`; most packages work. Use `bun run` for npm scripts; `bun x` for npx-style one-off runs. Node built-ins are supported; prefer Bun APIs where they exist for better performance.

**Deployment**: Use the project's build script and verify the provider's current Bun support. For a standalone Bun application, an example build is `bun build ./src/index.ts --target=bun --outdir=dist`. Use `bun install --frozen-lockfile` for reproducible installs.

## Examples

### Run and install

```bash
# Install dependencies (creates/updates bun.lock or bun.lockb)
bun install

# Run a script or file
bun run dev
bun run src/index.ts
bun src/index.ts
```

### Scripts and env

```bash
bun run --env-file=.env dev
FOO=bar bun run script.ts
```

### Testing

```bash
bun test
bun test --watch
```

```typescript
// test/example.test.ts
import { expect, test } from "bun:test";

test("add", () => {
  expect(1 + 2).toBe(3);
});
```

### Runtime API

```typescript
const file = Bun.file("package.json");
const json = await file.json();

Bun.serve({
  port: 3000,
  fetch(req) {
    return new Response("Hello");
  },
});
```

## Best Practices

- Commit the lockfile (`bun.lock` or `bun.lockb`) for reproducible installs.
- Prefer `bun run` for scripts. For TypeScript, Bun runs `.ts` natively.
- Keep dependencies up to date; Bun and the ecosystem evolve quickly.
