// src/domain/annotation.ts
import type { PdfTextAnchorV1 } from "src/domain/pdf-text-anchor";

export type MarkStyle = "highlight" | "underline";

// Per-annotation display form. "card" = persistent card in the page margin
// (current behavior). "popover" = mark only; a floating card (same .rm-card
// styles) appears on hover. See docs/design popover pass for the render rules.
export type DisplayMode = "card" | "popover";

// Legacy v1 mixed-coordinate card position. `space` describes y only: y is
// page-local scale-1 CSS (page-relative and zoom-stable), while x is viewer-
// container content px. Current window, rail, and card-size clamps are transient
// DOM projection concerns and must not be written back during rendering.
// Absent on the record = auto-layout (push-down).
export interface CardPositionV1 {
  space: "page-css-v1";
  y: number; // card top, page-relative, unscaled (scales with zoom)
  x?: number; // card left in viewer-container content coordinates (zoom-independent); absent = auto
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
