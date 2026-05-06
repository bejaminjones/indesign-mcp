import { afterEach, it, expect } from "vitest";
import { integrationGate, INTEGRATION_TIMEOUT_MS, closeAllDocuments } from "./helpers.js";
import { createDocumentTool } from "../../src/tools/create-document.js";
import { defineCharacterStyleTool } from "../../src/tools/define-character-style.js";

integrationGate("define_character_style (integration)", () => {
  afterEach(async () => {
    await closeAllDocuments();
  });

  it(
    "creates a character style with font_family",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      const env = await defineCharacterStyleTool.handler({
        name: "Emphasis",
        font_family: "Helvetica Neue",
        font_style: "Italic",
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result?.character_style_name).toBe("Emphasis");
      expect(env.result?.on_collision_outcome).toBe("created");
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "creates a character style with fill_hex, returns fill_swatch_id",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      const env = await defineCharacterStyleTool.handler({
        name: "Accent",
        fill_hex: "#FF6600",
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result?.character_style_name).toBe("Accent");
      expect(typeof env.result?.fill_swatch_id).toBe("string");
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "name_collision when style exists and on_collision is 'error'",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      const first = await defineCharacterStyleTool.handler({
        name: "Accent",
        fill_hex: "#FF0000",
      });
      expect(first.ok).toBe(true);

      const second = await defineCharacterStyleTool.handler({
        name: "Accent",
        fill_hex: "#0000FF",
        on_collision: "error",
      });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.kind).toBe("name_collision");
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "on_collision 'update' modifies the existing style without creating a new one",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      await defineCharacterStyleTool.handler({
        name: "Accent",
        fill_hex: "#FF0000",
      });

      const env = await defineCharacterStyleTool.handler({
        name: "Accent",
        fill_hex: "#0000FF",
        on_collision: "update",
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result?.character_style_name).toBe("Accent");
      expect(env.result?.on_collision_outcome).toBe("updated");
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    "on_collision 'version' creates 'Accent 2' when 'Accent' exists",
    async () => {
      await createDocumentTool.handler({
        preset: "A4",
        margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
      });

      await defineCharacterStyleTool.handler({
        name: "Accent",
        fill_hex: "#FF0000",
      });

      const env = await defineCharacterStyleTool.handler({
        name: "Accent",
        fill_hex: "#0000FF",
        on_collision: "version",
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.result?.character_style_name).toBe("Accent 2");
      expect(env.result?.on_collision_outcome).toBe("versioned");
    },
    INTEGRATION_TIMEOUT_MS,
  );
});
