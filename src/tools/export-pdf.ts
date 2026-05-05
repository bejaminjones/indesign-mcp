import { z } from "zod";
import { resolve } from "node:path";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript, lit } from "../compose.js";

const InputSchema = z
  .object({
    path: z.string(),
    document_id: z.string().optional(),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

const ScriptResultSchema = z.object({
  path: z.string(),
  page_count: z.number().int().nonnegative(),
});

type ScriptResult = z.infer<typeof ScriptResultSchema>;

interface Result {
  path: string;
  page_count: number;
}

function buildScriptBody(input: Input, absolutePath: string): string {
  const docExpr =
    input.document_id !== undefined
      ? `findDocumentById(${lit(input.document_id)})`
      : "app.activeDocument";

  return `
    function findDocumentById(id) {
      for (var i = 0; i < app.documents.length; i++) {
        if (String(app.documents[i].id) === id) return app.documents[i];
      }
      throw { name: "not_found", message: "document " + id + " not found", entity: "document", id: id };
    }
    var doc = ${docExpr};
    var preset = app.pdfExportPresets.itemByName(${lit("[High Quality Print]")});
    doc.exportFile(ExportFormat.PDF_TYPE, File(${lit(absolutePath)}), false, preset);
    return {
      path: ${lit(absolutePath)},
      page_count: doc.pages.length
    };
  `;
}

export const exportPdfTool = defineTool<Input, Result>({
  name: "export_pdf",
  description:
    "Exports an InDesign document to PDF using the [High Quality Print] preset. Returns the absolute output path and exported page count.",
  inputSchema: InputSchema,
  async handler(input) {
    const absolutePath = resolve(input.path);
    const body = buildScriptBody(input, absolutePath);
    return runScriptWithResultFile<ScriptResult>({
      language: "JavaScript",
      scriptTemplate: wrapExtendScript(body),
      resultSchema: ScriptResultSchema,
    });
  },
});
