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

  it("ErrorKind covers exactly the closed set from the spec", () => {
    // Compile-time exhaustiveness: if ErrorKind gains or loses a member,
    // this Record literal fails to type-check (missing key or excess key).
    const exhaustive: Record<ErrorKind, true> = {
      script_error: true,
      app_not_available: true,
      not_found: true,
      name_collision: true,
      io_error: true,
      timeout: true,
      invalid_args: true,
    };
    expect(Object.keys(exhaustive).sort()).toEqual([
      "app_not_available",
      "invalid_args",
      "io_error",
      "name_collision",
      "not_found",
      "script_error",
      "timeout",
    ]);
  });
});
