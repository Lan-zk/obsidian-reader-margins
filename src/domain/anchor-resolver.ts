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
