import { describe, it, expect, vi, beforeEach } from "vitest";
import { listFontsTool } from "../../../src/tools/list-fonts.js";
import { lastCall } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("list_fonts tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(listFontsTool.name).toBe("list_fonts");
    expect(listFontsTool.description.length).toBeGreaterThan(0);
  });

  // --- Schema validation ---

  it("accepts empty input (no filter, no limit)", () => {
    expect(listFontsTool.inputSchema.safeParse({}).success).toBe(true);
  });

  it("accepts optional filter string", () => {
    expect(
      listFontsTool.inputSchema.safeParse({ filter: "Helvetica" }).success,
    ).toBe(true);
  });

  it("accepts optional limit", () => {
    expect(
      listFontsTool.inputSchema.safeParse({ limit: 50 }).success,
    ).toBe(true);
  });

  it("rejects limit of 0", () => {
    expect(
      listFontsTool.inputSchema.safeParse({ limit: 0 }).success,
    ).toBe(false);
  });

  it("rejects limit greater than 5000", () => {
    expect(
      listFontsTool.inputSchema.safeParse({ limit: 5001 }).success,
    ).toBe(false);
  });

  it("accepts limit of 5000 (max)", () => {
    expect(
      listFontsTool.inputSchema.safeParse({ limit: 5000 }).success,
    ).toBe(true);
  });

  it("accepts limit of 1 (min)", () => {
    expect(
      listFontsTool.inputSchema.safeParse({ limit: 1 }).success,
    ).toBe(true);
  });

  it("rejects extra keys (strict schema)", () => {
    expect(
      listFontsTool.inputSchema.safeParse({ extra: true }).success,
    ).toBe(false);
  });

  // --- Script dispatch ---

  it("dispatches a script referencing app.fonts", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { fonts: [], total_matched: 0 },
    });

    await listFontsTool.handler({});

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("app.fonts");
    expect(arg.scriptTemplate).toContain("fontFamily");
    expect(arg.scriptTemplate).toContain("fontStyleName");
  });

  it("embeds filter in the script when provided", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { fonts: [], total_matched: 0 },
    });

    await listFontsTool.handler({ filter: "Helvetica" });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("helvetica");
    expect(arg.scriptTemplate).toContain("toLowerCase");
  });

  it("uses default limit of 100 when not specified", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { fonts: [], total_matched: 0 },
    });

    await listFontsTool.handler({});

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("100");
  });

  it("embeds custom limit in the script", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { fonts: [], total_matched: 0 },
    });

    await listFontsTool.handler({ limit: 250 });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("250");
  });

  // --- Result shape ---

  it("returns fonts array and total_matched", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        fonts: [
          { family: "Helvetica Neue", style: "Regular", full_name: "Helvetica Neue Regular" },
        ],
        total_matched: 1,
      },
    });

    const env = await listFontsTool.handler({});

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result?.fonts).toHaveLength(1);
    expect(env.result?.fonts[0].family).toBe("Helvetica Neue");
    expect(env.result?.total_matched).toBe(1);
  });

  it("does not emit a document_state_delta (read-only)", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { fonts: [], total_matched: 0 },
    });

    const env = await listFontsTool.handler({});

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.document_state_delta).toBeUndefined();
  });
});
