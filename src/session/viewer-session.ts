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
import { computeCardRailGeometry } from "src/render/card-drag-geometry";
import { unionCenter, cleanGeometry, normalizeQuote, type AnchorRect } from "src/domain/pdf-text-anchor";
import { captureAnchor, resolveAnchor, type ResolveContext, type ResolveHit } from "src/domain/anchor-resolver";
import { encodeLocator, decodeLocator } from "src/domain/locator-codec";
import { ExportModal } from "src/export/export-modal";
import { MarkdownExportService } from "src/export/markdown-export-service";
import { hitTestAnnotation } from "src/render/page-projection";
import { makeT, type Translate } from "src/i18n";
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
  private t: Translate | null = null;
  private pendingReconcile = new Set<number>();
  private rafId: number | null = null;
  private editingId: string | null = null;
  private hoveredId: string | null = null;
  private draggingId: string | null = null;
  private draft = new DraftController();
  private toolbar: ToolbarController | null = null;

  constructor(private view: any, pdfPath: string, private store: DurableAnnotationStore, opts: ViewerSessionOptions = {}) {
    this.pdfPath = pdfPath;
    this.opts = { ...DEFAULTS, ...opts } as Required<ViewerSessionOptions>;
  }

  attach(): Promise<void> {
    if (this.state === "attached") return Promise.resolve();
    // Degraded sessions may re-probe - host handles could have become available (H-12).
    if (this.state === "degraded") { this.state = "discovered"; /* allow new probe below */ }
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
    // Probe the real signature state (no hardcoded "verified") and capabilities.
    const fp = readPdfFingerprint(h);
    const pc = readPageCount(h);
    this.signature = fp && pc ? { pdfFingerprint: fp, numPages: pc } : null;
    const sigState = this.probeSignatureState(fp, pc);
    this.caps = probeCapabilities(h, { sourceSignature: sigState });
    // Core capabilities (viewer core + event bus) are mandatory. Fail closed to
    // degraded instead of attaching UI that cannot reconcile (spec §7.4, H-07).
    if (this.caps.viewerCore !== "ready" || this.caps.eventBus !== "ready") {
      this.state = "degraded";
      return;
    }

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

    // Invalidate the cached selection when the user collapses or moves it (H-08).
    // Without this a stale snapshot could create a "phantom annotation" when the
    // user triggers the hotkey/toolbar after clicking elsewhere.
    const onSelChange = () => {
      if (!this.handles) return;
      const win = this.handles.viewerEl.ownerDocument.defaultView;
      if (!win) return;
      const sel = win.getSelection();
      if (!sel || sel.isCollapsed || !this.handles.viewerEl.contains(sel.anchorNode) || !this.handles.viewerEl.contains(sel.focusNode)) {
        this.sel.clear();
      }
    };
    const doc = h.viewerEl.ownerDocument;
    doc.addEventListener("selectionchange", onSelChange);
    this.scope.addDispose(() => doc.removeEventListener("selectionchange", onSelChange));

    // Click hit-test: clicking a mark flashes its linked card (spec §12.2).
    // Require < 4px movement to avoid processing drags / text selection gestures.
    let clickStartX = 0; let clickStartY = 0;
    const onPointerDown = (e: PointerEvent) => { clickStartX = e.clientX; clickStartY = e.clientY; };
    h.viewerEl.addEventListener("pointerdown", onPointerDown);
    this.scope.addDispose(() => h.viewerEl.removeEventListener("pointerdown", onPointerDown));
    const onClick = (e: MouseEvent) => {
      const dx = Math.abs(e.clientX - clickStartX);
      const dy = Math.abs(e.clientY - clickStartY);
      if (dx < 4 && dy < 4) this.onPageClick(e);
    };
    h.viewerEl.addEventListener("click", onClick);
    this.scope.addDispose(() => h.viewerEl.removeEventListener("click", onClick));

    // Subscribe to store changes: re-reconcile affected pages (spec §6.2).
    const unsub = this.store.onChange((path, ids) => {
      if (path === "settings") {
        // Language or colors may have changed: refresh the translator, toolbar,
        // and all visible cards.
        this.t = this.makeT();
        const colors = this.store.data.settings.colors.map((c) => ({ id: c.id, value: c.value, label: c.name }));
        this.toolbar?.updateT(this.t);
        this.toolbar?.updateColors(colors, this.store.data.settings.defaultColorId);
        this.reconcileAllVisiblePages();
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
    this.t = this.makeT();
    const pages = h.viewerEl.querySelectorAll<HTMLElement>(".page[data-page-number]");
    pages.forEach((p) => this.reconcilePage(parseInt(p.dataset.pageNumber ?? "", 10)));

    // Toolbar (color swatches / underline / export / persistence status)
    const colors = this.store.data.settings.colors.map((c) => ({ id: c.id, value: c.value, label: c.name }));
    this.toolbar = new ToolbarController(h, colors, this.store.data.settings.defaultColorId, this.t);
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
    if (this.draggingId) return; // defer re-render during a drag; flushed when it ends
    if (this.rafId !== null) return;
    const gen = this.generation;
    const win = this.handles.viewerEl.ownerDocument.defaultView;
    if (!win) { this.flushReconcile(); return; }
    this.rafId = win.requestAnimationFrame(() => {
      if (this.generation !== gen) { this.rafId = null; return; }
      this.rafId = null;
      if (this.draggingId) return; // a drag started after scheduling; defer
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
    // Reset rail overflows from previous dense pages (rails are shared, scoped per page).
    for (const rail of container.querySelectorAll<HTMLElement>(".rm-card-rail")) {
      rail.style.overflowY = "";
      rail.style.maxHeight = "";
    }

    const anns = this.store.byPage(this.pdfPath, pageNumber);
    if (anns.length === 0) return;

    // Narrow window: hide cards/rails but keep marks per spec §5.4 (H-05).
    // Use offsetWidth directly – getBoundingClientRect is unreliable in jsdom.
    const marginPx = container.offsetWidth && pageEl.offsetWidth
      ? (container.offsetWidth - pageEl.offsetWidth) / 2 - 16
      : Infinity;
    const narrow = marginPx < 136;
    if (narrow) {
      for (const ann of anns) {
        const rects = cleanGeometry(ann.anchor.geometry.rects, ann.anchor.geometry.pageWidth, ann.anchor.geometry.pageHeight);
        drawEphemeralMark(pageEl, rects, ann.colorValueSnapshot, ann.markStyle, scale);
      }
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const pageRect = pageEl.getBoundingClientRect();
    // Convert viewport rectangles to the scroll container's content coordinates.
    // This is stable across PDF.js wrapper/offsetParent changes and page number.
    const offsetX = pageRect.left - containerRect.left + container.scrollLeft;
    const offsetY = pageRect.top - containerRect.top + container.scrollTop;
    const containerWidth = container.offsetWidth || containerRect.width || parseFloat(container.style.width) || 0;
    const pageWidth = pageEl.offsetWidth || pageRect.width || anns[0]?.anchor.geometry.pageWidth * scale || 0;

    // First pass: draw marks, create cards (unpositioned), group by side.
    type Entry = { ann: AnnotationRecordV1; card: HTMLElement; anchorY: number; markCenterY: number; markEdgeX: number; pinTop?: number };
    const bySide: Record<"left" | "right", Entry[]> = { left: [], right: [] };
    for (const ann of anns) {
      // Resolve the anchor against the live page (locator -> quote -> geometry).
      // Unresolved annotations are not drawn (spec §9.6, H-03); remove any stale
      // card/connector left from a previous render.
      const rects = this.resolveAnnotation(ann, pageEl, scale);
      if (!rects) { this.removeAnnotationDom(ann.id); continue; }
      drawEphemeralMark(pageEl, rects, ann.colorValueSnapshot, ann.markStyle, scale);
      const first = rects[0];
      const side: "left" | "right" = unionCenter(rects).x < ann.anchor.geometry.pageWidth / 2 ? "left" : "right";
      const anchorY = (first.y + first.height / 2) * scale;
      const markCenterY = offsetY + anchorY;
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
      const horizontal = computeCardRailGeometry({
        side,
        containerLeft: container.scrollLeft,
        containerWidth,
        pageLeft: offsetX,
        pageRight: offsetX + pageWidth,
        storedX: ann.cardPosition?.x,
      });
      const card = buildCard(rail, {
        id: ann.id, quote, comment: ann.comment, color: ann.colorValueSnapshot,
        colors: this.store.data.settings.colors.map((c) => ({ id: c.id, value: c.value, label: c.name })),
        markStyle: ann.markStyle,
        side, anchorY: markCenterY, editing: isEditing,
        draftValue: isEditing ? this.draft.peek(ann.id)?.value : undefined,
        cardLeft: horizontal.x,
        cardWidth: horizontal.cardWidth,
      }, this.cardCallbacks(), this.t ?? makeT("auto", "en"));
      const markEdgeX = side === "left" ? offsetX + first.x * scale : offsetX + (first.x + first.width) * scale;
      const pinTop = ann.cardPosition ? ann.cardPosition.y * scale : undefined;
      bySide[side].push({ ann, card, anchorY, markCenterY, markEdgeX, pinTop });
    }

    // Second pass: layout each side (push-down to avoid overlap), apply positions, draw connectors.
    const pageHeight = pageEl.offsetHeight || pageRect.height;
    for (const side of ["left", "right"] as const) {
      const group = bySide[side];
      if (group.length === 0) continue;
      const out = layoutCards({
        pageHeight, railScrollTop: 0, railViewportHeight: pageHeight,
        entries: group.map((g) => ({ annotationId: g.ann.id, anchorY: g.anchorY, cardHeight: g.card.offsetHeight || 40, pinTop: g.pinTop })),
      });
      const rail = container.querySelector<HTMLElement>(side === "left" ? ".rm-card-rail-left" : ".rm-card-rail-right");
      // Dense mode: enable scrolling so cards don't overflow the page (H-05).
      if (out.mode === "dense" && rail) {
        rail.style.overflowY = "auto";
        rail.style.maxHeight = `${pageHeight}px`;
      }
      const railLeft = rail?.offsetLeft ?? 0;
      const visibleSet = new Set(out.visibleCardIds);
      for (const g of group) {
        const pos = out.positions.get(g.ann.id);
        if (pos) g.card.style.top = `${offsetY + pos.top}px`;
        // Skip connector for cards outside the visible viewport (H-05).
        if (!visibleSet.has(g.ann.id)) continue;
        const cardHeight = g.card.offsetHeight || 40;
        const cardCenterY = offsetY + (pos?.top ?? g.anchorY) + cardHeight / 2;
        const cardEdgeX = side === "left" ? railLeft + g.card.offsetLeft + g.card.offsetWidth : railLeft + g.card.offsetLeft;
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
    // Capture a text-layer locator + quote context so the anchor can be resolved
    // (not just re-painted) on reopen/reflow (H-03). locator is best-effort: if
    // the selection does not land on tracked text items, it is omitted.
    const textLayer = pageEl.querySelector<HTMLElement>(".textLayer");
    const locator = textLayer
      ? (encodeLocator(snap.range.startContainer, snap.range.startOffset, snap.range.endContainer, snap.range.endOffset, textLayer) ?? undefined)
      : undefined;
    const ctx = { locator, ...this.extractQuoteContext(textLayer, normalizeQuote(snap.selectedText)) };
    const anchor = captureAnchor(snap, pageEl, scale, dims, ctx);
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
      // Underline is a "mark + immediately comment" action (spec §4.3): enter
      // edit mode so the user can type without a second click (H-09).
      if (markStyle === "underline" && result.ok) {
        const created = result.annotation;
        this.editingId = created.id;
        this.draft.begin(created.id, created.revision, "");
        this.reconcilePage(snap.pageNumber);
      }
    }
    return result;
  }

  private openExport(): void {
    const app = (this.view as any).app;
    if (!app) { new Notice(this.t!("notice.cannotExport")); return; }
    const annotations = this.store.byPath(this.pdfPath);
    const doc = this.store.data.documents[this.pdfPath];
    if (!doc || annotations.length === 0) { new Notice(this.t!("notice.noAnnotations")); return; }
    const service = new MarkdownExportService(app);
    new ExportModal(app, this.pdfPath, annotations, { documentId: doc.documentId, documentRevision: doc.revision }, service, this.t!).open();
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

  // Drag a card via its grip: live `top` follows the pointer (clamped to the
  // anchor page's band), committed to the store on pointerup as a page-css y.
  // Re-render is deferred during the drag so the card element survives.
  private beginDrag(id: string, e: PointerEvent, card: HTMLElement): void {
    if (!this.handles) return;
    if (e.button !== 0) return; // primary button only
    const ann = this.store.byId(this.pdfPath, id);
    if (!ann) return;
    const pageEl = findPageEl(this.handles, ann.anchor.pageNumber);
    if (!pageEl) return;
    const scale = readCurrentScale(this.handles);
    const pageRect = pageEl.getBoundingClientRect();
    const cardHeight = card.offsetHeight || 40;
    const startTop = parseFloat(card.style.top) || 0;          // card top, container-content px
    const startY = e.clientY;
    const startCardTopVp = card.getBoundingClientRect().top;   // card top, viewport px
    const minVp = pageRect.top;                                // page top (viewport)
    const maxVp = Math.max(minVp, pageRect.bottom - cardHeight); // clamp keeps card inside the page
    // Horizontal coordinates are container-relative because both rails span the
    // full container. This keeps stored x stable and gives both sides one model.
    const container = this.handles.viewerContainerEl;
    const containerRect = container.getBoundingClientRect();
    const cardWidth = card.offsetWidth || 40;
    const startLeft = parseFloat(card.style.left) || 0;
    const startX = e.clientX;
    const side = card.closest(".rm-card-rail-left") ? "left" : "right";
    const horizontal = computeCardRailGeometry({
      side,
      containerLeft: container.scrollLeft,
      containerWidth: containerRect.width || container.offsetWidth || parseFloat(container.style.width) || 0,
      pageLeft: pageRect.left - containerRect.left + container.scrollLeft,
      pageRight: pageRect.right - containerRect.left + container.scrollLeft,
      storedX: startLeft,
      cardWidth,
    });
    const baseRevision = ann.revision;
    const grip = card.querySelector<HTMLElement>(".rm-card-grip") ?? card;
    let moved = false;
    this.draggingId = id;
    card.classList.add("rm-card-dragging");
    try { grip.setPointerCapture(e.pointerId); } catch { /* pointer already released */ }
    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      const dx = ev.clientX - startX;
      if (Math.abs(dy) > 1 || Math.abs(dx) > 1) moved = true;
      const nextTopVp = Math.max(minVp, Math.min(startCardTopVp + dy, maxVp));
      card.style.top = `${startTop + (nextTopVp - startCardTopVp)}px`;
      const nextLeft = Math.max(horizontal.minX, Math.min(startLeft + dx, horizontal.maxX));
      card.style.left = `${nextLeft}px`;
    };
    const onUp = () => {
      grip.removeEventListener("pointermove", onMove);
      grip.removeEventListener("pointerup", onUp);
      grip.removeEventListener("pointercancel", onUp);
      try { grip.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      card.classList.remove("rm-card-dragging");
      this.draggingId = null;
      // Flush any re-renders deferred during the drag.
      if (this.pendingReconcile.size > 0) this.reconcilePage([...this.pendingReconcile][0]);
      if (!moved) return; // a click, not a drag - let dblclick handle reset
      const finalRect = card.getBoundingClientRect();
      const y = (finalRect.top - pageRect.top) / scale; // page-relative, unscaled (zoom-stable)
      const x = parseFloat(card.style.left) || 0;        // viewer-container content px (zoom-stable)
      this.store.update(this.pdfPath, id, { cardPosition: { space: "page-css-v1", y, x } }, baseRevision);
    };
    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", onUp);
    grip.addEventListener("pointercancel", onUp);
  }

  // Clear a user-dragged position: return the card to auto-layout.
  private resetCardPosition(id: string): void {
    const ann = this.store.byId(this.pdfPath, id);
    if (!ann || !ann.cardPosition) return;
    this.store.update(this.pdfPath, id, { cardPosition: undefined }, ann.revision);
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

  // Classify the live signature vs the stored document for the capability report.
  private probeSignatureState(fp: string | undefined, pc: number | undefined): "verified" | "mismatch" | "unknown" {
    if (!fp || !pc) return "unknown";
    const doc = this.store.data.documents[this.pdfPath];
    if (!doc) return "verified"; // new document, nothing to mismatch against
    return signatureMismatch(doc.sourceSignature, { pdfFingerprint: fp, numPages: pc }) ? "mismatch" : "verified";
  }

  private makeT(): Translate {
    const lang = this.store.data.settings.language;
    const locale = (this.view as any)?.app?.locale ?? "en";
    return makeT(lang, locale);
  }

  // Public translator accessor for command/palette notices.
  tNotice(key: string, vars?: Record<string, string>): string {
    return (this.t ?? makeT("auto", "en"))(key, vars);
  }

  // Extract up to 16 chars of context around the quote in the page text layer,
  // to disambiguate repeated quotes on resolve (spec §9.5).
  private extractQuoteContext(textLayer: HTMLElement | null, exact: string): { prefix?: string; suffix?: string } {
    if (!textLayer) return {};
    const full = normalizeQuote(textLayer.textContent ?? "");
    const idx = full.indexOf(exact);
    if (idx < 0) return {};
    const prefix = idx > 0 ? full.slice(Math.max(0, idx - 16), idx) : undefined;
    const suffixEnd = idx + exact.length;
    const suffix = suffixEnd < full.length ? full.slice(suffixEnd, suffixEnd + 16) : undefined;
    return { prefix: prefix || undefined, suffix: suffix || undefined };
  }

  // Resolve an annotation's anchor against the live page. Returns the rects to
  // draw, or null when unresolved (caller skips drawing - spec §9.6, H-03).
  private resolveAnnotation(ann: AnnotationRecordV1, pageEl: HTMLElement, scale: number): AnchorRect[] | null {
    const dims = { pageWidth: pageEl.offsetWidth / scale, pageHeight: pageEl.offsetHeight / scale, rotation: 0 as const };
    const textLayer = pageEl.querySelector<HTMLElement>(".textLayer");
    const ctx: ResolveContext = {
      findRangeByLocator: (loc) => {
        if (!textLayer || !loc) return null;
        const range = decodeLocator(loc, textLayer);
        if (!range) return null;
        return this.rangeToHit(range, pageEl, scale, dims);
      },
      searchPageText: (exact) => {
        if (!textLayer) return null;
        const range = this.findTextRange(textLayer, exact);
        if (!range) return null;
        return this.rangeToHit(range, pageEl, scale, dims);
      },
      pageDims: dims,
    };
    const result = resolveAnchor(ann.anchor, ctx);
    if (result.status === "unresolved") return null;
    return result.rects;
  }

  private rangeToHit(range: Range, pageEl: HTMLElement, scale: number, dims: { pageWidth: number; pageHeight: number }): ResolveHit | null {
    const pageRect = pageEl.getBoundingClientRect();
    const raw: AnchorRect[] = [];
    const rects = range.getClientRects();
    for (let i = 0; i < rects.length; i++) {
      const c = rects[i];
      raw.push({ x: (c.left - pageRect.left) / scale, y: (c.top - pageRect.top) / scale, width: c.width / scale, height: c.height / scale });
    }
    const cleaned = cleanGeometry(raw, dims.pageWidth, dims.pageHeight);
    return cleaned.length > 0 ? { range, rects: cleaned } : null;
  }

  // Find the first occurrence of `exact` in the text layer and build a Range.
  private findTextRange(textLayer: HTMLElement, exact: string): Range | null {
    const doc = textLayer.ownerDocument;
    const walker = doc.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
    const chunks: { node: Text; start: number }[] = [];
    let full = "";
    let n: Node | null;
    while ((n = walker.nextNode())) {
      chunks.push({ node: n as Text, start: full.length });
      full += n.textContent ?? "";
    }
    const idx = full.indexOf(exact);
    if (idx < 0) return null;
    const end = idx + exact.length;
    let startNode: Text | null = null, startOffset = 0, endNode: Text | null = null, endOffset = 0;
    for (const c of chunks) {
      const cEnd = c.start + (c.node.textContent?.length ?? 0);
      if (!startNode && cEnd > idx) { startNode = c.node; startOffset = idx - c.start; }
      if (cEnd >= end) { endNode = c.node; endOffset = end - c.start; break; }
    }
    if (!startNode || !endNode) return null;
    const range = doc.createRange();
    range.setStart(startNode, Math.max(0, startOffset));
    range.setEnd(endNode, Math.max(0, endOffset));
    return range;
  }

  private reconcileAllVisiblePages(): void {
    if (!this.handles) return;
    this.handles.viewerEl.querySelectorAll<HTMLElement>(".page[data-page-number]").forEach((p) => {
      const n = parseInt(p.dataset.pageNumber ?? "", 10);
      if (Number.isFinite(n)) this.reconcilePage(n);
    });
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
      new Notice(this.t!("notice.pdfReplaced"), 8000);
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
      onDragStart: (id, e, card) => this.beginDrag(id, e, card),
      onResetPosition: (id) => this.resetCardPosition(id),
      onEdit: (id) => {
        const ann = this.store.byId(this.pdfPath, id);
        if (!ann) return;
        this.editingId = id;
        this.draft.begin(id, ann.revision, ann.comment ?? "");
        reRender(id);
      },
      onDraftUpdate: (id, value) => {
        // Keep the draft in sync with the textarea so re-render/conflict restore
        // the user's current input (H-04).
        this.draft.update(id, value);
      },
      onCommitComment: (id, value) => {
        const ann = this.store.byId(this.pdfPath, id);
        const draft = this.draft.peek(id);
        const baseRev = draft?.baseRevision ?? ann?.revision ?? 0;
        if (!ann) { this.editingId = null; this.draft.cancel(id); return; }
        const result = this.store.update(this.pdfPath, id, { comment: value }, baseRev);
        if (result.ok) {
          this.editingId = null;
          this.draft.cancel(id);
        } else {
          // Conflict: keep the draft (and edit mode) so the user can retry.
          this.draft.update(id, value);
          new Notice(this.t!("notice.conflict"));
        }
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
        // Capture the documentId before delete - the document may be pruned if
        // this was the last annotation, and restore must keep the same identity.
        const documentId = this.store.data.documents[this.pdfPath]?.documentId;
        const result = this.store.delete(this.pdfPath, id);
        if (result.ok) {
          this.removeAnnotationDom(id);
          this.reconcilePage(page); // clear mark + redraw remaining
          showUndoNotice(this.t!("notice.deleted"), this.t!("notice.undo"), () => {
            const sig = this.resolveSignature();
            if (!sig) { new Notice(this.t!("notice.cannotRestore")); return; }
            // restore() preserves id + documentId; create() would change both (H-10).
            this.store.restore(this.pdfPath, tombstone, documentId, sig);
          });
        }
      },
      onToggleType: (id) => {
        const ann = this.store.byId(this.pdfPath, id);
        if (!ann) return;
        const next = ann.markStyle === "highlight" ? "underline" : "highlight";
        this.store.update(this.pdfPath, id, { markStyle: next }, ann.revision);
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
    // Best-effort commit pending drafts before tearing down so unsaved input is
    // not silently lost on view close / plugin unload (H-04).
    for (const d of this.draft.all()) {
      const ann = this.store.byId(this.pdfPath, d.annotationId);
      if (ann) this.store.update(this.pdfPath, d.annotationId, { comment: d.value }, d.baseRevision);
    }
    this.sel.dispose();
    this.draft.dispose();
    this.scope.disposeAll();
    this.state = "disposed";
  }
}
