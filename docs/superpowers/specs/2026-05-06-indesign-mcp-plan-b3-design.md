# InDesign MCP — Plan B3 Design Spec (Visuals & Geometry)

**Date:** 2026-05-06
**Status:** Approved (brainstorm phase)
**Parent specs:**
- `docs/superpowers/specs/2026-05-05-indesign-mcp-design.md`
- `docs/superpowers/specs/2026-05-06-indesign-mcp-plan-b1-design.md`
- `docs/superpowers/specs/2026-05-06-indesign-mcp-plan-b2-design.md`
**Project location:** `~/Documents/GitHub/indesign-mcp/`

## Goal

Plan B3 ships the geometric and image tools needed for a real document layout
(stat pills, panels, dividers, photography, hero boxes). End-state: with B1+B2+B3
in hand, Claude can produce styled documents with both text and graphical
elements — covers Tier 1 of the Iran-rebuild requirement list except parent
pages and inline character styles (Plan B4 and B5 respectively).

Four tools plus one bug fix:
- `create_image_frame` — empty rectangle pre-configured to receive an image
- `place_image` — drop an image file into an existing rectangle
- `create_rectangle` — design rectangle with optional fill, stroke, corner radius
- `create_line` — straight rule between two points
- Bug fix: `~` path expansion in `save_document`, `export_pdf`, and `place_image`

## Type extensions

`src/types.ts`:

```ts
export type FrameType = "text" | "image" | "rectangle" | "line";

export interface DocumentStateDelta {
  changed_frames?: Array<{
    id: FrameId;
    bounds?: [number, number, number, number];
    applied_paragraph_style?: string;
    applied_image_path?: string;       // NEW — set by place_image
  }>;
  new_frames?: Array<{ id: FrameId; type: FrameType }>;   // tightened from string
  removed_frame_ids?: FrameId[];
  new_page_ids?: string[];
  removed_page_ids?: string[];
  page_count?: number;
}
```

`src/tools/get-page-state.ts`'s `FrameSchema.type` enum gains `"line"`.

The tightening from `string` → `FrameType` is the followup item flagged by the
B2 reviewer (task #48). It lands here naturally because B3 adds new frame types.

## Path helper

`src/path-utils.ts` (new file):

```ts
import { homedir } from "node:os";
import { resolve } from "node:path";

/**
 * Expand a leading `~/` to the user's home directory and resolve to an
 * absolute path. Bare `~` (no slash) is left as-is — that's a literal
 * file/dir name in some contexts and we don't want to silently rewrite it.
 */
export function resolveUserPath(input: string): string {
  if (input.startsWith("~/")) {
    return resolve(homedir(), input.slice(2));
  }
  return resolve(input);
}
```

Used by `save_document`, `export_pdf`, and `place_image` in place of the bare
`resolve()` calls. Closes the bug from the user's report ("first save_document
call hit `~` not expanding").

## Tools

### `create_image_frame`

Creates an empty rectangle on a page, configured so a future `place_image`
call auto-fits the placed graphic.

**Input schema:**

```ts
{
  page_id: string;
  bounds_mm: { x: number; y: number; width: number; height: number };
  document_id?: string;
}
```

**Validation rules:**
- `bounds_mm.width` and `height` > 0; `x`, `y` ≥ 0.

**Result:**

```ts
{
  frame_id: string;
  page_id: string;
}
```

Plus delta: `new_frames: [{ id: frame_id, type: "rectangle" }]`. The frame is a
rectangle until `place_image` populates it; `get_page_state` will start
reporting it as `"image"` only after that.

**ExtendScript notes:**
- Creates via `page.rectangles.add({ geometricBounds: [...] })`.
- Sets `frame.frameFittingOptions.fittingOnEmptyFrame = EmptyFrameFittingOptions.FILL_PROPORTIONALLY` so subsequent `place_image` auto-fits.
- Pins `measurementUnit = MILLIMETERS` for the call duration.

### `place_image`

Places an image file into an existing rectangle.

**Input schema:**

```ts
{
  frame_id: string;
  image_path: string;
  fit?:
    | "fill_proportionally"
    | "fit_proportionally"
    | "fit_content_to_frame"
    | "center_content";                                  // default "fill_proportionally"
  document_id?: string;
}
```

**Server-side preprocessing:**
- `image_path` resolved via `resolveUserPath()` (handles `~/`).
- Existence check: if `!fs.existsSync(absolutePath)`, return
  `fail("io_error", "image file not found: <path>")` without dispatching.
  Avoids round-tripping to InDesign for a trivially-detectable error.

**Result:**

```ts
{
  frame_id: string;
  image_path: string;          // absolute
  link_status: string;         // InDesign LinkStatus value: "NORMAL", "MODIFIED", etc.
}
```

Plus delta:

```ts
{
  changed_frames: [{ id: frame_id, applied_image_path: <absolute> }]
}
```

**ExtendScript notes:**
- `frame.place(File(<absolutePath>))` returns the placed graphic; if `frame`
  already had content, it's replaced.
- Apply fit AFTER place: `frame.fit(FitOptions.<enum>)`. Mapping:
  - `fill_proportionally` → `FILL_PROPORTIONALLY`
  - `fit_proportionally` → `PROPORTIONALLY`
  - `fit_content_to_frame` → `CONTENT_TO_FRAME`
  - `center_content` → `CENTER_CONTENT`
- `link_status` from `frame.graphics[0].itemLink.status` (LinkStatus enum →
  string via `.toString()`).

### `create_rectangle`

Creates a rectangle for design elements (panels, pills, hero boxes, dividers).

**Input schema:**

```ts
{
  page_id: string;
  bounds_mm: { x: number; y: number; width: number; height: number };
  fill_hex?: string;                                     // "#RRGGBB", auto-creates swatch
  stroke_hex?: string;                                   // "#RRGGBB", auto-creates swatch
  stroke_weight_pt?: number;                             // ≥ 0; default 0 if stroke_hex set, else no stroke
  corner_radius_mm?: number;                             // uniform; ≥ 0
  document_id?: string;
}
```

**Validation rules:**
- bounds: width/height > 0, x/y ≥ 0
- `fill_hex`, `stroke_hex` match `/^#[0-9A-Fa-f]{6}$/`
- `stroke_weight_pt` requires `stroke_hex` (specifying weight without a colour
  is meaningless)
- `corner_radius_mm` ≥ 0

**Result:**

```ts
{
  frame_id: string;
  page_id: string;
  fill_swatch_id?: string;        // present when fill_hex provided
  stroke_swatch_id?: string;      // present when stroke_hex provided
}
```

Plus delta: `new_frames: [{ id: frame_id, type: "rectangle" }]`.

**Behaviour:**
- Swatch creation reuses the `auto-#RRGGBB` swatch pattern from B2's
  `define_paragraph_style`. Same naming, same dedup logic.
- When `corner_radius_mm > 0`: sets `frame.cornerOption = CornerOptions.ROUNDED_CORNER` and `frame.cornerRadius = <value>` (mm via `measurementUnit` pinning).
- When no `stroke_hex`: `frame.strokeWeight = 0` and `frame.strokeColor = doc.swatches.itemByName("None")`.

### `create_line`

Creates a straight line between two points.

**Input schema:**

```ts
{
  page_id: string;
  start_mm: { x: number; y: number };
  end_mm: { x: number; y: number };
  stroke_hex?: string;                                   // default "#000000"
  stroke_weight_pt?: number;                             // > 0; default 0.5
  document_id?: string;
}
```

**Validation rules:**
- `start_mm.x`, `start_mm.y`, `end_mm.x`, `end_mm.y` ≥ 0
- `stroke_hex` matches the hex pattern
- `stroke_weight_pt` > 0

**Result:**

```ts
{
  frame_id: string;
  page_id: string;
  stroke_swatch_id: string;
}
```

Plus delta: `new_frames: [{ id: frame_id, type: "line" }]`.

**ExtendScript notes:**
- `page.graphicLines.add()` creates a Line. Set `geometricBounds` to
  `[y1, x1, y2, x2]` (paths are bounded boxes; for axis-aligned lines this
  works identically to setting paths directly).
- For arbitrary 2-point lines, use `path.entirePath = [[x1, y1], [x2, y2]]`
  after add. (Lines in InDesign are paths.)
- Same swatch dedup via `auto-#RRGGBB`.

## Helper additions

`src/script-helpers.ts` gains a shared swatch-resolver helper:

```ts
export const resolveSwatch = `
function resolveSwatch(doc, hex) {
  // hex format: "#RRGGBB" (already uppercased by caller)
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

Used by `create_rectangle`, `create_line`, and the existing
`define_paragraph_style` (refactored in this plan to use the shared helper —
removes inline duplication that B2's reviewer flagged).

## Tool implementation pattern (post-B1-Task-3 template)

Same as B2: Zod input → `ScriptResultSchema` → `buildScriptBody` with
`prelude(...)` + `lit(...)` → `runScriptWithResultFile<TScriptResult>` with
`resultSchema` → handler post-processes into `Envelope<TResult>`.

## Out of scope for B3

- Image transforms (rotation, crop offset)
- Re-linking or embed-vs-link choice
- Image effects (drop shadow, gradient feather)
- Lines with > 2 points (paths)
- Compound shapes
- Stroke styles (dashed, dotted, custom)
- Per-corner radius (only uniform supported)

## Test hygiene

Per B1/B2 pattern: each integration test wraps in `integrationGate`,
`afterEach(closeAllDocuments)`. Tests build on B1 tools to set up state.

## Success criteria

Plan B3 is complete when:

1. All four tools registered and exposed via the MCP server.
2. Path expansion works in `save_document`, `export_pdf`, `place_image`
   (verified by a unit test for `resolveUserPath` plus the existing path
   handling tests).
3. Every tool has unit tests covering schema, dispatch, success, failure paths.
4. Every tool has an integration test that runs against InDesign 2026.
5. End-to-end: a smoke-test integration scenario that creates a doc, places
   an image into a rectangle, draws a stat-pill rectangle with corner radius
   and stroke, draws a top rule via `create_line`, and exports a PDF that
   exists on disk and is non-zero.
6. Live verification through Claude Desktop: exercise the new tools with a
   realistic prompt approximating the Iran-rebuild use case.

When all six are met, Plan B4 (parent pages + page numbers) becomes the next
planning step.
