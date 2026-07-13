// src/domain/anchor-resolver.ts
import type { SelectionSnapshot } from "src/session/selection-snapshot-controller";
import { cleanGeometry, normalizeQuote, type PdfTextAnchorV1, type AnchorRect } from "src/domain/pdf-text-anchor";

export interface PageDims { pageWidth: number; pageHeight: number; rotation: 0 | 90 | 180 | 270; }
export interface CaptureContext { prefix?: string; suffix?: string; locator?: PdfTextAnchorV1["locator"]; }

export function captureAnchor(
  snap: SelectionSnapshot,
  pageEl: HTMLElement,
  scale: number,
  dims: PageDims,
  ctx: CaptureContext = {}
): PdfTextAnchorV1 | null {
  const pageRect = pageEl.getBoundingClientRect();
  const raw: AnchorRect[] = snap.clientRects.map((c) => ({
    x: (c.left - pageRect.left) / scale,
    y: (c.top - pageRect.top) / scale,
    width: c.width / scale,
    height: c.height / scale,
  }));
  const rects = cleanGeometry(raw, dims.pageWidth, dims.pageHeight);
  if (rects.length === 0) return null;
  const exact = normalizeQuote(snap.selectedText);
  if (!exact) return null;
  return {
    kind: "pdf-text", version: 1, pageNumber: snap.pageNumber,
    locator: ctx.locator,
    quote: { exact, prefix: ctx.prefix, suffix: ctx.suffix, normalization: "collapse-whitespace-v1" },
    geometry: { space: "page-css-v1", pageWidth: dims.pageWidth, pageHeight: dims.pageHeight, rotation: dims.rotation, rects },
  };
}

export type AnchorResolveResult =
  | { status: "resolved"; rects: AnchorRect[]; method: "locator" | "quote" | "geometry" }
  | { status: "unresolved"; reason: string };

export interface ResolveContext {
  findRangeByLocator: (locator: PdfTextAnchorV1["locator"]) => Range | null;
  searchPageText: (exact: string, prefix: string | undefined, suffix: string | undefined) => { range: Range; rects: AnchorRect[] } | null;
  pageDims: PageDims;
}

const DIM_TOL = 0.01; // 1% relative tolerance (spec §9.6)

// spec §9.6: locator -> quote -> geometry -> unresolved
export function resolveAnchor(anchor: PdfTextAnchorV1, ctx: ResolveContext): AnchorResolveResult {
  const exact = anchor.quote.exact;

  if (anchor.locator) {
    const range = ctx.findRangeByLocator(anchor.locator);
    if (range && normalizeQuote(range.toString()) === exact) {
      return { status: "resolved", rects: anchor.geometry.rects, method: "locator" };
    }
  }
  const hit = ctx.searchPageText(exact, anchor.quote.prefix, anchor.quote.suffix);
  if (hit) {
    return { status: "resolved", rects: hit.rects, method: "quote" };
  }
  const g = anchor.geometry;
  const d = ctx.pageDims;
  const wOk = Math.abs(d.pageWidth - g.pageWidth) / g.pageWidth <= DIM_TOL;
  const hOk = Math.abs(d.pageHeight - g.pageHeight) / g.pageHeight <= DIM_TOL;
  if (wOk && hOk && d.rotation === g.rotation) {
    return { status: "resolved", rects: g.rects, method: "geometry" };
  }
  return { status: "unresolved", reason: "locator, quote, and geometry all failed; dims or rotation mismatch" };
}
