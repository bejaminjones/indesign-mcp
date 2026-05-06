import { describe, it, expect } from "vitest";
import { findDocumentById, findPageById, findFrameById, findStyleByName } from "../../src/script-helpers.js";
import { prelude } from "../../src/compose.js";

describe("script helpers", () => {
  it("findDocumentById is a non-empty function declaration", () => {
    expect(findDocumentById).toContain("function findDocumentById");
    expect(findDocumentById).toContain('throw { name: "not_found"');
  });

  it("findPageById is a non-empty function declaration", () => {
    expect(findPageById).toContain("function findPageById");
    expect(findPageById).toContain('throw { name: "not_found"');
  });

  it("prelude joins multiple helpers with newlines", () => {
    const result = prelude(findDocumentById, findPageById);
    expect(result).toContain("findDocumentById");
    expect(result).toContain("findPageById");
    expect(result.split("\n").length).toBeGreaterThan(2);
  });

  it("prelude with no helpers returns just a newline", () => {
    expect(prelude()).toBe("\n");
  });

  it("findFrameById is a non-empty function declaration", () => {
    expect(findFrameById).toContain("function findFrameById");
    expect(findFrameById).toContain('throw { name: "not_found"');
    expect(findFrameById).toContain("doc.pageItems");
  });

  it("findStyleByName is a non-empty function declaration", () => {
    expect(findStyleByName).toContain("function findStyleByName");
    expect(findStyleByName).toContain('throw { name: "not_found"');
    expect(findStyleByName).toContain("doc.paragraphStyles.itemByName");
  });
});
