# InDesign MCP — Plan B6 Design Spec (Frame Refinements)

**Date:** 2026-05-06
**Status:** Approved (autonomous-execution iteration)
**Parent specs:**
- `docs/superpowers/specs/2026-05-05-indesign-mcp-design.md`
- `docs/superpowers/specs/2026-05-06-indesign-mcp-plan-b5-design.md`
**Project location:** `~/Documents/GitHub/indesign-mcp/`

## Goal

Plan B6 ships text-frame refinement tools that round out editorial layouts:
inset spacing (text-frame padding), column splits within a frame, and
text-thread linking across frames. With B6 in hand, Claude can produce
multi-column body copy that flows correctly across page breaks — the basic
shape of any longer article.

Three tools:
- `set_frame_inset` — set per-side inset (padding) on a text frame
- `set_frame_columns` — set column count + gutter on a text frame
- `thread_text_frames` — link two text frames into a single story

## DOM-grounded facts (verified live in InDesign 2026, 21.3.0.60)

1. **Insets**: `frame.textFramePreferences.insetSpacing` accepts a 4-element
   array `[top, left, bottom, right]` (in current measurement units) and reads
   back as the same shape. The setter requires the full quartet — there is no
   per-side property exposed at the same level.
2. **Columns**: `frame.textFramePreferences.textColumnCount` (integer) and
   `textColumnGutter` (numeric, current units) are individually settable.
   `textColumnCount = 1` collapses to single-column. No additional preference
   needed for the simple FIXED_WIDTH gutter case.
3. **Threading**: `tf1.nextTextFrame = tf2` chains the two frames into one
   story. After the assignment, `tf2.previousTextFrame.id === tf1.id` and
   `tf1.parentStory === tf2.parentStory`. The previous content of `tf2` is
   effectively concatenated into the merged story (if both frames had text
   before threading, the result is `tf1.contents + tf2.contents` as one
   story; B6 documents this but does not try to police it).
4. All three operations require the targeted item to be a `TextFrame`
   (`constructor.name === "TextFrame"`).

## Type extensions

`src/types.ts` — extend `DocumentStateDelta`:

```ts
export interface DocumentStateDelta {
  changed_frames?: Array<{
    id: FrameId;
    bounds?: [number, number, number, number];
    applied_paragraph_style?: string;
    applied_image_path?: string;
    applied_parent_name?: string;
    applied_character_style_range?: { ... };
    inset_mm?: { top: number; left: number; bottom: number; right: number };  // NEW
    columns?: { count: number; gutter_mm: number };                           // NEW
    threaded_to_frame_id?: FrameId;                                           // NEW
  }>;
  // (rest unchanged)
}
```

The three new fields document what changed at the frame level. Each tool emits
exactly one of them.

## Tools

### `set_frame_inset`

Sets the per-side inset spacing on a text frame.

**Input schema:**

```ts
{
  frame_id: string;
  inset_mm: { top: number; left: number; bottom: number; right: number };
  document_id?: string;
}
```

Each side `≥ 0`. (InDesign technically accepts negatives in some contexts, but
they're outside the normal padding semantics and we reject them at the
schema level for clarity. Callers wanting pull-out effects can use frame
bounds instead.)

**Result:**

```ts
{
  frame_id: string;
  inset_mm: { top: number; left: number; bottom: number; right: number };
}
```

Plus delta: `changed_frames: [{ id: frame_id, inset_mm: {...} }]`.

**ExtendScript notes:**
- Pin `measurementUnit = MILLIMETERS` in try/finally.
- Resolve frame via `findFrameById`; validate `TextFrame`; throw
  `invalid_args` otherwise.
- `frame.textFramePreferences.insetSpacing = [top, left, bottom, right]`.
- Read back the array to confirm the assignment took.

### `set_frame_columns`

Sets the column count and gutter width on a text frame.

**Input schema:**

```ts
{
  frame_id: string;
  count: number;            // integer ≥ 1
  gutter_mm?: number;       // ≥ 0; default 4 (a sensible mid-range default)
  document_id?: string;
}
```

**Result:**

```ts
{
  frame_id: string;
  count: number;
  gutter_mm: number;
}
```

Plus delta: `changed_frames: [{ id: frame_id, columns: { count, gutter_mm } }]`.

**ExtendScript notes:**
- Pin `measurementUnit = MILLIMETERS` in try/finally.
- Resolve frame; validate `TextFrame`.
- `tfp.textColumnCount = count`; `tfp.textColumnGutter = gutter_mm`.
- When `count === 1`, the gutter is meaningless but harmless — InDesign
  ignores it. We still write it for consistency.

### `thread_text_frames`

Links two text frames into one story. Subsequent typing or `set_text` on the
chain flows automatically across both frames.

**Input schema:**

```ts
{
  source_frame_id: string;          // story head (or any frame in chain)
  target_frame_id: string;          // becomes the next frame after source
  document_id?: string;
}
```

`source_frame_id !== target_frame_id` enforced via `.refine()`.

**Result:**

```ts
{
  source_frame_id: string;
  target_frame_id: string;
  story_length_after: number;       // characters in the merged story
}
```

Plus delta: `changed_frames: [{ id: source_frame_id, threaded_to_frame_id: target_frame_id }]`.

**ExtendScript notes:**
- Resolve both frames via `findFrameById`; validate both are `TextFrame`.
- If `source.nextTextFrame === target` already, the operation is a no-op —
  return success with the current `story_length_after`. (Idempotency.)
- Else: `source.nextTextFrame = target`. InDesign handles the story merge.
- `story_length_after = source.parentStory.length`.
- **Caveat**: if `target` has its own existing content, it becomes part of
  the merged story (concatenated after `source`'s content). We don't warn —
  the LLM caller should be aware. Document in the tool description.

## Out of scope for B6

- Inset on non-text frames (Rectangle, GraphicLine — they don't have
  `textFramePreferences`).
- Per-side inset clearing (passing `null` for one side). Callers can
  re-apply with the desired values.
- Custom column widths (InDesign supports per-column widths via
  `textColumnFixedWidth` and balancing options; B6 only does uniform
  count+gutter).
- Splitting a story (the inverse of `thread_text_frames`). Defer to B7+.
- Crossing-spread / cross-page threading (the threading itself works across
  pages; we just don't add tools for explicit "create overflow on next page"
  workflows).
- Auto-balanced columns, span columns, split columns. Per-paragraph layout
  is its own deep area.

## Test hygiene

Per established pattern: `integrationGate` + `afterEach(closeAllDocuments)`.
Bare-substring `.toContain()` in unit tests.

## Success criteria

Plan B6 is complete when:

1. All three tools registered and exposed via the MCP server.
2. Every tool has unit tests covering schema validation, dispatch, success
   path, failure paths.
3. Every tool has an integration test that runs against InDesign 2026.
4. End-to-end: a smoke-test integration scenario that creates a 2-column
   text frame with inset padding, threads it to a second frame, places
   enough text in the first to overflow into the second, and exports a
   PDF on disk.
5. No regression of any earlier tool (B1–B5).

When all five are met, Plan B7 (polish: list/duplicate/find-replace/swatch/
font tools) becomes the next planning step.
