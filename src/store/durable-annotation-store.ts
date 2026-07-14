// src/store/durable-annotation-store.ts
import { parsePluginData, makeDefaultData, snapshotData, type PluginDataV1, type DataLoadState } from "src/store/plugin-data-schema";
import { AnnotationIndexes } from "src/store/indexes";
import { PersistenceCoordinator, type PersistenceStatus } from "src/store/persistence-coordinator";
import type { AnnotationRecordV1, CreateAnnotationInput, MutationResult, DocumentSignature } from "src/domain/annotation";
import { normalizeColors, canDeleteColor, validateSettingsMutation, MAX_COLORS, DEFAULT_COLORS, DEFAULT_COLOR_ID } from "src/domain/colors";
import { isLanguage, DEFAULT_LANGUAGE, type Language } from "src/i18n";

export type ChangeEvent = (pdfPath: string, changedIds: string[]) => void;

const LIMITS = { maxAnnotationsPerDoc: 20_000, maxCommentChars: 100_000, maxQuoteChars: 20_000 };

export class DurableAnnotationStore {
  data: PluginDataV1;
  isReadonly = false;
  private indexes = new AnnotationIndexes();
  private coord: PersistenceCoordinator;
  private changeListeners = new Set<ChangeEvent>();

  constructor(private saveFn: (data: PluginDataV1) => Promise<void>) {
    this.data = makeDefaultData();
    this.coord = new PersistenceCoordinator(saveFn);
    this.indexes.rebuild(this.data);
  }

  loadAndValidate(raw: unknown): DataLoadState {
    const { state, data } = parsePluginData(raw);
    if (state === "valid" && data) {
      this.data = data;
      this.isReadonly = false;
    } else if (state === "absent") {
      this.data = makeDefaultData();
      this.isReadonly = false;
    } else {
      // future / invalid / needs-migration: do NOT overwrite (spec §10.5, §14.2)
      this.isReadonly = true;
      this.data = makeDefaultData();
    }
    this.indexes.rebuild(this.data);
    return state;
  }

  onChange(cb: ChangeEvent): () => void { this.changeListeners.add(cb); return () => this.changeListeners.delete(cb); }
  onStatus(cb: (s: PersistenceStatus) => void): () => void { return this.coord.onStatus(cb); }
  flushBestEffort(): Promise<void> { return this.coord.flushBestEffort(); }
  byPage(path: string, page: number): AnnotationRecordV1[] { return this.indexes.byPage(path, page); }
  byPath(path: string): AnnotationRecordV1[] { return this.indexes.byPath(path); }
  byId(path: string, id: string): AnnotationRecordV1 | undefined { return this.indexes.byId(path, id); }

  create(path: string, input: CreateAnnotationInput, signature: DocumentSignature): MutationResult {
    if (this.isReadonly) return { ok: false, reason: "store is read-only" };
    if (!this.signatureMatches(path, signature)) return { ok: false, reason: "source signature mismatch; refusing to bind annotations" };
    const doc = this.ensureDoc(path, signature);
    if (Object.keys(doc.annotations).length >= LIMITS.maxAnnotationsPerDoc) {
      return { ok: false, reason: "annotation limit reached" };
    }
    if (input.comment && input.comment.length > LIMITS.maxCommentChars) return { ok: false, reason: "comment too long" };
    if (input.anchor.quote.exact.length > LIMITS.maxQuoteChars) return { ok: false, reason: "quote too long" };

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const record: AnnotationRecordV1 = {
      id, revision: 1, type: "text-mark", markStyle: input.markStyle,
      colorIdSnapshot: input.colorId, colorLabelSnapshot: input.colorLabel, colorValueSnapshot: input.colorValue,
      comment: input.comment, anchor: input.anchor, createdAt: now, updatedAt: now,
    };
    doc.annotations[id] = record;
    doc.revision++;
    this.data.stateRevision++;
    this.commit(path, [id]);
    return { ok: true, annotation: structuredClone(record), revision: this.data.stateRevision };
  }

  update(path: string, id: string, patch: Partial<Pick<AnnotationRecordV1, "comment" | "markStyle" | "colorValueSnapshot" | "colorLabelSnapshot" | "colorIdSnapshot" | "cardPosition">>, baseRevision: number): MutationResult {
    if (this.isReadonly) return { ok: false, reason: "store is read-only" };
    const doc = this.data.documents[path];
    const ann = doc?.annotations[id];
    if (!ann) return { ok: false, reason: "annotation not found" };
    if (ann.revision !== baseRevision) return { ok: false, reason: "revision conflict; annotation was modified elsewhere" };
    const applied = { ...patch };
    // cardPosition: clamp y to the page's own height (page-css space). x (viewer-container px)
    // is passed through. undefined clears the whole position.
    if (applied.cardPosition !== undefined && applied.cardPosition !== null) {
      const ph = ann.anchor.geometry.pageHeight;
      const y = Number.isFinite(applied.cardPosition.y) ? applied.cardPosition.y : 0;
      const x = Number.isFinite(applied.cardPosition.x) ? applied.cardPosition.x : undefined;
      applied.cardPosition = { space: "page-css-v1", y: Math.max(0, Math.min(y, ph)), ...(x !== undefined ? { x } : {}) };
    }
    Object.assign(ann, applied);
    ann.revision++;
    ann.updatedAt = new Date().toISOString();
    doc.revision++;
    this.data.stateRevision++;
    this.commit(path, [id]);
    return { ok: true, annotation: structuredClone(ann), revision: this.data.stateRevision };
  }

  delete(path: string, id: string): MutationResult {
    if (this.isReadonly) return { ok: false, reason: "store is read-only" };
    const doc = this.data.documents[path];
    const ann = doc?.annotations[id];
    if (!ann) return { ok: false, reason: "annotation not found" };
    delete doc.annotations[id];
    doc.revision++;
    this.data.stateRevision++;
    if (Object.keys(doc.annotations).length === 0) delete this.data.documents[path]; // prune empty (spec §5.1)
    this.commit(path, [id]);
    return { ok: true, annotation: structuredClone(ann), revision: this.data.stateRevision };
  }

  // Restore a deleted annotation with its original id (and the document's
  // original documentId when the document was pruned). Used by Undo so the
  // identity is preserved - a create() would mint a new id/revision/timestamp
  // and break Markdown snapshot ownership (H-10).
  restore(path: string, tombstone: AnnotationRecordV1, documentId: string | undefined, signature: DocumentSignature): MutationResult {
    if (this.isReadonly) return { ok: false, reason: "store is read-only" };
    if (!this.signatureMatches(path, signature)) return { ok: false, reason: "source signature mismatch; refusing to bind annotations" };
    let doc = this.data.documents[path];
    if (!doc) {
      doc = { documentId: documentId ?? crypto.randomUUID(), sourceSignature: signature, revision: 0, annotations: {} };
      this.data.documents[path] = doc;
    }
    if (doc.annotations[tombstone.id]) return { ok: false, reason: "annotation id already exists" };
    const restored: AnnotationRecordV1 = { ...structuredClone(tombstone), revision: tombstone.revision + 1, updatedAt: new Date().toISOString() };
    doc.annotations[tombstone.id] = restored;
    doc.revision++;
    this.data.stateRevision++;
    this.commit(path, [tombstone.id]);
    return { ok: true, annotation: structuredClone(restored), revision: this.data.stateRevision };
  }

  // --- Settings mutations (spec §13.3) ---
  // Renaming/changing a color value does NOT write back to existing annotation
  // snapshots; only future creates and the toolbar reflect the new settings.
  addColor(): boolean {
    if (this.isReadonly) return false;
    const colors = this.data.settings.colors;
    if (colors.length >= MAX_COLORS) return false;
    const ids = new Set(colors.map((c) => c.id));
    let n = colors.length + 1;
    let id = `color-${n}`;
    while (ids.has(id)) { n++; id = `color-${n}`; }
    colors.push({ id, name: `Color ${n}`, value: "#cccccc" });
    this.commitSettings();
    return true;
  }

  deleteColor(id: string): void {
    if (this.isReadonly) return;
    const settings = this.data.settings;
    if (!canDeleteColor(settings.colors, id, settings.defaultColorId)) return;
    settings.colors = settings.colors.filter((c) => c.id !== id);
    this.commitSettings();
  }

  setDefaultColor(id: string): void {
    if (this.isReadonly) return;
    if (!this.data.settings.colors.some((c) => c.id === id)) return;
    this.data.settings.defaultColorId = id;
    this.commitSettings();
  }

  setLanguage(lang: Language): void {
    if (this.isReadonly) return;
    if (!isLanguage(lang)) return;
    this.data.settings.language = lang;
    this.commitSettings();
  }

  // Restore colors, default color, and language to their built-in defaults.
  resetSettings(): void {
    if (this.isReadonly) return;
    this.data.settings = {
      colors: DEFAULT_COLORS.map((c) => ({ ...c })),
      defaultColorId: DEFAULT_COLOR_ID,
      language: DEFAULT_LANGUAGE,
    };
    this.commitSettings();
  }

  // Persist the current settings. Returns the validation result so the UI can
  // surface problems (duplicate names, empty names). Invalid hex/ids are
  // defensively normalized before saving (spec §10.8).
  commitSettings(): { ok: true } | { ok: false; reason: string } {
    if (this.isReadonly) return { ok: false, reason: "store is read-only" };
    const settings = this.data.settings;
    settings.colors = normalizeColors(settings.colors);
    if (settings.colors.length > 0 && !settings.colors.some((c) => c.id === settings.defaultColorId)) {
      settings.defaultColorId = settings.colors[0].id;
    }
    if (!isLanguage(settings.language)) settings.language = DEFAULT_LANGUAGE;
    const result = validateSettingsMutation(settings.colors, settings.defaultColorId);
    this.data.stateRevision++;
    this.indexes.rebuild(this.data);
    for (const cb of this.changeListeners) cb("settings", []);
    this.coord.enqueue(snapshotData(this.data), this.data.stateRevision);
    return result;
  }

  private signatureMatches(path: string, sig: DocumentSignature): boolean {
    const doc = this.data.documents[path];
    if (!doc) return true;
    return doc.sourceSignature.pdfFingerprint === sig.pdfFingerprint &&
      doc.sourceSignature.numPages === sig.numPages;
  }

  private ensureDoc(path: string, sig: DocumentSignature) {
    if (!this.data.documents[path]) {
      this.data.documents[path] = { documentId: crypto.randomUUID(), sourceSignature: sig, revision: 0, annotations: {} };
    }
    return this.data.documents[path];
  }

  private commit(path: string, ids: string[]) {
    this.indexes.rebuild(this.data);
    for (const cb of this.changeListeners) cb(path, ids);
    this.coord.enqueue(snapshotData(this.data), this.data.stateRevision);
  }
}
