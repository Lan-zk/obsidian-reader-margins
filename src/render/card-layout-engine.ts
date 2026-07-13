// src/render/card-layout-engine.ts
export interface LayoutEntry { annotationId: string; anchorY: number; cardHeight: number; }
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

export function layoutCards(input: LayoutInput): LayoutOutput {
  const entries = [...input.entries].sort((a, b) => a.anchorY - b.anchorY);
  const positions = new Map<string, CardPosition>();
  let bottom = -Infinity;
  for (const e of entries) {
    const top = Math.max(e.anchorY, bottom === -Infinity ? e.anchorY : bottom + GAP_PX);
    positions.set(e.annotationId, { top });
    bottom = top + e.cardHeight;
  }
  const totalHeight = bottom === -Infinity ? 0 : bottom - (entries[0]?.anchorY ?? 0);
  const dense = totalHeight > input.pageHeight;

  if (!dense) {
    return { mode: "normal", positions, visibleCardIds: entries.map((e) => e.annotationId) };
  }
  // dense: clamp cards into [0, pageHeight], keep reading order
  const clamped = new Map<string, CardPosition>();
  let cursor = 0;
  for (const e of entries) {
    const top = Math.min(cursor, input.pageHeight - e.cardHeight);
    clamped.set(e.annotationId, { top: Math.max(0, top) });
    cursor = Math.max(0, top) + e.cardHeight + GAP_PX;
  }
  const lo = input.railScrollTop, hi = input.railScrollTop + input.railViewportHeight;
  const visible = entries.filter((e) => {
    const p = clamped.get(e.annotationId)!;
    return p.top + e.cardHeight >= lo && p.top <= hi;
  }).map((e) => e.annotationId);
  return { mode: "dense", positions: clamped, visibleCardIds: visible };
}
