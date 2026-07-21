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
  it("pinned card stays at pinTop", () => {
    const out = layoutCards({
      pageHeight: 800, railScrollTop: 0, railViewportHeight: 800,
      entries: [{ annotationId: "a", anchorY: 100, cardHeight: 40, pinTop: 300 }],
    });
    expect(out.mode).toBe("normal");
    expect(out.positions.get("a")!.top).toBe(300);
  });
  it("unpinned card pushes past a pinned obstacle", () => {
    const out = layoutCards({
      pageHeight: 800, railScrollTop: 0, railViewportHeight: 800,
      entries: [
        { annotationId: "pin", anchorY: 100, cardHeight: 40, pinTop: 120 },
        { annotationId: "free", anchorY: 110, cardHeight: 40 },
      ],
    });
    expect(out.positions.get("pin")!.top).toBe(120);
    // free's anchor (110) overlaps pin's [120,160] -> pushed to 160 + 8
    expect(out.positions.get("free")!.top).toBe(168);
  });
  it("pinned card is clamped into the page", () => {
    const out = layoutCards({
      pageHeight: 200, railScrollTop: 0, railViewportHeight: 200,
      entries: [{ annotationId: "a", anchorY: 0, cardHeight: 40, pinTop: 9999 }],
    });
    expect(out.positions.get("a")!.top).toBe(160); // 200 - 40
  });
  it("treats every pinned card as an obstacle before placing automatic cards", () => {
    const out = layoutCards({
      pageHeight: 800, railScrollTop: 0, railViewportHeight: 800,
      entries: [
        { annotationId: "free", anchorY: 100, cardHeight: 40 },
        { annotationId: "pin", anchorY: 500, cardHeight: 60, pinTop: 120 },
      ],
    });
    expect(out.positions.get("pin")!.top).toBe(120);
    expect(out.positions.get("free")!.top).toBe(188); // pin bottom 180 + 8px gap
  });
  it("keeps pushed-down cards in dense scroll content when they cross the page bottom", () => {
    const out = layoutCards({
      pageHeight: 800, railScrollTop: 0, railViewportHeight: 800,
      entries: [
        { annotationId: "a", anchorY: 700, cardHeight: 80 },
        { annotationId: "b", anchorY: 710, cardHeight: 80 },
      ],
    });
    expect(out.mode).toBe("dense");
    expect(out.positions.get("a")!.top).toBeGreaterThanOrEqual(0);
    expect(out.positions.get("b")!.top).toBe(788);
    expect(out.contentHeight).toBe(868);
  });
  it("keeps dense positions in scroll content so every card remains reachable", () => {
    const out = layoutCards({
      pageHeight: 100, railScrollTop: 80, railViewportHeight: 100,
      entries: [
        { annotationId: "pin", anchorY: 0, cardHeight: 60, pinTop: 0 },
        { annotationId: "automatic", anchorY: 10, cardHeight: 80 },
        { annotationId: "last", anchorY: 20, cardHeight: 80 },
      ],
    });
    expect(out.mode).toBe("dense");
    expect(out.positions.get("pin")!.top).toBe(0);
    expect(out.positions.get("automatic")!.top).toBe(68);
    expect(out.positions.get("last")!.top).toBe(156);
    expect(out.contentHeight).toBe(236);
    expect(out.visibleCardIds).toEqual(["automatic", "last"]);
  });
});
