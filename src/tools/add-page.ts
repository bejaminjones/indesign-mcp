import { z } from "zod";
import { defineTool } from "./registry.js";
import { runScriptWithResultFile } from "../transport/result-file.js";
import { wrapExtendScript, lit } from "../compose.js";
import { ok } from "../errors.js";

const AfterPageId = z.object({ after_page_id: z.string() }).strict();
const BeforePageId = z.object({ before_page_id: z.string() }).strict();

const InputSchema = z
  .object({
    at: z
      .union([z.literal("start"), z.literal("end"), AfterPageId, BeforePageId])
      .optional(),
    document_id: z.string().optional(),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

const ScriptResultSchema = z.object({
  new_page_id: z.string(),
  position_index: z.number().int().nonnegative(),
  page_count: z.number().int().positive(),
});

type ScriptResult = z.infer<typeof ScriptResultSchema>;

interface Result {
  new_page_id: string;
  position_index: number;
}

function buildScriptBody(input: Input): string {
  const at = input.at ?? "end";
  const docExpr =
    input.document_id !== undefined
      ? `findDocumentById(${lit(input.document_id)})`
      : "app.activeDocument";

  let insertion: string;
  if (at === "end") {
    insertion = `var newPage = doc.pages.add(LocationOptions.AT_END);`;
  } else if (at === "start") {
    insertion = `var newPage = doc.pages.add(LocationOptions.AT_BEGINNING);`;
  } else if ("after_page_id" in at) {
    insertion = `
      var anchor = findPageById(doc, ${lit(at.after_page_id)});
      var newPage = doc.pages.add(LocationOptions.AFTER, anchor);
    `;
  } else {
    insertion = `
      var anchor = findPageById(doc, ${lit(at.before_page_id)});
      var newPage = doc.pages.add(LocationOptions.BEFORE, anchor);
    `;
  }

  return `
    function findDocumentById(id) {
      for (var i = 0; i < app.documents.length; i++) {
        if (String(app.documents[i].id) === id) return app.documents[i];
      }
      throw { name: "not_found", message: "document " + id + " not found", entity: "document", id: id };
    }
    function findPageById(doc, id) {
      for (var i = 0; i < doc.pages.length; i++) {
        if (String(doc.pages[i].id) === id) return doc.pages[i];
      }
      throw { name: "not_found", message: "page " + id + " not found", entity: "page", id: id };
    }
    var doc = ${docExpr};
    ${insertion}
    var idx = -1;
    for (var i = 0; i < doc.pages.length; i++) {
      if (doc.pages[i].id === newPage.id) { idx = i; break; }
    }
    return {
      new_page_id: String(newPage.id),
      position_index: idx,
      page_count: doc.pages.length
    };
  `;
}

export const addPageTool = defineTool<Input, Result>({
  name: "add_page",
  description:
    "Adds a single page to an InDesign document. Defaults to appending at the end of the active document. Returns the new page ID and its position.",
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
    return ok(
      { new_page_id: r.new_page_id, position_index: r.position_index },
      {
        document_state_delta: {
          page_count: r.page_count,
          new_page_ids: [r.new_page_id],
        },
      },
    );
  },
});
