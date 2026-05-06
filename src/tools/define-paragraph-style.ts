import { z } from "zod";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript, lit, prelude } from "../compose.js";
import { findDocumentById } from "../script-helpers.js";

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

const InputSchema = z
  .object({
    name: z.string().min(1),
    font_family: z.string().optional(),
    font_style: z.string().optional(),
    size_pt: z.number().positive().optional(),
    leading_pt: z.union([z.number().nonnegative(), z.literal("auto")]).optional(),
    alignment: z.enum(["left", "center", "right", "justify"]).optional(),
    color_hex: z.string().regex(HEX_COLOR_RE).optional(),
    space_before_pt: z.number().nonnegative().optional(),
    space_after_pt: z.number().nonnegative().optional(),
    on_collision: z.enum(["error", "replace", "version"]).optional(),
    document_id: z.string().optional(),
  })
  .strict()
  .refine(
    (data) => !(data.font_style !== undefined && data.font_family === undefined),
    { message: "`font_style` requires `font_family`" },
  );

type Input = z.infer<typeof InputSchema>;

const ScriptResultSchema = z.object({
  style_id: z.string(),
  name: z.string(),
  swatch_id: z.string().optional(),
});

type ScriptResult = z.infer<typeof ScriptResultSchema>;

interface Result {
  style_id: string;
  name: string;
  swatch_id?: string;
}

function hexToRgb(hex: string): [number, number, number] {
  const upper = hex.toUpperCase();
  return [
    parseInt(upper.slice(1, 3), 16),
    parseInt(upper.slice(3, 5), 16),
    parseInt(upper.slice(5, 7), 16),
  ];
}

function buildScriptBody(input: Input): string {
  const docExpr =
    input.document_id !== undefined
      ? `findDocumentById(${lit(input.document_id)})`
      : "app.activeDocument";

  const onCollision = input.on_collision ?? "error";

  // Color setup. When unset, swatchId remains undefined and is omitted from
  // the returned object so the Zod schema's optional swatch_id sees an absent
  // key rather than null.
  let colorSetup = "var swatchId;";
  if (input.color_hex !== undefined) {
    const upperHex = input.color_hex.toUpperCase();
    const swatchName = `auto-${upperHex}`;
    const [r, g, b] = hexToRgb(upperHex);
    colorSetup = `
      var swatchName = ${lit(swatchName)};
      var swatch = doc.colors.itemByName(swatchName);
      if (!swatch.isValid) {
        swatch = doc.colors.add({
          name: swatchName,
          model: ColorModel.PROCESS,
          space: ColorSpace.RGB,
          colorValue: [${r}, ${g}, ${b}]
        });
      }
      var swatchId = String(swatch.id);
    `;
  }

  // Font setup
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
  if (input.size_pt !== undefined) attrs.push(`style.pointSize = ${input.size_pt};`);
  if (input.leading_pt !== undefined) {
    if (input.leading_pt === "auto") {
      attrs.push(`style.leading = Leading.AUTO;`);
    } else {
      attrs.push(`style.leading = ${input.leading_pt};`);
    }
  }
  if (input.alignment !== undefined) {
    const enumName = {
      left: "LEFT_ALIGN",
      center: "CENTER_ALIGN",
      right: "RIGHT_ALIGN",
      justify: "LEFT_JUSTIFIED",
    }[input.alignment];
    attrs.push(`style.justification = Justification.${enumName};`);
  }
  if (input.color_hex !== undefined) {
    attrs.push(`style.fillColor = swatch;`);
  }
  if (input.space_before_pt !== undefined)
    attrs.push(`style.spaceBefore = ${input.space_before_pt};`);
  if (input.space_after_pt !== undefined)
    attrs.push(`style.spaceAfter = ${input.space_after_pt};`);

  // Collision handling
  const collisionBlock =
    onCollision === "error"
      ? `
        var existing = doc.paragraphStyles.itemByName(name);
        if (existing.isValid) {
          throw { name: "name_collision", message: "paragraph style \\"" + name + "\\" already exists", entity: "paragraph_style", id: name };
        }
        var style = doc.paragraphStyles.add({ name: name });
      `
      : onCollision === "replace"
        ? `
        var existing = doc.paragraphStyles.itemByName(name);
        var style = existing.isValid ? existing : doc.paragraphStyles.add({ name: name });
      `
        : `
        var baseName = name;
        var i = 2;
        while (doc.paragraphStyles.itemByName(name).isValid) {
          name = baseName + " " + i;
          i++;
        }
        var style = doc.paragraphStyles.add({ name: name });
      `;

  return `
${prelude(findDocumentById)}
var doc = ${docExpr};
var name = ${lit(input.name)};
${collisionBlock}
${colorSetup}
${fontSetup}
${attrs.join("\n")}
var result = {
  style_id: String(style.id),
  name: name
};
if (swatchId !== undefined) result.swatch_id = swatchId;
return result;
`;
}

export const defineParagraphStyleTool = defineTool<Input, Result>({
  name: "define_paragraph_style",
  description:
    "Creates a paragraph style with the given attributes. Auto-creates an RGB swatch when color_hex is provided. Returns the style ID and final name (which may differ from the input if on_collision is 'version').",
  inputSchema: InputSchema,
  async handler(input) {
    return runScriptWithResultFile<ScriptResult>({
      language: "JavaScript",
      scriptTemplate: wrapExtendScript(buildScriptBody(input)),
      resultSchema: ScriptResultSchema,
    });
  },
});
