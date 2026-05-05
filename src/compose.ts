/**
 * Wraps an ExtendScript body in a JavaScript-for-Automation (JXA) shell.
 *
 * The body must be self-contained ExtendScript that ends with a `return <value>;`.
 * The sentinel `__INDESIGN_MCP_RESULT_PATH__` is substituted at dispatch time
 * by the transport layer (runScriptWithResultFile).
 *
 * Outcomes written to the result file:
 *   - body succeeds → {ok:true, result: <return value>}
 *   - body throws   → {ok:false, error:{kind:"script_error", message, stack}}
 *   - InDesign not present (outer JXA failure) → {ok:false, error:{kind:"app_not_available", message}}
 */
export function wrapExtendScript(body: string): string {
  // Embed the body as a JSON string. ExtendScript receives it via JXA's
  // do-script `with arguments {...}` channel.
  const bodyJson = JSON.stringify(body);

  return `
ObjC.import("Foundation");

var resultPath = "__INDESIGN_MCP_RESULT_PATH__";
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
    "    var __r = (function(){" + bodyText + "})();" +
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
  var kind = (msg.indexOf("Application can't be found") !== -1)
    ? "app_not_available"
    : "script_error";
  writeResult({ ok:false, error: { kind: kind, message: msg } });
}
`;
}
