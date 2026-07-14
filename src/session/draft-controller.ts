// src/session/draft-controller.ts
import type { Disposable } from "src/session/disposable-scope";

export interface AnnotationDraft {
  annotationId: string;
  baseRevision: number;
  originalComment: string;
  value: string;
}

export class DraftController implements Disposable {
  private drafts = new Map<string, AnnotationDraft>();

  begin(id: string, baseRevision: number, original: string): void {
    this.drafts.set(id, { annotationId: id, baseRevision, originalComment: original, value: original });
  }
  update(id: string, value: string): void {
    const d = this.drafts.get(id);
    if (d) d.value = value;
  }
  has(id: string): boolean { return this.drafts.has(id); }
  peek(id: string): AnnotationDraft | undefined { return this.drafts.get(id); }
  all(): AnnotationDraft[] { return Array.from(this.drafts.values()); }
  commit(id: string): { id: string; value: string; baseRevision: number } | null {
    const d = this.drafts.get(id);
    if (!d) return null;
    this.drafts.delete(id);
    return { id: d.annotationId, value: d.value, baseRevision: d.baseRevision };
  }
  cancel(id?: string): void { if (id) this.drafts.delete(id); else this.drafts.clear(); }
  dispose(): void { this.drafts.clear(); }
}
