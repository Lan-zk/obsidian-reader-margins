import { describe, expect, it } from "vitest";
import { computeCardRailGeometry } from "src/render/card-drag-geometry";

describe("card drag geometry", () => {
  it("leaves a 12px outer gutter and horizontal travel on the left", () => {
    const out = computeCardRailGeometry({
      side: "left", containerWidth: 1000, pageLeft: 300, pageRight: 700,
    });
    expect(out.minX).toBe(12);
    expect(out.cardWidth).toBe(240);
    expect(out.maxX).toBe(52);
    expect(out.defaultX).toBe(12);
  });

  it("leaves a 12px outer gutter and horizontal travel on the right", () => {
    const out = computeCardRailGeometry({
      side: "right", containerWidth: 1000, pageLeft: 300, pageRight: 700,
    });
    expect(out.minX).toBe(708);
    expect(out.maxX).toBe(748);
    expect(out.defaultX).toBe(748);
  });

  it("shrinks the card enough to retain drag travel in a narrower margin", () => {
    const out = computeCardRailGeometry({
      side: "left", containerWidth: 1000, pageLeft: 200, pageRight: 800,
    });
    expect(out.cardWidth).toBe(156);
    expect(out.maxX - out.minX).toBe(24);
  });

  it("clamps a persisted x into the current page margin after resize", () => {
    const out = computeCardRailGeometry({
      side: "right", containerWidth: 1000, pageLeft: 300, pageRight: 700,
      storedX: 9999,
    });
    expect(out.x).toBe(out.maxX);
  });
});
