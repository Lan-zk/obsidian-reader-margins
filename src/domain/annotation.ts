// src/domain/annotation.ts
import type { PdfTextAnchorV1 } from "src/domain/pdf-text-anchor";

export type MarkStyle = "highlight" | "underline";

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
