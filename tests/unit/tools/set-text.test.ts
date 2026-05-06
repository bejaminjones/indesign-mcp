import { describe, it, expect, vi, beforeEach } from "vitest";
import { setTextTool } from "../../../src/tools/set-text.js";
import { lastCall, expectFailure } from "../_helpers.js";

vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("set_text tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(setTextTool.name).toBe("set_text");
    expect(setTextTool.description.length).toBeGreaterThan(0);
  });

  it("accepts minimal valid input", () => {
    expect(
      setTextTool.inputSchema.safeParse({
        frame_id: "f1",
        text: "Hello",
      }).success,
    ).toBe(true);
  });

  it("requires frame_id and text", () => {
    expect(setTextTool.inputSchema.safeParse({ text: "x" }).success).toBe(false);
    expect(setTextTool.inputSchema.safeParse({ frame_id: "f1" }).success).toBe(false);
  });

  it("dispatches a script that assigns text to frame.contents", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { frame_id: "f1", character_count: 5 },
    });

    await setTextTool.handler({ frame_id: "f1", text: "Hello" });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain("frame.contents");
    expect(arg.scriptTemplate).toContain("Hello");
    expect(arg.scriptTemplate).toContain("f1");
  });

  it("escapes special characters via lit()", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { frame_id: "f1", character_count: 13 },
    });

    await setTextTool.handler({
      frame_id: "f1",
      text: 'She said "hi"',
    });

    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.scriptTemplate).toContain('She said');
  });

  it("returns frame_id and character_count on success", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { frame_id: "f1", character_count: 5 },
    });

    const env = await setTextTool.handler({ frame_id: "f1", text: "Hello" });

    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.result).toEqual({ frame_id: "f1", character_count: 5 });
    expect(env.document_state_delta).toBeUndefined();
  });

  it("propagates failure envelopes verbatim", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: { kind: "not_found", message: "frame f99 not found", entity: "frame", id: "f99" },
    });

    const env = await setTextTool.handler({ frame_id: "f99", text: "x" });

    expectFailure(env);
    expect(env.error.kind).toBe("not_found");
  });
});
