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

  it("when evaluated with stubbed JXA globals, writes the expected envelope", () => {
    const wrapped = wrapExtendScript(`return { version: "21.3.0.60" };`);

    let written: string | undefined;
    const fakeNSString = {
      alloc: {
        initWithUTF8String(s: string) {
          return {
            _value: s,
            writeToFileAtomicallyEncodingError(_path: { _value: string }, _atomic: boolean) {
              if (this._value.startsWith("{")) written = this._value;
            },
          };
        },
      },
    };

    const fakeApp = {
      doScript(_innerScript: string, _opts: { language: string }) {
        return '{"ok":true,"result":{"version":"21.3.0.60"}}';
      },
    };

    const context = {
      Application: (_name: string) => fakeApp,
      $: { NSString: fakeNSString, NSUTF8StringEncoding: 4 },
      ObjC: { import: (_lib: string) => {} },
      JSON,
    };

    const substituted = wrapped.replaceAll(
      "__INDESIGN_MCP_RESULT_PATH__",
      "/tmp/test-result.json",
    );

    new Script(substituted).runInNewContext(context);

    expect(written).toBeDefined();
    const env = JSON.parse(written!);
    expect(env).toEqual({ ok: true, result: { version: "21.3.0.60" } });
  });

  it("when the inner script throws, writes a script_error envelope", () => {
    const wrapped = wrapExtendScript(`return { x: 1 };`);

    let written: string | undefined;
    const fakeNSString = {
      alloc: {
        initWithUTF8String(s: string) {
          return {
            _value: s,
            writeToFileAtomicallyEncodingError(_path: unknown) {
              if (this._value.startsWith("{")) written = this._value;
            },
          };
        },
      },
    };

    const fakeApp = {
      doScript() {
        return '{"ok":false,"error":{"kind":"script_error","message":"boom","stack":""}}';
      },
    };

    const context = {
      Application: (_n: string) => fakeApp,
      $: { NSString: fakeNSString, NSUTF8StringEncoding: 4 },
      ObjC: { import: () => {} },
      JSON,
    };

    const substituted = wrapped.replaceAll(
      "__INDESIGN_MCP_RESULT_PATH__",
      "/tmp/test-result.json",
    );

    new Script(substituted).runInNewContext(context);

    expect(written).toBeDefined();
    const env = JSON.parse(written!);
    expect(env.ok).toBe(false);
    expect(env.error.kind).toBe("script_error");
  });

  it("when Application(...) throws, writes an app_not_available envelope", () => {
    const wrapped = wrapExtendScript(`return { x: 1 };`);

    let written: string | undefined;
    const fakeNSString = {
      alloc: {
        initWithUTF8String(s: string) {
          return {
            _value: s,
            writeToFileAtomicallyEncodingError(_path: unknown) {
              if (this._value.startsWith("{")) written = this._value;
            },
          };
        },
      },
    };

    function ApplicationStub(_name: string): never {
      const err: Error & { errorNumber?: number } = new Error("Application can't be found");
      err.errorNumber = -600;
      throw err;
    }

    const context = {
      Application: ApplicationStub,
      $: { NSString: fakeNSString, NSUTF8StringEncoding: 4 },
      ObjC: { import: () => {} },
      JSON,
    };

    const substituted = wrapped.replaceAll(
      "__INDESIGN_MCP_RESULT_PATH__",
      "/tmp/test-result.json",
    );

    new Script(substituted).runInNewContext(context);

    expect(written).toBeDefined();
    const env = JSON.parse(written!);
    expect(env.ok).toBe(false);
    expect(env.error.kind).toBe("app_not_available");
  });

  it("inner ExtendScript produces valid JSON without a global JSON object", () => {
    // The motivating regression: InDesign's ExtendScript engine has no global
    // JSON. The wrapper ships a _stringify polyfill that runs inside the inner
    // script. This test extracts the inner source and evaluates it in a context
    // with NO globals, asserting the polyfill produces parseable JSON.
    const wrapped = wrapExtendScript(
      `return { v: "21.3", arr: [1, 2], esc: 'she said "hi"', nested: { ok: true } };`,
    );
    const start = wrapped.indexOf("indd.doScript(") + "indd.doScript(".length;
    const end = wrapped.indexOf(", { language", start);
    const innerSource = JSON.parse(wrapped.slice(start, end)) as string;

    // Prepend a line that nukes the global JSON so the inner script must use
    // its own _stringify polyfill — simulating ExtendScript's pre-ES5 env.
    const sourceWithNoJSON = `JSON = undefined;\n${innerSource}`;

    const result = new Script(sourceWithNoJSON).runInNewContext({});
    expect(typeof result).toBe("string");
    expect(JSON.parse(result as string)).toEqual({
      ok: true,
      result: { v: "21.3", arr: [1, 2], esc: 'she said "hi"', nested: { ok: true } },
    });
  });

  it("when the inner script throws a structured not_found, propagates kind and entity", () => {
    const wrapped = wrapExtendScript(
      `throw { name: "not_found", message: "frame missing", entity: "frame", id: "f99" };`,
    );

    const start = wrapped.indexOf("indd.doScript(") + "indd.doScript(".length;
    const end = wrapped.indexOf(", { language", start);
    const innerSource = JSON.parse(wrapped.slice(start, end)) as string;

    const result = new Script(innerSource).runInNewContext({});
    expect(typeof result).toBe("string");
    const env = JSON.parse(result as string);
    expect(env.ok).toBe(false);
    expect(env.error.kind).toBe("not_found");
    expect(env.error.entity).toBe("frame");
    expect(env.error.id).toBe("f99");
    expect(env.error.message).toBe("frame missing");
  });

  it("when the inner script throws a plain Error, falls back to script_error", () => {
    const wrapped = wrapExtendScript(`throw new Error("plain error");`);

    const start = wrapped.indexOf("indd.doScript(") + "indd.doScript(".length;
    const end = wrapped.indexOf(", { language", start);
    const innerSource = JSON.parse(wrapped.slice(start, end)) as string;

    const result = new Script(innerSource).runInNewContext({});
    const env = JSON.parse(result as string);
    expect(env.ok).toBe(false);
    expect(env.error.kind).toBe("script_error");
    expect(env.error.message).toBe("plain error");
  });

  it("when the inner script throws an unknown structured object, falls back to script_error", () => {
    const wrapped = wrapExtendScript(`throw { name: "weird_kind", message: "huh" };`);

    const start = wrapped.indexOf("indd.doScript(") + "indd.doScript(".length;
    const end = wrapped.indexOf(", { language", start);
    const innerSource = JSON.parse(wrapped.slice(start, end)) as string;

    const result = new Script(innerSource).runInNewContext({});
    const env = JSON.parse(result as string);
    expect(env.ok).toBe(false);
    expect(env.error.kind).toBe("script_error");
  });
});
