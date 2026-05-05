import { afterEach, it, expect } from "vitest";
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
});
