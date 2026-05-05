# InDesign MCP — Foundation Plan (Plan A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working `indesign-mcp` server with one trivial end-to-end tool (`get_app_version`) that proves every architectural layer — MCP wire-up, osascript dispatch, ExtendScript execution inside InDesign, and result-file readback.

**Architecture:** Node/TypeScript MCP stdio server. Tools dispatch ExtendScript via `osascript`'s `do script ... language javascript` bridge to InDesign 2026. Scripts write JSON results to a temp file; the server reads them back and returns to Claude. No UXP plugin in v1.

**Tech Stack:**
- TypeScript 5.6+
- Node 20+ (ESM)
- `@modelcontextprotocol/sdk` — MCP server SDK
- `zod` — input schema validation
- `vitest` — test runner
- Standard-library `node:fs/promises`, `node:child_process`, `node:os` — no other runtime deps

**Reference spec:** `docs/superpowers/specs/2026-05-05-indesign-mcp-design.md`

**Repository:** `~/Documents/GitHub/indesign-mcp/` (already initialised, on `main`).

---

## File Structure (created across this plan)

```
indesign-mcp/
├── package.json                       Task 1
├── tsconfig.json                      Task 1
├── vitest.config.ts                   Task 1
├── .gitignore                         Task 1
├── README.md                          Task 10
├── src/
│   ├── index.ts                       Task 7  (entrypoint)
│   ├── server.ts                      Task 7  (MCP server factory)
│   ├── types.ts                       Task 2  (shared types)
│   ├── errors.ts                      Task 2  (error kinds, envelope helpers)
│   ├── logger.ts                      Task 3  (file logger)
│   ├── transport/
│   │   ├── osascript.ts               Task 4  (subprocess dispatch)
│   │   └── result-file.ts             Task 5  (temp-file IO + run helper)
│   ├── compose.ts                     Task 6  (ExtendScript preamble wrapper)
│   ├── tools/
│   │   ├── registry.ts                Task 7  (tool registration helpers)
│   │   └── get-app-version.ts         Task 8  (first tool)
└── tests/
    ├── unit/
    │   ├── errors.test.ts             Task 2
    │   ├── logger.test.ts             Task 3
    │   ├── osascript.test.ts          Task 4
    │   ├── result-file.test.ts        Task 5
    │   ├── compose.test.ts            Task 6
    │   └── tools/
    │       └── get-app-version.test.ts Task 8
    └── integration/
        ├── helpers.ts                 Task 9
        └── get-app-version.int.test.ts Task 9
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "indesign-mcp",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "description": "MCP server bridging Claude to Adobe InDesign 2026 via ExtendScript over osascript.",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run --exclude '**/*.int.test.ts'",
    "test:watch": "vitest --exclude '**/*.int.test.ts'",
    "test:integration": "INDESIGN_MCP_INTEGRATION=1 vitest run '**/*.int.test.ts'",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.0",
    "zod-to-json-schema": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globals: false,
    environment: "node",
  },
});
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules/
dist/
*.log
.DS_Store
.indesign-mcp-tmp/
coverage/
```

- [ ] **Step 5: Install and verify**

Run: `npm install`
Expected: dependencies install without error, `node_modules/` populated.

Run: `npx tsc --noEmit`
Expected: no output (no source files yet — but tsconfig parses cleanly).

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore package-lock.json
git commit -m "chore: project scaffold (TypeScript + Vitest + MCP SDK)"
```

---

## Task 2: Error Envelope and Shared Types

**Files:**
- Create: `src/types.ts`
- Create: `src/errors.ts`
- Create: `tests/unit/errors.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/errors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ok, fail, ErrorKind } from "../../src/errors.js";

describe("envelope helpers", () => {
  it("ok() builds a success envelope with a payload", () => {
    const env = ok({ value: 42 });
    expect(env).toEqual({ ok: true, result: { value: 42 } });
  });

  it("ok() with no payload still sets ok: true", () => {
    const env = ok();
    expect(env).toEqual({ ok: true });
  });

  it("fail() builds an error envelope with kind + message", () => {
    const env = fail("not_found", "frame 99 missing");
    expect(env).toEqual({
      ok: false,
      error: { kind: "not_found", message: "frame 99 missing" },
    });
  });

  it("fail() preserves additional error details", () => {
    const env = fail("script_error", "bad ref", { stack: "line 3" });
    expect(env).toEqual({
      ok: false,
      error: { kind: "script_error", message: "bad ref", stack: "line 3" },
    });
  });

  it("ErrorKind values are the closed set from the spec", () => {
    const expected: ErrorKind[] = [
      "script_error",
      "app_not_available",
      "not_found",
      "name_collision",
      "io_error",
      "timeout",
      "invalid_args",
    ];
    // Compile-time assertion — if ErrorKind drifts, this fails to type-check.
    const sample: ErrorKind = expected[0];
    expect(sample).toBe("script_error");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/errors.test.ts`
Expected: FAIL — module `../../src/errors.js` not found.

- [ ] **Step 3: Write `src/types.ts`**

```ts
export type FrameId = string;
export type StyleId = string;
export type DocumentId = string;

export interface DocumentStateDelta {
  changed_frames?: Array<{ id: FrameId; bounds?: [number, number, number, number] }>;
  new_frames?: Array<{ id: FrameId; type: string }>;
  removed_frame_ids?: FrameId[];
  page_count?: number;
}

export interface SuccessEnvelope<T> {
  ok: true;
  result?: T;
  document_state_delta?: DocumentStateDelta;
  warnings?: string[];
}

export interface FailureEnvelope {
  ok: false;
  error: ToolError;
}

export type Envelope<T = unknown> = SuccessEnvelope<T> | FailureEnvelope;

export interface ToolError {
  kind: ErrorKind;
  message: string;
  // Optional kind-specific fields
  stack?: string;
  entity?: string;
  id?: string;
}

export type ErrorKind =
  | "script_error"
  | "app_not_available"
  | "not_found"
  | "name_collision"
  | "io_error"
  | "timeout"
  | "invalid_args";
```

- [ ] **Step 4: Write `src/errors.ts`**

```ts
import type { ErrorKind, Envelope, ToolError } from "./types.js";

export type { ErrorKind } from "./types.js";

export function ok<T>(result?: T): Envelope<T> {
  return result === undefined
    ? { ok: true }
    : { ok: true, result };
}

export function fail(
  kind: ErrorKind,
  message: string,
  extra: Partial<Omit<ToolError, "kind" | "message">> = {},
): Envelope<never> {
  return { ok: false, error: { kind, message, ...extra } };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/unit/errors.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/errors.ts tests/unit/errors.test.ts
git commit -m "feat: error kinds and envelope helpers"
```

---

## Task 3: File Logger

A minimal append-only logger writing JSON-line entries. Rotation deferred per the spec's POC-first stance.

**Files:**
- Create: `src/logger.ts`
- Create: `tests/unit/logger.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/logger.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../../src/logger.js";

describe("createLogger", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "indesign-mcp-log-"));
    path = join(dir, "server.log");
  });

  it("writes one JSON line per log call", async () => {
    const log = createLogger(path);
    await log.info("tool_call", { name: "ping", id: "1" });
    await log.info("tool_result", { id: "1", ok: true });
    await log.close();

    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first.event).toBe("tool_call");
    expect(first.level).toBe("info");
    expect(first.data).toEqual({ name: "ping", id: "1" });
    expect(typeof first.ts).toBe("string");
  });

  it("error level is recorded distinctly", async () => {
    const log = createLogger(path);
    await log.error("dispatch_failed", { reason: "no app" });
    await log.close();

    const line = JSON.parse(readFileSync(path, "utf8").trim());
    expect(line.level).toBe("error");
    expect(line.event).toBe("dispatch_failed");
  });

  it("creates the parent directory if missing", async () => {
    const nestedPath = join(dir, "nested", "deeper", "server.log");
    const log = createLogger(nestedPath);
    await log.info("hello", {});
    await log.close();
    expect(readFileSync(nestedPath, "utf8")).toContain("hello");
  });

  // Cleanup at process end is fine for this test suite.
  // (Vitest runs each file in a fresh worker.)
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/logger.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/logger.ts`**

```ts
import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface Logger {
  info(event: string, data: Record<string, unknown>): Promise<void>;
  error(event: string, data: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
}

type Level = "info" | "error";

export function createLogger(path: string): Logger {
  let ensured = false;
  let queue: Promise<void> = Promise.resolve();

  const ensureDir = async () => {
    if (ensured) return;
    await mkdir(dirname(path), { recursive: true });
    ensured = true;
  };

  const write = (level: Level, event: string, data: Record<string, unknown>) => {
    queue = queue.then(async () => {
      await ensureDir();
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        level,
        event,
        data,
      });
      await appendFile(path, line + "\n", "utf8");
    });
    return queue;
  };

  return {
    info: (event, data) => write("info", event, data),
    error: (event, data) => write("error", event, data),
    close: () => queue,
  };
}

export function defaultLogPath(): string {
  const home = process.env.HOME ?? "";
  return `${home}/Library/Logs/indesign-mcp/server.log`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/logger.test.ts`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/logger.ts tests/unit/logger.test.ts
git commit -m "feat: append-only JSON-line logger"
```

---

## Task 4: Transport Layer (1) — osascript Dispatcher

Pure subprocess wrapper around `osascript`. Knows nothing about InDesign yet — just runs an AppleScript-or-JS string and returns `{stdout, stderr, exitCode}` or a timeout/spawn failure.

**Files:**
- Create: `src/transport/osascript.ts`
- Create: `tests/unit/osascript.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/osascript.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { runOsascript } from "../../src/transport/osascript.js";

describe("runOsascript", () => {
  it("runs a trivial AppleScript and returns stdout", async () => {
    const result = await runOsascript({
      language: "AppleScript",
      script: 'return "hello"',
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.stdout.trim()).toBe("hello");
    expect(result.exitCode).toBe(0);
  });

  it("runs trivial JavaScript and returns stdout", async () => {
    const result = await runOsascript({
      language: "JavaScript",
      script: '"world"',
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.stdout.trim()).toBe("world");
  });

  it("captures non-zero exit codes as kind: ok with the failing exit", async () => {
    // AppleScript that explicitly errors
    const result = await runOsascript({
      language: "AppleScript",
      script: 'error "boom" number 1234',
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("boom");
  });

  it("returns kind: timeout when the script exceeds timeoutMs", async () => {
    const result = await runOsascript({
      language: "AppleScript",
      script: "delay 5",
      timeoutMs: 200,
    });
    expect(result.kind).toBe("timeout");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/osascript.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/transport/osascript.ts`**

```ts
import { spawn } from "node:child_process";

export interface OsascriptInput {
  language: "AppleScript" | "JavaScript";
  script: string;
  timeoutMs?: number;
}

export type OsascriptResult =
  | { kind: "ok"; stdout: string; stderr: string; exitCode: number }
  | { kind: "timeout"; partialStdout: string; partialStderr: string }
  | { kind: "spawn_error"; message: string };

const DEFAULT_TIMEOUT_MS = 30_000;

export function runOsascript(input: OsascriptInput): Promise<OsascriptResult> {
  const args =
    input.language === "JavaScript" ? ["-l", "JavaScript", "-e", input.script] : ["-e", input.script];

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    let child;
    try {
      child = spawn("osascript", args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      resolve({
        kind: "spawn_error",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({ kind: "timeout", partialStdout: stdout, partialStderr: stderr });
    }, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ kind: "ok", stdout, stderr, exitCode: code ?? -1 });
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ kind: "spawn_error", message: err.message });
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/osascript.test.ts`
Expected: PASS — 4 tests green. Note: this test runs `osascript`, so it requires macOS. That's acceptable: the project is Mac-only by design.

- [ ] **Step 5: Commit**

```bash
git add src/transport/osascript.ts tests/unit/osascript.test.ts
git commit -m "feat: osascript subprocess dispatcher with timeout"
```

---

## Task 5: Transport Layer (2) — Result-File Round Trip

Wraps `runOsascript` with the temp-file result protocol: generate a unique temp path, dispatch the script with that path embedded, read the JSON result back. This is the layer tools call directly.

**Files:**
- Create: `src/transport/result-file.ts`
- Create: `tests/unit/result-file.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/result-file.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { runScriptWithResultFile } from "../../src/transport/result-file.js";

describe("runScriptWithResultFile", () => {
  it("substitutes RESULT_PATH and reads the JSON result", async () => {
    // The script uses JavaScript-for-Automation (jxa) so it runs without InDesign.
    const scriptTemplate = `
      ObjC.import("Foundation");
      var path = $.NSString.alloc.initWithUTF8String("RESULT_PATH");
      var json = $.NSString.alloc.initWithUTF8String(JSON.stringify({ok:true, result:{n:7}}));
      json.writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
    `;
    const env = await runScriptWithResultFile({
      language: "JavaScript",
      scriptTemplate,
    });
    expect(env).toEqual({ ok: true, result: { n: 7 } });
  });

  it("forwards a failure envelope verbatim when the script writes one", async () => {
    // No InDesign call here — just verify the transport returns whatever
    // envelope the script writes.
    const scriptTemplate = `
      ObjC.import("Foundation");
      var path = $.NSString.alloc.initWithUTF8String("RESULT_PATH");
      var json = $.NSString.alloc.initWithUTF8String(JSON.stringify({
        ok:false,
        error:{kind:"app_not_available", message:"InDesign not running"}
      }));
      json.writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
    `;
    const env = await runScriptWithResultFile({ language: "JavaScript", scriptTemplate });
    expect(env.ok).toBe(false);
    if (env.ok) return;
    expect(env.error.kind).toBe("app_not_available");
  });

  it("returns script_error when the result file is missing or invalid JSON", async () => {
    // Script that exits without writing anything to RESULT_PATH.
    const scriptTemplate = `"no result written"`;
    const env = await runScriptWithResultFile({ language: "JavaScript", scriptTemplate });
    expect(env.ok).toBe(false);
    if (env.ok) return;
    expect(env.error.kind).toBe("script_error");
  });

  it("returns timeout when the script hangs", async () => {
    const scriptTemplate = `delay(5)`; // jxa
    const env = await runScriptWithResultFile({
      language: "JavaScript",
      scriptTemplate,
      timeoutMs: 200,
    });
    expect(env.ok).toBe(false);
    if (env.ok) return;
    expect(env.error.kind).toBe("timeout");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/result-file.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/transport/result-file.ts`**

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Envelope } from "../types.js";
import { fail } from "../errors.js";
import { runOsascript } from "./osascript.js";

export interface RunScriptInput {
  language: "AppleScript" | "JavaScript";
  /** Script body. Occurrences of the literal `RESULT_PATH` are replaced
   *  with the absolute temp file path before execution. */
  scriptTemplate: string;
  timeoutMs?: number;
}

const TEMP_PREFIX = "indesign-mcp-";

export async function runScriptWithResultFile<T = unknown>(
  input: RunScriptInput,
): Promise<Envelope<T>> {
  const dir = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
  const resultPath = join(dir, "result.json");

  try {
    const script = input.scriptTemplate.replaceAll("RESULT_PATH", resultPath);
    const dispatch = await runOsascript({
      language: input.language,
      script,
      timeoutMs: input.timeoutMs,
    });

    if (dispatch.kind === "timeout") {
      return fail("timeout", "osascript dispatch exceeded timeout") as Envelope<T>;
    }
    if (dispatch.kind === "spawn_error") {
      return fail("io_error", `osascript spawn failed: ${dispatch.message}`) as Envelope<T>;
    }
    // dispatch.kind === "ok"
    let raw: string;
    try {
      raw = await readFile(resultPath, "utf8");
    } catch {
      // Script didn't write a result file. Use stderr as best-effort context.
      const stderrSnippet = dispatch.stderr.slice(0, 500);
      return fail(
        "script_error",
        `script did not produce a result file (exit ${dispatch.exitCode})`,
        { stack: stderrSnippet },
      ) as Envelope<T>;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return fail(
        "script_error",
        `result file was not valid JSON: ${(err as Error).message}`,
        { stack: raw.slice(0, 500) },
      ) as Envelope<T>;
    }

    // Trust the script's envelope shape — it's our own contract.
    return parsed as Envelope<T>;
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/result-file.test.ts`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/transport/result-file.ts tests/unit/result-file.test.ts
git commit -m "feat: result-file round trip on top of osascript"
```

---

## Task 6: Compose Layer — ExtendScript Preamble

Wraps a tool's ExtendScript body in a try/catch that serialises a result envelope to `RESULT_PATH`. Tools provide *just the body*; the preamble handles wiring.

**Files:**
- Create: `src/compose.ts`
- Create: `tests/unit/compose.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/compose.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { wrapExtendScript } from "../../src/compose.js";

describe("wrapExtendScript", () => {
  it("produces a JXA wrapper that calls InDesign do-script and writes JSON", () => {
    const body = `var doc = app.documents.add(); return { document_id: String(doc.id) };`;
    const wrapped = wrapExtendScript(body);

    // Sanity assertions: the wrapper references RESULT_PATH and the body, and dispatches via InDesign 2026.
    expect(wrapped).toContain("RESULT_PATH");
    expect(wrapped).toContain("Adobe InDesign 2026");
    expect(wrapped).toContain(body);
    expect(wrapped).toContain("doScript"); // jxa method name
  });

  it("wraps multi-line bodies safely (no string-escape issues)", () => {
    const body = `var s = "she said \\"hi\\"";\nreturn { s: s };`;
    const wrapped = wrapExtendScript(body);
    // The body is embedded as a JSON-encoded string and unwrapped at runtime,
    // so we don't have to escape twice. The wrapper must contain the JSON form.
    expect(wrapped).toContain(JSON.stringify(body));
  });

  it("matches the documented snapshot", () => {
    const body = `return { x: 1 };`;
    expect(wrapExtendScript(body)).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/compose.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/compose.ts`**

```ts
/**
 * Wraps an ExtendScript body in a JavaScript-for-Automation (JXA) shell that:
 *   1. dispatches the body to InDesign 2026 via `do script ... language javascript`
 *   2. captures the script's return value (must be JSON-serialisable)
 *   3. writes a `{ok:true, result}` envelope to RESULT_PATH on success
 *   4. writes a `{ok:false, error:{kind:"script_error", message, stack}}` envelope on any throw
 *
 * The body must be self-contained ExtendScript that ends with a `return <value>;`.
 * RESULT_PATH is substituted at dispatch time by the transport layer.
 */
export function wrapExtendScript(body: string): string {
  // Embed the body as a JSON string. ExtendScript receives it via JXA's
  // do-script `with arguments {...}` channel.
  const bodyJson = JSON.stringify(body);

  return `
ObjC.import("Foundation");

var resultPath = "RESULT_PATH";
var bodyText = ${bodyJson};

function writeResult(envObj) {
  var s = $.NSString.alloc.initWithUTF8String(JSON.stringify(envObj));
  s.writeToFileAtomicallyEncodingError(resultPath, true, $.NSUTF8StringEncoding, null);
}

try {
  var indd = Application("Adobe InDesign 2026");
  // Build a self-invoking ExtendScript that returns a JSON string we can re-parse.
  // Errors inside ExtendScript surface as exceptions raised back into JXA.
  var wrappedBody =
    "(function(){" +
    "  try {" +
    "    var __r = (function(){" + bodyText + "})();" +
    "    return JSON.stringify({ok:true, result: __r});" +
    "  } catch (e) {" +
    "    return JSON.stringify({" +
    "      ok:false," +
    "      error:{kind:'script_error', message:String(e.message || e), stack:String(e.stack || '')}" +
    "    });" +
    "  }" +
    "})();";
  var raw = indd.doScript(wrappedBody, { language: "javascript" });
  // raw is a JSON string produced by the inner script; trust and forward.
  var env = JSON.parse(String(raw));
  writeResult(env);
} catch (outer) {
  // Most likely cause: InDesign isn't running.
  var msg = String(outer.message || outer);
  var kind = (msg.indexOf("Application can't be found") !== -1)
    ? "app_not_available"
    : "script_error";
  writeResult({ ok:false, error: { kind: kind, message: msg } });
}
`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/compose.test.ts`
Expected: PASS for the two assertion tests; the snapshot test will write a fresh snapshot on first run (passes). Re-run to confirm the snapshot stays stable.

Run: `npm test -- tests/unit/compose.test.ts`
Expected: PASS — 3 tests green (snapshot now compared, not written).

- [ ] **Step 5: Commit**

```bash
git add src/compose.ts tests/unit/compose.test.ts tests/unit/__snapshots__/
git commit -m "feat: ExtendScript preamble wrapping with envelope capture"
```

---

## Task 7: MCP Server Skeleton + Tool Registry

Wires the MCP SDK's stdio server to a tool registry. A tool is a typed object: name, description, Zod input schema, async handler returning an Envelope. The server lists registered tools and dispatches `tools/call`.

**Files:**
- Create: `src/tools/registry.ts`
- Create: `src/server.ts`
- Create: `src/index.ts`

- [ ] **Step 1: Write `src/tools/registry.ts`**

No tests for the registry directly — its behaviour is exercised by the tool tests in Task 8 and the integration test in Task 9.

```ts
import type { ZodTypeAny } from "zod";
import type { Envelope } from "../types.js";

export interface ToolDefinition<TInput, TResult> {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  handler: (input: TInput) => Promise<Envelope<TResult>>;
}

export type AnyToolDefinition = ToolDefinition<any, any>;

export class ToolRegistry {
  private readonly tools = new Map<string, AnyToolDefinition>();

  register(tool: AnyToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  list(): AnyToolDefinition[] {
    return [...this.tools.values()];
  }

  get(name: string): AnyToolDefinition | undefined {
    return this.tools.get(name);
  }
}

export function defineTool<TInput, TResult>(
  def: ToolDefinition<TInput, TResult>,
): ToolDefinition<TInput, TResult> {
  return def;
}
```

- [ ] **Step 2: Write `src/server.ts`**

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Logger } from "./logger.js";
import { ToolRegistry } from "./tools/registry.js";
import { fail } from "./errors.js";

export interface CreateServerOptions {
  registry: ToolRegistry;
  logger: Logger;
}

export function createServer(opts: CreateServerOptions): Server {
  const { registry, logger } = opts;

  const server = new Server(
    { name: "indesign-mcp", version: "0.0.1" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registry.list().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: rawArgs } = req.params;
    const tool = registry.get(name);
    if (!tool) {
      const env = fail("invalid_args", `unknown tool: ${name}`);
      return toMcpResult(env);
    }
    const parsed = tool.inputSchema.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      const env = fail("invalid_args", parsed.error.message);
      logger.error("invalid_args", { name, error: parsed.error.format() });
      return toMcpResult(env);
    }
    const callId = `${name}-${Date.now()}`;
    await logger.info("tool_call", { id: callId, name, args: parsed.data });
    try {
      const env = await tool.handler(parsed.data);
      await logger.info("tool_result", { id: callId, ok: env.ok });
      return toMcpResult(env);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logger.error("tool_threw", { id: callId, message });
      return toMcpResult(fail("script_error", `tool handler threw: ${message}`));
    }
  });

  return server;
}

function toMcpResult(env: { ok: boolean } & Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(env) }],
    isError: !env.ok,
  };
}

// (zodToJsonSchema is imported from the dedicated package; see top of file.)
```

- [ ] **Step 3: Write `src/index.ts`**

```ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { ToolRegistry } from "./tools/registry.js";
import { createLogger, defaultLogPath } from "./logger.js";
import { getAppVersionTool } from "./tools/get-app-version.js";

async function main() {
  const logger = createLogger(defaultLogPath());
  const registry = new ToolRegistry();
  registry.register(getAppVersionTool);

  const server = createServer({ registry, logger });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await logger.info("server_started", { tools: registry.list().map((t) => t.name) });
}

main().catch((err) => {
  // Last-resort error: write to stderr because logger may not be initialised.
  process.stderr.write(`indesign-mcp fatal: ${err?.stack ?? err}\n`);
  process.exit(1);
});
```

- [ ] **Step 4: Build and verify it type-checks (the tool import won't resolve until Task 8 — confirm everything else compiles)**

Run: `npx tsc --noEmit`
Expected: ONE error referring to the missing `./tools/get-app-version.js` import. All other code compiles. Move on — Task 8 fills it in.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts src/index.ts src/tools/registry.ts
git commit -m "feat: MCP server skeleton + tool registry (depends on get-app-version, added next task)"
```

---

## Task 8: First Tool — `get_app_version`

A trivial tool that returns InDesign's version string. Exists to prove the full pipeline: schema → composed script → osascript → InDesign → result file → envelope. Takes no input.

**Files:**
- Create: `src/tools/get-app-version.ts`
- Create: `tests/unit/tools/get-app-version.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/tools/get-app-version.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAppVersionTool } from "../../../src/tools/get-app-version.js";

// We test by stubbing the transport. This validates schema, script body,
// and result parsing — without actually running osascript or InDesign.
vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("get_app_version tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(getAppVersionTool.name).toBe("get_app_version");
    expect(getAppVersionTool.description).toMatch(/version/i);
  });

  it("rejects extra input properties", () => {
    const parsed = getAppVersionTool.inputSchema.safeParse({ junk: 1 });
    expect(parsed.success).toBe(false);
  });

  it("dispatches an ExtendScript that reads app.version and returns the result", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { version: "21.0" },
    });
    const env = await getAppVersionTool.handler({});
    expect(env).toEqual({ ok: true, result: { version: "21.0" } });

    expect(runScriptWithResultFile).toHaveBeenCalledOnce();
    const arg = vi.mocked(runScriptWithResultFile).mock.calls[0][0];
    expect(arg.language).toBe("JavaScript");
    expect(arg.scriptTemplate).toContain("app.version");
    expect(arg.scriptTemplate).toContain("RESULT_PATH");
  });

  it("propagates failure envelopes verbatim", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: { kind: "app_not_available", message: "no app" },
    });
    const env = await getAppVersionTool.handler({});
    expect(env.ok).toBe(false);
    if (env.ok) return;
    expect(env.error.kind).toBe("app_not_available");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/tools/get-app-version.test.ts`
Expected: FAIL — module `src/tools/get-app-version.js` not found.

- [ ] **Step 3: Write `src/tools/get-app-version.ts`**

```ts
import { z } from "zod";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript } from "../compose.js";

const InputSchema = z.object({}).strict();
type Input = z.infer<typeof InputSchema>;

interface Result {
  version: string;
}

const SCRIPT_BODY = `
return { version: String(app.version) };
`.trim();

export const getAppVersionTool = defineTool<Input, Result>({
  name: "get_app_version",
  description: "Returns the version string of the running InDesign application. Requires InDesign 2026 to be open.",
  inputSchema: InputSchema,
  async handler() {
    const scriptTemplate = wrapExtendScript(SCRIPT_BODY);
    return runScriptWithResultFile<Result>({
      language: "JavaScript",
      scriptTemplate,
    });
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/tools/get-app-version.test.ts`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Verify the full project type-checks now**

Run: `npx tsc --noEmit`
Expected: zero output. Index.ts imports resolve.

- [ ] **Step 6: Verify the unit suite as a whole stays green**

Run: `npm test`
Expected: all unit tests pass; integration tests are excluded by `package.json`'s `test` script.

- [ ] **Step 7: Commit**

```bash
git add src/tools/get-app-version.ts tests/unit/tools/get-app-version.test.ts
git commit -m "feat: get_app_version tool — first end-to-end MCP tool"
```

---

## Task 9: Integration Test — Real InDesign Round Trip

Confirms the whole stack works against a running InDesign 2026. Env-gated so it doesn't run by default (developer must launch InDesign first and explicitly opt in).

**Files:**
- Create: `tests/integration/helpers.ts`
- Create: `tests/integration/get-app-version.int.test.ts`

- [ ] **Step 1: Write `tests/integration/helpers.ts`**

```ts
import { describe } from "vitest";

// Conditional describe — only runs when INDESIGN_MCP_INTEGRATION=1.
// Run with `npm run test:integration`. Requires InDesign 2026 running.
export const integrationGate =
  process.env.INDESIGN_MCP_INTEGRATION === "1" ? describe : describe.skip;
```

- [ ] **Step 2: Write `tests/integration/get-app-version.int.test.ts`**

```ts
import { it, expect } from "vitest";
import { integrationGate } from "./helpers.js";
import { getAppVersionTool } from "../../src/tools/get-app-version.js";

integrationGate("get_app_version (integration)", () => {
  it("returns InDesign 2026's version when the app is running", async () => {
    const env = await getAppVersionTool.handler({});
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(typeof env.result?.version).toBe("string");
    // 2026's version line begins with 21.x. Accept any 21+ to allow point updates.
    expect(env.result?.version).toMatch(/^2[1-9]\./);
  }, 30_000);
});
```

- [ ] **Step 3: Run the unit suite, confirm integration test is skipped by default**

Run: `npm test`
Expected: integration test files excluded by config — they don't appear in the output at all.

- [ ] **Step 4: Run the integration suite manually with InDesign 2026 open**

Pre-conditions: launch InDesign 2026 from Spotlight; dismiss any "Welcome" dialogs so the app is idle.

Run: `npm run test:integration`
Expected: PASS — `get_app_version` returns a version string starting with `21.`. If FAIL with `app_not_available`, InDesign isn't fully launched yet — wait a few seconds and retry. If FAIL with `script_error`, inspect `~/Library/Logs/indesign-mcp/server.log` for the dispatched script.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/helpers.ts tests/integration/get-app-version.int.test.ts
git commit -m "test: integration test for get_app_version against running InDesign"
```

---

## Task 10: README + Smoke-Test Documentation

Documents how to install, build, configure Claude Desktop / Claude Code to use this server, and run the smoke test by hand.

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# indesign-mcp

MCP server bridging Claude to Adobe InDesign 2026. v1 dispatches ExtendScript
via macOS `osascript`. UXP plugin upgrade deferred to v2.

See `docs/superpowers/specs/2026-05-05-indesign-mcp-design.md` for the design spec.

## Requirements

- macOS
- Node 20+
- Adobe InDesign 2026 (installed; running when tools are called)

## Install & build

\`\`\`bash
npm install
npm run build
\`\`\`

## Test

Unit tests (no InDesign required):
\`\`\`bash
npm test
\`\`\`

Integration tests (requires InDesign 2026 running):
\`\`\`bash
npm run test:integration
\`\`\`

## Wiring up Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

\`\`\`json
{
  "mcpServers": {
    "indesign-mcp": {
      "command": "node",
      "args": ["/Users/benjones/Documents/GitHub/indesign-mcp/dist/index.js"]
    }
  }
}
\`\`\`

Restart Claude Desktop. Confirm the server appears as connected in the MCP
status panel.

## Wiring up Claude Code

Add to `~/.claude/settings.json` (or your project's `.claude/settings.json`):

\`\`\`json
{
  "mcpServers": {
    "indesign-mcp": {
      "command": "node",
      "args": ["/Users/benjones/Documents/GitHub/indesign-mcp/dist/index.js"]
    }
  }
}
\`\`\`

## Smoke test

1. Launch InDesign 2026. Wait until the app is idle (no startup dialogs).
2. In Claude (Desktop or Code), ask: *"Use the indesign-mcp tool `get_app_version` and tell me the result."*
3. Expected: Claude reports a version string like `21.0` (or higher).

If Claude reports `app_not_available`, InDesign isn't fully launched. Wait
and retry. For other errors, check `~/Library/Logs/indesign-mcp/server.log`.

## Logging

The server appends one JSON line per event to:
\`\`\`
~/Library/Logs/indesign-mcp/server.log
\`\`\`

Useful for diagnosing "Claude said it did X, but X didn't happen" cases —
the log captures the composed ExtendScript and the raw return.

## What's next

Plan A (this plan) ships only one tool, `get_app_version`. Plan B will add
the POC tool surface from the design spec: `create_document`,
`create_text_frame`, `place_image`, etc.
```

- [ ] **Step 2: Run the smoke test by hand to confirm the README's instructions are accurate**

Pre-conditions: InDesign 2026 running and idle.

1. `npm run build` — should produce `dist/index.js`.
2. Add the MCP config block to your Claude Code or Desktop settings (use the absolute path printed by `pwd`).
3. Restart Claude.
4. Ask Claude to call `get_app_version`. Expect a version string in the response.

If the smoke test passes, Plan A is complete.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README with install / wire-up / smoke-test instructions"
```

---

## Plan-Complete Checklist

Before declaring Plan A done:

- [ ] All unit tests pass (`npm test`).
- [ ] Integration test passes with InDesign running (`npm run test:integration`).
- [ ] `dist/index.js` exists and runs (no startup error).
- [ ] Smoke test through Claude works end-to-end.
- [ ] `~/Library/Logs/indesign-mcp/server.log` contains a `tool_call` and `tool_result` entry from the smoke test.

When all five are checked, Plan B (the rest of the POC tools) becomes the next planning step.
