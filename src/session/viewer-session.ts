// src/session/viewer-session.ts
import type { HostHandles, HostCapabilities } from "src/host/host-typings";
import { probeHostHandles, readCurrentScale, findPageEl, readPdfFingerprint, readPageCount } from "src/host/obsidian-pdf-host";
import { probeCapabilities } from "src/host/host-capabilities";
import { DisposableScope } from "src/session/disposable-scope";
import { SelectionSnapshotController } from "src/session/selection-snapshot-controller";
import { drawEphemeralMark, clearMarks } from "src/render/mark-renderer";
import { drawEphemeralCard } from "src/render/annotation-card-rail";
import { drawEphemeralConnector } from "src/render/connector-renderer";
import { unionCenter } from "src/domain/pdf-text-anchor";
import { captureAnchor } from "src/domain/anchor-resolver";
import type { DurableAnnotationStore } from "src/store/durable-annotation-store";
import type { DocumentSignature, MutationResult } from "src/domain/annotation";

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

    // Subscribe to store changes: re-reconcile affected pages (spec §6.2).
    const unsub = this.store.onChange((path, ids) => {
      if (path !== this.pdfPath) return;
      const pages = new Set<number>();
      for (const id of ids) {
        const a = this.store.byId(path, id);
        if (a) pages.add(a.anchor.pageNumber);
      }
      pages.forEach((p) => this.reconcilePage(p));
    });
    this.scope.addDispose(unsub);

    this.state = "attached";
    const pages = h.viewerEl.querySelectorAll<HTMLElement>(".page[data-page-number]");
    pages.forEach((p) => this.reconcilePage(parseInt(p.dataset.pageNumber ?? "", 10)));
  }

  // M0: render annotations from the store for this page.
  reconcilePage(pageNumber: number): void {
    if (!this.handles || this.state !== "attached") return;
    const pageEl = findPageEl(this.handles, pageNumber);
    if (!pageEl) return;
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

    for (const ann of anns) {
      const rects = ann.anchor.geometry.rects;
      drawEphemeralMark(pageEl, rects, ann.colorValueSnapshot, ann.markStyle, scale);
      const first = rects[0];
      const side: "left" | "right" = unionCenter(rects).x < ann.anchor.geometry.pageWidth / 2 ? "left" : "right";
      const text = ann.comment ?? ann.anchor.quote.exact.slice(0, 60);
      const markCy = offsetY + first.y * scale;
      drawEphemeralCard(container, pageEl, { side, text, color: ann.colorValueSnapshot, anchorY: markCy, id: ann.id });
      const markEdgeX = side === "left" ? offsetX + first.x * scale : offsetX + (first.x + first.width) * scale;
      const cardX = side === "left" ? Math.max(0, offsetX - 30) : offsetX + pageEl.offsetWidth + 30;
      drawEphemeralConnector(container, { x1: markEdgeX, y1: markCy, x2: cardX, y2: markCy, color: ann.colorValueSnapshot, id: ann.id });
    }
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
    if (result.ok) snap.win.getSelection()?.removeAllRanges();
    return result;
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

  dispose(): void {
    if (this.state === "disposed") return;
    this.state = "disposing";
    this.generation++;
    if (this.probeTimer) clearTimeout(this.probeTimer);
    if (this.handles) {
      this.handles.viewerContainerEl.querySelector(".rm-card-rail-left")?.remove();
      this.handles.viewerContainerEl.querySelector(".rm-card-rail-right")?.remove();
      this.handles.viewerContainerEl.querySelector(".rm-connector-layer")?.remove();
      this.handles.viewerEl.querySelectorAll(".rm-mark-layer").forEach((n) => n.remove());
    }
    this.sel.dispose();
    this.scope.disposeAll();
    this.state = "disposed";
  }
}
