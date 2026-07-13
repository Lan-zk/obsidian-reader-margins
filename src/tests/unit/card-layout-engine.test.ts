import { describe, it, expect } from "vitest";
import { layoutCards } from "src/render/card-layout-engine";

describe("CardLayoutEngine", () => {
  it("normal mode: sequential push-down with 8px gap", () => {
    const out = layoutCards({
      pageHeight: 800, railScrollTop: 0, railViewportHeight: 800,
      entries: [
        { annotationId: "a", anchorY: 100, cardHeight: 40 },
        { annotationId: "b", anchorY: 110, cardHeight: 40 },
        { annotationId: "c", anchorY: 500, cardHeight: 40 },
      ],
    });
    expect(out.mode).toBe("normal");
    expect(out.positions.get("a")!.top).toBe(100);
    expect(out.positions.get("b")!.top).toBe(148); // 100 + 40 + 8
    expect(out.positions.get("c")!.top).toBe(500);
  });
  it("enters dense mode when total height exceeds page height", () => {
    const out = layoutCards({
      pageHeight: 200, railScrollTop: 0, railViewportHeight: 200,
      entries: [
        { annotationId: "a", anchorY: 0, cardHeight: 80 },
        { annotationId: "b", anchorY: 10, cardHeight: 80 },
        { annotationId: "c", anchorY: 20, cardHeight: 80 },
      ],
    });
    expect(out.mode).toBe("dense");
    expect(out.positions.get("c")!.top).toBeLessThanOrEqual(200);
  });
  it("dense mode: only visible cards have connector endpoints", () => {
    const out = layoutCards({
      pageHeight: 100, railScrollTop: 0, railViewportHeight: 100,
      entries: [
        { annotationId: "a", anchorY: 0, cardHeight: 60 },
        { annotationId: "b", anchorY: 10, cardHeight: 60 },
      ],
    });
    expect(out.mode).toBe("dense");
    expect(out.visibleCardIds).toContain("a");
  });
  it("normal mode: all cards visible", () => {
    const out = layoutCards({
      pageHeight: 800, railScrollTop: 0, railViewportHeight: 800,
      entries: [{ annotationId: "a", anchorY: 100, cardHeight: 40 }],
    });
    expect(out.visibleCardIds).toEqual(["a"]);
  });
});
