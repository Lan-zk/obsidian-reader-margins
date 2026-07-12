// src/domain/pdf-text-anchor.ts
export interface AnchorRect { x: number; y: number; width: number; height: number; }

export interface PdfTextAnchorV1 {
  kind: "pdf-text";
  version: 1;
  pageNumber: number; // 1-based
  locator?: { beginIndex: number; beginOffset: number; endIndex: number; endOffset: number };
  quote: { exact: string; prefix?: string; suffix?: string; normalization: "collapse-whitespace-v1" };
  geometry: {
    space: "page-css-v1";
    pageWidth: number;
    pageHeight: number;
    rotation: 0 | 90 | 180 | 270;
    rects: AnchorRect[];
  };
}

const MAX_RECTS = 256;
const SAME_LINE_Y_TOL = 2;
const SAME_LINE_H_TOL = 2;
const ADJACENT_X_GAP = 1;

export function cleanGeometry(rects: AnchorRect[], pageW: number, pageH: number): AnchorRect[] {
  const clean = rects.filter((r) =>
    Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.width) && Number.isFinite(r.height) &&
    r.width > 0 && r.height > 0
  );
  const clamped = clean.map((r) => ({
    x: Math.max(0, Math.min(r.x, pageW)),
    y: Math.max(0, Math.min(r.y, pageH)),
    width: Math.min(r.width, pageW - Math.max(0, r.x)),
    height: Math.min(r.height, pageH - Math.max(0, r.y)),
  })).filter((r) => r.width > 0 && r.height > 0);

  if (clamped.length > MAX_RECTS) throw new Error(`too many rects: ${clamped.length} > ${MAX_RECTS}`);

  clamped.sort((a, b) => a.y - b.y || a.x - b.x);
  const merged: AnchorRect[] = [];
  for (const r of clamped) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.y - r.y) <= SAME_LINE_Y_TOL && Math.abs(last.height - r.height) <= SAME_LINE_H_TOL &&
        r.x - (last.x + last.width) <= ADJACENT_X_GAP) {
      last.width = (r.x + r.width) - last.x;
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

export function normalizeQuote(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function computeSortKey(pageNumber: number, firstRect: AnchorRect): string {
  const pad = (n: number, w: number) => String(Math.round(n)).padStart(w, "0");
  return `${pad(pageNumber, 5)}-${pad(firstRect.y, 6)}-${pad(firstRect.x, 6)}`;
}

export function unionCenter(rects: AnchorRect[]): { x: number; y: number } {
  if (rects.length === 0) return { x: 0, y: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width); maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}
