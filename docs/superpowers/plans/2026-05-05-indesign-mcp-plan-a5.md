# InDesign MCP — Plan A.5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address Plan A's identified gaps before Plan B's tool fan-out makes them expensive to retrofit. Six items: behavioural test for the compose layer, logger payload completeness, runtime envelope validation, test helpers for tool tests, `ok()` extensions for mutating tools, and tsconfig coverage of the test directory.

**Architecture:** No architectural changes. All work is local refinement of existing modules.

**Tech Stack:** Same as Plan A — TypeScript, Vitest, MCP SDK, Zod.

**Reference:**
- Plan A spec: `docs/superpowers/specs/2026-05-05-indesign-mcp-design.md`
- Plan A foundation plan: `docs/superpowers/plans/2026-05-05-indesign-mcp-foundation.md`

**Repo:** `~/Documents/GitHub/indesign-mcp/`, branch `feat/plan-a5`.

---

## Task ordering rationale

1. tsconfig extend first — surfaces any latent type errors in tests so we fix them once.
2. test helpers — small, self-contained, no deps.
3. `ok()` extensions — small, foundational change.
4. Zod envelope validation — uses Zod schemas, isolated to result-file.
5. Logger payload completeness — touches transport + index, depends on prior settling.
6. Compose behavioural test — caps the work; the most complex test, validates the system end-to-end.

---

## Task 1: Extend tsconfig to cover tests/

**Why:** The `Record<ErrorKind, true>` exhaustiveness assertion in `tests/unit/errors.test.ts` is silently inert today because `tsc` doesn't see the test file. Type-level test assertions across all current and future test files become enforced once `tests/` is in `include`.

**Files:**
- Modify: `tsconfig.json`

- [ ] **Step 1: Read current tsconfig.json to confirm current state**

Run: `cat tsconfig.json`
Expected: `include: ["src/**/*"]` only.

- [ ] **Step 2: Extend `include` to cover both src and tests**

Edit `tsconfig.json` so `include` is:

```json
"include": ["src/**/*", "tests/**/*"]
```

Leave `compilerOptions` untouched.

- [ ] **Step 3: Run tsc to surface any latent test-only type issues**

Run: `npx tsc --noEmit`
Expected: clean. If errors appear, fix them — they are real (type assertions in tests that previously weren't checked).

- [ ] **Step 4: Confirm the exhaustiveness assertion is now enforced**

Verify by mutating: in `src/types.ts`, temporarily remove `"timeout"` from the `ErrorKind` union. Run `npx tsc --noEmit`. Expect at least one error pointing at `tests/unit/errors.test.ts` where the `Record<ErrorKind, true>` literal now has an excess key.

Restore `"timeout"`. Re-run `npx tsc --noEmit`. Expect clean.

- [ ] **Step 5: Run unit suite to confirm no regressions**

Run: `npm test`
Expected: 27/27 pass.

- [ ] **Step 6: Commit**

```bash
git add tsconfig.json
git commit -m "chore: tsconfig include covers tests/ so type assertions are enforced"
```

---

## Task 2: Test helpers — `lastCall()` and `expectFailure()`

**Why:** Plan B will add 11 tool test files following the same mock-transport pattern. Two helpers — `lastCall()` for grabbing the last mock argument and `expectFailure()` for the `if (env.ok) return;` narrowing dance — save ~20 lines per tool test.

**Files:**
- Create: `tests/unit/_helpers.ts`
- Modify: `tests/unit/tools/get-app-version.test.ts` (use the helpers)

- [ ] **Step 1: Write `tests/unit/_helpers.ts`**

```ts
import { expect } from "vitest";
import type { Envelope, FailureEnvelope } from "../../src/types.js";

/**
 * Returns the most recent argument tuple passed to a Vitest mock. Structural
 * typing — accepts anything with `.mock.calls`. Throws if the mock has not
 * been called yet so ordering bugs fail fast instead of returning undefined.
 */
export function lastCall<TArgs extends unknown[]>(
  mock: { mock: { calls: TArgs[] } },
): TArgs {
  const calls = mock.mock.calls;
  if (calls.length === 0) {
    throw new Error("lastCall: mock has not been called");
  }
  return calls[calls.length - 1];
}

/**
 * Asserts that an Envelope is a failure and narrows its type accordingly.
 * Replaces the `expect(env.ok).toBe(false); if (env.ok) return;` boilerplate.
 */
export function expectFailure<T>(env: Envelope<T>): asserts env is FailureEnvelope {
  expect(env.ok).toBe(false);
  if (env.ok) {
    throw new Error("expectFailure: envelope is success");
  }
}
```

- [ ] **Step 2: Update `tests/unit/tools/get-app-version.test.ts` to use the helpers**

Two specific replacements:

(a) The "dispatches an ExtendScript..." test currently has:

```ts
const arg = vi.mocked(runScriptWithResultFile).mock.calls[0][0];
```

Replace with:

```ts
const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
```

(b) The "propagates failure envelopes verbatim" test currently has:

```ts
const env = await getAppVersionTool.handler({});
expect(env.ok).toBe(false);
if (env.ok) return;
expect(env.error.kind).toBe("app_not_available");
```

Replace with:

```ts
const env = await getAppVersionTool.handler({});
expectFailure(env);
expect(env.error.kind).toBe("app_not_available");
```

Add the helper imports near the top:

```ts
import { lastCall, expectFailure } from "../_helpers.js";
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: 27/27 pass.

- [ ] **Step 4: Run tsc**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/_helpers.ts tests/unit/tools/get-app-version.test.ts
git commit -m "test: add lastCall and expectFailure helpers for tool tests"
```

---

## Task 3: Extend `ok()` to accept warnings and document_state_delta

**Why:** Plan B's mutating tools (create_document, create_text_frame, etc.) need to return `document_state_delta` (per the design spec) and may want to surface non-fatal warnings (e.g., "applied paragraph style but the body's font wasn't installed; substituted").

**Files:**
- Modify: `src/errors.ts`
- Modify: `tests/unit/errors.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/errors.test.ts` (inside the existing describe block):

```ts
  it("ok() accepts an optional warnings array", () => {
    const env = ok({ value: 1 }, { warnings: ["font substituted"] });
    expect(env).toEqual({
      ok: true,
      result: { value: 1 },
      warnings: ["font substituted"],
    });
  });

  it("ok() accepts an optional document_state_delta", () => {
    const delta = { new_frames: [{ id: "f1", type: "text" }], page_count: 2 };
    const env = ok({ value: 1 }, { document_state_delta: delta });
    expect(env).toEqual({
      ok: true,
      result: { value: 1 },
      document_state_delta: delta,
    });
  });

  it("ok() omits warnings/delta keys when not provided", () => {
    const env = ok({ value: 1 });
    expect(env).toEqual({ ok: true, result: { value: 1 } });
    expect(Object.keys(env)).not.toContain("warnings");
    expect(Object.keys(env)).not.toContain("document_state_delta");
  });

  it("ok() works with no args and accepts options", () => {
    const env = ok(undefined, { warnings: ["empty op"] });
    expect(env).toEqual({ ok: true, warnings: ["empty op"] });
  });
```

- [ ] **Step 2: Run — expect failures**

Run: `npm test -- tests/unit/errors.test.ts`
Expected: 4 new tests fail.

- [ ] **Step 3: Update `src/errors.ts`**

Replace the existing `ok` function with:

```ts
export interface OkOptions {
  warnings?: string[];
  document_state_delta?: import("./types.js").DocumentStateDelta;
}

export function ok<T = void>(
  result?: T,
  options: OkOptions = {},
): Envelope<T> {
  const env: SuccessEnvelope<T> = { ok: true };
  if (result !== undefined) env.result = result;
  if (options.warnings !== undefined) env.warnings = options.warnings;
  if (options.document_state_delta !== undefined) env.document_state_delta = options.document_state_delta;
  return env;
}
```

Add the `SuccessEnvelope` import at the top (alongside the existing imports):

```ts
import type { ErrorKind, Envelope, ToolError, SuccessEnvelope } from "./types.js";
```

- [ ] **Step 4: Run — expect pass**

Run: `npm test -- tests/unit/errors.test.ts`
Expected: 9/9 pass (5 original + 4 new).

- [ ] **Step 5: Run full suite + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: 31/31 tests pass, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/errors.ts tests/unit/errors.test.ts
git commit -m "feat: ok() accepts warnings and document_state_delta options"
```

---

## Task 4: Zod envelope validation at the script-result boundary

**Why:** `runScriptWithResultFile` currently does `parsed as Envelope<T>` — a type cast with no runtime check. A script that writes `{ "ok": 1, "result": {...} }` (truthy-but-wrong) would slip through and produce a "success" envelope that downstream code then trips over. Adding Zod validation at this seam catches every cross-script regression as a loud `script_error`.

**Files:**
- Modify: `src/transport/result-file.ts`
- Modify: `tests/unit/result-file.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/result-file.test.ts`:

```ts
  it("rejects an envelope with the wrong shape (e.g. ok: 1)", async () => {
    // Script writes a plausibly-shaped but invalid envelope (truthy-but-wrong ok).
    const scriptTemplate = `
      ObjC.import("Foundation");
      var path = $.NSString.alloc.initWithUTF8String("__INDESIGN_MCP_RESULT_PATH__");
      var json = $.NSString.alloc.initWithUTF8String('{"ok":1,"result":{}}');
      json.writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
    `;
    const env = await runScriptWithResultFile({ language: "JavaScript", scriptTemplate });
    expect(env.ok).toBe(false);
    if (env.ok) return;
    expect(env.error.kind).toBe("script_error");
    expect(env.error.message).toMatch(/envelope/i);
  });

  it("rejects an envelope missing the required ok field", async () => {
    const scriptTemplate = `
      ObjC.import("Foundation");
      var path = $.NSString.alloc.initWithUTF8String("__INDESIGN_MCP_RESULT_PATH__");
      var json = $.NSString.alloc.initWithUTF8String('{"result":"surprise"}');
      json.writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
    `;
    const env = await runScriptWithResultFile({ language: "JavaScript", scriptTemplate });
    expect(env.ok).toBe(false);
    if (env.ok) return;
    expect(env.error.kind).toBe("script_error");
  });
```

- [ ] **Step 2: Run — expect failures**

Run: `npm test -- tests/unit/result-file.test.ts`
Expected: 2 new tests fail (the cast-as-Envelope path lets the bogus values through).

- [ ] **Step 3: Add Zod schema and validation in `src/transport/result-file.ts`**

Near the top of the file (after the imports), add:

```ts
import { z } from "zod";

// Minimal envelope schema: validates shape, not the inner result/error payload
// (those are tool-specific). Catches truthy-but-wrong envelopes from scripts.
const EnvelopeSchema = z.union([
  z.object({
    ok: z.literal(true),
    result: z.unknown().optional(),
    document_state_delta: z.unknown().optional(),
    warnings: z.array(z.string()).optional(),
  }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      kind: z.string(),
      message: z.string(),
    }).passthrough(),
  }),
]);
```

Replace the existing `return parsed as Envelope<T>;` line with:

```ts
const validation = EnvelopeSchema.safeParse(parsed);
if (!validation.success) {
  return fail(
    "script_error",
    `script returned an envelope with the wrong shape: ${validation.error.message}`,
    { stack: raw.slice(0, 500) },
  ) as Envelope<T>;
}
return validation.data as Envelope<T>;
```

- [ ] **Step 4: Run — expect pass**

Run: `npm test -- tests/unit/result-file.test.ts`
Expected: 7/7 pass (5 original + 2 new).

- [ ] **Step 5: Run full suite + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: 33/33 pass, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/transport/result-file.ts tests/unit/result-file.test.ts
git commit -m "feat: validate script-returned envelope shape with Zod"
```

---

## Task 5: Logger payload completeness

**Why:** The design spec states the log should capture *"every tool call, the composed ExtendScript, and the raw return."* Currently the server logs only `{id, name, args}` and `{id, ok}`. The composed script and raw return aren't captured. Without them, "Claude said it created a frame but the frame isn't there" is undebuggable from logs.

**Approach:** A module-level logger singleton initialised by `index.ts` and consumed by `runScriptWithResultFile`. Each dispatch logs one `script_dispatch` entry containing `{scriptTemplate, raw, parsedEnvelope}`. Operator correlates with server-side `tool_call` / `tool_result` by event order/timestamp. Exact callId correlation under concurrency is deferred (would require handler ctx threading).

**Files:**
- Create: `src/logger-singleton.ts`
- Modify: `src/index.ts` (initialise the singleton)
- Modify: `src/transport/result-file.ts` (log dispatch + result)
- Modify: `tests/unit/result-file.test.ts` (verify the log payload)

- [ ] **Step 1: Write `src/logger-singleton.ts`**

```ts
import type { Logger } from "./logger.js";

let registered: Logger | undefined;

/**
 * Register the process-wide logger. Called once from index.ts at startup.
 * Subsequent calls overwrite (useful for tests).
 */
export function registerLogger(logger: Logger): void {
  registered = logger;
}

/**
 * Returns the registered logger, or undefined if none has been registered.
 * Modules that want to log must handle the undefined case (best-effort logging).
 */
export function getLogger(): Logger | undefined {
  return registered;
}

/**
 * Test helper: clears the registered logger. Use in `afterEach`.
 */
export function clearLogger(): void {
  registered = undefined;
}
```

- [ ] **Step 2: Update `src/index.ts` to register the logger**

Find the line where the logger is created. Add a `registerLogger(logger)` call right after:

```ts
import { createLogger, defaultLogPath } from "./logger.js";
import { registerLogger } from "./logger-singleton.js";
...
const logger = createLogger(defaultLogPath());
registerLogger(logger);
```

- [ ] **Step 3: Update `src/transport/result-file.ts` to emit `script_dispatch` log entries**

Add the import:

```ts
import { getLogger } from "../logger-singleton.js";
```

Inside `runScriptWithResultFile`, add logging at three points:

(a) Just before the dispatch (after the temp-dir setup, after substitution but before `runOsascript`):

```ts
const log = getLogger();
await log?.info("script_dispatch_start", {
  language: input.language,
  scriptLength: script.length,
});
```

(b) Just after the dispatch returns, regardless of outcome — capture the raw stdout, the script, and the dispatch result kind:

```ts
await log?.info("script_dispatch_end", {
  language: input.language,
  dispatchKind: dispatch.kind,
  exitCode: dispatch.kind === "ok" ? dispatch.exitCode : undefined,
  scriptTemplate: input.scriptTemplate,
  rawStdoutSnippet: dispatch.kind === "ok" ? dispatch.stdout.slice(0, 1000) : undefined,
  rawStderrSnippet: dispatch.kind === "ok" ? dispatch.stderr.slice(0, 1000) : undefined,
});
```

(c) After parsing AND validation (Task 4 added the `validation` block), log the final envelope (truncated). Place this after the validation block but before `return validation.data as Envelope<T>;`. At this point `validation.data` is already type-narrowed to a valid Envelope:

```ts
await log?.info("script_dispatch_envelope", {
  ok: validation.data.ok,
  envelopeSnippet: raw.slice(0, 1000),
});
```

- [ ] **Step 4: Add a test that exercises the logger emission**

Append to `tests/unit/result-file.test.ts`:

```ts
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../../src/logger.js";
import { registerLogger, clearLogger } from "../../src/logger-singleton.js";
```

Then add this test at the end of the existing describe block:

```ts
  it("emits dispatch_start, dispatch_end, and envelope log entries", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "indesign-mcp-test-"));
    const logPath = join(tmpDir, "test.log");
    const logger = createLogger(logPath);
    registerLogger(logger);

    try {
      const scriptTemplate = `
        ObjC.import("Foundation");
        var path = $.NSString.alloc.initWithUTF8String("__INDESIGN_MCP_RESULT_PATH__");
        var json = $.NSString.alloc.initWithUTF8String(JSON.stringify({ok:true, result:{n:1}}));
        json.writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
      `;
      await runScriptWithResultFile({ language: "JavaScript", scriptTemplate });
      await logger.flush();

      const lines = readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
      const events = lines.map((l) => l.event);
      expect(events).toContain("script_dispatch_start");
      expect(events).toContain("script_dispatch_end");
      expect(events).toContain("script_dispatch_envelope");

      const endEvent = lines.find((l) => l.event === "script_dispatch_end");
      expect(endEvent.data.scriptTemplate).toContain("RESULT_PATH");
      expect(endEvent.data.dispatchKind).toBe("ok");
    } finally {
      clearLogger();
    }
  });
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: all pass (34/34 with the new test).

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/logger-singleton.ts src/index.ts src/transport/result-file.ts tests/unit/result-file.test.ts
git commit -m "feat: transport logs script_dispatch entries with composed script and raw return"
```

---

## Task 6: Behavioural test for the compose layer

**Why:** Today's two bugs (missing newlines, then JSON undefined) both passed Plan A's unit tests because the tests were structural (does the wrapper *contain* X?) not behavioural (does the wrapper *work*?). A test that actually runs the wrapped script with stubbed JXA globals would have caught both bugs at unit-test time.

**Approach:** Use `node:vm.Script` + `Script.runInNewContext` with hand-rolled stubs for `Application`, `$`, `ObjC`. Each test injects a fake `Application(...).doScript(...)` that returns a known string, asserts that the wrapper handles it correctly. Crucially, this test will FAIL on a syntax error in the wrapper (catches the newline bug) and on a missing global like `JSON` only if the inner script tries to use it — which is why our inner ExtendScript ships a `_stringify` polyfill.

The compose snapshot test is kept (it pins the output) but the new behavioural test is the one with teeth.

**Files:**
- Modify: `tests/unit/compose.test.ts`

- [ ] **Step 1: Add the behavioural test**

Append to `tests/unit/compose.test.ts` (inside the existing describe block):

```ts
  it("when evaluated with stubbed JXA globals, writes the expected envelope", () => {
    const wrapped = wrapExtendScript(`return { version: "21.3.0.60" };`);

    // Capture what writeToFileAtomically... is called with.
    let written: string | undefined;
    const fakeNSString = {
      alloc: {
        initWithUTF8String(s: string) {
          // Two distinct uses: one for the path (substituted sentinel), one for
          // the JSON content. We capture the JSON one when the file write fires.
          return {
            _value: s,
            writeToFileAtomicallyEncodingError(path: { _value: string }, _atomic: boolean) {
              // The first call wraps the JSON content; capture it.
              if (this._value.startsWith("{")) {
                written = this._value;
              }
            },
          };
        },
      },
    };

    // Stub doScript: the inner ExtendScript IIFE concatenates _stringify(...) etc.
    // We pretend ExtendScript ran and produced a JSON envelope string.
    const fakeApp = {
      doScript(_innerScript: string, _opts: { language: string }) {
        return '{"ok":true,"result":{"version":"21.3.0.60"}}';
      },
    };

    const context = {
      Application: (_name: string) => fakeApp,
      $: { NSString: fakeNSString, NSUTF8StringEncoding: 4 },
      ObjC: { import: (_lib: string) => {} },
      JSON,
    };

    // Replace the unsubstituted sentinel with a placeholder string so the eval
    // doesn't try to write to a literal "__INDESIGN_MCP_RESULT_PATH__" file.
    const substituted = wrapped.replaceAll(
      "__INDESIGN_MCP_RESULT_PATH__",
      "/tmp/test-result.json",
    );

    new Script(substituted).runInNewContext(context);

    expect(written).toBeDefined();
    const env = JSON.parse(written!);
    expect(env).toEqual({ ok: true, result: { version: "21.3.0.60" } });
  });

  it("when the inner script throws, writes a script_error envelope", () => {
    const wrapped = wrapExtendScript(`return { x: 1 };`);

    let written: string | undefined;
    const fakeNSString = {
      alloc: {
        initWithUTF8String(s: string) {
          return {
            _value: s,
            writeToFileAtomicallyEncodingError(_path: unknown) {
              if (this._value.startsWith("{")) written = this._value;
            },
          };
        },
      },
    };

    // doScript simulates a successful dispatch where the inner IIFE caught
    // an exception and built the failure envelope through _stringify.
    const fakeApp = {
      doScript() {
        return '{"ok":false,"error":{"kind":"script_error","message":"boom","stack":""}}';
      },
    };

    const context = {
      Application: (_n: string) => fakeApp,
      $: { NSString: fakeNSString, NSUTF8StringEncoding: 4 },
      ObjC: { import: () => {} },
      JSON,
    };

    const substituted = wrapped.replaceAll(
      "__INDESIGN_MCP_RESULT_PATH__",
      "/tmp/test-result.json",
    );

    new Script(substituted).runInNewContext(context);

    expect(written).toBeDefined();
    const env = JSON.parse(written!);
    expect(env.ok).toBe(false);
    expect(env.error.kind).toBe("script_error");
  });

  it("when Application(...) throws, writes an app_not_available envelope", () => {
    const wrapped = wrapExtendScript(`return { x: 1 };`);

    let written: string | undefined;
    const fakeNSString = {
      alloc: {
        initWithUTF8String(s: string) {
          return {
            _value: s,
            writeToFileAtomicallyEncodingError(_path: unknown) {
              if (this._value.startsWith("{")) written = this._value;
            },
          };
        },
      },
    };

    function ApplicationStub(_name: string): never {
      const err: Error & { errorNumber?: number } = new Error("Application can't be found");
      err.errorNumber = -600;
      throw err;
    }

    const context = {
      Application: ApplicationStub,
      $: { NSString: fakeNSString, NSUTF8StringEncoding: 4 },
      ObjC: { import: () => {} },
      JSON,
    };

    const substituted = wrapped.replaceAll(
      "__INDESIGN_MCP_RESULT_PATH__",
      "/tmp/test-result.json",
    );

    new Script(substituted).runInNewContext(context);

    expect(written).toBeDefined();
    const env = JSON.parse(written!);
    expect(env.ok).toBe(false);
    expect(env.error.kind).toBe("app_not_available");
  });
```

- [ ] **Step 2: Run tests**

Run: `npm test -- tests/unit/compose.test.ts`
Expected: all 7 tests pass (4 original + 3 new behavioural).

- [ ] **Step 3: Sanity check — verify the test would catch a regression**

Temporarily corrupt `src/compose.ts`: change `Application("Adobe InDesign 2026")` to `Applicationn("Adobe InDesign 2026")` (typo). Run the behavioural tests — at least one should fail because the runtime stub doesn't have an `Applicationn` global.

Restore `src/compose.ts`. Re-run; expect green.

(This step is a manual sanity check; you do not need to commit the corruption.)

- [ ] **Step 4: Run full suite + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: 37/37 pass (or thereabouts depending on exact counts), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/compose.test.ts
git commit -m "test: behavioural tests for compose with stubbed JXA globals"
```

---

## Plan-Complete Checklist

Before declaring Plan A.5 done:

- [ ] All 6 tasks committed.
- [ ] `npm test` passes (expected ~37/37).
- [ ] `npx tsc --noEmit` clean across both src and tests.
- [ ] Smoke test through Claude Desktop still works (no regressions on the live path).
- [ ] Final code review of Plan A.5 commits as a unit.

When all five are checked, Plan B (the 11 POC tools) becomes the next planning step — and each tool gets the full benefit of test helpers, validated envelopes, complete logging, and the proven compose layer.
