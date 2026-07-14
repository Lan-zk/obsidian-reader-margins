import { describe, it, expect } from "vitest";
import { resolveAnchor, type AnchorResolveResult } from "src/domain/anchor-resolver";
import type { PdfTextAnchorV1 } from "src/domain/pdf-text-anchor";

type ResolvedResult = Extract<AnchorResolveResult, { status: "resolved" }>;
function expectResolved(r: AnchorResolveResult): asserts r is ResolvedResult {
  expect(r.status).toBe("resolved");
}

function anchor(opts: Partial<PdfTextAnchorV1> = {}): PdfTextAnchorV1 {
  return { kind: "pdf-text", version: 1, pageNumber: 1,
    quote: { exact: "hello", normalization: "collapse-whitespace-v1" },
    geometry: { space: "page-css-v1", pageWidth: 600, pageHeight: 800, rotation: 0, rects: [{ x: 10, y: 20, width: 40, height: 12 }] },
    ...opts } as PdfTextAnchorV1;
}

describe("resolveAnchor precedence", () => {
  it("resolves via locator when locator yields matching quote, returning fresh rects", () => {
    const ctx = {
      findRangeByLocator: () => ({ range: { toString: () => "hello" } as Range, rects: [{ x: 5, y: 20, width: 40, height: 12 }] }),
      searchPageText: () => null, pageDims: { pageWidth: 600, pageHeight: 800, rotation: 0 as const },
    };
    const r = resolveAnchor(anchor({ locator: { beginIndex: 0, beginOffset: 0, endIndex: 0, endOffset: 5 } }), ctx);
    expectResolved(r);
    expect(r.method).toBe("locator");
    expect(r.rects).toEqual([{ x: 5, y: 20, width: 40, height: 12 }]); // not the stored geometry
  });
  it("falls back to quote search when locator quote mismatches", () => {
    const ctx = {
      findRangeByLocator: () => ({ range: { toString: () => "WRONG" } as Range, rects: [{ x: 0, y: 0, width: 1, height: 1 }] }),
      searchPageText: () => ({ range: {} as Range, rects: [{ x: 5, y: 20, width: 40, height: 12 }] }),
      pageDims: { pageWidth: 600, pageHeight: 800, rotation: 0 as const },
    };
    const r = resolveAnchor(anchor({ locator: { beginIndex: 0, beginOffset: 0, endIndex: 0, endOffset: 5 } }), ctx);
    expectResolved(r);
    expect(r.method).toBe("quote");
  });
  it("falls back to geometry when quote not found and page dims match", () => {
    const ctx = {
      findRangeByLocator: () => null,
      searchPageText: () => null,
      pageDims: { pageWidth: 600, pageHeight: 800, rotation: 0 as const },
    };
    const r = resolveAnchor(anchor(), ctx);
    expectResolved(r);
    expect(r.method).toBe("geometry");
  });
  it("returns unresolved when geometry dims mismatch", () => {
    const ctx = {
      findRangeByLocator: () => null, searchPageText: () => null,
      pageDims: { pageWidth: 300, pageHeight: 800, rotation: 0 as const },
    };
    const r = resolveAnchor(anchor(), ctx);
    expect(r.status).toBe("unresolved");
  });
  it("returns unresolved on rotation mismatch", () => {
    const ctx = {
      findRangeByLocator: () => null, searchPageText: () => null,
      pageDims: { pageWidth: 600, pageHeight: 800, rotation: 90 as const },
    };
    const r = resolveAnchor(anchor(), ctx);
    expect(r.status).toBe("unresolved");
  });
});
