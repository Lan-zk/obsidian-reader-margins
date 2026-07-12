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
import type { DurableAnnotationStore } from "src/store/durable-annotation-store";
import type { DocumentSignature } from "src/domain/annotation";

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
    clearMarks(pageEl);

    const anns = this.store.byPage(this.pdfPath, pageNumber);
    for (const ann of anns) {
      const rects = ann.anchor.geometry.rects;
      drawEphemeralMark(pageEl, rects, ann.colorValueSnapshot, ann.markStyle, scale);
      const first = rects[0];
      const side: "left" | "right" = unionCenter(rects).x < ann.anchor.geometry.pageWidth / 2 ? "left" : "right";
      const text = ann.comment ?? ann.anchor.quote.exact.slice(0, 60);
      drawEphemeralCard(this.handles.viewerContainerEl, pageEl, { side, text, color: ann.colorValueSnapshot, anchorY: first.y });
      drawEphemeralConnector(this.handles.viewerContainerEl, { x1: first.x, y1: first.y, x2: first.x + 50, y2: first.y, color: ann.colorValueSnapshot });
    }
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
