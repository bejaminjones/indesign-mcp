import { describe, it, expect } from "vitest";
import { runScriptWithResultFile } from "../../src/transport/result-file.js";

describe("runScriptWithResultFile", () => {
  it("substitutes RESULT_PATH and reads the JSON result", async () => {
    // The script uses JavaScript-for-Automation (jxa) so it runs without InDesign.
    const scriptTemplate = `
      ObjC.import("Foundation");
      var path = $.NSString.alloc.initWithUTF8String("RESULT_PATH");
      var json = $.NSString.alloc.initWithUTF8String(JSON.stringify({ok:true, result:{n:7}}));
      json.writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
    `;
    const env = await runScriptWithResultFile({
      language: "JavaScript",
      scriptTemplate,
    });
    expect(env).toEqual({ ok: true, result: { n: 7 } });
  });

  it("forwards a failure envelope verbatim when the script writes one", async () => {
    // No InDesign call here — just verify the transport returns whatever
    // envelope the script writes.
    const scriptTemplate = `
      ObjC.import("Foundation");
      var path = $.NSString.alloc.initWithUTF8String("RESULT_PATH");
      var json = $.NSString.alloc.initWithUTF8String(JSON.stringify({
        ok:false,
        error:{kind:"app_not_available", message:"InDesign not running"}
      }));
      json.writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
    `;
    const env = await runScriptWithResultFile({ language: "JavaScript", scriptTemplate });
    expect(env.ok).toBe(false);
    if (env.ok) return;
    expect(env.error.kind).toBe("app_not_available");
  });

  it("returns script_error when the result file is missing or invalid JSON", async () => {
    // Script that exits without writing anything to RESULT_PATH.
    const scriptTemplate = `"no result written"`;
    const env = await runScriptWithResultFile({ language: "JavaScript", scriptTemplate });
    expect(env.ok).toBe(false);
    if (env.ok) return;
    expect(env.error.kind).toBe("script_error");
  });

  it("returns timeout when the script hangs", async () => {
    const scriptTemplate = `delay(5)`; // jxa
    const env = await runScriptWithResultFile({
      language: "JavaScript",
      scriptTemplate,
      timeoutMs: 200,
    });
    expect(env.ok).toBe(false);
    if (env.ok) return;
    expect(env.error.kind).toBe("timeout");
  });
});
