/**
 * Sentinel replaced by runScriptWithResultFile with the actual temp-file path
 * before the script is dispatched to osascript.
 */
export const RESULT_PATH_SENTINEL = "__INDESIGN_MCP_RESULT_PATH__";

/**
 * Minimal JSON.stringify shim for InDesign's ExtendScript engine, which is
 * pre-ES5 and does not provide a global JSON. Handles primitives, arrays, and
 * plain objects. Strings are escaped to be JSON-safe.
 *
 * Authored as a String.raw template so backslash sequences inside regex/string
 * literals are passed through verbatim into the runtime ExtendScript source.
 */
const ES_STRINGIFY = String.raw`function _stringify(v) {
  if (v === null || v === undefined) return 'null';
  var t = typeof v;
  if (t === 'number') return isFinite(v) ? String(v) : 'null';
  if (t === 'boolean') return v ? 'true' : 'false';
  if (t === 'string') {
    return '"' + v
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t') + '"';
  }
  if (t === 'object') {
    if (Object.prototype.toString.call(v) === '[object Array]') {
      var parts = [];
      for (var i = 0; i < v.length; i++) parts.push(_stringify(v[i]));
      return '[' + parts.join(',') + ']';
    }
    var pairs = [];
    for (var k in v) {
      if (v.hasOwnProperty(k)) pairs.push(_stringify(k) + ':' + _stringify(v[k]));
    }
    return '{' + pairs.join(',') + '}';
  }
  return 'null';
}`;

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
  const innerSource =
    ES_STRINGIFY +
    `\n(function() {\n  try {\n    var __r = (function() {\n${body}\n    })();\n    return '{"ok":true,"result":' + _stringify(__r) + '}';\n  } catch (e) {\n    var msg = String(e.message || e);\n    var stk = String(e.stack || '');\n    return '{"ok":false,"error":{"kind":"script_error","message":' + _stringify(msg) + ',"stack":' + _stringify(stk) + '}}';\n  }\n})();\n`;

  const innerLiteral = JSON.stringify(innerSource);

  return `
ObjC.import("Foundation");
var resultPath = "${RESULT_PATH_SENTINEL}";

function writeResult(envObj) {
  var s = $.NSString.alloc.initWithUTF8String(JSON.stringify(envObj));
  s.writeToFileAtomicallyEncodingError(resultPath, true, $.NSUTF8StringEncoding, null);
}

try {
  var indd = Application("Adobe InDesign 2026");
  var raw = indd.doScript(${innerLiteral}, { language: "javascript" });
  var env = JSON.parse(String(raw));
  writeResult(env);
} catch (outer) {
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
