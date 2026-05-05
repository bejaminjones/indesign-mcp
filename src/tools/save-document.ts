import { z } from "zod";
import { resolve } from "node:path";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript, lit } from "../compose.js";

const InputSchema = z
  .object({
    path: z.string().optional(),
    document_id: z.string().optional(),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

const ScriptResultSchema = z.object({
  path: z.string(),
});

type ScriptResult = z.infer<typeof ScriptResultSchema>;

interface Result {
  path: string;
}

function buildScriptBody(input: Input, absolutePath: string | undefined): string {
  const docExpr =
    input.document_id !== undefined
      ? `findDocumentById(${lit(input.document_id)})`
      : "app.activeDocument";

  const saveCall =
    absolutePath !== undefined
      ? `doc.save(File(${lit(absolutePath)}));`
      : `
        if (!doc.saved) {
          throw { name: "io_error", message: "document has never been saved; provide a path to save-as" };
        }
        doc.save();
      `;

  return `
    function findDocumentById(id) {
      for (var i = 0; i < app.documents.length; i++) {
        if (String(app.documents[i].id) === id) return app.documents[i];
      }
      throw { name: "not_found", message: "document " + id + " not found", entity: "document", id: id };
    }
    var doc = ${docExpr};
    ${saveCall}
    return { path: String(doc.fullName) };
  `;
}

export const saveDocumentTool = defineTool<Input, Result>({
  name: "save_document",
  description:
    "Saves an InDesign document to disk. With `path`, performs a save-as. Without, saves to the document's current path (returns io_error if the document has no path yet).",
  inputSchema: InputSchema,
  async handler(input) {
    const absolutePath = input.path !== undefined ? resolve(input.path) : undefined;
    const body = buildScriptBody(input, absolutePath);
    return runScriptWithResultFile<ScriptResult>({
      language: "JavaScript",
      scriptTemplate: wrapExtendScript(body),
      resultSchema: ScriptResultSchema,
    });
  },
});
