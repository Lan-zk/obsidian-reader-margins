// src/domain/annotation.ts
import type { PdfTextAnchorV1 } from "src/domain/pdf-text-anchor";

export type MarkStyle = "highlight" | "underline";

// Per-annotation display form. "card" = persistent card in the page margin
// (current behavior). "popover" = mark only; a floating card (same .rm-card
// styles) appears on hover. See docs/design popover pass for the render rules.
export type DisplayMode = "card" | "popover";

// Card position is fully page-local (`page-css-v2`): BOTH x and y are page-
// relative, scale-1, top-left origin, so the whole position is zoom-stable and
// scrolls with the page. x is optional (absent = auto-horizontal via the rail);
// when present, negative x = left margin, x > pageWidth = right margin, and
// x in [0, pageWidth] = on the page. Legacy `space: "page-css-v1"` records
// (y page-local but x viewer-container content px) are migrated to v2 on load
// (x dropped, y kept). Absent on the record = auto-layout (push-down).
export interface CardPositionV1 {
  space: "page-css-v2";
  y: number; // card top, page-relative, unscaled (scales with zoom)
  x?: number; // card left, page-relative, unscaled; absent = auto-horizontal
}

export interface AnnotationRecordV1 {
  id: string;
  revision: number;
  type: "text-mark";
  markStyle: MarkStyle;
  displayMode: DisplayMode;
  colorIdSnapshot?: string;
  colorLabelSnapshot: string;
  colorValueSnapshot: string; // validated #RRGGBB
  comment?: string;
  anchor: PdfTextAnchorV1;
  cardPosition?: CardPositionV1; // user-dragged position; absent = auto-layout
  createdAt: string; // ISO 8601
  updatedAt: string;
}

export interface CreateAnnotationInput {
  markStyle: MarkStyle;
  displayMode?: DisplayMode; // absent = inherit settings.defaultDisplayMode
  colorId: string;
  colorLabel: string;
  colorValue: string;
  comment?: string;
  anchor: PdfTextAnchorV1;
}

export type MutationResult =
  | { ok: true; annotation: AnnotationRecordV1; revision: number }
  | { ok: false; reason: string };

export interface DocumentSignature {
  pdfFingerprint: string;
  numPages: number;
}
