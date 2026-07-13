// src/render/page-projection.ts
// Pure helpers for per-page projection. The full PageProjection class (spec §12)
// is deferred; rendering currently lives inline in ViewerSession. This module
// hosts shared pure functions used by click hit-testing.

export interface HitRect { x: number; y: number; width: number; height: number; }
export interface HitEntry { id: string; rects: HitRect[]; }

// Return the id of the first annotation whose rect contains (px, py) in page-css
// coordinates (scale = 1), or null if none match (spec §12.2).
export function hitTestAnnotation(anns: HitEntry[], px: number, py: number): string | null {
  for (const a of anns) {
    for (const r of a.rects) {
      if (px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height) {
        return a.id;
      }
    }
  }
  return null;
}
