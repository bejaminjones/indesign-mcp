import { describe, it, expect, vi, beforeEach } from "vitest";
import { exportPdfTool } from "../../../src/tools/export-pdf.js";
import { lastCall, expectFailure } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("export_pdf tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(exportPdfTool.name).toBe("export_pdf");
    expect(exportPdfTool.description.length).toBeGreaterThan(0);
  });

  it("requires a path", () => {
    expect(exportPdfTool.inputSchema.safeParse({}).success).toBe(false);
  });

  it("accepts an absolute path", () => {
    expect(
      exportPdfTool.inputSchema.safeParse({ path: "/Users/me/out.pdf" }).success,
    ).toBe(true);
  });

  it("accepts a relative path (server-side resolves)", () => {
    expect(exportPdfTool.inputSchema.safeParse({ path: "out.pdf" }).success).toBe(
      true,
    );
  });

  it("dispatches a script with the resolved absolute path", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { path: "/abs/out.pdf", page_count: 4 },
    });

    await exportPdfTool.handler({ path: "out.pdf" });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toMatch(/\/.*out\.pdf/);
    expect(arg.scriptTemplate).toContain("[High Quality Print]");
  });

  it("returns path and page_count on success", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { path: "/abs/out.pdf", page_count: 4 },
    });

    const env = await exportPdfTool.handler({ path: "/abs/out.pdf" });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result).toEqual({ path: "/abs/out.pdf", page_count: 4 });
    expect(env.document_state_delta).toBeUndefined();
  });

  it("propagates failure envelopes verbatim", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: { kind: "io_error", message: "directory does not exist" },
    });

    const env = await exportPdfTool.handler({ path: "/nope/x.pdf" });

    expectFailure(env);
    expect(env.error.kind).toBe("io_error");
  });
});
