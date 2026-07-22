// src/store/plugin-data-schema.ts
import { DEFAULT_COLORS, DEFAULT_COLOR_ID, validateHexColor, normalizeColors, type ColorConfigV1 } from "src/domain/colors";
import { DEFAULT_LANGUAGE, isLanguage, type Language } from "src/i18n";
import type { AnnotationRecordV1, CardPositionV1 } from "src/domain/annotation";
import type { AnchorRect } from "src/domain/pdf-text-anchor";

export interface PluginSettingsV1 {
  colors: ColorConfigV1[];
  defaultColorId: string;
  language: Language;
  // When true (default), the "mark + annotate" actions open the card's edit box
  // immediately on creation so the user can type without a second click. The
  // plain "mark only" actions never auto-open regardless of this setting.
  autoOpenEdit: boolean;
}

export interface PdfAnnotationDocumentV1 {
  documentId: string;
  sourceSignature: { pdfFingerprint: string; numPages: number };
  revision: number;
  annotations: Record<string, AnnotationRecordV1>;
}

export interface PluginDataV1 {
  schemaVersion: 1;
  stateRevision: number;
  settings: PluginSettingsV1;
  documents: Record<string, PdfAnnotationDocumentV1>; // key = canonical vault path
}

export type DataLoadState = "absent" | "valid" | "needs-migration" | "future" | "invalid";

export function makeDefaultData(): PluginDataV1 {
  return {
    schemaVersion: 1,
    stateRevision: 0,
    settings: { colors: DEFAULT_COLORS.map((c) => ({ ...c })), defaultColorId: DEFAULT_COLOR_ID, language: DEFAULT_LANGUAGE, autoOpenEdit: true },
    documents: {},
  };
}

export function parsePluginData(raw: unknown): { state: DataLoadState; data: PluginDataV1 | null } {
  if (raw === null || raw === undefined) return { state: "absent", data: null };
  if (typeof raw !== "object") return { state: "invalid", data: null };
  const r = raw as Record<string, unknown>;
  if (typeof r.schemaVersion !== "number") return { state: "invalid", data: null };
  if (r.schemaVersion > 1) return { state: "future", data: null };
  if (r.schemaVersion < 1) return { state: "needs-migration", data: null };

  const settings = r.settings as Record<string, unknown> | undefined;
  if (!settings || !Array.isArray(settings.colors)) return { state: "invalid", data: null };
  const colors = normalizeColors(settings.colors);
  if (colors.length === 0) return { state: "invalid", data: null };
  const defaultColorId = typeof settings.defaultColorId === "string" ? settings.defaultColorId : colors[0].id;
  if (!colors.some((c) => c.id === defaultColorId)) return { state: "invalid", data: null };
  const language = isLanguage(settings.language) ? settings.language : DEFAULT_LANGUAGE;
  const autoOpenEdit = typeof settings.autoOpenEdit === "boolean" ? settings.autoOpenEdit : true;

  const documents = r.documents;
  if (documents !== undefined && (typeof documents !== "object" || documents === null)) {
    return { state: "invalid", data: null };
  }

  return {
    state: "valid",
    data: {
      schemaVersion: 1,
      stateRevision: typeof r.stateRevision === "number" ? r.stateRevision : 0,
      settings: { colors, defaultColorId, language, autoOpenEdit },
      documents: sanitizeDocuments(documents),
    },
  };
}

// --- Runtime schema validation (H-02) ---
// Deep-validate every document/annotation on load. Corrupt records are isolated
// (dropped) rather than crashing the index rebuild or reaching the DOM/CSS. The
// plugin stays usable with the valid subset; nothing is rendered from untrusted
// fields.
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function ownDataValue(raw: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(raw, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

export function sanitizeCardPosition(raw: unknown, pageHeight: number): CardPositionV1 | null {
  if (!isObj(raw) || Object.getPrototypeOf(raw) !== Object.prototype) return null;
  const space = ownDataValue(raw, "space");
  const y = ownDataValue(raw, "y");
  const x = ownDataValue(raw, "x");
  if (space !== "page-css-v1" || !isFiniteNum(y)) return null;
  if (x !== undefined && (!isFiniteNum(x) || x < 0)) return null;
  return {
    space: "page-css-v1",
    y: Math.max(0, Math.min(y, pageHeight)),
    ...(x !== undefined ? { x } : {}),
  };
}

function sanitizeAnnotation(raw: unknown): AnnotationRecordV1 | null {
  if (!isObj(raw)) return null;
  const a = raw;
  if (typeof a.id !== "string" || !a.id) return null;
  if (!isFiniteNum(a.revision)) return null;
  if (a.type !== "text-mark") return null;
  if (a.markStyle !== "highlight" && a.markStyle !== "underline") return null;
  if (typeof a.colorLabelSnapshot !== "string") return null;
  if (typeof a.colorValueSnapshot !== "string" || !validateHexColor(a.colorValueSnapshot)) return null;
  if (typeof a.createdAt !== "string" || typeof a.updatedAt !== "string") return null;

  const anchor = a.anchor;
  if (!isObj(anchor)) return null;
  if (anchor.kind !== "pdf-text" || anchor.version !== 1) return null;
  if (!isFiniteNum(anchor.pageNumber) || anchor.pageNumber < 1) return null;
  const quote = anchor.quote;
  if (!isObj(quote) || typeof quote.exact !== "string" || quote.normalization !== "collapse-whitespace-v1") return null;
  const geometry = anchor.geometry;
  if (!isObj(geometry)) return null;
  if (geometry.space !== "page-css-v1") return null;
  if (!isFiniteNum(geometry.pageWidth) || geometry.pageWidth <= 0) return null;
  if (!isFiniteNum(geometry.pageHeight) || geometry.pageHeight <= 0) return null;
  if (![0, 90, 180, 270].includes(geometry.rotation as number)) return null;
  if (!Array.isArray(geometry.rects) || geometry.rects.length === 0) return null;
  const rects: AnchorRect[] = [];
  for (const rr of geometry.rects) {
    if (!isObj(rr)) continue;
    const x = rr.x; const y = rr.y; const width = rr.width; const height = rr.height;
    if (!isFiniteNum(x) || !isFiniteNum(y) || !isFiniteNum(width) || !isFiniteNum(height)) continue;
    rects.push({ x, y, width, height });
  }
  if (rects.length === 0) return null;

  let cardPosition: CardPositionV1 | undefined;
  if (a.cardPosition !== undefined) {
    const sanitized = sanitizeCardPosition(a.cardPosition, geometry.pageHeight);
    if (!sanitized) return null;
    cardPosition = sanitized;
  }

  const locator = isObj(anchor.locator)
    ? {
        beginIndex: Number(anchor.locator.beginIndex),
        beginOffset: Number(anchor.locator.beginOffset),
        endIndex: Number(anchor.locator.endIndex),
        endOffset: Number(anchor.locator.endOffset),
      }
    : undefined;

  return {
    id: a.id,
    revision: a.revision,
    type: "text-mark",
    markStyle: a.markStyle,
    colorIdSnapshot: typeof a.colorIdSnapshot === "string" ? a.colorIdSnapshot : undefined,
    colorLabelSnapshot: a.colorLabelSnapshot,
    colorValueSnapshot: a.colorValueSnapshot,
    comment: typeof a.comment === "string" ? a.comment : undefined,
    cardPosition,
    anchor: {
      kind: "pdf-text",
      version: 1,
      pageNumber: anchor.pageNumber,
      locator,
      quote: {
        exact: quote.exact,
        normalization: "collapse-whitespace-v1",
        prefix: typeof quote.prefix === "string" ? quote.prefix : undefined,
        suffix: typeof quote.suffix === "string" ? quote.suffix : undefined,
      },
      geometry: {
        space: "page-css-v1",
        pageWidth: geometry.pageWidth,
        pageHeight: geometry.pageHeight,
        rotation: geometry.rotation as 0 | 90 | 180 | 270,
        rects,
      },
    },
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

function sanitizeDocument(raw: unknown): PdfAnnotationDocumentV1 | null {
  if (!isObj(raw)) return null;
  const d = raw;
  if (typeof d.documentId !== "string" || !d.documentId) return null;
  const sig = d.sourceSignature;
  if (!isObj(sig) || typeof sig.pdfFingerprint !== "string" || !isFiniteNum(sig.numPages) || sig.numPages < 1) return null;
  if (!isFiniteNum(d.revision)) return null;
  if (!isObj(d.annotations)) return null;
  const annotations: Record<string, AnnotationRecordV1> = {};
  for (const [id, ann] of Object.entries(d.annotations)) {
    const s = sanitizeAnnotation(ann);
    if (s) annotations[id] = s;
  }
  return {
    documentId: d.documentId,
    sourceSignature: { pdfFingerprint: sig.pdfFingerprint, numPages: sig.numPages },
    revision: d.revision,
    annotations,
  };
}

function sanitizeDocuments(raw: unknown): Record<string, PdfAnnotationDocumentV1> {
  if (!isObj(raw)) return {};
  const out: Record<string, PdfAnnotationDocumentV1> = {};
  for (const [path, doc] of Object.entries(raw)) {
    const d = sanitizeDocument(doc);
    if (d) out[path] = d;
  }
  return out;
}

// Deep clone via structuredClone for snapshots (spec §10.6 immutable snapshot).
export function snapshotData(d: PluginDataV1): PluginDataV1 {
  return structuredClone(d);
}

// Validate a #RRGGBB color is safe to use as CSS (spec §14.1).
export function safeColorValue(s: unknown): string | null {
  return validateHexColor(s);
}
