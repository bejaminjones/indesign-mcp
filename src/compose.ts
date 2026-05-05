/**
 * Sentinel replaced by runScriptWithResultFile with the actual temp-file path
 * before the script is dispatched to osascript.
 */
export const RESULT_PATH_SENTINEL = "__INDESIGN_MCP_RESULT_PATH__";

/**
 * Wraps an ExtendScript body in a JXA shell that dispatches to InDesign.
 *
 * Body must end with `return <value>;` — it's invoked inside an IIFE.
 * Sentinel RESULT_PATH_SENTINEL is substituted by runScriptWithResultFile.
 *
 * Result envelopes written:
 *   success     → {ok:true, result}
 *   body throws → {ok:false, error:{kind:"script_error", message, stack}}
 *   no InDesign → {ok:false, error:{kind:"app_not_available", message}}
 */
export function wrapExtendScript(body: string): string {
  // Embed the body as a JSON string. ExtendScript receives it via JXA's
  // do-script `with arguments {...}` channel.
  const bodyJson = JSON.stringify(body);

  return `
ObjC.import("Foundation");

var resultPath = "${RESULT_PATH_SENTINEL}";
var bodyText = ${bodyJson};

function writeResult(envObj) {
  var s = $.NSString.alloc.initWithUTF8String(JSON.stringify(envObj));
  s.writeToFileAtomicallyEncodingError(resultPath, true, $.NSUTF8StringEncoding, null);
}

try {
  var indd = Application("Adobe InDesign 2026");
  // Build a self-invoking ExtendScript that returns a JSON string we can re-parse.
  // Errors inside ExtendScript surface as exceptions raised back into JXA.
  var wrappedBody =
    "(function(){" +
    "  try {" +
    "    var __r = (function(){\\n" + bodyText + "\\n})();" +
    "    return JSON.stringify({ok:true, result: __r});" +
    "  } catch (e) {" +
    "    return JSON.stringify({" +
    "      ok:false," +
    "      error:{kind:'script_error', message:String(e.message || e), stack:String(e.stack || '')}" +
    "    });" +
    "  }" +
    "})();";
  var raw = indd.doScript(wrappedBody, { language: "javascript" });
  // raw is a JSON string produced by the inner script; trust and forward.
  var env = JSON.parse(String(raw));
  writeResult(env);
} catch (outer) {
  // Most likely cause: InDesign isn't running.
  var msg = String(outer.message || outer);
  var n = outer.errorNumber;
  var kind = (n === -600 || n === -1728 || n === -10814 ||
              msg.indexOf("Application can't be found") !== -1)
    ? "app_not_available"
    : "script_error";
  writeResult({ ok:false, error: { kind: kind, message: msg } });
}
`;
}
