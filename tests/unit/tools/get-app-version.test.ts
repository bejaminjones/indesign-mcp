import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAppVersionTool } from "../../../src/tools/get-app-version.js";
import { RESULT_PATH_SENTINEL } from "../../../src/compose.js";
import { lastCall, expectFailure } from "../_helpers.js";

// We test by stubbing the transport. This validates schema, script body,
// and result parsing — without actually running osascript or InDesign.
vi.mock("../../../src/transport/result-file.js", () => ({
  runScriptWithResultFile: vi.fn(),
}));

import { runScriptWithResultFile } from "../../../src/transport/result-file.js";

describe("get_app_version tool", () => {
  beforeEach(() => {
    vi.mocked(runScriptWithResultFile).mockReset();
  });

  it("has the expected metadata", () => {
    expect(getAppVersionTool.name).toBe("get_app_version");
    expect(getAppVersionTool.description).toMatch(/version/i);
  });

  it("rejects extra input properties", () => {
    const parsed = getAppVersionTool.inputSchema.safeParse({ junk: 1 });
    expect(parsed.success).toBe(false);
  });

  it("dispatches an ExtendScript that reads app.version and returns the result", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: true,
      result: { version: "21.0" },
    });
    const env = await getAppVersionTool.handler({});
    expect(env).toEqual({ ok: true, result: { version: "21.0" } });

    expect(runScriptWithResultFile).toHaveBeenCalledOnce();
    const [arg] = lastCall(vi.mocked(runScriptWithResultFile));
    expect(arg.language).toBe("JavaScript");
    expect(arg.scriptTemplate).toContain("app.version");
    expect(arg.scriptTemplate).toContain(RESULT_PATH_SENTINEL);
  });

  it("propagates failure envelopes verbatim", async () => {
    vi.mocked(runScriptWithResultFile).mockResolvedValueOnce({
      ok: false,
      error: { kind: "app_not_available", message: "no app" },
    });
    const env = await getAppVersionTool.handler({});
    expectFailure(env);
    expect(env.error.kind).toBe("app_not_available");
  });
});
