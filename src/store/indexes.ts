// src/store/indexes.ts
import type { PluginDataV1, PdfAnnotationDocumentV1 } from "src/store/plugin-data-schema";
import type { AnnotationRecordV1 } from "src/domain/annotation";
import { computeSortKey } from "src/domain/pdf-text-anchor";

export class AnnotationIndexes {
  private byPathMap = new Map<string, AnnotationRecordV1[]>();
  private byIdMap = new Map<string, Map<string, AnnotationRecordV1>>();
  private byPageMap = new Map<string, Map<number, AnnotationRecordV1[]>>();

  rebuild(data: PluginDataV1): void {
    this.byPathMap.clear(); this.byIdMap.clear(); this.byPageMap.clear();
    for (const [path, doc] of Object.entries(data.documents)) {
      const all = Object.values(doc.annotations);
      all.sort((a, b) => compareSort(a, b));
      this.byPathMap.set(path, all);
      const idMap = new Map<string, AnnotationRecordV1>();
      const pageMap = new Map<number, AnnotationRecordV1[]>();
      for (const ann of all) {
        idMap.set(ann.id, ann);
        const pg = ann.anchor.pageNumber;
        if (!pageMap.has(pg)) pageMap.set(pg, []);
        pageMap.get(pg)!.push(ann);
      }
      this.byIdMap.set(path, idMap);
      this.byPageMap.set(path, pageMap);
    }
  }

  byPath(path: string): AnnotationRecordV1[] { return this.byPathMap.get(path) ?? []; }
  byId(path: string, id: string): AnnotationRecordV1 | undefined { return this.byIdMap.get(path)?.get(id); }
  byPage(path: string, page: number): AnnotationRecordV1[] { return this.byPageMap.get(path)?.get(page) ?? []; }

  document(data: PluginDataV1, path: string): PdfAnnotationDocumentV1 | undefined { return data.documents[path]; }
}

export function compareSort(a: AnnotationRecordV1, b: AnnotationRecordV1): number {
  const ka = computeSortKey(a.anchor.pageNumber, a.anchor.geometry.rects[0] ?? { x: 0, y: 0, width: 0, height: 0 });
  const kb = computeSortKey(b.anchor.pageNumber, b.anchor.geometry.rects[0] ?? { x: 0, y: 0, width: 0, height: 0 });
  if (ka !== kb) return ka < kb ? -1 : 1;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}
