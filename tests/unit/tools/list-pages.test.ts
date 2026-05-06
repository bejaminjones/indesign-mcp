import { describe, it, expect, vi, beforeEach } from "vitest";
import { listPagesTool } from "../../../src/tools/list-pages.js";
import { lastCall } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("list_pages tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(listPagesTool.name).toBe("list_pages");
    expect(listPagesTool.description.length).toBeGreaterThan(0);
  });

  // --- Schema validation ---

  it("accepts empty input", () => {
    expect(listPagesTool.inputSchema.safeParse({}).success).toBe(true);
  });

  it("accepts optional document_id", () => {
    expect(
      listPagesTool.inputSchema.safeParse({ document_id: "doc1" }).success,
    ).toBe(true);
  });

  it("rejects extra keys (strict schema)", () => {
    expect(
      listPagesTool.inputSchema.safeParse({ extra: true }).success,
    ).toBe(false);
  });

  // --- Script dispatch ---

  it("dispatches a script referencing doc.pages", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { pages: [] },
    });

    await listPagesTool.handler({});

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("doc.pages");
    expect(arg.scriptTemplate).toContain("appliedMaster");
    expect(arg.scriptTemplate).toContain("side");
  });

  it("uses null check for appliedMaster", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { pages: [] },
    });

    await listPagesTool.handler({});

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    // Must use === null comparison, not .isValid
    expect(arg.scriptTemplate).toContain("=== null");
    expect(arg.scriptTemplate).toContain("[None]");
  });

  // --- Result shape ---

  it("returns pages array with expected fields", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: {
        pages: [
          {
            id: "pg1",
            index: 0,
            side: "RIGHT_HAND",
            applied_parent_name: "[None]",
            name: "1",
          },
        ],
      },
    });

    const env = await listPagesTool.handler({});

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result?.pages).toHaveLength(1);
    expect(env.result?.pages[0].id).toBe("pg1");
    expect(env.result?.pages[0].index).toBe(0);
    expect(env.result?.pages[0].side).toBe("RIGHT_HAND");
    expect(env.result?.pages[0].applied_parent_name).toBe("[None]");
    expect(env.result?.pages[0].name).toBe("1");
  });

  it("does not emit a document_state_delta (read-only)", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { pages: [] },
    });

    const env = await listPagesTool.handler({});

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.document_state_delta).toBeUndefined();
  });
});
