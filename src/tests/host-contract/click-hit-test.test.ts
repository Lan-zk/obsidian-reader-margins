// src/tests/host-contract/click-hit-test.test.ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { hitTestAnnotation } from "src/render/page-projection";
import { ResolvedAnchorProjection } from "src/session/resolved-anchor-projection";

describe("click hit-test", () => {
  it("returns the annotation id whose rect contains the point", () => {
    const anns = [{ id: "a", rects: [{ x: 10, y: 10, width: 50, height: 14 }] }];
    expect(hitTestAnnotation(anns, 20, 15)).toBe("a");
    expect(hitTestAnnotation(anns, 100, 100)).toBeNull();
  });
  it("checks every rect of every annotation", () => {
    const anns = [
      { id: "a", rects: [{ x: 0, y: 0, width: 10, height: 10 }] },
      { id: "b", rects: [{ x: 100, y: 100, width: 20, height: 20 }, { x: 200, y: 200, width: 5, height: 5 }] },
    ];
    expect(hitTestAnnotation(anns, 110, 110)).toBe("b");
    expect(hitTestAnnotation(anns, 202, 202)).toBe("b");
    expect(hitTestAnnotation(anns, 5, 5)).toBe("a");
  });
  it("keeps resolved rectangles scoped to the active generation and page rebuild", () => {
    const projection = new ResolvedAnchorProjection();
    projection.beginPage(3, 1);
    projection.set({
      annotationId: "a", pageNumber: 1, generation: 3,
      rects: [{ x: 40, y: 50, width: 20, height: 10 }], method: "quote",
    });
    expect(hitTestAnnotation(projection.hitEntries(3, 1), 45, 55)).toBe("a");
    expect(projection.hitEntries(2, 1)).toEqual([]);

    projection.beginPage(3, 1);
    expect(projection.hitEntries(3, 1)).toEqual([]);
    projection.set({
      annotationId: "b", pageNumber: 2, generation: 3,
      rects: [{ x: 1, y: 2, width: 3, height: 4 }], method: "geometry",
    });
    projection.clear();
    expect(projection.hitEntries(3, 2)).toEqual([]);
  });
});
