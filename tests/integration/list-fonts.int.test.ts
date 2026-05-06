import { afterEach, it, expect } from "vitest";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { listFontsTool } from "../../src/tools/list-fonts.js";

integrationGate("list_fonts (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "returns a non-empty fonts list",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      const env = await listFontsTool.handler({});
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result?.fonts.length).toBeGreaterThan(0);
      expect(env.result?.total_matched).toBeGreaterThan(0);
      const first = env.result!.fonts[0];
      expect(typeof first.family).toBe("string");
      expect(typeof first.style).toBe("string");
      expect(typeof first.full_name).toBe("string");
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "filter narrows results",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      const allEnv = await listFontsTool.handler({ limit: 5000 });
      expect(allEnv.ok).toBe(true);
      if (!allEnv.ok) return;
      const totalAll = allEnv.result!.total_matched;

      const filteredEnv = await listFontsTool.handler({ filter: "helv" });
      expect(filteredEnv.ok).toBe(true);
      if (!filteredEnv.ok) return;
      // Filtered result should be a subset (may be 0 if Helvetica not installed)
      expect(filteredEnv.result!.total_matched).toBeLessThanOrEqual(totalAll);
      // All returned fonts must have "helv" in family (case-insensitive)
      for (const f of filteredEnv.result!.fonts) {
        expect(f.family.toLowerCase()).toContain("helv");
      }
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "limit caps the returned array without affecting total_matched",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      const env = await listFontsTool.handler({ limit: 2 });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result!.fonts.length).toBeLessThanOrEqual(2);
      expect(env.result!.total_matched).toBeGreaterThanOrEqual(env.result!.fonts.length);
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
