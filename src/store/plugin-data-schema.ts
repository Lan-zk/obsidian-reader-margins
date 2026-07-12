// src/store/plugin-data-schema.ts
import { DEFAULT_COLORS, DEFAULT_COLOR_ID, validateHexColor, normalizeColors, type ColorConfigV1 } from "src/domain/colors";
import type { AnnotationRecordV1 } from "src/domain/annotation";

export interface PluginSettingsV1 {
  colors: ColorConfigV1[];
  defaultColorId: string;
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
    settings: { colors: DEFAULT_COLORS.map((c) => ({ ...c })), defaultColorId: DEFAULT_COLOR_ID },
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

  const documents = r.documents;
  if (documents !== undefined && (typeof documents !== "object" || documents === null)) {
    return { state: "invalid", data: null };
  }

  return {
    state: "valid",
    data: {
      schemaVersion: 1,
      stateRevision: typeof r.stateRevision === "number" ? r.stateRevision : 0,
      settings: { colors, defaultColorId },
      documents: (documents ?? {}) as Record<string, PdfAnnotationDocumentV1>,
    },
  };
}

// Deep clone via structuredClone for snapshots (spec §10.6 immutable snapshot).
export function snapshotData(d: PluginDataV1): PluginDataV1 {
  return structuredClone(d);
}

// Validate a #RRGGBB color is safe to use as CSS (spec §14.1).
export function safeColorValue(s: unknown): string | null {
  return validateHexColor(s);
}
