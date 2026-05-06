import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { resolveUserPath } from "../../src/path-utils.js";

describe("resolveUserPath", () => {
  it("expands a leading ~/ to the user's home directory", () => {
    const result = resolveUserPath("~/Desktop/file.indd");
    expect(result.startsWith(homedir())).toBe(true);
    expect(result.endsWith("/Desktop/file.indd")).toBe(true);
  });

  it("leaves bare ~ (no slash) unchanged before resolve", () => {
    // Bare ~ is a literal directory/file name; only ~/ should expand.
    // It resolves relative to cwd, NOT relative to homedir().
    const result = resolveUserPath("~tilde");
    expect(result).toBe(resolve("~tilde"));
    expect(result).not.toBe(resolve(homedir(), "tilde"));
  });

  it("resolves a relative path to absolute", () => {
    const result = resolveUserPath("./file.indd");
    expect(result.startsWith("/")).toBe(true);
    expect(result.endsWith("/file.indd")).toBe(true);
  });

  it("preserves absolute paths", () => {
    const result = resolveUserPath("/Users/test/file.indd");
    expect(result).toBe("/Users/test/file.indd");
  });
});
