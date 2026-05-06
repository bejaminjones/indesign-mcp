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
