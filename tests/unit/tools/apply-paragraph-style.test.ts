import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyParagraphStyleTool } from "../../../src/tools/apply-paragraph-style.js";
import { lastCall, expectFailure } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("apply_paragraph_style tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(applyParagraphStyleTool.name).toBe("apply_paragraph_style");
    expect(applyParagraphStyleTool.description.length).toBeGreaterThan(0);
  });

  it("requires frame_id and style_name", () => {
    expect(
      applyParagraphStyleTool.inputSchema.safeParse({ frame_id: "f1" }).success,
    ).toBe(false);
    expect(
      applyParagraphStyleTool.inputSchema.safeParse({ style_name: "Body" }).success,
    ).toBe(false);
  });

  it("accepts minimal valid input", () => {
    expect(
      applyParagraphStyleTool.inputSchema.safeParse({
        frame_id: "f1",
        style_name: "Body",
      }).success,
    ).toBe(true);
  });

  it("dispatches a script that resolves both frame and style", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { frame_id: "f1", style_name: "Body", affected_paragraphs: 3 },
    });

    await applyParagraphStyleTool.handler({ frame_id: "f1", style_name: "Body" });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("findFrameById");
    expect(arg.scriptTemplate).toContain("findStyleByName");
    expect(arg.scriptTemplate).toContain("applyParagraphStyle");
  });

  it("returns frame_id, style_name, affected_paragraphs, and changed_frames delta", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { frame_id: "f1", style_name: "Body", affected_paragraphs: 5 },
    });

    const env = await applyParagraphStyleTool.handler({
      frame_id: "f1",
      style_name: "Body",
    });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result).toEqual({
      frame_id: "f1",
      style_name: "Body",
      affected_paragraphs: 5,
    });
    expect(env.document_state_delta).toEqual({
      changed_frames: [{ id: "f1", applied_paragraph_style: "Body" }],
    });
  });

  it("propagates not_found failures verbatim", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: {
        kind: "not_found",
        message: "paragraph style not found",
        entity: "paragraph_style",
        id: "Missing",
      },
    });

    const env = await applyParagraphStyleTool.handler({
      frame_id: "f1",
      style_name: "Missing",
    });

    expectFailure(env);
    expect(env.error.kind).toBe("not_found");
    expect(env.error.entity).toBe("paragraph_style");
  });
});
