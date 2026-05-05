import { afterEach, it, expect } from "vitest";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { saveDocumentTool } from "../../src/tools/save-document.js";

integrationGate("save_document (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "saves a fresh document to a new path (save-as)",
    async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "indesign-mcp-save-"));
      const indd = join(tmpDir, "test.indd");

      try {
        await createDocumentTool.handler({
          preset: "A4",
          margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
        });

        const env = await saveDocumentTool.handler({ path: indd });
        expect(env.ok).toBe(true);
        if (!env.ok) return;
        expect(env.result?.path).toBe(indd);
        expect(existsSync(indd)).toBe(true);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "save without path on an unsaved document returns an error",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      const env = await saveDocumentTool.handler({});
      expect(env.ok).toBe(false);
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
