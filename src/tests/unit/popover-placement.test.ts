import { describe, it, expect } from "vitest";
import { computePopoverPlacement, type PopoverDirection } from "src/render/popover-placement";

// All coordinates are viewer-container content pixels (the same space rail cards
// live in). The popover is positioned absolutely in this space so it scrolls
// with the page naturally; the placement function only needs the mark rect, the
// card size, and the visible viewport bounds.
const VIEWPORT = { left: 0, top: 0, right: 1000, bottom: 800 };

describe("computePopoverPlacement", () => {
  it("places above the mark when there is room (first preferred direction)", () => {
    const p = computePopoverPlacement({
      markRect: { x: 400, y: 400, width: 100, height: 20 },
      cardSize: { width: 200, height: 80 },
      viewport: VIEWPORT,
    });
    expect(p.direction).toBe("above");
    // Centered on the mark; bottom sits one gap above the mark top.
    expect(p.left).toBe(450 - 100); // markCenter(450) - cardWidth/2
    expect(p.top + 80).toBe(400 - 8); // cardBottom = markTop - gap
  });

  it("flips to below when there is no room above", () => {
    const p = computePopoverPlacement({
      markRect: { x: 400, y: 10, width: 100, height: 20 }, // near viewport top
      cardSize: { width: 200, height: 80 },
      viewport: VIEWPORT,
    });
    expect(p.direction).toBe("below");
    expect(p.top).toBe(30 + 8); // markBottom(30) + gap
  });

  it("flips to above when there is no room below", () => {
    const p = computePopoverPlacement({
      markRect: { x: 400, y: 780, width: 100, height: 20 }, // near viewport bottom
      cardSize: { width: 200, height: 80 },
      viewport: VIEWPORT,
    });
    expect(p.direction).toBe("above");
  });

  it("falls to left/right when above and below both lack room", () => {
    // A tall card that cannot fit above or below a mark in the vertical middle.
    const p = computePopoverPlacement({
      markRect: { x: 500, y: 400, width: 100, height: 20 },
      cardSize: { width: 200, height: 700 },
      viewport: VIEWPORT,
      preferred: ["above", "below", "left", "right"],
    });
    expect(["left", "right"]).toContain(p.direction);
  });

  it("respects a custom preferred order", () => {
    const p = computePopoverPlacement({
      markRect: { x: 400, y: 400, width: 100, height: 20 },
      cardSize: { width: 200, height: 80 },
      viewport: VIEWPORT,
      preferred: ["right", "above", "below", "left" as PopoverDirection],
    });
    expect(p.direction).toBe("right");
    expect(p.left).toBe(500 + 8); // markRight(500) + gap
  });

  it("clamps into the viewport when no direction fits fully", () => {
    // Card bigger than the viewport in both axes - must still return an in-bounds rect.
    const p = computePopoverPlacement({
      markRect: { x: 400, y: 400, width: 100, height: 20 },
      cardSize: { width: 2000, height: 2000 },
      viewport: VIEWPORT,
    });
    expect(p.left).toBeGreaterThanOrEqual(VIEWPORT.left);
    expect(p.top).toBeGreaterThanOrEqual(VIEWPORT.top);
    expect(p.left).toBeLessThanOrEqual(VIEWPORT.right);
    expect(p.top).toBeLessThanOrEqual(VIEWPORT.bottom);
  });

  it("left placement centers vertically on the mark", () => {
    const p = computePopoverPlacement({
      markRect: { x: 600, y: 400, width: 100, height: 20 },
      cardSize: { width: 200, height: 80 },
      viewport: VIEWPORT,
      preferred: ["left" as PopoverDirection],
    });
    expect(p.direction).toBe("left");
    expect(p.left + 200).toBe(600 - 8); // cardRight = markLeft - gap
    expect(p.top).toBe(410 - 40); // markCenter(410) - cardHeight/2
  });

  it("uses the default gap of 8 when not specified", () => {
    const p = computePopoverPlacement({
      markRect: { x: 400, y: 400, width: 100, height: 20 },
      cardSize: { width: 200, height: 80 },
      viewport: VIEWPORT,
    });
    expect(p.top + 80).toBe(400 - 8);
  });
});
