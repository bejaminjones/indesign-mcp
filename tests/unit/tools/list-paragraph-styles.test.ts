import { describe, it, expect, vi, beforeEach } from "vitest";
import { listParagraphStylesTool } from "../../../src/tools/list-paragraph-styles.js";
import { lastCall } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("list_paragraph_styles tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(listParagraphStylesTool.name).toBe("list_paragraph_styles");
    expect(listParagraphStylesTool.description.length).toBeGreaterThan(0);
  });

  // --- Schema validation ---

  it("accepts empty input", () => {
    expect(listParagraphStylesTool.inputSchema.safeParse({}).success).toBe(true);
  });

  it("accepts optional document_id", () => {
    expect(
      listParagraphStylesTool.inputSchema.safeParse({ document_id: "doc1" }).success,
    ).toBe(true);
  });

  it("rejects extra keys (strict schema)", () => {
    expect(
      listParagraphStylesTool.inputSchema.safeParse({ extra: true }).success,
    ).toBe(false);
  });

  // --- Script dispatch ---

  it("dispatches a script referencing doc.paragraphStyles", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { paragraph_styles: [] },
    });

    await listParagraphStylesTool.handler({});

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("paragraphStyles");
    expect(arg.scriptTemplate).toContain("pointSize");
    expect(arg.scriptTemplate).toContain("fillColor");
  });

  it("skips names starting with [ in the script", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { paragraph_styles: [] },
    });

    await listParagraphStylesTool.handler({});

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    // The script should filter out styles whose name starts with "["
    expect(arg.scriptTemplate).toContain("[");
    expect(arg.scriptTemplate).toContain("charAt");
  });

  // --- Result shape ---

  it("returns paragraph_styles array", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        paragraph_styles: [
          { name: "Body", point_size: 11, leading_pt: 14, color_swatch_name: "Black" },
          { name: "Headline", point_size: 36 },
        ],
      },
    });

    const env = await listParagraphStylesTool.handler({});

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result?.paragraph_styles).toHaveLength(2);
    expect(env.result?.paragraph_styles[0].name).toBe("Body");
    expect(env.result?.paragraph_styles[0].point_size).toBe(11);
    expect(env.result?.paragraph_styles[0].leading_pt).toBe(14);
    expect(env.result?.paragraph_styles[1].name).toBe("Headline");
    expect(env.result?.paragraph_styles[1].leading_pt).toBeUndefined();
  });

  it("does not emit a document_state_delta (read-only)", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { paragraph_styles: [] },
    });

    const env = await listParagraphStylesTool.handler({});

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.document_state_delta).toBeUndefined();
  });
});
