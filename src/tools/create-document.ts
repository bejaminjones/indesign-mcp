import { z } from "zod";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript, lit } from "../compose.js";
import { ok } from "../errors.js";

// Preset dimensions in millimetres (portrait orientation).
const PRESETS: Record<string, { width_mm: number; height_mm: number }> = {
  A4: { width_mm: 210, height_mm: 297 },
  Letter: { width_mm: 215.9, height_mm: 279.4 },
  Legal: { width_mm: 215.9, height_mm: 355.6 },
  Tabloid: { width_mm: 279.4, height_mm: 431.8 },
};

const RectMargins = z.object({
  top: z.number().nonnegative(),
  bottom: z.number().nonnegative(),
  left: z.number().nonnegative(),
  right: z.number().nonnegative(),
});

const FacingMargins = z.object({
  top: z.number().nonnegative(),
  bottom: z.number().nonnegative(),
  inside: z.number().nonnegative(),
  outside: z.number().nonnegative(),
});

const InputSchema = z
  .object({
    preset: z.enum(["A4", "Letter", "Legal", "Tabloid"]).optional(),
    width_mm: z.number().positive().optional(),
    height_mm: z.number().positive().optional(),
    orientation: z.enum(["portrait", "landscape"]).optional(),
    pages: z.number().int().min(1).optional(),
    facing_pages: z.boolean().optional(),
    margins_mm: z.union([RectMargins, FacingMargins]),
    columns: z
      .object({
        count: z.number().int().min(1),
        gutter_mm: z.number().nonnegative(),
      })
      .optional(),
  })
  .strict()
  .refine(
    (data) => {
      const hasPreset = data.preset !== undefined;
      const hasWidth = data.width_mm !== undefined;
      const hasHeight = data.height_mm !== undefined;
      if (hasPreset && (hasWidth || hasHeight)) return false;
      if (!hasPreset && !(hasWidth && hasHeight)) return false;
      return true;
    },
    { message: "Provide exactly one of `preset` or both `width_mm` and `height_mm`" },
  )
  .refine(
    (data) => {
      const isFacingMargins = "inside" in data.margins_mm;
      if (isFacingMargins && data.facing_pages !== true) return false;
      return true;
    },
    { message: "`inside`/`outside` margins require facing_pages: true" },
  )
  .refine(
    (data) => {
      // Orientation is only meaningful with preset; explicit dims define their own orientation.
      if (data.orientation !== undefined && data.width_mm !== undefined) return false;
      return true;
    },
    { message: "`orientation` is only valid with `preset`; explicit `width_mm`/`height_mm` define orientation directly" },
  );

type Input = z.infer<typeof InputSchema>;

const ScriptResultSchema = z.object({
  document_id: z.string(),
  page_ids: z.array(z.string()),
  page_count: z.number().int().nonnegative(),
});

type ScriptResult = z.infer<typeof ScriptResultSchema>;

interface Result {
  document_id: string;
  page_ids: string[];
}

function resolveDimensions(input: Input): { width_mm: number; height_mm: number } {
  if (input.preset !== undefined) {
    const preset = PRESETS[input.preset];
    let { width_mm, height_mm } = preset;
    if (input.orientation === "landscape") [width_mm, height_mm] = [height_mm, width_mm];
    return { width_mm, height_mm };
  }
  return { width_mm: input.width_mm!, height_mm: input.height_mm! };
}

function resolveMargins(input: Input): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  const m = input.margins_mm;
  if ("inside" in m) {
    return { top: m.top, bottom: m.bottom, left: m.inside, right: m.outside };
  }
  return { top: m.top, bottom: m.bottom, left: m.left, right: m.right };
}

function buildScriptBody(input: Input): string {
  const dims = resolveDimensions(input);
  const margins = resolveMargins(input);
  const columns = input.columns ?? { count: 1, gutter_mm: 0 };
  const pages = input.pages ?? 1;
  const facing = input.facing_pages ?? false;

  return `
    var prevUnits = app.scriptPreferences.measurementUnit;
    app.scriptPreferences.measurementUnit = MeasurementUnits.MILLIMETERS;
    try {
      var doc = app.documents.add();
      var dp = doc.documentPreferences;
      dp.facingPages = ${lit(facing)};
      dp.pageWidth = ${lit(dims.width_mm)};
      dp.pageHeight = ${lit(dims.height_mm)};
      dp.pagesPerDocument = ${lit(pages)};

      var marginPrefs = doc.marginPreferences;
      marginPrefs.top = ${lit(margins.top)};
      marginPrefs.bottom = ${lit(margins.bottom)};
      marginPrefs.left = ${lit(margins.left)};
      marginPrefs.right = ${lit(margins.right)};
      marginPrefs.columnCount = ${lit(columns.count)};
      marginPrefs.columnGutter = ${lit(columns.gutter_mm)};

      var pageIds = [];
      for (var i = 0; i < doc.pages.length; i++) {
        pageIds.push(String(doc.pages[i].id));
      }

      return {
        document_id: String(doc.id),
        page_ids: pageIds,
        page_count: doc.pages.length
      };
    } finally {
      app.scriptPreferences.measurementUnit = prevUnits;
    }
  `;
}

export const createDocumentTool = defineTool<Input, Result>({
  name: "create_document",
  description:
    "Creates a new InDesign document with the specified page size, orientation, margins, and column setup. Returns the document and page IDs.",
  inputSchema: InputSchema,
  async handler(input) {
    const body = buildScriptBody(input);
    const env = await runScriptWithResultFile<ScriptResult>({
      language: "JavaScript",
      scriptTemplate: wrapExtendScript(body),
      resultSchema: ScriptResultSchema,
    });
    if (!env.ok) return env;
    const r = env.result!;
    const isFacingMargins = "inside" in input.margins_mm;
    const warnings = isFacingMargins
      ? ["facing-page margins applied as left=inside/right=outside; verso pages will be mirrored incorrectly until per-spread setup is supported"]
      : undefined;
    return ok(
      { document_id: r.document_id, page_ids: r.page_ids },
      {
        document_state_delta: {
          page_count: r.page_count,
          new_page_ids: r.page_ids,
        },
        warnings,
      },
    );
  },
});
