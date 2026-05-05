import { describe, it, expect } from "vitest";
import { lit } from "../../src/compose.js";

describe("lit", () => {
  it("quotes strings", () => {
    expect(lit("hello")).toBe('"hello"');
  });

  it("escapes string contents safely", () => {
    expect(lit('he said "hi"')).toBe('"he said \\"hi\\""');
    expect(lit("a\\b")).toBe('"a\\\\b"');
    expect(lit("line1\nline2")).toBe('"line1\\nline2"');
  });

  it("emits numbers as JS literals", () => {
    expect(lit(42)).toBe("42");
    expect(lit(3.14)).toBe("3.14");
    expect(lit(-1)).toBe("-1");
  });

  it("emits booleans as JS literals", () => {
    expect(lit(true)).toBe("true");
    expect(lit(false)).toBe("false");
  });

  it("emits null and undefined as 'null'", () => {
    expect(lit(null)).toBe("null");
    expect(lit(undefined)).toBe("null");
  });
});
