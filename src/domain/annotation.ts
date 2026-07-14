// src/domain/annotation.ts
import type { PdfTextAnchorV1 } from "src/domain/pdf-text-anchor";

export type MarkStyle = "highlight" | "underline";

// User-dragged card position, in the same unscaled page-css space as anchor.geometry
// (page-relative, zoom-stable). Absent on the record = auto-layout (push-down).
export interface CardPositionV1 {
  space: "page-css-v1"; // y is page-relative unscaled; x (if present) is viewer-container content px
  y: number; // card top, page-relative, unscaled (scales with zoom)
  x?: number; // card left in viewer-container content coordinates (zoom-independent); absent = auto
}

export interface AnnotationRecordV1 {
  id: string;
  revision: number;
  type: "text-mark";
  markStyle: MarkStyle;
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
