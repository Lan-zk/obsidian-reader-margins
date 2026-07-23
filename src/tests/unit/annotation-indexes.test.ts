import { describe, it, expect } from "vitest";
import { AnnotationIndexes } from "src/store/indexes";
import type { PluginDataV1 } from "src/store/plugin-data-schema";
import type { AnnotationRecordV1 } from "src/domain/annotation";

function mkDoc(path: string, anns: AnnotationRecordV1[]): PluginDataV1 {
  const map: Record<string, AnnotationRecordV1> = {};
  for (const a of anns) map[a.id] = a;
  return {
    schemaVersion: 1, stateRevision: 0,
    settings: { colors: [{ id: "y", name: "Y", value: "#fff15c" }], defaultColorId: "y", language: "auto", autoOpenEdit: true, defaultDisplayMode: "card", popoverGraceMs: 180 },
    documents: { [path]: { documentId: "d1", sourceSignature: { pdfFingerprint: "fp", numPages: 3 }, revision: 0, annotations: map } },
  };
}
function mkAnn(id: string, page: number, y: number): AnnotationRecordV1 {
  return {
    id, revision: 1, type: "text-mark", markStyle: "highlight", displayMode: "card",
    colorIdSnapshot: "y", colorLabelSnapshot: "Y", colorValueSnapshot: "#fff15c",
    anchor: { kind: "pdf-text", version: 1, pageNumber: page,
      quote: { exact: "x", normalization: "collapse-whitespace-v1" },
      geometry: { space: "page-css-v1", pageWidth: 600, pageHeight: 800, rotation: 0,
        rects: [{ x: 0, y, width: 10, height: 10 }] } },
    createdAt: "2026-07-12T00:00:00Z", updatedAt: "2026-07-12T00:00:00Z",
  };
}

describe("AnnotationIndexes", () => {
  it("byPage returns annotations sorted by sortKey (y asc)", () => {
    const data = mkDoc("a.pdf", [mkAnn("1", 1, 200), mkAnn("2", 1, 100), mkAnn("3", 2, 50)]);
    const idx = new AnnotationIndexes(); idx.rebuild(data);
    const page1 = idx.byPage("a.pdf", 1);
    expect(page1.map((a) => a.id)).toEqual(["2", "1"]);
  });
  it("byId finds an annotation", () => {
    const data = mkDoc("a.pdf", [mkAnn("1", 1, 0)]);
    const idx = new AnnotationIndexes(); idx.rebuild(data);
    expect(idx.byId("a.pdf", "1")?.id).toBe("1");
    expect(idx.byId("a.pdf", "missing")).toBeUndefined();
  });
  it("byPath lists all annotations in a document", () => {
    const data = mkDoc("a.pdf", [mkAnn("1", 1, 0), mkAnn("2", 2, 0)]);
    const idx = new AnnotationIndexes(); idx.rebuild(data);
    expect(idx.byPath("a.pdf")).toHaveLength(2);
    expect(idx.byPath("none.pdf")).toHaveLength(0);
  });
});
