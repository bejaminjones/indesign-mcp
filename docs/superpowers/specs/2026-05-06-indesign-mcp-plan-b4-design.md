# InDesign MCP — Plan B4 Design Spec (Parent Pages & Page Numbers)

**Date:** 2026-05-06
**Status:** Approved (autonomous-execution iteration)
**Parent specs:**
- `docs/superpowers/specs/2026-05-05-indesign-mcp-design.md`
- `docs/superpowers/specs/2026-05-06-indesign-mcp-plan-b3-design.md`
**Project location:** `~/Documents/GitHub/indesign-mcp/`

## Goal

Plan B4 ships parent-page (master) lifecycle tools and the page-number marker
needed to author multi-page documents with shared chrome (running heads,
folios, page numbers). End-state: B1+B2+B3+B4 covers Tier 1 of the Iran-rebuild
requirements except inline character styling (Plan B5).

Four tools plus one bug fix:
- `create_parent_page` — create a master spread with a base name
- `apply_parent_to_page` — apply a parent (by name) to a document page
- `override_parent_item_on_page` — override a parent item onto a doc page so
  it can be edited locally
- `insert_page_number_marker` — insert `SpecialCharacters.AUTO_PAGE_NUMBER`
  into an existing text frame
- Bug fix: facing-page margin mirroring + per-page propagation in
  `create_document`

## DOM-grounded facts (verified live in InDesign 2026, 21.3.0.60)

These were confirmed empirically before writing the spec; they pin the
implementation decisions.

1. **DOM terminology:** `Document.masterSpreads`, `Page.appliedMaster`,
   constructor name `MasterSpread` — all unchanged from CS6. The user-facing UI
   calls them "parent pages"; the scripting DOM did not rename. External tool
   names use `parent_*` for LLM clarity; the script body uses `masterSpreads` /
   `appliedMaster`.
2. **Page-number marker:** `SpecialCharacters.AUTO_PAGE_NUMBER` exists and is a
   numeric character constant. Insertion via
   `frame.parentStory.insertionPoints[0].contents = SpecialCharacters.AUTO_PAGE_NUMBER`.
3. **Margins & facing pages:** `Page.marginPreferences.left` stores the raw
   left value regardless of `page.side`. InDesign does **not** auto-mirror.
   When facing pages is on and the user provided `inside`/`outside`:
   - `RIGHT_HAND` page: `left = inside`, `right = outside`
   - `LEFT_HAND` page: `left = outside`, `right = inside`
4. **Doc-level margin propagation:** Setting `doc.marginPreferences` after
   pages exist does NOT update those existing pages — it only seeds future
   pages. Fix: iterate `doc.pages` and set each page's `marginPreferences`
   after document creation.

## Type extensions

`src/types.ts` — extend `DocumentStateDelta`:

```ts
export interface DocumentStateDelta {
  changed_frames?: Array<{
    id: FrameId;
    bounds?: [number, number, number, number];
    applied_paragraph_style?: string;
    applied_image_path?: string;
    applied_parent_name?: string;        // NEW (from override_parent_item_on_page)
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

Rationale for `changed_pages` vs reusing `changed_frames`: parent-application
is a page-level operation, not a frame operation. Frames don't have IDs that
correspond to applied parents. A page-level slot keeps the model coherent.

## Tools

### `create_parent_page`

Creates a master spread (parent page) in the active document.

**Input schema:**

```ts
{
  base_name: string;          // user-visible label, e.g. "Body" → "A-Body"
  name_prefix?: string;       // single character, defaults to next free letter
  facing?: boolean;           // 1 page (false) or 2 pages (true). Default: matches doc.documentPreferences.facingPages.
  document_id?: string;
}
```

**Validation rules:**
- `base_name` non-empty, ≤ 60 chars (InDesign hard-cap is unclear; 60 is generous).
- `name_prefix` if provided: exactly 1 character, A-Z (matches InDesign convention).

**Result:**

```ts
{
  parent_name: string;        // full name as stored, e.g. "A-Body"
  page_ids: string[];         // 1 or 2 page IDs (the master spread's pages)
}
```

Plus delta: `new_parent_spreads: [{ name, page_count }]`.

**ExtendScript notes:**
- `doc.masterSpreads.add({ baseName: ${lit(base_name)}, namePrefix: ${lit(name_prefix ?? "auto")} })`
  — but `namePrefix: "auto"` isn't a real signal; need to either omit
  `namePrefix` (lets InDesign auto-pick) or pass an explicit single letter.
  Implementation: pass only the properties present in input.
- `facing` controls how many pages the master spread has. When the doc has
  `facingPages = false`, master spreads still default to 1 page. When `true`,
  default 2 pages. Override via `MasterSpread.pageCount` or by setting
  `pages` on the spread post-creation. Empirical detail to verify during
  implementation.

### `apply_parent_to_page`

Applies a named parent (master spread) to a document page.

**Input schema:**

```ts
{
  page_id: string;
  parent_name: string;        // matches the full stored name, e.g. "A-Body"
  document_id?: string;
}
```

**Validation:**
- Both fields required, non-empty.

**Result:**

```ts
{
  page_id: string;
  parent_name: string;
}
```

Plus delta: `changed_pages: [{ id: page_id, applied_parent_name: parent_name }]`.

**ExtendScript notes:**
- `findPageById` (existing), then locate the master via
  `doc.masterSpreads.itemByName(parent_name)`. If `!isValid`, throw structured
  `not_found` for entity `"parent_spread"`.
- Apply: `page.appliedMaster = master`.

**New helper in `script-helpers.ts`:** `findMasterSpreadByName` (mirrors the
existing `findStyleByName` pattern, throws structured `not_found`).

### `override_parent_item_on_page`

Overrides a parent item onto a target document page so it becomes locally
editable. Returns the new local frame's id.

**Input schema:**

```ts
{
  page_id: string;            // target document page
  parent_item_id: string;     // id of the item on the parent spread
  document_id?: string;
}
```

**Result:**

```ts
{
  page_id: string;
  source_parent_item_id: string;
  overridden_frame_id: string;
}
```

Plus delta:
- `new_frames: [{ id: overridden_frame_id, type: <inferred> }]`
- `changed_frames: [{ id: overridden_frame_id, applied_parent_name: <name> }]`

The `type` field comes from the same `constructor.name` discrimination
`get_page_state` already uses.

**ExtendScript notes:**
- Resolve parent item via `findFrameById(doc, parent_item_id)` — this works
  because parent-spread items are still `pageItems` reachable from the doc
  scope.
- Override: `var local = parentItem.override(targetPage);` — returns the new
  local PageItem. Wire that back as `overridden_frame_id`.
- If `parent_item_id` exists but isn't on a master spread (i.e. it's already a
  local item), throw `validation_error` with message indicating mismatch.

### `insert_page_number_marker`

Inserts the auto-page-number special character at the current end of a text
frame's content.

**Input schema:**

```ts
{
  frame_id: string;
  position?: "start" | "end";   // default "end"
  document_id?: string;
}
```

**Validation:**
- `frame_id` required.

**Result:**

```ts
{
  frame_id: string;
  inserted_at: "start" | "end";
}
```

Plus delta: `changed_frames: [{ id: frame_id }]` (text changed; we don't have
a "text content changed" flag, but the bare entry signals "this frame's state
changed").

**ExtendScript notes:**
- Locate frame via `findFrameById`. If not a `TextFrame`, throw
  `validation_error`.
- Insert at `frame.parentStory.insertionPoints[0]` (start) or
  `frame.parentStory.insertionPoints[-1]` (end) — assign
  `.contents = SpecialCharacters.AUTO_PAGE_NUMBER`.
- The marker auto-renders as the current page number when the frame is on a
  document page (or the current document page when on a parent).

## Bug fix: facing-page margin mirroring + per-page propagation in `create_document`

**Problem:** Currently `create_document` sets margins on `doc.marginPreferences`,
but those values don't propagate to pages that already exist (default A4
single-page docs are created with the *default* 12.7mm margins, then the
caller's margins are written to the doc but ignored by existing pages). And
even when set per-page, facing-page mirroring is NOT automatic — `left` stores
the raw value regardless of `page.side`.

**Fix in `src/tools/create-document.ts`:**

1. **Always set margins per-page after creation.** Iterate `doc.pages` and
   write `top, bottom, left, right` to each `page.marginPreferences`.

2. **Mirror for facing pages.** When `facingPages = true` and input was
   facing-style margins (`inside`/`outside`):
   ```js
   for (var i = 0; i < doc.pages.length; i++) {
     var p = doc.pages[i];
     p.marginPreferences.top = top;
     p.marginPreferences.bottom = bottom;
     if (String(p.side) === "LEFT_HAND") {
       p.marginPreferences.left = outside;
       p.marginPreferences.right = inside;
     } else {
       p.marginPreferences.left = inside;
       p.marginPreferences.right = outside;
     }
   }
   ```

3. **Drop the misleading warning.** Once #1 and #2 land, the existing
   "verso pages will be mirrored incorrectly" warning is wrong-and-obsolete.
   Remove it; rely on tests to verify correctness.

4. **Set columns per-page too.** Same propagation issue for column count and
   gutter — write to each `page.marginPreferences`.

## Helper additions

`src/script-helpers.ts`:

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

(This mirrors `findStyleByName`'s pattern.)

## Tool implementation pattern

Same as B3: Zod input → `ScriptResultSchema` → `buildScriptBody` with
`prelude(...)` + `lit(...)` → `runScriptWithResultFile<TScriptResult>` with
`resultSchema` → handler post-processes into `Envelope<TResult>`.

## Out of scope for B4

- Removing/detaching parent items from doc pages (the inverse of
  `override_parent_item_on_page`).
- Page-number style customisation (e.g. roman numerals via `pageNumberStyle`).
  Defer to B7.
- Section markers / `insert_section_marker`.
- Modifying parent-page geometry after creation (use the existing
  create_text_frame, create_rectangle etc on the parent's pages by id).
- Renaming parent spreads.
- Reordering master spreads in the panel.

## Test hygiene

Per B1/B2/B3 pattern: each integration test wraps in `integrationGate`,
`afterEach(closeAllDocuments)`. Tests build on B1 tools to set up state.

## Success criteria

Plan B4 is complete when:

1. All four tools registered and exposed via the MCP server.
2. `create_document` produces a 2-page facing doc with `inside=30, outside=10`
   and pages 0 and 1 have *correctly mirrored* margins (verified in
   integration test).
3. Every tool has unit tests covering schema, dispatch, success, failure paths.
4. Every tool has an integration test that runs against InDesign 2026.
5. End-to-end: a smoke-test integration scenario that creates a parent page
   with a footer text frame containing a page-number marker, applies the
   parent to all document pages, exports a PDF, and asserts non-zero on disk.
6. Live verification through Claude Desktop with a realistic prompt.

When all six are met, Plan B5 (inline character styling) becomes the next
planning step.
