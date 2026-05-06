# InDesign MCP — Plan B2 Design Spec (Text Composition)

**Date:** 2026-05-06
**Status:** Approved (brainstorm phase)
**Parent specs:**
- `docs/superpowers/specs/2026-05-05-indesign-mcp-design.md`
- `docs/superpowers/specs/2026-05-06-indesign-mcp-plan-b1-design.md`
**Project location:** `~/Documents/GitHub/indesign-mcp/`

## Goal

Plan B2 is the second sub-plan of Plan B (POC tool surface). Five tools that
together let Claude place styled text on pages and inspect the result.

End-state demonstrable: *"lay out a one-page case study from this DESIGN.md and
~200 words of body content."* — Claude creates a document (B1), creates text
frames, defines paragraph styles for headline/body/caption, places text, applies
the styles, then verifies the layout via `get_page_state`.

The five tools introduce:
- The first per-page state read (`get_page_state`) — Claude's feedback channel
  for verifying its own work
- Style definition + application — typographic decisions encoded as named
  styles, the right unit of brand fidelity
- Frame-level text content — the building block of every layout

## Tools

### `create_text_frame`

Creates an empty text frame on a specified page.

**Input schema:**

```ts
{
  page_id: string;                                       // required
  bounds_mm: {
    x: number;                                           // distance from page top-left, in mm
    y: number;
    width: number;
    height: number;
  };
  initial_text?: string;                                  // optional content
  document_id?: string;                                   // default: active document
}
```

**Validation rules:**
- `bounds_mm.width` and `bounds_mm.height` must be > 0.
- `bounds_mm.x` and `bounds_mm.y` must be ≥ 0.
- `page_id` must reference an existing page in the target document.

**Result:**

```ts
{
  frame_id: string;
  page_id: string;
}
```

Plus `document_state_delta`:

```ts
{
  new_frames: [{ id: frame_id, type: "text" }]
}
```

**ExtendScript notes:**
- Sets `app.scriptPreferences.measurementUnit = MeasurementUnits.MILLIMETERS`
  for the duration (restored in finally; matches `create_document`'s pattern).
- InDesign's `geometricBounds` is `[y1, x1, y2, x2]` (top, left, bottom, right).
  The script converts from `{x, y, width, height}` server-side.
- If `initial_text` is provided, it's set via `frame.contents = initial_text`.

### `set_text`

Replaces the entire text content of a text frame. No inline style ranges.

**Input schema:**

```ts
{
  frame_id: string;
  text: string;
  document_id?: string;
}
```

**Validation rules:**
- `frame_id` must reference an existing text frame in the target document.

**Result:**

```ts
{
  frame_id: string;
  character_count: number;     // length of the new text
}
```

No `document_state_delta` (text-content change isn't currently tracked in the
delta type).

**Behaviour:**
- Replaces all text in the frame (`frame.contents = text`).
- Returns `not_found` (kind via the structured throw / wrapExtendScript path
  established in B1.5) if `frame_id` doesn't exist or isn't a text frame.

### `define_paragraph_style`

Creates a paragraph style on the document. All attribute fields are optional —
Claude only sets what the brand specifies. Auto-creates a backing RGB swatch
when a hex color is provided.

**Input schema:**

```ts
{
  name: string;                                            // unique within doc
  font_family?: string;                                    // e.g. "Helvetica Neue"
  font_style?: string;                                     // e.g. "Bold"
  size_pt?: number;                                        // > 0
  leading_pt?: number | "auto";                            // "auto" → InDesign auto leading
  alignment?: "left" | "center" | "right" | "justify";
  color_hex?: string;                                      // "#RRGGBB", case-insensitive
  space_before_pt?: number;                                // ≥ 0
  space_after_pt?: number;                                 // ≥ 0
  on_collision?: "error" | "replace" | "version";          // default "error"
  document_id?: string;
}
```

**Validation rules:**
- `name` is non-empty.
- `font_style` requires `font_family` (specifying a style without a family is
  meaningless).
- `color_hex` matches `/^#[0-9A-Fa-f]{6}$/`.
- `size_pt`, `space_before_pt`, `space_after_pt` ≥ 0; `size_pt` > 0 when
  provided.

**Result:**

```ts
{
  style_id: string;
  name: string;
  swatch_id?: string;       // present when color_hex was provided
}
```

No `document_state_delta` — style/swatch additions aren't tracked in the delta.

**Collision behaviour:**

| `on_collision` | Behaviour |
|----------------|-----------|
| `"error"` (default) | Returns `name_collision` error if a paragraph style with `name` already exists. |
| `"replace"` | Updates the existing style's attributes in place. |
| `"version"` | Creates a new style named `${name} 2` (or `3`, `4`...) that doesn't collide. Returned `name` reflects the actual created name. |

**Color handling:**
When `color_hex` is provided, the script:
1. Looks for an existing swatch named `auto-#RRGGBB` (uppercased).
2. If absent, creates an RGB swatch with that name (`ColorModel.PROCESS`,
   `ColorSpace.RGB`, `colorValue: [R, G, B]`).
3. Applies the swatch as the paragraph style's `fillColor`.

This means hundreds of hex-color paragraph styles share swatches by hex value.
A future tool (`list_swatches`) can surface them.

**Font handling:**
When `font_family` is provided (and optionally `font_style`), the script joins
them with " / " — InDesign's `appliedFont` accepts the format
`"<Family>\t<Style>"` (tab-separated) or `"<Family> / <Style>"` depending on
the version. We use the slash form which is documented in modern InDesign.

If `font_family` is provided without `font_style`, only the family is set
(InDesign uses the family's "Regular" or default style).

If the named font isn't installed, the script doesn't throw — InDesign
substitutes silently. The handler emits a warning when this happens
(checking via `font.status`).

### `apply_paragraph_style`

Applies a previously defined paragraph style to a text frame.

**Input schema:**

```ts
{
  frame_id: string;
  style_name: string;
  document_id?: string;
}
```

**Validation rules:**
- `frame_id` must be a text frame in the target document.
- `style_name` must reference an existing paragraph style.

**Result:**

```ts
{
  frame_id: string;
  style_name: string;
  affected_paragraphs: number;     // count of paragraphs after style application
}
```

Plus `document_state_delta`:

```ts
{
  changed_frames: [{ id: frame_id, applied_paragraph_style: style_name }]
}
```

This requires extending `DocumentStateDelta`'s `changed_frames` item shape with
an optional `applied_paragraph_style` field — see [Type extensions](#type-extensions).

**Behaviour:**
- Applies the style to all paragraphs in the frame's `parentStory.paragraphs`
  via `paragraphs.everyItem().applyParagraphStyle(style, true)`.
- The `true` argument clears local overrides — Claude's intent when applying
  a brand style is "use this style," not "layer on top of inline tweaks."

### `get_page_state`

Returns a snapshot of a page's frames and their current state. Claude uses this
to verify what landed after a sequence of mutating calls.

**Input schema:**

```ts
{
  page_id: string;
  document_id?: string;
}
```

**Result:**

```ts
{
  page_id: string;
  page_index: number;                       // 0-based index in document.pages
  bounds_mm: { x, y, width, height };       // page bounds (page size + margins ignored at this layer)
  frames: Array<{
    id: string;
    type: "text" | "image" | "rectangle";   // type discrimination
    bounds_mm: { x, y, width, height };
    paragraph_style_name?: string;          // for text frames with a single paragraph style
    text_snippet?: string;                  // first 200 chars of text content
  }>;
}
```

**Behaviour:**
- Page bounds expressed in mm (script pins `measurementUnit` for the call).
- Frame `type` is determined by InDesign DOM constructor name: text frames →
  `"text"`, rectangles with placed images → `"image"` (B3), other rectangles →
  `"rectangle"`.
- `paragraph_style_name` is set only when ALL paragraphs in the frame share the
  same applied style. If multiple styles or `[No paragraph style]`, omit.
- `text_snippet` truncates with ellipsis at 200 chars; omitted for non-text
  frames.

No `document_state_delta` (read-only tool).

## Type extensions

`DocumentStateDelta.changed_frames` (in `src/types.ts`) gains an optional
`applied_paragraph_style` field:

```ts
export interface DocumentStateDelta {
  changed_frames?: Array<{
    id: FrameId;
    bounds?: [number, number, number, number];
    applied_paragraph_style?: string;       // NEW
  }>;
  new_frames?: Array<{ id: FrameId; type: string }>;
  removed_frame_ids?: FrameId[];
  new_page_ids?: string[];
  removed_page_ids?: string[];
  page_count?: number;
}
```

`EnvelopeSchema` in `src/transport/result-file.ts` doesn't validate the delta's
shape, so no schema change is needed there.

## Helper additions

`src/script-helpers.ts` (added in B1.5) gains a `findFrameById` helper:

```ts
export const findFrameById = `
function findFrameById(doc, id) {
  for (var i = 0; i < doc.pageItems.length; i++) {
    if (String(doc.pageItems[i].id) === id) return doc.pageItems[i];
  }
  throw { name: "not_found", message: "frame " + id + " not found", entity: "frame", id: id };
}
`.trim();
```

A `findStyleByName` helper:

```ts
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

Both are exported alongside the existing `findDocumentById` and `findPageById`.
Tools include them via `prelude(findDocumentById, findFrameById, ...)` per the
established pattern.

## Error handling

Plan B1.5 already addresses `not_found` propagation through structured throws.
B2 tools throw structured `not_found` for missing frames, pages, styles, etc.
The wrapper catches and routes to `kind: "not_found"` envelopes correctly.

`name_collision` is a new in-band kind for `define_paragraph_style` — already
in `ErrorKind` (defined in Plan A) but not previously used. The `on_collision:
"error"` path throws `{name: "name_collision", entity: "paragraph_style", id: name}`.

`invalid_args` continues to surface schema-validation failures pre-dispatch.

## Test hygiene

Per Plan B1's pattern: each integration test wraps in `integrationGate` and
calls `closeAllDocuments()` in `afterEach`. B2 integration tests build on B1
tools — they call `createDocumentTool.handler({...})` to set up a document
before exercising B2 operations.

## Out of scope for Plan B2

- Inline character styles within a text frame (style ranges)
- Apply style to a sub-range of text rather than the whole frame
- Frame threading (`link_text_frames`)
- Object styles
- Tables
- Image frames + `place_image` (Plan B3)
- Master page / template support
- CMYK or spot colors
- Custom paragraph rules, drop caps, columns within a frame

## Tool implementation pattern (post-Task-3 template)

Each tool follows the template established in B1:
1. Zod input schema + cross-field refinements where needed.
2. Module-level `ScriptResultSchema` (Zod) for runtime validation of the
   script's flat result.
3. `buildScriptBody(input)` that interpolates values via `lit()` and includes
   relevant helpers via `prelude(...)`.
4. Handler that dispatches via `runScriptWithResultFile<TScriptResult>` with
   `resultSchema: ScriptResultSchema`, post-processes into the public envelope.
5. Server registration in `src/index.ts`.

Each tool's tests:
- 1 metadata test
- 2-4 schema-validation tests (per-field rejections + happy-path acceptance)
- 1+ dispatch tests (verify the script body)
- 1 success-envelope-propagation test
- 1 failure-envelope-propagation test
- (Optional) tests for argument transformations (e.g., color hex → RGB triple)

Each tool's integration test:
- Gated via `integrationGate`
- Uses `closeAllDocuments()` in `afterEach`
- Calls B1 tools to set up state, then exercises the B2 operation
- Verifies the round-trip end-to-end against running InDesign

## Success criteria

Plan B2 is complete when:

1. All five tools registered and exposed via the MCP server.
2. Every tool has unit tests covering schema, dispatch, success, and failure paths.
3. Every tool has an integration test that runs against InDesign 2026.
4. End-to-end: a smoke-test integration scenario that creates a doc, adds a
   text frame, defines two paragraph styles (e.g., headline + body), sets text,
   applies styles, then reads `get_page_state` and asserts the frames and
   styles match expected values.
5. Live verification through Claude Desktop on a real DESIGN.md + ~200-word
   case-study brief — operator step.

When all five are met, Plan B3 (images + final POC) becomes the next planning
step.
