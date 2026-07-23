// src/session/viewer-session.ts
import type { HostHandles, HostCapabilities } from "src/host/host-typings";
import { probeHostHandles, readCurrentScale, readPagesRotation, findPageEl, readPdfFingerprint, readPageCount } from "src/host/obsidian-pdf-host";
import { probeCapabilities } from "src/host/host-capabilities";
import { DisposableScope } from "src/session/disposable-scope";
import { SelectionSnapshotController } from "src/session/selection-snapshot-controller";
import { DraftController } from "src/session/draft-controller";
import { showUndoNotice } from "src/session/undo-notice";
import { ToolbarController } from "src/toolbar/toolbar-controller";
import { Notice, Menu } from "obsidian";
import { drawEphemeralMark, clearMarks, setMarkHover } from "src/render/mark-renderer";
import { buildCard, type CardCallbacks } from "src/render/annotation-card-rail";
import { clearPageConnectors, drawEphemeralConnector } from "src/render/connector-renderer";
import { layoutCards } from "src/render/card-layout-engine";
import { computeCardRailGeometry } from "src/render/card-drag-geometry";
import { PageCardRailRegistry, type PageCardRailSide } from "src/render/page-card-rail";
import { computePopoverPlacement } from "src/render/popover-placement";
import { unionCenter, cleanGeometry, type AnchorRect } from "src/domain/pdf-text-anchor";
import {
  captureAnchor,
  resolveAnchor,
  searchTextLayerQuote,
  type AnchorResolveResult,
  type ResolveContext,
  type ResolveHit,
} from "src/domain/anchor-resolver";
import { ResolvedAnchorProjection } from "src/session/resolved-anchor-projection";
import { LayoutInvalidationController, type LayoutObserverState } from "src/session/layout-invalidation-controller";
import { encodeLocator, decodeLocator } from "src/domain/locator-codec";
import { ExportModal } from "src/export/export-modal";
import { MarkdownExportService } from "src/export/markdown-export-service";
import { hitTestAnnotation } from "src/render/page-projection";
import { makeT, type Translate } from "src/i18n";
import { createIcon } from "src/render/icons";
import type { DurableAnnotationStore } from "src/store/durable-annotation-store";
import { signatureMismatch } from "src/host/source-signature";
import type { AnnotationRecordV1, DocumentSignature, MutationResult, DisplayMode } from "src/domain/annotation";
import { annotationElement, annotationElements } from "src/render/annotation-dom";

export type SessionState = "discovered" | "probing" | "attached" | "degraded" | "disposing" | "disposed";

export interface ViewerSessionOptions {
  probeIntervalMs?: number;
  probeTimeoutMs?: number;
}

export interface ViewerSessionDiagnostics {
  locatorEncodeAttempts: number;
  locatorEncodeSuccesses: number;
  locatorDecodeAttempts: number;
  locatorDecodeSuccesses: number;
  quoteResolutions: number;
  geometryFallbacks: number;
  unresolvedAnchors: number;
  scaleEvents: number;
  resizeInvalidations: number;
  toolbarSlotState: "ready" | "fallback" | "missing" | "unknown";
  pageNavigationCapabilityState: "ready" | "missing" | "unknown";
  layoutObserverState?: "ready" | "missing" | "unknown";
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
  private diagnosticCounts = {
    locatorEncodeAttempts: 0,
    locatorEncodeSuccesses: 0,
    locatorDecodeAttempts: 0,
    locatorDecodeSuccesses: 0,
    quoteResolutions: 0,
    geometryFallbacks: 0,
    unresolvedAnchors: 0,
    scaleEvents: 0,
    resizeInvalidations: 0,
  };
  get unresolvedCount(): number { return this.diagnosticCounts.unresolvedAnchors; }
  private t: Translate | null = null;
  private pendingReconcile = new Set<number>();
  private pendingConnectorRedraw = new Set<number>();
  private rafId: number | null = null;
  private editingId: string | null = null;
  private hoveredId: string | null = null;
  private draggingId: string | null = null;
  private activeDragDispose: (() => void) | null = null;
  private dragGeometryStale = false;
  private draft = new DraftController();
  private toolbar: ToolbarController | null = null;
  // The color used by highlight/underline actions (toolbar buttons, shortcuts,
  // context menu). Session-local; falls back to settings.defaultColorId until
  // the user picks a swatch. Not persisted - changing the persistent default is
  // a settings action.
  private activeColorId: string | null = null;
  private hintShown = false; // onboarding empty-state hint, once per session
  private pendingEnterPages = new Map<string, number>();
  private pendingStitchPages = new Map<string, number>();
  private resolvedAnchors = new ResolvedAnchorProjection();
  private resolutionDiagnosticOutcomes = new Map<string, string>();
  private layoutInvalidation: LayoutInvalidationController | null = null;
  private layoutObserverState: LayoutObserverState | "unknown" = "unknown";
  private cardRails: PageCardRailRegistry | null = null;
  // Popover display mode (Phase A). A single hover-triggered .rm-card lives in
  // .rm-popover-layer. popoverId is the shown annotation; popoverPinned keeps it
  // open (click inside / editing) so hover-leave does not close it mid-interaction.
  // popoverRenderIds tracks which annotations currently render as popovers (mark
  // only) so the hover hit-test only triggers popovers for marks without a rail card.
  private popoverId: string | null = null;
  private popoverPinned = false;
  private popoverLayer: HTMLElement | null = null;
  private popoverRafId: number | null = null;
  private popoverHideTimer: number | null = null;
  private lastPointerMove: { x: number; y: number; target: Node | null } | null = null;
  private popoverRenderIds = new Set<string>();

  constructor(private view: any, pdfPath: string, private store: DurableAnnotationStore, opts: ViewerSessionOptions = {}) {
    this.pdfPath = pdfPath;
    this.opts = { ...DEFAULTS, ...opts } as Required<ViewerSessionOptions>;
  }

  diagnosticsSnapshot(): ViewerSessionDiagnostics {
    const currentHandles = probeHostHandles(this.view);
    if (!currentHandles) {
      return {
        ...this.diagnosticCounts,
        toolbarSlotState: "unknown",
        pageNavigationCapabilityState: "unknown",
        layoutObserverState: "unknown",
      };
    }
    return {
      ...this.diagnosticCounts,
      toolbarSlotState: currentHandles.toolbarSlot ? "ready" : (this.toolbar ? "fallback" : "missing"),
      // Navigation remains unknown until a real-host-backed adapter establishes
      // an owning object and page-number contract. Fixtures must not invent it.
      pageNavigationCapabilityState: "unknown",
      layoutObserverState: this.layoutObserverState === "disposed" ? "unknown" : this.layoutObserverState,
    };
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
    // Older builds persisted the sentinel fingerprint "unknown" because they
    // read PDF.js's removed singular `fingerprint` property. Bind that legacy
    // record to the now-readable fingerprint only when its page count agrees.
    // Verified-to-verified mismatches still fail closed below.
    if (fp && pc) this.store.upgradeLegacySourceSignature(this.pdfPath, { pdfFingerprint: fp, numPages: pc });
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
    this.cardRails = new PageCardRailRegistry(h.viewerContainerEl, gen, (pageNumber) => {
      if (this.generation !== gen) return;
      this.scheduleConnectorRedraw(pageNumber);
    });
    this.scope.addDispose(() => { this.cardRails?.dispose(); this.cardRails = null; });
    this.layoutInvalidation = new LayoutInvalidationController({
      viewerEl: h.viewerEl,
      containerEl: h.viewerContainerEl,
      generation: gen,
      isCurrent: (generation) => this.generation === generation && this.state !== "disposing" && this.state !== "disposed",
      onInvalidateAll: () => {
        this.dragGeometryStale = this.draggingId !== null;
        this.reconcileAllMountedPages();
      },
      onInvalidatePage: (pageNumber) => {
        this.dragGeometryStale = this.draggingId !== null;
        this.reconcilePage(pageNumber);
      },
      onResizeSignal: () => { this.diagnosticCounts.resizeInvalidations++; },
    });
    this.layoutObserverState = this.layoutInvalidation.start();
    this.scope.addDispose(() => { this.layoutInvalidation?.dispose(); this.layoutInvalidation = null; });
    if (bus && typeof bus.on === "function") {
      const onTextLayer = (e: any) => {
        if (this.generation !== gen) return;
        const page = findPageEl(h, e?.pageNumber ?? 0);
        this.layoutInvalidation?.onTextLayerRendered(e?.pageNumber ?? 0, page);
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

    // Right-click menu: highlight / highlight&annotate / underline / underline&annotate.
    // Only shown when there is an active selection; otherwise the host context
    // menu is left intact. PDF views do not fire Obsidian's editor-menu event,
    // so the DOM contextmenu event is the contract here.
    const onContextMenu = (e: MouseEvent) => {
      if (!this.hasSelection()) return;
      const app = (this.view as any)?.app;
      if (!app) return;
      e.preventDefault();
      const t = this.t ?? makeT("auto", "en");
      const menu = new Menu();
      menu.addItem((item) => item.setTitle(t("menu.highlight")).setIcon("highlighter")
        .onClick(() => this.createAnnotation("highlight", { annotate: false })));
      menu.addItem((item) => item.setTitle(t("menu.highlightAnnotate")).setIcon("highlighter")
        .onClick(() => this.createAnnotation("highlight", { annotate: true })));
      menu.addSeparator();
      menu.addItem((item) => item.setTitle(t("menu.underline")).setIcon("underline")
        .onClick(() => this.createAnnotation("underline", { annotate: false })));
      menu.addItem((item) => item.setTitle(t("menu.underlineAnnotate")).setIcon("underline")
        .onClick(() => this.createAnnotation("underline", { annotate: true })));
      menu.showAtMouseEvent(e);
    };
    h.viewerEl.addEventListener("contextmenu", onContextMenu);
    this.scope.addDispose(() => h.viewerEl.removeEventListener("contextmenu", onContextMenu));

    // Popover layer (Phase A): hosts hover-triggered cards for popover display
    // mode and the narrow-margin reactive fallback. Created once per attach.
    this.popoverLayer = doc.createElement("div");
    this.popoverLayer.className = "rm-popover-layer";
    h.viewerContainerEl.appendChild(this.popoverLayer);
    this.scope.addDispose(() => { this.popoverLayer?.remove(); this.popoverLayer = null; });

    // Hover-triggered popover: pointermove over a popover-render-mode mark shows
    // its card; moving off (not over the mark, not over the card) hides it.
    // Coalesced via rAF so rapid moves do not rebuild the card each frame. Skip
    // entirely while a button is held (text selection / drag) so the popover
    // never interferes with selection gestures.
    // NOTE: the listener is on viewerContainerEl (the scroll container), NOT
    // viewerEl. The popover layer is a sibling of viewerEl inside the container,
    // so a listener on viewerEl would NOT fire for moves over the card - the
    // transit hide timer would then fire and dismiss the popover the user just
    // entered. The container is the common ancestor of both pages and the card.
    const onPointerMove = (e: PointerEvent) => {
      if (e.buttons !== 0) return;
      if (!this.handles) return;
      this.lastPointerMove = { x: e.clientX, y: e.clientY, target: e.target as Node | null };
      this.schedulePopoverCheck();
    };
    h.viewerContainerEl.addEventListener("pointermove", onPointerMove);
    this.scope.addDispose(() => h.viewerContainerEl.removeEventListener("pointermove", onPointerMove));

    // Pin on interaction inside the popover; click outside closes (unless the
    // edit box's own click-away is handling a commit). forceHide so a pinned
    // popover also closes on outside click (unpin + hide). On viewerContainerEl
    // for the same reason as pointermove: the card lives in the popover layer,
    // a sibling of viewerEl.
    const onPopoverPointerDown = (e: PointerEvent) => {
      if (this.popoverId === null) return;
      const target = e.target as Node | null;
      if (this.popoverLayer?.contains(target)) { this.popoverPinned = true; this.cancelHidePopover(); return; }
      if (this.editingId === this.popoverId) return; // buildCard click-away commits
      this.forceHidePopover();
    };
    h.viewerContainerEl.addEventListener("pointerdown", onPopoverPointerDown);
    this.scope.addDispose(() => h.viewerContainerEl.removeEventListener("pointerdown", onPopoverPointerDown));

    // Esc closes a pinned (non-editing) popover. The textarea's own keydown
    // handles Esc while editing (cancelEdit).
    const onPopoverKeydown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (this.popoverId === null) return;
      if (this.editingId === this.popoverId) return; // textarea handles it
      this.hidePopover();
    };
    doc.addEventListener("keydown", onPopoverKeydown);
    this.scope.addDispose(() => doc.removeEventListener("keydown", onPopoverKeydown));

    // Subscribe to store changes: re-reconcile affected pages (spec §6.2).
    const unsub = this.store.onChange((path, changes) => {
      if (path === "settings") {
        // Language or colors may have changed: refresh the translator, toolbar,
        // and all visible cards.
        this.t = this.makeT();
        // If the active color was deleted/reset, fall back to the default.
        if (this.activeColorId && !this.store.data.settings.colors.some((c) => c.id === this.activeColorId)) {
          this.activeColorId = null;
        }
        const colors = this.store.data.settings.colors.map((c) => ({ id: c.id, value: c.value, label: c.name }));
        this.toolbar?.updateT(this.t);
        this.toolbar?.updateColors(colors, this.getActiveColorId());
        this.reconcileAllMountedPages();
        return;
      }
      if (path !== this.pdfPath) return;
      const pages = new Set<number>();
      for (const ch of changes) {
        if (ch.deleted) {
          this.removeAnnotationDom(ch.id, { animate: true });
          if (this.popoverId === ch.id) this.forceHidePopover();
          if (ch.page != null) pages.add(ch.page);
        }
        else {
          const a = this.store.byId(path, ch.id);
          if (a) {
            pages.add(a.anchor.pageNumber);
            if (ch.kind === "created" || ch.kind === "restored") {
              this.pendingEnterPages.set(ch.id, a.anchor.pageNumber);
              this.pendingStitchPages.set(ch.id, a.anchor.pageNumber);
            }
          }
        }
      }
      // Rebuild the popover if its annotation was updated (comment/color/mode).
      if (this.popoverId && changes.some((c) => !c.deleted && c.id === this.popoverId)) {
        this.rebuildPopover();
      }
      pages.forEach((p) => this.reconcilePage(p));
      // The convert-all button state depends on annotation displayModes, which
      // may have changed (create/delete/toggle/convert-all). Refresh it.
      this.updateConvertAllState();
    });
    this.scope.addDispose(unsub);

    this.state = "attached";
    this.t = this.makeT();
    const pages = h.viewerEl.querySelectorAll<HTMLElement>(".page[data-page-number]");
    pages.forEach((p) => this.reconcilePage(parseInt(p.dataset.pageNumber ?? "", 10)));

    // Toolbar (color swatches / highlight / underline / export / persistence status)
    const colors = this.store.data.settings.colors.map((c) => ({ id: c.id, value: c.value, label: c.name }));
    this.toolbar = new ToolbarController(h, colors, this.getActiveColorId(), this.t);
    this.toolbar.render({
      onSelectColor: (colorId) => this.setActiveColor(colorId),
      onHighlight: () => { const r = this.createAnnotation("highlight"); if (!r.ok) new Notice(r.reason); },
      onUnderline: () => { const r = this.createAnnotation("underline"); if (!r.ok) new Notice(r.reason); },
      onExport: () => this.openExport(),
      onConvertAll: () => this.convertAll(),
    });
    this.updateConvertAllState();
    const unsubStatus = this.store.onStatus((s) => this.toolbar?.setStatus(s));
    this.scope.addDispose(unsubStatus);
    this.scope.addDispose(() => { this.toolbar?.dispose(); this.toolbar = null; });

    this.showOnboardingHint();
  }

  // Empty state = a PDF with zero annotations (critique P1: first-timers had no
  // way to discover "select text, click a color"). A quiet pill at the top of the
  // viewer, dismissed by click, by the first annotation, or after 12s.
  private showOnboardingHint(): void {
    if (!this.handles || this.hintShown || !this.t) return;
    if (this.store.byPath(this.pdfPath).length > 0) return;
    this.hintShown = true;
    const doc = this.handles.viewerContainerEl.ownerDocument;
    const hint = doc.createElement("div");
    hint.className = "rm-onboarding-hint";
    const text = doc.createElement("span");
    text.textContent = this.t("hint.text");
    const close = doc.createElement("button");
    close.className = "rm-onboarding-hint-close";
    close.title = this.t("hint.dismiss");
    close.setAttribute("aria-label", this.t("hint.dismiss"));
    close.appendChild(createIcon(doc, "x", 12));
    hint.append(text, close);
    this.handles.viewerContainerEl.appendChild(hint);
    const win = doc.defaultView;
    const timer = win?.setTimeout(() => hint.remove(), 12_000);
    const dismiss = () => { hint.remove(); if (timer !== undefined) win?.clearTimeout(timer); };
    close.addEventListener("click", dismiss);
    this.scope.addDispose(dismiss);
    // The first annotation means the hint did its job.
    const unsub = this.store.onChange((path, changes) => {
      if (path === this.pdfPath && changes.some((c) => !c.deleted)) { dismiss(); unsub(); }
    });
    this.scope.addDispose(unsub);
  }

  // M0: render annotations from the store for this page.
  // Coalesced via rAF so rapid events (zoom -> multiple textlayerrendered) batch into one frame (spec §12.6).
  reconcilePage(pageNumber: number): void {
    if (!this.handles || this.state !== "attached") return;
    this.pendingReconcile.add(pageNumber);
    if (this.draggingId) return; // defer re-render during a drag; flushed when it ends
    this.scheduleReconcileFrame();
  }

  private scheduleConnectorRedraw(pageNumber: number): void {
    if (!this.handles || this.state !== "attached") return;
    if (!this.pendingReconcile.has(pageNumber)) this.pendingConnectorRedraw.add(pageNumber);
    if (this.draggingId) return;
    this.scheduleReconcileFrame();
  }

  private scheduleReconcileFrame(): void {
    if (!this.handles || this.state !== "attached") return;
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
    const connectorPages = this.pendingConnectorRedraw;
    this.pendingReconcile = new Set();
    this.pendingConnectorRedraw = new Set();
    for (const p of pages) this.renderPage(p);
    for (const p of connectorPages) {
      if (!pages.has(p)) this.redrawPageConnectors(p);
    }
  }

  private renderPage(pageNumber: number): void {
    if (!this.handles || this.state !== "attached") return;
    // Rebuild is replacement, not accumulation. Clearing before looking up the
    // page also drops hit targets when PDF.js detaches a virtualized page.
    this.resolvedAnchors.beginPage(this.generation, pageNumber);
    const pageEl = findPageEl(this.handles, pageNumber);
    if (!pageEl) {
      this.cardRails?.removePage(pageNumber);
      clearPageConnectors(this.handles.viewerContainerEl, pageNumber);
      return;
    }
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
    // Rebuild only this page. Rail identity and scroll survive while cards and
    // connector endpoints are fresh projections of the current layout.
    clearMarks(pageEl);
    this.cardRails?.clearPageCards(pageNumber);
    clearPageConnectors(container, pageNumber);

    const anns = this.store.byPage(this.pdfPath, pageNumber);
    if (anns.length === 0) {
      this.cardRails?.removePage(pageNumber);
      return;
    }

    // Narrow margin no longer hides cards. Card-mode annotations reactively
    // fall back to popover display (mark only; hover shows the card), and
    // explicit popover-mode annotations always render this way. Marks are
    // always drawn. (spec §5.4 H-05 previously hid ALL cards in narrow mode -
    // cards "disappeared" when the PDF was zoomed in; popover fallback fixes it.)
    // Use offsetWidth directly – getBoundingClientRect is unreliable in jsdom.
    const marginPx = container.offsetWidth && pageEl.offsetWidth
      ? (container.offsetWidth - pageEl.offsetWidth) / 2 - 16
      : Infinity;
    const narrow = marginPx < 136;

    const containerRect = container.getBoundingClientRect();
    const pageRect = pageEl.getBoundingClientRect();
    // Convert viewport rectangles to the scroll container's content coordinates.
    // This is stable across PDF.js wrapper/offsetParent changes and page number.
    const offsetX = pageRect.left - containerRect.left + container.scrollLeft;
    const offsetY = pageRect.top - containerRect.top + container.scrollTop;
    const containerWidth = container.offsetWidth || containerRect.width || parseFloat(container.style.width) || 0;
    const pageWidth = pageEl.offsetWidth || pageRect.width || anns[0]?.anchor.geometry.pageWidth * scale || 0;
    const viewportLeft = container.scrollLeft;
    const viewportRight = viewportLeft + containerWidth;
    const pageHeight = pageEl.offsetHeight || pageRect.height;

    // Refresh the popover-render set for this page: clear this page's ids, then
    // re-add the ones that render as popovers below.
    for (const ann of anns) this.popoverRenderIds.delete(ann.id);

    // First pass: draw marks for every annotation; create rail cards only for
    // card-render-mode annotations. Popover-render annotations get mark-only.
    type Entry = { ann: AnnotationRecordV1; card: HTMLElement; anchorY: number; pinTop?: number };
    const bySide: Record<"left" | "right", Entry[]> = { left: [], right: [] };
    for (const ann of anns) {
      // Resolve the anchor against the live page (locator -> quote -> geometry).
      // Unresolved annotations are not drawn (spec §9.6, H-03); remove any stale
      // card/connector left from a previous render.
      const resolved = this.resolveAnnotation(ann, pageEl, scale);
      if (!resolved) { this.removeAnnotationDom(ann.id); continue; }
      const rects = resolved.rects;
      // Render-mode decision (needed before drawing the mark so a popover-mode
      // mark with a comment gets the has-note dot indicator). Popover display, or
      // card display with no room for a rail card (narrow), renders mark-only.
      const renderPopover = ann.displayMode === "popover" || narrow;
      const hasNote = renderPopover && !!(ann.comment && ann.comment.trim());
      drawEphemeralMark(pageEl, rects, ann.colorValueSnapshot, ann.markStyle, scale, ann.id, hasNote);
      // Marks are redrawn wholesale - re-apply the hover lift, same as the
      // connector's `selected` flag below (B: taut thread survives re-render).
      if (this.hoveredId === ann.id) setMarkHover(pageEl, ann.id, true);
      const first = rects[0];
      const side: "left" | "right" = unionCenter(rects).x < pageWidth / (2 * scale) ? "left" : "right";
      this.projectResolvedAnchor(ann, resolved, side);

      if (renderPopover) {
        this.popoverRenderIds.add(ann.id);
        this.removeAnnotationDom(ann.id);
        this.pendingEnterPages.delete(ann.id);
        this.pendingStitchPages.delete(ann.id);
        continue;
      }

      const anchorY = (first.y + first.height / 2) * scale;
      const railLeft = side === "left" ? viewportLeft : offsetX + pageWidth;
      const railRight = side === "left" ? offsetX : viewportRight;
      const rail = this.cardRails?.ensure({
        pageNumber, pageEl, side, top: offsetY, height: pageHeight,
        left: railLeft, width: Math.max(0, railRight - railLeft),
      });
      if (!rail) continue;
      const isEditing = this.editingId === ann.id;
      const quote = ann.anchor.quote.exact;
      const horizontal = computeCardRailGeometry({
        side,
        containerLeft: container.scrollLeft,
        containerWidth,
        pageLeft: offsetX,
        pageRight: offsetX + pageWidth,
        storedX: ann.cardPosition?.x,
      });
      const card = buildCard(rail.element, {
        id: ann.id, quote, comment: ann.comment, color: ann.colorValueSnapshot, colorId: ann.colorIdSnapshot,
        colors: this.store.data.settings.colors.map((c) => ({ id: c.id, value: c.value, label: c.name })),
        markStyle: ann.markStyle,
        side, anchorY, editing: isEditing,
        draftValue: isEditing ? this.draft.peek(ann.id)?.value : undefined,
        cardLeft: rail.containerXToLocal(horizontal.x),
        cardWidth: horizontal.cardWidth,
      }, this.cardCallbacks(), this.t ?? makeT("auto", "en"));
      if (this.pendingEnterPages.get(ann.id) === pageNumber) {
        this.applyCardMotion(card, "rm-card-enter");
        this.pendingEnterPages.delete(ann.id);
      }
      const pinTop = ann.cardPosition ? ann.cardPosition.y * scale : undefined;
      bySide[side].push({ ann, card, anchorY, pinTop });
    }

    // Second pass: layout each side (push-down to avoid overlap), apply positions, draw connectors.
    for (const side of ["left", "right"] as const) {
      const group = bySide[side];
      if (group.length === 0) continue;
      const out = layoutCards({
        pageHeight, railScrollTop: this.cardRails?.get(pageNumber, side)?.element.scrollTop ?? 0, railViewportHeight: pageHeight,
        entries: group.map((g) => ({ annotationId: g.ann.id, anchorY: g.anchorY, cardHeight: g.card.offsetHeight || 40, pinTop: g.pinTop })),
      });
      const rail = this.cardRails?.get(pageNumber, side);
      rail?.setLayout(out.mode, out.contentHeight);
      for (const g of group) {
        const pos = out.positions.get(g.ann.id);
        if (pos) g.card.style.top = `${pos.top}px`;
      }
    }
    this.cardRails?.prunePage(pageNumber, new Set(
      (["left", "right"] as const).filter((side) => bySide[side].length > 0),
    ));
    this.redrawPageConnectors(pageNumber);
  }

  private redrawPageConnectors(pageNumber: number): void {
    if (!this.handles || this.state !== "attached") return;
    const container = this.handles.viewerContainerEl;
    clearPageConnectors(container, pageNumber);
    const pageEl = findPageEl(this.handles, pageNumber);
    if (!pageEl) return;
    const scale = readCurrentScale(this.handles);
    const containerRect = container.getBoundingClientRect();
    const pageRect = pageEl.getBoundingClientRect();
    const offsetX = pageRect.left - containerRect.left + container.scrollLeft;
    const offsetY = pageRect.top - containerRect.top + container.scrollTop;
    const pageHeight = pageEl.offsetHeight || pageRect.height;
    const pageWidth = pageEl.offsetWidth || pageRect.width;

    for (const ann of this.store.byPage(this.pdfPath, pageNumber)) {
      const resolved = this.resolvedAnchors.get(this.generation, pageNumber, ann.id);
      if (!resolved || resolved.rects.length === 0) continue;
      const first = resolved.rects[0];
      const side = resolved.side;
      if (!side) continue;
      const rail = this.cardRails?.get(pageNumber, side);
      if (!rail) continue;
      const card = annotationElement<HTMLElement>(rail.element, ".rm-card", ann.id);
      if (!card) continue;
      const cardTop = Number.parseFloat(card.style.top) || 0;
      const cardHeight = card.offsetHeight || 40;
      const visibleTop = cardTop - rail.element.scrollTop;
      if (visibleTop + cardHeight < 0 || visibleTop > pageHeight) continue;
      const localLeft = Number.parseFloat(card.style.left) || 0;
      const cardWidth = card.offsetWidth || Number.parseFloat(card.style.width) || 40;
      const markEdgeX = side === "left"
        ? offsetX + first.x * scale
        : offsetX + (first.x + first.width) * scale;
      const cardEdgeX = rail.localXToContainer(side === "left" ? localLeft + cardWidth : localLeft);
      const markCenterY = offsetY + (first.y + first.height / 2) * scale;
      const cardCenterY = offsetY + visibleTop + cardHeight / 2;
      const stitching = this.pendingStitchPages.get(ann.id) === pageNumber;
      drawEphemeralConnector(container, {
        x1: markEdgeX, y1: markCenterY, x2: cardEdgeX, y2: cardCenterY,
        color: ann.colorValueSnapshot, id: ann.id, pageNumber, side,
        selected: this.hoveredId === ann.id,
        stitching,
      });
      if (stitching) this.pendingStitchPages.delete(ann.id);
    }
  }

  // Remove a deleted annotation's card + connector from the DOM (marks are cleared by renderPage).
  // With { animate: true } the card plays a short exit fade first (deletion feedback);
  // reconcile-driven clears stay instant.
  private removeAnnotationDom(id: string, opts?: { animate?: boolean }): void {
    if (!this.handles) return;
    const container = this.handles.viewerContainerEl;
    annotationElements<HTMLElement>(container, ".rm-card", id).forEach((n) => {
      // The popover card lives in .rm-popover-layer and is managed separately
      // (showPopover/rebuildPopover/hidePopover). renderPage calls this for every
      // popover-mode annotation to clear stale RAIL cards - without this guard it
      // would also delete the popover card the user is interacting with.
      if (n.closest(".rm-popover-layer")) return;
      if (!opts?.animate) { n.remove(); return; }
      if (n.classList.contains("rm-card-exit")) return; // already exiting (delete fires twice: change event + caller)
      const win = n.ownerDocument.defaultView;
      if (win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { n.remove(); return; }
      n.classList.add("rm-card-exit");
      // Remember the rail so the cleanup can reclaim it once empty. clearPageCards,
      // removePage, and prunePage all spare rails that still host an exit card;
      // this callback removes the card and prunes the rail when nothing remains.
      const rail = n.closest<HTMLElement>(".rm-page-card-rail");
      const pageNumber = rail ? Number.parseInt(rail.dataset.pageNumber ?? "", 10) : NaN;
      const side = rail ? (rail.dataset.side as PageCardRailSide | undefined) : undefined;
      const cleanup = () => {
        n.remove();
        if (Number.isFinite(pageNumber) && side) this.cardRails?.pruneRailIfEmpty(pageNumber, side);
      };
      n.addEventListener("animationend", cleanup, { once: true });
      // Backstop in case animationend is swallowed (element detached mid-animation).
      win?.setTimeout(cleanup, 400);
    });
    annotationElements(container, "g.rm-connector", id).forEach((n) => n.remove());
  }

  // --- Popover display (Phase A) ------------------------------------------
  // A single hover-triggered .rm-card lives in .rm-popover-layer. It reuses the
  // exact same buildCard/styles as rail cards - no new card UI. Shown for marks
  // in popover render mode (explicit popover displayMode, or card-mode in a
  // narrow margin). Hover shows; click inside pins; click outside / Esc closes.

  // Narrow-margin check factored out so createAnnotation can decide whether a
  // new card-mode annotation will render as a popover (no room for a rail card).
  private isNarrow(pageEl: HTMLElement): boolean {
    if (!this.handles) return false;
    const container = this.handles.viewerContainerEl;
    const marginPx = container.offsetWidth && pageEl.offsetWidth
      ? (container.offsetWidth - pageEl.offsetWidth) / 2 - 16
      : Infinity;
    return marginPx < 136;
  }

  private schedulePopoverCheck(): void {
    if (!this.handles || this.popoverRafId !== null) return;
    const win = this.handles.viewerEl.ownerDocument.defaultView;
    if (!win) return;
    const gen = this.generation;
    this.popoverRafId = win.requestAnimationFrame(() => {
      this.popoverRafId = null;
      if (this.generation !== gen) return;
      this.checkPopover();
    });
  }

  private checkPopover(): void {
    // Pinned or editing: do not change the popover on hover.
    if (this.popoverPinned || (this.editingId !== null && this.editingId === this.popoverId)) return;
    const e = this.lastPointerMove;
    if (!e || !this.handles) return;
    // Cursor inside the current popover card: keep it open so the user can
    // move from the mark into the card without it dismissing.
    if (this.popoverId !== null && this.popoverLayer?.contains(e.target)) { this.cancelHidePopover(); return; }
    const hitId = this.hitTestPopoverMark(e.x, e.y);
    if (hitId) {
      this.cancelHidePopover();
      if (hitId !== this.popoverId) this.showPopover(hitId);
    } else {
      // Don't hide immediately - grace period so the user can transit from the
      // mark into the card (or back) without the popover vanishing mid-move.
      this.scheduleHidePopover();
    }
  }

  private cancelHidePopover(): void {
    if (this.popoverHideTimer !== null && this.handles) {
      this.handles.viewerEl.ownerDocument.defaultView?.clearTimeout(this.popoverHideTimer);
      this.popoverHideTimer = null;
    }
  }

  private scheduleHidePopover(): void {
    this.cancelHidePopover();
    const win = this.handles?.viewerEl.ownerDocument.defaultView;
    if (!win) { this.hidePopover(); return; }
    const grace = this.store.data.settings.popoverGraceMs;
    this.popoverHideTimer = win.setTimeout(() => {
      this.popoverHideTimer = null;
      this.hidePopover();
    }, grace);
  }

  private pageUnderClientPoint(clientX: number, clientY: number): HTMLElement | null {
    if (!this.handles) return null;
    const pages = this.handles.viewerEl.querySelectorAll<HTMLElement>(".page[data-page-number]");
    for (const p of pages) {
      const r = p.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return p;
    }
    return null;
  }

  private hitTestPopoverMark(clientX: number, clientY: number): string | null {
    if (!this.handles) return null;
    const pageEl = this.pageUnderClientPoint(clientX, clientY);
    if (!pageEl) return null;
    const pageNumber = parseInt(pageEl.dataset.pageNumber ?? "", 10);
    if (!Number.isFinite(pageNumber)) return null;
    const entries = this.resolvedAnchors.hitEntries(this.generation, pageNumber);
    if (entries.length === 0) return null;
    const scale = readCurrentScale(this.handles);
    const pageRect = pageEl.getBoundingClientRect();
    const px = (clientX - pageRect.left) / scale;
    const py = (clientY - pageRect.top) / scale;
    const id = hitTestAnnotation(entries, px, py);
    // Only marks in popover render mode (no visible rail card) trigger a popover.
    return id && this.popoverRenderIds.has(id) ? id : null;
  }

  showPopover(id: string): void {
    if (!this.handles || !this.popoverLayer) return;
    this.cancelHidePopover();
    const ann = this.store.byId(this.pdfPath, id);
    if (!ann) { this.forceHidePopover(); return; }
    this.popoverId = id;
    this.buildPopoverCard(ann);
  }

  private buildPopoverCard(ann: AnnotationRecordV1): void {
    if (!this.handles || !this.popoverLayer) return;
    const doc = this.popoverLayer.ownerDocument;
    // Replace any existing popover card (rebuild on update/edit).
    this.popoverLayer.querySelectorAll(".rm-card").forEach((n) => n.remove());
    const pageEl = findPageEl(this.handles, ann.anchor.pageNumber);
    if (!pageEl) return;
    const scale = readCurrentScale(this.handles);
    const resolved = this.resolveAnnotation(ann, pageEl, scale);
    if (!resolved) return;
    this.projectResolvedAnchor(ann, resolved);
    const first = resolved.rects[0];
    // Mark rect + viewport in viewer-container CONTENT coords (the popover
    // positions absolutely in this space, so it scrolls with the page).
    const container = this.handles.viewerContainerEl;
    const containerRect = container.getBoundingClientRect();
    const pageRect = pageEl.getBoundingClientRect();
    const offsetX = pageRect.left - containerRect.left + container.scrollLeft;
    const offsetY = pageRect.top - containerRect.top + container.scrollTop;
    const markRect = { x: offsetX + first.x * scale, y: offsetY + first.y * scale, width: first.width * scale, height: first.height * scale };
    const vp = {
      left: container.scrollLeft, top: container.scrollTop,
      right: container.scrollLeft + (container.clientWidth || container.offsetWidth),
      bottom: container.scrollTop + (container.clientHeight || container.offsetHeight),
    };
    const cardWidth = Math.min(240, Math.max(160, vp.right - vp.left - 16));
    const isEditing = this.editingId === ann.id;
    // Estimate height for placement; re-measure after build in a real host.
    const estimateHeight = 140;
    let placement = computePopoverPlacement({ markRect, cardSize: { width: cardWidth, height: estimateHeight }, viewport: vp });
    const card = buildCard(this.popoverLayer, {
      id: ann.id, quote: ann.anchor.quote.exact, comment: ann.comment, color: ann.colorValueSnapshot, colorId: ann.colorIdSnapshot,
      colors: this.store.data.settings.colors.map((c) => ({ id: c.id, value: c.value, label: c.name })),
      markStyle: ann.markStyle, side: "right", anchorY: placement.top, editing: isEditing,
      draftValue: isEditing ? this.draft.peek(ann.id)?.value : undefined,
      cardLeft: placement.left, cardWidth,
    }, this.cardCallbacks(), this.t ?? makeT("auto", "en"));
    // Re-place with the real height when the host can measure it (jsdom returns 0).
    const realHeight = card.offsetHeight || 0;
    if (realHeight > 0 && Math.abs(realHeight - estimateHeight) > 8) {
      placement = computePopoverPlacement({ markRect, cardSize: { width: cardWidth, height: realHeight }, viewport: vp });
      card.style.top = `${placement.top}px`;
      card.style.left = `${placement.left}px`;
    }
  }

  // Soft hide: used by the hover-leave grace timer. Respects pin/editing so a
  // popover the user is actively using is not dismissed by a stale timer.
  hidePopover(): void {
    if (this.popoverId === null) return;
    if (this.editingId === this.popoverId) return;
    if (this.popoverPinned) return;
    this.forceHidePopover();
  }

  // Unconditional clear (deletion, mode change to card, click-outside, dispose).
  private forceHidePopover(): void {
    this.cancelHidePopover();
    this.popoverId = null;
    this.popoverPinned = false;
    this.popoverLayer?.querySelectorAll(".rm-card").forEach((n) => n.remove());
  }

  private rebuildPopover(): void {
    if (this.popoverId === null || !this.handles) return;
    const ann = this.store.byId(this.pdfPath, this.popoverId);
    if (!ann) { this.forceHidePopover(); return; }
    // If the annotation no longer renders as a popover (switched to card-mode
    // with room for a rail card), close it - the rail card is now the view.
    const pageEl = findPageEl(this.handles, ann.anchor.pageNumber);
    const narrow = pageEl ? this.isNarrow(pageEl) : false;
    if (ann.displayMode === "card" && !narrow) { this.forceHidePopover(); return; }
    this.buildPopoverCard(ann);
  }

  hasSelection(): boolean { return this.sel.current() !== null; }

  // The color the next highlight/underline uses. Falls back to the persisted
  // default until the user picks a swatch in the toolbar.
  getActiveColorId(): string {
    return this.activeColorId ?? this.store.data.settings.defaultColorId;
  }

  // Select the active color (toolbar swatch click). No-op for an unknown id;
  // never persists - the persistent default is changed in settings.
  setActiveColor(colorId: string): void {
    if (!this.store.data.settings.colors.some((c) => c.id === colorId)) return;
    if (this.activeColorId === colorId) return;
    this.activeColorId = colorId;
    this.toolbar?.setActiveColor(colorId);
  }

  // Toolbar "convert all" (Phase C): two-state toggle. If every annotation in
  // this document is already popover, switch all to card; otherwise switch all
  // to popover. The store change event then re-reconciles and updates the
  // button state via updateConvertAllState.
  convertAll(): void {
    const anns = this.store.byPath(this.pdfPath);
    if (anns.length === 0) return;
    const allPopover = anns.every((a) => a.displayMode === "popover");
    this.store.setDisplayModeForAll(this.pdfPath, allPopover ? "card" : "popover");
  }

  private updateConvertAllState(): void {
    const anns = this.store.byPath(this.pdfPath);
    const allPopover = anns.length > 0 && anns.every((a) => a.displayMode === "popover");
    this.toolbar?.setConvertAllState(allPopover);
  }

  createAnnotation(markStyle: "highlight" | "underline", opts?: { colorId?: string; annotate?: boolean }): MutationResult {
    if (!this.handles || this.state !== "attached") return { ok: false, reason: "session not attached" };
    const snap = this.sel.current();
    if (!snap) return { ok: false, reason: "no valid selection" };
    // Resolve signature at create time - the PDF may not be loaded at attach time.
    const sig = this.resolveSignature();
    if (!sig) return { ok: false, reason: "source signature unavailable" };
    const pageEl = findPageEl(this.handles, snap.pageNumber);
    if (!pageEl) return { ok: false, reason: "page not found" };
    const scale = readCurrentScale(this.handles);
    const rotation = readPagesRotation(this.handles);
    if (rotation === undefined || rotation !== 0) return { ok: false, reason: "page rotation unsupported" };
    const dims = { pageWidth: pageEl.offsetWidth / scale, pageHeight: pageEl.offsetHeight / scale, rotation };
    // Capture a text-layer locator + quote context so the anchor can be resolved
    // (not just re-painted) on reopen/reflow (H-03). locator is best-effort: if
    // the selection does not land on tracked text items, it is omitted.
    const textLayer = pageEl.querySelector<HTMLElement>(".textLayer");
    this.diagnosticCounts.locatorEncodeAttempts++;
    const locator = textLayer
      ? (encodeLocator(snap.range.startContainer, snap.range.startOffset, snap.range.endContainer, snap.range.endOffset, textLayer) ?? undefined)
      : undefined;
    if (locator) this.diagnosticCounts.locatorEncodeSuccesses++;
    const ctx = { locator, textLayer };
    const anchor = captureAnchor(snap, pageEl, scale, dims, ctx);
    if (!anchor) return { ok: false, reason: "anchor capture failed" };
    const colors = this.store.data.settings.colors;
    const id = opts?.colorId ?? this.getActiveColorId();
    const color = colors.find((c) => c.id === id) ?? colors[0];
    const result = this.store.create(this.pdfPath, {
      markStyle, colorId: color.id, colorLabel: color.name, colorValue: color.value, anchor,
    }, sig);
    if (result.ok) {
      snap.win.getSelection()?.removeAllRanges();
      // Clear the cached snapshot so a repeat trigger (double-click, double hotkey)
      // cannot create a duplicate annotation from the same selection.
      this.sel.clear();
      // "Mark + annotate" actions (highlight&annotate, underline&annotate) enter
      // edit mode immediately so the user can type without a second click (H-09),
      // unless the user disabled auto-open in settings. Plain highlight/underline
      // just leave the mark.
      if (opts?.annotate && this.store.data.settings.autoOpenEdit) {
        const created = result.annotation;
        this.editingId = created.id;
        this.draft.begin(created.id, created.revision, "");
        // If the new annotation will render as a popover (explicit popover mode,
        // or card-mode in a narrow margin with no room for a rail card), show +
        // pin the popover so the user can type immediately. Otherwise the rail
        // card's edit box opens on reconcilePage (current behavior).
        if (created.displayMode === "popover" || this.isNarrow(pageEl)) {
          this.showPopover(created.id);
          this.popoverPinned = true;
        }
      }
      this.reconcilePage(snap.pageNumber);
    }
    return result;
  }

  // True when a card's edit box is open. Used by the "Save annotation" command's
  // checkCallback so Obsidian only routes the hotkey when there is something to save.
  hasActiveEdit(): boolean { return this.editingId !== null; }

  // Commit the currently-open edit box. Bound to the "Save annotation" command
  // (default Mod+Enter = Ctrl+Enter on Windows, Cmd+Enter on macOS) so the save
  // works through Obsidian's hotkey system instead of relying on the textarea's
  // keydown listener (which the host keymap can intercept).
  commitActiveEdit(): MutationResult {
    if (!this.editingId) return { ok: false, reason: "no active edit" };
    const id = this.editingId;
    const value = this.draft.peek(id)?.value ?? "";
    return this.commitComment(id, value);
  }

  // Shared commit path for the textarea save button, Ctrl+Enter, and the
  // "Save annotation" command. Returns the store result so callers can react.
  private commitComment(id: string, value: string): MutationResult {
    const ann = this.store.byId(this.pdfPath, id);
    if (!ann) { this.editingId = null; this.draft.cancel(id); return { ok: false, reason: "annotation not found" }; }
    // Idempotent guard: if the edit box is already closed for this id (another
    // path committed first - e.g. the save command, then the textarea's
    // Ctrl+Enter also reaches here) and the stored comment already matches, do
    // not re-save. Avoids a redundant revision bump + double save pulse when
    // both the command and the textarea keydown fire for the same gesture.
    if (this.editingId !== id && ann.comment === value) {
      return { ok: true, annotation: structuredClone(ann), revision: this.store.data.stateRevision };
    }
    const draft = this.draft.peek(id);
    const baseRev = draft?.baseRevision ?? ann.revision;
    const result = this.store.update(this.pdfPath, id, { comment: value }, baseRev);
    if (result.ok) {
      this.editingId = null;
      this.draft.cancel(id);
      // Quiet "saved" acknowledgment: a 600ms outline pulse on the rebuilt card.
      this.pulseCard(id, "rm-card-saved");
      // store.update fired the change event synchronously, which rebuilt the
      // popover WHILE editingId was still set (stale editing=true). Rebuild
      // again now that editingId is cleared so the popover reflects the saved
      // state (non-editing) instead of a leftover textarea.
      if (this.popoverId === id) this.rebuildPopover();
    } else {
      // Conflict: keep the draft (and edit mode) so the user can retry.
      this.draft.update(id, value);
      new Notice(this.t!("notice.conflict"));
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
    new ExportModal(app, this.pdfPath, annotations, { documentId: doc.documentId, documentRevision: doc.revision }, service, this.t!,
      () => this.toolbar?.pulseExport()).open();
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
    const entries = this.resolvedAnchors.hitEntries(this.generation, pageNumber);
    if (entries.length === 0) return;
    const scale = readCurrentScale(this.handles);
    const pageRect = pageEl.getBoundingClientRect();
    const px = (e.clientX - pageRect.left) / scale;
    const py = (e.clientY - pageRect.top) / scale;
    const id = hitTestAnnotation(
      entries,
      px, py,
    );
    if (id) this.flashCard(id);
  }

  private flashCard(id: string): void {
    if (!this.handles) return;
    const container = this.handles.viewerContainerEl;
    const card = annotationElement<HTMLElement>(container, ".rm-card", id);
    if (!card) return;
    const connector = annotationElement<SVGGElement>(container, "g.rm-connector", id);
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
    const prev = this.hoveredId;
    const container = this.handles.viewerContainerEl;
    container.querySelectorAll(".rm-connector-selected").forEach((n) => n.classList.remove("rm-connector-selected"));
    // B-direction: lift the source highlight too ("the thread is taut").
    if (prev) {
      annotationElements<HTMLElement>(container, ".rm-mark-group", prev).forEach((n) => n.classList.remove("rm-mark-hover"));
    }
    this.hoveredId = id;
    if (id) {
      annotationElement(container, "g.rm-connector", id)?.classList.add("rm-connector-selected");
      annotationElements<HTMLElement>(container, ".rm-mark-group", id).forEach((n) => n.classList.add("rm-mark-hover"));
    }
  }

  // Drag a card via its grip: live `top` follows the pointer (clamped to the
  // anchor page's band), committed to the store on pointerup as a page-css y.
  // Re-render is deferred during the drag so the card element survives.
  private beginDrag(id: string, e: PointerEvent, card: HTMLElement): void {
    if (!this.handles) return;
    if (e.button !== 0) return; // primary button only
    this.activeDragDispose?.();
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
    const rail = this.cardRails?.get(ann.anchor.pageNumber, side);
    if (!rail) return;
    const horizontal = computeCardRailGeometry({
      side,
      containerLeft: container.scrollLeft,
      containerWidth: containerRect.width || container.offsetWidth || parseFloat(container.style.width) || 0,
      pageLeft: pageRect.left - containerRect.left + container.scrollLeft,
      pageRight: pageRect.right - containerRect.left + container.scrollLeft,
      storedX: rail.localXToContainer(startLeft),
      cardWidth,
    });
    const baseRevision = ann.revision;
    const dragGeneration = this.generation;
    const grip = card.querySelector<HTMLElement>(".rm-card-grip") ?? card;
    let moved = false;
    this.draggingId = id;
    this.dragGeometryStale = false;
    card.classList.add("rm-card-dragging");
    try { grip.setPointerCapture(e.pointerId); } catch { /* pointer already released */ }
    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      const dx = ev.clientX - startX;
      if (Math.abs(dy) > 1 || Math.abs(dx) > 1) moved = true;
      const nextTopVp = Math.max(minVp, Math.min(startCardTopVp + dy, maxVp));
      card.style.top = `${startTop + (nextTopVp - startCardTopVp)}px`;
      const nextContainerLeft = Math.max(horizontal.minX, Math.min(rail.localXToContainer(startLeft) + dx, horizontal.maxX));
      card.style.left = `${rail.containerXToLocal(nextContainerLeft)}px`;
    };
    let finished = false;
    const finish = (cancelled: boolean) => {
      if (finished) return;
      finished = true;
      grip.removeEventListener("pointermove", onMove);
      grip.removeEventListener("pointerup", onUp);
      grip.removeEventListener("pointercancel", onCancel);
      try { grip.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      card.classList.remove("rm-card-dragging");
      if (this.draggingId === id) this.draggingId = null;
      if (this.activeDragDispose === cancelDrag) this.activeDragDispose = null;
      const stale = this.dragGeometryStale;
      this.dragGeometryStale = false;
      if (this.generation !== dragGeneration || this.state === "disposing" || this.state === "disposed") return;
      // Flush any re-renders deferred during the drag.
      if (this.pendingReconcile.size > 0) this.reconcilePage([...this.pendingReconcile][0]);
      if (cancelled || stale || !moved) return;
      const y = (parseFloat(card.style.top) || 0) / scale; // rail/page-local -> page-css-v1
      const x = rail.localXToContainer(parseFloat(card.style.left) || 0); // durable container-content x
      this.store.update(this.pdfPath, id, { cardPosition: { space: "page-css-v1", y, x } }, baseRevision);
      // Settle pulse on the (rebuilt) card: a 180ms 1.02→1 scale acknowledges
      // "position saved" without shadows or movement (animate pass).
      this.pulseCard(id, "rm-card-settle");
    };
    const onUp = () => finish(false);
    const onCancel = () => finish(true);
    const cancelDrag = () => finish(true);
    this.activeDragDispose = cancelDrag;
    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", onUp);
    grip.addEventListener("pointercancel", onCancel);
  }

  // One-shot CSS class on the (possibly rebuilt) card: class in, removed at animationend.
  private pulseCard(id: string, cls: string): void {
    if (!this.handles) return;
    const win = this.handles.viewerContainerEl.ownerDocument.defaultView;
    win?.requestAnimationFrame(() => {
      const card = this.handles ? annotationElement<HTMLElement>(this.handles.viewerContainerEl, ".rm-card", id) : null;
      if (!card) return;
      this.applyCardMotion(card, cls);
    });
  }

  private applyCardMotion(card: HTMLElement, cls: string): void {
    const win = card.ownerDocument.defaultView;
    if (!win || win.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    card.classList.add(cls);
    let timer: number | undefined;
    const cleanup = () => {
      card.classList.remove(cls);
      if (timer !== undefined) win.clearTimeout(timer);
    };
    card.addEventListener("animationend", cleanup, { once: true });
    timer = win.setTimeout(cleanup, 1000);
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

  // Resolve an annotation's anchor against the live page. Returns the rects to
  // draw, or null when unresolved (caller skips drawing - spec §9.6, H-03).
  private resolveAnnotation(
    ann: AnnotationRecordV1,
    pageEl: HTMLElement,
    scale: number,
  ): Extract<AnchorResolveResult, { status: "resolved" }> | null {
    const liveRotation = this.handles ? readPagesRotation(this.handles) : undefined;
    // PDFViewer's pagesRotation is the only currently verified rotation source.
    // Unknown and nonzero values fail closed until rotated coordinate projection
    // has its own tested implementation.
    if (liveRotation === undefined || liveRotation !== 0 || ann.anchor.geometry.rotation !== liveRotation) {
      this.recordResolutionDiagnostics(ann, "unresolved:rotation-unsupported", false, false);
      return null;
    }
    const dims = { pageWidth: pageEl.offsetWidth / scale, pageHeight: pageEl.offsetHeight / scale, rotation: liveRotation };
    const textLayer = pageEl.querySelector<HTMLElement>(".textLayer");
    let locatorAttempted = false;
    let locatorDecoded = false;
    if (!textLayer || !(textLayer.textContent ?? "").trim()) {
      this.recordResolutionDiagnostics(ann, "unresolved:text-layer-unavailable", locatorAttempted, locatorDecoded);
      return null;
    }
    const ctx: ResolveContext = {
      findRangeByLocator: (loc) => {
        locatorAttempted = true;
        if (!loc) return null;
        const range = decodeLocator(loc, textLayer);
        if (!range) return null;
        locatorDecoded = true;
        return this.rangeToHit(range, pageEl, scale, dims);
      },
      searchPageText: (exact, prefix, suffix) => searchTextLayerQuote(
        textLayer,
        exact,
        prefix,
        suffix,
        (range) => this.rangeToHit(range, pageEl, scale, dims),
      ),
      pageDims: dims,
    };
    const result = resolveAnchor(ann.anchor, ctx);
    const outcome = result.status === "resolved" ? result.method : `unresolved:${result.reason}`;
    this.recordResolutionDiagnostics(ann, outcome, locatorAttempted, locatorDecoded);
    return result.status === "resolved" ? result : null;
  }

  private projectResolvedAnchor(
    ann: AnnotationRecordV1,
    result: Extract<AnchorResolveResult, { status: "resolved" }>,
    side?: PageCardRailSide,
  ): void {
    this.resolvedAnchors.set({
      annotationId: ann.id,
      pageNumber: ann.anchor.pageNumber,
      generation: this.generation,
      rects: result.rects,
      method: result.method,
      side,
    });
  }

  private recordResolutionDiagnostics(
    ann: AnnotationRecordV1,
    outcome: string,
    locatorAttempted: boolean,
    locatorDecoded: boolean,
  ): void {
    const key = `${this.generation}:${ann.anchor.pageNumber}:${ann.id}`;
    const revisionOutcome = `${ann.revision}:${outcome}`;
    if (this.resolutionDiagnosticOutcomes.get(key) === revisionOutcome) return;
    this.resolutionDiagnosticOutcomes.set(key, revisionOutcome);
    if (locatorAttempted) this.diagnosticCounts.locatorDecodeAttempts++;
    if (locatorDecoded) this.diagnosticCounts.locatorDecodeSuccesses++;
    if (outcome === "quote") this.diagnosticCounts.quoteResolutions++;
    else if (outcome === "geometry") this.diagnosticCounts.geometryFallbacks++;
    else if (outcome.startsWith("unresolved:")) this.diagnosticCounts.unresolvedAnchors++;
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

  private reconcileAllMountedPages(): void {
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
    // When the affected annotation is the one shown in the popover, rebuild the
    // popover card directly (reconcilePage only manages rail cards, and would
    // not reflect the editing/comment change on the popover). Falls back to
    // reRender for rail-card annotations.
    const reRenderOrPopover = (id: string) => {
      if (this.popoverId === id) this.rebuildPopover();
      else reRender(id);
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
        reRenderOrPopover(id);
      },
      onDraftUpdate: (id, value) => {
        // Keep the draft in sync with the textarea so re-render/conflict restore
        // the user's current input (H-04).
        this.draft.update(id, value);
      },
      onCommitComment: (id, value) => { this.commitComment(id, value); },
      onCancelEdit: (id) => {
        this.editingId = null;
        this.draft.cancel(id);
        reRenderOrPopover(id);
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
          this.removeAnnotationDom(id, { animate: true }); // exit fade; guarded against the change-event double-fire
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
      onChangeDisplayMode: (id) => {
        const ann = this.store.byId(this.pdfPath, id);
        if (!ann) return;
        const next: DisplayMode = ann.displayMode === "card" ? "popover" : "card";
        this.store.update(this.pdfPath, id, { displayMode: next }, ann.revision);
        // The store change event rebuilds the page (rail card appears/disappears)
        // and rebuilds/closes the popover. No explicit handling needed here.
      },
    };
  }

  dispose(): void {
    if (this.state === "disposed") return;
    this.state = "disposing";
    this.generation++;
    this.activeDragDispose?.();
    this.activeDragDispose = null;
    if (this.probeTimer) clearTimeout(this.probeTimer);
    if (this.rafId !== null && this.handles) {
      this.handles.viewerEl.ownerDocument.defaultView?.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pendingReconcile.clear();
    this.pendingConnectorRedraw.clear();
    this.forceHidePopover();
    if (this.popoverRafId !== null && this.handles) {
      this.handles.viewerEl.ownerDocument.defaultView?.cancelAnimationFrame(this.popoverRafId);
      this.popoverRafId = null;
    }
    this.cancelHidePopover();
    this.popoverRenderIds.clear();
    if (this.handles) {
      this.handles.viewerContainerEl.querySelectorAll(".rm-card-rail").forEach((rail) => rail.remove());
      this.handles.viewerContainerEl.querySelector(".rm-connector-layer")?.remove();
      this.handles.viewerEl.querySelectorAll(".rm-mark-layer").forEach((n) => n.remove());
    }
    // Best-effort commit pending drafts before tearing down so unsaved input is
    // not silently lost on view close / plugin unload (H-04). A revision conflict
    // (annotation edited in another view) cannot be merged at dispose time; the
    // attempt is still made, and the failure is surfaced rather than swallowed
    // (LOW-5: silent draft loss is forbidden by spec §5.8).
    for (const d of this.draft.all()) {
      const ann = this.store.byId(this.pdfPath, d.annotationId);
      if (!ann) continue;
      const result = this.store.update(this.pdfPath, d.annotationId, { comment: d.value }, d.baseRevision);
      if (!result.ok && /revision conflict/i.test(result.reason)) {
        new Notice(this.tNotice("notice.draftLostConflict"), 8000);
      }
    }
    this.sel.dispose();
    this.draft.dispose();
    this.pendingEnterPages.clear();
    this.pendingStitchPages.clear();
    this.resolvedAnchors.clear();
    this.resolutionDiagnosticOutcomes.clear();
    this.scope.disposeAll();
    this.state = "disposed";
  }
}
