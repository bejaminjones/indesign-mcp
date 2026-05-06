import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDocumentTool } from "../../../src/tools/create-document.js";
import { lastCall, expectFailure } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("create_document tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(createDocumentTool.name).toBe("create_document");
    expect(createDocumentTool.description.length).toBeGreaterThan(0);
  });

  it("accepts a minimal valid input (preset + margins)", () => {
    const result = createDocumentTool.inputSchema.safeParse({
      preset: "A4",
      margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects when neither preset nor explicit dimensions are given", () => {
    const result = createDocumentTool.inputSchema.safeParse({
      margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects when both preset and explicit dimensions are given", () => {
    const result = createDocumentTool.inputSchema.safeParse({
      preset: "A4",
      width_mm: 200,
      height_mm: 300,
      margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects inside/outside margins without facing_pages", () => {
    const result = createDocumentTool.inputSchema.safeParse({
      preset: "A4",
      margins_mm: { top: 12, bottom: 12, inside: 14, outside: 10 },
    });
    expect(result.success).toBe(false);
  });

  it("accepts inside/outside margins when facing_pages is true", () => {
    const result = createDocumentTool.inputSchema.safeParse({
      preset: "A4",
      facing_pages: true,
      margins_mm: { top: 12, bottom: 12, inside: 14, outside: 10 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects pages < 1", () => {
    const result = createDocumentTool.inputSchema.safeParse({
      preset: "A4",
      pages: 0,
      margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
    });
    expect(result.success).toBe(false);
  });

  it("dispatches an ExtendScript that creates a document with the resolved dimensions", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        document_id: "doc-1",
        page_ids: ["p1", "p2"],
        page_count: 2,
      },
    });

    await createDocumentTool.handler({
      preset: "A4",
      pages: 2,
      margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.language).toBe("JavaScript");
    expect(arg.scriptTemplate).toContain("210");
    expect(arg.scriptTemplate).toContain("297");
    expect(arg.scriptTemplate).toContain("pagesPerDocument = 2");
    expect(arg.scriptTemplate).toContain("marginPreferences.top = 12");
  });

  it("swaps preset dimensions for landscape orientation", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { document_id: "d", page_ids: ["p"], page_count: 1 },
    });

    await createDocumentTool.handler({
      preset: "A4",
      orientation: "landscape",
      margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("pageWidth = 297");
    expect(arg.scriptTemplate).toContain("pageHeight = 210");
  });

  it("returns the document id, page ids, and document_state_delta", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        document_id: "doc-42",
        page_ids: ["p1", "p2", "p3"],
        page_count: 3,
      },
    });

    const env = await createDocumentTool.handler({
      preset: "A4",
      pages: 3,
      margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
    });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result).toEqual({
      document_id: "doc-42",
      page_ids: ["p1", "p2", "p3"],
    });
    expect(env.document_state_delta).toEqual({
      page_count: 3,
      new_page_ids: ["p1", "p2", "p3"],
    });
  });

  it("propagates failure envelopes verbatim", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: { kind: "app_not_available", message: "no app" },
    });

    const env = await createDocumentTool.handler({
      preset: "A4",
      margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
    });

    expectFailure(env);
    expect(env.error.kind).toBe("app_not_available");
  });

  it("rejects orientation when used with explicit dimensions", () => {
    const result = createDocumentTool.inputSchema.safeParse({
      width_mm: 200,
      height_mm: 300,
      orientation: "landscape",
      margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
    });
    expect(result.success).toBe(false);
  });

  it("script contains per-page loop when setting margins", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { document_id: "d", page_ids: ["p1"], page_count: 1 },
    });

    await createDocumentTool.handler({
      preset: "A4",
      margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("doc.pages");
    expect(arg.scriptTemplate).toContain("marginPreferences.top");
  });

  it("script mirrors inside/outside for facing-page docs", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { document_id: "d", page_ids: ["p1", "p2"], page_count: 2 },
    });

    await createDocumentTool.handler({
      preset: "A4",
      facing_pages: true,
      pages: 2,
      margins_mm: { top: 10, bottom: 10, inside: 25, outside: 15 },
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    // Must contain the LEFT_HAND mirroring branch
    expect(arg.scriptTemplate).toContain("LEFT_HAND");
    // Must reference both inside and outside values
    expect(arg.scriptTemplate).toContain("25");
    expect(arg.scriptTemplate).toContain("15");
  });

  it("does not emit a warning for facing-page margins after the fix", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { document_id: "d", page_ids: ["p1", "p2"], page_count: 2 },
    });

    const env = await createDocumentTool.handler({
      preset: "A4",
      facing_pages: true,
      pages: 2,
      margins_mm: { top: 10, bottom: 10, inside: 25, outside: 15 },
    });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    // No warnings — per-page mirroring handles this correctly now
    expect(env.warnings).toBeUndefined();
  });

  it("rejects a script result that doesn't match ScriptResultSchema", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: { kind: "script_error", message: "script result failed schema validation: ..." },
    });

    const env = await createDocumentTool.handler({
      preset: "A4",
      margins_mm: { top: 12, bottom: 12, left: 12, right: 12 },
    });

    expectFailure(env);
    expect(env.error.kind).toBe("script_error");
  });
});
