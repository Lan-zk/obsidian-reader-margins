// src/render/popover-placement.ts
// Pure popover/tooltip placement for annotations rendered in "popover" display
// mode (and for card-mode annotations in a narrow margin). All coordinates are
// viewer-container CONTENT pixels - the same space rail cards live in - so the
// popover can be positioned with `position: absolute` and scrolls with the page
// naturally. The caller converts page-css-v1 mark rects to container content
// coords before calling (spec §5.4: every geometry value declares its space).

export type PopoverDirection = "above" | "below" | "left" | "right";

export interface Rect { x: number; y: number; width: number; height: number; }
export interface Box { left: number; top: number; right: number; bottom: number; }

export interface PopoverPlacementInput {
  /** Mark rect in viewer-container content coords (the popover anchor). */
  markRect: Rect;
  /** Popover card size in CSS pixels. */
  cardSize: { width: number; height: number };
  /** Visible viewport bounds in container content coords (scroll-adjusted). */
  viewport: Box;
  /** Gap between the mark and the popover. Default 8. */
  gap?: number;
  /** Directions to try, in preference order. Default above, below, left, right. */
  preferred?: PopoverDirection[];
}

export interface PopoverPlacement {
  /** Popover left, container content coords. */
  left: number;
  /** Popover top, container content coords. */
  top: number;
  direction: PopoverDirection;
}

const DEFAULT_PREFERRED: PopoverDirection[] = ["above", "below", "left", "right"];
const DEFAULT_GAP = 8;

// Natural (unclamped) placement for one direction: the popover sits flush against
// the mark's edge with a gap, centered along that edge.
function naturalPlacement(
  dir: PopoverDirection,
  mark: Rect,
  card: { width: number; height: number },
  gap: number,
): { left: number; top: number } {
  const markCenterX = mark.x + mark.width / 2;
  const markCenterY = mark.y + mark.height / 2;
  switch (dir) {
    case "above": return { left: markCenterX - card.width / 2, top: mark.y - gap - card.height };
    case "below": return { left: markCenterX - card.width / 2, top: mark.y + mark.height + gap };
    case "left":  return { left: mark.x - gap - card.width, top: markCenterY - card.height / 2 };
    case "right": return { left: mark.x + mark.width + gap, top: markCenterY - card.height / 2 };
  }
}

function fits(left: number, top: number, card: { width: number; height: number }, vp: Box): boolean {
  return left >= vp.left && top >= vp.top && left + card.width <= vp.right && top + card.height <= vp.bottom;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export function computePopoverPlacement(input: PopoverPlacementInput): PopoverPlacement {
  const gap = input.gap ?? DEFAULT_GAP;
  const preferred = input.preferred ?? DEFAULT_PREFERRED;
  const card = input.cardSize;
  const vp = input.viewport;

  for (const dir of preferred) {
    const { left, top } = naturalPlacement(dir, input.markRect, card, gap);
    if (fits(left, top, card, vp)) return { left, top, direction: dir };
  }

  // No direction fits fully. Use the first preferred direction and clamp the
  // popover inside the viewport so it never renders off-screen. The card may
  // cover the mark in this fallback, which is acceptable when the viewport is
  // smaller than the card.
  const dir = preferred[0] ?? "above";
  const natural = naturalPlacement(dir, input.markRect, card, gap);
  const left = clamp(natural.left, vp.left, Math.max(vp.left, vp.right - card.width));
  const top = clamp(natural.top, vp.top, Math.max(vp.top, vp.bottom - card.height));
  return { left, top, direction: dir };
}
