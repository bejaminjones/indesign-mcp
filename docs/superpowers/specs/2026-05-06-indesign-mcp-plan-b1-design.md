# InDesign MCP — Plan B1 Design Spec (Document Lifecycle)

**Date:** 2026-05-06
**Status:** Approved (brainstorm phase)
**Parent spec:** `docs/superpowers/specs/2026-05-05-indesign-mcp-design.md`
**Project location:** `~/Documents/GitHub/indesign-mcp/`

## Goal

Plan B1 is the first sub-plan of Plan B (POC tool surface). It ships four tools that together let Claude create a multi-page InDesign document, save it, and export to PDF — the foundation that B2 (text composition) and B3 (images + final POC) build on.

End-state demonstrable: *"make me a 4-page A4 document with 12mm margins and 2 columns, save it, and export to PDF."*

The four tools introduce the project's first **mutating tools** — Plan A's only tool was read-only. They establish the patterns subsequent tools follow:

- A schema-validated input via Zod
- Wrap a hand-rolled ExtendScript body with `wrapExtendScript`
- Dispatch via `runScriptWithResultFile<TResult>`
- Return an `Envelope<TResult>` with `document_state_delta`

## Tools

### `create_document`

Creates a new InDesign document and makes it active.

**Input schema:**

```ts
{
  preset?: "A4" | "Letter" | "Legal" | "Tabloid";
  width_mm?: number;        // mutually exclusive with preset
  height_mm?: number;       // mutually exclusive with preset
  orientation?: "portrait" | "landscape";  // default "portrait"
  pages?: number;           // default 1, integer ≥ 1
  facing_pages?: boolean;   // default false
  margins_mm:
    | { top: number; bottom: number; left: number; right: number }
    | { top: number; bottom: number; inside: number; outside: number };
  columns?: { count: number; gutter_mm: number };  // default { count: 1, gutter_mm: 0 }
}
```

**Validation rules:**
- Exactly one of `preset` or (`width_mm` + `height_mm`) must be provided. Both → `invalid_args`. Neither → `invalid_args`.
- `inside`/`outside` margin shape requires `facing_pages: true`. Otherwise → `invalid_args`.
- `pages` must be an integer ≥ 1.
- All `_mm` fields must be ≥ 0.

**Orientation rule:**
- With `preset`: `orientation` swaps the preset's dimensions if needed. Default `portrait` (height > width).
- With explicit `width_mm` + `height_mm`: if `orientation` is provided, ensure the larger dimension matches (portrait → height ≥ width, landscape → width ≥ height); swap if not. If `orientation` is omitted, use the supplied dimensions as-is.

**Result:**

```ts
{
  document_id: string;
  page_ids: string[];        // length === pages
}
```

Plus `document_state_delta`:

```ts
{
  page_count: number,
  new_page_ids: string[],    // same as result.page_ids
}
```

**Preset dimensions** (mm):

| Preset | Width | Height |
|--------|-------|--------|
| A4 | 210 | 297 |
| Letter | 215.9 | 279.4 |
| Legal | 215.9 | 355.6 |
| Tabloid | 279.4 | 431.8 |

Orientation `landscape` swaps the two.

**ExtendScript notes:**
InDesign's measurement units are configurable per document. The script sets the active document's measurement units to `MeasurementUnits.MILLIMETERS` for the duration of the call so the input mm values map directly. Margin and column setup uses `documentPreferences.documentBleedTopOffset` etc. for completeness only — Plan B1 does not expose bleed/slug.

### `add_page`

Adds a single page to a document.

**Input schema:**

```ts
{
  at?: "end" | "start"
     | { after_page_id: string }
     | { before_page_id: string };  // default "end"
  document_id?: string;             // default: active document
}
```

**Result:**

```ts
{
  new_page_id: string;
  position_index: number;  // 0-based index of the new page in document.pages
}
```

Plus `document_state_delta`:

```ts
{
  page_count: number,        // post-insert count
  new_page_ids: [new_page_id],
}
```

**Validation rules:**
- `after_page_id` / `before_page_id` must reference an existing page in the target document.

### `save_document`

Saves the document to disk.

**Input schema:**

```ts
{
  path?: string;          // when omitted: save to current path
  document_id?: string;   // default: active document
}
```

**Result:**

```ts
{
  path: string;  // absolute path the document was saved to
}
```

No `document_state_delta` (no document-content change).

**Behaviour:**
- If `path` is provided: save-as.
- If `path` is omitted: save to the document's current path. Returns `io_error` if the document has never been saved (no path set).
- Path normalised to absolute via `path.resolve()` server-side before passing to ExtendScript.

### `export_pdf`

Exports the document to a PDF file.

**Input schema:**

```ts
{
  path: string;           // required
  document_id?: string;   // default: active document
}
```

**Result:**

```ts
{
  path: string;          // absolute path of the exported PDF
  page_count: number;    // pages exported
}
```

No `document_state_delta`.

**Behaviour:**
- Uses InDesign's default PDF export preset (`[High Quality Print]`).
- Exports all pages.
- Path normalised to absolute server-side.
- Preset choice and page-range selection are deferred — add when a B2/B3 tool needs them.

## Type extensions

`DocumentStateDelta` (in `src/types.ts`) gains two optional fields:

```ts
export interface DocumentStateDelta {
  changed_frames?: Array<{ id: FrameId; bounds?: [number, number, number, number] }>;
  new_frames?: Array<{ id: FrameId; type: string }>;
  removed_frame_ids?: FrameId[];
  new_page_ids?: string[];          // NEW
  removed_page_ids?: string[];      // NEW
  page_count?: number;
}
```

The `EnvelopeSchema` in `src/transport/result-file.ts` doesn't validate the delta's shape (`document_state_delta: z.unknown().optional()`), so no schema change is needed there.

## Active-document semantics

When `document_id` is omitted, tools target `app.activeDocument` (InDesign's frontmost document). If no document is open or the named id doesn't exist, return:

```ts
{ ok: false, error: { kind: "not_found", entity: "document", id: "..." } }
```

This is the existing `not_found` error kind from Plan A's closed set — no `ErrorKind` change needed.

## Test hygiene

Plan A.5 deferred per-test isolation. Plan B1 establishes the pattern.

Add to `tests/integration/helpers.ts`:

```ts
export async function closeAllDocuments(): Promise<void>
```

This invokes a small ExtendScript that closes every open document without saving. Used in `afterEach` of integration tests so each test starts with a clean InDesign state.

Unit tests continue to mock `runScriptWithResultFile` — no real InDesign involved.

## Out of scope for Plan B1

- Master pages (deferred to a later plan or B-iteration)
- Bleed / slug
- Document intent (print/web/digital publishing) — defaults to print
- Page direction (LTR/RTL)
- Custom PDF export presets
- PDF page ranges
- `open_document`, `close_document`, `save_as` — Plan B1 ships only the minimum lifecycle for the case study POC
- `delete_page`, `move_page` — deferred

## Tool implementation pattern (for the plan to follow)

Each tool's source file at `src/tools/<name>.ts` follows the get-app-version template established in Plan A:

1. Zod input schema as a top-level `const`.
2. `Result` interface declaring the return shape.
3. `SCRIPT_BODY` constant with the ExtendScript (uses InDesign DOM, returns a JSON-serialisable object). The body may be a function returning a string when arg-substitution is needed (e.g., page sizes from a preset table).
4. Handler exported via `defineTool<Input, Result>`.
5. Server registration in `src/index.ts`.

Each tool's tests at `tests/unit/tools/<name>.test.ts`:

- 1 metadata test
- 1+ schema-validation tests (rejecting invalid inputs)
- 1+ dispatch tests (verifying the script body and language)
- 1 success-envelope-propagation test
- 1 failure-envelope-propagation test
- (Optional) tests covering specific argument transformations (e.g., preset → dimensions)

Each tool's integration test at `tests/integration/<name>.int.test.ts`:

- Gated via `integrationGate` (existing helper)
- Uses `closeAllDocuments()` in `afterEach`
- Calls the handler directly (not via MCP transport) to verify end-to-end against running InDesign

## Success criteria

Plan B1 is complete when:

1. All four tools registered and exposed via the MCP server.
2. Every tool has unit tests (mocked transport) covering schema, dispatch, success, and failure paths.
3. Every tool has an integration test that runs against InDesign 2026 and is verified manually by running `npm run test:integration` with InDesign open.
4. End-to-end: `node -e 'import("./dist/index.js")...'` smoke-test sequence — `create_document` → `add_page` × 3 → `save_document` → `export_pdf` — produces a valid 4-page A4 PDF on disk.
5. The `closeAllDocuments()` helper is in place and `afterEach`-installed for the integration suite.

When all five are met, Plan B2 (text composition) becomes the next planning step.
