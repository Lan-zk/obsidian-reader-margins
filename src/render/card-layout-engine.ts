// src/render/card-layout-engine.ts
export interface LayoutEntry { annotationId: string; anchorY: number; cardHeight: number; pinTop?: number; }
export interface LayoutInput {
  pageHeight: number;
  railScrollTop: number;
  railViewportHeight: number;
  entries: LayoutEntry[];
}
export interface CardPosition { top: number; }
export interface LayoutOutput {
  mode: "normal" | "dense";
  positions: Map<string, CardPosition>;
  visibleCardIds: string[];
}

const GAP_PX = 8;

// Place cards in reading order (anchorY ascending). A card with `pinTop` is pinned
// to that position (clamped to the page) and becomes a fixed obstacle; unpinned
// cards push down past all occupied intervals so nothing overlaps a pin. Dense mode
// (total > pageHeight) additionally clamps into [0, pageHeight], pins first.
export function layoutCards(input: LayoutInput): LayoutOutput {
  const entries = [...input.entries].sort((a, b) => a.anchorY - b.anchorY);
  const positions = new Map<string, CardPosition>();
  // Occupied [top, bottom] intervals (container px) from already-placed cards.
  const occupied: Array<[number, number]> = [];

  const place = (e: LayoutEntry): number => {
    let top: number;
    if (e.pinTop != null) {
      top = Math.max(0, Math.min(e.pinTop, input.pageHeight - e.cardHeight));
    } else {
      top = e.anchorY;
      for (const [oTop, oBottom] of occupied) {
        if (top + e.cardHeight <= oTop) break;      // fits before this obstacle
        if (top < oBottom) top = oBottom + GAP_PX;  // overlaps -> push past
      }
    }
    occupied.push([top, top + e.cardHeight]);
    occupied.sort((a, b) => a[0] - b[0]);
    return top;
  };

  let bottom = -Infinity;
  for (const e of entries) {
    const top = place(e);
    positions.set(e.annotationId, { top });
    if (top + e.cardHeight > bottom) bottom = top + e.cardHeight;
  }

  const totalHeight = bottom === -Infinity ? 0 : bottom - (entries[0]?.anchorY ?? 0);
  const dense = totalHeight > input.pageHeight;

  if (!dense) {
    return { mode: "normal", positions, visibleCardIds: entries.map((e) => e.annotationId) };
  }

  // dense: clamp into [0, pageHeight]; pins stay fixed, others clamp + re-push.
  const clamped = new Map<string, CardPosition>();
  const denseOccupied: Array<[number, number]> = [];
  for (const e of entries) {
    let top: number;
    if (e.pinTop != null) {
      top = Math.max(0, Math.min(e.pinTop, input.pageHeight - e.cardHeight));
    } else {
      const natural = positions.get(e.annotationId)!.top;
      top = Math.max(0, Math.min(natural, input.pageHeight - e.cardHeight));
      for (const [oTop, oBottom] of denseOccupied) {
        if (top + e.cardHeight <= oTop) break;
        if (top < oBottom) top = Math.min(oBottom + GAP_PX, input.pageHeight - e.cardHeight);
      }
    }
    clamped.set(e.annotationId, { top });
    denseOccupied.push([top, top + e.cardHeight]);
    denseOccupied.sort((a, b) => a[0] - b[0]);
  }

  const lo = input.railScrollTop, hi = input.railScrollTop + input.railViewportHeight;
  const visible = entries.filter((e) => {
    const p = clamped.get(e.annotationId)!;
    return p.top + e.cardHeight >= lo && p.top <= hi;
  }).map((e) => e.annotationId);
  return { mode: "dense", positions: clamped, visibleCardIds: visible };
}
