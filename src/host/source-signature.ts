// src/host/source-signature.ts
import type { DocumentSignature } from "src/domain/annotation";

// spec §10.2: pdfFingerprint is not a uniqueness guarantee, only a guard against
// silent misbinding after a same-path replacement.
export function signatureMismatch(a: DocumentSignature, b: DocumentSignature): boolean {
  return a.pdfFingerprint !== b.pdfFingerprint || a.numPages !== b.numPages;
}
