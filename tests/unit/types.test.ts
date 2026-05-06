import { describe, it, expect } from "vitest";
import type { DocumentStateDelta, FrameType } from "../../src/types.js";

describe("DocumentStateDelta", () => {
  it("accepts new_page_ids and removed_page_ids as optional string arrays", () => {
    const delta: DocumentStateDelta = {
      new_page_ids: ["p1", "p2"],
      removed_page_ids: ["p3"],
      page_count: 5,
    };
    expect(delta.new_page_ids).toEqual(["p1", "p2"]);
    expect(delta.removed_page_ids).toEqual(["p3"]);
    expect(delta.page_count).toBe(5);
  });

  it("allows omitting new_page_ids and removed_page_ids", () => {
    const delta: DocumentStateDelta = { page_count: 0 };
    expect(delta.new_page_ids).toBeUndefined();
    expect(delta.removed_page_ids).toBeUndefined();
  });

  it("changed_frames items accept an optional applied_paragraph_style field", () => {
    const delta: DocumentStateDelta = {
      changed_frames: [
        { id: "f1", applied_paragraph_style: "Body" },
        { id: "f2", bounds: [0, 0, 100, 50] },
      ],
    };
    expect(delta.changed_frames?.[0].applied_paragraph_style).toBe("Body");
    expect(delta.changed_frames?.[1].applied_paragraph_style).toBeUndefined();
  });

  it("FrameType is a literal union of text/image/rectangle/line", () => {
    const ft1: FrameType = "text";
    const ft2: FrameType = "image";
    const ft3: FrameType = "rectangle";
    const ft4: FrameType = "line";
    expect([ft1, ft2, ft3, ft4]).toEqual(["text", "image", "rectangle", "line"]);

    // @ts-expect-error — "circle" is not in the union
    const bad: FrameType = "circle";
    expect(bad).toBe("circle"); // runtime no-op; the directive verifies compile failure
  });

  it("new_frames items use FrameType, not bare string", () => {
    const delta: DocumentStateDelta = {
      new_frames: [
        { id: "f1", type: "text" },
        { id: "f2", type: "line" },
      ],
    };
    expect(delta.new_frames?.[0].type).toBe("text");
    expect(delta.new_frames?.[1].type).toBe("line");

    const badDelta: DocumentStateDelta = {
      // @ts-expect-error — bad type rejected
      new_frames: [{ id: "f3", type: "bad" }],
    };
    expect(badDelta.new_frames?.[0].type).toBe("bad");
  });
});
