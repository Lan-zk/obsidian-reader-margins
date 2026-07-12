import { describe, it, expect } from "vitest";
import { cleanGeometry, normalizeQuote, computeSortKey, unionCenter } from "src/domain/pdf-text-anchor";

describe("cleanGeometry", () => {
  it("drops zero-width and zero-height rects", () => {
    const out = cleanGeometry(
      [{ x: 0, y: 0, width: 0, height: 10 }, { x: 0, y: 0, width: 10, height: 0 }, { x: 0, y: 0, width: 10, height: 10 }],
      600, 800
    );
    expect(out).toHaveLength(1);
  });
  it("clamps rects to page bounds", () => {
    const out = cleanGeometry([{ x: -5, y: -5, width: 700, height: 900 }], 600, 800);
    expect(out[0].x).toBe(0); expect(out[0].y).toBe(0);
    expect(out[0].width).toBe(600); expect(out[0].height).toBe(800);
  });
  it("merges horizontally adjacent rects on the same line", () => {
    const out = cleanGeometry(
      [{ x: 10, y: 20, width: 30, height: 12 }, { x: 40, y: 20, width: 30, height: 12 }],
      600, 800
    );
    expect(out).toHaveLength(1);
    expect(out[0].width).toBe(60);
  });
  it("does not merge rects on different lines", () => {
    const out = cleanGeometry(
      [{ x: 10, y: 20, width: 30, height: 12 }, { x: 10, y: 50, width: 30, height: 12 }],
      600, 800
    );
    expect(out).toHaveLength(2);
  });
  it("rejects over 256 rects", () => {
    const rects = Array.from({ length: 300 }, (_, i) => ({ x: i, y: 0, width: 1, height: 1 }));
    expect(() => cleanGeometry(rects, 600, 800)).toThrow();
  });
  it("drops non-finite coordinates", () => {
    const out = cleanGeometry(
      [{ x: NaN, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 10, height: 10 }] as any,
      600, 800
    );
    expect(out).toHaveLength(1);
  });
});

describe("normalizeQuote", () => {
  it("collapses whitespace", () => {
    expect(normalizeQuote("hello   world\n\tfoo")).toBe("hello world foo");
  });
  it("trims", () => { expect(normalizeQuote("  hi  ")).toBe("hi"); });
  it("empty stays empty", () => { expect(normalizeQuote("   ")).toBe(""); });
});

describe("computeSortKey", () => {
  it("zero-pads page then y then x", () => {
    const k = computeSortKey(12, { x: 30, y: 200, width: 10, height: 10 });
    expect(k).toBe("00012-000200-000030");
  });
  it("sorts lexicographically as reading order", () => {
    const a = computeSortKey(1, { x: 0, y: 100, width: 10, height: 10 });
    const b = computeSortKey(1, { x: 0, y: 200, width: 10, height: 10 });
    const c = computeSortKey(2, { x: 0, y: 50, width: 10, height: 10 });
    expect([c, b, a].sort()).toEqual([a, b, c]);
  });
});

describe("unionCenter", () => {
  it("returns center of the union bounding box", () => {
    const c = unionCenter([{ x: 0, y: 0, width: 10, height: 10 }, { x: 100, y: 100, width: 10, height: 10 }]);
    expect(c.x).toBe(55); expect(c.y).toBe(55);
  });
});
