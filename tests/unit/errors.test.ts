import { describe, it, expect } from "vitest";
import { ok, fail, ErrorKind } from "../../src/errors.js";

describe("envelope helpers", () => {
  it("ok() builds a success envelope with a payload", () => {
    const env = ok({ value: 42 });
    expect(env).toEqual({ ok: true, result: { value: 42 } });
  });

  it("ok() with no payload still sets ok: true", () => {
    const env = ok();
    expect(env).toEqual({ ok: true });
  });

  it("fail() builds an error envelope with kind + message", () => {
    const env = fail("not_found", "frame 99 missing");
    expect(env).toEqual({
      ok: false,
      error: { kind: "not_found", message: "frame 99 missing" },
    });
  });

  it("fail() preserves additional error details", () => {
    const env = fail("script_error", "bad ref", { stack: "line 3" });
    expect(env).toEqual({
      ok: false,
      error: { kind: "script_error", message: "bad ref", stack: "line 3" },
    });
  });

  it("ErrorKind values are the closed set from the spec", () => {
    const expected: ErrorKind[] = [
      "script_error",
      "app_not_available",
      "not_found",
      "name_collision",
      "io_error",
      "timeout",
      "invalid_args",
    ];
    // Compile-time assertion — if ErrorKind drifts, this fails to type-check.
    const sample: ErrorKind = expected[0];
    expect(sample).toBe("script_error");
  });
});
