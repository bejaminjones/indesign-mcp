import { afterEach, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { createImageFrameTool } from "../../src/tools/create-image-frame.js";
import { placeImageTool } from "../../src/tools/place-image.js";
import { createRectangleTool } from "../../src/tools/create-rectangle.js";
import { createLineTool } from "../../src/tools/create-line.js";
import { exportPdfTool } from "../../src/tools/export-pdf.js";

const TINY_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

integrationGate("Plan B3 end-to-end (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "composes a page with image, stat pill, top rule; exports PDF",
    async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "indesign-mcp-b3-"));
      const imagePath = join(tmpDir, "test.png");
      const pdfPath = join(tmpDir, "out.pdf");
      writeFileSync(imagePath, TINY_PNG_BYTES);

      try {
        const create = await createDocumentTool.handler({
          preset: "A4",
          margins_mm: { top: 18, bottom: 18, left: 18, right: 18 },
        });
        expect(create.ok).toBe(true);
        if (!create.ok) return;
        const pageId = create.result!.page_ids[0];

        const topRule = await createLineTool.handler({
          page_id: pageId,
          start_mm: { x: 18, y: 12 },
          end_mm: { x: 192, y: 12 },
          stroke_hex: "#333333",
          stroke_weight_pt: 0.5,
        });
        expect(topRule.ok).toBe(true);

        const imageFrame = await createImageFrameTool.handler({
          page_id: pageId,
          bounds_mm: { x: 18, y: 30, width: 100, height: 60 },
        });
        expect(imageFrame.ok).toBe(true);
        if (!imageFrame.ok) return;

        const place = await placeImageTool.handler({
          frame_id: imageFrame.result!.frame_id,
          image_path: imagePath,
        });
        expect(place.ok).toBe(true);

        const pill = await createRectangleTool.handler({
          page_id: pageId,
          bounds_mm: { x: 18, y: 100, width: 60, height: 12 },
          fill_hex: "#FF6600",
          corner_radius_mm: 6,
        });
        expect(pill.ok).toBe(true);

        const exported = await exportPdfTool.handler({ path: pdfPath });
        expect(exported.ok).toBe(true);
        if (!exported.ok) return;
        expect(existsSync(pdfPath)).toBe(true);
        expect(statSync(pdfPath).size).toBeGreaterThan(0);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    },
    INTEGRATION_TIMEOUT_MS * 3,
  );
});
