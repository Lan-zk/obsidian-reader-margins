// src/store/durable-annotation-store.ts
import { parsePluginData, makeDefaultData, sanitizeCardPosition, type PluginDataV1, type DataLoadState } from "src/store/plugin-data-schema";
import { AnnotationIndexes } from "src/store/indexes";
import { PersistenceCoordinator, type PersistenceStatus } from "src/store/persistence-coordinator";
import type { AnnotationRecordV1, CreateAnnotationInput, MutationResult, DocumentSignature, DisplayMode } from "src/domain/annotation";
import { normalizeColors, canDeleteColor, validateSettingsMutation, MAX_COLORS, DEFAULT_COLORS, DEFAULT_COLOR_ID } from "src/domain/colors";
import { isLanguage, DEFAULT_LANGUAGE, type Language } from "src/i18n";

export type ChangeKind = "created" | "updated" | "deleted" | "restored";
export interface ChangeEntry { id: string; page?: number; deleted?: boolean; kind?: ChangeKind; }
export interface DocumentPathMove { oldPath: string; newPath: string; }
export interface StoreChangePayload { documentMoves?: DocumentPathMove[]; }
export type ChangeEvent = (pdfPath: string, changes: ChangeEntry[], payload?: StoreChangePayload) => void;
export type RekeyDocumentPathsResult =
  | { ok: true; moved: number }
  | { ok: false; reason: "destination-conflict" | "readonly" };

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
  // Unload path: write the latest full snapshot so unsaved mutations are not
  // lost when Obsidian tears down the plugin without awaiting async cleanup.
  // See PersistenceCoordinator.finalize for the ordering/sealing guarantees.
  finalize(): Promise<void> { return this.coord.finalize(this.data); }
  byPage(path: string, page: number): AnnotationRecordV1[] { return this.indexes.byPage(path, page); }
  byPath(path: string): AnnotationRecordV1[] { return this.indexes.byPath(path); }
  byId(path: string, id: string): AnnotationRecordV1 | undefined { return this.indexes.byId(path, id); }
  documentPaths(): string[] { return this.indexes.paths(); }

  // Move persisted document keys after an Obsidian vault rename. The complete
  // batch is validated before any mutation so folder renames cannot partially
  // move data. Replaying an already-applied rename is a no-op because only
  // currently stored source paths participate in collision checks.
  rekeyDocumentPaths(moves: readonly DocumentPathMove[]): RekeyDocumentPathsResult {
    if (this.isReadonly) return { ok: false, reason: "readonly" };

    const plannedBySource = new Map<string, DocumentPathMove>();
    for (const move of moves) {
      if (move.oldPath === move.newPath || !this.data.documents[move.oldPath]) continue;
      const existing = plannedBySource.get(move.oldPath);
      if (existing && existing.newPath !== move.newPath) {
        return { ok: false, reason: "destination-conflict" };
      }
      plannedBySource.set(move.oldPath, { oldPath: move.oldPath, newPath: move.newPath });
    }
    const planned = Array.from(plannedBySource.values());
    if (planned.length === 0) return { ok: true, moved: 0 };

    const movingSources = new Set(planned.map((move) => move.oldPath));
    const destinations = new Set<string>();
    for (const move of planned) {
      if (destinations.has(move.newPath)) return { ok: false, reason: "destination-conflict" };
      destinations.add(move.newPath);
      if (this.data.documents[move.newPath] && !movingSources.has(move.newPath)) {
        return { ok: false, reason: "destination-conflict" };
      }
    }

    const documents = planned.map((move) => ({ move, document: this.data.documents[move.oldPath] }));
    for (const { move } of documents) delete this.data.documents[move.oldPath];
    for (const { move, document } of documents) {
      document.revision++;
      this.data.documents[move.newPath] = document;
    }
    this.data.stateRevision++;
    this.commit("documents", [], { documentMoves: planned });
    return { ok: true, moved: planned.length };
  }

  // Compatibility repair for documents created before PDF.js 5.x fingerprint
  // discovery was supported. Never rewrites an already-verified fingerprint and
  // never adopts a signature when the page count differs.
  upgradeLegacySourceSignature(path: string, verified: DocumentSignature): boolean {
    if (this.isReadonly || !verified.pdfFingerprint || verified.pdfFingerprint === "unknown") return false;
    const doc = this.data.documents[path];
    if (!doc || doc.sourceSignature.pdfFingerprint !== "unknown") return false;
    if (doc.sourceSignature.numPages !== verified.numPages) return false;

    doc.sourceSignature = { ...verified };
    doc.revision++;
    this.data.stateRevision++;
    this.commit(path, Object.values(doc.annotations).map((ann) => ({ id: ann.id, page: ann.anchor.pageNumber })));
    return true;
  }

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
      displayMode: input.displayMode ?? this.data.settings.defaultDisplayMode,
      colorIdSnapshot: input.colorId, colorLabelSnapshot: input.colorLabel, colorValueSnapshot: input.colorValue,
      comment: input.comment, anchor: input.anchor, createdAt: now, updatedAt: now,
    };
    doc.annotations[id] = record;
    doc.revision++;
    this.data.stateRevision++;
    this.commit(path, [{ id, page: record.anchor.pageNumber, kind: "created" }]);
    return { ok: true, annotation: structuredClone(record), revision: this.data.stateRevision };
  }

  update(path: string, id: string, patch: Partial<Pick<AnnotationRecordV1, "comment" | "markStyle" | "colorValueSnapshot" | "colorLabelSnapshot" | "colorIdSnapshot" | "cardPosition" | "displayMode">>, baseRevision: number): MutationResult {
    if (this.isReadonly) return { ok: false, reason: "store is read-only" };
    const doc = this.data.documents[path];
    const ann = doc?.annotations[id];
    if (!ann) return { ok: false, reason: "annotation not found" };
    if (ann.revision !== baseRevision) return { ok: false, reason: "revision conflict; annotation was modified elsewhere" };
    const applied = { ...patch };
    // Reject an invalid displayMode rather than silently dropping it; the caller
    // learns the mutation did not apply (spec §5.9: invalid stays unpersisted).
    if (Object.prototype.hasOwnProperty.call(applied, "displayMode") && applied.displayMode !== undefined) {
      if (applied.displayMode !== "card" && applied.displayMode !== "popover") {
        return { ok: false, reason: "invalid displayMode" };
      }
    }
    // Card position is page-local on both axes (`page-css-v2`): y is card top,
    // x (optional) is card left; both scale with zoom and scroll with the page.
    // Legacy v1 (x container-px) is migrated by sanitizeCardPosition. Explicit
    // undefined clears the whole position (back to auto-layout).
    if (Object.prototype.hasOwnProperty.call(applied, "cardPosition") && applied.cardPosition !== undefined) {
      const cardPosition = sanitizeCardPosition(applied.cardPosition, ann.anchor.geometry.pageWidth, ann.anchor.geometry.pageHeight);
      if (!cardPosition) return { ok: false, reason: "invalid card position" };
      applied.cardPosition = cardPosition;
    }
    Object.assign(ann, applied);
    ann.revision++;
    ann.updatedAt = new Date().toISOString();
    doc.revision++;
    this.data.stateRevision++;
    this.commit(path, [{ id, page: ann.anchor.pageNumber, kind: "updated" }]);
    return { ok: true, annotation: structuredClone(ann), revision: this.data.stateRevision };
  }

  delete(path: string, id: string): MutationResult {
    if (this.isReadonly) return { ok: false, reason: "store is read-only" };
    const doc = this.data.documents[path];
    const ann = doc?.annotations[id];
    if (!ann) return { ok: false, reason: "annotation not found" };
    const page = ann.anchor.pageNumber;
    delete doc.annotations[id];
    doc.revision++;
    this.data.stateRevision++;
    if (Object.keys(doc.annotations).length === 0) delete this.data.documents[path]; // prune empty (spec §5.1)
    this.commit(path, [{ id, page, deleted: true, kind: "deleted" }]);
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
    this.commit(path, [{ id: tombstone.id, page: restored.anchor.pageNumber, kind: "restored" }]);
    return { ok: true, annotation: structuredClone(restored), revision: this.data.stateRevision };
  }

  // Bulk display-mode conversion (toolbar "convert all" action). Sets every
  // annotation in one document to the same displayMode in a single atomic
  // mutation: one revision bump, one change event, one persistence enqueue.
  // Returns the count of changed annotations (idempotent: already-matching
  // annotations are not counted as changed but the revision still bumps once
  // if anything changed). Read-only stores refuse (spec §5.9).
  setDisplayModeForAll(path: string, mode: DisplayMode): { ok: true; changed: number } | { ok: false; reason: string } {
    if (this.isReadonly) return { ok: false, reason: "store is read-only" };
    const doc = this.data.documents[path];
    if (!doc) return { ok: true, changed: 0 };
    let changed = 0;
    const changes: ChangeEntry[] = [];
    for (const ann of Object.values(doc.annotations)) {
      if (ann.displayMode === mode) continue;
      ann.displayMode = mode;
      ann.revision++;
      ann.updatedAt = new Date().toISOString();
      changed++;
      changes.push({ id: ann.id, page: ann.anchor.pageNumber, kind: "updated" });
    }
    if (changed === 0) return { ok: true, changed: 0 };
    doc.revision++;
    this.data.stateRevision++;
    this.commit(path, changes);
    return { ok: true, changed };
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
      autoOpenEdit: true,
      defaultDisplayMode: "card",
      popoverGraceMs: 180,
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
    // H-11: do not persist or bump revision when the settings are invalid. The UI
    // directly mutated the store object, but the invalid state must stay in memory
    // so the user can see and correct it; it just won't be saved.
    if (!result.ok) return result;
    this.data.stateRevision++;
    this.indexes.rebuild(this.data);
    for (const cb of this.changeListeners) cb("settings", []);
    this.coord.enqueue(this.data, this.data.stateRevision);
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

  private commit(path: string, changes: ChangeEntry[], payload?: StoreChangePayload) {
    this.indexes.rebuild(this.data);
    for (const cb of this.changeListeners) cb(path, changes, payload);
    // Pass the live store object; PersistenceCoordinator.enqueue snapshots it
    // (structuredClone) synchronously before any async save, so no live mutable
    // object crosses an async boundary (spec §5.1). The snapshot invariant is
    // intentionally enforced at the coordinator boundary.
    this.coord.enqueue(this.data, this.data.stateRevision);
  }
}
