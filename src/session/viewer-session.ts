// src/session/viewer-session.ts
import type { HostHandles, HostCapabilities } from "src/host/host-typings";
import { probeHostHandles, readCurrentScale, findPageEl } from "src/host/obsidian-pdf-host";
import { probeCapabilities, coreReady } from "src/host/host-capabilities";
import { DisposableScope } from "src/session/disposable-scope";
import { SelectionSnapshotController } from "src/session/selection-snapshot-controller";
import { drawEphemeralMark, clearMarks, type AnchorRect } from "src/render/mark-renderer";
import { drawEphemeralCard } from "src/render/annotation-card-rail";
import { drawEphemeralConnector } from "src/render/connector-renderer";

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

  constructor(private view: any, pdfPath: string, opts: ViewerSessionOptions = {}) {
    this.pdfPath = pdfPath;
    this.opts = { ...DEFAULTS, ...opts } as Required<ViewerSessionOptions>;
  }

  // spec §7.4 attach state machine
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
    // pointerup -> capture selection (spec §8.3)
    const onPointerUp = () => {
      if (!this.handles) return;
      this.sel.capture(`gen${this.generation}`, this.handles.viewerEl.ownerDocument.defaultView!, this.handles.viewerEl);
    };
    h.viewerEl.addEventListener("pointerup", onPointerUp);
    this.scope.addDispose(() => h.viewerEl.removeEventListener("pointerup", onPointerUp));

    this.state = "attached";
    // scan existing pages
    const pages = h.viewerEl.querySelectorAll<HTMLElement>(".page[data-page-number]");
    pages.forEach((p) => this.reconcilePage(parseInt(p.dataset.pageNumber ?? "", 10)));
  }

  // M-1: draw one ephemeral annotation if a selection exists for this page.
  reconcilePage(pageNumber: number): void {
    if (!this.handles || this.state !== "attached") return;
    const pageEl = findPageEl(this.handles, pageNumber);
    if (!pageEl) return;
    const scale = readCurrentScale(this.handles);
    clearMarks(pageEl);

    const snap = this.sel.current();
    if (!snap || snap.pageNumber !== pageNumber) return;

    const pageRect = pageEl.getBoundingClientRect();
    const rects: AnchorRect[] = snap.clientRects.map((c) => ({
      x: (c.left - pageRect.left) / scale,
      y: (c.top - pageRect.top) / scale,
      width: c.width / scale,
      height: c.height / scale,
    }));
    const color = "#fff15c";
    drawEphemeralMark(pageEl, rects, color, "highlight", scale);

    const side: "left" | "right" = rects[0].x + rects[0].width / 2 < (pageRect.width / scale) / 2 ? "left" : "right";
    drawEphemeralCard(this.handles.viewerContainerEl, pageEl, { side, text: snap.selectedText.slice(0, 60), color, anchorY: rects[0].y });
    drawEphemeralConnector(this.handles.viewerContainerEl, { x1: rects[0].x, y1: rects[0].y, x2: rects[0].x + 50, y2: rects[0].y, color });
  }

  dispose(): void {
    if (this.state === "disposed") return;
    this.state = "disposing";
    this.generation++; // invalidate pending async callbacks (spec §7.4)
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
