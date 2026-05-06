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
