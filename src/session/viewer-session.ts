// src/session/viewer-session.ts
import type { HostHandles, HostCapabilities } from "src/host/host-typings";
import { probeHostHandles, readCurrentScale, findPageEl, readPdfFingerprint, readPageCount } from "src/host/obsidian-pdf-host";
import { probeCapabilities } from "src/host/host-capabilities";
import { DisposableScope } from "src/session/disposable-scope";
import { SelectionSnapshotController } from "src/session/selection-snapshot-controller";
import { DraftController } from "src/session/draft-controller";
import { showUndoNotice } from "src/session/undo-notice";
import { ToolbarController } from "src/toolbar/toolbar-controller";
import { Notice } from "obsidian";
import { drawEphemeralMark, clearMarks } from "src/render/mark-renderer";
import { buildCard, type CardCallbacks } from "src/render/annotation-card-rail";
import { drawEphemeralConnector } from "src/render/connector-renderer";
import { layoutCards } from "src/render/card-layout-engine";
import { unionCenter, cleanGeometry } from "src/domain/pdf-text-anchor";
import { captureAnchor } from "src/domain/anchor-resolver";
import { ExportModal } from "src/export/export-modal";
import { MarkdownExportService } from "src/export/markdown-export-service";
import { hitTestAnnotation } from "src/render/page-projection";
import type { DurableAnnotationStore } from "src/store/durable-annotation-store";
import { signatureMismatch } from "src/host/source-signature";
import type { AnnotationRecordV1, DocumentSignature, MutationResult } from "src/domain/annotation";

export type SessionState = "discovered" | "probing" | "attached" | "degraded" | "disposing" | "disposed";

export interface ViewerSessionOptions {
  probeIntervalMs?: number;
  probeTimeoutMs?: number;
}

const DEFAULTS = { probeIntervalMs: 200, probeTimeoutMs: 5000 };

export class ViewerSession {
  state: SessionState = "discovered";
  readonly pdfPath: string;
  get disposerCount(): number { return this.scope.size; }

  private scope = new DisposableScope();
  private sel = new SelectionSnapshotController();
  private handles: HostHandles | null = null;
  private caps: HostCapabilities | null = null;
  private generation = 0;
  private probeTimer: ReturnType<typeof setTimeout> | null = null;
  private opts: Required<ViewerSessionOptions>;
  private signature: DocumentSignature | null = null;
  private sigWarned = false;
  private pendingReconcile = new Set<number>();
  private rafId: number | null = null;
  private editingId: string | null = null;
  private hoveredId: string | null = null;
  private draft = new DraftController();
  private toolbar: ToolbarController | null = null;

  constructor(private view: any, pdfPath: string, private store: DurableAnnotationStore, opts: ViewerSessionOptions = {}) {
    this.pdfPath = pdfPath;
    this.opts = { ...DEFAULTS, ...opts } as Required<ViewerSessionOptions>;
  }

  attach(): Promise<void> {
    if (this.state === "attached" || this.state === "degraded") return Promise.resolve();
    this.state = "probing";
    const gen = this.generation;
    const start = Date.now();
    return new Promise((resolve) => {
      const tryProbe = () => {
        if (this.generation !== gen) return resolve();
        const h = probeHostHandles(this.view);
        if (h) { this.finishAttach(h, gen); return resolve(); }
        if (Date.now() - start >= this.opts.probeTimeoutMs) {
          this.state = "degraded";
          return resolve();
        }
        this.probeTimer = setTimeout(tryProbe, this.opts.probeIntervalMs);
      };
      tryProbe();
    });
  }

  private finishAttach(h: HostHandles, gen: number): void {
    this.handles = h;
    this.caps = probeCapabilities(h, { sourceSignature: "verified" });
    // Resolve sourceSignature (spec §10.2) - best-effort; verified in M-1 smoke gate.
    const fp = readPdfFingerprint(h);
    const pc = readPageCount(h);
    this.signature = fp && pc ? { pdfFingerprint: fp, numPages: pc } : null;

    // spec §7.5: register listeners BEFORE scanning existing pages.
    const bus = h.eventBus as any;
    if (bus && typeof bus.on === "function") {
      const onTextLayer = (e: any) => {
        if (this.generation !== gen) return;
        this.reconcilePage(e?.pageNumber ?? 0);
      };
      bus.on("textlayerrendered", onTextLayer);
      this.scope.addDispose(() => bus.off?.("textlayerrendered", onTextLayer));
    }
    const onPointerUp = () => {
      if (!this.handles) return;
      this.sel.capture(`gen${this.generation}`, this.handles.viewerEl.ownerDocument.defaultView!, this.handles.viewerEl);
    };
    h.viewerEl.addEventListener("pointerup", onPointerUp);
    this.scope.addDispose(() => h.viewerEl.removeEventListener("pointerup", onPointerUp));

    // Click hit-test: clicking a mark flashes its linked card (spec §12.2).
    const onClick = (e: MouseEvent) => this.onPageClick(e);
    h.viewerEl.addEventListener("click", onClick);
    this.scope.addDispose(() => h.viewerEl.removeEventListener("click", onClick));

    // Subscribe to store changes: re-reconcile affected pages (spec §6.2).
    const unsub = this.store.onChange((path, ids) => {
      if (path === "settings") {
        const colors = this.store.data.settings.colors.map((c) => ({ id: c.id, value: c.value, label: c.name }));
        this.toolbar?.updateColors(colors, this.store.data.settings.defaultColorId);
        return;
      }
      if (path !== this.pdfPath) return;
      const pages = new Set<number>();
      for (const id of ids) {
        const a = this.store.byId(path, id);
        if (a) pages.add(a.anchor.pageNumber);
        else this.removeAnnotationDom(id); // deleted: remove card + connector
      }
      pages.forEach((p) => this.reconcilePage(p));
    });
    this.scope.addDispose(unsub);

    this.state = "attached";
    const pages = h.viewerEl.querySelectorAll<HTMLElement>(".page[data-page-number]");
    pages.forEach((p) => this.reconcilePage(parseInt(p.dataset.pageNumber ?? "", 10)));

    // Toolbar (color swatches / underline / export / persistence status)
    const colors = this.store.data.settings.colors.map((c) => ({ id: c.id, value: c.value, label: c.name }));
    this.toolbar = new ToolbarController(h, colors, this.store.data.settings.defaultColorId);
    this.toolbar.render({
      onColor: (colorId) => { const r = this.createAnnotation("highlight", colorId); if (!r.ok) new Notice(r.reason); },
      onUnderline: () => { const r = this.createAnnotation("underline"); if (!r.ok) new Notice(r.reason); },
      onExport: () => this.openExport(),
    });
    const unsubStatus = this.store.onStatus((s) => this.toolbar?.setStatus(s));
    this.scope.addDispose(unsubStatus);
    this.scope.addDispose(() => { this.toolbar?.dispose(); this.toolbar = null; });
  }

  // M0: render annotations from the store for this page.
  // Coalesced via rAF so rapid events (zoom -> multiple textlayerrendered) batch into one frame (spec §12.6).
  reconcilePage(pageNumber: number): void {
    if (!this.handles || this.state !== "attached") return;
    this.pendingReconcile.add(pageNumber);
    if (this.rafId !== null) return;
    const gen = this.generation;
    const win = this.handles.viewerEl.ownerDocument.defaultView;
    if (!win) { this.flushReconcile(); return; }
    this.rafId = win.requestAnimationFrame(() => {
      if (this.generation !== gen) { this.rafId = null; return; }
      this.rafId = null;
      this.flushReconcile();
    });
  }

  private flushReconcile(): void {
    const pages = this.pendingReconcile;
    this.pendingReconcile = new Set();
    for (const p of pages) this.renderPage(p);
  }

  private renderPage(pageNumber: number): void {
    if (!this.handles || this.state !== "attached") return;
    const pageEl = findPageEl(this.handles, pageNumber);
    if (!pageEl) return;
    // sourceSignature guard (spec §10.2): if the PDF at this path was replaced
    // (fingerprint/numPages changed), do not render stale annotations. Checked
    // lazily because the signature may be unavailable at attach time. Marks are
    // cleared and already-drawn cards/connectors for this page are removed; data
    // is never deleted.
    if (this.isSignatureMismatched()) {
      clearMarks(pageEl);
      for (const a of this.store.byPage(this.pdfPath, pageNumber)) this.removeAnnotationDom(a.id);
      return;
    }
    const scale = readCurrentScale(this.handles);
    const container = this.handles.viewerContainerEl;
    // Clear only this page's marks (per-page, safe). Cards/connectors are deduped
    // per-annotation-id in their draw functions (shared rail/SVG across pages).
    clearMarks(pageEl);

    const anns = this.store.byPage(this.pdfPath, pageNumber);
    if (anns.length === 0) return;

    // Page offset within the container (walk offsetParent chain) so card/connector
    // coordinates are container-relative and align with the page-scaled marks.
    let offsetX = 0, offsetY = 0;
    let node: HTMLElement | null = pageEl;
    while (node && node !== container) {
      offsetX += node.offsetLeft;
      offsetY += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }

    // First pass: draw marks, create cards (unpositioned), group by side.
    type Entry = { ann: AnnotationRecordV1; card: HTMLElement; anchorY: number; markCenterY: number; markEdgeX: number };
    const bySide: Record<"left" | "right", Entry[]> = { left: [], right: [] };
    for (const ann of anns) {
      // Re-clean stored rects at render time so already-saved annotations also
      // get vertical-overlap trimming (prevents double-tinted highlight divs).
      const rects = cleanGeometry(ann.anchor.geometry.rects, ann.anchor.geometry.pageWidth, ann.anchor.geometry.pageHeight);
      drawEphemeralMark(pageEl, rects, ann.colorValueSnapshot, ann.markStyle, scale);
      const first = rects[0];
      const side: "left" | "right" = unionCenter(rects).x < ann.anchor.geometry.pageWidth / 2 ? "left" : "right";
      const markCenterY = offsetY + (first.y + first.height / 2) * scale;
      const railClass = side === "left" ? "rm-card-rail-left" : "rm-card-rail-right";
      let rail = container.querySelector<HTMLElement>(`.${railClass}`);
      if (!rail) {
        rail = container.ownerDocument.createElement("div");
        rail.className = `rm-card-rail ${railClass}`;
        container.appendChild(rail);
      }
      const isEditing = this.editingId === ann.id;
      const quoteText = ann.anchor.quote.exact;
      const quote = quoteText.length > 60 ? quoteText.slice(0, 60) + "…" : quoteText;
      const card = buildCard(rail, {
        id: ann.id, quote, comment: ann.comment, color: ann.colorValueSnapshot,
        colors: this.store.data.settings.colors.map((c) => ({ id: c.id, value: c.value, label: c.name })),
        side, anchorY: markCenterY, editing: isEditing,
        draftValue: isEditing ? this.draft.peek(ann.id)?.value : undefined,
      }, this.cardCallbacks());
      const markEdgeX = side === "left" ? offsetX + first.x * scale : offsetX + (first.x + first.width) * scale;
      bySide[side].push({ ann, card, anchorY: markCenterY, markCenterY, markEdgeX });
    }

    // Second pass: layout each side (push-down to avoid overlap), apply positions, draw connectors.
    const pageHeight = pageEl.offsetHeight;
    const containerWidth = container.offsetWidth;
    for (const side of ["left", "right"] as const) {
      const group = bySide[side];
      if (group.length === 0) continue;
      const out = layoutCards({
        pageHeight, railScrollTop: 0, railViewportHeight: pageHeight,
        entries: group.map((g) => ({ annotationId: g.ann.id, anchorY: g.anchorY, cardHeight: g.card.offsetHeight || 40 })),
      });
      const rail = container.querySelector<HTMLElement>(side === "left" ? ".rm-card-rail-left" : ".rm-card-rail-right");
      const railWidth = rail?.offsetWidth ?? 0;
      const cardEdgeX = side === "left" ? railWidth : containerWidth - railWidth;
      for (const g of group) {
        const pos = out.positions.get(g.ann.id);
        if (pos) g.card.style.top = `${pos.top}px`;
        const cardHeight = g.card.offsetHeight || 40;
        const cardCenterY = (pos?.top ?? g.anchorY) + cardHeight / 2;
        drawEphemeralConnector(container, { x1: g.markEdgeX, y1: g.markCenterY, x2: cardEdgeX, y2: cardCenterY, color: g.ann.colorValueSnapshot, id: g.ann.id, selected: this.hoveredId === g.ann.id });
      }
    }
  }

  // Remove a deleted annotation's card + connector from the DOM (marks are cleared by renderPage).
  private removeAnnotationDom(id: string): void {
    if (!this.handles) return;
    const container = this.handles.viewerContainerEl;
    container.querySelectorAll(`.rm-card[data-annotation-id="${id}"]`).forEach((n) => n.remove());
    container.querySelectorAll(`g.rm-connector[data-annotation-id="${id}"]`).forEach((n) => n.remove());
  }

  hasSelection(): boolean { return this.sel.current() !== null; }

  createAnnotation(markStyle: "highlight" | "underline", colorId?: string): MutationResult {
    if (!this.handles || this.state !== "attached") return { ok: false, reason: "session not attached" };
    const snap = this.sel.current();
    if (!snap) return { ok: false, reason: "no valid selection" };
    // Resolve signature at create time - the PDF may not be loaded at attach time.
    const sig = this.resolveSignature();
    if (!sig) return { ok: false, reason: "source signature unavailable" };
    const pageEl = findPageEl(this.handles, snap.pageNumber);
    if (!pageEl) return { ok: false, reason: "page not found" };
    const scale = readCurrentScale(this.handles);
    const dims = { pageWidth: pageEl.offsetWidth / scale, pageHeight: pageEl.offsetHeight / scale, rotation: 0 as const };
    const anchor = captureAnchor(snap, pageEl, scale, dims);
    if (!anchor) return { ok: false, reason: "anchor capture failed" };
    const colors = this.store.data.settings.colors;
    const id = colorId ?? this.store.data.settings.defaultColorId;
    const color = colors.find((c) => c.id === id) ?? colors[0];
    const result = this.store.create(this.pdfPath, {
      markStyle, colorId: color.id, colorLabel: color.name, colorValue: color.value, anchor,
    }, sig);
    if (result.ok) {
      snap.win.getSelection()?.removeAllRanges();
      // Clear the cached snapshot so a repeat trigger (double-click, double hotkey)
      // cannot create a duplicate annotation from the same selection.
      this.sel.clear();
    }
    return result;
  }

  private openExport(): void {
    const app = (this.view as any).app;
    if (!app) { new Notice("无法导出：应用不可用"); return; }
    const annotations = this.store.byPath(this.pdfPath);
    const doc = this.store.data.documents[this.pdfPath];
    if (!doc || annotations.length === 0) { new Notice("当前 PDF 没有批注"); return; }
    const service = new MarkdownExportService(app);
    new ExportModal(app, this.pdfPath, annotations, { documentId: doc.documentId, documentRevision: doc.revision }, service).open();
  }

  // Click on a rendered mark -> hit-test in page-css coords -> flash the card (spec §12.2).
  private onPageClick(e: MouseEvent): void {
    if (!this.handles) return;
    const win = this.handles.viewerEl.ownerDocument.defaultView;
    const sel = win?.getSelection();
    if (sel && !sel.isCollapsed) return; // do not interfere with text selection
    const target = e.target as HTMLElement | null;
    const pageEl = target?.closest?.(".page[data-page-number]") as HTMLElement | null;
    if (!pageEl) return;
    const pageNumber = parseInt(pageEl.dataset.pageNumber ?? "", 10);
    if (!Number.isFinite(pageNumber)) return;
    const anns = this.store.byPage(this.pdfPath, pageNumber);
    if (anns.length === 0) return;
    const scale = readCurrentScale(this.handles);
    const pageRect = pageEl.getBoundingClientRect();
    const px = (e.clientX - pageRect.left) / scale;
    const py = (e.clientY - pageRect.top) / scale;
    const id = hitTestAnnotation(
      anns.map((a) => ({ id: a.id, rects: a.anchor.geometry.rects })),
      px, py,
    );
    if (id) this.flashCard(id);
  }

  private flashCard(id: string): void {
    if (!this.handles) return;
    const container = this.handles.viewerContainerEl;
    const card = container.querySelector<HTMLElement>(`.rm-card[data-annotation-id="${id}"]`);
    if (!card) return;
    const connector = container.querySelector<SVGGElement>(`g.rm-connector[data-annotation-id="${id}"]`);
    card.classList.add("rm-card-linked");
    connector?.classList.add("rm-connector-active");
    const win = this.handles.viewerEl.ownerDocument.defaultView;
    win?.setTimeout(() => {
      card.classList.remove("rm-card-linked");
      connector?.classList.remove("rm-connector-active");
    }, 1500);
  }

  // Hover = selected: highlight the hovered card's connector (the card itself is
  // styled via CSS :hover). Connector-only DOM toggle; re-render preserves it via the
  // `selected` flag on drawEphemeralConnector.
  private hoverCard(id: string | null): void {
    if (!this.handles) return;
    if (this.hoveredId === id) return;
    const container = this.handles.viewerContainerEl;
    container.querySelectorAll(".rm-connector-selected").forEach((n) => n.classList.remove("rm-connector-selected"));
    this.hoveredId = id;
    if (id) {
      container.querySelector(`g.rm-connector[data-annotation-id="${id}"]`)?.classList.add("rm-connector-selected");
    }
  }

  private resolveSignature(): DocumentSignature | null {
    if (!this.handles) return null;
    const fp = readPdfFingerprint(this.handles);
    const pc = readPageCount(this.handles);
    if (!pc) return null; // numPages is required for the guard
    // If the fingerprint is inaccessible, fall back to "unknown" - numPages still
    // guards against same-path replacement with a different-length PDF (spec §10.2).
    return { pdfFingerprint: fp ?? "unknown", numPages: pc };
  }

  // True when the live PDF's signature differs from the stored document's. No
  // stored doc (no annotations yet) or unreadable signature -> not a mismatch.
  private isSignatureMismatched(): boolean {
    const doc = this.store.data.documents[this.pdfPath];
    if (!doc) return false;
    const sig = this.resolveSignature();
    if (!sig) return false;
    const mismatched = signatureMismatch(doc.sourceSignature, sig);
    if (mismatched && !this.sigWarned) {
      new Notice("Reader Margins: PDF 已替换，旧批注暂不显示（签名不匹配）。", 8000);
      this.sigWarned = true;
    } else if (!mismatched) {
      this.sigWarned = false; // PDF swapped back; allow re-rendering
    }
    return mismatched;
  }

  private cardCallbacks(): CardCallbacks {
    const reRender = (id: string) => {
      const ann = this.store.byId(this.pdfPath, id);
      if (ann) this.reconcilePage(ann.anchor.pageNumber);
    };
    return {
      onHover: (id, on) => this.hoverCard(on ? id : null),
      onEdit: (id) => {
        const ann = this.store.byId(this.pdfPath, id);
        if (!ann) return;
        this.editingId = id;
        this.draft.begin(id, ann.revision, ann.comment ?? "");
        reRender(id);
      },
      onCommitComment: (id, value) => {
        const ann = this.store.byId(this.pdfPath, id);
        const draft = this.draft.peek(id);
        const baseRev = draft?.baseRevision ?? ann?.revision ?? 0;
        this.editingId = null;
        this.draft.cancel(id);
        if (!ann) return;
        const result = this.store.update(this.pdfPath, id, { comment: value }, baseRev);
        if (!result.ok) new Notice("该批注已在另一窗口修改");
      },
      onCancelEdit: (id) => {
        this.editingId = null;
        this.draft.cancel(id);
        reRender(id);
      },
      onChangeColor: (id, colorId) => {
        const ann = this.store.byId(this.pdfPath, id);
        if (!ann) return;
        const color = this.store.data.settings.colors.find((c) => c.id === colorId);
        if (!color) return;
        this.store.update(this.pdfPath, id, {
          colorIdSnapshot: color.id, colorLabelSnapshot: color.name, colorValueSnapshot: color.value,
        }, ann.revision);
      },
      onDelete: (id) => {
        const ann = this.store.byId(this.pdfPath, id);
        if (!ann) return;
        const page = ann.anchor.pageNumber;
        const tombstone = structuredClone(ann);
        const result = this.store.delete(this.pdfPath, id);
        if (result.ok) {
          this.removeAnnotationDom(id);
          this.reconcilePage(page); // clear mark + redraw remaining
          showUndoNotice("已删除批注", () => {
            const sig = this.resolveSignature();
            if (!sig) { new Notice("无法恢复：签名不可用"); return; }
            this.store.create(this.pdfPath, {
              markStyle: tombstone.markStyle,
              colorId: tombstone.colorIdSnapshot ?? this.store.data.settings.defaultColorId,
              colorLabel: tombstone.colorLabelSnapshot,
              colorValue: tombstone.colorValueSnapshot,
              comment: tombstone.comment,
              anchor: tombstone.anchor,
            }, sig);
          });
        }
      },
    };
  }

  dispose(): void {
    if (this.state === "disposed") return;
    this.state = "disposing";
    this.generation++;
    if (this.probeTimer) clearTimeout(this.probeTimer);
    if (this.rafId !== null && this.handles) {
      this.handles.viewerEl.ownerDocument.defaultView?.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.handles) {
      this.handles.viewerContainerEl.querySelector(".rm-card-rail-left")?.remove();
      this.handles.viewerContainerEl.querySelector(".rm-card-rail-right")?.remove();
      this.handles.viewerContainerEl.querySelector(".rm-connector-layer")?.remove();
      this.handles.viewerEl.querySelectorAll(".rm-mark-layer").forEach((n) => n.remove());
    }
    this.sel.dispose();
    this.draft.dispose();
    this.scope.disposeAll();
    this.state = "disposed";
  }
}
