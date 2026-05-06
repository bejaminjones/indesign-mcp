# InDesign MCP — Plan B5 Design Spec (Inline Character Styling)

**Date:** 2026-05-06
**Status:** Approved (autonomous-execution iteration)
**Parent specs:**
- `docs/superpowers/specs/2026-05-05-indesign-mcp-design.md`
- `docs/superpowers/specs/2026-05-06-indesign-mcp-plan-b4-design.md`
**Project location:** `~/Documents/GitHub/indesign-mcp/`

## Goal

Plan B5 ships inline character-styling tools so Claude can author rich text:
bold/italic spans, accent-coloured numerals in a stat pill, hyperlinked words
within a paragraph. End-state: B1+B2+B3+B4+B5 covers all of Tier 1 of the
Iran-rebuild requirements.

Three tools:
- `define_character_style` — create or update a character style with optional
  font, weight, size, fill colour, tracking
- `apply_character_style_to_range` — apply a named character style to a
  character range within a text frame
- `set_text_in_range` — replace text within a character range, leaving the
  surrounding text and styling intact

## DOM-grounded facts (verified live in InDesign 2026, 21.3.0.60)

1. `doc.characterStyles` exists; supports `.add({ name, ...attrs })` at
   construction time. (Unlike `masterSpreads.add()` where constructor
   properties were unreliable, `characterStyles.add(...)` accepts and applies
   the property bag.)
2. `doc.characterStyles.itemByName("Bold")` returns a valid object on hit and
   an invalid one on miss — same `itemByName` pattern used elsewhere.
3. Text-range targeting via `frame.parentStory.characters.itemByRange(start, end)`
   uses **inclusive end** (`itemByRange(6, 10)` returns 5 characters). External
   tool API uses JavaScript-style `start_index` (0-based inclusive) and
   `end_index` (exclusive), translated internally as `end_index - 1`.
4. `text.applyCharacterStyle(cs)` applies the named style to the targeted
   range. Verified by reading back `range.fontStyle` after apply.
5. `range.contents = "X"` replaces the text content of the range in place,
   leaving surrounding text untouched. Length change is permitted.

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
    applied_character_style_range?: {     // NEW
      character_style_name: string;
      start_index: number;
      end_index: number;
    };
  }>;
  // (rest unchanged)
  new_character_styles?: Array<{ name: string }>;   // NEW
}
```

`new_character_styles` mirrors the existing `new_paragraph_styles` shape that
`define_paragraph_style` emits. The per-range entry on `changed_frames` is
informational — it records the most recent character-style application.

## Tools

### `define_character_style`

Creates or updates a character style. Same `on_collision` semantics as
`define_paragraph_style` for symmetry.

**Input schema:**

```ts
{
  name: string;                                  // 1..60 chars
  font_family?: string;                          // e.g. "Helvetica"
  font_style?: string;                           // e.g. "Bold", "Italic", "Bold Italic"
  point_size?: number;                           // > 0
  fill_hex?: string;                             // "#RRGGBB" — auto-creates swatch
  tracking?: number;                             // 1/1000 em; integer; default 0
  on_collision?: "error" | "update" | "version"; // default "error"
  document_id?: string;
}
```

**Validation:**
- `name` non-empty, ≤ 60 chars (InDesign hard-cap unclear; 60 generous).
- `fill_hex` matches `/^#[0-9A-Fa-f]{6}$/`.
- `point_size` > 0.
- `tracking` integer in `[-1000, 10000]` — wide bounds; InDesign's UI accepts
  4-digit integers.
- At least ONE attribute (`font_family`/`font_style`/`point_size`/`fill_hex`/`tracking`)
  must be provided. A character style with no attributes is meaningless.

**Result:**

```ts
{
  character_style_name: string;
  on_collision_outcome: "created" | "updated" | "versioned";
  fill_swatch_id?: string;
}
```

Plus delta:
- `created`/`versioned` → `new_character_styles: [{ name: <final_name> }]`
- `updated` → no `new_character_styles` entry; the style already existed

**ExtendScript notes:**
- Uses the shared `resolveSwatch` helper from B3 when `fill_hex` is provided
  (uppercased server-side, then `resolveSwatch(doc, "#RRGGBB")`).
- Lookup via `doc.characterStyles.itemByName(name)`. On miss, create via
  `doc.characterStyles.add({ name, ...properties })`. On hit:
  - `on_collision = "error"` → throw structured `name_collision`.
  - `on_collision = "update"` → write attributes onto the existing style.
  - `on_collision = "version"` → loop "${name} 2", "${name} 3"… until a
    free name; create with that name.
- Mirrors `define_paragraph_style`'s on_collision semantics exactly. The two
  tools have parallel APIs.

### `apply_character_style_to_range`

Applies a named character style to a character range within a text frame.

**Input schema:**

```ts
{
  frame_id: string;
  character_style_name: string;
  start_index: number;          // ≥ 0; inclusive
  end_index: number;            // > start_index; exclusive
  document_id?: string;
}
```

**Validation:**
- `frame_id` non-empty.
- `character_style_name` non-empty.
- `start_index` ≥ 0; `end_index` > `start_index`.

**Result:**

```ts
{
  frame_id: string;
  character_style_name: string;
  start_index: number;
  end_index: number;
  applied_chars: number;        // end_index - start_index
}
```

Plus delta:

```ts
changed_frames: [
  {
    id: frame_id,
    applied_character_style_range: {
      character_style_name,
      start_index,
      end_index,
    },
  },
]
```

**ExtendScript notes:**
- Resolve frame via `findFrameById`. Validate `frame.constructor.name === "TextFrame"` (throw `invalid_args` otherwise).
- Resolve style via new helper `findCharacterStyleByName(doc, name)` (throws
  `not_found` for entity `"character_style"`).
- Range: `frame.parentStory.characters.itemByRange(start_index, end_index - 1)`.
  The `-1` translates exclusive-end JS convention to InDesign's inclusive-end
  convention.
- Bounds-check: if `end_index > frame.parentStory.characters.length`, throw
  `invalid_args`. (Otherwise InDesign silently truncates and the caller's mental
  model breaks.)
- Apply: `range.applyCharacterStyle(style)`.

### `set_text_in_range`

Replaces text content within a character range. Surrounding text and styling
are preserved.

**Input schema:**

```ts
{
  frame_id: string;
  start_index: number;          // ≥ 0; inclusive
  end_index: number;            // > start_index; exclusive
  text: string;                 // replacement (any length, including empty)
  document_id?: string;
}
```

**Validation:**
- `frame_id` non-empty.
- `start_index` ≥ 0; `end_index` > `start_index`.
- `text` may be empty (allows deletion).

**Result:**

```ts
{
  frame_id: string;
  removed_chars: number;        // end_index - start_index
  inserted_chars: number;       // text.length (after \r normalization)
  total_length_after: number;
}
```

Plus delta: `changed_frames: [{ id: frame_id }]`.

**ExtendScript notes:**
- Same frame resolution + TextFrame validation + bounds check as above.
- Like `set_text`, normalize `\r\n` and `\n` to `\r` before sending.
- `range = frame.parentStory.characters.itemByRange(start_index, end_index - 1)`.
- `range.contents = newText` performs the in-place replacement.
- `total_length_after` from `frame.parentStory.length` for caller verification.

## Helper additions

`src/script-helpers.ts`:

```ts
export const findCharacterStyleByName = `
function findCharacterStyleByName(doc, name) {
  var s = doc.characterStyles.itemByName(name);
  if (!s.isValid) {
    throw { name: "not_found", message: "character style \\"" + name + "\\" not found", entity: "character_style", id: name };
  }
  return s;
}
`.trim();
```

Mirrors `findStyleByName` (paragraph) and `findMasterSpreadByName`.

## Out of scope for B5

- Character-style inheritance / `basedOn`. Defer to B7.
- Inline character formatting *without* a saved style (direct attribute
  overrides) — the spec deliberately requires creating a named style first.
  Direct overrides are a B7-or-later concern.
- Removing a character style from a range (clear formatting). B7.
- Cross-frame text ranges (threaded story).
- OpenType features, ligatures, language tagging.
- Underline / strikethrough / case / position attributes.

## Test hygiene

Per B1/B2/B3/B4 pattern: `integrationGate` + `afterEach(closeAllDocuments)`.

## Success criteria

Plan B5 is complete when:

1. All three tools registered and exposed via the MCP server.
2. Every tool has unit tests covering schema validation, dispatch, success
   path, failure paths.
3. Every tool has an integration test that runs against InDesign 2026.
4. End-to-end: a smoke-test integration scenario that creates a paragraph,
   defines an "Accent" character style with red fill, applies it to one word
   in the middle, replaces a different word, and exports a PDF. PDF is
   non-zero on disk.
5. Live verification through Claude Desktop with a realistic prompt
   (Iran-rebuild stat pill: "1.5M displaced" with the number in accent colour).

When all five are met, Plan B6 (frame refinements) becomes the next planning
step.
