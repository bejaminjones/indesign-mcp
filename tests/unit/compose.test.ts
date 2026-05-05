import { describe, it, expect } from "vitest";
import { Script } from "node:vm";
import { wrapExtendScript } from "../../src/compose.js";

describe("wrapExtendScript", () => {
  it("produces a JXA wrapper that calls InDesign do-script and writes JSON", () => {
    const body = `var doc = app.documents.add(); return { document_id: String(doc.id) };`;
    const wrapped = wrapExtendScript(body);

    // Sanity assertions: the wrapper references the sentinel and the body, and dispatches via InDesign 2026.
    expect(wrapped).toContain("__INDESIGN_MCP_RESULT_PATH__");
    expect(wrapped).toContain("Adobe InDesign 2026");
    expect(wrapped).toContain(body);
    expect(wrapped).toContain("doScript"); // jxa method name
  });

  it("embeds the body verbatim inside the inner script", () => {
    const body = `var s = "she said \\"hi\\"";\nreturn { s: s };`;
    const wrapped = wrapExtendScript(body);
    // Extract the JSON literal passed to indd.doScript and parse it back to
    // recover the inner ExtendScript source. The body must appear unmodified.
    const start = wrapped.indexOf("indd.doScript(") + "indd.doScript(".length;
    const end = wrapped.indexOf(", { language", start);
    const innerSource = JSON.parse(wrapped.slice(start, end)) as string;
    expect(innerSource).toContain(body);
    expect(innerSource).toContain("function _stringify");
  });

  it("matches the documented snapshot", () => {
    const body = `return { x: 1 };`;
    expect(wrapExtendScript(body)).toMatchSnapshot();
  });

  it("emits syntactically valid JavaScript (parse-only)", () => {
    // Constructing a Script parses without executing — JXA-specific globals
    // (Application, $, ObjC) are absent from Node, but parse doesn't need them.
    const cases = [
      `return { x: 1 };`,
      `var s = "hi"; return { s: s };`,
      `// trailing line comment\nreturn { ok: true };`,
      `return { msg: "she said \\"hi\\"" };`,
    ];
    for (const body of cases) {
      const wrapped = wrapExtendScript(body);
      expect(() => new Script(wrapped)).not.toThrow();
    }
  });
});
