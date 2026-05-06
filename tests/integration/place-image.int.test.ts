import { afterEach, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { createImageFrameTool } from "../../src/tools/create-image-frame.js";
import { placeImageTool } from "../../src/tools/place-image.js";

// Minimal valid 1x1 PNG bytes (for InDesign to actually place)
const TINY_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

integrationGate("place_image (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "places a real image into a rectangle and reports NORMAL link status",
    async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "indesign-mcp-place-"));
      const imagePath = join(tmpDir, "test.png");
      writeFileSync(imagePath, TINY_PNG_BYTES);

      try {
        const create = await createDocumentTool.handler({
          preset: "A4",
          margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
        });
        if (!create.ok) return;

        const frame = await createImageFrameTool.handler({
          page_id: create.result!.page_ids[0],
          bounds_mm: { x: 12, y: 12, width: 100, height: 60 },
        });
        if (!frame.ok) return;

        const env = await placeImageTool.handler({
          frame_id: frame.result!.frame_id,
          image_path: imagePath,
        });
        expect(env.ok).toBe(true);
        if (!env.ok) return;
        expect(env.result?.link_status).toBe("NORMAL");
        expect(env.document_state_delta?.changed_frames?.[0].applied_image_path).toBe(imagePath);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "returns io_error for a missing image file before dispatching",
    async () => {
      const env = await placeImageTool.handler({
        frame_id: "anything",
        image_path: "/no/such/file.png",
      });
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.kind).toBe("io_error");
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
