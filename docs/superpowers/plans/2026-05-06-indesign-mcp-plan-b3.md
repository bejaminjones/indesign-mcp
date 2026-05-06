# InDesign MCP — Plan B3 Implementation Plan (Visuals & Geometry)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship four tools (`create_image_frame`, `place_image`, `create_rectangle`, `create_line`), the `resolveUserPath` path-expansion helper, the `resolveSwatch` shared script helper, and the type-union tightening for frame types.

**Architecture:** Same template as B1/B2: Zod input schema → server-side body builder using `lit()` and `prelude(...)` → handler dispatching via `runScriptWithResultFile<TScriptResult>` with `resultSchema` validation → optional `ok()` post-processing for `document_state_delta`.

**Tech Stack:** TypeScript 5.6+, Node 20+, MCP SDK, Zod, Vitest. No new runtime deps.

**Reference spec:** `docs/superpowers/specs/2026-05-06-indesign-mcp-plan-b3-design.md`

**Repository:** `~/Documents/GitHub/indesign-mcp/`. Create a feature branch `feat/plan-b3` before starting.

**Sandbox note:** Integration tests require InDesign 2026 running. Unit tests are the executable verification; integration tests run live.

---

## File Structure

```
src/
├── types.ts                                (modified, Task 1)
├── path-utils.ts                           (created, Task 2)
├── script-helpers.ts                       (modified, Task 3 + Task 5)
├── tools/
│   ├── save-document.ts                    (modified, Task 2)
│   ├── export-pdf.ts                       (modified, Task 2)
│   ├── define-paragraph-style.ts           (modified, Task 3 — refactor to use resolveSwatch)
│   ├── get-page-state.ts                   (modified, Task 1 — FrameSchema enum)
│   ├── create-image-frame.ts               (Task 4)
│   ├── place-image.ts                      (Task 5)
│   ├── create-rectangle.ts                 (Task 6)
│   └── create-line.ts                      (Task 7)
└── index.ts                                (modified for each tool task)

tests/
├── integration/
│   ├── create-image-frame.int.test.ts      (Task 4)
│   ├── place-image.int.test.ts             (Task 5)
│   ├── create-rectangle.int.test.ts        (Task 6)
│   ├── create-line.int.test.ts             (Task 7)
│   └── plan-b3-end-to-end.int.test.ts      (Task 8)
└── unit/
    ├── path-utils.test.ts                  (Task 2)
    └── tools/
        ├── create-image-frame.test.ts      (Task 4)
        ├── place-image.test.ts             (Task 5)
        ├── create-rectangle.test.ts        (Task 6)
        └── create-line.test.ts             (Task 7)
```

---

## Task 1: Type tightening — `FrameType` literal union

**Why:** B2 reviewer flagged `new_frames[].type: string` as too loose. Tightening to a literal union is a prerequisite for B3 (which adds `"line"` to the type system).

**Files:**
- Modify: `src/types.ts`
- Modify: `tests/unit/types.test.ts`
- Modify: `src/tools/get-page-state.ts` — extend FrameSchema enum to include `"line"`
- Modify: `tests/unit/tools/get-page-state.test.ts` — adjust if needed

- [ ] **Step 1: Add a failing test**

Append to `tests/unit/types.test.ts`:

```ts
  it("FrameType is a literal union of text/image/rectangle/line", () => {
    const ft1: FrameType = "text";
    const ft2: FrameType = "image";
    const ft3: FrameType = "rectangle";
    const ft4: FrameType = "line";
    expect([ft1, ft2, ft3, ft4]).toEqual(["text", "image", "rectangle", "line"]);

    // @ts-expect-error — "circle" is not in the union
    const bad: FrameType = "circle";
    expect(bad).toBe("circle"); // runtime no-op; the directive verifies compile failure
  });

  it("new_frames items use FrameType, not bare string", () => {
    const delta: DocumentStateDelta = {
      new_frames: [
        { id: "f1", type: "text" },
        { id: "f2", type: "line" },
      ],
    };
    expect(delta.new_frames?.[0].type).toBe("text");
    expect(delta.new_frames?.[1].type).toBe("line");

    // @ts-expect-error — bad type rejected
    const badDelta: DocumentStateDelta = {
      new_frames: [{ id: "f3", type: "bad" }],
    };
    expect(badDelta.new_frames?.[0].type).toBe("bad");
  });
```

Update the existing import line at the top of `tests/unit/types.test.ts`:

```ts
import type { DocumentStateDelta, FrameType } from "../../src/types.js";
```

- [ ] **Step 2: Run, expect failure**

Run: `npx tsc --noEmit`
Expected: TS error on `FrameType` (not yet exported) and on the new shape literals.

- [ ] **Step 3: Update `src/types.ts`**

Add:

```ts
export type FrameType = "text" | "image" | "rectangle" | "line";
```

Update `DocumentStateDelta`:

```ts
export interface DocumentStateDelta {
  changed_frames?: Array<{
    id: FrameId;
    bounds?: [number, number, number, number];
    applied_paragraph_style?: string;
    applied_image_path?: string;
  }>;
  new_frames?: Array<{ id: FrameId; type: FrameType }>;
  removed_frame_ids?: FrameId[];
  new_page_ids?: string[];
  removed_page_ids?: string[];
  page_count?: number;
}
```

(Note: `applied_image_path` is added now too — used in Task 5.)

- [ ] **Step 4: Update `src/tools/get-page-state.ts`**

Find the `FrameSchema` definition. The current `type` enum is `z.enum(["text", "image", "rectangle"])`. Change to:

```ts
const FrameSchema = z.object({
  id: z.string(),
  type: z.enum(["text", "image", "rectangle", "line"]),
  bounds_mm: BoundsMmSchema,
  paragraph_style_name: z.string().optional(),
  text_snippet: z.string().optional(),
});
```

Also: in the script body's type-discrimination loop, add a `Line`/`GraphicLine` case. Currently:

```js
if (ctor === "TextFrame") {
  frameType = "text";
} else if (ctor === "Rectangle") {
  if (item.graphics && item.graphics.length > 0) frameType = "image";
  else frameType = "rectangle";
} else {
  continue;
}
```

Change to:

```js
if (ctor === "TextFrame") {
  frameType = "text";
} else if (ctor === "Rectangle") {
  if (item.graphics && item.graphics.length > 0) frameType = "image";
  else frameType = "rectangle";
} else if (ctor === "GraphicLine") {
  frameType = "line";
} else {
  continue;
}
```

- [ ] **Step 5: Run tests + tsc**

Run: `npx tsc --noEmit && npm test`
Expected: clean tsc, all tests pass (148/148 — 147 prior + 2 new in `types.test.ts`, less any tests that needed updating).

- [ ] **Step 6: Commit**

```bash
git checkout -b feat/plan-b3
git add src/types.ts src/tools/get-page-state.ts tests/unit/types.test.ts
git commit -m "feat: FrameType literal union; get_page_state recognises GraphicLine"
```

---

## Task 2: `resolveUserPath` helper + bug fix

**Why:** Bug from user report — `~` doesn't expand in `save_document` paths. Add a small helper and apply it everywhere a path-taking tool exists today (and to `place_image` once it lands in Task 5).

**Files:**
- Create: `src/path-utils.ts`
- Create: `tests/unit/path-utils.test.ts`
- Modify: `src/tools/save-document.ts`
- Modify: `src/tools/export-pdf.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/path-utils.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { resolveUserPath } from "../../src/path-utils.js";

describe("resolveUserPath", () => {
  it("expands a leading ~/ to the user's home directory", () => {
    const result = resolveUserPath("~/Desktop/file.indd");
    expect(result.startsWith(homedir())).toBe(true);
    expect(result.endsWith("/Desktop/file.indd")).toBe(true);
  });

  it("leaves bare ~ (no slash) unchanged before resolve", () => {
    // Bare ~ is a literal directory/file name; only ~/ should expand.
    const result = resolveUserPath("~tilde");
    expect(result).not.toContain(homedir());
  });

  it("resolves a relative path to absolute", () => {
    const result = resolveUserPath("./file.indd");
    expect(result.startsWith("/")).toBe(true);
    expect(result.endsWith("/file.indd")).toBe(true);
  });

  it("preserves absolute paths", () => {
    const result = resolveUserPath("/Users/test/file.indd");
    expect(result).toBe("/Users/test/file.indd");
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/unit/path-utils.test.ts`
Expected: module not found.

- [ ] **Step 3: Create `src/path-utils.ts`**

```ts
import { homedir } from "node:os";
import { resolve } from "node:path";

/**
 * Expand a leading `~/` to the user's home directory, then resolve to an
 * absolute path. Bare `~` (no slash) is left as-is — that's a literal
 * file/dir name in some contexts.
 */
export function resolveUserPath(input: string): string {
  if (input.startsWith("~/")) {
    return resolve(homedir(), input.slice(2));
  }
  return resolve(input);
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npm test -- tests/unit/path-utils.test.ts`
Expected: 4/4 pass.

- [ ] **Step 5: Update `src/tools/save-document.ts`**

Replace the `import { resolve } from "node:path";` line with:

```ts
import { resolveUserPath } from "../path-utils.js";
```

Replace the path-resolution line in the handler:

```ts
// Before:
const absolutePath = input.path !== undefined ? resolve(input.path) : undefined;
// After:
const absolutePath = input.path !== undefined ? resolveUserPath(input.path) : undefined;
```

- [ ] **Step 6: Update `src/tools/export-pdf.ts`**

Same swap:

```ts
import { resolveUserPath } from "../path-utils.js";
```

```ts
// Before:
const absolutePath = resolve(input.path);
// After:
const absolutePath = resolveUserPath(input.path);
```

- [ ] **Step 7: Run all tests + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: 152/152 pass (148 + 4 new), tsc clean.

- [ ] **Step 8: Commit**

```bash
git add src/path-utils.ts src/tools/save-document.ts src/tools/export-pdf.ts tests/unit/path-utils.test.ts
git commit -m "fix: resolveUserPath helper expands ~ in path-taking tools"
```

---

## Task 3: `resolveSwatch` shared script helper + refactor `define_paragraph_style`

**Why:** B3's `create_rectangle` and `create_line` both need swatch resolution from a hex color (same logic `define_paragraph_style` already has inline). Extract to `script-helpers.ts` once, refactor existing tool, then B3 tools include it via `prelude(...)`.

**Files:**
- Modify: `src/script-helpers.ts`
- Modify: `src/tools/define-paragraph-style.ts`
- Modify: `tests/unit/script-helpers.test.ts`

- [ ] **Step 1: Add failing test**

Append to `tests/unit/script-helpers.test.ts`:

```ts
  it("resolveSwatch is a non-empty function declaration", () => {
    expect(resolveSwatch).toContain("function resolveSwatch");
    expect(resolveSwatch).toContain("doc.colors.itemByName");
    expect(resolveSwatch).toContain("ColorSpace.RGB");
  });
```

Update the imports at the top:

```ts
import { findDocumentById, findPageById, findFrameById, findStyleByName, resolveSwatch } from "../../src/script-helpers.js";
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/unit/script-helpers.test.ts`
Expected: import error.

- [ ] **Step 3: Add helper to `src/script-helpers.ts`**

Append:

```ts
export const resolveSwatch = `
function resolveSwatch(doc, hex) {
  // hex format: "#RRGGBB" (caller already uppercased)
  var swatchName = "auto-" + hex;
  var s = doc.colors.itemByName(swatchName);
  if (!s.isValid) {
    var r = parseInt(hex.substr(1, 2), 16);
    var g = parseInt(hex.substr(3, 2), 16);
    var b = parseInt(hex.substr(5, 2), 16);
    s = doc.colors.add({
      name: swatchName,
      model: ColorModel.PROCESS,
      space: ColorSpace.RGB,
      colorValue: [r, g, b]
    });
  }
  return s;
}
`.trim();
```

- [ ] **Step 4: Refactor `src/tools/define-paragraph-style.ts` to use `resolveSwatch`**

Replace the inline `colorSetup` block. Currently:

```ts
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
```

Becomes:

```ts
let colorSetup = "var swatchId;";
if (input.color_hex !== undefined) {
  const upperHex = input.color_hex.toUpperCase();
  colorSetup = `
    var swatch = resolveSwatch(doc, ${lit(upperHex)});
    var swatchId = String(swatch.id);
  `;
}
```

Update imports at the top:

```ts
import { findDocumentById, resolveSwatch } from "../script-helpers.js";
```

Update the `prelude(...)` call in `buildScriptBody`:

```ts
return `
${prelude(findDocumentById, resolveSwatch)}
...
`;
```

(The `hexToRgb` TS-side helper can also be deleted since the script does the parsing now — confirm by searching for usages and remove if unused.)

- [ ] **Step 5: Run tests + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass (153/153: 152 + 1 new), tsc clean.

The existing `define_paragraph_style` unit tests should still pass — script content for the color-handling tests now goes through `resolveSwatch` rather than inline. Verify:
- "dispatches a script that converts color_hex to RGB triple [255, 0, 0]" still passes — body still contains `"#FF0000"` and the parseInt logic is in `resolveSwatch` (which appears in the script via prelude).
  - If this test asserts `[255, 0, 0]` literally it WILL fail because the parsing now happens at runtime inside the script, not interpolated. Update the assertion to check for `resolveSwatch` and `"#FF0000"` instead.
- "uppercases color_hex when constructing the swatch name" still passes since the upper-case still happens TS-side.

If the "[255, 0, 0]" test fails, update its assertion to:

```ts
expect(arg.scriptTemplate).toContain("resolveSwatch(doc, ");
expect(arg.scriptTemplate).toContain('"#FF0000"');
```

- [ ] **Step 6: Commit**

```bash
git add src/script-helpers.ts src/tools/define-paragraph-style.ts tests/unit/script-helpers.test.ts tests/unit/tools/define-paragraph-style.test.ts
git commit -m "refactor: extract resolveSwatch script helper; define_paragraph_style uses it"
```

---

## Task 4: `create_image_frame` tool

**Files:**
- Create: `src/tools/create-image-frame.ts`
- Create: `tests/unit/tools/create-image-frame.test.ts`
- Create: `tests/integration/create-image-frame.int.test.ts`
- Modify: `src/index.ts`

### Step 1: Write the unit test file

- [ ] Create `tests/unit/tools/create-image-frame.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createImageFrameTool } from "../../../src/tools/create-image-frame.js";
import { lastCall, expectFailure } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("create_image_frame tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(createImageFrameTool.name).toBe("create_image_frame");
    expect(createImageFrameTool.description.length).toBeGreaterThan(0);
  });

  it("accepts minimal valid input", () => {
    expect(
      createImageFrameTool.inputSchema.safeParse({
        page_id: "p1",
        bounds_mm: { x: 10, y: 10, width: 100, height: 50 },
      }).success,
    ).toBe(true);
  });

  it("rejects zero or negative width/height", () => {
    expect(
      createImageFrameTool.inputSchema.safeParse({
        page_id: "p1",
        bounds_mm: { x: 10, y: 10, width: 0, height: 50 },
      }).success,
    ).toBe(false);
  });

  it("dispatches a script that creates a rectangle and sets fittingOnEmptyFrame", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { frame_id: "f1", page_id: "p1" },
    });

    await createImageFrameTool.handler({
      page_id: "p1",
      bounds_mm: { x: 10, y: 20, width: 100, height: 50 },
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("rectangles.add");
    expect(arg.scriptTemplate).toContain("fittingOnEmptyFrame");
    expect(arg.scriptTemplate).toContain("FILL_PROPORTIONALLY");
    // Geometric bounds [y1, x1, y2, x2]: [20, 10, 70, 110]
    expect(arg.scriptTemplate).toContain("[20, 10, 70, 110]");
  });

  it("returns frame and document_state_delta", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { frame_id: "f5", page_id: "p1" },
    });

    const env = await createImageFrameTool.handler({
      page_id: "p1",
      bounds_mm: { x: 10, y: 10, width: 100, height: 50 },
    });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result).toEqual({ frame_id: "f5", page_id: "p1" });
    expect(env.document_state_delta).toEqual({
      new_frames: [{ id: "f5", type: "rectangle" }],
    });
  });

  it("propagates failure envelopes verbatim", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: { kind: "not_found", message: "page p99 not found", entity: "page", id: "p99" },
    });

    const env = await createImageFrameTool.handler({
      page_id: "p99",
      bounds_mm: { x: 10, y: 10, width: 100, height: 50 },
    });

    expectFailure(env);
    expect(env.error.kind).toBe("not_found");
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/unit/tools/create-image-frame.test.ts`

### Step 3: Write tool source

- [ ] Create `src/tools/create-image-frame.ts`:

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

  const { x, y, width, height } = input.bounds_mm;
  const y2 = y + height;
  const x2 = x + width;

  return `
${prelude(findDocumentById, findPageById)}
var prevUnits = app.scriptPreferences.measurementUnit;
app.scriptPreferences.measurementUnit = MeasurementUnits.MILLIMETERS;
try {
  var doc = ${docExpr};
  var page = findPageById(doc, ${lit(input.page_id)});
  var frame = page.rectangles.add({
    geometricBounds: [${y}, ${x}, ${y2}, ${x2}]
  });
  frame.frameFittingOptions.fittingOnEmptyFrame = EmptyFrameFittingOptions.FILL_PROPORTIONALLY;
  return {
    frame_id: String(frame.id),
    page_id: ${lit(input.page_id)}
  };
} finally {
  app.scriptPreferences.measurementUnit = prevUnits;
}
`;
}

export const createImageFrameTool = defineTool<Input, Result>({
  name: "create_image_frame",
  description:
    "Creates an empty rectangle on a specified page, configured so a future place_image call auto-fits the placed graphic. Returns the frame and page IDs.",
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
          new_frames: [{ id: r.frame_id, type: "rectangle" }],
        },
      },
    );
  },
});
```

### Step 4-9: Same pattern as B2 — register, run tests, write integration test, commit

- [ ] **Step 4: Register in `src/index.ts`**

```ts
import { createImageFrameTool } from "./tools/create-image-frame.js";
// ...
registry.register(createImageFrameTool);
```

- [ ] **Step 5: Run unit tests, expect pass**

Run: `npm test -- tests/unit/tools/create-image-frame.test.ts`
Expected: 6/6 pass.

- [ ] **Step 6: Run full suite + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: ~159 pass, tsc clean.

- [ ] **Step 7: Write integration test**

Create `tests/integration/create-image-frame.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { createImageFrameTool } from "../../src/tools/create-image-frame.js";

integrationGate("create_image_frame (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "creates an image-receptive rectangle on a fresh A4 page",
    async () => {
      const create = await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });
      if (!create.ok) return;

      const env = await createImageFrameTool.handler({
        page_id: create.result!.page_ids[0],
        bounds_mm: { x: 12, y: 12, width: 100, height: 60 },
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(typeof env.result?.frame_id).toBe("string");
      expect(env.document_state_delta?.new_frames?.[0].type).toBe("rectangle");
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
```

- [ ] **Step 8: Verify tsc**

Run: `npx tsc --noEmit`

- [ ] **Step 9: Commit**

```bash
git add src/tools/create-image-frame.ts src/index.ts tests/unit/tools/create-image-frame.test.ts tests/integration/create-image-frame.int.test.ts
git commit -m "feat: create_image_frame tool"
```

---

## Task 5: `place_image` tool

**Files:**
- Create: `src/tools/place-image.ts`
- Create: `tests/unit/tools/place-image.test.ts`
- Create: `tests/integration/place-image.int.test.ts`
- Modify: `src/index.ts`

### Step 1: Write the unit test file

- [ ] Create `tests/unit/tools/place-image.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { placeImageTool } from "../../../src/tools/place-image.js";
import { lastCall, expectFailure } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("place_image tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(placeImageTool.name).toBe("place_image");
    expect(placeImageTool.description.length).toBeGreaterThan(0);
  });

  it("requires frame_id and image_path", () => {
    expect(
      placeImageTool.inputSchema.safeParse({ image_path: "/x" }).success,
    ).toBe(false);
    expect(
      placeImageTool.inputSchema.safeParse({ frame_id: "f1" }).success,
    ).toBe(false);
  });

  it("accepts each fit value", () => {
    for (const fit of [
      "fill_proportionally",
      "fit_proportionally",
      "fit_content_to_frame",
      "center_content",
    ] as const) {
      expect(
        placeImageTool.inputSchema.safeParse({
          frame_id: "f1",
          image_path: "/img.png",
          fit,
        }).success,
      ).toBe(true);
    }
  });

  it("rejects an invalid fit value", () => {
    expect(
      placeImageTool.inputSchema.safeParse({
        frame_id: "f1",
        image_path: "/img.png",
        fit: "stretch",
      }).success,
    ).toBe(false);
  });

  it("returns io_error before dispatching when image file does not exist", async () => {
    const env = await placeImageTool.handler({
      frame_id: "f1",
      image_path: "/nonexistent/path/image.png",
    });

    expect(env.ok).toBe(false);
    if (env.ok) return;
    expect(env.error.kind).toBe("io_error");
    expect(env.error.message).toMatch(/not found|does not exist/i);
    expect(runScriptWithResultFile).not.toHaveBeenCalled();
  });

  it("dispatches a script with the resolved absolute path and fit value", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "place-image-test-"));
    const imagePath = join(tmpDir, "test.png");
    writeFileSync(imagePath, "fake png content");

    try {
      vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
        ok: true,
        result: { frame_id: "f1", image_path: imagePath, link_status: "NORMAL" },
      });

      await placeImageTool.handler({
        frame_id: "f1",
        image_path: imagePath,
        fit: "fit_proportionally",
      });

      const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
      expect(arg.scriptTemplate).toContain(imagePath);
      expect(arg.scriptTemplate).toContain("FitOptions.PROPORTIONALLY");
      expect(arg.scriptTemplate).toContain("frame.place");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns frame, image_path, link_status, and changed_frames delta", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "place-image-test-"));
    const imagePath = join(tmpDir, "test.png");
    writeFileSync(imagePath, "fake png content");

    try {
      vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
        ok: true,
        result: { frame_id: "f1", image_path: imagePath, link_status: "NORMAL" },
      });

      const env = await placeImageTool.handler({
        frame_id: "f1",
        image_path: imagePath,
      });

      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result?.link_status).toBe("NORMAL");
      expect(env.document_state_delta).toEqual({
        changed_frames: [{ id: "f1", applied_image_path: imagePath }],
      });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/unit/tools/place-image.test.ts`

### Step 3: Write tool source

- [ ] Create `src/tools/place-image.ts`:

```ts
import { z } from "zod";
import { existsSync } from "node:fs";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript, lit, prelude } from "../compose.js";
import { findDocumentById, findFrameById } from "../script-helpers.js";
import { resolveUserPath } from "../path-utils.js";
import { fail, ok } from "../errors.js";

const InputSchema = z
  .object({
    frame_id: z.string(),
    image_path: z.string(),
    fit: z
      .enum([
        "fill_proportionally",
        "fit_proportionally",
        "fit_content_to_frame",
        "center_content",
      ])
      .optional(),
    document_id: z.string().optional(),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

const ScriptResultSchema = z.object({
  frame_id: z.string(),
  image_path: z.string(),
  link_status: z.string(),
});

type ScriptResult = z.infer<typeof ScriptResultSchema>;

interface Result {
  frame_id: string;
  image_path: string;
  link_status: string;
}

const FIT_ENUM_MAP = {
  fill_proportionally: "FILL_PROPORTIONALLY",
  fit_proportionally: "PROPORTIONALLY",
  fit_content_to_frame: "CONTENT_TO_FRAME",
  center_content: "CENTER_CONTENT",
} as const;

function buildScriptBody(input: Input, absolutePath: string): string {
  const docExpr =
    input.document_id !== undefined
      ? `findDocumentById(${lit(input.document_id)})`
      : "app.activeDocument";

  const fitEnum = FIT_ENUM_MAP[input.fit ?? "fill_proportionally"];

  return `
${prelude(findDocumentById, findFrameById)}
var doc = ${docExpr};
var frame = findFrameById(doc, ${lit(input.frame_id)});
frame.place(File(${lit(absolutePath)}));
frame.fit(FitOptions.${fitEnum});
var graphics = frame.graphics;
var linkStatus = "UNKNOWN";
if (graphics.length > 0 && graphics[0].itemLink) {
  linkStatus = String(graphics[0].itemLink.status);
}
return {
  frame_id: ${lit(input.frame_id)},
  image_path: ${lit(absolutePath)},
  link_status: linkStatus
};
`;
}

export const placeImageTool = defineTool<Input, Result>({
  name: "place_image",
  description:
    "Places an image file (PNG, JPG, SVG, EPS, PDF, etc.) into an existing rectangle, applying a fit mode. Returns the absolute path and InDesign link status.",
  inputSchema: InputSchema,
  async handler(input) {
    const absolutePath = resolveUserPath(input.image_path);
    if (!existsSync(absolutePath)) {
      return fail("io_error", `image file not found: ${absolutePath}`);
    }

    const env = await runScriptWithResultFile<ScriptResult>({
      language: "JavaScript",
      scriptTemplate: wrapExtendScript(buildScriptBody(input, absolutePath)),
      resultSchema: ScriptResultSchema,
    });
    if (!env.ok) return env;
    const r = env.result!;
    return ok(
      {
        frame_id: r.frame_id,
        image_path: r.image_path,
        link_status: r.link_status,
      },
      {
        document_state_delta: {
          changed_frames: [
            { id: r.frame_id, applied_image_path: r.image_path },
          ],
        },
      },
    );
  },
});
```

### Step 4-9: Register, test, integration test, commit

- [ ] **Step 4: Register in `src/index.ts`**

```ts
import { placeImageTool } from "./tools/place-image.js";
// ...
registry.register(placeImageTool);
```

- [ ] **Step 5: Run unit tests, expect pass**

Run: `npm test -- tests/unit/tools/place-image.test.ts`
Expected: 7/7 pass.

- [ ] **Step 6: Run full suite + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: ~166 pass, tsc clean.

- [ ] **Step 7: Write integration test**

Create `tests/integration/place-image.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { createImageFrameTool } from "../../src/tools/create-image-frame.js";
import { placeImageTool } from "../../src/tools/place-image.js";

// Minimal valid 1x1 PNG bytes (for InDesign to actually place)
const TINY_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

integrationGate("place_image (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "places a real image into a rectangle and reports NORMAL link status",
    async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "indesign-mcp-place-"));
      const imagePath = join(tmpDir, "test.png");
      writeFileSync(imagePath, TINY_PNG_BYTES);

      try {
        const create = await createDocumentTool.handler({
          preset: "A4",
          margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
        });
        if (!create.ok) return;

        const frame = await createImageFrameTool.handler({
          page_id: create.result!.page_ids[0],
          bounds_mm: { x: 12, y: 12, width: 100, height: 60 },
        });
        if (!frame.ok) return;

        const env = await placeImageTool.handler({
          frame_id: frame.result!.frame_id,
          image_path: imagePath,
        });
        expect(env.ok).toBe(true);
        if (!env.ok) return;
        expect(env.result?.link_status).toBe("NORMAL");
        expect(env.document_state_delta?.changed_frames?.[0].applied_image_path).toBe(imagePath);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "returns io_error for a missing image file before dispatching",
    async () => {
      const env = await placeImageTool.handler({
        frame_id: "anything",
        image_path: "/no/such/file.png",
      });
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.kind).toBe("io_error");
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
```

- [ ] **Step 8: Verify tsc**

Run: `npx tsc --noEmit`

- [ ] **Step 9: Commit**

```bash
git add src/tools/place-image.ts src/index.ts tests/unit/tools/place-image.test.ts tests/integration/place-image.int.test.ts
git commit -m "feat: place_image tool with fit modes and pre-dispatch existence check"
```

---

## Task 6: `create_rectangle` tool

**Files:**
- Create: `src/tools/create-rectangle.ts`
- Create: `tests/unit/tools/create-rectangle.test.ts`
- Create: `tests/integration/create-rectangle.int.test.ts`
- Modify: `src/index.ts`

### Step 1: Write the unit test file

- [ ] Create `tests/unit/tools/create-rectangle.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRectangleTool } from "../../../src/tools/create-rectangle.js";
import { lastCall, expectFailure } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("create_rectangle tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(createRectangleTool.name).toBe("create_rectangle");
    expect(createRectangleTool.description.length).toBeGreaterThan(0);
  });

  it("accepts minimal valid input", () => {
    expect(
      createRectangleTool.inputSchema.safeParse({
        page_id: "p1",
        bounds_mm: { x: 10, y: 10, width: 100, height: 50 },
      }).success,
    ).toBe(true);
  });

  it("accepts fill_hex and corner_radius_mm", () => {
    expect(
      createRectangleTool.inputSchema.safeParse({
        page_id: "p1",
        bounds_mm: { x: 10, y: 10, width: 100, height: 50 },
        fill_hex: "#FF6600",
        corner_radius_mm: 4,
      }).success,
    ).toBe(true);
  });

  it("rejects invalid fill_hex", () => {
    expect(
      createRectangleTool.inputSchema.safeParse({
        page_id: "p1",
        bounds_mm: { x: 10, y: 10, width: 100, height: 50 },
        fill_hex: "red",
      }).success,
    ).toBe(false);
  });

  it("rejects stroke_weight_pt without stroke_hex", () => {
    expect(
      createRectangleTool.inputSchema.safeParse({
        page_id: "p1",
        bounds_mm: { x: 10, y: 10, width: 100, height: 50 },
        stroke_weight_pt: 1,
      }).success,
    ).toBe(false);
  });

  it("accepts stroke_weight_pt with stroke_hex", () => {
    expect(
      createRectangleTool.inputSchema.safeParse({
        page_id: "p1",
        bounds_mm: { x: 10, y: 10, width: 100, height: 50 },
        stroke_hex: "#000000",
        stroke_weight_pt: 0.5,
      }).success,
    ).toBe(true);
  });

  it("dispatches a script that uses resolveSwatch when fill_hex is provided", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { frame_id: "f1", page_id: "p1", fill_swatch_id: "sw1" },
    });

    await createRectangleTool.handler({
      page_id: "p1",
      bounds_mm: { x: 10, y: 10, width: 100, height: 50 },
      fill_hex: "#abcdef",
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("resolveSwatch");
    // hex uppercased before passing
    expect(arg.scriptTemplate).toContain("#ABCDEF");
    expect(arg.scriptTemplate).toContain("rectangles.add");
  });

  it("dispatches a script that sets corner radius when corner_radius_mm provided", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { frame_id: "f1", page_id: "p1" },
    });

    await createRectangleTool.handler({
      page_id: "p1",
      bounds_mm: { x: 10, y: 10, width: 100, height: 50 },
      corner_radius_mm: 4,
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("ROUNDED_CORNER");
    expect(arg.scriptTemplate).toContain("cornerRadius = 4");
  });

  it("returns frame, page, and swatch ids when colors provided", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        frame_id: "f1",
        page_id: "p1",
        fill_swatch_id: "sw1",
        stroke_swatch_id: "sw2",
      },
    });

    const env = await createRectangleTool.handler({
      page_id: "p1",
      bounds_mm: { x: 10, y: 10, width: 100, height: 50 },
      fill_hex: "#FF6600",
      stroke_hex: "#000000",
      stroke_weight_pt: 1,
    });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result).toEqual({
      frame_id: "f1",
      page_id: "p1",
      fill_swatch_id: "sw1",
      stroke_swatch_id: "sw2",
    });
    expect(env.document_state_delta).toEqual({
      new_frames: [{ id: "f1", type: "rectangle" }],
    });
  });

  it("propagates failure envelopes verbatim", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: { kind: "not_found", message: "page p99 not found" },
    });

    const env = await createRectangleTool.handler({
      page_id: "p99",
      bounds_mm: { x: 10, y: 10, width: 100, height: 50 },
    });

    expectFailure(env);
    expect(env.error.kind).toBe("not_found");
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/unit/tools/create-rectangle.test.ts`

### Step 3: Write tool source

- [ ] Create `src/tools/create-rectangle.ts`:

```ts
import { z } from "zod";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript, lit, prelude } from "../compose.js";
import { findDocumentById, findPageById, resolveSwatch } from "../script-helpers.js";
import { ok } from "../errors.js";

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

const InputSchema = z
  .object({
    page_id: z.string(),
    bounds_mm: z.object({
      x: z.number().nonnegative(),
      y: z.number().nonnegative(),
      width: z.number().positive(),
      height: z.number().positive(),
    }),
    fill_hex: z.string().regex(HEX_COLOR_RE).optional(),
    stroke_hex: z.string().regex(HEX_COLOR_RE).optional(),
    stroke_weight_pt: z.number().nonnegative().optional(),
    corner_radius_mm: z.number().nonnegative().optional(),
    document_id: z.string().optional(),
  })
  .strict()
  .refine(
    (data) => !(data.stroke_weight_pt !== undefined && data.stroke_hex === undefined),
    { message: "`stroke_weight_pt` requires `stroke_hex`" },
  );

type Input = z.infer<typeof InputSchema>;

const ScriptResultSchema = z.object({
  frame_id: z.string(),
  page_id: z.string(),
  fill_swatch_id: z.string().optional(),
  stroke_swatch_id: z.string().optional(),
});

type ScriptResult = z.infer<typeof ScriptResultSchema>;

interface Result {
  frame_id: string;
  page_id: string;
  fill_swatch_id?: string;
  stroke_swatch_id?: string;
}

function buildScriptBody(input: Input): string {
  const docExpr =
    input.document_id !== undefined
      ? `findDocumentById(${lit(input.document_id)})`
      : "app.activeDocument";

  const { x, y, width, height } = input.bounds_mm;
  const y2 = y + height;
  const x2 = x + width;

  const fillBlock =
    input.fill_hex !== undefined
      ? `
        var fillSwatch = resolveSwatch(doc, ${lit(input.fill_hex.toUpperCase())});
        rect.fillColor = fillSwatch;
        var fillSwatchId = String(fillSwatch.id);
      `
      : "var fillSwatchId;";

  const strokeBlock =
    input.stroke_hex !== undefined
      ? `
        var strokeSwatch = resolveSwatch(doc, ${lit(input.stroke_hex.toUpperCase())});
        rect.strokeColor = strokeSwatch;
        rect.strokeWeight = ${input.stroke_weight_pt ?? 0};
        var strokeSwatchId = String(strokeSwatch.id);
      `
      : `
        rect.strokeColor = doc.swatches.itemByName("None");
        rect.strokeWeight = 0;
        var strokeSwatchId;
      `;

  const cornerBlock =
    input.corner_radius_mm !== undefined && input.corner_radius_mm > 0
      ? `
        rect.topLeftCornerOption = CornerOptions.ROUNDED_CORNER;
        rect.topRightCornerOption = CornerOptions.ROUNDED_CORNER;
        rect.bottomLeftCornerOption = CornerOptions.ROUNDED_CORNER;
        rect.bottomRightCornerOption = CornerOptions.ROUNDED_CORNER;
        rect.topLeftCornerRadius = ${input.corner_radius_mm};
        rect.topRightCornerRadius = ${input.corner_radius_mm};
        rect.bottomLeftCornerRadius = ${input.corner_radius_mm};
        rect.bottomRightCornerRadius = ${input.corner_radius_mm};
      `
      : "";

  return `
${prelude(findDocumentById, findPageById, resolveSwatch)}
var prevUnits = app.scriptPreferences.measurementUnit;
app.scriptPreferences.measurementUnit = MeasurementUnits.MILLIMETERS;
try {
  var doc = ${docExpr};
  var page = findPageById(doc, ${lit(input.page_id)});
  var rect = page.rectangles.add({
    geometricBounds: [${y}, ${x}, ${y2}, ${x2}]
  });
  ${fillBlock}
  ${strokeBlock}
  ${cornerBlock}
  var result = {
    frame_id: String(rect.id),
    page_id: ${lit(input.page_id)}
  };
  if (fillSwatchId !== undefined) result.fill_swatch_id = fillSwatchId;
  if (strokeSwatchId !== undefined) result.stroke_swatch_id = strokeSwatchId;
  return result;
} finally {
  app.scriptPreferences.measurementUnit = prevUnits;
}
`;
}

export const createRectangleTool = defineTool<Input, Result>({
  name: "create_rectangle",
  description:
    "Creates a rectangle with optional fill, stroke, and corner radius. For design elements like panels, pills, hero boxes, and dividers. Returns the frame, page, and swatch IDs.",
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
        page_id: r.page_id,
        ...(r.fill_swatch_id !== undefined ? { fill_swatch_id: r.fill_swatch_id } : {}),
        ...(r.stroke_swatch_id !== undefined ? { stroke_swatch_id: r.stroke_swatch_id } : {}),
      },
      {
        document_state_delta: {
          new_frames: [{ id: r.frame_id, type: "rectangle" }],
        },
      },
    );
  },
});
```

### Step 4-9: Register, test, integration test, commit

- [ ] **Step 4: Register**

```ts
import { createRectangleTool } from "./tools/create-rectangle.js";
// ...
registry.register(createRectangleTool);
```

- [ ] **Step 5-6: Run tests + tsc**

Run: `npm test -- tests/unit/tools/create-rectangle.test.ts`
Expected: 10/10 pass.

Run: `npm test && npx tsc --noEmit`
Expected: ~176 pass, tsc clean.

- [ ] **Step 7: Write integration test**

Create `tests/integration/create-rectangle.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { createRectangleTool } from "../../src/tools/create-rectangle.js";

integrationGate("create_rectangle (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "creates a basic rectangle",
    async () => {
      const create = await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });
      if (!create.ok) return;

      const env = await createRectangleTool.handler({
        page_id: create.result!.page_ids[0],
        bounds_mm: { x: 12, y: 12, width: 100, height: 50 },
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(typeof env.result?.frame_id).toBe("string");
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "creates a filled, stroked, rounded rectangle",
    async () => {
      const create = await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });
      if (!create.ok) return;

      const env = await createRectangleTool.handler({
        page_id: create.result!.page_ids[0],
        bounds_mm: { x: 12, y: 12, width: 100, height: 30 },
        fill_hex: "#FF6600",
        stroke_hex: "#000000",
        stroke_weight_pt: 1,
        corner_radius_mm: 4,
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(typeof env.result?.fill_swatch_id).toBe("string");
      expect(typeof env.result?.stroke_swatch_id).toBe("string");
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
```

- [ ] **Step 8: Verify tsc**

Run: `npx tsc --noEmit`

- [ ] **Step 9: Commit**

```bash
git add src/tools/create-rectangle.ts src/index.ts tests/unit/tools/create-rectangle.test.ts tests/integration/create-rectangle.int.test.ts
git commit -m "feat: create_rectangle tool with fill, stroke, corner radius"
```

---

## Task 7: `create_line` tool

**Files:**
- Create: `src/tools/create-line.ts`
- Create: `tests/unit/tools/create-line.test.ts`
- Create: `tests/integration/create-line.int.test.ts`
- Modify: `src/index.ts`

### Step 1: Write the unit test file

- [ ] Create `tests/unit/tools/create-line.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLineTool } from "../../../src/tools/create-line.js";
import { lastCall, expectFailure } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("create_line tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(createLineTool.name).toBe("create_line");
    expect(createLineTool.description.length).toBeGreaterThan(0);
  });

  it("accepts minimal valid input (page_id + start + end)", () => {
    expect(
      createLineTool.inputSchema.safeParse({
        page_id: "p1",
        start_mm: { x: 12, y: 12 },
        end_mm: { x: 198, y: 12 },
      }).success,
    ).toBe(true);
  });

  it("rejects negative coordinates", () => {
    expect(
      createLineTool.inputSchema.safeParse({
        page_id: "p1",
        start_mm: { x: -1, y: 12 },
        end_mm: { x: 198, y: 12 },
      }).success,
    ).toBe(false);
  });

  it("rejects invalid stroke_hex", () => {
    expect(
      createLineTool.inputSchema.safeParse({
        page_id: "p1",
        start_mm: { x: 0, y: 0 },
        end_mm: { x: 100, y: 0 },
        stroke_hex: "black",
      }).success,
    ).toBe(false);
  });

  it("rejects stroke_weight_pt <= 0", () => {
    expect(
      createLineTool.inputSchema.safeParse({
        page_id: "p1",
        start_mm: { x: 0, y: 0 },
        end_mm: { x: 100, y: 0 },
        stroke_weight_pt: 0,
      }).success,
    ).toBe(false);
  });

  it("dispatches a script that uses resolveSwatch and graphicLines.add", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { frame_id: "f1", page_id: "p1", stroke_swatch_id: "sw1" },
    });

    await createLineTool.handler({
      page_id: "p1",
      start_mm: { x: 12, y: 12 },
      end_mm: { x: 198, y: 12 },
      stroke_hex: "#333333",
      stroke_weight_pt: 0.5,
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("resolveSwatch");
    expect(arg.scriptTemplate).toContain("graphicLines.add");
    expect(arg.scriptTemplate).toContain("#333333");
  });

  it("returns frame, page, stroke_swatch_id and document_state_delta with type 'line'", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { frame_id: "f1", page_id: "p1", stroke_swatch_id: "sw1" },
    });

    const env = await createLineTool.handler({
      page_id: "p1",
      start_mm: { x: 0, y: 0 },
      end_mm: { x: 100, y: 0 },
    });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result).toEqual({
      frame_id: "f1",
      page_id: "p1",
      stroke_swatch_id: "sw1",
    });
    expect(env.document_state_delta).toEqual({
      new_frames: [{ id: "f1", type: "line" }],
    });
  });

  it("propagates failure envelopes verbatim", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: { kind: "not_found", message: "page p99 not found" },
    });

    const env = await createLineTool.handler({
      page_id: "p99",
      start_mm: { x: 0, y: 0 },
      end_mm: { x: 100, y: 0 },
    });

    expectFailure(env);
    expect(env.error.kind).toBe("not_found");
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/unit/tools/create-line.test.ts`

### Step 3: Write tool source

- [ ] Create `src/tools/create-line.ts`:

```ts
import { z } from "zod";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript, lit, prelude } from "../compose.js";
import { findDocumentById, findPageById, resolveSwatch } from "../script-helpers.js";
import { ok } from "../errors.js";

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

const InputSchema = z
  .object({
    page_id: z.string(),
    start_mm: z.object({
      x: z.number().nonnegative(),
      y: z.number().nonnegative(),
    }),
    end_mm: z.object({
      x: z.number().nonnegative(),
      y: z.number().nonnegative(),
    }),
    stroke_hex: z.string().regex(HEX_COLOR_RE).optional(),
    stroke_weight_pt: z.number().positive().optional(),
    document_id: z.string().optional(),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

const ScriptResultSchema = z.object({
  frame_id: z.string(),
  page_id: z.string(),
  stroke_swatch_id: z.string(),
});

type ScriptResult = z.infer<typeof ScriptResultSchema>;

interface Result {
  frame_id: string;
  page_id: string;
  stroke_swatch_id: string;
}

function buildScriptBody(input: Input): string {
  const docExpr =
    input.document_id !== undefined
      ? `findDocumentById(${lit(input.document_id)})`
      : "app.activeDocument";

  const strokeHex = (input.stroke_hex ?? "#000000").toUpperCase();
  const weight = input.stroke_weight_pt ?? 0.5;

  return `
${prelude(findDocumentById, findPageById, resolveSwatch)}
var prevUnits = app.scriptPreferences.measurementUnit;
app.scriptPreferences.measurementUnit = MeasurementUnits.MILLIMETERS;
try {
  var doc = ${docExpr};
  var page = findPageById(doc, ${lit(input.page_id)});
  var line = page.graphicLines.add();
  // Set the path to the two endpoints. entirePath is [[x1, y1], [x2, y2]] in current units.
  line.paths[0].entirePath = [
    [${input.start_mm.x}, ${input.start_mm.y}],
    [${input.end_mm.x}, ${input.end_mm.y}]
  ];
  var strokeSwatch = resolveSwatch(doc, ${lit(strokeHex)});
  line.strokeColor = strokeSwatch;
  line.strokeWeight = ${weight};
  return {
    frame_id: String(line.id),
    page_id: ${lit(input.page_id)},
    stroke_swatch_id: String(strokeSwatch.id)
  };
} finally {
  app.scriptPreferences.measurementUnit = prevUnits;
}
`;
}

export const createLineTool = defineTool<Input, Result>({
  name: "create_line",
  description:
    "Creates a straight line between two points on a page, with optional stroke colour and weight. Useful for rules, dividers, and decorative lines.",
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
        page_id: r.page_id,
        stroke_swatch_id: r.stroke_swatch_id,
      },
      {
        document_state_delta: {
          new_frames: [{ id: r.frame_id, type: "line" }],
        },
      },
    );
  },
});
```

### Step 4-9: Register, test, integration test, commit

- [ ] **Step 4: Register**

```ts
import { createLineTool } from "./tools/create-line.js";
// ...
registry.register(createLineTool);
```

- [ ] **Step 5-6: Run tests + tsc**

Run: `npm test -- tests/unit/tools/create-line.test.ts`
Expected: 8/8 pass.

Run: `npm test && npx tsc --noEmit`
Expected: ~184 pass, tsc clean.

- [ ] **Step 7: Write integration test**

Create `tests/integration/create-line.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { createLineTool } from "../../src/tools/create-line.js";

integrationGate("create_line (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "creates a horizontal rule across the top of an A4 page",
    async () => {
      const create = await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });
      if (!create.ok) return;

      const env = await createLineTool.handler({
        page_id: create.result!.page_ids[0],
        start_mm: { x: 12, y: 12 },
        end_mm: { x: 198, y: 12 },
        stroke_hex: "#333333",
        stroke_weight_pt: 0.75,
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(typeof env.result?.frame_id).toBe("string");
      expect(typeof env.result?.stroke_swatch_id).toBe("string");
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
```

- [ ] **Step 8: Verify tsc**

Run: `npx tsc --noEmit`

- [ ] **Step 9: Commit**

```bash
git add src/tools/create-line.ts src/index.ts tests/unit/tools/create-line.test.ts tests/integration/create-line.int.test.ts
git commit -m "feat: create_line tool"
```

---

## Task 8: End-to-end smoke test

**Why:** Spec's success criterion #5 — Claude composes a layout exercising image frame + place_image + rectangle (stat pill) + line (top rule), then exports.

**Files:**
- Create: `tests/integration/plan-b3-end-to-end.int.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/integration/plan-b3-end-to-end.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { createImageFrameTool } from "../../src/tools/create-image-frame.js";
import { placeImageTool } from "../../src/tools/place-image.js";
import { createRectangleTool } from "../../src/tools/create-rectangle.js";
import { createLineTool } from "../../src/tools/create-line.js";
import { exportPdfTool } from "../../src/tools/export-pdf.js";

const TINY_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

integrationGate("Plan B3 end-to-end (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "composes a page with image, stat pill, top rule; exports PDF",
    async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "indesign-mcp-b3-"));
      const imagePath = join(tmpDir, "test.png");
      const pdfPath = join(tmpDir, "out.pdf");
      writeFileSync(imagePath, TINY_PNG_BYTES);

      try {
        const create = await createDocumentTool.handler({
          preset: "A4",
          margins_mm: { top: 18, bottom: 18, left: 18, right: 18 },
        });
        expect(create.ok).toBe(true);
        if (!create.ok) return;
        const pageId = create.result!.page_ids[0];

        const topRule = await createLineTool.handler({
          page_id: pageId,
          start_mm: { x: 18, y: 12 },
          end_mm: { x: 192, y: 12 },
          stroke_hex: "#333333",
          stroke_weight_pt: 0.5,
        });
        expect(topRule.ok).toBe(true);

        const imageFrame = await createImageFrameTool.handler({
          page_id: pageId,
          bounds_mm: { x: 18, y: 30, width: 100, height: 60 },
        });
        expect(imageFrame.ok).toBe(true);
        if (!imageFrame.ok) return;

        const place = await placeImageTool.handler({
          frame_id: imageFrame.result!.frame_id,
          image_path: imagePath,
        });
        expect(place.ok).toBe(true);

        const pill = await createRectangleTool.handler({
          page_id: pageId,
          bounds_mm: { x: 18, y: 100, width: 60, height: 12 },
          fill_hex: "#FF6600",
          corner_radius_mm: 6,
        });
        expect(pill.ok).toBe(true);

        const exported = await exportPdfTool.handler({ path: pdfPath });
        expect(exported.ok).toBe(true);
        if (!exported.ok) return;
        expect(existsSync(pdfPath)).toBe(true);
        expect(statSync(pdfPath).size).toBeGreaterThan(0);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    },
    INTEGRATION_TIMEOUT_MS * 3,
  );
});
```

- [ ] **Step 2: Verify tsc**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Run unit suite**

Run: `npm test`
Expected: ~184 pass; integration excluded.

- [ ] **Step 4: Build dist/**

Run: `npm run build`
Expected: clean.

- [ ] **Step 5: Manual integration run with InDesign open**

Run: `npm run test:integration`
Expected: all integration tests pass.

- [ ] **Step 6: Commit**

```bash
git add tests/integration/plan-b3-end-to-end.int.test.ts
git commit -m "test: end-to-end Plan B3 visuals scenario"
```

---

## Plan-Complete Checklist

Before declaring Plan B3 done:

- [ ] All 8 tasks committed.
- [ ] `npm test` passes.
- [ ] `npx tsc --noEmit` clean.
- [ ] `npm run build` clean.
- [ ] Manual integration run with InDesign 2026 open passes all integration tests.
- [ ] End-to-end test produces a real PDF on disk with image, rectangle, and line elements.
- [ ] Final code review of the Plan B3 commits as a unit.

When all seven are checked, Plan B4 (parent pages + page numbers) becomes the next planning step.
