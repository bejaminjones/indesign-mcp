# InDesign MCP — Plan B5 Implementation Plan (Inline Character Styling)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three tools (`define_character_style`, `apply_character_style_to_range`, `set_text_in_range`), the `findCharacterStyleByName` shared helper, and type-extension for character-style tracking.

**Architecture:** Same template as B1–B4: Zod input schema → server-side body builder using `lit()` and `prelude(...)` → handler dispatching via `runScriptWithResultFile<TScriptResult>` with `resultSchema` validation → optional `ok()` post-processing for `document_state_delta`.

**Tech Stack:** TypeScript 5.6+, Node 20+, MCP SDK, Zod, Vitest. No new runtime deps.

**Reference spec:** `docs/superpowers/specs/2026-05-06-indesign-mcp-plan-b5-design.md`

**Repository:** `~/Documents/GitHub/indesign-mcp/`. Create a feature branch `feat/plan-b5` before starting.

**Sandbox note:** Integration tests require InDesign 2026 running. Unit tests are the executable verification; integration tests run live.

---

## CRITICAL: Assertion hygiene — read before writing any test

**The #1 mistake from B4 plan execution:** writing `.toContain('"Accent"')` (with embedded quotes) in unit tests. Do NOT do this.

`wrapExtendScript` JSON-encodes the entire script body. A string like `"Accent"` becomes `\\"Accent\\"` in the encoded output. A bare-substring `.toContain()` on the value `Accent` (no quotes) is the only form that reliably matches regardless of encoding depth.

**Always write:** `.toContain("Accent")` — not `.toContain('"Accent"')`.

Additional test hygiene rules:
- `import { z } from "zod"` statically at the top of every file — never `await import("zod")`.
- Fail-loud: if a `.find()` result might be undefined, `expect(x).toBeDefined()` before using `x!`.
- ExtendScript is pre-ES5: no JSON, no ES6+, no arrow functions, no template literals.
- ES module imports use `.js` extensions even for `.ts` source files.
- Strict TS: no `any`.

---

## File Structure

```
src/
├── types.ts                                                   (modified, Task 1)
├── script-helpers.ts                                          (modified, Task 2)
├── tools/
│   ├── define-character-style.ts                             (created, Task 3)
│   ├── apply-character-style-to-range.ts                     (created, Task 4)
│   └── set-text-in-range.ts                                  (created, Task 5)
└── index.ts                                                   (modified, Tasks 3–5)

tests/
├── integration/
│   ├── define-character-style.int.test.ts                    (Task 3)
│   ├── apply-character-style-to-range.int.test.ts            (Task 4)
│   ├── set-text-in-range.int.test.ts                         (Task 5)
│   └── plan-b5-end-to-end.int.test.ts                        (Task 6)
└── unit/
    ├── types.test.ts                                          (modified, Task 1)
    ├── script-helpers.test.ts                                 (modified, Task 2)
    └── tools/
        ├── define-character-style.test.ts                    (created, Task 3)
        ├── apply-character-style-to-range.test.ts            (created, Task 4)
        └── set-text-in-range.test.ts                         (created, Task 5)
```

---

## Task 1: Type extensions — `new_character_styles` and `applied_character_style_range`

**Why:** `define_character_style` emits `new_character_styles` (mirrors `new_paragraph_styles` shape). `apply_character_style_to_range` enriches `changed_frames` entries with `applied_character_style_range`.

**Files:**
- Modify: `src/types.ts`
- Modify: `tests/unit/types.test.ts`

- [ ] **Step 1: Add failing tests**

Append to the `describe("DocumentStateDelta", ...)` block in `tests/unit/types.test.ts`:

```ts
  it("new_character_styles accepts an array of { name: string }", () => {
    const delta: DocumentStateDelta = {
      new_character_styles: [
        { name: "Accent" },
        { name: "Accent 2" },
      ],
    };
    expect(delta.new_character_styles?.[0].name).toBe("Accent");
    expect(delta.new_character_styles?.[1].name).toBe("Accent 2");
  });

  it("changed_frames items accept applied_character_style_range", () => {
    const delta: DocumentStateDelta = {
      changed_frames: [
        {
          id: "f1",
          applied_character_style_range: {
            character_style_name: "Accent",
            start_index: 10,
            end_index: 13,
          },
        },
        { id: "f2", bounds: [0, 0, 50, 100] },
      ],
    };
    expect(delta.changed_frames?.[0].applied_character_style_range?.character_style_name).toBe("Accent");
    expect(delta.changed_frames?.[0].applied_character_style_range?.start_index).toBe(10);
    expect(delta.changed_frames?.[0].applied_character_style_range?.end_index).toBe(13);
    expect(delta.changed_frames?.[1].applied_character_style_range).toBeUndefined();
  });
```

- [ ] **Step 2: Run, expect failure**

Run: `npx tsc --noEmit`
Expected: TS errors — `new_character_styles` and `applied_character_style_range` on `changed_frames` do not exist yet.

- [ ] **Step 3: Update `src/types.ts`**

Replace the `DocumentStateDelta` interface with:

```ts
export interface DocumentStateDelta {
  changed_frames?: Array<{
    id: FrameId;
    bounds?: [number, number, number, number];
    applied_paragraph_style?: string;
    applied_image_path?: string;
    applied_parent_name?: string;
    applied_character_style_range?: {           // NEW — from apply_character_style_to_range
      character_style_name: string;
      start_index: number;
      end_index: number;
    };
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
  new_character_styles?: Array<{ name: string }>;   // NEW — from define_character_style
}
```

- [ ] **Step 4: Run tests + tsc**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all existing tests still pass; the two new type-shape tests pass.

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/plan-b5
git add src/types.ts tests/unit/types.test.ts
git commit -m "feat: extend DocumentStateDelta with new_character_styles and applied_character_style_range"
```

---

## Task 2: `findCharacterStyleByName` script helper

**Why:** Both `apply_character_style_to_range` and `define_character_style` (for the update path) need to look up a character style by name. Mirrors `findStyleByName` (paragraph) and `findMasterSpreadByName` exactly.

**Files:**
- Modify: `src/script-helpers.ts`
- Modify: `tests/unit/script-helpers.test.ts`

- [ ] **Step 1: Add failing test**

Append to the `describe("script helpers", ...)` block in `tests/unit/script-helpers.test.ts`:

```ts
  it("findCharacterStyleByName is a non-empty function declaration", () => {
    expect(findCharacterStyleByName).toContain("function findCharacterStyleByName");
    expect(findCharacterStyleByName).toContain('throw { name: "not_found"');
    expect(findCharacterStyleByName).toContain("doc.characterStyles.itemByName");
    expect(findCharacterStyleByName).toContain('"character_style"');
  });
```

Update the import at the top of `tests/unit/script-helpers.test.ts` to add `findCharacterStyleByName`:

```ts
import { findDocumentById, findPageById, findFrameById, findStyleByName, resolveSwatch, findMasterSpreadByName, findCharacterStyleByName } from "../../src/script-helpers.js";
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/unit/script-helpers.test.ts`
Expected: import error — `findCharacterStyleByName` not exported yet.

- [ ] **Step 3: Add helper to `src/script-helpers.ts`**

Append to the end of `src/script-helpers.ts`:

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

- [ ] **Step 4: Run tests, expect pass**

Run: `npm test -- tests/unit/script-helpers.test.ts`
Expected: all pass, including the new test.

- [ ] **Step 5: Run full suite + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/script-helpers.ts tests/unit/script-helpers.test.ts
git commit -m "feat: findCharacterStyleByName script helper"
```

---

## Task 3: `define_character_style` tool

**Reference:** `src/tools/define-paragraph-style.ts` — the `on_collision` block is nearly identical, replacing `paragraphStyles` with `characterStyles`. The swatch path uses `resolveSwatch` from B3 exactly as in `define-paragraph-style.ts`.

**Files:**
- Create: `src/tools/define-character-style.ts`
- Create: `tests/unit/tools/define-character-style.test.ts`
- Create: `tests/integration/define-character-style.int.test.ts`
- Modify: `src/index.ts`

### Step 1: Write unit tests

- [ ] Create `tests/unit/tools/define-character-style.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineCharacterStyleTool } from "../../../src/tools/define-character-style.js";
import { lastCall, expectFailure } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("define_character_style tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(defineCharacterStyleTool.name).toBe("define_character_style");
    expect(defineCharacterStyleTool.description.length).toBeGreaterThan(0);
  });

  // --- Schema validation ---

  it("rejects input with no attributes (name only, nothing else)", () => {
    // At least one of font_family/font_style/point_size/fill_hex/tracking required
    expect(
      defineCharacterStyleTool.inputSchema.safeParse({ name: "Accent" }).success,
    ).toBe(false);
  });

  it("accepts name + font_family alone", () => {
    expect(
      defineCharacterStyleTool.inputSchema.safeParse({
        name: "Accent",
        font_family: "Helvetica Neue",
      }).success,
    ).toBe(true);
  });

  it("accepts name + point_size alone", () => {
    expect(
      defineCharacterStyleTool.inputSchema.safeParse({
        name: "Accent",
        point_size: 14,
      }).success,
    ).toBe(true);
  });

  it("accepts name + tracking alone", () => {
    expect(
      defineCharacterStyleTool.inputSchema.safeParse({
        name: "Accent",
        tracking: 50,
      }).success,
    ).toBe(true);
  });

  it("accepts name + fill_hex alone", () => {
    expect(
      defineCharacterStyleTool.inputSchema.safeParse({
        name: "Accent",
        fill_hex: "#FF6600",
      }).success,
    ).toBe(true);
  });

  it("rejects empty name", () => {
    expect(
      defineCharacterStyleTool.inputSchema.safeParse({
        name: "",
        font_family: "Helvetica",
      }).success,
    ).toBe(false);
  });

  it("rejects name longer than 60 chars", () => {
    expect(
      defineCharacterStyleTool.inputSchema.safeParse({
        name: "A".repeat(61),
        font_family: "Helvetica",
      }).success,
    ).toBe(false);
  });

  it("rejects invalid fill_hex format", () => {
    expect(
      defineCharacterStyleTool.inputSchema.safeParse({
        name: "Accent",
        fill_hex: "red",
      }).success,
    ).toBe(false);
    expect(
      defineCharacterStyleTool.inputSchema.safeParse({
        name: "Accent",
        fill_hex: "#XYZ000",
      }).success,
    ).toBe(false);
    expect(
      defineCharacterStyleTool.inputSchema.safeParse({
        name: "Accent",
        fill_hex: "#FF",
      }).success,
    ).toBe(false);
  });

  it("accepts valid fill_hex — both cases", () => {
    expect(
      defineCharacterStyleTool.inputSchema.safeParse({
        name: "Accent",
        fill_hex: "#FF6600",
      }).success,
    ).toBe(true);
    expect(
      defineCharacterStyleTool.inputSchema.safeParse({
        name: "Accent",
        fill_hex: "#ff6600",
      }).success,
    ).toBe(true);
  });

  it("rejects point_size <= 0", () => {
    expect(
      defineCharacterStyleTool.inputSchema.safeParse({
        name: "Accent",
        point_size: 0,
      }).success,
    ).toBe(false);
    expect(
      defineCharacterStyleTool.inputSchema.safeParse({
        name: "Accent",
        point_size: -1,
      }).success,
    ).toBe(false);
  });

  it("rejects tracking outside [-1000, 10000]", () => {
    expect(
      defineCharacterStyleTool.inputSchema.safeParse({
        name: "Accent",
        tracking: -1001,
      }).success,
    ).toBe(false);
    expect(
      defineCharacterStyleTool.inputSchema.safeParse({
        name: "Accent",
        tracking: 10001,
      }).success,
    ).toBe(false);
  });

  it("accepts on_collision values error / update / version", () => {
    for (const c of ["error", "update", "version"] as const) {
      expect(
        defineCharacterStyleTool.inputSchema.safeParse({
          name: "Accent",
          font_family: "Helvetica",
          on_collision: c,
        }).success,
      ).toBe(true);
    }
  });

  // --- Script dispatch ---

  it("dispatches a script that references characterStyles", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        character_style_name: "Accent",
        on_collision_outcome: "created",
      },
    });

    await defineCharacterStyleTool.handler({
      name: "Accent",
      font_family: "Helvetica Neue",
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("characterStyles");
    expect(arg.scriptTemplate).toContain("Accent");
  });

  it("dispatches a script that calls resolveSwatch when fill_hex provided", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        character_style_name: "Accent",
        on_collision_outcome: "created",
        fill_swatch_id: "sw1",
      },
    });

    await defineCharacterStyleTool.handler({
      name: "Accent",
      fill_hex: "#FF6600",
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("resolveSwatch");
    expect(arg.scriptTemplate).toContain("#FF6600");
  });

  it("uppercases fill_hex in the script", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        character_style_name: "Accent",
        on_collision_outcome: "created",
        fill_swatch_id: "sw2",
      },
    });

    await defineCharacterStyleTool.handler({
      name: "Accent",
      fill_hex: "#abcdef",
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("#ABCDEF");
  });

  it("dispatches a script with name_collision throw when on_collision is error", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        character_style_name: "Accent",
        on_collision_outcome: "created",
      },
    });

    await defineCharacterStyleTool.handler({
      name: "Accent",
      font_family: "Helvetica",
      on_collision: "error",
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("name_collision");
  });

  it("dispatches a script with version loop when on_collision is version", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        character_style_name: "Accent",
        on_collision_outcome: "created",
      },
    });

    await defineCharacterStyleTool.handler({
      name: "Accent",
      font_family: "Helvetica",
      on_collision: "version",
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    // version loop increments a counter — look for the loop structure
    expect(arg.scriptTemplate).toContain("baseName");
  });

  // --- Result shape ---

  it("returns character_style_name and on_collision_outcome", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        character_style_name: "Accent",
        on_collision_outcome: "created",
      },
    });

    const env = await defineCharacterStyleTool.handler({
      name: "Accent",
      font_family: "Helvetica",
    });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result?.character_style_name).toBe("Accent");
    expect(env.result?.on_collision_outcome).toBe("created");
  });

  it("returns fill_swatch_id when fill_hex provided", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        character_style_name: "Accent",
        on_collision_outcome: "created",
        fill_swatch_id: "sw3",
      },
    });

    const env = await defineCharacterStyleTool.handler({
      name: "Accent",
      fill_hex: "#FF0000",
    });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result?.fill_swatch_id).toBe("sw3");
  });

  it("propagates name_collision failures verbatim", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: { kind: "name_collision", message: "character style Accent already exists" },
    });

    const env = await defineCharacterStyleTool.handler({
      name: "Accent",
      font_family: "Helvetica",
    });

    expectFailure(env);
    expect(env.error.kind).toBe("name_collision");
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/unit/tools/define-character-style.test.ts`
Expected: import error — `define-character-style.ts` does not exist yet.

### Step 3: Create the tool

- [ ] Create `src/tools/define-character-style.ts`:

```ts
import { z } from "zod";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript, lit, prelude } from "../compose.js";
import { findDocumentById, resolveSwatch } from "../script-helpers.js";

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

const InputSchema = z
  .object({
    name: z.string().min(1).max(60),
    font_family: z.string().optional(),
    font_style: z.string().optional(),
    point_size: z.number().positive().optional(),
    fill_hex: z.string().regex(HEX_COLOR_RE).optional(),
    tracking: z.number().int().min(-1000).max(10000).optional(),
    on_collision: z.enum(["error", "update", "version"]).optional(),
    document_id: z.string().optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.font_family !== undefined ||
      data.font_style !== undefined ||
      data.point_size !== undefined ||
      data.fill_hex !== undefined ||
      data.tracking !== undefined,
    { message: "at least one attribute (font_family, font_style, point_size, fill_hex, or tracking) is required" },
  );

type Input = z.infer<typeof InputSchema>;

const ScriptResultSchema = z.object({
  character_style_name: z.string(),
  on_collision_outcome: z.enum(["created", "updated", "versioned"]),
  fill_swatch_id: z.string().optional(),
});

type ScriptResult = z.infer<typeof ScriptResultSchema>;

interface Result {
  character_style_name: string;
  on_collision_outcome: "created" | "updated" | "versioned";
  fill_swatch_id?: string;
}

function buildScriptBody(input: Input): string {
  const docExpr =
    input.document_id !== undefined
      ? `findDocumentById(${lit(input.document_id)})`
      : "app.activeDocument";

  const onCollision = input.on_collision ?? "error";

  // Color setup
  let colorSetup = "var swatchId;";
  if (input.fill_hex !== undefined) {
    const upperHex = input.fill_hex.toUpperCase();
    colorSetup = `
      var swatch = resolveSwatch(doc, ${lit(upperHex)});
      var swatchId = String(swatch.id);
    `;
  }

  // Font setup — stored separately because it uses appliedFont property
  let fontSetup = "";
  if (input.font_family !== undefined) {
    const fontName =
      input.font_style !== undefined
        ? `${input.font_family}\t${input.font_style}`
        : input.font_family;
    fontSetup = `style.appliedFont = ${lit(fontName)};`;
  }

  // Attribute assignments
  const attrs: string[] = [];
  if (input.point_size !== undefined) attrs.push(`style.pointSize = ${input.point_size};`);
  if (input.tracking !== undefined) attrs.push(`style.tracking = ${input.tracking};`);
  if (input.fill_hex !== undefined) attrs.push(`style.fillColor = swatch;`);

  // on_collision block — mirrors define-paragraph-style.ts exactly
  const collisionBlock =
    onCollision === "error"
      ? `
        var existing = doc.characterStyles.itemByName(name);
        if (existing.isValid) {
          throw { name: "name_collision", message: "character style \\"" + name + "\\" already exists", entity: "character_style", id: name };
        }
        var style = doc.characterStyles.add({ name: name });
        var outcome = "created";
      `
      : onCollision === "update"
        ? `
        var existing = doc.characterStyles.itemByName(name);
        var style;
        var outcome;
        if (existing.isValid) {
          style = existing;
          outcome = "updated";
        } else {
          style = doc.characterStyles.add({ name: name });
          outcome = "created";
        }
      `
        : `
        var baseName = name;
        var i = 2;
        while (doc.characterStyles.itemByName(name).isValid) {
          name = baseName + " " + i;
          i++;
        }
        var style = doc.characterStyles.add({ name: name });
        var outcome = "versioned";
      `;

  return `
${prelude(findDocumentById, resolveSwatch)}
var doc = ${docExpr};
var name = ${lit(input.name)};
${collisionBlock}
${colorSetup}
${fontSetup}
${attrs.join("\n")}
var result = {
  character_style_name: name,
  on_collision_outcome: outcome
};
if (swatchId !== undefined) result.fill_swatch_id = swatchId;
return result;
`;
}

export const defineCharacterStyleTool = defineTool<Input, Result>({
  name: "define_character_style",
  description:
    "Creates or updates a character style with optional font, weight, size, fill colour, and tracking. At least one attribute must be provided. Auto-creates an RGB swatch when fill_hex is given. Returns the final style name (may differ from input when on_collision is 'version').",
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

- [ ] **Step 4: Run unit tests, expect pass**

Run: `npm test -- tests/unit/tools/define-character-style.test.ts`
Expected: all pass.

- [ ] **Step 5: Register the tool in `src/index.ts`**

Add after the `insertPageNumberMarkerTool` import:

```ts
import { defineCharacterStyleTool } from "./tools/define-character-style.js";
```

Add after `registry.register(insertPageNumberMarkerTool)`:

```ts
registry.register(defineCharacterStyleTool);
```

- [ ] **Step 6: Run full suite + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, tsc clean.

- [ ] **Step 7: Write integration test**

Create `tests/integration/define-character-style.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { defineCharacterStyleTool } from "../../src/tools/define-character-style.js";

integrationGate("define_character_style (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "creates a character style with font_family",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      const env = await defineCharacterStyleTool.handler({
        name: "Emphasis",
        font_family: "Helvetica Neue",
        font_style: "Italic",
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result?.character_style_name).toBe("Emphasis");
      expect(env.result?.on_collision_outcome).toBe("created");
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "creates a character style with fill_hex, returns fill_swatch_id",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      const env = await defineCharacterStyleTool.handler({
        name: "Accent",
        fill_hex: "#FF6600",
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result?.character_style_name).toBe("Accent");
      expect(typeof env.result?.fill_swatch_id).toBe("string");
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "name_collision when style exists and on_collision is 'error'",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      const first = await defineCharacterStyleTool.handler({
        name: "Accent",
        fill_hex: "#FF0000",
      });
      expect(first.ok).toBe(true);

      const second = await defineCharacterStyleTool.handler({
        name: "Accent",
        fill_hex: "#0000FF",
        on_collision: "error",
      });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.kind).toBe("name_collision");
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "on_collision 'update' modifies the existing style without creating a new one",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      await defineCharacterStyleTool.handler({
        name: "Accent",
        fill_hex: "#FF0000",
      });

      const env = await defineCharacterStyleTool.handler({
        name: "Accent",
        fill_hex: "#0000FF",
        on_collision: "update",
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result?.character_style_name).toBe("Accent");
      expect(env.result?.on_collision_outcome).toBe("updated");
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "on_collision 'version' creates 'Accent 2' when 'Accent' exists",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      await defineCharacterStyleTool.handler({
        name: "Accent",
        fill_hex: "#FF0000",
      });

      const env = await defineCharacterStyleTool.handler({
        name: "Accent",
        fill_hex: "#0000FF",
        on_collision: "version",
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result?.character_style_name).toBe("Accent 2");
      expect(env.result?.on_collision_outcome).toBe("versioned");
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
```

- [ ] **Step 8: Commit**

```bash
git add src/tools/define-character-style.ts src/index.ts tests/unit/tools/define-character-style.test.ts tests/integration/define-character-style.int.test.ts
git commit -m "feat: define_character_style tool"
```

---

## Task 4: `apply_character_style_to_range` tool

**Files:**
- Create: `src/tools/apply-character-style-to-range.ts`
- Create: `tests/unit/tools/apply-character-style-to-range.test.ts`
- Create: `tests/integration/apply-character-style-to-range.int.test.ts`
- Modify: `src/index.ts`

### Step 1: Write unit tests

- [ ] Create `tests/unit/tools/apply-character-style-to-range.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyCharacterStyleToRangeTool } from "../../../src/tools/apply-character-style-to-range.js";
import { lastCall, expectFailure } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("apply_character_style_to_range tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(applyCharacterStyleToRangeTool.name).toBe("apply_character_style_to_range");
    expect(applyCharacterStyleToRangeTool.description.length).toBeGreaterThan(0);
  });

  // --- Schema validation ---

  it("accepts valid minimal input", () => {
    expect(
      applyCharacterStyleToRangeTool.inputSchema.safeParse({
        frame_id: "f1",
        character_style_name: "Accent",
        start_index: 0,
        end_index: 5,
      }).success,
    ).toBe(true);
  });

  it("rejects empty frame_id", () => {
    expect(
      applyCharacterStyleToRangeTool.inputSchema.safeParse({
        frame_id: "",
        character_style_name: "Accent",
        start_index: 0,
        end_index: 5,
      }).success,
    ).toBe(false);
  });

  it("rejects empty character_style_name", () => {
    expect(
      applyCharacterStyleToRangeTool.inputSchema.safeParse({
        frame_id: "f1",
        character_style_name: "",
        start_index: 0,
        end_index: 5,
      }).success,
    ).toBe(false);
  });

  it("rejects start_index < 0", () => {
    expect(
      applyCharacterStyleToRangeTool.inputSchema.safeParse({
        frame_id: "f1",
        character_style_name: "Accent",
        start_index: -1,
        end_index: 5,
      }).success,
    ).toBe(false);
  });

  it("rejects end_index <= start_index", () => {
    expect(
      applyCharacterStyleToRangeTool.inputSchema.safeParse({
        frame_id: "f1",
        character_style_name: "Accent",
        start_index: 5,
        end_index: 5,
      }).success,
    ).toBe(false);
    expect(
      applyCharacterStyleToRangeTool.inputSchema.safeParse({
        frame_id: "f1",
        character_style_name: "Accent",
        start_index: 5,
        end_index: 3,
      }).success,
    ).toBe(false);
  });

  it("accepts optional document_id", () => {
    expect(
      applyCharacterStyleToRangeTool.inputSchema.safeParse({
        frame_id: "f1",
        character_style_name: "Accent",
        start_index: 0,
        end_index: 5,
        document_id: "doc1",
      }).success,
    ).toBe(true);
  });

  // --- Script dispatch ---

  it("dispatches a script that references itemByRange with end_index - 1", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        frame_id: "f1",
        character_style_name: "Accent",
        start_index: 10,
        end_index: 13,
        applied_chars: 3,
      },
    });

    await applyCharacterStyleToRangeTool.handler({
      frame_id: "f1",
      character_style_name: "Accent",
      start_index: 10,
      end_index: 13,
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("itemByRange");
    // end_index - 1 = 12 — verify the translated value appears
    expect(arg.scriptTemplate).toContain("12");
    expect(arg.scriptTemplate).toContain("applyCharacterStyle");
  });

  it("dispatches a script that bounds-checks end_index against story length", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        frame_id: "f1",
        character_style_name: "Accent",
        start_index: 0,
        end_index: 5,
        applied_chars: 5,
      },
    });

    await applyCharacterStyleToRangeTool.handler({
      frame_id: "f1",
      character_style_name: "Accent",
      start_index: 0,
      end_index: 5,
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("characters.length");
    expect(arg.scriptTemplate).toContain("invalid_args");
  });

  it("dispatches a script that calls findCharacterStyleByName", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        frame_id: "f1",
        character_style_name: "Accent",
        start_index: 0,
        end_index: 5,
        applied_chars: 5,
      },
    });

    await applyCharacterStyleToRangeTool.handler({
      frame_id: "f1",
      character_style_name: "Accent",
      start_index: 0,
      end_index: 5,
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("findCharacterStyleByName");
    expect(arg.scriptTemplate).toContain("Accent");
  });

  // --- Result shape ---

  it("returns frame_id, character_style_name, start_index, end_index, applied_chars", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        frame_id: "f1",
        character_style_name: "Accent",
        start_index: 10,
        end_index: 13,
        applied_chars: 3,
      },
    });

    const env = await applyCharacterStyleToRangeTool.handler({
      frame_id: "f1",
      character_style_name: "Accent",
      start_index: 10,
      end_index: 13,
    });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result?.frame_id).toBe("f1");
    expect(env.result?.character_style_name).toBe("Accent");
    expect(env.result?.start_index).toBe(10);
    expect(env.result?.end_index).toBe(13);
    expect(env.result?.applied_chars).toBe(3);
  });

  it("propagates not_found failures verbatim", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: { kind: "not_found", message: "character style Accent not found" },
    });

    const env = await applyCharacterStyleToRangeTool.handler({
      frame_id: "f1",
      character_style_name: "Accent",
      start_index: 0,
      end_index: 5,
    });

    expectFailure(env);
    expect(env.error.kind).toBe("not_found");
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/unit/tools/apply-character-style-to-range.test.ts`
Expected: import error — `apply-character-style-to-range.ts` does not exist yet.

### Step 3: Create the tool

- [ ] Create `src/tools/apply-character-style-to-range.ts`:

```ts
import { z } from "zod";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript, lit, prelude } from "../compose.js";
import { findDocumentById, findFrameById, findCharacterStyleByName } from "../script-helpers.js";

const InputSchema = z
  .object({
    frame_id: z.string().min(1),
    character_style_name: z.string().min(1),
    start_index: z.number().int().min(0),
    end_index: z.number().int(),
    document_id: z.string().optional(),
  })
  .strict()
  .refine((data) => data.end_index > data.start_index, {
    message: "end_index must be greater than start_index",
    path: ["end_index"],
  });

type Input = z.infer<typeof InputSchema>;

const ScriptResultSchema = z.object({
  frame_id: z.string(),
  character_style_name: z.string(),
  start_index: z.number().int(),
  end_index: z.number().int(),
  applied_chars: z.number().int(),
});

type ScriptResult = z.infer<typeof ScriptResultSchema>;

interface Result {
  frame_id: string;
  character_style_name: string;
  start_index: number;
  end_index: number;
  applied_chars: number;
}

function buildScriptBody(input: Input): string {
  const docExpr =
    input.document_id !== undefined
      ? `findDocumentById(${lit(input.document_id)})`
      : "app.activeDocument";

  // Translate exclusive end_index to InDesign's inclusive end (itemByRange uses inclusive).
  const inclusiveEnd = input.end_index - 1;

  return `
${prelude(findDocumentById, findFrameById, findCharacterStyleByName)}
var doc = ${docExpr};
var frame = findFrameById(doc, ${lit(input.frame_id)});
if (frame.constructor.name !== "TextFrame") {
  throw { name: "invalid_args", message: "frame " + ${lit(input.frame_id)} + " is not a text frame", entity: "frame", id: ${lit(input.frame_id)} };
}
var storyLen = frame.parentStory.characters.length;
if (${input.end_index} > storyLen) {
  throw { name: "invalid_args", message: "end_index " + ${input.end_index} + " exceeds story length " + storyLen, entity: "frame", id: ${lit(input.frame_id)} };
}
var style = findCharacterStyleByName(doc, ${lit(input.character_style_name)});
var range = frame.parentStory.characters.itemByRange(${input.start_index}, ${inclusiveEnd});
range.applyCharacterStyle(style);
return {
  frame_id: ${lit(input.frame_id)},
  character_style_name: ${lit(input.character_style_name)},
  start_index: ${input.start_index},
  end_index: ${input.end_index},
  applied_chars: ${input.end_index - input.start_index}
};
`;
}

export const applyCharacterStyleToRangeTool = defineTool<Input, Result>({
  name: "apply_character_style_to_range",
  description:
    "Applies a named character style to a character range within a text frame. start_index is 0-based inclusive; end_index is exclusive (JavaScript slice convention). The frame must be a text frame. The character style must already exist.",
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

- [ ] **Step 4: Run unit tests, expect pass**

Run: `npm test -- tests/unit/tools/apply-character-style-to-range.test.ts`
Expected: all pass.

- [ ] **Step 5: Register the tool in `src/index.ts`**

Add after the `defineCharacterStyleTool` import:

```ts
import { applyCharacterStyleToRangeTool } from "./tools/apply-character-style-to-range.js";
```

Add after `registry.register(defineCharacterStyleTool)`:

```ts
registry.register(applyCharacterStyleToRangeTool);
```

- [ ] **Step 6: Run full suite + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, tsc clean.

- [ ] **Step 7: Write integration test**

Create `tests/integration/apply-character-style-to-range.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { createTextFrameTool } from "../../src/tools/create-text-frame.js";
import { setTextTool } from "../../src/tools/set-text.js";
import { defineCharacterStyleTool } from "../../src/tools/define-character-style.js";
import { applyCharacterStyleToRangeTool } from "../../src/tools/apply-character-style-to-range.js";

integrationGate("apply_character_style_to_range (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "applies a character style to a mid-word range",
    async () => {
      const doc = await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });
      expect(doc.ok).toBe(true);
      if (!doc.ok) return;

      const frame = await createTextFrameTool.handler({
        page_id: doc.result!.page_ids[0],
        bounds_mm: { x: 12, y: 12, width: 186, height: 50 },
      });
      expect(frame.ok).toBe(true);
      if (!frame.ok) return;

      await setTextTool.handler({
        frame_id: frame.result!.frame_id,
        text: "Hello world",
      });

      await defineCharacterStyleTool.handler({
        name: "Accent",
        fill_hex: "#FF0000",
      });

      // Apply "Accent" to "world" (chars 6..11)
      const env = await applyCharacterStyleToRangeTool.handler({
        frame_id: frame.result!.frame_id,
        character_style_name: "Accent",
        start_index: 6,
        end_index: 11,
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result?.applied_chars).toBe(5);
      expect(env.result?.character_style_name).toBe("Accent");
      expect(env.document_state_delta?.changed_frames?.[0].id).toBe(frame.result!.frame_id);
      expect(env.document_state_delta?.changed_frames?.[0].applied_character_style_range?.character_style_name).toBe("Accent");
      expect(env.document_state_delta?.changed_frames?.[0].applied_character_style_range?.start_index).toBe(6);
      expect(env.document_state_delta?.changed_frames?.[0].applied_character_style_range?.end_index).toBe(11);
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "returns not_found for a missing character style",
    async () => {
      const doc = await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });
      expect(doc.ok).toBe(true);
      if (!doc.ok) return;

      const frame = await createTextFrameTool.handler({
        page_id: doc.result!.page_ids[0],
        bounds_mm: { x: 12, y: 12, width: 186, height: 50 },
      });
      expect(frame.ok).toBe(true);
      if (!frame.ok) return;

      await setTextTool.handler({
        frame_id: frame.result!.frame_id,
        text: "Hello",
      });

      const env = await applyCharacterStyleToRangeTool.handler({
        frame_id: frame.result!.frame_id,
        character_style_name: "DoesNotExist",
        start_index: 0,
        end_index: 5,
      });
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.kind).toBe("not_found");
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "returns invalid_args when end_index exceeds story length",
    async () => {
      const doc = await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });
      expect(doc.ok).toBe(true);
      if (!doc.ok) return;

      const frame = await createTextFrameTool.handler({
        page_id: doc.result!.page_ids[0],
        bounds_mm: { x: 12, y: 12, width: 186, height: 50 },
      });
      expect(frame.ok).toBe(true);
      if (!frame.ok) return;

      await setTextTool.handler({
        frame_id: frame.result!.frame_id,
        text: "Hi",  // 2 chars
      });

      await defineCharacterStyleTool.handler({
        name: "Accent",
        fill_hex: "#FF0000",
      });

      const env = await applyCharacterStyleToRangeTool.handler({
        frame_id: frame.result!.frame_id,
        character_style_name: "Accent",
        start_index: 0,
        end_index: 100,  // way beyond story
      });
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.kind).toBe("invalid_args");
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
```

- [ ] **Step 8: Commit**

```bash
git add src/tools/apply-character-style-to-range.ts src/index.ts tests/unit/tools/apply-character-style-to-range.test.ts tests/integration/apply-character-style-to-range.int.test.ts
git commit -m "feat: apply_character_style_to_range tool"
```

---

## Task 5: `set_text_in_range` tool

**Reference:** `src/tools/set-text.ts` for the `\r` normalization pattern. The in-range variant shares the same normalization logic but operates on a character range rather than the full frame contents.

**Files:**
- Create: `src/tools/set-text-in-range.ts`
- Create: `tests/unit/tools/set-text-in-range.test.ts`
- Create: `tests/integration/set-text-in-range.int.test.ts`
- Modify: `src/index.ts`

### Step 1: Write unit tests

- [ ] Create `tests/unit/tools/set-text-in-range.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setTextInRangeTool } from "../../../src/tools/set-text-in-range.js";
import { lastCall, expectFailure } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("set_text_in_range tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(setTextInRangeTool.name).toBe("set_text_in_range");
    expect(setTextInRangeTool.description.length).toBeGreaterThan(0);
  });

  // --- Schema validation ---

  it("accepts valid input with non-empty text", () => {
    expect(
      setTextInRangeTool.inputSchema.safeParse({
        frame_id: "f1",
        start_index: 0,
        end_index: 5,
        text: "world",
      }).success,
    ).toBe(true);
  });

  it("accepts empty text (deletion)", () => {
    expect(
      setTextInRangeTool.inputSchema.safeParse({
        frame_id: "f1",
        start_index: 0,
        end_index: 5,
        text: "",
      }).success,
    ).toBe(true);
  });

  it("rejects empty frame_id", () => {
    expect(
      setTextInRangeTool.inputSchema.safeParse({
        frame_id: "",
        start_index: 0,
        end_index: 5,
        text: "hi",
      }).success,
    ).toBe(false);
  });

  it("rejects start_index < 0", () => {
    expect(
      setTextInRangeTool.inputSchema.safeParse({
        frame_id: "f1",
        start_index: -1,
        end_index: 5,
        text: "hi",
      }).success,
    ).toBe(false);
  });

  it("rejects end_index <= start_index", () => {
    expect(
      setTextInRangeTool.inputSchema.safeParse({
        frame_id: "f1",
        start_index: 5,
        end_index: 5,
        text: "hi",
      }).success,
    ).toBe(false);
    expect(
      setTextInRangeTool.inputSchema.safeParse({
        frame_id: "f1",
        start_index: 6,
        end_index: 3,
        text: "hi",
      }).success,
    ).toBe(false);
  });

  it("accepts optional document_id", () => {
    expect(
      setTextInRangeTool.inputSchema.safeParse({
        frame_id: "f1",
        start_index: 0,
        end_index: 5,
        text: "hello",
        document_id: "doc1",
      }).success,
    ).toBe(true);
  });

  // --- Normalization ---

  it("normalizes CRLF to CR before dispatching", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        frame_id: "f1",
        removed_chars: 5,
        inserted_chars: 3,
        total_length_after: 8,
      },
    });

    await setTextInRangeTool.handler({
      frame_id: "f1",
      start_index: 0,
      end_index: 5,
      text: "a\r\nb",
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    // After normalization \r\n → \r, the text is "a\rb". Encoded in the script it won't
    // contain the literal \n (which would indicate un-normalized input).
    // The script body should contain the CR-only form.
    expect(arg.scriptTemplate).not.toContain("\\n");
  });

  it("normalizes bare LF to CR before dispatching", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        frame_id: "f1",
        removed_chars: 5,
        inserted_chars: 3,
        total_length_after: 8,
      },
    });

    await setTextInRangeTool.handler({
      frame_id: "f1",
      start_index: 0,
      end_index: 5,
      text: "a\nb",
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).not.toContain("\\n");
  });

  // --- Script dispatch ---

  it("dispatches a script that uses itemByRange and sets contents", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        frame_id: "f1",
        removed_chars: 5,
        inserted_chars: 5,
        total_length_after: 10,
      },
    });

    await setTextInRangeTool.handler({
      frame_id: "f1",
      start_index: 0,
      end_index: 5,
      text: "world",
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("itemByRange");
    expect(arg.scriptTemplate).toContain("range.contents");
  });

  it("dispatches a script that bounds-checks end_index", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        frame_id: "f1",
        removed_chars: 5,
        inserted_chars: 5,
        total_length_after: 10,
      },
    });

    await setTextInRangeTool.handler({
      frame_id: "f1",
      start_index: 0,
      end_index: 5,
      text: "world",
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("characters.length");
    expect(arg.scriptTemplate).toContain("invalid_args");
  });

  it("dispatches a script that reads total_length_after from parentStory.length", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        frame_id: "f1",
        removed_chars: 5,
        inserted_chars: 5,
        total_length_after: 10,
      },
    });

    await setTextInRangeTool.handler({
      frame_id: "f1",
      start_index: 0,
      end_index: 5,
      text: "world",
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("parentStory.length");
  });

  // --- Result shape ---

  it("returns frame_id, removed_chars, inserted_chars, total_length_after", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        frame_id: "f1",
        removed_chars: 6,
        inserted_chars: 11,
        total_length_after: 30,
      },
    });

    const env = await setTextInRangeTool.handler({
      frame_id: "f1",
      start_index: 7,
      end_index: 13,
      text: "individuals",
    });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result?.frame_id).toBe("f1");
    expect(env.result?.removed_chars).toBe(6);
    expect(env.result?.inserted_chars).toBe(11);
    expect(env.result?.total_length_after).toBe(30);
  });

  it("propagates not_found failures verbatim", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: { kind: "not_found", message: "frame f1 not found" },
    });

    const env = await setTextInRangeTool.handler({
      frame_id: "f1",
      start_index: 0,
      end_index: 5,
      text: "hi",
    });

    expectFailure(env);
    expect(env.error.kind).toBe("not_found");
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/unit/tools/set-text-in-range.test.ts`
Expected: import error — `set-text-in-range.ts` does not exist yet.

### Step 3: Create the tool

- [ ] Create `src/tools/set-text-in-range.ts`:

```ts
import { z } from "zod";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript, lit, prelude } from "../compose.js";
import { findDocumentById, findFrameById } from "../script-helpers.js";

const InputSchema = z
  .object({
    frame_id: z.string().min(1),
    start_index: z.number().int().min(0),
    end_index: z.number().int(),
    text: z.string(),
    document_id: z.string().optional(),
  })
  .strict()
  .refine((data) => data.end_index > data.start_index, {
    message: "end_index must be greater than start_index",
    path: ["end_index"],
  });

type Input = z.infer<typeof InputSchema>;

const ScriptResultSchema = z.object({
  frame_id: z.string(),
  removed_chars: z.number().int().nonnegative(),
  inserted_chars: z.number().int().nonnegative(),
  total_length_after: z.number().int().nonnegative(),
});

type ScriptResult = z.infer<typeof ScriptResultSchema>;

interface Result {
  frame_id: string;
  removed_chars: number;
  inserted_chars: number;
  total_length_after: number;
}

function buildScriptBody(input: Input): string {
  const docExpr =
    input.document_id !== undefined
      ? `findDocumentById(${lit(input.document_id)})`
      : "app.activeDocument";

  // Translate exclusive end_index to InDesign's inclusive end (itemByRange uses inclusive).
  const inclusiveEnd = input.end_index - 1;
  const removedChars = input.end_index - input.start_index;

  return `
${prelude(findDocumentById, findFrameById)}
var doc = ${docExpr};
var frame = findFrameById(doc, ${lit(input.frame_id)});
if (frame.constructor.name !== "TextFrame") {
  throw { name: "invalid_args", message: "frame " + ${lit(input.frame_id)} + " is not a text frame", entity: "frame", id: ${lit(input.frame_id)} };
}
var storyLen = frame.parentStory.characters.length;
if (${input.end_index} > storyLen) {
  throw { name: "invalid_args", message: "end_index " + ${input.end_index} + " exceeds story length " + storyLen, entity: "frame", id: ${lit(input.frame_id)} };
}
var range = frame.parentStory.characters.itemByRange(${input.start_index}, ${inclusiveEnd});
range.contents = ${lit(input.text)};
return {
  frame_id: ${lit(input.frame_id)},
  removed_chars: ${removedChars},
  inserted_chars: ${input.text.length},
  total_length_after: frame.parentStory.length
};
`;
}

export const setTextInRangeTool = defineTool<Input, Result>({
  name: "set_text_in_range",
  description:
    "Replaces text within a character range in a text frame, leaving surrounding text and styling intact. start_index is 0-based inclusive; end_index is exclusive. text may be empty to delete the range. Paragraph separators: use \\n (normalized to InDesign's \\r internally).",
  inputSchema: InputSchema,
  async handler(input) {
    // InDesign uses \r as paragraph separator. Normalize CRLF and LF to CR.
    const normalizedText = input.text.replace(/\r\n|\n/g, "\r");
    return runScriptWithResultFile<ScriptResult>({
      language: "JavaScript",
      scriptTemplate: wrapExtendScript(buildScriptBody({ ...input, text: normalizedText })),
      resultSchema: ScriptResultSchema,
    });
  },
});
```

- [ ] **Step 4: Run unit tests, expect pass**

Run: `npm test -- tests/unit/tools/set-text-in-range.test.ts`
Expected: all pass.

- [ ] **Step 5: Register the tool in `src/index.ts`**

Add after the `applyCharacterStyleToRangeTool` import:

```ts
import { setTextInRangeTool } from "./tools/set-text-in-range.js";
```

Add after `registry.register(applyCharacterStyleToRangeTool)`:

```ts
registry.register(setTextInRangeTool);
```

- [ ] **Step 6: Run full suite + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, tsc clean.

- [ ] **Step 7: Write integration test**

Create `tests/integration/set-text-in-range.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { createTextFrameTool } from "../../src/tools/create-text-frame.js";
import { setTextTool } from "../../src/tools/set-text.js";
import { setTextInRangeTool } from "../../src/tools/set-text-in-range.js";

integrationGate("set_text_in_range (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "replaces a word in the middle of a string",
    async () => {
      const doc = await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });
      expect(doc.ok).toBe(true);
      if (!doc.ok) return;

      const frame = await createTextFrameTool.handler({
        page_id: doc.result!.page_ids[0],
        bounds_mm: { x: 12, y: 12, width: 186, height: 50 },
      });
      expect(frame.ok).toBe(true);
      if (!frame.ok) return;

      // "Hello world" — 11 chars
      await setTextTool.handler({
        frame_id: frame.result!.frame_id,
        text: "Hello world",
      });

      // Replace "world" (indices 6..11) with "InDesign"
      const env = await setTextInRangeTool.handler({
        frame_id: frame.result!.frame_id,
        start_index: 6,
        end_index: 11,
        text: "InDesign",
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result?.removed_chars).toBe(5);
      expect(env.result?.inserted_chars).toBe(8);
      // "Hello InDesign" = 14 chars
      expect(env.result?.total_length_after).toBe(14);
      expect(env.document_state_delta?.changed_frames?.[0].id).toBe(frame.result!.frame_id);
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "deletes a range when text is empty",
    async () => {
      const doc = await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });
      expect(doc.ok).toBe(true);
      if (!doc.ok) return;

      const frame = await createTextFrameTool.handler({
        page_id: doc.result!.page_ids[0],
        bounds_mm: { x: 12, y: 12, width: 186, height: 50 },
      });
      expect(frame.ok).toBe(true);
      if (!frame.ok) return;

      // "Hello world" — 11 chars
      await setTextTool.handler({
        frame_id: frame.result!.frame_id,
        text: "Hello world",
      });

      // Delete " world" (indices 5..11) — empty replacement
      const env = await setTextInRangeTool.handler({
        frame_id: frame.result!.frame_id,
        start_index: 5,
        end_index: 11,
        text: "",
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result?.removed_chars).toBe(6);
      expect(env.result?.inserted_chars).toBe(0);
      // "Hello" = 5 chars
      expect(env.result?.total_length_after).toBe(5);
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "returns invalid_args when end_index exceeds story length",
    async () => {
      const doc = await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });
      expect(doc.ok).toBe(true);
      if (!doc.ok) return;

      const frame = await createTextFrameTool.handler({
        page_id: doc.result!.page_ids[0],
        bounds_mm: { x: 12, y: 12, width: 186, height: 50 },
      });
      expect(frame.ok).toBe(true);
      if (!frame.ok) return;

      await setTextTool.handler({
        frame_id: frame.result!.frame_id,
        text: "Hi",
      });

      const env = await setTextInRangeTool.handler({
        frame_id: frame.result!.frame_id,
        start_index: 0,
        end_index: 999,
        text: "replacement",
      });
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.kind).toBe("invalid_args");
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
```

- [ ] **Step 8: Commit**

```bash
git add src/tools/set-text-in-range.ts src/index.ts tests/unit/tools/set-text-in-range.test.ts tests/integration/set-text-in-range.int.test.ts
git commit -m "feat: set_text_in_range tool"
```

---

## Task 6: End-to-end smoke test

**Why:** Validates all three B5 tools working together in a realistic editorial scenario: a stat pill with an accent-coloured number, followed by a word replacement.

**Files:**
- Create: `tests/integration/plan-b5-end-to-end.int.test.ts`

- [ ] **Step 1: Create the end-to-end integration test**

Create `tests/integration/plan-b5-end-to-end.int.test.ts`:

```ts
import { afterEach, it, expect } from "vitest";
import { mkdtempSync, existsSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { createTextFrameTool } from "../../src/tools/create-text-frame.js";
import { setTextTool } from "../../src/tools/set-text.js";
import { defineParagraphStyleTool } from "../../src/tools/define-paragraph-style.js";
import { applyParagraphStyleTool } from "../../src/tools/apply-paragraph-style.js";
import { defineCharacterStyleTool } from "../../src/tools/define-character-style.js";
import { applyCharacterStyleToRangeTool } from "../../src/tools/apply-character-style-to-range.js";
import { setTextInRangeTool } from "../../src/tools/set-text-in-range.js";
import { exportPdfTool } from "../../src/tools/export-pdf.js";

integrationGate("Plan B5 end-to-end (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "creates stat pill text, applies character style to numeral, replaces word, exports PDF",
    async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "indesign-mcp-b5-"));
      const pdfPath = join(tmpDir, "b5-smoke.pdf");

      try {
        // 1. Create A4 document
        const createDoc = await createDocumentTool.handler({
          preset: "A4",
          margins_mm: { top: 20, bottom: 20, left: 20, right: 20 },
        });
        expect(createDoc.ok).toBe(true);
        if (!createDoc.ok) return;
        const pageId = createDoc.result!.page_ids[0];
        expect(pageId).toBeDefined();

        // 2. Define paragraph style "Body"
        const bodyStyle = await defineParagraphStyleTool.handler({
          name: "Body",
          size_pt: 12,
          leading_pt: 16,
          alignment: "left",
        });
        expect(bodyStyle.ok).toBe(true);

        // 3. Define character style "Accent" with orange fill
        const accentStyle = await defineCharacterStyleTool.handler({
          name: "Accent",
          fill_hex: "#FF6600",
        });
        expect(accentStyle.ok).toBe(true);
        if (!accentStyle.ok) return;
        expect(accentStyle.result?.character_style_name).toBe("Accent");
        expect(accentStyle.result?.on_collision_outcome).toBe("created");

        // 4. Create text frame with stat pill content
        const frameEnv = await createTextFrameTool.handler({
          page_id: pageId,
          bounds_mm: { x: 20, y: 40, width: 170, height: 30 },
        });
        expect(frameEnv.ok).toBe(true);
        if (!frameEnv.ok) return;
        const frameId = frameEnv.result!.frame_id;
        expect(frameId).toBeDefined();

        // "Total displaced: 1.5M people" — 29 chars
        await setTextTool.handler({
          frame_id: frameId,
          text: "Total displaced: 1.5M people",
        });

        // 5. Apply "Body" paragraph style to the whole frame
        const applyBody = await applyParagraphStyleTool.handler({
          frame_id: frameId,
          style_name: "Body",
        });
        expect(applyBody.ok).toBe(true);

        // 6. Apply "Accent" to "1.5M" — chars 17..21 (0-based, exclusive end)
        //    "Total displaced: " = 17 chars, "1.5M" = 4 chars, end = 21
        const applyAccent = await applyCharacterStyleToRangeTool.handler({
          frame_id: frameId,
          character_style_name: "Accent",
          start_index: 17,
          end_index: 21,
        });
        expect(applyAccent.ok).toBe(true);
        if (!applyAccent.ok) return;
        expect(applyAccent.result?.applied_chars).toBe(4);
        expect(applyAccent.result?.character_style_name).toBe("Accent");

        const accentDelta = applyAccent.document_state_delta?.changed_frames?.find(
          (f) => f.id === frameId,
        );
        expect(accentDelta).toBeDefined();
        expect(accentDelta!.applied_character_style_range?.character_style_name).toBe("Accent");
        expect(accentDelta!.applied_character_style_range?.start_index).toBe(17);
        expect(accentDelta!.applied_character_style_range?.end_index).toBe(21);

        // 7. Replace "people" with "individuals"
        //    "Total displaced: 1.5M " = 22 chars, "people" = 6, end = 28
        //    Note: InDesign may add a trailing CR, making story length > 28.
        //    We target chars 22..28 which covers "people" exactly.
        const replaceEnv = await setTextInRangeTool.handler({
          frame_id: frameId,
          start_index: 22,
          end_index: 28,
          text: "individuals",
        });
        expect(replaceEnv.ok).toBe(true);
        if (!replaceEnv.ok) return;
        expect(replaceEnv.result?.removed_chars).toBe(6);
        expect(replaceEnv.result?.inserted_chars).toBe(11);
        // "Total displaced: 1.5M individuals" = 33 chars
        expect(replaceEnv.result?.total_length_after).toBe(33);

        // 8. Export PDF — assert non-zero file on disk
        const exportEnv = await exportPdfTool.handler({ path: pdfPath });
        expect(exportEnv.ok).toBe(true);
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

- [ ] **Step 2: Run full unit suite + tsc to confirm no regressions**

Run: `npm test && npx tsc --noEmit`
Expected: all unit tests pass, tsc clean. (Integration test is skipped without `INDESIGN_MCP_INTEGRATION=1`.)

- [ ] **Step 3: Commit**

```bash
git add tests/integration/plan-b5-end-to-end.int.test.ts
git commit -m "test: end-to-end Plan B5 inline-character-styling scenario"
```

---

## Completion checklist

After all six tasks are committed, verify:

- [ ] `npx tsc --noEmit` exits clean (zero errors).
- [ ] `npm test` (unit suite only) exits clean — all new and existing tests pass.
- [ ] `src/index.ts` registers `defineCharacterStyleTool`, `applyCharacterStyleToRangeTool`, `setTextInRangeTool` in order after B4 tools.
- [ ] `src/types.ts` has `new_character_styles` and `applied_character_style_range` on `changed_frames`.
- [ ] `src/script-helpers.ts` exports `findCharacterStyleByName`.
- [ ] All integration tests require `INDESIGN_MCP_INTEGRATION=1` to run (guarded by `integrationGate`).
- [ ] Run integration suite against InDesign 2026: `INDESIGN_MCP_INTEGRATION=1 npm run test:integration`.

When all boxes are checked, Plan B6 (frame refinements) becomes the next planning step.
