import { describe, it, expect, vi, beforeEach } from "vitest";
import { saveDocumentTool } from "../../../src/tools/save-document.js";
import { lastCall, expectFailure } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("save_document tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(saveDocumentTool.name).toBe("save_document");
    expect(saveDocumentTool.description.length).toBeGreaterThan(0);
  });

  it("accepts empty input (defaults: active doc, save to current path)", () => {
    expect(saveDocumentTool.inputSchema.safeParse({}).success).toBe(true);
  });

  it("accepts an absolute path", () => {
    expect(
      saveDocumentTool.inputSchema.safeParse({ path: "/Users/me/doc.indd" }).success,
    ).toBe(true);
  });

  it("accepts a relative path (server-side resolves)", () => {
    expect(
      saveDocumentTool.inputSchema.safeParse({ path: "doc.indd" }).success,
    ).toBe(true);
  });

  it("dispatches a script with the resolved absolute path interpolated", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { path: "/abs/path/doc.indd" },
    });

    await saveDocumentTool.handler({ path: "doc.indd" });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.language).toBe("JavaScript");
    expect(arg.scriptTemplate).toMatch(/\/.*doc\.indd/);
  });

  it("dispatches a script that saves to current path when no path is given", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { path: "/abs/existing.indd" },
    });

    await saveDocumentTool.handler({});

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("doc.save()");
  });

  it("returns the path on success", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { path: "/abs/result.indd" },
    });

    const env = await saveDocumentTool.handler({ path: "result.indd" });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result).toEqual({ path: "/abs/result.indd" });
    expect(env.document_state_delta).toBeUndefined();
  });

  it("propagates io_error envelopes verbatim", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: { kind: "io_error", message: "permission denied" },
    });

    const env = await saveDocumentTool.handler({ path: "/locked/doc.indd" });

    expectFailure(env);
    expect(env.error.kind).toBe("io_error");
  });
});
