// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { resolveAnchor, searchTextLayerQuote, type AnchorResolveResult } from "src/domain/anchor-resolver";
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
      searchPageText: () => ({ status: "not-found" as const }), pageDims: { pageWidth: 600, pageHeight: 800, rotation: 0 as const },
    };
    const r = resolveAnchor(anchor({ locator: { beginIndex: 0, beginOffset: 0, endIndex: 0, endOffset: 5 } }), ctx);
    expectResolved(r);
    expect(r.method).toBe("locator");
    expect(r.rects).toEqual([{ x: 5, y: 20, width: 40, height: 12 }]); // not the stored geometry
  });
  it("falls back to quote search when locator quote mismatches", () => {
    const ctx = {
      findRangeByLocator: () => ({ range: { toString: () => "WRONG" } as Range, rects: [{ x: 0, y: 0, width: 1, height: 1 }] }),
      searchPageText: () => ({ status: "resolved" as const, hit: { range: {} as Range, rects: [{ x: 5, y: 20, width: 40, height: 12 }] } }),
      pageDims: { pageWidth: 600, pageHeight: 800, rotation: 0 as const },
    };
    const r = resolveAnchor(anchor({ locator: { beginIndex: 0, beginOffset: 0, endIndex: 0, endOffset: 5 } }), ctx);
    expectResolved(r);
    expect(r.method).toBe("quote");
  });
  it("falls back to geometry when quote not found and page dims match", () => {
    const ctx = {
      findRangeByLocator: () => null,
      searchPageText: () => ({ status: "not-found" as const }),
      pageDims: { pageWidth: 600, pageHeight: 800, rotation: 0 as const },
    };
    const r = resolveAnchor(anchor(), ctx);
    expectResolved(r);
    expect(r.method).toBe("geometry");
  });
  it("falls back from a failed locator to matching geometry only after quote not-found", () => {
    const r = resolveAnchor(anchor({ locator: { beginIndex: 9, beginOffset: 0, endIndex: 9, endOffset: 5 } }), {
      findRangeByLocator: () => null,
      searchPageText: () => ({ status: "not-found" }),
      pageDims: { pageWidth: 600, pageHeight: 800, rotation: 0 },
    });
    expectResolved(r);
    expect(r.method).toBe("geometry");
  });
  it("returns unresolved when geometry dims mismatch", () => {
    const ctx = {
      findRangeByLocator: () => null, searchPageText: () => ({ status: "not-found" as const }),
      pageDims: { pageWidth: 300, pageHeight: 800, rotation: 0 as const },
    };
    const r = resolveAnchor(anchor(), ctx);
    expect(r.status).toBe("unresolved");
  });
  it("returns unresolved on rotation mismatch", () => {
    const ctx = {
      findRangeByLocator: () => null, searchPageText: () => ({ status: "not-found" as const }),
      pageDims: { pageWidth: 600, pageHeight: 800, rotation: 90 as const },
    };
    const r = resolveAnchor(anchor(), ctx);
    expect(r.status).toBe("unresolved");
  });
  it("does not fall through to matching stored geometry when quote search is ambiguous", () => {
    const r = resolveAnchor(anchor(), {
      findRangeByLocator: () => null,
      searchPageText: () => ({ status: "ambiguous" }),
      pageDims: { pageWidth: 600, pageHeight: 800, rotation: 0 },
    });
    expect(r).toEqual({ status: "unresolved", reason: "quote is ambiguous" });
  });
});

describe("searchTextLayerQuote", () => {
  function layer(text: string): HTMLElement {
    const el = document.createElement("div");
    el.appendChild(document.createTextNode(text));
    return el;
  }

  const toHit = (range: Range) => ({ range, rects: [{ x: 1, y: 2, width: 3, height: 4 }] });

  it("resolves a unique quote", () => {
    const result = searchTextLayerQuote(layer("before unique quote after"), "unique quote", undefined, undefined, toHit);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expect(result.hit.range.toString()).toBe("unique quote");
  });

  it("uses prefix and suffix to select one repeated quote", () => {
    const result = searchTextLayerQuote(layer("alpha repeat one beta repeat two"), "repeat", "one beta", "two", toHit);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expect(result.hit.range.startOffset).toBe(22);
  });

  it("returns ambiguous when repeated candidates cannot be disambiguated", () => {
    const result = searchTextLayerQuote(layer("same repeat gap repeat end"), "repeat", undefined, undefined, toHit);
    expect(result).toEqual({ status: "ambiguous" });
  });

  it("matches across collapsed whitespace and preserves a live DOM range", () => {
    const textLayer = document.createElement("div");
    textLayer.append("before ");
    const inner = document.createElement("span");
    inner.textContent = "white\n\t space";
    textLayer.append(inner, " after");
    const result = searchTextLayerQuote(textLayer, "white space", "before", "after", toHit);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expect(result.hit.range.toString()).toBe("white\n\t space");
  });

  it("returns not-found only when no normalized quote candidate exists", () => {
    expect(searchTextLayerQuote(layer("some other text"), "missing", undefined, undefined, toHit)).toEqual({ status: "not-found" });
  });
});
