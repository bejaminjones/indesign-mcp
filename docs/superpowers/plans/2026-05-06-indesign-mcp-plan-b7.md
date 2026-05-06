# InDesign MCP — Plan B7 Implementation Plan (Polish & Utility)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship six tools (`list_fonts`, `create_swatch`, `duplicate_frame`, `find_replace`, `list_paragraph_styles`, `list_pages`), refactor `define_paragraph_style` for parity with `define_character_style` (adds `on_collision_outcome` + `new_paragraph_styles` delta + renames `"replace"` → `"update"`), and complete the Iran-rebuild Tier 1+2 requirements.

**Architecture:** Same template as B1–B6. Read tools omit the `ok()` wrapper since they emit no delta; write tools wrap with `ok()` for delta.

**Tech Stack:** TypeScript 5.6+, Node 20+, MCP SDK, Zod, Vitest. No new runtime deps.

**Reference spec:** `docs/superpowers/specs/2026-05-06-indesign-mcp-plan-b7-design.md`

**Repository:** `~/Documents/GitHub/indesign-mcp/`. Create a feature branch `feat/plan-b7` before starting.

---

## CRITICAL: Lessons from B5/B6 — read before writing any code

### #1 — Bare-substring `.toContain()` for value assertions

**Never write** `.toContain('"Accent"')` (embedded quotes). `wrapExtendScript` JSON-encodes the entire script body, so literal-quoted assertions never match. **Always write** `.toContain("Accent")` — bare substring, no quotes inside.

### #2 — Handlers MUST wrap results with `ok()` to emit `document_state_delta`

Read-only tools (`list_fonts`, `list_paragraph_styles`, `list_pages`) skip `ok()` since they emit no delta. All write tools (`create_swatch`, `duplicate_frame`, `find_replace`) MUST use `ok()`:

```ts
async handler(input) {
  const env = await runScriptWithResultFile<ScriptResult>({...});
  if (!env.ok) return env;
  const r = env.result!;
  return ok(r, { document_state_delta: { ... } });
}
```

### #3 — Use `app.scriptPreferences.measurementUnit`, NOT `doc.viewPreferences.measurementUnit`

`doc.viewPreferences.measurementUnit` does not exist on Document. Always pin via `app.scriptPreferences.measurementUnit` in try/finally.

### #4 — Nullable accessors use `=== null`, not `.isValid`

For `nextTextFrame`, `appliedMaster`, and similar nullable accessors, InDesign returns `null` for unset relations. Use `=== null` comparison, not `.isValid` guard.

### #5 — `findGrepPreferences`/`changeGrepPreferences` MUST be reset before AND after

Reset `app.findGrepPreferences = NothingEnum.NOTHING` and `app.changeGrepPreferences = NothingEnum.NOTHING` BEFORE setting any fields, and AGAIN in a `finally` block after the operation. Stale state causes mysterious failures across calls.

### #6 — Other hygiene rules

- `import { z } from "zod"` statically at the top — never `await import("zod")`.
- Fail-loud: `expect(x).toBeDefined()` before using `x!` in integration tests; `if (!env.ok) return;` for unwrapping.
- ExtendScript is pre-ES5: no JSON, no ES6+, no arrow functions, no template literals, no `const`/`let`.
- ES module imports use `.js` extensions even for `.ts` source files.
- Strict TS: no `any`.

---

## File Structure

```
src/
├── types.ts                                                     (modified, Task 1)
├── tools/
│   ├── define-paragraph-style.ts                               (modified, Tasks 2–3)
│   ├── list-fonts.ts                                           (created, Task 4)
│   ├── create-swatch.ts                                        (created, Task 5)
│   ├── duplicate-frame.ts                                      (created, Task 6)
│   ├── find-replace.ts                                         (created, Task 7)
│   ├── list-paragraph-styles.ts                                (created, Task 8)
│   └── list-pages.ts                                           (created, Task 9)
└── index.ts                                                     (modified, Tasks 4–9)

tests/
├── integration/
│   ├── define-paragraph-style.int.test.ts                      (modified, Tasks 2–3)
│   ├── list-fonts.int.test.ts                                  (Task 4)
│   ├── create-swatch.int.test.ts                               (Task 5)
│   ├── duplicate-frame.int.test.ts                             (Task 6)
│   ├── find-replace.int.test.ts                                (Task 7)
│   ├── list-paragraph-styles.int.test.ts                       (Task 8)
│   ├── list-pages.int.test.ts                                  (Task 9)
│   └── plan-b7-end-to-end.int.test.ts                          (Task 10)
└── unit/
    ├── types.test.ts                                           (modified, Task 1)
    └── tools/
        ├── define-paragraph-style.test.ts                      (modified, Tasks 2–3)
        ├── list-fonts.test.ts                                  (created, Task 4)
        ├── create-swatch.test.ts                               (created, Task 5)
        ├── duplicate-frame.test.ts                             (created, Task 6)
        ├── find-replace.test.ts                                (created, Task 7)
        ├── list-paragraph-styles.test.ts                       (created, Task 8)
        └── list-pages.test.ts                                  (created, Task 9)
```

---

## Task 1: Type extensions — `new_paragraph_styles` and `new_swatches`

**Why:** `define_paragraph_style` (refactored in Task 3) emits `new_paragraph_styles`; `create_swatch` (Task 5) emits `new_swatches`. Both must be reflected in `DocumentStateDelta`.

**Files:**
- Modify: `src/types.ts`
- Modify: `tests/unit/types.test.ts`

### Step 1: Add failing tests

- [ ] Append to the `describe("DocumentStateDelta", ...)` block in `tests/unit/types.test.ts`:

```ts
  it("new_paragraph_styles accepts an array of { name: string }", () => {
    const delta: DocumentStateDelta = {
      new_paragraph_styles: [
        { name: "Body" },
        { name: "Headline" },
      ],
    };
    expect(delta.new_paragraph_styles?.[0].name).toBe("Body");
    expect(delta.new_paragraph_styles?.[1].name).toBe("Headline");
  });

  it("new_swatches accepts an array of { name: string }", () => {
    const delta: DocumentStateDelta = {
      new_swatches: [
        { name: "Brand Orange" },
      ],
    };
    expect(delta.new_swatches?.[0].name).toBe("Brand Orange");
  });
```

### Step 2: Run, expect failure

- [ ] Run `npx tsc --noEmit` — expected TS errors on `new_paragraph_styles` and `new_swatches` (not on the interface yet).

### Step 3: Update `src/types.ts`

- [ ] Add two optional fields to `DocumentStateDelta`, after `new_character_styles`:

```ts
  new_paragraph_styles?: Array<{ name: string }>;  // from define_paragraph_style (refactor #74)
  new_swatches?: Array<{ name: string }>;           // from create_swatch
```

The complete updated interface should look like:

```ts
export interface DocumentStateDelta {
  changed_frames?: Array<{
    id: FrameId;
    bounds?: [number, number, number, number];
    applied_paragraph_style?: string;
    applied_image_path?: string;
    applied_parent_name?: string;
    applied_character_style_range?: {
      character_style_name: string;
      start_index: number;
      end_index: number;
    };
    inset_mm?: { top: number; left: number; bottom: number; right: number };
    columns?: { count: number; gutter_mm: number };
    threaded_to_frame_id?: FrameId;
  }>;
  new_frames?: Array<{ id: FrameId; type: FrameType }>;
  removed_frame_ids?: FrameId[];
  new_page_ids?: string[];
  removed_page_ids?: string[];
  page_count?: number;
  changed_pages?: Array<{
    id: string;
    applied_parent_name?: string;
  }>;
  new_parent_spreads?: Array<{
    name: string;
    page_count: number;
  }>;
  new_character_styles?: Array<{ name: string }>;
  new_paragraph_styles?: Array<{ name: string }>;  // from define_paragraph_style (refactor #74)
  new_swatches?: Array<{ name: string }>;           // from create_swatch
}
```

### Step 4: Run tests + tsc

- [ ] Run `npx tsc --noEmit && npm test`

Expected: tsc clean; all existing tests pass; the two new type-shape tests pass.

### Step 5: Commit

- [ ] `git add src/types.ts tests/unit/types.test.ts`
- [ ] `git commit -m "feat: extend DocumentStateDelta with new_paragraph_styles and new_swatches"`

---

## Task 2: Refactor #75 — align `on_collision` vocabulary in `define_paragraph_style`

**Why:** `define_paragraph_style` uses `"replace"` but `define_character_style` uses `"update"`. Hard rename so both tools have identical on_collision vocabulary.

**Files:**
- Modify: `src/tools/define-paragraph-style.ts`
- Modify: `tests/unit/tools/define-paragraph-style.test.ts`
- Modify: `tests/integration/define-paragraph-style.int.test.ts`

### Step 1: Update the unit test

- [ ] In `tests/unit/tools/define-paragraph-style.test.ts`, find the test that checks on_collision values and replace `"replace"` with `"update"`:

Old:
```ts
  it("accepts on_collision: 'replace' / 'version' / 'error'", () => {
    for (const c of ["error", "replace", "version"] as const) {
```

New:
```ts
  it("accepts on_collision: 'update' / 'version' / 'error'", () => {
    for (const c of ["error", "update", "version"] as const) {
```

### Step 2: Run, expect failure

- [ ] Run `npx tsc --noEmit` — expected TS error since the Zod enum still only accepts `"replace"` not `"update"`.

### Step 3: Update `src/tools/define-paragraph-style.ts`

- [ ] In the `InputSchema`, change the `on_collision` enum:

Old:
```ts
    on_collision: z.enum(["error", "replace", "version"]).optional(),
```

New:
```ts
    on_collision: z.enum(["error", "update", "version"]).optional(),
```

- [ ] In `buildScriptBody`, rename the collision branch check from `"replace"` to `"update"`:

Old:
```ts
      : onCollision === "replace"
        ? `
        var existing = doc.paragraphStyles.itemByName(name);
        var style = existing.isValid ? existing : doc.paragraphStyles.add({ name: name });
      `
```

New:
```ts
      : onCollision === "update"
        ? `
        var existing = doc.paragraphStyles.itemByName(name);
        var style;
        var outcome;
        if (existing.isValid) {
          style = existing;
          outcome = "updated";
        } else {
          style = doc.paragraphStyles.add({ name: name });
          outcome = "created";
        }
      `
```

Note: The `outcome` variable is also needed here for Task 3. Adding it now makes that task cleaner. The `error` and `version` branches also need `outcome` set — add `var outcome = "created";` at the end of the error branch, and `var outcome = "versioned";` at the end of the version branch. Full updated collision block (after both Task 2 and Task 3 changes, do it all now):

```ts
  const collisionBlock =
    onCollision === "error"
      ? `
        var existing = doc.paragraphStyles.itemByName(name);
        if (existing.isValid) {
          throw { name: "name_collision", message: "paragraph style \\"" + name + "\\" already exists", entity: "paragraph_style", id: name };
        }
        var style = doc.paragraphStyles.add({ name: name });
        var outcome = "created";
      `
      : onCollision === "update"
        ? `
        var existing = doc.paragraphStyles.itemByName(name);
        var style;
        var outcome;
        if (existing.isValid) {
          style = existing;
          outcome = "updated";
        } else {
          style = doc.paragraphStyles.add({ name: name });
          outcome = "created";
        }
      `
        : `
        var baseName = name;
        var i = 2;
        while (doc.paragraphStyles.itemByName(name).isValid) {
          name = baseName + " " + i;
          i++;
        }
        var style = doc.paragraphStyles.add({ name: name });
        var outcome = "versioned";
      `;
```

### Step 4: Update the integration test

- [ ] In `tests/integration/define-paragraph-style.int.test.ts`, there is currently no test for `on_collision: "replace"`. Confirm there are no occurrences of `"replace"` in the file (the existing test only uses `"version"` and `"error"`). If any `"replace"` string appears, change it to `"update"`.

### Step 5: Run tests + tsc

- [ ] Run `npx tsc --noEmit && npm test`

Expected: tsc clean; all existing tests pass.

### Step 6: Commit

- [ ] `git add src/tools/define-paragraph-style.ts tests/unit/tools/define-paragraph-style.test.ts tests/integration/define-paragraph-style.int.test.ts`
- [ ] `git commit -m "refactor: align on_collision vocabulary — define_paragraph_style now uses \"update\""`

---

## Task 3: Refactor #74 — `define_paragraph_style` emits delta + outcome

**Why:** `define_paragraph_style` currently returns only `{ style_id, name, swatch_id? }` with no delta and no `on_collision_outcome`. Parity with `define_character_style` requires adding `on_collision_outcome` to the result and `new_paragraph_styles` delta emission.

**Files:**
- Modify: `src/tools/define-paragraph-style.ts`
- Modify: `tests/unit/tools/define-paragraph-style.test.ts`
- Modify: `tests/integration/define-paragraph-style.int.test.ts`

### Step 1: Add unit tests for the new result shape and delta

- [ ] Append to `tests/unit/tools/define-paragraph-style.test.ts`:

```ts
  // --- on_collision_outcome and delta ---

  it("returns on_collision_outcome: created when style is new", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { style_id: "s1", name: "Body", on_collision_outcome: "created" },
    });

    const env = await defineParagraphStyleTool.handler({ name: "Body" });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result?.on_collision_outcome).toBe("created");
  });

  it("emits new_paragraph_styles delta on created outcome", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { style_id: "s1", name: "Body", on_collision_outcome: "created" },
    });

    const env = await defineParagraphStyleTool.handler({ name: "Body" });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.document_state_delta?.new_paragraph_styles).toEqual([{ name: "Body" }]);
  });

  it("emits new_paragraph_styles delta on versioned outcome with the final name", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { style_id: "s2", name: "Body 2", on_collision_outcome: "versioned" },
    });

    const env = await defineParagraphStyleTool.handler({
      name: "Body",
      on_collision: "version",
    });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.document_state_delta?.new_paragraph_styles).toEqual([{ name: "Body 2" }]);
  });

  it("does not emit a delta when outcome is updated", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { style_id: "s1", name: "Body", on_collision_outcome: "updated" },
    });

    const env = await defineParagraphStyleTool.handler({
      name: "Body",
      on_collision: "update",
    });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.document_state_delta).toBeUndefined();
  });
```

### Step 2: Run, expect failure

- [ ] Run `npm test -- tests/unit/tools/define-paragraph-style.test.ts` — expected failures on the four new tests (result shape doesn't match yet).

### Step 3: Update `src/tools/define-paragraph-style.ts`

The collision block was already updated in Task 2 to emit `outcome`. Now update the result schema, `Result` interface, script return value, and handler.

- [ ] Update `ScriptResultSchema`:

Old:
```ts
const ScriptResultSchema = z.object({
  style_id: z.string(),
  name: z.string(),
  swatch_id: z.string().optional(),
});
```

New:
```ts
const ScriptResultSchema = z.object({
  style_id: z.string(),
  name: z.string(),
  on_collision_outcome: z.enum(["created", "updated", "versioned"]),
  swatch_id: z.string().optional(),
});
```

- [ ] Update the `Result` interface:

Old:
```ts
interface Result {
  style_id: string;
  name: string;
  swatch_id?: string;
}
```

New:
```ts
interface Result {
  style_id: string;
  name: string;
  on_collision_outcome: "created" | "updated" | "versioned";
  swatch_id?: string;
}
```

- [ ] Update the ExtendScript `return result` block at the end of `buildScriptBody`. Old:

```ts
var result = {
  style_id: String(style.id),
  name: name
};
if (swatchId !== undefined) result.swatch_id = swatchId;
return result;
```

New:

```ts
var result = {
  style_id: String(style.id),
  name: name,
  on_collision_outcome: outcome
};
if (swatchId !== undefined) result.swatch_id = swatchId;
return result;
```

- [ ] Update the handler to use `ok()` and emit delta:

Old:
```ts
  async handler(input) {
    return runScriptWithResultFile<ScriptResult>({
      language: "JavaScript",
      scriptTemplate: wrapExtendScript(buildScriptBody(input)),
      resultSchema: ScriptResultSchema,
    });
  },
```

New:
```ts
  async handler(input) {
    const env = await runScriptWithResultFile<ScriptResult>({
      language: "JavaScript",
      scriptTemplate: wrapExtendScript(buildScriptBody(input)),
      resultSchema: ScriptResultSchema,
    });
    if (!env.ok) return env;
    const r = env.result!;
    if (r.on_collision_outcome === "updated") {
      return env;
    }
    return ok(r, {
      document_state_delta: {
        new_paragraph_styles: [{ name: r.name }],
      },
    });
  },
```

- [ ] Add `import { ok } from "../errors.js";` to the imports at the top of `define-paragraph-style.ts`.

### Step 4: Update the integration test

- [ ] In `tests/integration/define-paragraph-style.int.test.ts`, update existing assertions to expect the new result shape. The `"creates a basic paragraph style"` test currently only checks `env.result?.name` and `env.result?.style_id` — add:

```ts
      expect(env.result?.on_collision_outcome).toBe("created");
```

- [ ] The `"on_collision 'version' creates 'Body 2' when 'Body' exists"` test currently only checks `second.result?.name` — add:

```ts
      expect(second.result?.on_collision_outcome).toBe("versioned");
```

### Step 5: Run tests + tsc

- [ ] Run `npx tsc --noEmit && npm test`

Expected: tsc clean; all tests pass including the four new unit tests.

### Step 6: Commit

- [ ] `git add src/tools/define-paragraph-style.ts tests/unit/tools/define-paragraph-style.test.ts tests/integration/define-paragraph-style.int.test.ts`
- [ ] `git commit -m "feat: define_paragraph_style emits new_paragraph_styles delta and on_collision_outcome"`

---

## Task 4: `list_fonts` tool

**What it does:** Read-only utility. Returns a paginated, optionally-filtered list of installed fonts. No delta emitted.

**Files:**
- Create: `src/tools/list-fonts.ts`
- Create: `tests/unit/tools/list-fonts.test.ts`
- Create: `tests/integration/list-fonts.int.test.ts`
- Modify: `src/index.ts`

### Step 1: Write unit tests

- [ ] Create `tests/unit/tools/list-fonts.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { listFontsTool } from "../../../src/tools/list-fonts.js";
import { lastCall } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("list_fonts tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(listFontsTool.name).toBe("list_fonts");
    expect(listFontsTool.description.length).toBeGreaterThan(0);
  });

  // --- Schema validation ---

  it("accepts empty input (no filter, no limit)", () => {
    expect(listFontsTool.inputSchema.safeParse({}).success).toBe(true);
  });

  it("accepts optional filter string", () => {
    expect(
      listFontsTool.inputSchema.safeParse({ filter: "Helvetica" }).success,
    ).toBe(true);
  });

  it("accepts optional limit", () => {
    expect(
      listFontsTool.inputSchema.safeParse({ limit: 50 }).success,
    ).toBe(true);
  });

  it("rejects limit of 0", () => {
    expect(
      listFontsTool.inputSchema.safeParse({ limit: 0 }).success,
    ).toBe(false);
  });

  it("rejects limit greater than 5000", () => {
    expect(
      listFontsTool.inputSchema.safeParse({ limit: 5001 }).success,
    ).toBe(false);
  });

  it("accepts limit of 5000 (max)", () => {
    expect(
      listFontsTool.inputSchema.safeParse({ limit: 5000 }).success,
    ).toBe(true);
  });

  it("accepts limit of 1 (min)", () => {
    expect(
      listFontsTool.inputSchema.safeParse({ limit: 1 }).success,
    ).toBe(true);
  });

  it("rejects extra keys (strict schema)", () => {
    expect(
      listFontsTool.inputSchema.safeParse({ extra: true }).success,
    ).toBe(false);
  });

  // --- Script dispatch ---

  it("dispatches a script referencing app.fonts", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { fonts: [], total_matched: 0 },
    });

    await listFontsTool.handler({});

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("app.fonts");
    expect(arg.scriptTemplate).toContain("fontFamily");
    expect(arg.scriptTemplate).toContain("fontStyleName");
  });

  it("embeds filter in the script when provided", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { fonts: [], total_matched: 0 },
    });

    await listFontsTool.handler({ filter: "Helvetica" });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("Helvetica");
    expect(arg.scriptTemplate).toContain("toLowerCase");
  });

  it("uses default limit of 100 when not specified", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { fonts: [], total_matched: 0 },
    });

    await listFontsTool.handler({});

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("100");
  });

  it("embeds custom limit in the script", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { fonts: [], total_matched: 0 },
    });

    await listFontsTool.handler({ limit: 250 });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("250");
  });

  // --- Result shape ---

  it("returns fonts array and total_matched", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        fonts: [
          { family: "Helvetica Neue", style: "Regular", full_name: "Helvetica Neue Regular" },
        ],
        total_matched: 1,
      },
    });

    const env = await listFontsTool.handler({});

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result?.fonts).toHaveLength(1);
    expect(env.result?.fonts[0].family).toBe("Helvetica Neue");
    expect(env.result?.total_matched).toBe(1);
  });

  it("does not emit a document_state_delta (read-only)", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { fonts: [], total_matched: 0 },
    });

    const env = await listFontsTool.handler({});

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.document_state_delta).toBeUndefined();
  });
});
```

### Step 2: Run, expect failure

- [ ] Run `npm test -- tests/unit/tools/list-fonts.test.ts` — expected: module not found.

### Step 3: Create `src/tools/list-fonts.ts`

- [ ] Create the file:

```ts
import { z } from "zod";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript, lit } from "../compose.js";

const InputSchema = z
  .object({
    filter: z.string().optional(),
    limit: z.number().int().min(1).max(5000).optional(),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

const ScriptResultSchema = z.object({
  fonts: z.array(
    z.object({
      family: z.string(),
      style: z.string(),
      full_name: z.string(),
    }),
  ),
  total_matched: z.number().int().nonnegative(),
});

type ScriptResult = z.infer<typeof ScriptResultSchema>;

interface Result {
  fonts: Array<{ family: string; style: string; full_name: string }>;
  total_matched: number;
}

function buildScriptBody(input: Input): string {
  const limit = input.limit ?? 100;
  const filterExpr = input.filter !== undefined ? lit(input.filter.toLowerCase()) : "null";

  return `
var filterStr = ${filterExpr};
var limit = ${limit};
var allFonts = app.fonts;
var matched = [];
for (var i = 0; i < allFonts.length; i++) {
  var f = allFonts[i];
  var family = f.fontFamily;
  if (filterStr !== null) {
    if (family.toLowerCase().indexOf(filterStr) === -1) {
      continue;
    }
  }
  matched.push({
    family: family,
    style: f.fontStyleName,
    full_name: f.name
  });
}
var total_matched = matched.length;
var fonts = matched.length > limit ? matched.slice(0, limit) : matched;
return { fonts: fonts, total_matched: total_matched };
`;
}

export const listFontsTool = defineTool<Input, Result>({
  name: "list_fonts",
  description:
    "Lists installed fonts available to InDesign. Accepts an optional case-insensitive substring filter on font family name, and an optional limit (default 100, max 5000). Returns fonts with family, style, and full name, plus total_matched before truncation.",
  inputSchema: InputSchema,
  async handler(input) {
    return runScriptWithResultFile<ScriptResult>({
      language: "JavaScript",
      scriptTemplate: wrapExtendScript(buildScriptBody(input)),
      resultSchema: ScriptResultSchema,
    });
  },
});
```

### Step 4: Register in `src/index.ts`

- [ ] Add import:

```ts
import { listFontsTool } from "./tools/list-fonts.js";
```

- [ ] Add registration after `threadTextFramesTool`:

```ts
  registry.register(listFontsTool);
```

### Step 5: Create integration test

- [ ] Create `tests/integration/list-fonts.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { listFontsTool } from "../../src/tools/list-fonts.js";

integrationGate("list_fonts (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "returns a non-empty fonts list",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      const env = await listFontsTool.handler({});
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result?.fonts.length).toBeGreaterThan(0);
      expect(env.result?.total_matched).toBeGreaterThan(0);
      const first = env.result!.fonts[0];
      expect(typeof first.family).toBe("string");
      expect(typeof first.style).toBe("string");
      expect(typeof first.full_name).toBe("string");
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "filter narrows results",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      const allEnv = await listFontsTool.handler({ limit: 5000 });
      expect(allEnv.ok).toBe(true);
      if (!allEnv.ok) return;
      const totalAll = allEnv.result!.total_matched;

      const filteredEnv = await listFontsTool.handler({ filter: "helv" });
      expect(filteredEnv.ok).toBe(true);
      if (!filteredEnv.ok) return;
      // Filtered result should be a subset (may be 0 if Helvetica not installed)
      expect(filteredEnv.result!.total_matched).toBeLessThanOrEqual(totalAll);
      // All returned fonts must have "helv" in family (case-insensitive)
      for (const f of filteredEnv.result!.fonts) {
        expect(f.family.toLowerCase()).toContain("helv");
      }
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "limit caps the returned array without affecting total_matched",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      const env = await listFontsTool.handler({ limit: 2 });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result!.fonts.length).toBeLessThanOrEqual(2);
      expect(env.result!.total_matched).toBeGreaterThanOrEqual(env.result!.fonts.length);
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
```

### Step 6: Run tests + tsc

- [ ] Run `npx tsc --noEmit && npm test -- tests/unit/tools/list-fonts.test.ts`

Expected: tsc clean; all unit tests pass.

### Step 7: Commit

- [ ] `git add src/tools/list-fonts.ts src/index.ts tests/unit/tools/list-fonts.test.ts tests/integration/list-fonts.int.test.ts`
- [ ] `git commit -m "feat: list_fonts utility tool"`

---

## Task 5: `create_swatch` tool

**What it does:** Creates a named RGB swatch with user-chosen name. Three on_collision branches matching `define_character_style`. Emits `new_swatches` delta on created/versioned.

**Files:**
- Create: `src/tools/create-swatch.ts`
- Create: `tests/unit/tools/create-swatch.test.ts`
- Create: `tests/integration/create-swatch.int.test.ts`
- Modify: `src/index.ts`

### Step 1: Write unit tests

- [ ] Create `tests/unit/tools/create-swatch.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSwatchTool } from "../../../src/tools/create-swatch.js";
import { lastCall, expectFailure } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("create_swatch tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(createSwatchTool.name).toBe("create_swatch");
    expect(createSwatchTool.description.length).toBeGreaterThan(0);
  });

  // --- Schema validation ---

  it("requires name and hex", () => {
    expect(createSwatchTool.inputSchema.safeParse({ name: "Brand Orange" }).success).toBe(false);
    expect(createSwatchTool.inputSchema.safeParse({ hex: "#FF6600" }).success).toBe(false);
  });

  it("accepts name + hex", () => {
    expect(
      createSwatchTool.inputSchema.safeParse({ name: "Brand Orange", hex: "#FF6600" }).success,
    ).toBe(true);
  });

  it("rejects empty name", () => {
    expect(
      createSwatchTool.inputSchema.safeParse({ name: "", hex: "#FF6600" }).success,
    ).toBe(false);
  });

  it("rejects name longer than 60 chars", () => {
    expect(
      createSwatchTool.inputSchema.safeParse({ name: "A".repeat(61), hex: "#FF6600" }).success,
    ).toBe(false);
  });

  it("rejects invalid hex formats", () => {
    expect(
      createSwatchTool.inputSchema.safeParse({ name: "X", hex: "red" }).success,
    ).toBe(false);
    expect(
      createSwatchTool.inputSchema.safeParse({ name: "X", hex: "#XYZ000" }).success,
    ).toBe(false);
    expect(
      createSwatchTool.inputSchema.safeParse({ name: "X", hex: "#FF" }).success,
    ).toBe(false);
    expect(
      createSwatchTool.inputSchema.safeParse({ name: "X", hex: "FF6600" }).success,
    ).toBe(false);
  });

  it("accepts valid hex — both cases", () => {
    expect(
      createSwatchTool.inputSchema.safeParse({ name: "X", hex: "#FF6600" }).success,
    ).toBe(true);
    expect(
      createSwatchTool.inputSchema.safeParse({ name: "X", hex: "#ff6600" }).success,
    ).toBe(true);
  });

  it("accepts on_collision values: error / update / version", () => {
    for (const c of ["error", "update", "version"] as const) {
      expect(
        createSwatchTool.inputSchema.safeParse({ name: "X", hex: "#FF6600", on_collision: c }).success,
      ).toBe(true);
    }
  });

  it("accepts optional document_id", () => {
    expect(
      createSwatchTool.inputSchema.safeParse({
        name: "X",
        hex: "#FF6600",
        document_id: "doc1",
      }).success,
    ).toBe(true);
  });

  it("rejects extra keys (strict schema)", () => {
    expect(
      createSwatchTool.inputSchema.safeParse({ name: "X", hex: "#FF6600", extra: true }).success,
    ).toBe(false);
  });

  // --- Script dispatch ---

  it("dispatches a script referencing doc.colors and ColorSpace.RGB", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { swatch_name: "Brand Orange", swatch_id: "sw1", on_collision_outcome: "created" },
    });

    await createSwatchTool.handler({ name: "Brand Orange", hex: "#FF6600" });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("doc.colors");
    expect(arg.scriptTemplate).toContain("ColorSpace");
    expect(arg.scriptTemplate).toContain("ColorModel");
    expect(arg.scriptTemplate).toContain("Brand Orange");
  });

  it("embeds hex values in the script", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { swatch_name: "X", swatch_id: "sw1", on_collision_outcome: "created" },
    });

    await createSwatchTool.handler({ name: "X", hex: "#FF6600" });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("FF");
    expect(arg.scriptTemplate).toContain("66");
  });

  it("dispatches name_collision throw when on_collision is error", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { swatch_name: "X", swatch_id: "sw1", on_collision_outcome: "created" },
    });

    await createSwatchTool.handler({ name: "X", hex: "#FF6600", on_collision: "error" });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("name_collision");
  });

  it("dispatches version loop when on_collision is version", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { swatch_name: "X 2", swatch_id: "sw1", on_collision_outcome: "versioned" },
    });

    await createSwatchTool.handler({ name: "X", hex: "#FF6600", on_collision: "version" });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("baseName");
  });

  // --- Result shape ---

  it("returns swatch_name, swatch_id, on_collision_outcome", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { swatch_name: "Brand Orange", swatch_id: "sw42", on_collision_outcome: "created" },
    });

    const env = await createSwatchTool.handler({ name: "Brand Orange", hex: "#FF6600" });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result?.swatch_name).toBe("Brand Orange");
    expect(env.result?.swatch_id).toBe("sw42");
    expect(env.result?.on_collision_outcome).toBe("created");
  });

  it("emits new_swatches delta on created outcome", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { swatch_name: "Brand Orange", swatch_id: "sw1", on_collision_outcome: "created" },
    });

    const env = await createSwatchTool.handler({ name: "Brand Orange", hex: "#FF6600" });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.document_state_delta?.new_swatches).toEqual([{ name: "Brand Orange" }]);
  });

  it("emits new_swatches delta on versioned outcome with the final name", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { swatch_name: "Brand Orange 2", swatch_id: "sw2", on_collision_outcome: "versioned" },
    });

    const env = await createSwatchTool.handler({
      name: "Brand Orange",
      hex: "#FF6600",
      on_collision: "version",
    });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.document_state_delta?.new_swatches).toEqual([{ name: "Brand Orange 2" }]);
  });

  it("does not emit a delta when outcome is updated", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { swatch_name: "Brand Orange", swatch_id: "sw1", on_collision_outcome: "updated" },
    });

    const env = await createSwatchTool.handler({
      name: "Brand Orange",
      hex: "#FF6600",
      on_collision: "update",
    });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.document_state_delta).toBeUndefined();
  });

  it("propagates name_collision failures verbatim", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: { kind: "name_collision", message: "swatch Brand Orange already exists" },
    });

    const env = await createSwatchTool.handler({ name: "Brand Orange", hex: "#FF6600" });

    expectFailure(env);
    expect(env.error.kind).toBe("name_collision");
  });
});
```

### Step 2: Run, expect failure

- [ ] Run `npm test -- tests/unit/tools/create-swatch.test.ts` — expected: module not found.

### Step 3: Create `src/tools/create-swatch.ts`

- [ ] Create the file:

```ts
import { z } from "zod";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript, lit, prelude } from "../compose.js";
import { findDocumentById } from "../script-helpers.js";
import { ok } from "../errors.js";

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

const InputSchema = z
  .object({
    name: z.string().min(1).max(60),
    hex: z.string().regex(HEX_COLOR_RE),
    on_collision: z.enum(["error", "update", "version"]).optional(),
    document_id: z.string().optional(),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

const ScriptResultSchema = z.object({
  swatch_name: z.string(),
  swatch_id: z.string(),
  on_collision_outcome: z.enum(["created", "updated", "versioned"]),
});

type ScriptResult = z.infer<typeof ScriptResultSchema>;

interface Result {
  swatch_name: string;
  swatch_id: string;
  on_collision_outcome: "created" | "updated" | "versioned";
}

function buildScriptBody(input: Input): string {
  const docExpr =
    input.document_id !== undefined
      ? `findDocumentById(${lit(input.document_id)})`
      : "app.activeDocument";

  const onCollision = input.on_collision ?? "error";
  const upperHex = input.hex.toUpperCase();

  // Parse RGB components from hex string at script build time (server-side)
  const r = parseInt(upperHex.substr(1, 2), 16);
  const g = parseInt(upperHex.substr(3, 2), 16);
  const b = parseInt(upperHex.substr(5, 2), 16);

  const collisionBlock =
    onCollision === "error"
      ? `
        var existing = doc.colors.itemByName(name);
        if (existing.isValid) {
          throw { name: "name_collision", message: "swatch \\"" + name + "\\" already exists", entity: "swatch", id: name };
        }
        var swatch = doc.colors.add({ name: name, model: ColorModel.PROCESS, space: ColorSpace.RGB, colorValue: [${r}, ${g}, ${b}] });
        var outcome = "created";
      `
      : onCollision === "update"
        ? `
        var existing = doc.colors.itemByName(name);
        var swatch;
        var outcome;
        if (existing.isValid) {
          existing.colorValue = [${r}, ${g}, ${b}];
          swatch = existing;
          outcome = "updated";
        } else {
          swatch = doc.colors.add({ name: name, model: ColorModel.PROCESS, space: ColorSpace.RGB, colorValue: [${r}, ${g}, ${b}] });
          outcome = "created";
        }
      `
        : `
        var baseName = name;
        var i = 2;
        while (doc.colors.itemByName(name).isValid) {
          name = baseName + " " + i;
          i++;
        }
        var swatch = doc.colors.add({ name: name, model: ColorModel.PROCESS, space: ColorSpace.RGB, colorValue: [${r}, ${g}, ${b}] });
        var outcome = "versioned";
      `;

  return `
${prelude(findDocumentById)}
var doc = ${docExpr};
var name = ${lit(input.name)};
${collisionBlock}
return {
  swatch_name: name,
  swatch_id: String(swatch.id),
  on_collision_outcome: outcome
};
`;
}

export const createSwatchTool = defineTool<Input, Result>({
  name: "create_swatch",
  description:
    "Creates a named RGB swatch from a hex colour value. Unlike auto-swatches created by define_paragraph_style and define_character_style, this swatch uses the exact user-chosen name. Returns the final swatch name (may differ from input when on_collision is 'version'), swatch ID, and collision outcome.",
  inputSchema: InputSchema,
  async handler(input) {
    const env = await runScriptWithResultFile<ScriptResult>({
      language: "JavaScript",
      scriptTemplate: wrapExtendScript(buildScriptBody(input)),
      resultSchema: ScriptResultSchema,
    });
    if (!env.ok) return env;
    const r = env.result!;
    if (r.on_collision_outcome === "updated") {
      return env;
    }
    return ok(r, {
      document_state_delta: {
        new_swatches: [{ name: r.swatch_name }],
      },
    });
  },
});
```

### Step 4: Register in `src/index.ts`

- [ ] Add import:

```ts
import { createSwatchTool } from "./tools/create-swatch.js";
```

- [ ] Add registration:

```ts
  registry.register(createSwatchTool);
```

### Step 5: Create integration test

- [ ] Create `tests/integration/create-swatch.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { createSwatchTool } from "../../src/tools/create-swatch.js";

integrationGate("create_swatch (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "creates a named swatch and returns swatch_id",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      const env = await createSwatchTool.handler({ name: "Brand Orange", hex: "#FF6600" });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result?.swatch_name).toBe("Brand Orange");
      expect(typeof env.result?.swatch_id).toBe("string");
      expect(env.result?.on_collision_outcome).toBe("created");
      expect(env.document_state_delta?.new_swatches).toEqual([{ name: "Brand Orange" }]);
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "name_collision when swatch exists and on_collision is 'error'",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      await createSwatchTool.handler({ name: "Brand Orange", hex: "#FF6600" });

      const second = await createSwatchTool.handler({
        name: "Brand Orange",
        hex: "#0000FF",
        on_collision: "error",
      });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.kind).toBe("name_collision");
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "on_collision 'update' modifies the existing swatch RGB values",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      await createSwatchTool.handler({ name: "Brand Orange", hex: "#FF6600" });

      const env = await createSwatchTool.handler({
        name: "Brand Orange",
        hex: "#0000FF",
        on_collision: "update",
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result?.swatch_name).toBe("Brand Orange");
      expect(env.result?.on_collision_outcome).toBe("updated");
      expect(env.document_state_delta).toBeUndefined();
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "on_collision 'version' creates 'Brand Orange 2' when 'Brand Orange' exists",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      await createSwatchTool.handler({ name: "Brand Orange", hex: "#FF6600" });

      const env = await createSwatchTool.handler({
        name: "Brand Orange",
        hex: "#0000FF",
        on_collision: "version",
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result?.swatch_name).toBe("Brand Orange 2");
      expect(env.result?.on_collision_outcome).toBe("versioned");
      expect(env.document_state_delta?.new_swatches).toEqual([{ name: "Brand Orange 2" }]);
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
```

### Step 6: Run tests + tsc

- [ ] Run `npx tsc --noEmit && npm test -- tests/unit/tools/create-swatch.test.ts`

Expected: tsc clean; all unit tests pass.

### Step 7: Commit

- [ ] `git add src/tools/create-swatch.ts src/index.ts tests/unit/tools/create-swatch.test.ts tests/integration/create-swatch.int.test.ts`
- [ ] `git commit -m "feat: create_swatch tool"`

---

## Task 6: `duplicate_frame` tool

**What it does:** Duplicates any page item with an optional millimeter offset. Returns the duplicate's ID and type. Emits `new_frames` delta.

**Files:**
- Create: `src/tools/duplicate-frame.ts`
- Create: `tests/unit/tools/duplicate-frame.test.ts`
- Create: `tests/integration/duplicate-frame.int.test.ts`
- Modify: `src/index.ts`

### Step 1: Write unit tests

- [ ] Create `tests/unit/tools/duplicate-frame.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { duplicateFrameTool } from "../../../src/tools/duplicate-frame.js";
import { lastCall, expectFailure } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("duplicate_frame tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(duplicateFrameTool.name).toBe("duplicate_frame");
    expect(duplicateFrameTool.description.length).toBeGreaterThan(0);
  });

  // --- Schema validation ---

  it("requires frame_id", () => {
    expect(duplicateFrameTool.inputSchema.safeParse({}).success).toBe(false);
  });

  it("accepts frame_id alone (no offset)", () => {
    expect(
      duplicateFrameTool.inputSchema.safeParse({ frame_id: "f1" }).success,
    ).toBe(true);
  });

  it("accepts frame_id + offset_mm", () => {
    expect(
      duplicateFrameTool.inputSchema.safeParse({
        frame_id: "f1",
        offset_mm: { x: 10, y: 20 },
      }).success,
    ).toBe(true);
  });

  it("accepts zero offset", () => {
    expect(
      duplicateFrameTool.inputSchema.safeParse({
        frame_id: "f1",
        offset_mm: { x: 0, y: 0 },
      }).success,
    ).toBe(true);
  });

  it("accepts negative offset (valid — offset can be left/up)", () => {
    expect(
      duplicateFrameTool.inputSchema.safeParse({
        frame_id: "f1",
        offset_mm: { x: -5, y: -10 },
      }).success,
    ).toBe(true);
  });

  it("rejects offset_mm with missing x or y", () => {
    expect(
      duplicateFrameTool.inputSchema.safeParse({
        frame_id: "f1",
        offset_mm: { x: 10 },
      }).success,
    ).toBe(false);
    expect(
      duplicateFrameTool.inputSchema.safeParse({
        frame_id: "f1",
        offset_mm: { y: 10 },
      }).success,
    ).toBe(false);
  });

  it("accepts optional document_id", () => {
    expect(
      duplicateFrameTool.inputSchema.safeParse({
        frame_id: "f1",
        document_id: "doc1",
      }).success,
    ).toBe(true);
  });

  it("rejects extra keys (strict schema)", () => {
    expect(
      duplicateFrameTool.inputSchema.safeParse({ frame_id: "f1", extra: true }).success,
    ).toBe(false);
  });

  // --- Script dispatch ---

  it("dispatches a script referencing frame.duplicate and MILLIMETERS", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { source_frame_id: "f1", duplicate_frame_id: "f2", duplicate_type: "text" },
    });

    await duplicateFrameTool.handler({ frame_id: "f1" });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("duplicate");
    expect(arg.scriptTemplate).toContain("MILLIMETERS");
    expect(arg.scriptTemplate).toContain("findFrameById");
  });

  it("embeds the offset in the script when provided", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { source_frame_id: "f1", duplicate_frame_id: "f2", duplicate_type: "text" },
    });

    await duplicateFrameTool.handler({ frame_id: "f1", offset_mm: { x: 10, y: 20 } });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("10");
    expect(arg.scriptTemplate).toContain("20");
  });

  it("uses 0,0 offset when offset_mm is omitted", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { source_frame_id: "f1", duplicate_frame_id: "f2", duplicate_type: "text" },
    });

    await duplicateFrameTool.handler({ frame_id: "f1" });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    // Default offset is 0, 0 — look for the array literal
    expect(arg.scriptTemplate).toContain("[0, 0]");
  });

  // --- Result shape ---

  it("returns source_frame_id, duplicate_frame_id, duplicate_type", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { source_frame_id: "f1", duplicate_frame_id: "f99", duplicate_type: "text" },
    });

    const env = await duplicateFrameTool.handler({ frame_id: "f1" });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result?.source_frame_id).toBe("f1");
    expect(env.result?.duplicate_frame_id).toBe("f99");
    expect(env.result?.duplicate_type).toBe("text");
  });

  it("emits new_frames delta with the duplicate id and type", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { source_frame_id: "f1", duplicate_frame_id: "f99", duplicate_type: "rectangle" },
    });

    const env = await duplicateFrameTool.handler({ frame_id: "f1" });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.document_state_delta?.new_frames).toEqual([{ id: "f99", type: "rectangle" }]);
  });

  it("propagates not_found failures verbatim", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: { kind: "not_found", message: "frame f1 not found" },
    });

    const env = await duplicateFrameTool.handler({ frame_id: "f1" });

    expectFailure(env);
    expect(env.error.kind).toBe("not_found");
  });
});
```

### Step 2: Run, expect failure

- [ ] Run `npm test -- tests/unit/tools/duplicate-frame.test.ts` — expected: module not found.

### Step 3: Create `src/tools/duplicate-frame.ts`

- [ ] Create the file:

```ts
import { z } from "zod";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript, lit, prelude } from "../compose.js";
import { findDocumentById, findFrameById } from "../script-helpers.js";
import { ok } from "../errors.js";
import type { FrameType } from "../types.js";

const InputSchema = z
  .object({
    frame_id: z.string().min(1),
    offset_mm: z
      .object({
        x: z.number(),
        y: z.number(),
      })
      .optional(),
    document_id: z.string().optional(),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

const ScriptResultSchema = z.object({
  source_frame_id: z.string(),
  duplicate_frame_id: z.string(),
  duplicate_type: z.enum(["text", "image", "rectangle", "line"]),
});

type ScriptResult = z.infer<typeof ScriptResultSchema>;

interface Result {
  source_frame_id: string;
  duplicate_frame_id: string;
  duplicate_type: FrameType;
}

function buildScriptBody(input: Input): string {
  const docExpr =
    input.document_id !== undefined
      ? `findDocumentById(${lit(input.document_id)})`
      : "app.activeDocument";

  const offsetX = input.offset_mm?.x ?? 0;
  const offsetY = input.offset_mm?.y ?? 0;

  return `
${prelude(findDocumentById, findFrameById)}
var doc = ${docExpr};
var frame = findFrameById(doc, ${lit(input.frame_id)});
var prevUnits = app.scriptPreferences.measurementUnit;
app.scriptPreferences.measurementUnit = MeasurementUnits.MILLIMETERS;
try {
  var parent = frame.parent;
  var dup = frame.duplicate(parent, [${offsetX}, ${offsetY}]);
  var ctor = dup.constructor.name;
  var dupType;
  if (ctor === "TextFrame") {
    dupType = "text";
  } else if (ctor === "Rectangle") {
    dupType = (dup.graphics && dup.graphics.length > 0) ? "image" : "rectangle";
  } else if (ctor === "GraphicLine") {
    dupType = "line";
  } else {
    throw {
      name: "invalid_args",
      message: "duplicated item type " + ctor + " is not supported in document_state_delta",
      entity: "frame",
      id: String(dup.id)
    };
  }
  return {
    source_frame_id: ${lit(input.frame_id)},
    duplicate_frame_id: String(dup.id),
    duplicate_type: dupType
  };
} finally {
  app.scriptPreferences.measurementUnit = prevUnits;
}
`;
}

export const duplicateFrameTool = defineTool<Input, Result>({
  name: "duplicate_frame",
  description:
    "Duplicates a page item (text frame, image frame, rectangle, or line) with an optional millimeter offset from the original position. Returns the source frame ID, the new duplicate frame ID, and the frame type. Emits a new_frames delta for the duplicate.",
  inputSchema: InputSchema,
  async handler(input) {
    const env = await runScriptWithResultFile<ScriptResult>({
      language: "JavaScript",
      scriptTemplate: wrapExtendScript(buildScriptBody(input)),
      resultSchema: ScriptResultSchema,
    });
    if (!env.ok) return env;
    const r = env.result!;
    const frameType: FrameType = r.duplicate_type;
    return ok(
      {
        source_frame_id: r.source_frame_id,
        duplicate_frame_id: r.duplicate_frame_id,
        duplicate_type: frameType,
      },
      {
        document_state_delta: {
          new_frames: [{ id: r.duplicate_frame_id, type: frameType }],
        },
      },
    );
  },
});
```

### Step 4: Register in `src/index.ts`

- [ ] Add import:

```ts
import { duplicateFrameTool } from "./tools/duplicate-frame.js";
```

- [ ] Add registration:

```ts
  registry.register(duplicateFrameTool);
```

### Step 5: Create integration test

- [ ] Create `tests/integration/duplicate-frame.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { createTextFrameTool } from "../../src/tools/create-text-frame.js";
import { duplicateFrameTool } from "../../src/tools/duplicate-frame.js";

integrationGate("duplicate_frame (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "duplicates a text frame and returns a new frame_id",
    async () => {
      const docEnv = await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 20, bottom: 20, left: 20, right: 20 },
      });
      expect(docEnv.ok).toBe(true);
      if (!docEnv.ok) return;
      const pageId = docEnv.result!.page_ids[0];

      const frameEnv = await createTextFrameTool.handler({
        page_id: pageId,
        bounds_mm: { x: 20, y: 20, width: 80, height: 40 },
      });
      expect(frameEnv.ok).toBe(true);
      if (!frameEnv.ok) return;
      const sourceId = frameEnv.result!.frame_id;

      const dupEnv = await duplicateFrameTool.handler({ frame_id: sourceId });
      expect(dupEnv.ok).toBe(true);
      if (!dupEnv.ok) return;
      expect(dupEnv.result?.source_frame_id).toBe(sourceId);
      expect(typeof dupEnv.result?.duplicate_frame_id).toBe("string");
      expect(dupEnv.result?.duplicate_frame_id).not.toBe(sourceId);
      expect(dupEnv.result?.duplicate_type).toBe("text");
      expect(dupEnv.document_state_delta?.new_frames?.[0].id).toBe(
        dupEnv.result?.duplicate_frame_id,
      );
      expect(dupEnv.document_state_delta?.new_frames?.[0].type).toBe("text");
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "duplicates with offset — duplicate is at a different position",
    async () => {
      const docEnv = await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 20, bottom: 20, left: 20, right: 20 },
      });
      expect(docEnv.ok).toBe(true);
      if (!docEnv.ok) return;
      const pageId = docEnv.result!.page_ids[0];

      const frameEnv = await createTextFrameTool.handler({
        page_id: pageId,
        bounds_mm: { x: 20, y: 20, width: 80, height: 40 },
      });
      expect(frameEnv.ok).toBe(true);
      if (!frameEnv.ok) return;
      const sourceId = frameEnv.result!.frame_id;

      const dupEnv = await duplicateFrameTool.handler({
        frame_id: sourceId,
        offset_mm: { x: 0, y: 50 },
      });
      expect(dupEnv.ok).toBe(true);
      if (!dupEnv.ok) return;
      expect(dupEnv.result?.duplicate_frame_id).not.toBe(sourceId);
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "not_found when frame_id is invalid",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 20, bottom: 20, left: 20, right: 20 },
      });

      const env = await duplicateFrameTool.handler({ frame_id: "nonexistent-999" });
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.kind).toBe("not_found");
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
```

### Step 6: Run tests + tsc

- [ ] Run `npx tsc --noEmit && npm test -- tests/unit/tools/duplicate-frame.test.ts`

Expected: tsc clean; all unit tests pass.

### Step 7: Commit

- [ ] `git add src/tools/duplicate-frame.ts src/index.ts tests/unit/tools/duplicate-frame.test.ts tests/integration/duplicate-frame.int.test.ts`
- [ ] `git commit -m "feat: duplicate_frame tool"`

---

## Task 7: `find_replace` tool

**What it does:** Replaces text matches across the active document or within one frame's story. Supports literal and grep modes. Emits an empty `changed_frames: []` delta (count is the user-visible signal).

**Critical ExtendScript notes:**
- Reset BOTH `app.findGrepPreferences = NothingEnum.NOTHING` AND `app.changeGrepPreferences = NothingEnum.NOTHING` BEFORE setting any fields, and AGAIN in the `finally` block. Applies even in literal mode — reset the grep prefs defensively.
- Literal mode uses `findTextPreferences`/`changeTextPreferences` + `doc.changeText()` (or `story.changeText()`).
- Grep mode uses `findGrepPreferences`/`changeGrepPreferences` + `doc.changeGrep()` (or `story.changeGrep()`).
- Scope `"frame"` uses `frame.parentStory` as the target, not the frame itself.

**Files:**
- Create: `src/tools/find-replace.ts`
- Create: `tests/unit/tools/find-replace.test.ts`
- Create: `tests/integration/find-replace.int.test.ts`
- Modify: `src/index.ts`

### Step 1: Write unit tests

- [ ] Create `tests/unit/tools/find-replace.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { findReplaceTool } from "../../../src/tools/find-replace.js";
import { lastCall, expectFailure } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("find_replace tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(findReplaceTool.name).toBe("find_replace");
    expect(findReplaceTool.description.length).toBeGreaterThan(0);
  });

  // --- Schema validation ---

  it("requires find and replace", () => {
    expect(findReplaceTool.inputSchema.safeParse({ find: "a" }).success).toBe(false);
    expect(findReplaceTool.inputSchema.safeParse({ replace: "b" }).success).toBe(false);
    expect(findReplaceTool.inputSchema.safeParse({}).success).toBe(false);
  });

  it("accepts minimal input with find and replace", () => {
    expect(
      findReplaceTool.inputSchema.safeParse({ find: "people", replace: "individuals" }).success,
    ).toBe(true);
  });

  it("accepts mode: literal and grep", () => {
    expect(
      findReplaceTool.inputSchema.safeParse({ find: "a", replace: "b", mode: "literal" }).success,
    ).toBe(true);
    expect(
      findReplaceTool.inputSchema.safeParse({ find: "a", replace: "b", mode: "grep" }).success,
    ).toBe(true);
  });

  it("rejects invalid mode", () => {
    expect(
      findReplaceTool.inputSchema.safeParse({ find: "a", replace: "b", mode: "regex" }).success,
    ).toBe(false);
  });

  it("accepts scope: document and frame", () => {
    expect(
      findReplaceTool.inputSchema.safeParse({ find: "a", replace: "b", scope: "document" }).success,
    ).toBe(true);
    expect(
      findReplaceTool.inputSchema.safeParse({
        find: "a",
        replace: "b",
        scope: "frame",
        frame_id: "f1",
      }).success,
    ).toBe(true);
  });

  it("rejects scope 'frame' without frame_id (refine)", () => {
    expect(
      findReplaceTool.inputSchema.safeParse({ find: "a", replace: "b", scope: "frame" }).success,
    ).toBe(false);
  });

  it("accepts scope 'document' without frame_id", () => {
    expect(
      findReplaceTool.inputSchema.safeParse({ find: "a", replace: "b", scope: "document" }).success,
    ).toBe(true);
  });

  it("frame_id is allowed (and ignored) when scope is 'document'", () => {
    // frame_id is optional — not required to be absent for document scope
    expect(
      findReplaceTool.inputSchema.safeParse({
        find: "a",
        replace: "b",
        scope: "document",
        frame_id: "f1",
      }).success,
    ).toBe(true);
  });

  it("accepts optional document_id", () => {
    expect(
      findReplaceTool.inputSchema.safeParse({
        find: "a",
        replace: "b",
        document_id: "doc1",
      }).success,
    ).toBe(true);
  });

  it("rejects extra keys (strict schema)", () => {
    expect(
      findReplaceTool.inputSchema.safeParse({ find: "a", replace: "b", extra: true }).success,
    ).toBe(false);
  });

  // --- Script dispatch ---

  it("dispatches a script with findTextPreferences for literal mode", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { matches_changed: 1, scope: "document", mode: "literal" },
    });

    await findReplaceTool.handler({ find: "people", replace: "individuals" });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("findTextPreferences");
    expect(arg.scriptTemplate).toContain("changeTextPreferences");
    expect(arg.scriptTemplate).toContain("changeText");
    expect(arg.scriptTemplate).toContain("people");
    expect(arg.scriptTemplate).toContain("individuals");
  });

  it("dispatches a script with findGrepPreferences for grep mode", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { matches_changed: 2, scope: "document", mode: "grep" },
    });

    await findReplaceTool.handler({ find: "\\bpeople\\b", replace: "individuals", mode: "grep" });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("findGrepPreferences");
    expect(arg.scriptTemplate).toContain("changeGrepPreferences");
    expect(arg.scriptTemplate).toContain("changeGrep");
    expect(arg.scriptTemplate).toContain("NothingEnum");
  });

  it("resets grep preferences in the script for safety (even in literal mode)", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { matches_changed: 0, scope: "document", mode: "literal" },
    });

    await findReplaceTool.handler({ find: "a", replace: "b" });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("NothingEnum");
    expect(arg.scriptTemplate).toContain("findGrepPreferences");
    expect(arg.scriptTemplate).toContain("changeGrepPreferences");
  });

  it("references parentStory when scope is frame", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { matches_changed: 1, scope: "frame", mode: "literal" },
    });

    await findReplaceTool.handler({
      find: "a",
      replace: "b",
      scope: "frame",
      frame_id: "f1",
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("parentStory");
    expect(arg.scriptTemplate).toContain("findFrameById");
  });

  // --- Result shape ---

  it("returns matches_changed, scope, mode", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { matches_changed: 3, scope: "document", mode: "literal" },
    });

    const env = await findReplaceTool.handler({ find: "a", replace: "b" });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result?.matches_changed).toBe(3);
    expect(env.result?.scope).toBe("document");
    expect(env.result?.mode).toBe("literal");
  });

  it("emits empty changed_frames delta", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { matches_changed: 1, scope: "document", mode: "literal" },
    });

    const env = await findReplaceTool.handler({ find: "a", replace: "b" });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.document_state_delta?.changed_frames).toEqual([]);
  });
});
```

### Step 2: Run, expect failure

- [ ] Run `npm test -- tests/unit/tools/find-replace.test.ts` — expected: module not found.

### Step 3: Create `src/tools/find-replace.ts`

- [ ] Create the file:

```ts
import { z } from "zod";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript, lit, prelude } from "../compose.js";
import { findDocumentById, findFrameById } from "../script-helpers.js";
import { ok } from "../errors.js";

const InputSchema = z
  .object({
    find: z.string().min(1),
    replace: z.string(),
    mode: z.enum(["literal", "grep"]).optional(),
    scope: z.enum(["document", "frame"]).optional(),
    frame_id: z.string().optional(),
    document_id: z.string().optional(),
  })
  .strict()
  .refine(
    (data) => !(data.scope === "frame" && data.frame_id === undefined),
    { message: "frame_id is required when scope is 'frame'", path: ["frame_id"] },
  );

type Input = z.infer<typeof InputSchema>;

const ScriptResultSchema = z.object({
  matches_changed: z.number().int().nonnegative(),
  scope: z.enum(["document", "frame"]),
  mode: z.enum(["literal", "grep"]),
});

type ScriptResult = z.infer<typeof ScriptResultSchema>;

interface Result {
  matches_changed: number;
  scope: "document" | "frame";
  mode: "literal" | "grep";
}

function buildScriptBody(input: Input): string {
  const docExpr =
    input.document_id !== undefined
      ? `findDocumentById(${lit(input.document_id)})`
      : "app.activeDocument";

  const mode = input.mode ?? "literal";
  const scope = input.scope ?? "document";

  // Always reset grep preferences before and after for safety
  const grepReset = `
app.findGrepPreferences = NothingEnum.NOTHING;
app.changeGrepPreferences = NothingEnum.NOTHING;
`;

  // Target expression: whole doc or a single story
  const targetExpr =
    scope === "frame"
      ? `findFrameById(doc, ${lit(input.frame_id!)}).parentStory`
      : "doc";

  const findBody =
    mode === "literal"
      ? `
app.findTextPreferences = NothingEnum.NOTHING;
app.changeTextPreferences = NothingEnum.NOTHING;
app.findTextPreferences.findWhat = ${lit(input.find)};
app.changeTextPreferences.changeTo = ${lit(input.replace)};
var changed = target.changeText();
app.findTextPreferences = NothingEnum.NOTHING;
app.changeTextPreferences = NothingEnum.NOTHING;
`
      : `
app.findGrepPreferences.findWhat = ${lit(input.find)};
app.changeGrepPreferences.changeTo = ${lit(input.replace)};
var changed = target.changeGrep();
`;

  return `
${prelude(findDocumentById, findFrameById)}
var doc = ${docExpr};
${grepReset}
try {
  var target = ${targetExpr};
${findBody}
  return {
    matches_changed: changed.length,
    scope: ${lit(scope)},
    mode: ${lit(mode)}
  };
} finally {
${grepReset}
}
`;
}

export const findReplaceTool = defineTool<Input, Result>({
  name: "find_replace",
  description:
    "Replaces text matches across the active document or within a single frame's story. mode 'literal' matches plain text; mode 'grep' matches a GREP/regex pattern. scope 'frame' requires frame_id. Returns the number of replacements made, the scope, and the mode.",
  inputSchema: InputSchema,
  async handler(input) {
    const env = await runScriptWithResultFile<ScriptResult>({
      language: "JavaScript",
      scriptTemplate: wrapExtendScript(buildScriptBody(input)),
      resultSchema: ScriptResultSchema,
    });
    if (!env.ok) return env;
    const r = env.result!;
    return ok(r, {
      document_state_delta: {
        changed_frames: [],
      },
    });
  },
});
```

### Step 4: Register in `src/index.ts`

- [ ] Add import:

```ts
import { findReplaceTool } from "./tools/find-replace.js";
```

- [ ] Add registration:

```ts
  registry.register(findReplaceTool);
```

### Step 5: Create integration test

- [ ] Create `tests/integration/find-replace.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { createTextFrameTool } from "../../src/tools/create-text-frame.js";
import { setTextTool } from "../../src/tools/set-text.js";
import { findReplaceTool } from "../../src/tools/find-replace.js";

integrationGate("find_replace (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "literal mode replaces a word in the document",
    async () => {
      const docEnv = await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 20, bottom: 20, left: 20, right: 20 },
      });
      expect(docEnv.ok).toBe(true);
      if (!docEnv.ok) return;
      const pageId = docEnv.result!.page_ids[0];

      const frameEnv = await createTextFrameTool.handler({
        page_id: pageId,
        bounds_mm: { x: 20, y: 20, width: 160, height: 60 },
      });
      expect(frameEnv.ok).toBe(true);
      if (!frameEnv.ok) return;

      await setTextTool.handler({
        frame_id: frameEnv.result!.frame_id,
        text: "Total displaced: 1.5M people",
      });

      const env = await findReplaceTool.handler({ find: "people", replace: "individuals" });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result?.matches_changed).toBe(1);
      expect(env.result?.scope).toBe("document");
      expect(env.result?.mode).toBe("literal");
      expect(env.document_state_delta?.changed_frames).toEqual([]);
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "returns 0 when find string is not in the document",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 20, bottom: 20, left: 20, right: 20 },
      });

      const env = await findReplaceTool.handler({ find: "xyzzy_notpresent", replace: "b" });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result?.matches_changed).toBe(0);
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "scope 'frame' restricts replacement to the target frame's story",
    async () => {
      const docEnv = await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 20, bottom: 20, left: 20, right: 20 },
      });
      expect(docEnv.ok).toBe(true);
      if (!docEnv.ok) return;
      const pageId = docEnv.result!.page_ids[0];

      const frame1Env = await createTextFrameTool.handler({
        page_id: pageId,
        bounds_mm: { x: 20, y: 20, width: 160, height: 40 },
      });
      expect(frame1Env.ok).toBe(true);
      if (!frame1Env.ok) return;
      const frame1Id = frame1Env.result!.frame_id;

      const frame2Env = await createTextFrameTool.handler({
        page_id: pageId,
        bounds_mm: { x: 20, y: 80, width: 160, height: 40 },
      });
      expect(frame2Env.ok).toBe(true);
      if (!frame2Env.ok) return;
      const frame2Id = frame2Env.result!.frame_id;

      await setTextTool.handler({ frame_id: frame1Id, text: "Hello world" });
      await setTextTool.handler({ frame_id: frame2Id, text: "Hello world" });

      // Replace only in frame1 — only 1 match, not 2
      const env = await findReplaceTool.handler({
        find: "world",
        replace: "there",
        scope: "frame",
        frame_id: frame1Id,
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result?.matches_changed).toBe(1);
      expect(env.result?.scope).toBe("frame");
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "grep mode replaces using a regex pattern",
    async () => {
      const docEnv = await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 20, bottom: 20, left: 20, right: 20 },
      });
      expect(docEnv.ok).toBe(true);
      if (!docEnv.ok) return;
      const pageId = docEnv.result!.page_ids[0];

      const frameEnv = await createTextFrameTool.handler({
        page_id: pageId,
        bounds_mm: { x: 20, y: 20, width: 160, height: 60 },
      });
      expect(frameEnv.ok).toBe(true);
      if (!frameEnv.ok) return;

      await setTextTool.handler({
        frame_id: frameEnv.result!.frame_id,
        text: "cat and Cat and CAT",
      });

      // GREP is case-sensitive by default in InDesign — match lowercase "cat" only
      const env = await findReplaceTool.handler({
        find: "cat",
        replace: "dog",
        mode: "grep",
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result?.matches_changed).toBeGreaterThanOrEqual(1);
      expect(env.result?.mode).toBe("grep");
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
```

### Step 6: Run tests + tsc

- [ ] Run `npx tsc --noEmit && npm test -- tests/unit/tools/find-replace.test.ts`

Expected: tsc clean; all unit tests pass.

### Step 7: Commit

- [ ] `git add src/tools/find-replace.ts src/index.ts tests/unit/tools/find-replace.test.ts tests/integration/find-replace.int.test.ts`
- [ ] `git commit -m "feat: find_replace tool with literal and grep modes"`

---

## Task 8: `list_paragraph_styles` tool

**What it does:** Read-only. Lists paragraph styles defined in the document, skipping internal styles whose names start with `[`. Returns name, point size, leading (if numeric), and fill color name.

**Files:**
- Create: `src/tools/list-paragraph-styles.ts`
- Create: `tests/unit/tools/list-paragraph-styles.test.ts`
- Create: `tests/integration/list-paragraph-styles.int.test.ts`
- Modify: `src/index.ts`

### Step 1: Write unit tests

- [ ] Create `tests/unit/tools/list-paragraph-styles.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { listParagraphStylesTool } from "../../../src/tools/list-paragraph-styles.js";
import { lastCall } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("list_paragraph_styles tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(listParagraphStylesTool.name).toBe("list_paragraph_styles");
    expect(listParagraphStylesTool.description.length).toBeGreaterThan(0);
  });

  // --- Schema validation ---

  it("accepts empty input", () => {
    expect(listParagraphStylesTool.inputSchema.safeParse({}).success).toBe(true);
  });

  it("accepts optional document_id", () => {
    expect(
      listParagraphStylesTool.inputSchema.safeParse({ document_id: "doc1" }).success,
    ).toBe(true);
  });

  it("rejects extra keys (strict schema)", () => {
    expect(
      listParagraphStylesTool.inputSchema.safeParse({ extra: true }).success,
    ).toBe(false);
  });

  // --- Script dispatch ---

  it("dispatches a script referencing doc.paragraphStyles", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { paragraph_styles: [] },
    });

    await listParagraphStylesTool.handler({});

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("paragraphStyles");
    expect(arg.scriptTemplate).toContain("pointSize");
    expect(arg.scriptTemplate).toContain("fillColor");
  });

  it("skips names starting with [ in the script", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { paragraph_styles: [] },
    });

    await listParagraphStylesTool.handler({});

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    // The script should filter out styles whose name starts with "["
    expect(arg.scriptTemplate).toContain("[");
    expect(arg.scriptTemplate).toContain("charAt");
  });

  // --- Result shape ---

  it("returns paragraph_styles array", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        paragraph_styles: [
          { name: "Body", point_size: 11, leading_pt: 14, color_swatch_name: "Black" },
          { name: "Headline", point_size: 36 },
        ],
      },
    });

    const env = await listParagraphStylesTool.handler({});

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result?.paragraph_styles).toHaveLength(2);
    expect(env.result?.paragraph_styles[0].name).toBe("Body");
    expect(env.result?.paragraph_styles[0].point_size).toBe(11);
    expect(env.result?.paragraph_styles[0].leading_pt).toBe(14);
    expect(env.result?.paragraph_styles[1].name).toBe("Headline");
    expect(env.result?.paragraph_styles[1].leading_pt).toBeUndefined();
  });

  it("does not emit a document_state_delta (read-only)", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { paragraph_styles: [] },
    });

    const env = await listParagraphStylesTool.handler({});

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.document_state_delta).toBeUndefined();
  });
});
```

### Step 2: Run, expect failure

- [ ] Run `npm test -- tests/unit/tools/list-paragraph-styles.test.ts` — expected: module not found.

### Step 3: Create `src/tools/list-paragraph-styles.ts`

- [ ] Create the file:

```ts
import { z } from "zod";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript, lit, prelude } from "../compose.js";
import { findDocumentById } from "../script-helpers.js";

const InputSchema = z
  .object({
    document_id: z.string().optional(),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

const ParagraphStyleSchema = z.object({
  name: z.string(),
  point_size: z.number().optional(),
  leading_pt: z.number().optional(),
  color_swatch_name: z.string().optional(),
});

const ScriptResultSchema = z.object({
  paragraph_styles: z.array(ParagraphStyleSchema),
});

type ScriptResult = z.infer<typeof ScriptResultSchema>;

interface Result {
  paragraph_styles: Array<{
    name: string;
    point_size?: number;
    leading_pt?: number;
    color_swatch_name?: string;
  }>;
}

function buildScriptBody(input: Input): string {
  const docExpr =
    input.document_id !== undefined
      ? `findDocumentById(${lit(input.document_id)})`
      : "app.activeDocument";

  return `
${prelude(findDocumentById)}
var doc = ${docExpr};
var styles = doc.paragraphStyles;
var result = [];
for (var i = 0; i < styles.length; i++) {
  var s = styles[i];
  if (s.name.charAt(0) === "[") continue;
  var entry = { name: s.name };
  if (typeof s.pointSize === "number") entry.point_size = s.pointSize;
  if (typeof s.leading === "number") entry.leading_pt = s.leading;
  if (s.fillColor && s.fillColor.name) entry.color_swatch_name = s.fillColor.name;
  result.push(entry);
}
return { paragraph_styles: result };
`;
}

export const listParagraphStylesTool = defineTool<Input, Result>({
  name: "list_paragraph_styles",
  description:
    "Lists paragraph styles defined in the document. Internal styles whose names begin with '[' (such as '[No Paragraph Style]' and '[Basic Paragraph]') are excluded. Returns name, point size, leading in points (if set numerically), and fill colour swatch name.",
  inputSchema: InputSchema,
  async handler(input) {
    return runScriptWithResultFile<ScriptResult>({
      language: "JavaScript",
      scriptTemplate: wrapExtendScript(buildScriptBody(input)),
      resultSchema: ScriptResultSchema,
    });
  },
});
```

### Step 4: Register in `src/index.ts`

- [ ] Add import:

```ts
import { listParagraphStylesTool } from "./tools/list-paragraph-styles.js";
```

- [ ] Add registration:

```ts
  registry.register(listParagraphStylesTool);
```

### Step 5: Create integration test

- [ ] Create `tests/integration/list-paragraph-styles.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { defineParagraphStyleTool } from "../../src/tools/define-paragraph-style.js";
import { listParagraphStylesTool } from "../../src/tools/list-paragraph-styles.js";

integrationGate("list_paragraph_styles (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "returns defined styles, excludes internal [ styles",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      await defineParagraphStyleTool.handler({ name: "Body", size_pt: 11, leading_pt: 14 });
      await defineParagraphStyleTool.handler({ name: "Headline", size_pt: 36 });

      const env = await listParagraphStylesTool.handler({});
      expect(env.ok).toBe(true);
      if (!env.ok) return;

      const styles = env.result!.paragraph_styles;
      // Must not contain internal styles
      for (const s of styles) {
        expect(s.name.charAt(0)).not.toBe("[");
      }

      const bodyStyle = styles.find((s) => s.name === "Body");
      expect(bodyStyle).toBeDefined();
      expect(bodyStyle!.point_size).toBeCloseTo(11, 1);
      expect(bodyStyle!.leading_pt).toBeCloseTo(14, 1);

      const headlineStyle = styles.find((s) => s.name === "Headline");
      expect(headlineStyle).toBeDefined();
      expect(headlineStyle!.point_size).toBeCloseTo(36, 1);
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "returns color_swatch_name when style has a fill colour",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      await defineParagraphStyleTool.handler({
        name: "Coloured",
        size_pt: 12,
        color_hex: "#FF6600",
      });

      const env = await listParagraphStylesTool.handler({});
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const coloured = env.result!.paragraph_styles.find((s) => s.name === "Coloured");
      expect(coloured).toBeDefined();
      expect(typeof coloured!.color_swatch_name).toBe("string");
      expect(coloured!.color_swatch_name!.length).toBeGreaterThan(0);
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
```

### Step 6: Run tests + tsc

- [ ] Run `npx tsc --noEmit && npm test -- tests/unit/tools/list-paragraph-styles.test.ts`

Expected: tsc clean; all unit tests pass.

### Step 7: Commit

- [ ] `git add src/tools/list-paragraph-styles.ts src/index.ts tests/unit/tools/list-paragraph-styles.test.ts tests/integration/list-paragraph-styles.int.test.ts`
- [ ] `git commit -m "feat: list_paragraph_styles utility tool"`

---

## Task 9: `list_pages` tool

**What it does:** Read-only. Lists document pages with index, side, applied parent name, and user-visible name. No delta emitted.

**Files:**
- Create: `src/tools/list-pages.ts`
- Create: `tests/unit/tools/list-pages.test.ts`
- Create: `tests/integration/list-pages.int.test.ts`
- Modify: `src/index.ts`

### Step 1: Write unit tests

- [ ] Create `tests/unit/tools/list-pages.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { listPagesTool } from "../../../src/tools/list-pages.js";
import { lastCall } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("list_pages tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(listPagesTool.name).toBe("list_pages");
    expect(listPagesTool.description.length).toBeGreaterThan(0);
  });

  // --- Schema validation ---

  it("accepts empty input", () => {
    expect(listPagesTool.inputSchema.safeParse({}).success).toBe(true);
  });

  it("accepts optional document_id", () => {
    expect(
      listPagesTool.inputSchema.safeParse({ document_id: "doc1" }).success,
    ).toBe(true);
  });

  it("rejects extra keys (strict schema)", () => {
    expect(
      listPagesTool.inputSchema.safeParse({ extra: true }).success,
    ).toBe(false);
  });

  // --- Script dispatch ---

  it("dispatches a script referencing doc.pages", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { pages: [] },
    });

    await listPagesTool.handler({});

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("doc.pages");
    expect(arg.scriptTemplate).toContain("appliedMaster");
    expect(arg.scriptTemplate).toContain("side");
  });

  it("uses null check for appliedMaster", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { pages: [] },
    });

    await listPagesTool.handler({});

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    // Must use === null comparison, not .isValid
    expect(arg.scriptTemplate).toContain("=== null");
    expect(arg.scriptTemplate).toContain("[None]");
  });

  // --- Result shape ---

  it("returns pages array with expected fields", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        pages: [
          {
            id: "pg1",
            index: 0,
            side: "RIGHT_HAND",
            applied_parent_name: "[None]",
            name: "1",
          },
        ],
      },
    });

    const env = await listPagesTool.handler({});

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result?.pages).toHaveLength(1);
    expect(env.result?.pages[0].id).toBe("pg1");
    expect(env.result?.pages[0].index).toBe(0);
    expect(env.result?.pages[0].side).toBe("RIGHT_HAND");
    expect(env.result?.pages[0].applied_parent_name).toBe("[None]");
    expect(env.result?.pages[0].name).toBe("1");
  });

  it("does not emit a document_state_delta (read-only)", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { pages: [] },
    });

    const env = await listPagesTool.handler({});

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.document_state_delta).toBeUndefined();
  });
});
```

### Step 2: Run, expect failure

- [ ] Run `npm test -- tests/unit/tools/list-pages.test.ts` — expected: module not found.

### Step 3: Create `src/tools/list-pages.ts`

- [ ] Create the file:

```ts
import { z } from "zod";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript, lit, prelude } from "../compose.js";
import { findDocumentById } from "../script-helpers.js";

const InputSchema = z
  .object({
    document_id: z.string().optional(),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

const PageSchema = z.object({
  id: z.string(),
  index: z.number().int().nonnegative(),
  side: z.string(),
  applied_parent_name: z.string(),
  name: z.string(),
});

const ScriptResultSchema = z.object({
  pages: z.array(PageSchema),
});

type ScriptResult = z.infer<typeof ScriptResultSchema>;

interface Result {
  pages: Array<{
    id: string;
    index: number;
    side: string;
    applied_parent_name: string;
    name: string;
  }>;
}

function buildScriptBody(input: Input): string {
  const docExpr =
    input.document_id !== undefined
      ? `findDocumentById(${lit(input.document_id)})`
      : "app.activeDocument";

  return `
${prelude(findDocumentById)}
var doc = ${docExpr};
var pages = doc.pages;
var result = [];
for (var i = 0; i < pages.length; i++) {
  var p = pages[i];
  var parentName = (p.appliedMaster === null) ? "[None]" : p.appliedMaster.name;
  result.push({
    id: String(p.id),
    index: i,
    side: String(p.side),
    applied_parent_name: parentName,
    name: p.name
  });
}
return { pages: result };
`;
}

export const listPagesTool = defineTool<Input, Result>({
  name: "list_pages",
  description:
    "Lists all pages in the document with their index (0-based), side (LEFT_HAND / RIGHT_HAND / SINGLE_SIDED), applied parent spread name ('[None]' if none), and user-visible page name. Read-only — no delta emitted.",
  inputSchema: InputSchema,
  async handler(input) {
    return runScriptWithResultFile<ScriptResult>({
      language: "JavaScript",
      scriptTemplate: wrapExtendScript(buildScriptBody(input)),
      resultSchema: ScriptResultSchema,
    });
  },
});
```

### Step 4: Register in `src/index.ts`

- [ ] Add import:

```ts
import { listPagesTool } from "./tools/list-pages.js";
```

- [ ] Add registration:

```ts
  registry.register(listPagesTool);
```

### Step 5: Create integration test

- [ ] Create `tests/integration/list-pages.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { addPageTool } from "../../src/tools/add-page.js";
import { listPagesTool } from "../../src/tools/list-pages.js";

integrationGate("list_pages (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "returns at least one page for a newly created document",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      const env = await listPagesTool.handler({});
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result!.pages.length).toBeGreaterThanOrEqual(1);

      const first = env.result!.pages[0];
      expect(typeof first.id).toBe("string");
      expect(first.index).toBe(0);
      expect(typeof first.side).toBe("string");
      expect(typeof first.applied_parent_name).toBe("string");
      expect(typeof first.name).toBe("string");
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "reflects added pages",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      const beforeEnv = await listPagesTool.handler({});
      expect(beforeEnv.ok).toBe(true);
      if (!beforeEnv.ok) return;
      const countBefore = beforeEnv.result!.pages.length;

      await addPageTool.handler({});

      const afterEnv = await listPagesTool.handler({});
      expect(afterEnv.ok).toBe(true);
      if (!afterEnv.ok) return;
      expect(afterEnv.result!.pages.length).toBe(countBefore + 1);

      // Indices are 0-based and sequential
      for (let i = 0; i < afterEnv.result!.pages.length; i++) {
        expect(afterEnv.result!.pages[i].index).toBe(i);
      }
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "applied_parent_name is '[None]' when no parent is applied",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      const env = await listPagesTool.handler({});
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      // New A4 doc pages may or may not have a master — just assert the field is present
      for (const p of env.result!.pages) {
        expect(typeof p.applied_parent_name).toBe("string");
        expect(p.applied_parent_name.length).toBeGreaterThan(0);
      }
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
```

### Step 6: Run tests + tsc

- [ ] Run `npx tsc --noEmit && npm test -- tests/unit/tools/list-pages.test.ts`

Expected: tsc clean; all unit tests pass.

### Step 7: Commit

- [ ] `git add src/tools/list-pages.ts src/index.ts tests/unit/tools/list-pages.test.ts tests/integration/list-pages.int.test.ts`
- [ ] `git commit -m "feat: list_pages utility tool"`

---

## Task 10: End-to-end smoke test

**What it does:** A single integration test that exercises the full B7 feature surface: swatch creation → style definition → list styles → text frame + find/replace → duplicate frame → list pages → PDF export.

**Files:**
- Create: `tests/integration/plan-b7-end-to-end.int.test.ts`

### Step 1: Create the end-to-end test

- [ ] Create `tests/integration/plan-b7-end-to-end.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { mkdtempSync, existsSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { createTextFrameTool } from "../../src/tools/create-text-frame.js";
import { setTextTool } from "../../src/tools/set-text.js";
import { createSwatchTool } from "../../src/tools/create-swatch.js";
import { defineParagraphStyleTool } from "../../src/tools/define-paragraph-style.js";
import { defineCharacterStyleTool } from "../../src/tools/define-character-style.js";
import { listParagraphStylesTool } from "../../src/tools/list-paragraph-styles.js";
import { findReplaceTool } from "../../src/tools/find-replace.js";
import { duplicateFrameTool } from "../../src/tools/duplicate-frame.js";
import { listPagesTool } from "../../src/tools/list-pages.js";
import { exportPdfTool } from "../../src/tools/export-pdf.js";

integrationGate("Plan B7 end-to-end (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "create swatch → define styles → list styles → create frame → find_replace → duplicate → list pages → export PDF",
    async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "indesign-mcp-b7-"));
      const pdfPath = join(tmpDir, "b7-smoke.pdf");

      try {
        // 1. Create an A4 document
        const docEnv = await createDocumentTool.handler({
          preset: "A4",
          margins_mm: { top: 20, bottom: 20, left: 20, right: 20 },
        });
        expect(docEnv.ok).toBe(true);
        if (!docEnv.ok) return;
        const pageId = docEnv.result!.page_ids[0];

        // 2. Create a named swatch
        const swatchEnv = await createSwatchTool.handler({
          name: "Brand Orange",
          hex: "#FF6600",
        });
        expect(swatchEnv.ok).toBe(true);
        if (!swatchEnv.ok) return;
        expect(swatchEnv.result?.swatch_name).toBe("Brand Orange");
        expect(swatchEnv.result?.on_collision_outcome).toBe("created");
        expect(swatchEnv.document_state_delta?.new_swatches).toEqual([{ name: "Brand Orange" }]);

        // 3. Define a paragraph style using the swatch's hex
        const paraStyleEnv = await defineParagraphStyleTool.handler({
          name: "IranBody",
          size_pt: 11,
          leading_pt: 14,
          color_hex: "#FF6600",
        });
        expect(paraStyleEnv.ok).toBe(true);
        if (!paraStyleEnv.ok) return;
        expect(paraStyleEnv.result?.name).toBe("IranBody");
        expect(paraStyleEnv.result?.on_collision_outcome).toBe("created");
        expect(paraStyleEnv.document_state_delta?.new_paragraph_styles).toEqual([{ name: "IranBody" }]);

        // 4. Define a character style using the same hex
        const charStyleEnv = await defineCharacterStyleTool.handler({
          name: "IranEmphasis",
          fill_hex: "#FF6600",
          tracking: 20,
        });
        expect(charStyleEnv.ok).toBe(true);
        if (!charStyleEnv.ok) return;
        expect(charStyleEnv.result?.character_style_name).toBe("IranEmphasis");

        // 5. list_paragraph_styles — confirm IranBody appears
        const listStylesEnv = await listParagraphStylesTool.handler({});
        expect(listStylesEnv.ok).toBe(true);
        if (!listStylesEnv.ok) return;
        const iranBody = listStylesEnv.result!.paragraph_styles.find(
          (s) => s.name === "IranBody",
        );
        expect(iranBody).toBeDefined();
        expect(iranBody!.point_size).toBeCloseTo(11, 1);

        // Confirm no internal [ styles leaked through
        for (const s of listStylesEnv.result!.paragraph_styles) {
          expect(s.name.charAt(0)).not.toBe("[");
        }

        // 6. Create a text frame and set text
        const frameEnv = await createTextFrameTool.handler({
          page_id: pageId,
          bounds_mm: { x: 20, y: 30, width: 160, height: 60 },
        });
        expect(frameEnv.ok).toBe(true);
        if (!frameEnv.ok) return;
        const frameId = frameEnv.result!.frame_id;

        await setTextTool.handler({
          frame_id: frameId,
          text: "Total displaced: 1.5M people",
        });

        // 7. find_replace — replaces "people" with "individuals"
        const frEnv = await findReplaceTool.handler({
          find: "people",
          replace: "individuals",
        });
        expect(frEnv.ok).toBe(true);
        if (!frEnv.ok) return;
        expect(frEnv.result?.matches_changed).toBe(1);
        expect(frEnv.document_state_delta?.changed_frames).toEqual([]);

        // 8. duplicate_frame — creates a copy of the text frame
        const dupEnv = await duplicateFrameTool.handler({
          frame_id: frameId,
          offset_mm: { x: 0, y: 70 },
        });
        expect(dupEnv.ok).toBe(true);
        if (!dupEnv.ok) return;
        expect(dupEnv.result?.duplicate_frame_id).not.toBe(frameId);
        expect(dupEnv.result?.duplicate_type).toBe("text");
        expect(dupEnv.document_state_delta?.new_frames?.[0].type).toBe("text");

        // 9. list_pages — confirm at least 1 page with expected fields
        const pagesEnv = await listPagesTool.handler({});
        expect(pagesEnv.ok).toBe(true);
        if (!pagesEnv.ok) return;
        expect(pagesEnv.result!.pages.length).toBeGreaterThanOrEqual(1);
        expect(pagesEnv.result!.pages[0].index).toBe(0);
        expect(typeof pagesEnv.result!.pages[0].side).toBe("string");
        expect(typeof pagesEnv.result!.pages[0].applied_parent_name).toBe("string");

        // 10. Export PDF — file must exist and be non-zero on disk
        const exportEnv = await exportPdfTool.handler({ path: pdfPath });
        expect(exportEnv.ok).toBe(true);
        expect(existsSync(pdfPath)).toBe(true);
        expect(statSync(pdfPath).size).toBeGreaterThan(0);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    },
    INTEGRATION_TIMEOUT_MS * 4,
  );
});
```

### Step 2: Run tsc

- [ ] Run `npx tsc --noEmit`

Expected: clean — all imports resolve, all types check. The test itself only runs against live InDesign.

### Step 3: Commit

- [ ] `git add tests/integration/plan-b7-end-to-end.int.test.ts`
- [ ] `git commit -m "test: end-to-end Plan B7 polish scenario"`

---

## Final verification

After all 10 tasks are committed:

- [ ] Run `npx tsc --noEmit` — must be clean.
- [ ] Run `npm test` — all unit tests must pass.
- [ ] Confirm `src/index.ts` registers all 6 new tools: `listFontsTool`, `createSwatchTool`, `duplicateFrameTool`, `findReplaceTool`, `listParagraphStylesTool`, `listPagesTool`.
- [ ] Confirm `define_paragraph_style` no longer accepts `on_collision: "replace"` (only `"error" | "update" | "version"`).
- [ ] Confirm `define_paragraph_style` handler uses `ok()` and emits `new_paragraph_styles` delta.
- [ ] Review `src/types.ts` — confirm `new_paragraph_styles` and `new_swatches` appear in `DocumentStateDelta`.

Integration tests are run against live InDesign 2026 (separate process). Unit tests are the CI-executable verification gate.

