# InDesign MCP — Plan B2 Implementation Plan (Text Composition)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship five MCP tools — `create_text_frame`, `set_text`, `define_paragraph_style`, `apply_paragraph_style`, `get_page_state` — that together let Claude place styled text on pages and inspect the result.

**Architecture:** Each tool follows the post-Task-3 template established in B1: Zod input schema → server-side body builder using `lit()` for safe interpolation and `prelude(...)` for shared script helpers → handler that dispatches via `runScriptWithResultFile<TScriptResult>` with `resultSchema` validation, post-processes into `Envelope<TResult>` with optional `document_state_delta` and `warnings`.

**Tech Stack:** TypeScript 5.6+, Node 20+, MCP SDK, Zod, Vitest. No new runtime deps.

**Reference spec:** `docs/superpowers/specs/2026-05-06-indesign-mcp-plan-b2-design.md`

**Repository:** `~/Documents/GitHub/indesign-mcp/`. Create a feature branch `feat/plan-b2` before starting.

**Sandbox note:** Integration tests require InDesign 2026 running and are env-gated. The implementer's sandbox likely doesn't have InDesign — those tests will fail with `app_not_available`, which is expected. Unit tests are the executable verification; integration tests are scaffolding for live verification.

---

## File Structure

```
src/
├── types.ts                                (modified, Task 1)
├── script-helpers.ts                       (modified, Task 2)
├── tools/
│   ├── create-text-frame.ts                (Task 3)
│   ├── set-text.ts                         (Task 4)
│   ├── define-paragraph-style.ts           (Task 5)
│   ├── apply-paragraph-style.ts            (Task 6)
│   └── get-page-state.ts                   (Task 7)
└── index.ts                                (modified for each tool task)

tests/
├── integration/
│   ├── create-text-frame.int.test.ts       (Task 3)
│   ├── set-text.int.test.ts                (Task 4)
│   ├── define-paragraph-style.int.test.ts  (Task 5)
│   ├── apply-paragraph-style.int.test.ts   (Task 6)
│   ├── get-page-state.int.test.ts          (Task 7)
│   └── plan-b2-end-to-end.int.test.ts      (Task 8)
└── unit/
    └── tools/
        ├── create-text-frame.test.ts       (Task 3)
        ├── set-text.test.ts                (Task 4)
        ├── define-paragraph-style.test.ts  (Task 5)
        ├── apply-paragraph-style.test.ts   (Task 6)
        └── get-page-state.test.ts          (Task 7)
```

---

## Task 1: Extend `DocumentStateDelta.changed_frames`

**Why:** `apply_paragraph_style` reports the applied style via `document_state_delta.changed_frames[].applied_paragraph_style`. The current `changed_frames` shape doesn't have that field.

**Files:**
- Modify: `src/types.ts`
- Modify: `tests/unit/types.test.ts`

- [ ] **Step 1: Add a failing test**

Append to `tests/unit/types.test.ts` (inside the existing describe block):

```ts
  it("changed_frames items accept an optional applied_paragraph_style field", () => {
    const delta: DocumentStateDelta = {
      changed_frames: [
        { id: "f1", applied_paragraph_style: "Body" },
        { id: "f2", bounds: [0, 0, 100, 50] },
      ],
    };
    expect(delta.changed_frames?.[0].applied_paragraph_style).toBe("Body");
    expect(delta.changed_frames?.[1].applied_paragraph_style).toBeUndefined();
  });
```

- [ ] **Step 2: Run, expect type-check failure**

Run: `npx tsc --noEmit`
Expected: error at `applied_paragraph_style: "Body"` ("Object literal may only specify known properties").

- [ ] **Step 3: Update `src/types.ts`**

Find the existing `DocumentStateDelta` interface and update the `changed_frames` element shape. The full interface should now read:

```ts
export interface DocumentStateDelta {
  changed_frames?: Array<{
    id: FrameId;
    bounds?: [number, number, number, number];
    applied_paragraph_style?: string;
  }>;
  new_frames?: Array<{ id: FrameId; type: string }>;
  removed_frame_ids?: FrameId[];
  new_page_ids?: string[];
  removed_page_ids?: string[];
  page_count?: number;
}
```

- [ ] **Step 4: Run tests + tsc**

Run: `npx tsc --noEmit && npm test`
Expected: clean tsc, all tests pass (98/98 — 97 prior + 1 new).

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/plan-b2
git add src/types.ts tests/unit/types.test.ts
git commit -m "feat: changed_frames items accept optional applied_paragraph_style"
```

---

## Task 2: Add `findFrameById` and `findStyleByName` helpers

**Why:** B2's tools need to resolve frame IDs and paragraph style names inside ExtendScript. Add them once to the shared `script-helpers.ts` so all tools can include them via `prelude(...)`.

**Files:**
- Modify: `src/script-helpers.ts`
- Modify: `tests/unit/script-helpers.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/script-helpers.test.ts` (inside the existing describe block):

```ts
  it("findFrameById is a non-empty function declaration", () => {
    expect(findFrameById).toContain("function findFrameById");
    expect(findFrameById).toContain('throw { name: "not_found"');
    expect(findFrameById).toContain("doc.pageItems");
  });

  it("findStyleByName is a non-empty function declaration", () => {
    expect(findStyleByName).toContain("function findStyleByName");
    expect(findStyleByName).toContain('throw { name: "not_found"');
    expect(findStyleByName).toContain("doc.paragraphStyles.itemByName");
  });
```

Add the imports at the top of the file:

```ts
import { findDocumentById, findPageById, findFrameById, findStyleByName } from "../../src/script-helpers.js";
```

(If `findDocumentById` and `findPageById` are already imported, just extend the import list.)

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/unit/script-helpers.test.ts`
Expected: import errors for the missing exports.

- [ ] **Step 3: Add the helpers to `src/script-helpers.ts`**

Append to the file:

```ts
export const findFrameById = `
function findFrameById(doc, id) {
  for (var i = 0; i < doc.pageItems.length; i++) {
    if (String(doc.pageItems[i].id) === id) return doc.pageItems[i];
  }
  throw { name: "not_found", message: "frame " + id + " not found", entity: "frame", id: id };
}
`.trim();

export const findStyleByName = `
function findStyleByName(doc, name) {
  var s = doc.paragraphStyles.itemByName(name);
  if (!s.isValid) {
    throw { name: "not_found", message: "paragraph style \\"" + name + "\\" not found", entity: "paragraph_style", id: name };
  }
  return s;
}
`.trim();
```

- [ ] **Step 4: Run, expect pass**

Run: `npm test`
Expected: 100/100 pass (98 prior + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/script-helpers.ts tests/unit/script-helpers.test.ts
git commit -m "feat: findFrameById and findStyleByName script helpers"
```

---

## Task 3: `create_text_frame` tool

**Why:** First text-related tool. Establishes the bounds-in-mm convention for B2 (and B3) frame-creation tools.

**Files:**
- Create: `src/tools/create-text-frame.ts`
- Create: `tests/unit/tools/create-text-frame.test.ts`
- Create: `tests/integration/create-text-frame.int.test.ts`
- Modify: `src/index.ts`

### Step 1: Write the unit test file

- [ ] Create `tests/unit/tools/create-text-frame.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTextFrameTool } from "../../../src/tools/create-text-frame.js";
import { lastCall, expectFailure } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("create_text_frame tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(createTextFrameTool.name).toBe("create_text_frame");
    expect(createTextFrameTool.description.length).toBeGreaterThan(0);
  });

  it("accepts a minimal valid input", () => {
    const result = createTextFrameTool.inputSchema.safeParse({
      page_id: "p1",
      bounds_mm: { x: 10, y: 10, width: 100, height: 50 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects zero or negative width/height", () => {
    expect(
      createTextFrameTool.inputSchema.safeParse({
        page_id: "p1",
        bounds_mm: { x: 10, y: 10, width: 0, height: 50 },
      }).success,
    ).toBe(false);
    expect(
      createTextFrameTool.inputSchema.safeParse({
        page_id: "p1",
        bounds_mm: { x: 10, y: 10, width: 100, height: -1 },
      }).success,
    ).toBe(false);
  });

  it("rejects negative x/y", () => {
    expect(
      createTextFrameTool.inputSchema.safeParse({
        page_id: "p1",
        bounds_mm: { x: -1, y: 10, width: 100, height: 50 },
      }).success,
    ).toBe(false);
  });

  it("accepts initial_text", () => {
    expect(
      createTextFrameTool.inputSchema.safeParse({
        page_id: "p1",
        bounds_mm: { x: 10, y: 10, width: 100, height: 50 },
        initial_text: "Hello, world",
      }).success,
    ).toBe(true);
  });

  it("dispatches a script that converts {x,y,w,h} to InDesign's [y1,x1,y2,x2] geometricBounds", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { frame_id: "f1", page_id: "p1" },
    });

    await createTextFrameTool.handler({
      page_id: "p1",
      bounds_mm: { x: 10, y: 20, width: 100, height: 50 },
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.language).toBe("JavaScript");
    // geometricBounds is [y1, x1, y2, x2] where x2 = x1 + width, y2 = y1 + height
    // so for {x:10, y:20, width:100, height:50} → [20, 10, 70, 110]
    expect(arg.scriptTemplate).toContain("[20, 10, 70, 110]");
  });

  it("dispatches a script that sets initial_text when provided", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { frame_id: "f1", page_id: "p1" },
    });

    await createTextFrameTool.handler({
      page_id: "p1",
      bounds_mm: { x: 10, y: 20, width: 100, height: 50 },
      initial_text: "Headline goes here",
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain('"Headline goes here"');
    expect(arg.scriptTemplate).toContain("frame.contents");
  });

  it("returns the frame and document_state_delta", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { frame_id: "f7", page_id: "p1" },
    });

    const env = await createTextFrameTool.handler({
      page_id: "p1",
      bounds_mm: { x: 10, y: 10, width: 100, height: 50 },
    });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result).toEqual({ frame_id: "f7", page_id: "p1" });
    expect(env.document_state_delta).toEqual({
      new_frames: [{ id: "f7", type: "text" }],
    });
  });

  it("propagates failure envelopes verbatim", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: { kind: "not_found", message: "page p99 not found", entity: "page", id: "p99" },
    });

    const env = await createTextFrameTool.handler({
      page_id: "p99",
      bounds_mm: { x: 10, y: 10, width: 100, height: 50 },
    });

    expectFailure(env);
    expect(env.error.kind).toBe("not_found");
  });
});
```

- [ ] **Step 2: Run, expect failure (module not found)**

Run: `npm test -- tests/unit/tools/create-text-frame.test.ts`

### Step 3: Write the tool source

- [ ] Create `src/tools/create-text-frame.ts`:

```ts
import { z } from "zod";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript, lit, prelude } from "../compose.js";
import { findDocumentById, findPageById } from "../script-helpers.js";
import { ok } from "../errors.js";

const InputSchema = z
  .object({
    page_id: z.string(),
    bounds_mm: z.object({
      x: z.number().nonnegative(),
      y: z.number().nonnegative(),
      width: z.number().positive(),
      height: z.number().positive(),
    }),
    initial_text: z.string().optional(),
    document_id: z.string().optional(),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

const ScriptResultSchema = z.object({
  frame_id: z.string(),
  page_id: z.string(),
});

type ScriptResult = z.infer<typeof ScriptResultSchema>;

interface Result {
  frame_id: string;
  page_id: string;
}

function buildScriptBody(input: Input): string {
  const docExpr =
    input.document_id !== undefined
      ? `findDocumentById(${lit(input.document_id)})`
      : "app.activeDocument";

  // InDesign geometricBounds is [y1, x1, y2, x2].
  const { x, y, width, height } = input.bounds_mm;
  const y2 = y + height;
  const x2 = x + width;

  const setInitial =
    input.initial_text !== undefined
      ? `frame.contents = ${lit(input.initial_text)};`
      : "";

  return `
${prelude(findDocumentById, findPageById)}
var prevUnits = app.scriptPreferences.measurementUnit;
app.scriptPreferences.measurementUnit = MeasurementUnits.MILLIMETERS;
try {
  var doc = ${docExpr};
  var page = findPageById(doc, ${lit(input.page_id)});
  var frame = page.textFrames.add({
    geometricBounds: [${y}, ${x}, ${y2}, ${x2}]
  });
  ${setInitial}
  return {
    frame_id: String(frame.id),
    page_id: ${lit(input.page_id)}
  };
} finally {
  app.scriptPreferences.measurementUnit = prevUnits;
}
`;
}

export const createTextFrameTool = defineTool<Input, Result>({
  name: "create_text_frame",
  description:
    "Creates an empty text frame on a specified page with the given bounds (in mm). Optionally sets initial text content. Returns the frame and page IDs.",
  inputSchema: InputSchema,
  async handler(input) {
    const env = await runScriptWithResultFile<ScriptResult>({
      language: "JavaScript",
      scriptTemplate: wrapExtendScript(buildScriptBody(input)),
      resultSchema: ScriptResultSchema,
    });
    if (!env.ok) return env;
    const r = env.result!;
    return ok(
      { frame_id: r.frame_id, page_id: r.page_id },
      {
        document_state_delta: {
          new_frames: [{ id: r.frame_id, type: "text" }],
        },
      },
    );
  },
});
```

- [ ] **Step 4: Register in `src/index.ts`**

Add the import alongside the existing tool imports:

```ts
import { createTextFrameTool } from "./tools/create-text-frame.js";
```

And after the existing `registry.register(...)` calls add:

```ts
registry.register(createTextFrameTool);
```

- [ ] **Step 5: Run unit tests, expect pass**

Run: `npm test -- tests/unit/tools/create-text-frame.test.ts`
Expected: 9/9 pass.

- [ ] **Step 6: Run full suite + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: 109/109 pass, tsc clean.

- [ ] **Step 7: Write integration test**

Create `tests/integration/create-text-frame.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { createTextFrameTool } from "../../src/tools/create-text-frame.js";

integrationGate("create_text_frame (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "creates a text frame on a fresh A4 page",
    async () => {
      const create = await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });
      expect(create.ok).toBe(true);
      if (!create.ok) return;
      const pageId = create.result!.page_ids[0];

      const env = await createTextFrameTool.handler({
        page_id: pageId,
        bounds_mm: { x: 12, y: 12, width: 186, height: 50 },
        initial_text: "Hello, world",
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(typeof env.result?.frame_id).toBe("string");
      expect(env.result?.page_id).toBe(pageId);
      expect(env.document_state_delta?.new_frames?.[0].id).toBe(env.result?.frame_id);
      expect(env.document_state_delta?.new_frames?.[0].type).toBe("text");
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "returns not_found for a missing page",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      const env = await createTextFrameTool.handler({
        page_id: "999999",
        bounds_mm: { x: 10, y: 10, width: 100, height: 50 },
      });
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.kind).toBe("not_found");
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
```

- [ ] **Step 8: Verify tsc**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/tools/create-text-frame.ts src/index.ts tests/unit/tools/create-text-frame.test.ts tests/integration/create-text-frame.int.test.ts
git commit -m "feat: create_text_frame tool"
```

---

## Task 4: `set_text` tool

**Why:** Replaces a frame's text content. Smaller surface than `create_text_frame` — just lookup + assignment.

**Files:**
- Create: `src/tools/set-text.ts`
- Create: `tests/unit/tools/set-text.test.ts`
- Create: `tests/integration/set-text.int.test.ts`
- Modify: `src/index.ts`

### Step 1: Write the unit test file

- [ ] Create `tests/unit/tools/set-text.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setTextTool } from "../../../src/tools/set-text.js";
import { lastCall, expectFailure } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("set_text tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(setTextTool.name).toBe("set_text");
    expect(setTextTool.description.length).toBeGreaterThan(0);
  });

  it("accepts minimal valid input", () => {
    expect(
      setTextTool.inputSchema.safeParse({
        frame_id: "f1",
        text: "Hello",
      }).success,
    ).toBe(true);
  });

  it("requires frame_id and text", () => {
    expect(setTextTool.inputSchema.safeParse({ text: "x" }).success).toBe(false);
    expect(setTextTool.inputSchema.safeParse({ frame_id: "f1" }).success).toBe(false);
  });

  it("dispatches a script that assigns text to frame.contents", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { frame_id: "f1", character_count: 5 },
    });

    await setTextTool.handler({ frame_id: "f1", text: "Hello" });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("frame.contents");
    expect(arg.scriptTemplate).toContain('"Hello"');
    expect(arg.scriptTemplate).toContain('"f1"');
  });

  it("escapes special characters via lit()", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { frame_id: "f1", character_count: 13 },
    });

    await setTextTool.handler({
      frame_id: "f1",
      text: 'She said "hi"',
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    // The string is JSON-stringified by lit() so quotes are escaped to \"
    expect(arg.scriptTemplate).toContain('She said');
  });

  it("returns frame_id and character_count on success", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { frame_id: "f1", character_count: 5 },
    });

    const env = await setTextTool.handler({ frame_id: "f1", text: "Hello" });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result).toEqual({ frame_id: "f1", character_count: 5 });
    // No state delta on text-content change
    expect(env.document_state_delta).toBeUndefined();
  });

  it("propagates failure envelopes verbatim", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: { kind: "not_found", message: "frame f99 not found", entity: "frame", id: "f99" },
    });

    const env = await setTextTool.handler({ frame_id: "f99", text: "x" });

    expectFailure(env);
    expect(env.error.kind).toBe("not_found");
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/unit/tools/set-text.test.ts`

### Step 3: Write the tool source

- [ ] Create `src/tools/set-text.ts`:

```ts
import { z } from "zod";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript, lit, prelude } from "../compose.js";
import { findDocumentById, findFrameById } from "../script-helpers.js";

const InputSchema = z
  .object({
    frame_id: z.string(),
    text: z.string(),
    document_id: z.string().optional(),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

const ScriptResultSchema = z.object({
  frame_id: z.string(),
  character_count: z.number().int().nonnegative(),
});

type ScriptResult = z.infer<typeof ScriptResultSchema>;

interface Result {
  frame_id: string;
  character_count: number;
}

function buildScriptBody(input: Input): string {
  const docExpr =
    input.document_id !== undefined
      ? `findDocumentById(${lit(input.document_id)})`
      : "app.activeDocument";

  return `
${prelude(findDocumentById, findFrameById)}
var doc = ${docExpr};
var frame = findFrameById(doc, ${lit(input.frame_id)});
if (frame.constructor.name !== "TextFrame") {
  throw { name: "not_found", message: "frame " + ${lit(input.frame_id)} + " is not a text frame", entity: "frame", id: ${lit(input.frame_id)} };
}
frame.contents = ${lit(input.text)};
return {
  frame_id: ${lit(input.frame_id)},
  character_count: frame.contents.length
};
`;
}

export const setTextTool = defineTool<Input, Result>({
  name: "set_text",
  description:
    "Replaces all text content in a text frame. Returns the frame ID and resulting character count.",
  inputSchema: InputSchema,
  async handler(input) {
    return runScriptWithResultFile<ScriptResult>({
      language: "JavaScript",
      scriptTemplate: wrapExtendScript(buildScriptBody(input)),
      resultSchema: ScriptResultSchema,
    });
  },
});
```

- [ ] **Step 4: Register in `src/index.ts`**

```ts
import { setTextTool } from "./tools/set-text.js";
// ...
registry.register(setTextTool);
```

- [ ] **Step 5: Run unit tests, expect pass**

Run: `npm test -- tests/unit/tools/set-text.test.ts`
Expected: 7/7 pass.

- [ ] **Step 6: Run full suite + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: 116/116 pass, tsc clean.

- [ ] **Step 7: Write integration test**

Create `tests/integration/set-text.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { createTextFrameTool } from "../../src/tools/create-text-frame.js";
import { setTextTool } from "../../src/tools/set-text.js";

integrationGate("set_text (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "replaces text content in an existing frame",
    async () => {
      const create = await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });
      if (!create.ok) return;
      const pageId = create.result!.page_ids[0];

      const frame = await createTextFrameTool.handler({
        page_id: pageId,
        bounds_mm: { x: 12, y: 12, width: 186, height: 50 },
        initial_text: "Old",
      });
      if (!frame.ok) return;

      const env = await setTextTool.handler({
        frame_id: frame.result!.frame_id,
        text: "New body content here",
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result?.character_count).toBe(21);
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
```

- [ ] **Step 8: Verify tsc**

Run: `npx tsc --noEmit`

- [ ] **Step 9: Commit**

```bash
git add src/tools/set-text.ts src/index.ts tests/unit/tools/set-text.test.ts tests/integration/set-text.int.test.ts
git commit -m "feat: set_text tool"
```

---

## Task 5: `define_paragraph_style` tool

**Why:** Largest tool in B2 — handles the full attribute surface (font family/style, size, leading, alignment, color, spacing) plus collision handling and color-swatch creation.

**Files:**
- Create: `src/tools/define-paragraph-style.ts`
- Create: `tests/unit/tools/define-paragraph-style.test.ts`
- Create: `tests/integration/define-paragraph-style.int.test.ts`
- Modify: `src/index.ts`

### Step 1: Write the unit test file

- [ ] Create `tests/unit/tools/define-paragraph-style.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineParagraphStyleTool } from "../../../src/tools/define-paragraph-style.js";
import { lastCall, expectFailure } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("define_paragraph_style tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(defineParagraphStyleTool.name).toBe("define_paragraph_style");
    expect(defineParagraphStyleTool.description.length).toBeGreaterThan(0);
  });

  it("accepts minimal input (just name)", () => {
    expect(
      defineParagraphStyleTool.inputSchema.safeParse({ name: "Body" }).success,
    ).toBe(true);
  });

  it("rejects empty name", () => {
    expect(
      defineParagraphStyleTool.inputSchema.safeParse({ name: "" }).success,
    ).toBe(false);
  });

  it("rejects font_style without font_family", () => {
    expect(
      defineParagraphStyleTool.inputSchema.safeParse({
        name: "Body",
        font_style: "Bold",
      }).success,
    ).toBe(false);
  });

  it("accepts font_family alone (no font_style)", () => {
    expect(
      defineParagraphStyleTool.inputSchema.safeParse({
        name: "Body",
        font_family: "Helvetica Neue",
      }).success,
    ).toBe(true);
  });

  it("accepts font_family + font_style", () => {
    expect(
      defineParagraphStyleTool.inputSchema.safeParse({
        name: "Body",
        font_family: "Helvetica Neue",
        font_style: "Bold",
      }).success,
    ).toBe(true);
  });

  it("rejects invalid color_hex format", () => {
    expect(
      defineParagraphStyleTool.inputSchema.safeParse({
        name: "Body",
        color_hex: "red",
      }).success,
    ).toBe(false);
    expect(
      defineParagraphStyleTool.inputSchema.safeParse({
        name: "Body",
        color_hex: "#XYZ",
      }).success,
    ).toBe(false);
    expect(
      defineParagraphStyleTool.inputSchema.safeParse({
        name: "Body",
        color_hex: "#FF",
      }).success,
    ).toBe(false);
  });

  it("accepts valid color_hex (case-insensitive)", () => {
    expect(
      defineParagraphStyleTool.inputSchema.safeParse({
        name: "Body",
        color_hex: "#FF0000",
      }).success,
    ).toBe(true);
    expect(
      defineParagraphStyleTool.inputSchema.safeParse({
        name: "Body",
        color_hex: "#ff0000",
      }).success,
    ).toBe(true);
  });

  it("rejects size_pt <= 0", () => {
    expect(
      defineParagraphStyleTool.inputSchema.safeParse({
        name: "Body",
        size_pt: 0,
      }).success,
    ).toBe(false);
    expect(
      defineParagraphStyleTool.inputSchema.safeParse({
        name: "Body",
        size_pt: -1,
      }).success,
    ).toBe(false);
  });

  it("accepts leading_pt as 'auto'", () => {
    expect(
      defineParagraphStyleTool.inputSchema.safeParse({
        name: "Body",
        leading_pt: "auto",
      }).success,
    ).toBe(true);
  });

  it("dispatches a script that interpolates the style name", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { style_id: "s1", name: "Body" },
    });

    await defineParagraphStyleTool.handler({ name: "Body" });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain('"Body"');
    expect(arg.scriptTemplate).toContain("paragraphStyles");
  });

  it("dispatches a script that converts color_hex to RGB triple [255, 0, 0]", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { style_id: "s1", name: "Headline", swatch_id: "sw1" },
    });

    await defineParagraphStyleTool.handler({
      name: "Headline",
      color_hex: "#FF0000",
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("[255, 0, 0]");
    expect(arg.scriptTemplate).toContain("auto-#FF0000");
  });

  it("uppercases color_hex when constructing the swatch name", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { style_id: "s1", name: "Headline", swatch_id: "sw1" },
    });

    await defineParagraphStyleTool.handler({
      name: "Headline",
      color_hex: "#abcdef",
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("auto-#ABCDEF");
  });

  it("dispatches a script that joins font_family / font_style with ' / '", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { style_id: "s1", name: "Headline" },
    });

    await defineParagraphStyleTool.handler({
      name: "Headline",
      font_family: "Helvetica Neue",
      font_style: "Bold",
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain('"Helvetica Neue\\t');
  });

  it("accepts on_collision: 'replace' / 'version' / 'error'", () => {
    for (const c of ["error", "replace", "version"] as const) {
      expect(
        defineParagraphStyleTool.inputSchema.safeParse({
          name: "Body",
          on_collision: c,
        }).success,
      ).toBe(true);
    }
  });

  it("returns style_id and name", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { style_id: "s7", name: "Body" },
    });

    const env = await defineParagraphStyleTool.handler({ name: "Body" });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result).toEqual({ style_id: "s7", name: "Body" });
  });

  it("returns swatch_id when color was provided", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { style_id: "s1", name: "Body", swatch_id: "sw1" },
    });

    const env = await defineParagraphStyleTool.handler({
      name: "Body",
      color_hex: "#000000",
    });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result).toEqual({ style_id: "s1", name: "Body", swatch_id: "sw1" });
  });

  it("propagates name_collision failures verbatim", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: { kind: "name_collision", message: "style 'Body' already exists" },
    });

    const env = await defineParagraphStyleTool.handler({ name: "Body" });

    expectFailure(env);
    expect(env.error.kind).toBe("name_collision");
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/unit/tools/define-paragraph-style.test.ts`

### Step 3: Write the tool source

- [ ] Create `src/tools/define-paragraph-style.ts`:

```ts
import { z } from "zod";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript, lit, prelude } from "../compose.js";
import { findDocumentById } from "../script-helpers.js";

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

const InputSchema = z
  .object({
    name: z.string().min(1),
    font_family: z.string().optional(),
    font_style: z.string().optional(),
    size_pt: z.number().positive().optional(),
    leading_pt: z.union([z.number().nonnegative(), z.literal("auto")]).optional(),
    alignment: z.enum(["left", "center", "right", "justify"]).optional(),
    color_hex: z.string().regex(HEX_COLOR_RE).optional(),
    space_before_pt: z.number().nonnegative().optional(),
    space_after_pt: z.number().nonnegative().optional(),
    on_collision: z.enum(["error", "replace", "version"]).optional(),
    document_id: z.string().optional(),
  })
  .strict()
  .refine(
    (data) => !(data.font_style !== undefined && data.font_family === undefined),
    { message: "`font_style` requires `font_family`" },
  );

type Input = z.infer<typeof InputSchema>;

const ScriptResultSchema = z.object({
  style_id: z.string(),
  name: z.string(),
  swatch_id: z.string().optional(),
});

type ScriptResult = z.infer<typeof ScriptResultSchema>;

interface Result {
  style_id: string;
  name: string;
  swatch_id?: string;
}

function hexToRgb(hex: string): [number, number, number] {
  const upper = hex.toUpperCase();
  return [
    parseInt(upper.slice(1, 3), 16),
    parseInt(upper.slice(3, 5), 16),
    parseInt(upper.slice(5, 7), 16),
  ];
}

function buildScriptBody(input: Input): string {
  const docExpr =
    input.document_id !== undefined
      ? `findDocumentById(${lit(input.document_id)})`
      : "app.activeDocument";

  const onCollision = input.on_collision ?? "error";

  // Color setup (if provided). When unset, swatchId remains undefined and is
  // omitted from the returned object so the Zod schema's optional swatch_id
  // sees an absent key rather than a null.
  let colorSetup = "var swatchId;";
  if (input.color_hex !== undefined) {
    const upperHex = input.color_hex.toUpperCase();
    const swatchName = `auto-${upperHex}`;
    const [r, g, b] = hexToRgb(upperHex);
    colorSetup = `
      var swatchName = ${lit(swatchName)};
      var swatch = doc.colors.itemByName(swatchName);
      if (!swatch.isValid) {
        swatch = doc.colors.add({
          name: swatchName,
          model: ColorModel.PROCESS,
          space: ColorSpace.RGB,
          colorValue: [${r}, ${g}, ${b}]
        });
      }
      var swatchId = String(swatch.id);
    `;
  }

  // Font setup
  let fontSetup = "";
  if (input.font_family !== undefined) {
    const fontName =
      input.font_style !== undefined
        ? `${input.font_family}\t${input.font_style}`
        : input.font_family;
    fontSetup = `style.appliedFont = ${lit(fontName)};`;
  }

  // Attribute assignments
  const attrs: string[] = [];
  if (input.size_pt !== undefined) attrs.push(`style.pointSize = ${input.size_pt};`);
  if (input.leading_pt !== undefined) {
    if (input.leading_pt === "auto") {
      attrs.push(`style.leading = Leading.AUTO;`);
    } else {
      attrs.push(`style.leading = ${input.leading_pt};`);
    }
  }
  if (input.alignment !== undefined) {
    const enumName = {
      left: "LEFT_ALIGN",
      center: "CENTER_ALIGN",
      right: "RIGHT_ALIGN",
      justify: "LEFT_JUSTIFIED",
    }[input.alignment];
    attrs.push(`style.justification = Justification.${enumName};`);
  }
  if (input.color_hex !== undefined) {
    attrs.push(`style.fillColor = swatch;`);
  }
  if (input.space_before_pt !== undefined)
    attrs.push(`style.spaceBefore = ${input.space_before_pt};`);
  if (input.space_after_pt !== undefined)
    attrs.push(`style.spaceAfter = ${input.space_after_pt};`);

  // Collision handling
  const collisionBlock =
    onCollision === "error"
      ? `
        var existing = doc.paragraphStyles.itemByName(name);
        if (existing.isValid) {
          throw { name: "name_collision", message: "paragraph style \\"" + name + "\\" already exists", entity: "paragraph_style", id: name };
        }
        var style = doc.paragraphStyles.add({ name: name });
      `
      : onCollision === "replace"
        ? `
        var existing = doc.paragraphStyles.itemByName(name);
        var style = existing.isValid ? existing : doc.paragraphStyles.add({ name: name });
      `
        : `
        var baseName = name;
        var i = 2;
        while (doc.paragraphStyles.itemByName(name).isValid) {
          name = baseName + " " + i;
          i++;
        }
        var style = doc.paragraphStyles.add({ name: name });
      `;

  return `
${prelude(findDocumentById)}
var doc = ${docExpr};
var name = ${lit(input.name)};
${collisionBlock}
${colorSetup}
${fontSetup}
${attrs.join("\n")}
var result = {
  style_id: String(style.id),
  name: name
};
if (swatchId !== undefined) result.swatch_id = swatchId;
return result;
`;
}

export const defineParagraphStyleTool = defineTool<Input, Result>({
  name: "define_paragraph_style",
  description:
    "Creates a paragraph style with the given attributes. Auto-creates an RGB swatch when color_hex is provided. Returns the style ID and final name (which may differ from the input if on_collision is 'version').",
  inputSchema: InputSchema,
  async handler(input) {
    return runScriptWithResultFile<ScriptResult>({
      language: "JavaScript",
      scriptTemplate: wrapExtendScript(buildScriptBody(input)),
      resultSchema: ScriptResultSchema,
    });
  },
});
```

- [ ] **Step 4: Register in `src/index.ts`**

```ts
import { defineParagraphStyleTool } from "./tools/define-paragraph-style.js";
// ...
registry.register(defineParagraphStyleTool);
```

- [ ] **Step 5: Run unit tests, expect pass**

Run: `npm test -- tests/unit/tools/define-paragraph-style.test.ts`
Expected: 16/16 pass.

- [ ] **Step 6: Run full suite + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: 132/132 pass, tsc clean.

- [ ] **Step 7: Write integration test**

Create `tests/integration/define-paragraph-style.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { defineParagraphStyleTool } from "../../src/tools/define-paragraph-style.js";

integrationGate("define_paragraph_style (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "creates a basic paragraph style",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      const env = await defineParagraphStyleTool.handler({
        name: "Body",
        size_pt: 11,
        leading_pt: 14,
        alignment: "left",
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result?.name).toBe("Body");
      expect(typeof env.result?.style_id).toBe("string");
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "creates a paragraph style with color, returns swatch_id",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      const env = await defineParagraphStyleTool.handler({
        name: "Headline",
        size_pt: 36,
        color_hex: "#FF6600",
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(typeof env.result?.swatch_id).toBe("string");
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "name_collision when style exists and on_collision is 'error'",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      const first = await defineParagraphStyleTool.handler({ name: "Body" });
      expect(first.ok).toBe(true);

      const second = await defineParagraphStyleTool.handler({
        name: "Body",
        on_collision: "error",
      });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.kind).toBe("name_collision");
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "on_collision 'version' creates 'Body 2' when 'Body' exists",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      const first = await defineParagraphStyleTool.handler({ name: "Body" });
      expect(first.ok).toBe(true);

      const second = await defineParagraphStyleTool.handler({
        name: "Body",
        on_collision: "version",
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.result?.name).toBe("Body 2");
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
```

- [ ] **Step 8: Verify tsc**

Run: `npx tsc --noEmit`

- [ ] **Step 9: Commit**

```bash
git add src/tools/define-paragraph-style.ts src/index.ts tests/unit/tools/define-paragraph-style.test.ts tests/integration/define-paragraph-style.int.test.ts
git commit -m "feat: define_paragraph_style tool"
```

---

## Task 6: `apply_paragraph_style` tool

**Why:** Applies a previously defined style to a frame's text. Pairs with `define_paragraph_style` and produces the `applied_paragraph_style` delta entry.

**Files:**
- Create: `src/tools/apply-paragraph-style.ts`
- Create: `tests/unit/tools/apply-paragraph-style.test.ts`
- Create: `tests/integration/apply-paragraph-style.int.test.ts`
- Modify: `src/index.ts`

### Step 1: Write the unit test file

- [ ] Create `tests/unit/tools/apply-paragraph-style.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyParagraphStyleTool } from "../../../src/tools/apply-paragraph-style.js";
import { lastCall, expectFailure } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("apply_paragraph_style tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(applyParagraphStyleTool.name).toBe("apply_paragraph_style");
    expect(applyParagraphStyleTool.description.length).toBeGreaterThan(0);
  });

  it("requires frame_id and style_name", () => {
    expect(
      applyParagraphStyleTool.inputSchema.safeParse({ frame_id: "f1" }).success,
    ).toBe(false);
    expect(
      applyParagraphStyleTool.inputSchema.safeParse({ style_name: "Body" }).success,
    ).toBe(false);
  });

  it("accepts minimal valid input", () => {
    expect(
      applyParagraphStyleTool.inputSchema.safeParse({
        frame_id: "f1",
        style_name: "Body",
      }).success,
    ).toBe(true);
  });

  it("dispatches a script that resolves both frame and style", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { frame_id: "f1", style_name: "Body", affected_paragraphs: 3 },
    });

    await applyParagraphStyleTool.handler({ frame_id: "f1", style_name: "Body" });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("findFrameById");
    expect(arg.scriptTemplate).toContain("findStyleByName");
    expect(arg.scriptTemplate).toContain("applyParagraphStyle");
  });

  it("returns frame_id, style_name, affected_paragraphs, and changed_frames delta", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { frame_id: "f1", style_name: "Body", affected_paragraphs: 5 },
    });

    const env = await applyParagraphStyleTool.handler({
      frame_id: "f1",
      style_name: "Body",
    });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result).toEqual({
      frame_id: "f1",
      style_name: "Body",
      affected_paragraphs: 5,
    });
    expect(env.document_state_delta).toEqual({
      changed_frames: [{ id: "f1", applied_paragraph_style: "Body" }],
    });
  });

  it("propagates not_found failures verbatim", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: {
        kind: "not_found",
        message: "paragraph style not found",
        entity: "paragraph_style",
        id: "Missing",
      },
    });

    const env = await applyParagraphStyleTool.handler({
      frame_id: "f1",
      style_name: "Missing",
    });

    expectFailure(env);
    expect(env.error.kind).toBe("not_found");
    expect(env.error.entity).toBe("paragraph_style");
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/unit/tools/apply-paragraph-style.test.ts`

### Step 3: Write the tool source

- [ ] Create `src/tools/apply-paragraph-style.ts`:

```ts
import { z } from "zod";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript, lit, prelude } from "../compose.js";
import {
  findDocumentById,
  findFrameById,
  findStyleByName,
} from "../script-helpers.js";
import { ok } from "../errors.js";

const InputSchema = z
  .object({
    frame_id: z.string(),
    style_name: z.string(),
    document_id: z.string().optional(),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

const ScriptResultSchema = z.object({
  frame_id: z.string(),
  style_name: z.string(),
  affected_paragraphs: z.number().int().nonnegative(),
});

type ScriptResult = z.infer<typeof ScriptResultSchema>;

interface Result {
  frame_id: string;
  style_name: string;
  affected_paragraphs: number;
}

function buildScriptBody(input: Input): string {
  const docExpr =
    input.document_id !== undefined
      ? `findDocumentById(${lit(input.document_id)})`
      : "app.activeDocument";

  return `
${prelude(findDocumentById, findFrameById, findStyleByName)}
var doc = ${docExpr};
var frame = findFrameById(doc, ${lit(input.frame_id)});
if (frame.constructor.name !== "TextFrame") {
  throw { name: "not_found", message: "frame " + ${lit(input.frame_id)} + " is not a text frame", entity: "frame", id: ${lit(input.frame_id)} };
}
var style = findStyleByName(doc, ${lit(input.style_name)});
var paragraphs = frame.parentStory.paragraphs;
paragraphs.everyItem().applyParagraphStyle(style, true);
return {
  frame_id: ${lit(input.frame_id)},
  style_name: ${lit(input.style_name)},
  affected_paragraphs: paragraphs.length
};
`;
}

export const applyParagraphStyleTool = defineTool<Input, Result>({
  name: "apply_paragraph_style",
  description:
    "Applies a paragraph style by name to all paragraphs in a text frame, clearing local overrides. Returns the affected paragraph count.",
  inputSchema: InputSchema,
  async handler(input) {
    const env = await runScriptWithResultFile<ScriptResult>({
      language: "JavaScript",
      scriptTemplate: wrapExtendScript(buildScriptBody(input)),
      resultSchema: ScriptResultSchema,
    });
    if (!env.ok) return env;
    const r = env.result!;
    return ok(
      {
        frame_id: r.frame_id,
        style_name: r.style_name,
        affected_paragraphs: r.affected_paragraphs,
      },
      {
        document_state_delta: {
          changed_frames: [
            { id: r.frame_id, applied_paragraph_style: r.style_name },
          ],
        },
      },
    );
  },
});
```

- [ ] **Step 4: Register in `src/index.ts`**

```ts
import { applyParagraphStyleTool } from "./tools/apply-paragraph-style.js";
// ...
registry.register(applyParagraphStyleTool);
```

- [ ] **Step 5: Run unit tests, expect pass**

Run: `npm test -- tests/unit/tools/apply-paragraph-style.test.ts`
Expected: 6/6 pass.

- [ ] **Step 6: Run full suite + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: 138/138 pass, tsc clean.

- [ ] **Step 7: Write integration test**

Create `tests/integration/apply-paragraph-style.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { createTextFrameTool } from "../../src/tools/create-text-frame.js";
import { setTextTool } from "../../src/tools/set-text.js";
import { defineParagraphStyleTool } from "../../src/tools/define-paragraph-style.js";
import { applyParagraphStyleTool } from "../../src/tools/apply-paragraph-style.js";

integrationGate("apply_paragraph_style (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "applies a defined style to a frame with text",
    async () => {
      const create = await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });
      if (!create.ok) return;

      const frame = await createTextFrameTool.handler({
        page_id: create.result!.page_ids[0],
        bounds_mm: { x: 12, y: 12, width: 186, height: 100 },
      });
      if (!frame.ok) return;

      await setTextTool.handler({
        frame_id: frame.result!.frame_id,
        text: "First paragraph.\nSecond paragraph.\nThird paragraph.",
      });

      await defineParagraphStyleTool.handler({
        name: "Body",
        size_pt: 11,
        leading_pt: 14,
      });

      const env = await applyParagraphStyleTool.handler({
        frame_id: frame.result!.frame_id,
        style_name: "Body",
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result?.affected_paragraphs).toBe(3);
      expect(env.document_state_delta?.changed_frames?.[0].applied_paragraph_style).toBe("Body");
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "returns not_found for a missing style",
    async () => {
      const create = await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });
      if (!create.ok) return;

      const frame = await createTextFrameTool.handler({
        page_id: create.result!.page_ids[0],
        bounds_mm: { x: 12, y: 12, width: 186, height: 50 },
      });
      if (!frame.ok) return;

      const env = await applyParagraphStyleTool.handler({
        frame_id: frame.result!.frame_id,
        style_name: "DoesNotExist",
      });
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.kind).toBe("not_found");
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
```

- [ ] **Step 8: Verify tsc**

Run: `npx tsc --noEmit`

- [ ] **Step 9: Commit**

```bash
git add src/tools/apply-paragraph-style.ts src/index.ts tests/unit/tools/apply-paragraph-style.test.ts tests/integration/apply-paragraph-style.int.test.ts
git commit -m "feat: apply_paragraph_style tool"
```

---

## Task 7: `get_page_state` tool

**Why:** First read-only state tool. Claude's feedback channel for verifying its layout work. Walks page items and reports their type, bounds, applied style, and content snippet.

**Files:**
- Create: `src/tools/get-page-state.ts`
- Create: `tests/unit/tools/get-page-state.test.ts`
- Create: `tests/integration/get-page-state.int.test.ts`
- Modify: `src/index.ts`

### Step 1: Write the unit test file

- [ ] Create `tests/unit/tools/get-page-state.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getPageStateTool } from "../../../src/tools/get-page-state.js";
import { lastCall, expectFailure } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("get_page_state tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(getPageStateTool.name).toBe("get_page_state");
    expect(getPageStateTool.description.length).toBeGreaterThan(0);
  });

  it("requires page_id", () => {
    expect(getPageStateTool.inputSchema.safeParse({}).success).toBe(false);
  });

  it("accepts page_id alone", () => {
    expect(
      getPageStateTool.inputSchema.safeParse({ page_id: "p1" }).success,
    ).toBe(true);
  });

  it("dispatches a script that resolves the page and walks pageItems", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        page_id: "p1",
        page_index: 0,
        bounds_mm: { x: 0, y: 0, width: 210, height: 297 },
        frames: [],
      },
    });

    await getPageStateTool.handler({ page_id: "p1" });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("findPageById");
    expect(arg.scriptTemplate).toContain("pageItems");
  });

  it("returns the full page state on success", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        page_id: "p1",
        page_index: 0,
        bounds_mm: { x: 0, y: 0, width: 210, height: 297 },
        frames: [
          {
            id: "f1",
            type: "text",
            bounds_mm: { x: 12, y: 12, width: 186, height: 50 },
            paragraph_style_name: "Body",
            text_snippet: "Hello world",
          },
        ],
      },
    });

    const env = await getPageStateTool.handler({ page_id: "p1" });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result?.page_index).toBe(0);
    expect(env.result?.frames).toHaveLength(1);
    expect(env.result?.frames[0].type).toBe("text");
    expect(env.result?.frames[0].paragraph_style_name).toBe("Body");
    // Read-only: no document_state_delta
    expect(env.document_state_delta).toBeUndefined();
  });

  it("propagates not_found failures verbatim", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: { kind: "not_found", message: "page not found", entity: "page", id: "p99" },
    });

    const env = await getPageStateTool.handler({ page_id: "p99" });

    expectFailure(env);
    expect(env.error.kind).toBe("not_found");
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/unit/tools/get-page-state.test.ts`

### Step 3: Write the tool source

- [ ] Create `src/tools/get-page-state.ts`:

```ts
import { z } from "zod";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript, lit, prelude } from "../compose.js";
import { findDocumentById, findPageById } from "../script-helpers.js";

const InputSchema = z
  .object({
    page_id: z.string(),
    document_id: z.string().optional(),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

const BoundsMmSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

const FrameSchema = z.object({
  id: z.string(),
  type: z.enum(["text", "image", "rectangle"]),
  bounds_mm: BoundsMmSchema,
  paragraph_style_name: z.string().optional(),
  text_snippet: z.string().optional(),
});

const ScriptResultSchema = z.object({
  page_id: z.string(),
  page_index: z.number().int().nonnegative(),
  bounds_mm: BoundsMmSchema,
  frames: z.array(FrameSchema),
});

type ScriptResult = z.infer<typeof ScriptResultSchema>;

type Result = ScriptResult;

function buildScriptBody(input: Input): string {
  const docExpr =
    input.document_id !== undefined
      ? `findDocumentById(${lit(input.document_id)})`
      : "app.activeDocument";

  return `
${prelude(findDocumentById, findPageById)}
var prevUnits = app.scriptPreferences.measurementUnit;
app.scriptPreferences.measurementUnit = MeasurementUnits.MILLIMETERS;
try {
  var doc = ${docExpr};
  var page = findPageById(doc, ${lit(input.page_id)});

  // Page index in the document
  var pageIndex = -1;
  for (var i = 0; i < doc.pages.length; i++) {
    if (doc.pages[i].id === page.id) { pageIndex = i; break; }
  }

  // Page bounds (geometricBounds is [y1, x1, y2, x2])
  var pb = page.bounds;
  var pageBounds = {
    x: pb[1],
    y: pb[0],
    width: pb[3] - pb[1],
    height: pb[2] - pb[0]
  };

  // Walk page items
  var frames = [];
  for (var j = 0; j < page.pageItems.length; j++) {
    var item = page.pageItems[j];
    var ctor = item.constructor.name;

    // Type discrimination
    var frameType;
    if (ctor === "TextFrame") {
      frameType = "text";
    } else if (ctor === "Rectangle") {
      // A rectangle with a placed image has graphics > 0
      if (item.graphics && item.graphics.length > 0) {
        frameType = "image";
      } else {
        frameType = "rectangle";
      }
    } else {
      // Skip groups, lines, polygons, etc. for B2 — only known types are reported.
      continue;
    }

    var gb = item.geometricBounds;
    var frameInfo = {
      id: String(item.id),
      type: frameType,
      bounds_mm: {
        x: gb[1],
        y: gb[0],
        width: gb[3] - gb[1],
        height: gb[2] - gb[0]
      }
    };

    if (frameType === "text") {
      // Single applied style?
      var paras = item.parentStory.paragraphs;
      if (paras.length > 0) {
        var firstStyle = paras[0].appliedParagraphStyle;
        var allSame = true;
        for (var k = 1; k < paras.length; k++) {
          if (paras[k].appliedParagraphStyle !== firstStyle) {
            allSame = false;
            break;
          }
        }
        if (allSame && firstStyle.name !== "[No paragraph style]" && firstStyle.name !== "[Basic Paragraph]") {
          frameInfo.paragraph_style_name = String(firstStyle.name);
        }
      }

      // Text snippet
      var contents = String(item.contents || "");
      if (contents.length > 0) {
        if (contents.length > 200) {
          frameInfo.text_snippet = contents.substring(0, 200) + "...";
        } else {
          frameInfo.text_snippet = contents;
        }
      }
    }

    frames.push(frameInfo);
  }

  return {
    page_id: ${lit(input.page_id)},
    page_index: pageIndex,
    bounds_mm: pageBounds,
    frames: frames
  };
} finally {
  app.scriptPreferences.measurementUnit = prevUnits;
}
`;
}

export const getPageStateTool = defineTool<Input, Result>({
  name: "get_page_state",
  description:
    "Returns a snapshot of a page: its bounds in mm and a list of frames with their type, bounds, applied paragraph style (if uniform), and a text snippet (first 200 chars).",
  inputSchema: InputSchema,
  async handler(input) {
    return runScriptWithResultFile<ScriptResult>({
      language: "JavaScript",
      scriptTemplate: wrapExtendScript(buildScriptBody(input)),
      resultSchema: ScriptResultSchema,
    });
  },
});
```

- [ ] **Step 4: Register in `src/index.ts`**

```ts
import { getPageStateTool } from "./tools/get-page-state.js";
// ...
registry.register(getPageStateTool);
```

- [ ] **Step 5: Run unit tests, expect pass**

Run: `npm test -- tests/unit/tools/get-page-state.test.ts`
Expected: 6/6 pass.

- [ ] **Step 6: Run full suite + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: 144/144 pass, tsc clean.

- [ ] **Step 7: Write integration test**

Create `tests/integration/get-page-state.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { createTextFrameTool } from "../../src/tools/create-text-frame.js";
import { setTextTool } from "../../src/tools/set-text.js";
import { defineParagraphStyleTool } from "../../src/tools/define-paragraph-style.js";
import { applyParagraphStyleTool } from "../../src/tools/apply-paragraph-style.js";
import { getPageStateTool } from "../../src/tools/get-page-state.js";

integrationGate("get_page_state (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "reports an empty page when no frames have been added",
    async () => {
      const create = await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });
      if (!create.ok) return;

      const env = await getPageStateTool.handler({
        page_id: create.result!.page_ids[0],
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result?.page_index).toBe(0);
      expect(env.result?.frames).toHaveLength(0);
      expect(env.result?.bounds_mm.width).toBe(210);
      expect(env.result?.bounds_mm.height).toBe(297);
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "reports a styled text frame with style name and text snippet",
    async () => {
      const create = await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });
      if (!create.ok) return;
      const pageId = create.result!.page_ids[0];

      const frame = await createTextFrameTool.handler({
        page_id: pageId,
        bounds_mm: { x: 12, y: 12, width: 186, height: 50 },
      });
      if (!frame.ok) return;

      await setTextTool.handler({
        frame_id: frame.result!.frame_id,
        text: "The quick brown fox jumps over the lazy dog.",
      });

      await defineParagraphStyleTool.handler({
        name: "Body",
        size_pt: 11,
      });

      await applyParagraphStyleTool.handler({
        frame_id: frame.result!.frame_id,
        style_name: "Body",
      });

      const env = await getPageStateTool.handler({ page_id: pageId });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result?.frames).toHaveLength(1);
      const f = env.result!.frames[0];
      expect(f.type).toBe("text");
      expect(f.paragraph_style_name).toBe("Body");
      expect(f.text_snippet).toContain("The quick brown fox");
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
```

- [ ] **Step 8: Verify tsc**

Run: `npx tsc --noEmit`

- [ ] **Step 9: Commit**

```bash
git add src/tools/get-page-state.ts src/index.ts tests/unit/tools/get-page-state.test.ts tests/integration/get-page-state.int.test.ts
git commit -m "feat: get_page_state tool"
```

---

## Task 8: End-to-end smoke test

**Why:** Spec's success criterion #4 — Claude composes a styled page end-to-end and `get_page_state` confirms the result. Single integration scenario that exercises the full B1+B2 surface.

**Files:**
- Create: `tests/integration/plan-b2-end-to-end.int.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/integration/plan-b2-end-to-end.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { createTextFrameTool } from "../../src/tools/create-text-frame.js";
import { setTextTool } from "../../src/tools/set-text.js";
import { defineParagraphStyleTool } from "../../src/tools/define-paragraph-style.js";
import { applyParagraphStyleTool } from "../../src/tools/apply-paragraph-style.js";
import { getPageStateTool } from "../../src/tools/get-page-state.js";
import { saveDocumentTool } from "../../src/tools/save-document.js";
import { exportPdfTool } from "../../src/tools/export-pdf.js";

integrationGate("Plan B2 end-to-end (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "composes a styled one-page case study and exports a PDF",
    async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "indesign-mcp-b2-"));
      const indd = join(tmpDir, "case-study.indd");
      const pdf = join(tmpDir, "case-study.pdf");

      try {
        // 1. Document
        const create = await createDocumentTool.handler({
          preset: "A4",
          margins_mm: { top: 18, bottom: 18, left: 18, right: 18 },
        });
        expect(create.ok).toBe(true);
        if (!create.ok) return;
        const pageId = create.result!.page_ids[0];

        // 2. Headline frame
        const headline = await createTextFrameTool.handler({
          page_id: pageId,
          bounds_mm: { x: 18, y: 18, width: 174, height: 30 },
          initial_text: "Brand Case Study: How We Shipped",
        });
        expect(headline.ok).toBe(true);
        if (!headline.ok) return;

        // 3. Body frame
        const body = await createTextFrameTool.handler({
          page_id: pageId,
          bounds_mm: { x: 18, y: 60, width: 174, height: 200 },
          initial_text:
            "We started with a small team and a clear vision. Over six months, we shipped a product that customers loved. Three lessons stand out: ship small, listen often, iterate honestly. Each cycle taught us something new about the craft.",
        });
        expect(body.ok).toBe(true);
        if (!body.ok) return;

        // 4. Headline style (large, accent color)
        await defineParagraphStyleTool.handler({
          name: "Headline",
          size_pt: 28,
          leading_pt: 32,
          color_hex: "#FF6600",
        });

        // 5. Body style
        await defineParagraphStyleTool.handler({
          name: "Body",
          size_pt: 11,
          leading_pt: 14,
          alignment: "left",
        });

        // 6. Apply styles
        await applyParagraphStyleTool.handler({
          frame_id: headline.result!.frame_id,
          style_name: "Headline",
        });
        await applyParagraphStyleTool.handler({
          frame_id: body.result!.frame_id,
          style_name: "Body",
        });

        // 7. Read state, verify
        const state = await getPageStateTool.handler({ page_id: pageId });
        expect(state.ok).toBe(true);
        if (!state.ok) return;
        expect(state.result?.frames).toHaveLength(2);
        const styleNames = state.result!.frames
          .map((f) => f.paragraph_style_name)
          .filter(Boolean);
        expect(styleNames).toContain("Headline");
        expect(styleNames).toContain("Body");

        // 8. Save and export
        const save = await saveDocumentTool.handler({ path: indd });
        expect(save.ok).toBe(true);
        const exported = await exportPdfTool.handler({ path: pdf });
        expect(exported.ok).toBe(true);
        if (!exported.ok) return;
        expect(existsSync(pdf)).toBe(true);
        expect(exported.result?.page_count).toBe(1);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    },
    INTEGRATION_TIMEOUT_MS * 3, // big multi-step run
  );
});
```

- [ ] **Step 2: Verify tsc**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Run unit suite**

Run: `npm test`
Expected: 144/144 pass; integration tests excluded.

- [ ] **Step 4: Build dist/**

Run: `npm run build`
Expected: clean.

- [ ] **Step 5: Manual smoke test (operator runs with InDesign open)**

Run: `npm run test:integration`
Expected: all integration tests pass.

- [ ] **Step 6: Commit**

```bash
git add tests/integration/plan-b2-end-to-end.int.test.ts
git commit -m "test: end-to-end Plan B2 case-study scenario"
```

---

## Plan-Complete Checklist

Before declaring Plan B2 done:

- [ ] All 8 tasks committed.
- [ ] `npm test` passes (~144/144 unit tests).
- [ ] `npx tsc --noEmit` clean across both src and tests.
- [ ] `npm run build` produces a clean `dist/`.
- [ ] Manual integration run with InDesign 2026 open passes all integration tests.
- [ ] End-to-end test produces a valid 1-page styled PDF on disk.
- [ ] Live verification through Claude Desktop on a brand DESIGN.md + ~200-word case-study brief — operator step. The original spec's POC bar.

When all seven are checked, Plan B3 (image frames + place_image) becomes the next planning step.
