# InDesign MCP — Design Spec

**Date:** 2026-05-05
**Status:** Approved (brainstorm phase)
**Project location:** `~/Documents/GitHub/indesign-mcp/`

## Goal

Enable Claude to create and design InDesign documents through a stable tool
surface. The user provides reference documents and `DESIGN.md` files as taste
anchors; Claude composes layouts and makes design decisions within those
constraints.

Use cases (in priority order):

1. **Open-ended layout design** — Claude makes typography, hierarchy, and
   layout decisions for documents without pre-existing templates.
2. **Interactive copilot** — user has an InDesign document open; Claude reads
   live state and makes targeted changes on request.

Document scope: single page through ~32 pages in v1; the design must not paint
into a corner for 50+ page long-form docs in a later version.

InDesign 2026 (full UXP support available, but not used in v1).

## Architecture

```
┌──────────────────┐         ┌──────────────────────┐         ┌──────────────────┐
│  Claude          │  MCP    │  indesign-mcp        │  AS-JS  │  InDesign 2026   │
│  (Desktop/Code)  │◄───────►│  server (Node)       │◄───────►│  application     │
│                  │  stdio  │  - tool dispatch     │         │  runs ExtendScript
│                  │         │  - script composer   │         │  via 'do script' │
│                  │         │  - osascript invoke  │         │  ↳ JSON return   │
└──────────────────┘         └──────────────────────┘         └──────────────────┘
```

### Components

1. **`indesign-mcp` server** — Node/TypeScript, stdio MCP server. Exposes the
   tool surface in [§ Tool Surface](#tool-surface). Internally composes
   ExtendScript snippets and dispatches them.

2. **AppleScript transport (v1)** — dispatch via
   `osascript -e 'tell application "Adobe InDesign 2026" to do script "..." language javascript with arguments {...}'`.
   Scripts write JSON results to a temp file, which the server reads back.
   No plugin in InDesign.

3. **Brand-context loader** — DESIGN.md and reference docs are loaded by
   Claude through the host's filesystem access, not by the MCP server. The
   server stays narrowly scoped to InDesign operations.

### Out of scope for v1

- UXP plugin
- WebSocket / live event stream
- InDesign UI panel showing Claude's actions
- Multi-document concurrency, multi-session locking
- Cross-version compatibility (locked to InDesign 2026)

## Tool Surface

The tool surface is the durable contract — it survives the v1→v2 transport
swap. Granularity is deliberately at the level of layout primitives, not
mega-tools. Composition is Claude's job; the server provides the building
blocks.

### Document lifecycle

- `create_document` — page size, orientation, margins, columns, facing-pages,
  intent (print/digital)
- `open_document` — by path
- `save_document` / `save_as` / `export_pdf`
- `close_document`

### State reading

- `get_document_summary` — pages, spreads, defined styles, swatches, fonts in
  use, master pages
- `get_page_state` — for a given page: frames with id/type/bounds/style/
  text-snippet/image-link
- `get_frame` — full detail on one frame (text content, applied styles,
  fitting options, stroke/fill)
- `list_styles` — paragraph, character, object styles with their key
  attributes
- `list_swatches` — colours and tints

### Layout primitives

- `create_text_frame` — bounds, columns, inset, optional initial text
- `create_image_frame` — bounds, fitting mode, optional file path
- `create_rectangle` / `create_line` — for rules, blocks, decorative shapes
- `set_frame_bounds` / `set_frame_rotation` — geometry
- `delete_frame`
- `link_text_frames` — thread two text frames together

### Typography & content

- `set_text` — replace text in a frame, with optional inline style ranges
- `apply_paragraph_style` / `apply_character_style` — by name, to a frame or
  text range
- `set_text_attributes` — direct overrides (font, size, leading, tracking) for
  inline tweaks
- `define_paragraph_style` — create a new style from attributes
- `place_image` — into an existing frame, with fit mode

### Page & master management

- `add_page` / `delete_page` / `move_page`
- `apply_master_to_page`
- `define_master_page` — create master with frames, page-numbering markers
- `set_page_number_style`

### Cross-cutting tool conventions

- **Uniform return shape:**

  ```ts
  {
    ok: boolean,
    result?: {...},                 // tool-specific payload on success
    error?: { kind, message, ...},  // present when ok === false
    document_state_delta?: {        // present on mutating tools
      changed_frames: Array<{id, bounds, style}>,
      new_frames: Array<{id, ...}>,
      removed_frame_ids: string[],
      page_count: number,
    },
    warnings?: string[],
  }
  ```

- **Stable IDs.** Every frame and style receives InDesign's internal `id` on
  creation. Claude refers to objects by id thereafter — never by positional
  reference.

## Data Flow & State Model

### Typical interaction (end to end)

1. User asks Claude to lay out a 2-page case-study spread using a brand
   defined in `DESIGN.md`.
2. Claude reads `DESIGN.md` and reference docs via the host filesystem.
3. Claude calls `create_document`. MCP server composes ExtendScript →
   `osascript` runs it → InDesign creates doc → script writes JSON
   `{ok:true, document_id:..., page_ids:[...]}` to a temp file → server reads
   and returns.
4. Claude calls `define_paragraph_style` for each style implied by the brand.
5. Claude calls `create_text_frame`, `set_text`, `apply_paragraph_style` per
   element.
6. Claude calls `get_page_state` to verify the result and adjusts as needed.
7. Claude calls `save_document` and `export_pdf`.

### State principles

1. **The document is the source of truth.** The MCP server holds no
   persistent document state between calls. Every tool call composes a fresh
   ExtendScript that re-resolves IDs against the live document. If the user
   edits in InDesign while Claude works, the next state read sees reality.

2. **Stable IDs, not positions.** Tools accept and return InDesign's internal
   IDs. No "the third text frame on page 2" addressing — that breaks the
   moment something is moved.

3. **Document-state-delta on every mutating call.** Mutating tools return a
   small delta describing what changed. Claude maintains a lightweight mental
   model from these deltas and only re-reads full state (`get_document_summary`,
   `get_page_state`) when confidence is broken (e.g., after the user has been
   editing manually).

### Brand-context loading

DESIGN.md and reference materials are read by Claude through its host
filesystem access. The MCP server is not involved. Rationale: the host
already has filesystem capability; duplicating it inside the server adds
surface area without value.

### Concurrency

v1 assumes one running InDesign instance and a frontmost document. Tools
target the active document or take an explicit `document_id`. No locking. If
two Claude sessions drive InDesign simultaneously they will collide; this is
acceptable for v1.

## Error Handling

### Failure modes

| Frequency | Mode | Surface |
|-----------|------|---------|
| Common | ExtendScript runtime error (typo, bad ref, type mismatch) | Script catches, writes `{ok:false, error:{kind:"script_error", message, stack}}` |
| Common | Reference resolution (missing frame_id / style name) | `kind:"not_found", entity, id` |
| Occasional | InDesign not running / wrong version | `kind:"app_not_available"` |
| Occasional | Style/swatch name collision | `kind:"name_collision"`. Tools take `on_collision: "error" \| "replace" \| "version"`, default `"error"` |
| Rare | Disk / permission failure (save, place_image) | `kind:"io_error"` |
| Rare | Script timeout (30s per call) | `kind:"timeout"` — server kills `osascript` subprocess |
| Always validated | Invalid args (schema mismatch) | `kind:"invalid_args"` — caught in server before dispatch |

### Error contract

- Closed set of `kind` values: `script_error | app_not_available | not_found |
  name_collision | io_error | timeout | invalid_args`. Claude can switch on
  these.
- Errors pass through to Claude unmodified — the server doesn't try to
  recover or retry. Claude's error reasoning is better than anything the
  server could automate.

### Logging

The server writes a rotating log to `~/Library/Logs/indesign-mcp/server.log`
covering every tool call, the composed ExtendScript, and the raw return.
Critical for diagnosing "Claude says it created a frame but the frame isn't
there"-style issues.

## Testing Strategy

Scaled to v1 (POC, not production-hardened).

- **Unit tests** for the script-composition layer. Pure functions: input
  args → ExtendScript string. Snapshot tests are appropriate here.
- **Integration tests** that drive InDesign. Each test opens a known fixture
  `.indd`, runs a tool, asserts on returned state, closes without saving.
  Slow — kept thin: happy-path coverage on each tool family plus 1–2
  representative error paths per family.
- **Manual smoke-test list** documented in the repo. Run before each
  meaningful change. Cheaper than full integration coverage.
- **No mocked InDesign DOM.** Mocked tests for ExtendScript-driven tools
  confidently pass while reality is broken. Real InDesign or nothing.

Not tested in v1: long-form behaviour (50+ pages), concurrent sessions,
cross-version.

## POC Scope

### What the POC is for

The POC's job is to falsify three hypotheses, not to ship a finished product:

1. **Latency hypothesis** — `osascript` round-trips are 200–500ms per call,
   fast enough to feel usable. If they're consistently 2s+, the transport
   choice is wrong.
2. **Tool-surface hypothesis** — the primitives in [§ Tool Surface](#tool-surface)
   let Claude produce a competent layout from a `DESIGN.md` and a brief. If
   Claude flails because the tools are too low-level, higher-level helpers
   are needed before extending coverage.
3. **Maintainability hypothesis** — ExtendScript composition stays readable
   as the tool count grows. If it becomes a snake pit at 10 tools, the
   pattern needs to change before reaching 30.

### POC tool subset (~10 tools)

- `create_document`
- `get_document_summary`
- `get_page_state`
- `create_text_frame`
- `set_text`
- `apply_paragraph_style`
- `create_image_frame`
- `place_image`
- `define_paragraph_style`
- `add_page`
- `save_document`
- `export_pdf`

This subset spans every category (create, read, mutate, content, save) so it
stresses the full architecture without being fully featured.

### POC non-goals

- Master pages (added in v1.1 once POC clears)
- Threaded text frames (v1.1)
- Character styles, only paragraph (v1.1)
- Object styles, swatches API (v1.2)
- Undo grouping (v2)

### POC success test

Ask Claude to produce a 2-page case-study spread from a `DESIGN.md` and
~200 words of body content. If the result is recognisable as that brand and
roughly publication-quality, the POC passes. If it's a mess of mismatched
type and flailing layout, the tool surface is wrong — iterate before
extending coverage.

## v1 → v2 Evolution

The transport-upgrade trigger criteria. Stay on v1 until at least one fires.

- **Latency floor.** Multi-call layouts take 30+ seconds with most of the
  time in `osascript` overhead. UXP's WebSocket recovers most of this.
- **Push events.** Need to react to in-app events (e.g., "user clicked a
  frame, tell Claude what they selected"). AppleScript can't do this.
- **In-app UI panel.** Want to display "Claude is doing X" status, expose an
  "undo this batch" button, etc.
- **Capability ceiling.** Some operation the `do script` bridge can't reach
  but UXP can.

If none of the above fire, **stay on v1**. The transport upgrade is genuine
throwaway work.

### What v2 adds

- UXP plugin in InDesign hosting a local WebSocket server (e.g.
  `ws://127.0.0.1:7654`)
- MCP server reconfigured to dispatch via WebSocket
- **Same tool surface** — Claude doesn't notice the swap
- Plus: undo grouping, push events, optional UI panel
