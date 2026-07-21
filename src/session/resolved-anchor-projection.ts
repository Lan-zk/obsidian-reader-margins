import type { AnchorRect } from "src/domain/pdf-text-anchor";
import type { PageCardRailSide } from "src/render/page-card-rail";

export type ResolvedAnchorMethod = "locator" | "quote" | "geometry";

export interface ResolvedAnchorEntry {
  annotationId: string;
  pageNumber: number;
  generation: number;
  rects: AnchorRect[];
  method: ResolvedAnchorMethod;
  side?: PageCardRailSide;
}

export class ResolvedAnchorProjection {
  private activeGeneration: number | null = null;
  private pages = new Map<number, Map<string, ResolvedAnchorEntry>>();

  beginPage(generation: number, pageNumber: number): void {
    this.ensureGeneration(generation);
    this.pages.delete(pageNumber);
  }

  set(entry: ResolvedAnchorEntry): void {
    this.ensureGeneration(entry.generation);
    let page = this.pages.get(entry.pageNumber);
    if (!page) {
      page = new Map();
      this.pages.set(entry.pageNumber, page);
    }
    page.set(entry.annotationId, entry);
  }

  hitEntries(generation: number, pageNumber: number): { id: string; rects: AnchorRect[] }[] {
    if (this.activeGeneration !== generation) return [];
    return [...(this.pages.get(pageNumber)?.values() ?? [])].map((entry) => ({
      id: entry.annotationId,
      rects: entry.rects,
    }));
  }

  get(generation: number, pageNumber: number, annotationId: string): ResolvedAnchorEntry | null {
    if (this.activeGeneration !== generation) return null;
    return this.pages.get(pageNumber)?.get(annotationId) ?? null;
  }

  clear(): void {
    this.pages.clear();
    this.activeGeneration = null;
  }

  private ensureGeneration(generation: number): void {
    if (this.activeGeneration === generation) return;
    this.pages.clear();
    this.activeGeneration = generation;
  }
}
