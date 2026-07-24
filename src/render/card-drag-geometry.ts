export const CARD_OUTER_GUTTER_PX = 12;
export const CARD_PAGE_GAP_PX = 8;
// Max card width. Margin rail cards are responsive (shrink when the margin is
// narrow via computeCardRailGeometry); on-page (inline) cards use this as a
// fixed width so a card dragged onto the page keeps its width and its ops row
// does not overflow.
export const CARD_MAX_WIDTH_PX = 240;
export const CARD_MIN_WIDTH_PX = 136;
export const CARD_MIN_DRAG_TRAVEL_PX = 24;

export interface CardRailGeometryInput {
  side: "left" | "right";
  containerLeft?: number;
  containerWidth: number;
  pageLeft: number;
  pageRight: number;
  storedX?: number;
  cardWidth?: number;
}

export interface CardRailGeometry {
  cardWidth: number;
  minX: number;
  maxX: number;
  defaultX: number;
  x: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

// All values are relative to the viewer container. The card shrinks before it
// can touch the PDF, while retaining a small horizontal travel range whenever
// the host margin is wide enough.
export function computeCardRailGeometry(input: CardRailGeometryInput): CardRailGeometry {
  const containerLeft = Number.isFinite(input.containerLeft) ? input.containerLeft! : 0;
  const containerWidth = Math.max(0, input.containerWidth);
  const containerRight = containerLeft + containerWidth;
  const pageLeft = clamp(input.pageLeft, containerLeft, containerRight);
  const pageRight = clamp(input.pageRight, pageLeft, containerRight);
  const available = input.side === "left"
    ? Math.max(0, pageLeft - containerLeft - CARD_OUTER_GUTTER_PX - CARD_PAGE_GAP_PX)
    : Math.max(0, containerRight - pageRight - CARD_OUTER_GUTTER_PX - CARD_PAGE_GAP_PX);

  const responsiveWidth = available <= CARD_MIN_WIDTH_PX
    ? available
    : Math.min(CARD_MAX_WIDTH_PX, Math.max(CARD_MIN_WIDTH_PX, available - CARD_MIN_DRAG_TRAVEL_PX));
  const cardWidth = Number.isFinite(input.cardWidth)
    ? clamp(input.cardWidth!, 0, available)
    : responsiveWidth;

  const minX = input.side === "left" ? containerLeft + CARD_OUTER_GUTTER_PX : pageRight + CARD_PAGE_GAP_PX;
  const naturalMaxX = input.side === "left"
    ? pageLeft - CARD_PAGE_GAP_PX - cardWidth
    : containerRight - CARD_OUTER_GUTTER_PX - cardWidth;
  const maxX = Math.max(minX, naturalMaxX);
  const defaultX = input.side === "left" ? minX : maxX;
  const storedX = Number.isFinite(input.storedX) ? input.storedX! : defaultX;

  return { cardWidth, minX, maxX, defaultX, x: clamp(storedX, minX, maxX) };
}
