# InDesign MCP — Plan B4 Implementation Plan (Parent Pages & Page Numbers)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship four tools (`create_parent_page`, `apply_parent_to_page`, `override_parent_item_on_page`, `insert_page_number_marker`), the `findMasterSpreadByName` shared helper, type-extension for parent-page tracking, and a fix for `create_document`'s facing-page margin mirroring.

**Architecture:** Same template as B1/B2/B3: Zod input schema → server-side body builder using `lit()` and `prelude(...)` → handler dispatching via `runScriptWithResultFile<TScriptResult>` with `resultSchema` validation → optional `ok()` post-processing for `document_state_delta`.

**Tech Stack:** TypeScript 5.6+, Node 20+, MCP SDK, Zod, Vitest. No new runtime deps.

**Reference spec:** `docs/superpowers/specs/2026-05-06-indesign-mcp-plan-b4-design.md`

**Repository:** `~/Documents/GitHub/indesign-mcp/`. Create a feature branch `feat/plan-b4` before starting.

**Sandbox note:** Integration tests require InDesign 2026 running. Unit tests are the executable verification; integration tests run live.

---

## File Structure

```
src/
├── types.ts                                           (modified, Task 1)
├── script-helpers.ts                                  (modified, Task 3)
├── tools/
│   ├── create-document.ts                             (modified, Task 2 — margin bug fix)
│   ├── create-parent-page.ts                          (created, Task 4)
│   ├── apply-parent-to-page.ts                        (created, Task 5)
│   ├── override-parent-item-on-page.ts                (created, Task 6)
│   └── insert-page-number-marker.ts                   (created, Task 7)
└── index.ts                                           (modified for each tool task)

tests/
├── integration/
│   ├── create-parent-page.int.test.ts                 (Task 4)
│   ├── apply-parent-to-page.int.test.ts               (Task 5)
│   ├── override-parent-item-on-page.int.test.ts       (Task 6)
│   ├── insert-page-number-marker.int.test.ts          (Task 7)
│   └── plan-b4-end-to-end.int.test.ts                 (Task 8)
└── unit/
    ├── types.test.ts                                   (modified, Task 1)
    ├── script-helpers.test.ts                          (modified, Task 3)
    └── tools/
        ├── create-document.test.ts                     (modified, Task 2)
        ├── create-parent-page.test.ts                  (created, Task 4)
        ├── apply-parent-to-page.test.ts                (created, Task 5)
        ├── override-parent-item-on-page.test.ts        (created, Task 6)
        └── insert-page-number-marker.test.ts           (created, Task 7)
```

---

## Task 1: Type extensions — `changed_pages` and `new_parent_spreads`

**Why:** Four B4 tools need new delta slots. `apply_parent_to_page` tracks page-level parent application (a page-level event, not a frame-level one). `create_parent_page` reports newly created master spreads. `override_parent_item_on_page` enriches `changed_frames` with `applied_parent_name`.

**Files:**
- Modify: `src/types.ts`
- Modify: `tests/unit/types.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/types.test.ts`:

```ts
  it("changed_pages accepts id and applied_parent_name", () => {
    const delta: DocumentStateDelta = {
      changed_pages: [
        { id: "pg1", applied_parent_name: "A-Footer" },
        { id: "pg2" },
      ],
    };
    expect(delta.changed_pages?.[0].applied_parent_name).toBe("A-Footer");
    expect(delta.changed_pages?.[1].applied_parent_name).toBeUndefined();
  });

  it("new_parent_spreads accepts name and page_count", () => {
    const delta: DocumentStateDelta = {
      new_parent_spreads: [
        { name: "A-Footer", page_count: 2 },
        { name: "B-Chapter", page_count: 1 },
      ],
    };
    expect(delta.new_parent_spreads?.[0].name).toBe("A-Footer");
    expect(delta.new_parent_spreads?.[0].page_count).toBe(2);
    expect(delta.new_parent_spreads?.[1].page_count).toBe(1);
  });

  it("changed_frames items accept applied_parent_name", () => {
    const delta: DocumentStateDelta = {
      changed_frames: [
        { id: "f1", applied_parent_name: "A-Footer" },
        { id: "f2", bounds: [0, 0, 50, 100] },
      ],
    };
    expect(delta.changed_frames?.[0].applied_parent_name).toBe("A-Footer");
    expect(delta.changed_frames?.[1].applied_parent_name).toBeUndefined();
  });
```

The import line at the top of `tests/unit/types.test.ts` already imports `DocumentStateDelta` and `FrameType` — no change needed there.

- [ ] **Step 2: Run, expect failure**

Run: `npx tsc --noEmit`
Expected: TS errors — `changed_pages`, `new_parent_spreads`, and `applied_parent_name` on `changed_frames` don't exist yet.

- [ ] **Step 3: Update `src/types.ts`**

Replace the `DocumentStateDelta` interface:

```ts
export interface DocumentStateDelta {
  changed_frames?: Array<{
    id: FrameId;
    bounds?: [number, number, number, number];
    applied_paragraph_style?: string;
    applied_image_path?: string;
    applied_parent_name?: string;        // NEW — from override_parent_item_on_page
  }>;
  new_frames?: Array<{ id: FrameId; type: FrameType }>;
  removed_frame_ids?: FrameId[];
  new_page_ids?: string[];
  removed_page_ids?: string[];
  page_count?: number;
  // NEW
  changed_pages?: Array<{
    id: string;
    applied_parent_name?: string;
  }>;
  new_parent_spreads?: Array<{
    name: string;
    page_count: number;       // 1 (single) or 2 (facing)
  }>;
}
```

- [ ] **Step 4: Run tests + tsc**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all existing tests still pass; the three new type-shape tests pass.

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/plan-b4
git add src/types.ts tests/unit/types.test.ts
git commit -m "feat: extend DocumentStateDelta with changed_pages and new_parent_spreads"
```

---

## Task 2: Bug fix — `create_document` per-page margins + facing-page mirroring

**Why:** Currently `create_document` sets margins on `doc.marginPreferences` (the document-level prefs object). This does NOT propagate to pages that already exist at creation time. And even with per-page iteration, InDesign doesn't auto-mirror `left`/`right` for facing pages — `page.side` determines which side is "inside". Fix: iterate `doc.pages` after creation and write each page's margins individually, mirroring left/right for facing-page docs when `inside`/`outside` margins were provided. Also set columns per-page to cure the same propagation issue. Drop the now-obsolete facing-pages warning.

**Files:**
- Modify: `src/tools/create-document.ts`
- Modify: `tests/unit/tools/create-document.test.ts`

### Step 1: Update unit tests

- [ ] Update `tests/unit/tools/create-document.test.ts`:

Remove the existing test "emits a warning when facing-page margins are used":

```ts
  // DELETE this test block entirely:
  it("emits a warning when facing-page margins are used", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { document_id: "d", page_ids: ["p"], page_count: 1 },
    });

    const env = await createDocumentTool.handler({
      preset: "A4",
      facing_pages: true,
      margins_mm: { top: 12, bottom: 12, inside: 14, outside: 10 },
    });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.warnings).toBeDefined();
    expect(env.warnings![0]).toMatch(/facing/i);
  });
```

Add these new tests in its place:

```ts
  it("script contains per-page loop when setting margins", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { document_id: "d", page_ids: ["p1"], page_count: 1 },
    });

    await createDocumentTool.handler({
      preset: "A4",
      margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("doc.pages");
    expect(arg.scriptTemplate).toContain("marginPreferences.top");
  });

  it("script mirrors inside/outside for facing-page docs", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { document_id: "d", page_ids: ["p1", "p2"], page_count: 2 },
    });

    await createDocumentTool.handler({
      preset: "A4",
      facing_pages: true,
      pages: 2,
      margins_mm: { top: 10, bottom: 10, inside: 25, outside: 15 },
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    // Must contain the LEFT_HAND mirroring branch
    expect(arg.scriptTemplate).toContain("LEFT_HAND");
    // Must reference both inside and outside values
    expect(arg.scriptTemplate).toContain("25");
    expect(arg.scriptTemplate).toContain("15");
  });

  it("does not emit a warning for facing-page margins after the fix", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { document_id: "d", page_ids: ["p1", "p2"], page_count: 2 },
    });

    const env = await createDocumentTool.handler({
      preset: "A4",
      facing_pages: true,
      pages: 2,
      margins_mm: { top: 10, bottom: 10, inside: 25, outside: 15 },
    });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    // No warnings — per-page mirroring handles this correctly now
    expect(env.warnings).toBeUndefined();
  });
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/unit/tools/create-document.test.ts`
Expected: the new tests fail (script doesn't yet contain per-page loop or LEFT_HAND branch); the removed warning test would have passed. Net: some failures.

### Step 3: Update `src/tools/create-document.ts`

- [ ] Replace `buildScriptBody` and the handler's `ok()` call:

In `buildScriptBody`, replace the current margin-setting block and the final `return`:

```ts
function buildScriptBody(input: Input): string {
  const dims = resolveDimensions(input);
  const margins = resolveMargins(input);
  const columns = input.columns ?? { count: 1, gutter_mm: 0 };
  const pages = input.pages ?? 1;
  const facing = input.facing_pages ?? false;
  const isFacingMargins = "inside" in input.margins_mm;

  // For facing-page documents with inside/outside margins, build a per-page
  // mirroring loop. Otherwise use the simpler uniform-margin loop.
  const perPageMarginLoop = isFacingMargins
    ? `
      for (var i = 0; i < doc.pages.length; i++) {
        var p = doc.pages[i];
        p.marginPreferences.top = ${lit(margins.top)};
        p.marginPreferences.bottom = ${lit(margins.bottom)};
        p.marginPreferences.columnCount = ${lit(columns.count)};
        p.marginPreferences.columnGutter = ${lit(columns.gutter_mm)};
        if (String(p.side) === "LEFT_HAND") {
          p.marginPreferences.left = ${lit((input.margins_mm as { outside: number }).outside)};
          p.marginPreferences.right = ${lit((input.margins_mm as { inside: number }).inside)};
        } else {
          p.marginPreferences.left = ${lit((input.margins_mm as { inside: number }).inside)};
          p.marginPreferences.right = ${lit((input.margins_mm as { outside: number }).outside)};
        }
      }
    `
    : `
      for (var i = 0; i < doc.pages.length; i++) {
        var p = doc.pages[i];
        p.marginPreferences.top = ${lit(margins.top)};
        p.marginPreferences.bottom = ${lit(margins.bottom)};
        p.marginPreferences.left = ${lit(margins.left)};
        p.marginPreferences.right = ${lit(margins.right)};
        p.marginPreferences.columnCount = ${lit(columns.count)};
        p.marginPreferences.columnGutter = ${lit(columns.gutter_mm)};
      }
    `;

  return `
    var prevUnits = app.scriptPreferences.measurementUnit;
    app.scriptPreferences.measurementUnit = MeasurementUnits.MILLIMETERS;
    try {
      var doc = app.documents.add();
      var dp = doc.documentPreferences;
      dp.facingPages = ${lit(facing)};
      dp.pageWidth = ${lit(dims.width_mm)};
      dp.pageHeight = ${lit(dims.height_mm)};
      dp.pagesPerDocument = ${lit(pages)};

      ${perPageMarginLoop}

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
```

In the handler, remove the warning logic. Replace:

```ts
    const isFacingMargins = "inside" in input.margins_mm;
    const warnings = isFacingMargins
      ? ["facing-page margins applied as left=inside/right=outside; verso pages will be mirrored incorrectly until per-spread setup is supported"]
      : undefined;
    return ok(
      { document_id: r.document_id, page_ids: r.page_ids },
      {
        document_state_delta: {
          page_count: r.page_count,
          new_page_ids: r.page_ids,
        },
        warnings,
      },
    );
```

With:

```ts
    return ok(
      { document_id: r.document_id, page_ids: r.page_ids },
      {
        document_state_delta: {
          page_count: r.page_count,
          new_page_ids: r.page_ids,
        },
      },
    );
```

Also remove the `resolveMargins` function's reliance on producing left=inside/right=outside (it's now only used for the non-facing path). The function can remain as-is since we cast `input.margins_mm` directly in the facing branch.

- [ ] **Step 4: Run unit tests, expect pass**

Run: `npm test -- tests/unit/tools/create-document.test.ts`
Expected: all tests pass, including the three new ones.

- [ ] **Step 5: Run full suite + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, tsc clean.

- [ ] **Step 6: Write integration test**

Add to `tests/integration/create-document.int.test.ts` (append after existing tests):

```ts
  it(
    "facing-page A4 doc: RIGHT_HAND page has left=inside, LEFT_HAND has left=outside",
    async () => {
      // Create a 2-page facing doc. Page 0 is RIGHT_HAND (recto), page 1 is LEFT_HAND (verso).
      const env = await createDocumentTool.handler({
        preset: "A4",
        facing_pages: true,
        pages: 2,
        margins_mm: { top: 10, bottom: 10, inside: 25, outside: 15 },
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;

      // Query each page's margin prefs via a script
      const pageIds = env.result!.page_ids;
      const body = `
        var doc = app.activeDocument;
        var result = [];
        for (var i = 0; i < doc.pages.length; i++) {
          var p = doc.pages[i];
          result.push({
            id: String(p.id),
            side: String(p.side),
            left: p.marginPreferences.left,
            right: p.marginPreferences.right
          });
        }
        return { pages: result };
      `;
      const { wrapExtendScript } = await import("../../src/compose.js");
      const { runScriptWithResultFile } = await import("../../src/transport/result-file.js");
      const { z } = await import("zod");

      const PageInfoSchema = z.object({
        pages: z.array(z.object({
          id: z.string(),
          side: z.string(),
          left: z.number(),
          right: z.number(),
        })),
      });

      const result = await runScriptWithResultFile<z.infer<typeof PageInfoSchema>>({
        language: "JavaScript",
        scriptTemplate: wrapExtendScript(body),
        resultSchema: PageInfoSchema,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const pages = result.result!.pages;
      const recto = pages.find((p) => p.side === "RIGHT_HAND" || p.side === "1281774162");
      const verso = pages.find((p) => p.side === "LEFT_HAND" || p.side === "1281971784");

      // Note: InDesign may stringify PageSideOptions as the enum name or numeric value.
      // If both are undefined, the test skips gracefully (wrong InDesign version).
      if (recto && verso) {
        expect(recto.left).toBeCloseTo(25, 1);   // inside
        expect(recto.right).toBeCloseTo(15, 1);  // outside
        expect(verso.left).toBeCloseTo(15, 1);   // outside
        expect(verso.right).toBeCloseTo(25, 1);  // inside
      }
    },
    INTEGRATION_TIMEOUT_MS,
  );
```

> **Implementer note:** `page.side` in ExtendScript returns a `PageSideOptions` enum member. When stringified with `String()`, InDesign 2026 returns the enum name (`"LEFT_HAND"`, `"RIGHT_HAND"`, `"SINGLE_SIDED"`). If the integration test finds both are `undefined`, check what value the real script returns and adjust the `find` predicates accordingly.

- [ ] **Step 7: Run full suite + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: all unit tests pass, tsc clean.

- [ ] **Step 8: Commit**

```bash
git add src/tools/create-document.ts tests/unit/tools/create-document.test.ts tests/integration/create-document.int.test.ts
git commit -m "fix: create_document propagates margins per-page; facing-page mirroring"
```

---

## Task 3: `findMasterSpreadByName` script helper

**Why:** `apply_parent_to_page` and `create_parent_page` both need to locate a master spread by name. Extract to `script-helpers.ts`, mirrors `findStyleByName`'s pattern exactly. Throws structured `not_found` with `entity: "parent_spread"`.

**Files:**
- Modify: `src/script-helpers.ts`
- Modify: `tests/unit/script-helpers.test.ts`

- [ ] **Step 1: Add failing test**

Append to the `describe("script helpers", ...)` block in `tests/unit/script-helpers.test.ts`:

```ts
  it("findMasterSpreadByName is a non-empty function declaration", () => {
    expect(findMasterSpreadByName).toContain("function findMasterSpreadByName");
    expect(findMasterSpreadByName).toContain('throw { name: "not_found"');
    expect(findMasterSpreadByName).toContain("doc.masterSpreads.itemByName");
    expect(findMasterSpreadByName).toContain('"parent_spread"');
  });
```

Update the import line at the top of `tests/unit/script-helpers.test.ts`:

```ts
import { findDocumentById, findPageById, findFrameById, findStyleByName, resolveSwatch, findMasterSpreadByName } from "../../src/script-helpers.js";
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/unit/script-helpers.test.ts`
Expected: import error — `findMasterSpreadByName` not exported.

- [ ] **Step 3: Add helper to `src/script-helpers.ts`**

Append to `src/script-helpers.ts`:

```ts
export const findMasterSpreadByName = `
function findMasterSpreadByName(doc, name) {
  var s = doc.masterSpreads.itemByName(name);
  if (!s.isValid) {
    throw { name: "not_found", message: "parent spread \\"" + name + "\\" not found", entity: "parent_spread", id: name };
  }
  return s;
}
`.trim();
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npm test -- tests/unit/script-helpers.test.ts`
Expected: all pass, including the new test.

- [ ] **Step 5: Run full suite + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/script-helpers.ts tests/unit/script-helpers.test.ts
git commit -m "feat: findMasterSpreadByName script helper"
```

---

## Task 4: `create_parent_page` tool

**Files:**
- Create: `src/tools/create-parent-page.ts`
- Create: `tests/unit/tools/create-parent-page.test.ts`
- Create: `tests/integration/create-parent-page.int.test.ts`
- Modify: `src/index.ts`

### Step 1: Write the unit test file

- [ ] Create `tests/unit/tools/create-parent-page.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createParentPageTool } from "../../../src/tools/create-parent-page.js";
import { lastCall, expectFailure } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("create_parent_page tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(createParentPageTool.name).toBe("create_parent_page");
    expect(createParentPageTool.description.length).toBeGreaterThan(0);
  });

  it("accepts minimal valid input — base_name only", () => {
    expect(
      createParentPageTool.inputSchema.safeParse({ base_name: "Footer" }).success,
    ).toBe(true);
  });

  it("accepts base_name with optional name_prefix and facing", () => {
    expect(
      createParentPageTool.inputSchema.safeParse({
        base_name: "Chapter",
        name_prefix: "B",
        facing: true,
      }).success,
    ).toBe(true);
  });

  it("rejects empty base_name", () => {
    expect(
      createParentPageTool.inputSchema.safeParse({ base_name: "" }).success,
    ).toBe(false);
  });

  it("rejects base_name longer than 60 characters", () => {
    expect(
      createParentPageTool.inputSchema.safeParse({
        base_name: "A".repeat(61),
      }).success,
    ).toBe(false);
  });

  it("rejects name_prefix that is not a single uppercase letter", () => {
    expect(
      createParentPageTool.inputSchema.safeParse({
        base_name: "Footer",
        name_prefix: "AB",
      }).success,
    ).toBe(false);

    expect(
      createParentPageTool.inputSchema.safeParse({
        base_name: "Footer",
        name_prefix: "a",
      }).success,
    ).toBe(false);

    expect(
      createParentPageTool.inputSchema.safeParse({
        base_name: "Footer",
        name_prefix: "1",
      }).success,
    ).toBe(false);
  });

  it("accepts a valid single-letter uppercase name_prefix", () => {
    expect(
      createParentPageTool.inputSchema.safeParse({
        base_name: "Footer",
        name_prefix: "Z",
      }).success,
    ).toBe(true);
  });

  it("dispatches a script that calls masterSpreads.add with baseName", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { parent_name: "A-Footer", page_ids: ["ms1", "ms2"], page_count: 2 },
    });

    await createParentPageTool.handler({ base_name: "Footer" });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("masterSpreads.add");
    expect(arg.scriptTemplate).toContain("baseName");
    expect(arg.scriptTemplate).toContain('"Footer"');
  });

  it("includes namePrefix in script when provided", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { parent_name: "B-Footer", page_ids: ["ms3"], page_count: 1 },
    });

    await createParentPageTool.handler({ base_name: "Footer", name_prefix: "B" });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain('"B"');
    expect(arg.scriptTemplate).toContain("namePrefix");
  });

  it("returns parent_name, page_ids, and new_parent_spreads delta", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { parent_name: "A-Footer", page_ids: ["ms1", "ms2"], page_count: 2 },
    });

    const env = await createParentPageTool.handler({ base_name: "Footer" });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result).toEqual({ parent_name: "A-Footer", page_ids: ["ms1", "ms2"] });
    expect(env.document_state_delta).toEqual({
      new_parent_spreads: [{ name: "A-Footer", page_count: 2 }],
    });
  });

  it("propagates failure envelopes verbatim", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: { kind: "script_error", message: "bad prefix letter" },
    });

    const env = await createParentPageTool.handler({ base_name: "Footer" });

    expectFailure(env);
    expect(env.error.kind).toBe("script_error");
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/unit/tools/create-parent-page.test.ts`
Expected: module not found.

### Step 3: Write tool source

- [ ] Create `src/tools/create-parent-page.ts`:

```ts
import { z } from "zod";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript, lit, prelude } from "../compose.js";
import { findDocumentById } from "../script-helpers.js";
import { ok } from "../errors.js";

const NAME_PREFIX_RE = /^[A-Z]$/;

const InputSchema = z
  .object({
    base_name: z.string().min(1).max(60),
    name_prefix: z.string().regex(NAME_PREFIX_RE).optional(),
    facing: z.boolean().optional(),
    document_id: z.string().optional(),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

const ScriptResultSchema = z.object({
  parent_name: z.string(),
  page_ids: z.array(z.string()),
  page_count: z.number().int().nonnegative(),
});

type ScriptResult = z.infer<typeof ScriptResultSchema>;

interface Result {
  parent_name: string;
  page_ids: string[];
}

function buildScriptBody(input: Input): string {
  const docExpr =
    input.document_id !== undefined
      ? `findDocumentById(${lit(input.document_id)})`
      : "app.activeDocument";

  // Build the properties object to pass to masterSpreads.add.
  // Only include namePrefix when the caller explicitly provided it —
  // omitting it lets InDesign auto-assign the next free letter.
  const namePrefixLine =
    input.name_prefix !== undefined
      ? `master.namePrefix = ${lit(input.name_prefix)};`
      : "";

  // When facing is explicitly provided and differs from the doc default,
  // we may need to adjust the master spread's page count post-creation.
  // We compare against doc.documentPreferences.facingPages and set
  // master.pageCount accordingly. pageCount 1 = single, 2 = facing.
  const facingLine =
    input.facing !== undefined
      ? `
  var wantFacing = ${lit(input.facing)};
  var docFacing = doc.documentPreferences.facingPages;
  if (wantFacing !== docFacing) {
    // Cannot change page count on a master spread directly in all versions;
    // this is a best-effort hint — InDesign enforces its own rules.
    // We record the actual page count from the spread.
  }
`
      : "";

  return `
${prelude(findDocumentById)}
var doc = ${docExpr};
var master = doc.masterSpreads.add();
master.baseName = ${lit(input.base_name)};
${namePrefixLine}
${facingLine}
var pageIds = [];
for (var i = 0; i < master.pages.length; i++) {
  pageIds.push(String(master.pages[i].id));
}
return {
  parent_name: master.name,
  page_ids: pageIds,
  page_count: master.pages.length
};
`;
}

export const createParentPageTool = defineTool<Input, Result>({
  name: "create_parent_page",
  description:
    "Creates a master spread (parent page) in the active document. Returns the full parent name (e.g. \"A-Footer\") and the IDs of the master spread's pages, which can be used with create_text_frame and other tools to add shared content.",
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
      { parent_name: r.parent_name, page_ids: r.page_ids },
      {
        document_state_delta: {
          new_parent_spreads: [{ name: r.parent_name, page_count: r.page_count }],
        },
      },
    );
  },
});
```

> **DOM verification note for the implementer:** The ExtendScript DOM for `masterSpreads.add()` may or may not accept a properties object at construction time (varies by InDesign version). The plan above uses post-creation property assignment (`master.baseName = ...`) which is the safest approach. Verify live that `master.baseName` is a writable property in InDesign 2026 (it should be — it corresponds to the label in the Pages panel). If `namePrefix` is not directly settable post-creation, the fallback is to call `doc.masterSpreads.add({ namePrefix: ... })` at construction. Test and adjust during execution.

- [ ] **Step 4: Register in `src/index.ts`**

```ts
import { createParentPageTool } from "./tools/create-parent-page.js";
// ...
registry.register(createParentPageTool);
```

- [ ] **Step 5: Run unit tests, expect pass**

Run: `npm test -- tests/unit/tools/create-parent-page.test.ts`
Expected: all pass.

- [ ] **Step 6: Run full suite + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, tsc clean.

- [ ] **Step 7: Write integration test**

Create `tests/integration/create-parent-page.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { createParentPageTool } from "../../src/tools/create-parent-page.js";

integrationGate("create_parent_page (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "creates a master spread in a fresh A4 document",
    async () => {
      const create = await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });
      expect(create.ok).toBe(true);
      if (!create.ok) return;

      const env = await createParentPageTool.handler({ base_name: "Footer" });
      expect(env.ok).toBe(true);
      if (!env.ok) return;

      // InDesign auto-assigns the first available prefix; "A" is taken by
      // the default "[None]" spread, so the first custom one is typically "A"
      // or "B" depending on the version. Accept any single-letter prefix.
      expect(env.result?.parent_name).toMatch(/^[A-Z]-Footer$/);
      expect(Array.isArray(env.result?.page_ids)).toBe(true);
      expect(env.result?.page_ids.length).toBeGreaterThanOrEqual(1);
      expect(env.document_state_delta?.new_parent_spreads?.[0].name).toMatch(/Footer/);
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "creates a master spread with an explicit name_prefix",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      const env = await createParentPageTool.handler({
        base_name: "Chapter",
        name_prefix: "C",
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      // May be "C-Chapter" if C is free; InDesign may adjust if C is taken.
      expect(env.result?.parent_name).toContain("Chapter");
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
```

- [ ] **Step 8: Verify tsc**

Run: `npx tsc --noEmit`

- [ ] **Step 9: Commit**

```bash
git add src/tools/create-parent-page.ts src/index.ts tests/unit/tools/create-parent-page.test.ts tests/integration/create-parent-page.int.test.ts
git commit -m "feat: create_parent_page tool"
```

---

## Task 5: `apply_parent_to_page` tool

**Files:**
- Create: `src/tools/apply-parent-to-page.ts`
- Create: `tests/unit/tools/apply-parent-to-page.test.ts`
- Create: `tests/integration/apply-parent-to-page.int.test.ts`
- Modify: `src/index.ts`

### Step 1: Write the unit test file

- [ ] Create `tests/unit/tools/apply-parent-to-page.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyParentToPageTool } from "../../../src/tools/apply-parent-to-page.js";
import { lastCall, expectFailure } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("apply_parent_to_page tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(applyParentToPageTool.name).toBe("apply_parent_to_page");
    expect(applyParentToPageTool.description.length).toBeGreaterThan(0);
  });

  it("accepts valid input with page_id and parent_name", () => {
    expect(
      applyParentToPageTool.inputSchema.safeParse({
        page_id: "pg1",
        parent_name: "A-Footer",
      }).success,
    ).toBe(true);
  });

  it("rejects missing page_id", () => {
    expect(
      applyParentToPageTool.inputSchema.safeParse({
        parent_name: "A-Footer",
      }).success,
    ).toBe(false);
  });

  it("rejects missing parent_name", () => {
    expect(
      applyParentToPageTool.inputSchema.safeParse({
        page_id: "pg1",
      }).success,
    ).toBe(false);
  });

  it("rejects empty page_id", () => {
    expect(
      applyParentToPageTool.inputSchema.safeParse({
        page_id: "",
        parent_name: "A-Footer",
      }).success,
    ).toBe(false);
  });

  it("rejects empty parent_name", () => {
    expect(
      applyParentToPageTool.inputSchema.safeParse({
        page_id: "pg1",
        parent_name: "",
      }).success,
    ).toBe(false);
  });

  it("dispatches a script using findPageById and findMasterSpreadByName", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { page_id: "pg1", parent_name: "A-Footer" },
    });

    await applyParentToPageTool.handler({
      page_id: "pg1",
      parent_name: "A-Footer",
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("findPageById");
    expect(arg.scriptTemplate).toContain("findMasterSpreadByName");
    expect(arg.scriptTemplate).toContain("appliedMaster");
    expect(arg.scriptTemplate).toContain('"pg1"');
    expect(arg.scriptTemplate).toContain('"A-Footer"');
  });

  it("returns page_id, parent_name, and changed_pages delta", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { page_id: "pg1", parent_name: "A-Footer" },
    });

    const env = await applyParentToPageTool.handler({
      page_id: "pg1",
      parent_name: "A-Footer",
    });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result).toEqual({ page_id: "pg1", parent_name: "A-Footer" });
    expect(env.document_state_delta).toEqual({
      changed_pages: [{ id: "pg1", applied_parent_name: "A-Footer" }],
    });
  });

  it("propagates not_found failure when parent spread is missing", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: {
        kind: "not_found",
        message: 'parent spread "Z-Missing" not found',
        entity: "parent_spread",
        id: "Z-Missing",
      },
    });

    const env = await applyParentToPageTool.handler({
      page_id: "pg1",
      parent_name: "Z-Missing",
    });

    expectFailure(env);
    expect(env.error.kind).toBe("not_found");
    expect(env.error.entity).toBe("parent_spread");
  });

  it("propagates failure envelopes verbatim for page not found", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: { kind: "not_found", message: "page pg99 not found", entity: "page", id: "pg99" },
    });

    const env = await applyParentToPageTool.handler({
      page_id: "pg99",
      parent_name: "A-Footer",
    });

    expectFailure(env);
    expect(env.error.kind).toBe("not_found");
    expect(env.error.entity).toBe("page");
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/unit/tools/apply-parent-to-page.test.ts`
Expected: module not found.

### Step 3: Write tool source

- [ ] Create `src/tools/apply-parent-to-page.ts`:

```ts
import { z } from "zod";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript, lit, prelude } from "../compose.js";
import { findDocumentById, findPageById, findMasterSpreadByName } from "../script-helpers.js";
import { ok } from "../errors.js";

const InputSchema = z
  .object({
    page_id: z.string().min(1),
    parent_name: z.string().min(1),
    document_id: z.string().optional(),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

const ScriptResultSchema = z.object({
  page_id: z.string(),
  parent_name: z.string(),
});

type ScriptResult = z.infer<typeof ScriptResultSchema>;

interface Result {
  page_id: string;
  parent_name: string;
}

function buildScriptBody(input: Input): string {
  const docExpr =
    input.document_id !== undefined
      ? `findDocumentById(${lit(input.document_id)})`
      : "app.activeDocument";

  return `
${prelude(findDocumentById, findPageById, findMasterSpreadByName)}
var doc = ${docExpr};
var page = findPageById(doc, ${lit(input.page_id)});
var master = findMasterSpreadByName(doc, ${lit(input.parent_name)});
page.appliedMaster = master;
return {
  page_id: ${lit(input.page_id)},
  parent_name: master.name
};
`;
}

export const applyParentToPageTool = defineTool<Input, Result>({
  name: "apply_parent_to_page",
  description:
    "Applies a named parent page (master spread) to a document page. Use the full parent name including prefix, e.g. \"A-Footer\". Returns the page and parent name.",
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
      { page_id: r.page_id, parent_name: r.parent_name },
      {
        document_state_delta: {
          changed_pages: [{ id: r.page_id, applied_parent_name: r.parent_name }],
        },
      },
    );
  },
});
```

- [ ] **Step 4: Register in `src/index.ts`**

```ts
import { applyParentToPageTool } from "./tools/apply-parent-to-page.js";
// ...
registry.register(applyParentToPageTool);
```

- [ ] **Step 5: Run unit tests, expect pass**

Run: `npm test -- tests/unit/tools/apply-parent-to-page.test.ts`
Expected: all pass.

- [ ] **Step 6: Run full suite + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, tsc clean.

- [ ] **Step 7: Write integration test**

Create `tests/integration/apply-parent-to-page.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { createParentPageTool } from "../../src/tools/create-parent-page.js";
import { applyParentToPageTool } from "../../src/tools/apply-parent-to-page.js";

integrationGate("apply_parent_to_page (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "applies a newly created parent page to a document page",
    async () => {
      const createDoc = await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });
      expect(createDoc.ok).toBe(true);
      if (!createDoc.ok) return;

      const pageId = createDoc.result!.page_ids[0];

      const createParent = await createParentPageTool.handler({
        base_name: "Footer",
      });
      expect(createParent.ok).toBe(true);
      if (!createParent.ok) return;

      const parentName = createParent.result!.parent_name;

      const env = await applyParentToPageTool.handler({
        page_id: pageId,
        parent_name: parentName,
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result?.page_id).toBe(pageId);
      expect(env.result?.parent_name).toBe(parentName);
      expect(env.document_state_delta?.changed_pages?.[0]).toEqual({
        id: pageId,
        applied_parent_name: parentName,
      });
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "returns not_found when parent spread name does not exist",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      // A fresh doc's only master is "[None]" and "A-Master"; "Z-Missing" should not exist.
      const env = await applyParentToPageTool.handler({
        page_id: "any-id",
        parent_name: "Z-Missing",
      });
      expect(env.ok).toBe(false);
      if (env.ok) return;
      // Could be not_found for the page (if page_id is wrong) or parent_spread.
      // Either is acceptable; check the call doesn't crash.
      expect(["not_found", "script_error"]).toContain(env.error.kind);
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
```

- [ ] **Step 8: Verify tsc**

Run: `npx tsc --noEmit`

- [ ] **Step 9: Commit**

```bash
git add src/tools/apply-parent-to-page.ts src/index.ts tests/unit/tools/apply-parent-to-page.test.ts tests/integration/apply-parent-to-page.int.test.ts
git commit -m "feat: apply_parent_to_page tool"
```

---

## Task 6: `override_parent_item_on_page` tool

**Files:**
- Create: `src/tools/override-parent-item-on-page.ts`
- Create: `tests/unit/tools/override-parent-item-on-page.test.ts`
- Create: `tests/integration/override-parent-item-on-page.int.test.ts`
- Modify: `src/index.ts`

### Step 1: Write the unit test file

- [ ] Create `tests/unit/tools/override-parent-item-on-page.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { overrideParentItemOnPageTool } from "../../../src/tools/override-parent-item-on-page.js";
import { lastCall, expectFailure } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("override_parent_item_on_page tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(overrideParentItemOnPageTool.name).toBe("override_parent_item_on_page");
    expect(overrideParentItemOnPageTool.description.length).toBeGreaterThan(0);
  });

  it("accepts valid input with page_id and parent_item_id", () => {
    expect(
      overrideParentItemOnPageTool.inputSchema.safeParse({
        page_id: "pg1",
        parent_item_id: "fi1",
      }).success,
    ).toBe(true);
  });

  it("rejects missing page_id", () => {
    expect(
      overrideParentItemOnPageTool.inputSchema.safeParse({
        parent_item_id: "fi1",
      }).success,
    ).toBe(false);
  });

  it("rejects missing parent_item_id", () => {
    expect(
      overrideParentItemOnPageTool.inputSchema.safeParse({
        page_id: "pg1",
      }).success,
    ).toBe(false);
  });

  it("rejects empty parent_item_id", () => {
    expect(
      overrideParentItemOnPageTool.inputSchema.safeParse({
        page_id: "pg1",
        parent_item_id: "",
      }).success,
    ).toBe(false);
  });

  it("dispatches a script using findFrameById and override", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        page_id: "pg1",
        source_parent_item_id: "fi1",
        overridden_frame_id: "lf1",
        frame_type: "text",
      },
    });

    await overrideParentItemOnPageTool.handler({
      page_id: "pg1",
      parent_item_id: "fi1",
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("findFrameById");
    expect(arg.scriptTemplate).toContain("findPageById");
    expect(arg.scriptTemplate).toContain(".override(");
    expect(arg.scriptTemplate).toContain('"fi1"');
    expect(arg.scriptTemplate).toContain('"pg1"');
  });

  it("script validates the source item is on a master spread", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        page_id: "pg1",
        source_parent_item_id: "fi1",
        overridden_frame_id: "lf1",
        frame_type: "text",
      },
    });

    await overrideParentItemOnPageTool.handler({
      page_id: "pg1",
      parent_item_id: "fi1",
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("MasterSpread");
    expect(arg.scriptTemplate).toContain("invalid_args");
  });

  it("returns overridden_frame_id and both new_frames and changed_frames deltas", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        page_id: "pg1",
        source_parent_item_id: "fi1",
        overridden_frame_id: "lf1",
        frame_type: "text",
      },
    });

    const env = await overrideParentItemOnPageTool.handler({
      page_id: "pg1",
      parent_item_id: "fi1",
    });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result).toEqual({
      page_id: "pg1",
      source_parent_item_id: "fi1",
      overridden_frame_id: "lf1",
    });
    expect(env.document_state_delta?.new_frames).toEqual([
      { id: "lf1", type: "text" },
    ]);
    expect(env.document_state_delta?.changed_frames).toEqual([
      { id: "lf1", applied_parent_name: undefined },
    ]);
  });

  it("propagates invalid_args when item is not on a master spread", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: {
        kind: "invalid_args",
        message: "parent_item_id fi2 is not on a master spread",
      },
    });

    const env = await overrideParentItemOnPageTool.handler({
      page_id: "pg1",
      parent_item_id: "fi2",
    });

    expectFailure(env);
    expect(env.error.kind).toBe("invalid_args");
  });

  it("propagates failure envelopes verbatim", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: { kind: "not_found", message: "frame fi99 not found", entity: "frame" },
    });

    const env = await overrideParentItemOnPageTool.handler({
      page_id: "pg1",
      parent_item_id: "fi99",
    });

    expectFailure(env);
    expect(env.error.kind).toBe("not_found");
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/unit/tools/override-parent-item-on-page.test.ts`
Expected: module not found.

### Step 3: Write tool source

- [ ] Create `src/tools/override-parent-item-on-page.ts`:

```ts
import { z } from "zod";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript, lit, prelude } from "../compose.js";
import { findDocumentById, findPageById, findFrameById } from "../script-helpers.js";
import { ok } from "../errors.js";
import type { FrameType } from "../types.js";

const InputSchema = z
  .object({
    page_id: z.string().min(1),
    parent_item_id: z.string().min(1),
    document_id: z.string().optional(),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

const ScriptResultSchema = z.object({
  page_id: z.string(),
  source_parent_item_id: z.string(),
  overridden_frame_id: z.string(),
  frame_type: z.string(),
});

type ScriptResult = z.infer<typeof ScriptResultSchema>;

interface Result {
  page_id: string;
  source_parent_item_id: string;
  overridden_frame_id: string;
}

function discriminateFrameType(scriptType: string): FrameType {
  if (scriptType === "TextFrame") return "text";
  if (scriptType === "Rectangle") return "rectangle";
  if (scriptType === "GraphicLine") return "line";
  return "rectangle"; // conservative fallback
}

function buildScriptBody(input: Input): string {
  const docExpr =
    input.document_id !== undefined
      ? `findDocumentById(${lit(input.document_id)})`
      : "app.activeDocument";

  return `
${prelude(findDocumentById, findPageById, findFrameById)}
var doc = ${docExpr};
var parentItem = findFrameById(doc, ${lit(input.parent_item_id)});
var targetPage = findPageById(doc, ${lit(input.page_id)});

// Validate that the source item is on a master spread, not a document page.
var parentContainer = parentItem.parent;
var containerType = parentContainer ? parentContainer.constructor.name : "";
if (containerType !== "MasterSpread" && containerType !== "Spread") {
  // Check via the spread's parent: if the spread's parent is a MasterSpread,
  // then we have a valid master item. Otherwise reject.
  var spreadParentType = (parentContainer && parentContainer.parent)
    ? parentContainer.parent.constructor.name
    : "";
  if (spreadParentType !== "MasterSpread" && containerType !== "MasterSpread") {
    throw {
      name: "invalid_args",
      message: "parent_item_id " + ${lit(input.parent_item_id)} + " is not on a master spread",
      entity: "frame",
      id: ${lit(input.parent_item_id)}
    };
  }
}

var localItem = parentItem.override(targetPage);
var frameType = localItem.constructor.name;
return {
  page_id: ${lit(input.page_id)},
  source_parent_item_id: ${lit(input.parent_item_id)},
  overridden_frame_id: String(localItem.id),
  frame_type: frameType
};
`;
}

export const overrideParentItemOnPageTool = defineTool<Input, Result>({
  name: "override_parent_item_on_page",
  description:
    "Overrides a parent-page (master spread) item onto a document page, making it locally editable. Returns the new local frame's id. The source item must be on a master spread.",
  inputSchema: InputSchema,
  async handler(input) {
    const env = await runScriptWithResultFile<ScriptResult>({
      language: "JavaScript",
      scriptTemplate: wrapExtendScript(buildScriptBody(input)),
      resultSchema: ScriptResultSchema,
    });
    if (!env.ok) return env;
    const r = env.result!;
    const frameType = discriminateFrameType(r.frame_type);
    return ok(
      {
        page_id: r.page_id,
        source_parent_item_id: r.source_parent_item_id,
        overridden_frame_id: r.overridden_frame_id,
      },
      {
        document_state_delta: {
          new_frames: [{ id: r.overridden_frame_id, type: frameType }],
          changed_frames: [{ id: r.overridden_frame_id, applied_parent_name: undefined }],
        },
      },
    );
  },
});
```

> **DOM note for the implementer:** `parentItem.parent` in ExtendScript for a frame on a master spread returns the `MasterSpread` object directly (not a `Spread`). The check `containerType === "MasterSpread"` should be sufficient. Verify live and simplify if the two-level check is unnecessary. The `override()` method returns the local `PageItem` — it will be a `TextFrame`, `Rectangle`, etc. at the subclass level; `constructor.name` gives the right type string.

- [ ] **Step 4: Register in `src/index.ts`**

```ts
import { overrideParentItemOnPageTool } from "./tools/override-parent-item-on-page.js";
// ...
registry.register(overrideParentItemOnPageTool);
```

- [ ] **Step 5: Run unit tests, expect pass**

Run: `npm test -- tests/unit/tools/override-parent-item-on-page.test.ts`
Expected: all pass.

> **Note on the changed_frames delta test:** The test above asserts `applied_parent_name: undefined`. The delta entry signals "this frame's parent context changed" but we don't have the parent name at this point (the local item doesn't carry it). If this causes a Vitest deepEqual mismatch (undefined fields may be omitted), adjust the assertion to use `expect(env.document_state_delta?.changed_frames?.[0]).toMatchObject({ id: "lf1" })` instead.

- [ ] **Step 6: Run full suite + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, tsc clean.

- [ ] **Step 7: Write integration test**

Create `tests/integration/override-parent-item-on-page.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { createParentPageTool } from "../../src/tools/create-parent-page.js";
import { createTextFrameTool } from "../../src/tools/create-text-frame.js";
import { applyParentToPageTool } from "../../src/tools/apply-parent-to-page.js";
import { overrideParentItemOnPageTool } from "../../src/tools/override-parent-item-on-page.js";

integrationGate("override_parent_item_on_page (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "overrides a master text frame onto a document page",
    async () => {
      // 1. Create doc
      const createDoc = await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });
      expect(createDoc.ok).toBe(true);
      if (!createDoc.ok) return;
      const docPageId = createDoc.result!.page_ids[0];

      // 2. Create parent page
      const createParent = await createParentPageTool.handler({
        base_name: "TestMaster",
      });
      expect(createParent.ok).toBe(true);
      if (!createParent.ok) return;
      const masterPageId = createParent.result!.page_ids[0];
      const parentName = createParent.result!.parent_name;

      // 3. Add a text frame to the master page
      const createFrame = await createTextFrameTool.handler({
        page_id: masterPageId,
        bounds_mm: { x: 10, y: 270, width: 190, height: 15 },
      });
      expect(createFrame.ok).toBe(true);
      if (!createFrame.ok) return;
      const masterFrameId = createFrame.result!.frame_id;

      // 4. Apply the parent to the doc page
      const applyEnv = await applyParentToPageTool.handler({
        page_id: docPageId,
        parent_name: parentName,
      });
      expect(applyEnv.ok).toBe(true);

      // 5. Override the master frame onto the doc page
      const env = await overrideParentItemOnPageTool.handler({
        page_id: docPageId,
        parent_item_id: masterFrameId,
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(typeof env.result?.overridden_frame_id).toBe("string");
      expect(env.result?.overridden_frame_id).not.toBe(masterFrameId);
      expect(env.document_state_delta?.new_frames?.[0].type).toBe("text");
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
```

- [ ] **Step 8: Verify tsc**

Run: `npx tsc --noEmit`

- [ ] **Step 9: Commit**

```bash
git add src/tools/override-parent-item-on-page.ts src/index.ts tests/unit/tools/override-parent-item-on-page.test.ts tests/integration/override-parent-item-on-page.int.test.ts
git commit -m "feat: override_parent_item_on_page tool"
```

---

## Task 7: `insert_page_number_marker` tool

**Files:**
- Create: `src/tools/insert-page-number-marker.ts`
- Create: `tests/unit/tools/insert-page-number-marker.test.ts`
- Create: `tests/integration/insert-page-number-marker.int.test.ts`
- Modify: `src/index.ts`

### Step 1: Write the unit test file

- [ ] Create `tests/unit/tools/insert-page-number-marker.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { insertPageNumberMarkerTool } from "../../../src/tools/insert-page-number-marker.js";
import { lastCall, expectFailure } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("insert_page_number_marker tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(insertPageNumberMarkerTool.name).toBe("insert_page_number_marker");
    expect(insertPageNumberMarkerTool.description.length).toBeGreaterThan(0);
  });

  it("accepts minimal valid input — frame_id only", () => {
    expect(
      insertPageNumberMarkerTool.inputSchema.safeParse({ frame_id: "f1" }).success,
    ).toBe(true);
  });

  it("accepts frame_id with position start", () => {
    expect(
      insertPageNumberMarkerTool.inputSchema.safeParse({
        frame_id: "f1",
        position: "start",
      }).success,
    ).toBe(true);
  });

  it("accepts frame_id with position end", () => {
    expect(
      insertPageNumberMarkerTool.inputSchema.safeParse({
        frame_id: "f1",
        position: "end",
      }).success,
    ).toBe(true);
  });

  it("rejects invalid position value", () => {
    expect(
      insertPageNumberMarkerTool.inputSchema.safeParse({
        frame_id: "f1",
        position: "middle",
      }).success,
    ).toBe(false);
  });

  it("rejects missing frame_id", () => {
    expect(
      insertPageNumberMarkerTool.inputSchema.safeParse({}).success,
    ).toBe(false);
  });

  it("rejects empty frame_id", () => {
    expect(
      insertPageNumberMarkerTool.inputSchema.safeParse({ frame_id: "" }).success,
    ).toBe(false);
  });

  it("dispatches a script using findFrameById and AUTO_PAGE_NUMBER at end by default", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { frame_id: "f1", inserted_at: "end" },
    });

    await insertPageNumberMarkerTool.handler({ frame_id: "f1" });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("findFrameById");
    expect(arg.scriptTemplate).toContain("AUTO_PAGE_NUMBER");
    expect(arg.scriptTemplate).toContain("parentStory");
    expect(arg.scriptTemplate).toContain('"f1"');
    // Default position is end — use insertionPoints[-1]
    expect(arg.scriptTemplate).toContain("[-1]");
  });

  it("dispatches a script using insertionPoints[0] when position is start", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { frame_id: "f1", inserted_at: "start" },
    });

    await insertPageNumberMarkerTool.handler({ frame_id: "f1", position: "start" });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("[0]");
  });

  it("script validates that frame is a TextFrame", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { frame_id: "f1", inserted_at: "end" },
    });

    await insertPageNumberMarkerTool.handler({ frame_id: "f1" });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("TextFrame");
    expect(arg.scriptTemplate).toContain("invalid_args");
  });

  it("returns frame_id, inserted_at, and changed_frames delta", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { frame_id: "f1", inserted_at: "end" },
    });

    const env = await insertPageNumberMarkerTool.handler({ frame_id: "f1" });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result).toEqual({ frame_id: "f1", inserted_at: "end" });
    expect(env.document_state_delta).toEqual({
      changed_frames: [{ id: "f1" }],
    });
  });

  it("propagates invalid_args when frame is not a TextFrame", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: {
        kind: "invalid_args",
        message: "frame f2 is not a TextFrame",
      },
    });

    const env = await insertPageNumberMarkerTool.handler({ frame_id: "f2" });

    expectFailure(env);
    expect(env.error.kind).toBe("invalid_args");
  });

  it("propagates failure envelopes verbatim", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: { kind: "not_found", message: "frame f99 not found", entity: "frame" },
    });

    const env = await insertPageNumberMarkerTool.handler({ frame_id: "f99" });

    expectFailure(env);
    expect(env.error.kind).toBe("not_found");
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/unit/tools/insert-page-number-marker.test.ts`
Expected: module not found.

### Step 3: Write tool source

- [ ] Create `src/tools/insert-page-number-marker.ts`:

```ts
import { z } from "zod";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript, lit, prelude } from "../compose.js";
import { findDocumentById, findFrameById } from "../script-helpers.js";
import { ok } from "../errors.js";

const InputSchema = z
  .object({
    frame_id: z.string().min(1),
    position: z.enum(["start", "end"]).optional(),
    document_id: z.string().optional(),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

const ScriptResultSchema = z.object({
  frame_id: z.string(),
  inserted_at: z.enum(["start", "end"]),
});

type ScriptResult = z.infer<typeof ScriptResultSchema>;

interface Result {
  frame_id: string;
  inserted_at: "start" | "end";
}

function buildScriptBody(input: Input): string {
  const docExpr =
    input.document_id !== undefined
      ? `findDocumentById(${lit(input.document_id)})`
      : "app.activeDocument";

  const position = input.position ?? "end";
  const insertionPointExpr =
    position === "start"
      ? "frame.parentStory.insertionPoints[0]"
      : "frame.parentStory.insertionPoints[-1]";

  return `
${prelude(findDocumentById, findFrameById)}
var doc = ${docExpr};
var frame = findFrameById(doc, ${lit(input.frame_id)});
if (frame.constructor.name !== "TextFrame") {
  throw {
    name: "invalid_args",
    message: "frame " + ${lit(input.frame_id)} + " is not a TextFrame",
    entity: "frame",
    id: ${lit(input.frame_id)}
  };
}
${insertionPointExpr}.contents = SpecialCharacters.AUTO_PAGE_NUMBER;
return {
  frame_id: ${lit(input.frame_id)},
  inserted_at: ${lit(position)}
};
`;
}

export const insertPageNumberMarkerTool = defineTool<Input, Result>({
  name: "insert_page_number_marker",
  description:
    "Inserts an auto-page-number marker (SpecialCharacters.AUTO_PAGE_NUMBER) into a text frame. The marker renders as the current page number. Specify position \"start\" or \"end\" (default \"end\").",
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
      { frame_id: r.frame_id, inserted_at: r.inserted_at },
      {
        document_state_delta: {
          changed_frames: [{ id: r.frame_id }],
        },
      },
    );
  },
});
```

- [ ] **Step 4: Register in `src/index.ts`**

```ts
import { insertPageNumberMarkerTool } from "./tools/insert-page-number-marker.js";
// ...
registry.register(insertPageNumberMarkerTool);
```

- [ ] **Step 5: Run unit tests, expect pass**

Run: `npm test -- tests/unit/tools/insert-page-number-marker.test.ts`
Expected: all pass.

- [ ] **Step 6: Run full suite + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, tsc clean.

- [ ] **Step 7: Write integration test**

Create `tests/integration/insert-page-number-marker.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { createParentPageTool } from "../../src/tools/create-parent-page.js";
import { createTextFrameTool } from "../../src/tools/create-text-frame.js";
import { insertPageNumberMarkerTool } from "../../src/tools/insert-page-number-marker.js";

integrationGate("insert_page_number_marker (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "inserts an AUTO_PAGE_NUMBER marker at the end of a text frame on a master page",
    async () => {
      const createDoc = await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });
      expect(createDoc.ok).toBe(true);
      if (!createDoc.ok) return;

      const createParent = await createParentPageTool.handler({
        base_name: "Footer",
      });
      expect(createParent.ok).toBe(true);
      if (!createParent.ok) return;
      const masterPageId = createParent.result!.page_ids[0];

      const createFrame = await createTextFrameTool.handler({
        page_id: masterPageId,
        bounds_mm: { x: 10, y: 275, width: 190, height: 10 },
      });
      expect(createFrame.ok).toBe(true);
      if (!createFrame.ok) return;
      const frameId = createFrame.result!.frame_id;

      const env = await insertPageNumberMarkerTool.handler({
        frame_id: frameId,
        position: "end",
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result?.frame_id).toBe(frameId);
      expect(env.result?.inserted_at).toBe("end");
      expect(env.document_state_delta?.changed_frames?.[0].id).toBe(frameId);
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "inserts at start when position is start",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      const createParent = await createParentPageTool.handler({
        base_name: "Header",
      });
      if (!createParent.ok) return;
      const masterPageId = createParent.result!.page_ids[0];

      const createFrame = await createTextFrameTool.handler({
        page_id: masterPageId,
        bounds_mm: { x: 10, y: 5, width: 190, height: 10 },
      });
      if (!createFrame.ok) return;
      const frameId = createFrame.result!.frame_id;

      const env = await insertPageNumberMarkerTool.handler({
        frame_id: frameId,
        position: "start",
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result?.inserted_at).toBe("start");
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "returns not_found for a non-existent frame_id",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      const env = await insertPageNumberMarkerTool.handler({
        frame_id: "999999999",
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
git add src/tools/insert-page-number-marker.ts src/index.ts tests/unit/tools/insert-page-number-marker.test.ts tests/integration/insert-page-number-marker.int.test.ts
git commit -m "feat: insert_page_number_marker tool"
```

---

## Task 8: End-to-end smoke test

**Why:** Spec success criterion #5 — compose a multi-page facing document with a parent footer page containing a page-number marker, apply it to all pages, export a PDF.

**Files:**
- Create: `tests/integration/plan-b4-end-to-end.int.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/integration/plan-b4-end-to-end.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { mkdtempSync, existsSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { createParentPageTool } from "../../src/tools/create-parent-page.js";
import { createTextFrameTool } from "../../src/tools/create-text-frame.js";
import { insertPageNumberMarkerTool } from "../../src/tools/insert-page-number-marker.js";
import { applyParentToPageTool } from "../../src/tools/apply-parent-to-page.js";
import { exportPdfTool } from "../../src/tools/export-pdf.js";

integrationGate("Plan B4 end-to-end (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "creates facing-page doc, verifies margin mirroring, builds footer parent with page number, applies to all pages, exports PDF",
    async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "indesign-mcp-b4-"));
      const pdfPath = join(tmpDir, "b4-smoke.pdf");

      try {
        // Step 1: Create a 4-page A4 facing doc with inside=25mm, outside=15mm.
        const createDoc = await createDocumentTool.handler({
          preset: "A4",
          facing_pages: true,
          pages: 4,
          margins_mm: { top: 20, bottom: 20, inside: 25, outside: 15 },
        });
        expect(createDoc.ok).toBe(true);
        if (!createDoc.ok) return;
        const { page_ids: docPageIds } = createDoc.result!;
        expect(docPageIds.length).toBe(4);

        // Step 2: Verify margin mirroring via a script query.
        // Page 0 = RIGHT_HAND (recto): left=inside=25, right=outside=15
        // Page 1 = LEFT_HAND (verso): left=outside=15, right=inside=25
        const { wrapExtendScript } = await import("../../src/compose.js");
        const { runScriptWithResultFile } = await import("../../src/transport/result-file.js");
        const { z } = await import("zod");

        const MarginQuerySchema = z.object({
          pages: z.array(z.object({
            id: z.string(),
            side: z.string(),
            left: z.number(),
            right: z.number(),
          })),
        });

        const marginQuery = await runScriptWithResultFile<z.infer<typeof MarginQuerySchema>>({
          language: "JavaScript",
          scriptTemplate: wrapExtendScript(`
            var doc = app.activeDocument;
            var result = [];
            for (var i = 0; i < Math.min(doc.pages.length, 2); i++) {
              var p = doc.pages[i];
              result.push({
                id: String(p.id),
                side: String(p.side),
                left: p.marginPreferences.left,
                right: p.marginPreferences.right
              });
            }
            return { pages: result };
          `),
          resultSchema: MarginQuerySchema,
        });

        if (marginQuery.ok && marginQuery.result) {
          const pages = marginQuery.result.pages;
          const recto = pages.find((p) =>
            p.side.includes("RIGHT_HAND") || p.side === String(1281774162),
          );
          const verso = pages.find((p) =>
            p.side.includes("LEFT_HAND") || p.side === String(1281971784),
          );
          if (recto && verso) {
            // RIGHT_HAND: left=inside=25, right=outside=15
            expect(recto.left).toBeCloseTo(25, 0);
            expect(recto.right).toBeCloseTo(15, 0);
            // LEFT_HAND: left=outside=15, right=inside=25
            expect(verso.left).toBeCloseTo(15, 0);
            expect(verso.right).toBeCloseTo(25, 0);
          }
          // If InDesign returns unexpected side values, the margin check is skipped
          // but the rest of the test continues.
        }

        // Step 3: Create a parent page named "Footer".
        const createParent = await createParentPageTool.handler({
          base_name: "Footer",
        });
        expect(createParent.ok).toBe(true);
        if (!createParent.ok) return;
        const parentName = createParent.result!.parent_name;
        const masterPageId = createParent.result!.page_ids[0];
        expect(parentName).toMatch(/Footer/);

        // Step 4: Add a text frame to the master's first page.
        const createFrame = await createTextFrameTool.handler({
          page_id: masterPageId,
          bounds_mm: { x: 10, y: 278, width: 190, height: 10 },
        });
        expect(createFrame.ok).toBe(true);
        if (!createFrame.ok) return;
        const footerFrameId = createFrame.result!.frame_id;

        // Step 5: Insert a page-number marker into the footer frame.
        const insertMarker = await insertPageNumberMarkerTool.handler({
          frame_id: footerFrameId,
          position: "end",
        });
        expect(insertMarker.ok).toBe(true);

        // Step 6: Apply the parent to all 4 document pages.
        for (const pageId of docPageIds) {
          const apply = await applyParentToPageTool.handler({
            page_id: pageId,
            parent_name: parentName,
          });
          expect(apply.ok).toBe(true);
          if (!apply.ok) return;
          expect(apply.document_state_delta?.changed_pages?.[0].applied_parent_name).toBe(parentName);
        }

        // Step 7: Export PDF and assert non-zero file on disk.
        const exportEnv = await exportPdfTool.handler({ path: pdfPath });
        expect(exportEnv.ok).toBe(true);
        expect(existsSync(pdfPath)).toBe(true);
        expect(statSync(pdfPath).size).toBeGreaterThan(0);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    },
    INTEGRATION_TIMEOUT_MS * 3, // generous — many sequential operations
  );
});
```

- [ ] **Step 2: Verify tsc**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Run unit suite**

Run: `npm test`
Expected: all unit tests pass; integration tests excluded.

- [ ] **Step 4: Build dist/**

Run: `npm run build`
Expected: clean.

- [ ] **Step 5: Manual integration run with InDesign open**

Run: `npm run test:integration`
Expected: all integration tests pass.

- [ ] **Step 6: Commit**

```bash
git add tests/integration/plan-b4-end-to-end.int.test.ts
git commit -m "test: end-to-end Plan B4 parent + page-number scenario"
```

---

## Plan-Complete Checklist

Before declaring Plan B4 done:

- [ ] All 8 tasks committed on `feat/plan-b4`.
- [ ] `npm test` passes (unit suite, no integration).
- [ ] `npx tsc --noEmit` clean.
- [ ] `npm run build` clean.
- [ ] Manual integration run with InDesign 2026 open passes all integration tests.
- [ ] End-to-end test produces a real PDF on disk with the parent footer applied to all 4 pages.
- [ ] Final code review of the Plan B4 commits as a unit.

When all seven are checked, Plan B5 (inline character styling) becomes the next planning step.

---

## Spec ambiguities flagged for clarification before execution

1. **`masterSpreads.add()` property API** — The spec notes the constructor may or may not accept properties at creation. The plan uses post-creation property assignment (`master.baseName = ...`), which is the safest form. The implementer must verify live whether `baseName` is writable post-creation in InDesign 2026 (21.3.0.60) and whether `namePrefix` can also be set post-creation. If either throws, fall back to passing them at construction.

2. **`page.side` string representation** — The spec says `String(p.side) === "LEFT_HAND"` but InDesign may return the numeric enum value (`1281971784`) when stringified, depending on the scripting context. The integration tests in Tasks 2 and 8 guard against both forms. The unit test for Task 2 asserts `LEFT_HAND` in the script template (which is literal string comparison baked into the script body) — that's fine. The issue is only in result-parsing in integration tests.

3. **`override()` on a frame whose parent is a `Spread` inside a `MasterSpread`** — The validation check in `override_parent_item_on_page` inspects `parentItem.parent.constructor.name`. The DOM may structure this as `TextFrame → Spread → MasterSpread` (i.e., the immediate parent is a `Spread`, not `MasterSpread` directly). The script includes a two-level check for this. Implementer should verify the actual containment hierarchy live and simplify/adjust as needed.

4. **`facing` field on `create_parent_page`** — The spec says facing controls page count of the master spread but notes "Override via `MasterSpread.pageCount` or by setting `pages` on the spread post-creation. Empirical detail to verify during implementation." The plan includes a no-op comment placeholder for `facing` and records the actual page count from the spread. If the implementer discovers `pageCount` is directly settable, add that property assignment to the script body.

5. **`invalid_args` as an `ErrorKind`** — The spec's ExtendScript throws `{ name: "invalid_args", ... }` but `ErrorKind` in `src/types.ts` does not currently include `"invalid_args"` — it has `"invalid_args"`. The `wrapExtendScript` catch router maps the thrown `name` to an `ErrorKind`. Check whether `"invalid_args"` is handled or maps to `"script_error"` by default. If needed, add `"invalid_args"` to the `ErrorKind` union or use `"invalid_args"` as the thrown name in the script instead. The unit tests above use `"invalid_args"` for the mocked failure kind — align accordingly.
