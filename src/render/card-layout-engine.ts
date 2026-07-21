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
  contentHeight: number;
}

const GAP_PX = 8;

// Inputs are page-local pixels. Pinned cards become obstacles before any automatic
// card is placed, regardless of anchor order. Automatic cards then push down with
// an 8px gap. Dense mode keeps every card inside the page; when the page cannot
// physically contain them all, automatic cards may overlap at the lower boundary.
export function layoutCards(input: LayoutInput): LayoutOutput {
  const entries = [...input.entries].sort((a, b) => a.anchorY - b.anchorY);
  const positions = new Map<string, CardPosition>();
  const occupied: Array<[number, number]> = [];
  const maxTop = (e: LayoutEntry) => Math.max(0, input.pageHeight - e.cardHeight);
  const clampTop = (e: LayoutEntry, top: number) => Math.max(0, Math.min(top, maxTop(e)));
  const addOccupied = (top: number, height: number) => {
    occupied.push([top, top + height]);
    occupied.sort((a, b) => a[0] - b[0]);
  };

  const avoidOccupied = (e: LayoutEntry, initialTop: number, clampToPage: boolean): number => {
    let top = clampToPage ? clampTop(e, initialTop) : Math.max(0, initialTop);
    for (const [oTop, oBottom] of occupied) {
      if (top + e.cardHeight <= oTop - GAP_PX) break;
      if (top < oBottom + GAP_PX && top + e.cardHeight > oTop - GAP_PX) {
        top = oBottom + GAP_PX;
        if (clampToPage) top = Math.min(top, maxTop(e));
      }
    }
    return top;
  };

  for (const e of entries.filter((entry) => entry.pinTop != null)) {
    const top = clampTop(e, e.pinTop!);
    positions.set(e.annotationId, { top });
    addOccupied(top, e.cardHeight);
  }
  for (const e of entries.filter((entry) => entry.pinTop == null)) {
    const top = avoidOccupied(e, e.anchorY, false);
    positions.set(e.annotationId, { top });
    addOccupied(top, e.cardHeight);
  }

  const requiredHeight = entries.reduce((sum, e) => sum + e.cardHeight, 0)
    + Math.max(0, entries.length - 1) * GAP_PX;
  const crossesPageBoundary = entries.some((e) => {
    const top = positions.get(e.annotationId)?.top ?? 0;
    return top + e.cardHeight > input.pageHeight;
  });
  const dense = requiredHeight > input.pageHeight || crossesPageBoundary;

  if (!dense) {
    return { mode: "normal", positions, visibleCardIds: entries.map((e) => e.annotationId), contentHeight: input.pageHeight };
  }
  // Dense mode keeps the normal page-local positions in scroll content. Clamping
  // every card to the page bottom makes later cards overlap and unreachable.
  const contentHeight = Math.max(input.pageHeight, ...entries.map((entry) =>
    (positions.get(entry.annotationId)?.top ?? 0) + entry.cardHeight));
  const lo = input.railScrollTop, hi = input.railScrollTop + input.railViewportHeight;
  const visible = entries.filter((e) => {
    const p = positions.get(e.annotationId)!;
    return p.top + e.cardHeight >= lo && p.top <= hi;
  }).map((e) => e.annotationId);
  return { mode: "dense", positions, visibleCardIds: visible, contentHeight };
}
