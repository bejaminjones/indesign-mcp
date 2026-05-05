import { describe, it, expect } from "vitest";
import { runScriptWithResultFile } from "../../src/transport/result-file.js";

describe("runScriptWithResultFile", () => {
  it("substitutes RESULT_PATH and reads the JSON result", async () => {
    // The script uses JavaScript-for-Automation (jxa) so it runs without InDesign.
    const scriptTemplate = `
      ObjC.import("Foundation");
      var path = $.NSString.alloc.initWithUTF8String("__INDESIGN_MCP_RESULT_PATH__");
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
      var path = $.NSString.alloc.initWithUTF8String("__INDESIGN_MCP_RESULT_PATH__");
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

  it("returns script_error when the result file is missing", async () => {
    // Script that exits without writing anything to __INDESIGN_MCP_RESULT_PATH__.
    const scriptTemplate = `"no result written"`;
    const env = await runScriptWithResultFile({ language: "JavaScript", scriptTemplate });
    expect(env.ok).toBe(false);
    if (env.ok) return;
    expect(env.error.kind).toBe("script_error");
  });

  it("returns script_error when the result file is invalid JSON", async () => {
    const scriptTemplate = `
      ObjC.import("Foundation");
      var path = $.NSString.alloc.initWithUTF8String("__INDESIGN_MCP_RESULT_PATH__");
      var raw = $.NSString.alloc.initWithUTF8String("not-json-at-all-{{{");
      raw.writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
    `;
    const env = await runScriptWithResultFile({ language: "JavaScript", scriptTemplate });
    expect(env.ok).toBe(false);
    if (env.ok) return;
    expect(env.error.kind).toBe("script_error");
    expect(env.error.message).toMatch(/not valid JSON/i);
    expect(env.error.stack).toContain("not-json-at-all");
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

  it("rejects an envelope with the wrong shape (e.g. ok: 1)", async () => {
    // Script writes a plausibly-shaped but invalid envelope (truthy-but-wrong ok).
    const scriptTemplate = `
      ObjC.import("Foundation");
      var path = $.NSString.alloc.initWithUTF8String("__INDESIGN_MCP_RESULT_PATH__");
      var json = $.NSString.alloc.initWithUTF8String('{"ok":1,"result":{}}');
      json.writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
    `;
    const env = await runScriptWithResultFile({ language: "JavaScript", scriptTemplate });
    expect(env.ok).toBe(false);
    if (env.ok) return;
    expect(env.error.kind).toBe("script_error");
    expect(env.error.message).toMatch(/envelope/i);
  });

  it("rejects an envelope missing the required ok field", async () => {
    const scriptTemplate = `
      ObjC.import("Foundation");
      var path = $.NSString.alloc.initWithUTF8String("__INDESIGN_MCP_RESULT_PATH__");
      var json = $.NSString.alloc.initWithUTF8String('{"result":"surprise"}');
      json.writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
    `;
    const env = await runScriptWithResultFile({ language: "JavaScript", scriptTemplate });
    expect(env.ok).toBe(false);
    if (env.ok) return;
    expect(env.error.kind).toBe("script_error");
  });

  it("rejects a failure envelope missing the required error.kind field", async () => {
    const scriptTemplate = `
      ObjC.import("Foundation");
      var path = $.NSString.alloc.initWithUTF8String("__INDESIGN_MCP_RESULT_PATH__");
      var json = $.NSString.alloc.initWithUTF8String('{"ok":false,"error":{"message":"oops"}}');
      json.writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
    `;
    const env = await runScriptWithResultFile({ language: "JavaScript", scriptTemplate });
    expect(env.ok).toBe(false);
    if (env.ok) return;
    expect(env.error.kind).toBe("script_error");
  });

  it("rejects a failure envelope missing the error object entirely", async () => {
    const scriptTemplate = `
      ObjC.import("Foundation");
      var path = $.NSString.alloc.initWithUTF8String("__INDESIGN_MCP_RESULT_PATH__");
      var json = $.NSString.alloc.initWithUTF8String('{"ok":false}');
      json.writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
    `;
    const env = await runScriptWithResultFile({ language: "JavaScript", scriptTemplate });
    expect(env.ok).toBe(false);
    if (env.ok) return;
    expect(env.error.kind).toBe("script_error");
  });
});
