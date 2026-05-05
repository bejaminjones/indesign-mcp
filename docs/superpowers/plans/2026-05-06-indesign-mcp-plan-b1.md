# InDesign MCP — Plan B1 Implementation Plan (Document Lifecycle)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship four MCP tools — `create_document`, `add_page`, `save_document`, `export_pdf` — that together let Claude create, persist, and export an InDesign document.

**Architecture:** Each tool follows the get-app-version template established in Plan A: Zod input schema → ExtendScript body (built with input values interpolated server-side) → handler that validates input, dispatches via `runScriptWithResultFile`, and post-processes the script's flat result into an `Envelope<TResult>` with `document_state_delta`.

**Tech Stack:** TypeScript 5.6+, Node 20+, MCP SDK, Zod, Vitest. No new runtime deps.

**Reference spec:** `docs/superpowers/specs/2026-05-06-indesign-mcp-plan-b1-design.md`

**Repository:** `~/Documents/GitHub/indesign-mcp/`. Create a feature branch `feat/plan-b1` before starting.

**Sandbox note:** Integration tests in this plan run against real InDesign 2026 and are env-gated (`INDESIGN_MCP_INTEGRATION=1`). If you don't have InDesign open in your environment, the integration tests will fail with `app_not_available` — that's expected. The unit tests (mocked transport) are the executable verification; integration tests are scaffolding for the user to run with InDesign open.

---

## File Structure (across this plan)

```
src/
├── types.ts                                (modified, Task 1)
├── tools/
│   ├── create-document.ts                  (Task 3)
│   ├── add-page.ts                         (Task 4)
│   ├── save-document.ts                    (Task 5)
│   └── export-pdf.ts                       (Task 6)
└── index.ts                                (modified to register tools, each tool task)

tests/
├── integration/
│   ├── helpers.ts                          (modified, Task 2)
│   ├── create-document.int.test.ts         (Task 3)
│   ├── add-page.int.test.ts                (Task 4)
│   ├── save-document.int.test.ts           (Task 5)
│   ├── export-pdf.int.test.ts              (Task 6)
│   └── plan-b1-end-to-end.int.test.ts      (Task 7)
└── unit/
    ├── types.test.ts                       (Task 1, new file)
    └── tools/
        ├── create-document.test.ts         (Task 3)
        ├── add-page.test.ts                (Task 4)
        ├── save-document.test.ts           (Task 5)
        └── export-pdf.test.ts              (Task 6)
```

---

## Task 1: Extend `DocumentStateDelta` with page-tracking fields

**Why:** Plan A's delta tracked frames only. B1's mutating tools change page state, so add symmetric `new_page_ids` and `removed_page_ids` fields.

**Files:**
- Modify: `src/types.ts`
- Create: `tests/unit/types.test.ts`

- [ ] **Step 1: Write failing test**

`tests/unit/types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { DocumentStateDelta } from "../../src/types.js";

describe("DocumentStateDelta", () => {
  it("accepts new_page_ids and removed_page_ids as optional string arrays", () => {
    const delta: DocumentStateDelta = {
      new_page_ids: ["p1", "p2"],
      removed_page_ids: ["p3"],
      page_count: 5,
    };
    expect(delta.new_page_ids).toEqual(["p1", "p2"]);
    expect(delta.removed_page_ids).toEqual(["p3"]);
    expect(delta.page_count).toBe(5);
  });

  it("allows omitting new_page_ids and removed_page_ids", () => {
    const delta: DocumentStateDelta = { page_count: 0 };
    expect(delta.new_page_ids).toBeUndefined();
    expect(delta.removed_page_ids).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test, expect type-check failure**

Run: `npx tsc --noEmit`
Expected: errors at lines referencing `new_page_ids` / `removed_page_ids` ("Object literal may only specify known properties").

- [ ] **Step 3: Update `src/types.ts`**

Find the existing `DocumentStateDelta` interface and replace it with:

```ts
export interface DocumentStateDelta {
  changed_frames?: Array<{ id: FrameId; bounds?: [number, number, number, number] }>;
  new_frames?: Array<{ id: FrameId; type: string }>;
  removed_frame_ids?: FrameId[];
  new_page_ids?: string[];
  removed_page_ids?: string[];
  page_count?: number;
}
```

- [ ] **Step 4: Verify tsc and tests pass**

Run: `npx tsc --noEmit && npm test`
Expected: clean tsc, 42/42 pass (40 prior + 2 new in `types.test.ts`).

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/plan-b1
git add src/types.ts tests/unit/types.test.ts
git commit -m "feat: extend DocumentStateDelta with new_page_ids and removed_page_ids"
```

---

## Task 2: `closeAllDocuments()` integration test helper

**Why:** B1's integration tests create real .indd files. Without per-test cleanup, state leaks between tests. This helper closes every open InDesign document without saving — call from `afterEach` in each integration test file.

**Files:**
- Modify: `tests/integration/helpers.ts`

- [ ] **Step 1: Read the current helpers.ts to confirm structure**

Run: `cat tests/integration/helpers.ts`
Expected: existing `integrationGate` and `INTEGRATION_TIMEOUT_MS` exports.

- [ ] **Step 2: Add `closeAllDocuments()` to `tests/integration/helpers.ts`**

Append:

```ts
import { wrapExtendScript } from "../../src/compose.js";
import { runScriptWithResultFile } from "../../src/transport/result-file.js";

/**
 * Closes every open InDesign document without saving. Call from `afterEach`
 * to give each integration test a clean slate. Idempotent — succeeds even
 * when no documents are open.
 */
export async function closeAllDocuments(): Promise<void> {
  const body = `
    while (app.documents.length > 0) {
      app.documents[0].close(SaveOptions.NO);
    }
    return { closed: true };
  `;
  const scriptTemplate = wrapExtendScript(body);
  await runScriptWithResultFile<{ closed: boolean }>({
    language: "JavaScript",
    scriptTemplate,
  });
}
```

- [ ] **Step 3: Verify tsc**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/helpers.ts
git commit -m "test: closeAllDocuments helper for integration test isolation"
```

(No unit test for this helper — it's an integration helper that runs against InDesign. The first integration test using it implicitly verifies it works.)

---

## Task 3: `create_document` tool

**Why:** First mutating tool. Establishes the schema-+-body-builder-+-handler pattern. Validates margin/preset/orientation handling before B2/B3 inherit it.

**Files:**
- Create: `src/tools/create-document.ts`
- Create: `tests/unit/tools/create-document.test.ts`
- Create: `tests/integration/create-document.int.test.ts`
- Modify: `src/index.ts` (register tool)

### Step 1: Write the unit test file (failing, full coverage)

- [ ] Create `tests/unit/tools/create-document.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDocumentTool } from "../../../src/tools/create-document.js";
import { lastCall, expectFailure } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("create_document tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(createDocumentTool.name).toBe("create_document");
    expect(createDocumentTool.description.length).toBeGreaterThan(0);
  });

  it("accepts a minimal valid input (preset + margins)", () => {
    const result = createDocumentTool.inputSchema.safeParse({
      preset: "A4",
      margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects when neither preset nor explicit dimensions are given", () => {
    const result = createDocumentTool.inputSchema.safeParse({
      margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects when both preset and explicit dimensions are given", () => {
    const result = createDocumentTool.inputSchema.safeParse({
      preset: "A4",
      width_mm: 200,
      height_mm: 300,
      margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects inside/outside margins without facing_pages", () => {
    const result = createDocumentTool.inputSchema.safeParse({
      preset: "A4",
      margins_mm: { top: 12, bottom: 12, inside: 14, outside: 10 },
    });
    expect(result.success).toBe(false);
  });

  it("accepts inside/outside margins when facing_pages is true", () => {
    const result = createDocumentTool.inputSchema.safeParse({
      preset: "A4",
      facing_pages: true,
      margins_mm: { top: 12, bottom: 12, inside: 14, outside: 10 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects pages < 1", () => {
    const result = createDocumentTool.inputSchema.safeParse({
      preset: "A4",
      pages: 0,
      margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
    });
    expect(result.success).toBe(false);
  });

  it("dispatches an ExtendScript that creates a document with the resolved dimensions", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        document_id: "doc-1",
        page_ids: ["p1", "p2"],
        page_count: 2,
      },
    });

    await createDocumentTool.handler({
      preset: "A4",
      pages: 2,
      margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.language).toBe("JavaScript");
    // A4 portrait dimensions
    expect(arg.scriptTemplate).toContain("210");
    expect(arg.scriptTemplate).toContain("297");
    // Page count interpolated
    expect(arg.scriptTemplate).toContain("pagesPerDocument = 2");
    // Margins interpolated
    expect(arg.scriptTemplate).toContain("marginPreferences.top = 12");
  });

  it("swaps preset dimensions for landscape orientation", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { document_id: "d", page_ids: ["p"], page_count: 1 },
    });

    await createDocumentTool.handler({
      preset: "A4",
      orientation: "landscape",
      margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    // Width should now be 297, height 210
    expect(arg.scriptTemplate).toContain("pageWidth = 297");
    expect(arg.scriptTemplate).toContain("pageHeight = 210");
  });

  it("returns the document id, page ids, and document_state_delta", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        document_id: "doc-42",
        page_ids: ["p1", "p2", "p3"],
        page_count: 3,
      },
    });

    const env = await createDocumentTool.handler({
      preset: "A4",
      pages: 3,
      margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
    });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result).toEqual({
      document_id: "doc-42",
      page_ids: ["p1", "p2", "p3"],
    });
    expect(env.document_state_delta).toEqual({
      page_count: 3,
      new_page_ids: ["p1", "p2", "p3"],
    });
  });

  it("propagates failure envelopes verbatim", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: { kind: "app_not_available", message: "no app" },
    });

    const env = await createDocumentTool.handler({
      preset: "A4",
      margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
    });

    expectFailure(env);
    expect(env.error.kind).toBe("app_not_available");
  });
});
```

- [ ] **Step 2: Run test, expect failure (module not found)**

Run: `npm test -- tests/unit/tools/create-document.test.ts`
Expected: FAIL — module `../../../src/tools/create-document.js` not found.

### Step 3: Write the tool source

- [ ] Create `src/tools/create-document.ts`:

```ts
import { z } from "zod";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript } from "../compose.js";
import { ok } from "../errors.js";

// Preset dimensions in millimetres (portrait orientation).
const PRESETS: Record<string, { width_mm: number; height_mm: number }> = {
  A4: { width_mm: 210, height_mm: 297 },
  Letter: { width_mm: 215.9, height_mm: 279.4 },
  Legal: { width_mm: 215.9, height_mm: 355.6 },
  Tabloid: { width_mm: 279.4, height_mm: 431.8 },
};

const RectMargins = z.object({
  top: z.number().nonnegative(),
  bottom: z.number().nonnegative(),
  left: z.number().nonnegative(),
  right: z.number().nonnegative(),
});

const FacingMargins = z.object({
  top: z.number().nonnegative(),
  bottom: z.number().nonnegative(),
  inside: z.number().nonnegative(),
  outside: z.number().nonnegative(),
});

const InputSchema = z
  .object({
    preset: z.enum(["A4", "Letter", "Legal", "Tabloid"]).optional(),
    width_mm: z.number().positive().optional(),
    height_mm: z.number().positive().optional(),
    orientation: z.enum(["portrait", "landscape"]).optional(),
    pages: z.number().int().min(1).optional(),
    facing_pages: z.boolean().optional(),
    margins_mm: z.union([RectMargins, FacingMargins]),
    columns: z
      .object({
        count: z.number().int().min(1),
        gutter_mm: z.number().nonnegative(),
      })
      .optional(),
  })
  .strict()
  .refine(
    (data) => {
      const hasPreset = data.preset !== undefined;
      const hasWidth = data.width_mm !== undefined;
      const hasHeight = data.height_mm !== undefined;
      // Exactly one of: preset, OR (width AND height). Partial dims invalid.
      if (hasPreset && (hasWidth || hasHeight)) return false;
      if (!hasPreset && !(hasWidth && hasHeight)) return false;
      return true;
    },
    { message: "Provide exactly one of `preset` or both `width_mm` and `height_mm`" },
  )
  .refine(
    (data) => {
      const isFacingMargins = "inside" in data.margins_mm;
      if (isFacingMargins && data.facing_pages !== true) return false;
      return true;
    },
    { message: "`inside`/`outside` margins require facing_pages: true" },
  );

type Input = z.infer<typeof InputSchema>;

interface ScriptResult {
  document_id: string;
  page_ids: string[];
  page_count: number;
}

interface Result {
  document_id: string;
  page_ids: string[];
}

function resolveDimensions(input: Input): { width_mm: number; height_mm: number } {
  let w: number;
  let h: number;
  if (input.preset !== undefined) {
    const preset = PRESETS[input.preset];
    w = preset.width_mm;
    h = preset.height_mm;
  } else {
    w = input.width_mm!;
    h = input.height_mm!;
  }
  if (input.orientation === "landscape" && w < h) [w, h] = [h, w];
  if (input.orientation === "portrait" && w > h) [w, h] = [h, w];
  return { width_mm: w, height_mm: h };
}

function resolveMargins(input: Input): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  const m = input.margins_mm;
  if ("inside" in m) {
    return { top: m.top, bottom: m.bottom, left: m.inside, right: m.outside };
  }
  return { top: m.top, bottom: m.bottom, left: m.left, right: m.right };
}

function buildScriptBody(input: Input): string {
  const dims = resolveDimensions(input);
  const margins = resolveMargins(input);
  const columns = input.columns ?? { count: 1, gutter_mm: 0 };
  const pages = input.pages ?? 1;
  const facing = input.facing_pages ?? false;

  return `
    var prevUnits = app.scriptPreferences.measurementUnit;
    app.scriptPreferences.measurementUnit = MeasurementUnits.MILLIMETERS;
    try {
      var doc = app.documents.add();
      var dp = doc.documentPreferences;
      dp.facingPages = ${facing};
      dp.pageWidth = ${dims.width_mm};
      dp.pageHeight = ${dims.height_mm};
      dp.pagesPerDocument = ${pages};

      var marginPrefs = doc.marginPreferences;
      marginPrefs.top = ${margins.top};
      marginPrefs.bottom = ${margins.bottom};
      marginPrefs.left = ${margins.left};
      marginPrefs.right = ${margins.right};
      marginPrefs.columnCount = ${columns.count};
      marginPrefs.columnGutter = ${columns.gutter_mm};

      var pageIds = [];
      for (var i = 0; i < doc.pages.length; i++) {
        pageIds.push(String(doc.pages[i].id));
      }

      return {
        document_id: String(doc.id),
        page_ids: pageIds,
        page_count: doc.pages.length
      };
    } finally {
      app.scriptPreferences.measurementUnit = prevUnits;
    }
  `;
}

export const createDocumentTool = defineTool<Input, Result>({
  name: "create_document",
  description:
    "Creates a new InDesign document with the specified page size, orientation, margins, and column setup. Returns the document and page IDs.",
  inputSchema: InputSchema,
  async handler(input) {
    const body = buildScriptBody(input);
    const env = await runScriptWithResultFile<ScriptResult>({
      language: "JavaScript",
      scriptTemplate: wrapExtendScript(body),
    });
    if (!env.ok) return env;
    const r = env.result!;
    return ok(
      { document_id: r.document_id, page_ids: r.page_ids },
      {
        document_state_delta: {
          page_count: r.page_count,
          new_page_ids: r.page_ids,
        },
      },
    );
  },
});
```

- [ ] **Step 4: Register the tool**

Edit `src/index.ts` — add the import and registration. Find the existing `registry.register(getAppVersionTool);` line and add immediately after:

```ts
import { createDocumentTool } from "./tools/create-document.js";
// ... below registration of getAppVersionTool:
registry.register(createDocumentTool);
```

(The import goes near the other tool import.)

- [ ] **Step 5: Run unit tests, expect pass**

Run: `npm test -- tests/unit/tools/create-document.test.ts`
Expected: 11/11 pass.

- [ ] **Step 6: Run full unit suite + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: clean tsc, ~53/53 tests pass (42 prior + 11 new).

- [ ] **Step 7: Write integration test**

Create `tests/integration/create-document.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";

integrationGate("create_document (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "creates an A4 document with 2 pages and returns ids + state delta",
    async () => {
      const env = await createDocumentTool.handler({
        preset: "A4",
        pages: 2,
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(typeof env.result?.document_id).toBe("string");
      expect(env.result?.page_ids).toHaveLength(2);
      expect(env.document_state_delta?.page_count).toBe(2);
      expect(env.document_state_delta?.new_page_ids).toEqual(env.result?.page_ids);
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "creates a landscape Letter document",
    async () => {
      const env = await createDocumentTool.handler({
        preset: "Letter",
        orientation: "landscape",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      expect(env.ok).toBe(true);
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "creates a facing-pages document with inside/outside margins",
    async () => {
      const env = await createDocumentTool.handler({
        preset: "A4",
        facing_pages: true,
        margins_mm: { top: 14, bottom: 14, inside: 18, outside: 10 },
      });

      expect(env.ok).toBe(true);
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
```

- [ ] **Step 8: Confirm the integration file type-checks (it won't run in the implementer's sandbox without InDesign)**

Run: `npx tsc --noEmit`
Expected: clean.

Run (best-effort): `npm run test:integration -- tests/integration/create-document.int.test.ts`
Expected outcome A (InDesign open): tests pass.
Expected outcome B (no InDesign): tests fail with `app_not_available`. Acceptable — note in your report.
Expected outcome C (gate skips): if `INDESIGN_MCP_INTEGRATION` is not set, the gate skips. Run with the env var.

- [ ] **Step 9: Commit**

```bash
git add src/tools/create-document.ts src/index.ts tests/unit/tools/create-document.test.ts tests/integration/create-document.int.test.ts
git commit -m "feat: create_document tool"
```

---

## Task 4: `add_page` tool

**Why:** Adds a single page to an existing document. Introduces the `at` positional union and the `document_id` optional field.

**Files:**
- Create: `src/tools/add-page.ts`
- Create: `tests/unit/tools/add-page.test.ts`
- Create: `tests/integration/add-page.int.test.ts`
- Modify: `src/index.ts`

### Step 1: Write the unit test file

- [ ] Create `tests/unit/tools/add-page.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { addPageTool } from "../../../src/tools/add-page.js";
import { lastCall, expectFailure } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("add_page tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(addPageTool.name).toBe("add_page");
    expect(addPageTool.description.length).toBeGreaterThan(0);
  });

  it("accepts an empty input (defaults: at='end', active doc)", () => {
    const result = addPageTool.inputSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts at: 'start' / 'end'", () => {
    expect(addPageTool.inputSchema.safeParse({ at: "start" }).success).toBe(true);
    expect(addPageTool.inputSchema.safeParse({ at: "end" }).success).toBe(true);
  });

  it("accepts at: { after_page_id: '...' } and at: { before_page_id: '...' }", () => {
    expect(
      addPageTool.inputSchema.safeParse({ at: { after_page_id: "p1" } }).success,
    ).toBe(true);
    expect(
      addPageTool.inputSchema.safeParse({ at: { before_page_id: "p1" } }).success,
    ).toBe(true);
  });

  it("rejects at: 'middle' (invalid string)", () => {
    expect(addPageTool.inputSchema.safeParse({ at: "middle" }).success).toBe(false);
  });

  it("rejects at object with both after_page_id and before_page_id", () => {
    const result = addPageTool.inputSchema.safeParse({
      at: { after_page_id: "p1", before_page_id: "p2" },
    });
    expect(result.success).toBe(false);
  });

  it("dispatches a script that uses the active document by default", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { new_page_id: "p2", position_index: 1, page_count: 2 },
    });

    await addPageTool.handler({});

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("app.activeDocument");
  });

  it("dispatches a script that resolves a document by id when document_id is given", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { new_page_id: "p2", position_index: 0, page_count: 2 },
    });

    await addPageTool.handler({ document_id: "doc-1" });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain('"doc-1"');
  });

  it("returns new_page_id, position_index, and a state delta", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { new_page_id: "p7", position_index: 4, page_count: 5 },
    });

    const env = await addPageTool.handler({ at: "end" });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result).toEqual({ new_page_id: "p7", position_index: 4 });
    expect(env.document_state_delta).toEqual({
      page_count: 5,
      new_page_ids: ["p7"],
    });
  });

  it("propagates failure envelopes verbatim", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: { kind: "not_found", message: "doc not found", entity: "document", id: "x" },
    });

    const env = await addPageTool.handler({ document_id: "x" });

    expectFailure(env);
    expect(env.error.kind).toBe("not_found");
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/unit/tools/add-page.test.ts`
Expected: module not found.

### Step 3: Write tool source

- [ ] Create `src/tools/add-page.ts`:

```ts
import { z } from "zod";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript } from "../compose.js";
import { ok } from "../errors.js";

const AfterPageId = z.object({ after_page_id: z.string() }).strict();
const BeforePageId = z.object({ before_page_id: z.string() }).strict();

const InputSchema = z
  .object({
    at: z
      .union([z.literal("start"), z.literal("end"), AfterPageId, BeforePageId])
      .optional(),
    document_id: z.string().optional(),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

interface ScriptResult {
  new_page_id: string;
  position_index: number;
  page_count: number;
}

interface Result {
  new_page_id: string;
  position_index: number;
}

function buildScriptBody(input: Input): string {
  const at = input.at ?? "end";
  const docExpr =
    input.document_id !== undefined
      ? `findDocumentById(${JSON.stringify(input.document_id)})`
      : "app.activeDocument";

  // Insertion mode
  let insertion: string;
  if (at === "end") {
    insertion = `var newPage = doc.pages.add(LocationOptions.AT_END);`;
  } else if (at === "start") {
    insertion = `var newPage = doc.pages.add(LocationOptions.AT_BEGINNING);`;
  } else if ("after_page_id" in at) {
    insertion = `
      var anchor = findPageById(doc, ${JSON.stringify(at.after_page_id)});
      var newPage = doc.pages.add(LocationOptions.AFTER, anchor);
    `;
  } else {
    insertion = `
      var anchor = findPageById(doc, ${JSON.stringify(at.before_page_id)});
      var newPage = doc.pages.add(LocationOptions.BEFORE, anchor);
    `;
  }

  return `
    function findDocumentById(id) {
      for (var i = 0; i < app.documents.length; i++) {
        if (String(app.documents[i].id) === id) return app.documents[i];
      }
      throw { name: "not_found", message: "document " + id + " not found", entity: "document", id: id };
    }
    function findPageById(doc, id) {
      for (var i = 0; i < doc.pages.length; i++) {
        if (String(doc.pages[i].id) === id) return doc.pages[i];
      }
      throw { name: "not_found", message: "page " + id + " not found", entity: "page", id: id };
    }
    var doc = ${docExpr};
    ${insertion}
    var idx = -1;
    for (var i = 0; i < doc.pages.length; i++) {
      if (doc.pages[i].id === newPage.id) { idx = i; break; }
    }
    return {
      new_page_id: String(newPage.id),
      position_index: idx,
      page_count: doc.pages.length
    };
  `;
}

export const addPageTool = defineTool<Input, Result>({
  name: "add_page",
  description:
    "Adds a single page to an InDesign document. Defaults to appending at the end of the active document. Returns the new page ID and its position.",
  inputSchema: InputSchema,
  async handler(input) {
    const body = buildScriptBody(input);
    const env = await runScriptWithResultFile<ScriptResult>({
      language: "JavaScript",
      scriptTemplate: wrapExtendScript(body),
    });
    if (!env.ok) return env;
    const r = env.result!;
    return ok(
      { new_page_id: r.new_page_id, position_index: r.position_index },
      {
        document_state_delta: {
          page_count: r.page_count,
          new_page_ids: [r.new_page_id],
        },
      },
    );
  },
});
```

- [ ] **Step 4: Register**

In `src/index.ts`, add:

```ts
import { addPageTool } from "./tools/add-page.js";
// ...
registry.register(addPageTool);
```

- [ ] **Step 5: Run unit tests, expect pass**

Run: `npm test -- tests/unit/tools/add-page.test.ts`
Expected: 10/10 pass.

- [ ] **Step 6: Run full suite + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: clean tsc, ~63/63 pass.

- [ ] **Step 7: Write integration test**

Create `tests/integration/add-page.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { addPageTool } from "../../src/tools/add-page.js";

integrationGate("add_page (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "appends a page to a fresh A4 document",
    async () => {
      const create = await createDocumentTool.handler({
        preset: "A4",
        pages: 1,
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });
      expect(create.ok).toBe(true);

      const add = await addPageTool.handler({});
      expect(add.ok).toBe(true);
      if (!add.ok) return;
      expect(add.document_state_delta?.page_count).toBe(2);
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "inserts a page after a specific page id",
    async () => {
      const create = await createDocumentTool.handler({
        preset: "A4",
        pages: 2,
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });
      expect(create.ok).toBe(true);
      if (!create.ok) return;
      const firstPage = create.result!.page_ids[0];

      const add = await addPageTool.handler({ at: { after_page_id: firstPage } });
      expect(add.ok).toBe(true);
      if (!add.ok) return;
      expect(add.result?.position_index).toBe(1);
      expect(add.document_state_delta?.page_count).toBe(3);
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
git add src/tools/add-page.ts src/index.ts tests/unit/tools/add-page.test.ts tests/integration/add-page.int.test.ts
git commit -m "feat: add_page tool"
```

---

## Task 5: `save_document` tool

**Why:** Persists the active document. First tool that writes outside InDesign's process — exercises the file-IO error path.

**Files:**
- Create: `src/tools/save-document.ts`
- Create: `tests/unit/tools/save-document.test.ts`
- Create: `tests/integration/save-document.int.test.ts`
- Modify: `src/index.ts`

### Step 1: Write the unit test file

- [ ] Create `tests/unit/tools/save-document.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { saveDocumentTool } from "../../../src/tools/save-document.js";
import { lastCall, expectFailure } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("save_document tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(saveDocumentTool.name).toBe("save_document");
    expect(saveDocumentTool.description.length).toBeGreaterThan(0);
  });

  it("accepts empty input (defaults: active doc, save to current path)", () => {
    expect(saveDocumentTool.inputSchema.safeParse({}).success).toBe(true);
  });

  it("accepts an absolute path", () => {
    expect(
      saveDocumentTool.inputSchema.safeParse({ path: "/Users/me/doc.indd" }).success,
    ).toBe(true);
  });

  it("accepts a relative path (server-side resolves)", () => {
    expect(
      saveDocumentTool.inputSchema.safeParse({ path: "doc.indd" }).success,
    ).toBe(true);
  });

  it("dispatches a script with the resolved absolute path interpolated", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { path: "/abs/path/doc.indd" },
    });

    await saveDocumentTool.handler({ path: "doc.indd" });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.language).toBe("JavaScript");
    // The path was server-side resolved to absolute before interpolation
    expect(arg.scriptTemplate).toMatch(/\/.*doc\.indd/);
  });

  it("dispatches a script that saves to current path when no path is given", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { path: "/abs/existing.indd" },
    });

    await saveDocumentTool.handler({});

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    // Body should call doc.save() with no arg (uses current path)
    expect(arg.scriptTemplate).toContain("doc.save()");
  });

  it("returns the path on success", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { path: "/abs/result.indd" },
    });

    const env = await saveDocumentTool.handler({ path: "result.indd" });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result).toEqual({ path: "/abs/result.indd" });
    // No state delta on save
    expect(env.document_state_delta).toBeUndefined();
  });

  it("propagates io_error envelopes verbatim", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: { kind: "io_error", message: "permission denied" },
    });

    const env = await saveDocumentTool.handler({ path: "/locked/doc.indd" });

    expectFailure(env);
    expect(env.error.kind).toBe("io_error");
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/unit/tools/save-document.test.ts`
Expected: module not found.

### Step 3: Write tool source

- [ ] Create `src/tools/save-document.ts`:

```ts
import { z } from "zod";
import { resolve } from "node:path";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript } from "../compose.js";

const InputSchema = z
  .object({
    path: z.string().optional(),
    document_id: z.string().optional(),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

interface Result {
  path: string;
}

function buildScriptBody(input: Input, absolutePath: string | undefined): string {
  const docExpr =
    input.document_id !== undefined
      ? `findDocumentById(${JSON.stringify(input.document_id)})`
      : "app.activeDocument";

  const saveCall =
    absolutePath !== undefined
      ? `doc.save(File(${JSON.stringify(absolutePath)}));`
      : `doc.save();`;

  return `
    function findDocumentById(id) {
      for (var i = 0; i < app.documents.length; i++) {
        if (String(app.documents[i].id) === id) return app.documents[i];
      }
      throw { name: "not_found", message: "document " + id + " not found", entity: "document", id: id };
    }
    var doc = ${docExpr};
    ${saveCall}
    return { path: String(doc.fullName) };
  `;
}

export const saveDocumentTool = defineTool<Input, Result>({
  name: "save_document",
  description:
    "Saves an InDesign document to disk. With `path`, performs a save-as. Without, saves to the document's current path (returns io_error if the document has no path yet).",
  inputSchema: InputSchema,
  async handler(input) {
    const absolutePath = input.path !== undefined ? resolve(input.path) : undefined;
    const body = buildScriptBody(input, absolutePath);
    return runScriptWithResultFile<Result>({
      language: "JavaScript",
      scriptTemplate: wrapExtendScript(body),
    });
  },
});
```

- [ ] **Step 4: Register**

In `src/index.ts`:

```ts
import { saveDocumentTool } from "./tools/save-document.js";
// ...
registry.register(saveDocumentTool);
```

- [ ] **Step 5: Run unit tests, expect pass**

Run: `npm test -- tests/unit/tools/save-document.test.ts`
Expected: 8/8 pass.

- [ ] **Step 6: Run full suite + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: clean tsc, ~71/71 pass.

- [ ] **Step 7: Write integration test**

Create `tests/integration/save-document.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { saveDocumentTool } from "../../src/tools/save-document.js";

integrationGate("save_document (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "saves a fresh document to a new path (save-as)",
    async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "indesign-mcp-save-"));
      const indd = join(tmpDir, "test.indd");

      try {
        await createDocumentTool.handler({
          preset: "A4",
          margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
        });

        const env = await saveDocumentTool.handler({ path: indd });
        expect(env.ok).toBe(true);
        if (!env.ok) return;
        expect(env.result?.path).toBe(indd);
        expect(existsSync(indd)).toBe(true);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "save without path on an unsaved document returns an error",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      const env = await saveDocumentTool.handler({});
      // InDesign throws when saving an untitled doc without a path. The wrapper
      // catches it and returns script_error.
      expect(env.ok).toBe(false);
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
git add src/tools/save-document.ts src/index.ts tests/unit/tools/save-document.test.ts tests/integration/save-document.int.test.ts
git commit -m "feat: save_document tool"
```

---

## Task 6: `export_pdf` tool

**Why:** Exports the document to PDF using InDesign's default high-quality preset. Closes the document lifecycle for the case study POC.

**Files:**
- Create: `src/tools/export-pdf.ts`
- Create: `tests/unit/tools/export-pdf.test.ts`
- Create: `tests/integration/export-pdf.int.test.ts`
- Modify: `src/index.ts`

### Step 1: Write the unit test file

- [ ] Create `tests/unit/tools/export-pdf.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { exportPdfTool } from "../../../src/tools/export-pdf.js";
import { lastCall, expectFailure } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("export_pdf tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(exportPdfTool.name).toBe("export_pdf");
    expect(exportPdfTool.description.length).toBeGreaterThan(0);
  });

  it("requires a path", () => {
    expect(exportPdfTool.inputSchema.safeParse({}).success).toBe(false);
  });

  it("accepts an absolute path", () => {
    expect(
      exportPdfTool.inputSchema.safeParse({ path: "/Users/me/out.pdf" }).success,
    ).toBe(true);
  });

  it("accepts a relative path (server-side resolves)", () => {
    expect(exportPdfTool.inputSchema.safeParse({ path: "out.pdf" }).success).toBe(
      true,
    );
  });

  it("dispatches a script with the resolved absolute path", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { path: "/abs/out.pdf", page_count: 4 },
    });

    await exportPdfTool.handler({ path: "out.pdf" });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toMatch(/\/.*out\.pdf/);
    expect(arg.scriptTemplate).toContain("[High Quality Print]");
  });

  it("returns path and page_count on success", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { path: "/abs/out.pdf", page_count: 4 },
    });

    const env = await exportPdfTool.handler({ path: "/abs/out.pdf" });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result).toEqual({ path: "/abs/out.pdf", page_count: 4 });
    expect(env.document_state_delta).toBeUndefined();
  });

  it("propagates failure envelopes verbatim", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: { kind: "io_error", message: "directory does not exist" },
    });

    const env = await exportPdfTool.handler({ path: "/nope/x.pdf" });

    expectFailure(env);
    expect(env.error.kind).toBe("io_error");
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/unit/tools/export-pdf.test.ts`
Expected: module not found.

### Step 3: Write tool source

- [ ] Create `src/tools/export-pdf.ts`:

```ts
import { z } from "zod";
import { resolve } from "node:path";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript } from "../compose.js";

const InputSchema = z
  .object({
    path: z.string(),
    document_id: z.string().optional(),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

interface Result {
  path: string;
  page_count: number;
}

function buildScriptBody(input: Input, absolutePath: string): string {
  const docExpr =
    input.document_id !== undefined
      ? `findDocumentById(${JSON.stringify(input.document_id)})`
      : "app.activeDocument";

  return `
    function findDocumentById(id) {
      for (var i = 0; i < app.documents.length; i++) {
        if (String(app.documents[i].id) === id) return app.documents[i];
      }
      throw { name: "not_found", message: "document " + id + " not found", entity: "document", id: id };
    }
    var doc = ${docExpr};
    var preset = app.pdfExportPresets.itemByName("[High Quality Print]");
    doc.exportFile(ExportFormat.PDF_TYPE, File(${JSON.stringify(absolutePath)}), false, preset);
    return {
      path: ${JSON.stringify(absolutePath)},
      page_count: doc.pages.length
    };
  `;
}

export const exportPdfTool = defineTool<Input, Result>({
  name: "export_pdf",
  description:
    "Exports an InDesign document to PDF using the [High Quality Print] preset. Returns the absolute output path and exported page count.",
  inputSchema: InputSchema,
  async handler(input) {
    const absolutePath = resolve(input.path);
    const body = buildScriptBody(input, absolutePath);
    return runScriptWithResultFile<Result>({
      language: "JavaScript",
      scriptTemplate: wrapExtendScript(body),
    });
  },
});
```

- [ ] **Step 4: Register**

In `src/index.ts`:

```ts
import { exportPdfTool } from "./tools/export-pdf.js";
// ...
registry.register(exportPdfTool);
```

- [ ] **Step 5: Run unit tests, expect pass**

Run: `npm test -- tests/unit/tools/export-pdf.test.ts`
Expected: 8/8 pass.

- [ ] **Step 6: Run full suite + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: clean tsc, ~79/79 pass.

- [ ] **Step 7: Write integration test**

Create `tests/integration/export-pdf.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { mkdtempSync, existsSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { exportPdfTool } from "../../src/tools/export-pdf.js";

integrationGate("export_pdf (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "exports a fresh A4 document to a real PDF on disk",
    async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "indesign-mcp-pdf-"));
      const pdf = join(tmpDir, "out.pdf");

      try {
        await createDocumentTool.handler({
          preset: "A4",
          pages: 2,
          margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
        });

        const env = await exportPdfTool.handler({ path: pdf });
        expect(env.ok).toBe(true);
        if (!env.ok) return;
        expect(env.result?.path).toBe(pdf);
        expect(env.result?.page_count).toBe(2);
        expect(existsSync(pdf)).toBe(true);
        expect(statSync(pdf).size).toBeGreaterThan(0);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
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
git add src/tools/export-pdf.ts src/index.ts tests/unit/tools/export-pdf.test.ts tests/integration/export-pdf.int.test.ts
git commit -m "feat: export_pdf tool"
```

---

## Task 7: End-to-end smoke test

**Why:** The spec's success criterion is the full sequence — `create_document` → `add_page` ×3 → `save_document` → `export_pdf` — produces a valid 4-page PDF on disk. This integration test exercises that path.

**Files:**
- Create: `tests/integration/plan-b1-end-to-end.int.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/integration/plan-b1-end-to-end.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { mkdtempSync, existsSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { addPageTool } from "../../src/tools/add-page.js";
import { saveDocumentTool } from "../../src/tools/save-document.js";
import { exportPdfTool } from "../../src/tools/export-pdf.js";

integrationGate("Plan B1 end-to-end (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "creates a 4-page A4 document, saves it, exports to PDF",
    async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "indesign-mcp-e2e-"));
      const indd = join(tmpDir, "doc.indd");
      const pdf = join(tmpDir, "doc.pdf");

      try {
        const create = await createDocumentTool.handler({
          preset: "A4",
          pages: 1,
          margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
        });
        expect(create.ok).toBe(true);

        for (let i = 0; i < 3; i++) {
          const add = await addPageTool.handler({});
          expect(add.ok).toBe(true);
        }

        const save = await saveDocumentTool.handler({ path: indd });
        expect(save.ok).toBe(true);
        expect(existsSync(indd)).toBe(true);

        const exported = await exportPdfTool.handler({ path: pdf });
        expect(exported.ok).toBe(true);
        if (!exported.ok) return;
        expect(exported.result?.page_count).toBe(4);
        expect(existsSync(pdf)).toBe(true);
        expect(statSync(pdf).size).toBeGreaterThan(0);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    },
    INTEGRATION_TIMEOUT_MS * 2, // double the cap for the multi-step run
  );
});
```

- [ ] **Step 2: Verify tsc**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Run full suite (unit only)**

Run: `npm test`
Expected: ~79/79 pass; no integration tests in default run.

- [ ] **Step 4: Build dist/**

Run: `npm run build`
Expected: clean, `dist/` updated with all four new tools and index.

- [ ] **Step 5: Manual smoke test (operator runs with InDesign open)**

Pre-conditions: InDesign 2026 launched and idle, no startup dialogs.

Run: `npm run test:integration`
Expected: all integration tests pass — five test files, multiple cases each, exit code 0.

If any fail, investigate `~/Library/Logs/indesign-mcp/server.log` for the specific dispatch and return.

- [ ] **Step 6: Commit**

```bash
git add tests/integration/plan-b1-end-to-end.int.test.ts
git commit -m "test: end-to-end Plan B1 integration scenario"
```

---

## Plan-Complete Checklist

Before declaring Plan B1 done:

- [ ] All seven tasks committed.
- [ ] `npm test` passes (~79/79 unit tests).
- [ ] `npx tsc --noEmit` clean across both src and tests.
- [ ] `npm run build` produces a clean `dist/`.
- [ ] Manual integration run with InDesign 2026 open passes all integration tests (operator step, cannot be done in a sandboxed implementer environment).
- [ ] End-to-end smoke test produces a real 4-page PDF on disk.
- [ ] Final code review of the Plan B1 commits as a unit.

When all six are checked, Plan B2 (text composition) becomes the next planning step.
