import { afterEach, it, expect } from "vitest";
import { z } from "zod";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";

integrationGate("create_document (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "creates an A4 document with 2 pages and returns ids + state delta",
    async () => {
      const env = await createDocumentTool.handler({
        preset: "A4",
        pages: 2,
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(typeof env.result?.document_id).toBe("string");
      expect(env.result?.page_ids).toHaveLength(2);
      expect(env.document_state_delta?.page_count).toBe(2);
      expect(env.document_state_delta?.new_page_ids).toEqual(env.result?.page_ids);
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "creates a landscape Letter document",
    async () => {
      const env = await createDocumentTool.handler({
        preset: "Letter",
        orientation: "landscape",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      expect(env.ok).toBe(true);
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "creates a facing-pages document with inside/outside margins",
    async () => {
      const env = await createDocumentTool.handler({
        preset: "A4",
        facing_pages: true,
        margins_mm: { top: 14, bottom: 14, inside: 18, outside: 10 },
      });

      expect(env.ok).toBe(true);
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "facing-page A4 doc: RIGHT_HAND page has left=inside, LEFT_HAND has left=outside",
    async () => {
      // Create a 2-page facing doc. Page 0 is RIGHT_HAND (recto), page 1 is LEFT_HAND (verso).
      const env = await createDocumentTool.handler({
        preset: "A4",
        facing_pages: true,
        pages: 2,
        margins_mm: { top: 10, bottom: 10, inside: 25, outside: 15 },
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;

      // Query each page's margin prefs via a script
      const body = `
        var doc = app.activeDocument;
        var result = [];
        for (var i = 0; i < doc.pages.length; i++) {
          var p = doc.pages[i];
          result.push({
            id: String(p.id),
            side: String(p.side),
            left: p.marginPreferences.left,
            right: p.marginPreferences.right
          });
        }
        return { pages: result };
      `;
      const { wrapExtendScript } = await import("../../src/compose.js");
      const { runScriptWithResultFile } = await import("../../src/transport/result-file.js");

      const PageInfoSchema = z.object({
        pages: z.array(z.object({
          id: z.string(),
          side: z.string(),
          left: z.number(),
          right: z.number(),
        })),
      });

      const result = await runScriptWithResultFile<z.infer<typeof PageInfoSchema>>({
        language: "JavaScript",
        scriptTemplate: wrapExtendScript(body),
        resultSchema: PageInfoSchema,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      type PageInfo = { id: string; side: string; left: number; right: number };
      const pages: PageInfo[] = result.result!.pages;
      const recto = pages.find((p) => p.side === "RIGHT_HAND" || p.side === "1281774162");
      const verso = pages.find((p) => p.side === "LEFT_HAND" || p.side === "1281971784");

      expect(recto, `expected a RIGHT_HAND page, got sides: ${pages.map((p) => p.side).join(", ")}`).toBeDefined();
      expect(verso, `expected a LEFT_HAND page, got sides: ${pages.map((p) => p.side).join(", ")}`).toBeDefined();
      expect(recto!.left).toBeCloseTo(25, 1);   // inside
      expect(recto!.right).toBeCloseTo(15, 1);  // outside
      expect(verso!.left).toBeCloseTo(15, 1);   // outside
      expect(verso!.right).toBeCloseTo(25, 1);  // inside
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
