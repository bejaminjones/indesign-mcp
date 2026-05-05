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

  it("wraps multi-line bodies safely (no string-escape issues)", () => {
    const body = `var s = "she said \\"hi\\"";\nreturn { s: s };`;
    const wrapped = wrapExtendScript(body);
    // The body is embedded as a JSON-encoded string and unwrapped at runtime,
    // so we don't have to escape twice. The wrapper must contain the JSON form.
    expect(wrapped).toContain(JSON.stringify(body));
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
