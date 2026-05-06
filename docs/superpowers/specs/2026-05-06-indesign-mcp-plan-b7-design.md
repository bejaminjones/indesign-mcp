# InDesign MCP — Plan B7 Design Spec (Polish & Utility)

**Date:** 2026-05-06
**Status:** Approved (autonomous-execution iteration)
**Parent specs:**
- `docs/superpowers/specs/2026-05-05-indesign-mcp-design.md`
- `docs/superpowers/specs/2026-05-06-indesign-mcp-plan-b6-design.md`
**Project location:** `~/Documents/GitHub/indesign-mcp/`

## Goal

Plan B7 is the polish iteration: utility/read tools that let Claude
discover state ("which fonts/styles/pages are available?"), explicit
swatch and duplicate primitives, and find/replace. Plus two cleanups
flagged by the B5 reviewer.

After B7, the Iran-rebuild Tier 1+2 requirements are fully covered.

Six tools plus two refactors:
- `list_fonts` — read installed fonts (utility, replaces the originally-
  planned `import_font` — InDesign scripting cannot install fonts at
  runtime)
- `create_swatch` — explicit named RGB swatch creation
- `duplicate_frame` — duplicate any frame with an optional offset
- `find_replace` — replace text matches across the document or one frame
- `list_paragraph_styles` — read defined paragraph styles
- `list_pages` — read document pages with side and metadata
- **Refactor #74**: emit `new_paragraph_styles` from `define_paragraph_style`
  for parity with `define_character_style`
- **Refactor #75**: align `on_collision` vocabulary — rename
  `define_paragraph_style`'s `"replace"` to `"update"`; add
  `on_collision_outcome` to its result envelope

## DOM-grounded facts (verified live in InDesign 2026, 21.3.0.60)

1. **`app.fonts.add` is undefined.** InDesign's scripting DOM does NOT
   expose font installation. Fonts must be installed at the OS or via
   Adobe Fonts. The `Document Fonts/` folder is also a valid mechanism
   (auto-loaded on open), but populating it requires file-system work
   outside the InDesign DOM. Out of scope for this iteration.
2. **`app.fonts.length` and `app.fonts[i].fontFamily`** work for
   listing.
3. **`frame.duplicate(destinationPage, [byX, byY])`** returns the
   typed subclass (TextFrame, Rectangle, etc.), with a new id.
4. **`doc.changeGrep()`** returns the array of changed items. The
   `findGrepPreferences`/`changeGrepPreferences` ExtendScript globals
   must be reset to `NothingEnum.NOTHING` before AND after each call,
   otherwise stale state leaks between operations.
5. **`get_page_state`** already returns frame info per page; a separate
   `list_frames_on_page` would be redundant. Dropped from scope.

## Type extensions

`src/types.ts` — extend `DocumentStateDelta`:

```ts
export interface DocumentStateDelta {
  // existing fields...
  new_paragraph_styles?: Array<{ name: string }>;   // NEW (refactor #74)
  new_swatches?: Array<{ name: string }>;           // NEW (create_swatch)
}
```

`new_swatches` mirrors `new_character_styles`. `new_paragraph_styles`
finally lands per the B5 reviewer flag.

## Tools

### `list_fonts`

Read-only utility. Returns a list of available fonts.

**Input schema:**

```ts
{
  filter?: string;          // case-insensitive substring match on family name
  limit?: number;           // max entries; default 100, max 5000
}
```

**Result:**

```ts
{
  fonts: Array<{
    family: string;
    style: string;          // e.g. "Regular", "Bold", "Italic"
    full_name: string;      // e.g. "Helvetica Bold"
  }>;
  total_matched: number;    // pre-limit total
}
```

No delta emitted (read-only).

**ExtendScript notes:**
- Iterate `app.fonts`. For each font, read `fontFamily`, `fontStyleName`,
  `name` (full name).
- If `filter` provided, lowercase both sides and substring-match against
  `fontFamily`.
- Truncate at `limit`.

### `create_swatch`

Creates a named RGB swatch. Distinct from the auto-`#RRGGBB` swatches
that B3+ tools create implicitly: this one takes a user-chosen name.

**Input schema:**

```ts
{
  name: string;             // 1..60 chars; must not collide with existing swatch
  hex: string;              // "#RRGGBB"
  on_collision?: "error" | "update" | "version";  // default "error"
  document_id?: string;
}
```

**Validation:** hex regex `/^#[0-9A-Fa-f]{6}$/`.

**Result:**

```ts
{
  swatch_name: string;      // final name (may differ from input under "version")
  swatch_id: string;
  on_collision_outcome: "created" | "updated" | "versioned";
}
```

Plus delta:
- `created`/`versioned` → `new_swatches: [{ name }]`
- `updated` → no delta

**ExtendScript notes:**
- `doc.colors.itemByName(name)` lookup, branch on `on_collision`:
  - `error` → throw structured `name_collision`
  - `update` → upsert (create if missing, update RGB if existing); same
    semantics as `define_character_style`'s `"update"`
  - `version` → loop "$name 2", "$name 3"…
- On create, use `ColorSpace.RGB`, `ColorModel.PROCESS`.

### `duplicate_frame`

Duplicates a page item with optional offset.

**Input schema:**

```ts
{
  frame_id: string;
  offset_mm?: { x: number; y: number };   // default { x: 0, y: 0 }
  document_id?: string;
}
```

**Result:**

```ts
{
  source_frame_id: string;
  duplicate_frame_id: string;
  duplicate_type: FrameType;
}
```

Plus delta: `new_frames: [{ id: duplicate_frame_id, type: duplicate_type }]`.

**ExtendScript notes:**
- Pin `MILLIMETERS` in try/finally.
- Resolve via `findFrameById`. Read `frame.parent` (the Spread or
  MasterSpread) — the duplicate goes there.
- Call `frame.duplicate(parent, [offset_mm.x, offset_mm.y])`.
- `duplicate_type` discrimination mirrors `get_page_state` /
  `override_parent_item_on_page` (TextFrame → text, Rectangle with
  graphics → image, Rectangle → rectangle, GraphicLine → line, else
  throw `invalid_args`).

### `find_replace`

Replaces text matches across the active document or within one frame.

**Input schema:**

```ts
{
  find: string;
  replace: string;
  mode?: "literal" | "grep";   // default "literal"
  scope?: "document" | "frame";
  frame_id?: string;            // required when scope === "frame"
  document_id?: string;
}
```

`.refine()`: `scope === "frame"` requires `frame_id`.

**Result:**

```ts
{
  matches_changed: number;
  scope: "document" | "frame";
  mode: "literal" | "grep";
}
```

Plus delta: `changed_frames: []` is left empty — the operation may have
touched many frames, and we don't enumerate them. The `matches_changed`
count is the user-visible signal.

**ExtendScript notes:**
- Reset `app.findGrepPreferences = NothingEnum.NOTHING` and
  `app.changeGrepPreferences = NothingEnum.NOTHING` BEFORE setting
  fields. Reset both AGAIN after the operation completes (in `finally`).
- Set `findWhat` (text) or `findGrep` (regex) based on `mode`.
- Set the corresponding `changeTo` / `changeGrep`.
- Call `target.changeGrep()` (target = `doc` or `frame.parentStory`,
  per `scope`) — wait, `doc.changeGrep()` is for the grep-mode global
  prefs. For literal-mode use `findTextPreferences` / `changeTextPreferences`
  + `doc.changeText()`. The script branches by mode.
- Returned array of changed items has `.length` — return that as
  `matches_changed`.

### `list_paragraph_styles`

Read-only. Lists paragraph styles.

**Input schema:**

```ts
{
  document_id?: string;
}
```

**Result:**

```ts
{
  paragraph_styles: Array<{
    name: string;
    point_size?: number;
    leading_pt?: number;
    color_swatch_name?: string;
  }>;
}
```

Filters out `[No Paragraph Style]` and `[Basic Paragraph]` from the
result (they're internal/default).

**ExtendScript notes:**
- Iterate `doc.paragraphStyles`. Skip entries whose name starts with `[`.
- Read `pointSize`, `leading` (only if it's a number, not the special
  `Leading.AUTO` enum), `fillColor.name`.

### `list_pages`

Read-only. Lists document pages with side and applied parent.

**Input schema:**

```ts
{
  document_id?: string;
}
```

**Result:**

```ts
{
  pages: Array<{
    id: string;
    index: number;             // 0-based
    side: "LEFT_HAND" | "RIGHT_HAND" | "SINGLE_SIDED";
    applied_parent_name: string;   // "[None]" if no parent
    name: string;              // user-visible page name (e.g. "1", "iv")
  }>;
}
```

**ExtendScript notes:**
- Iterate `doc.pages`. For each, read `id`, `String(side)`,
  `appliedMaster.name` (or `"[None]"` if `appliedMaster === null`),
  `name`.

## Refactor #74: `define_paragraph_style` emits `new_paragraph_styles`

Add `on_collision_outcome: "created" | "updated" | "versioned"` to the
existing `define_paragraph_style` result envelope. (Currently it returns
just `{ paragraph_style_name, color_swatch_id? }`.) Handler emits
`new_paragraph_styles: [{ name }]` delta for `created`/`versioned`,
nothing for `updated`. Mirrors `define_character_style`'s shape exactly.

This is a result-shape extension — additive (new optional field on
result) — and a delta emission addition.

## Refactor #75: align `on_collision` vocabulary

Rename `define_paragraph_style`'s `on_collision: "replace"` to
`"update"`. Hard rename (this is internal API; no published callers
outside this repo). Update:
- `src/tools/define-paragraph-style.ts` schema enum + branching code
- `tests/unit/tools/define-paragraph-style.test.ts` test inputs
- `tests/integration/define-paragraph-style.int.test.ts` test inputs
- Any plan/spec docs that mention the old value

After this refactor, both `define_paragraph_style` and
`define_character_style` accept `on_collision: "error" | "update" | "version"`
with `on_collision_outcome: "created" | "updated" | "versioned"` in
their result envelopes.

## Out of scope for B7

- Font installation (DOM doesn't support it).
- Modifying existing swatches (the `update` branch handles RGB updates
  but doesn't expose a "rename" operation).
- Find/replace that targets character styles or attribute-based finds
  (only text-based finds, literal or grep).
- `list_frames_on_page` — `get_page_state` already provides this.
- `list_swatches`, `list_character_styles`, `list_master_spreads` — out
  of scope for now; can be added in a future polish iteration if needed.
- Page renaming, page reordering.

## Test hygiene

Per established pattern: `integrationGate` + `afterEach(closeAllDocuments)`.
Bare-substring `.toContain()` in unit tests. Handlers MUST wrap with
`ok()` for delta emission.

## Success criteria

Plan B7 is complete when:

1. All six tools registered and exposed.
2. Refactors #74 and #75 applied; `define_paragraph_style` and
   `define_character_style` have parallel APIs.
3. Every tool has unit tests + integration tests.
4. End-to-end smoke test: create doc → create_swatch → define
   paragraph & character styles → list_paragraph_styles confirms both
   → create text frame with content → find_replace replaces a word →
   duplicate_frame creates a copy → list_pages confirms the page →
   export PDF.
5. No regression of any earlier tool (B1–B6).

When all five are met, the Iran-rebuild Tier 1+2 requirements are
satisfied and the project enters maintenance mode.
