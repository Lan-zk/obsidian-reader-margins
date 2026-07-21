export type LayoutInvalidationReason = "container-resize" | "page-resize" | "text-layer";
export type LayoutObserverState = "ready" | "missing" | "disposed";

export interface LayoutInvalidationControllerOptions {
  viewerEl: HTMLElement;
  containerEl: HTMLElement;
  generation: number;
  isCurrent: (generation: number) => boolean;
  onInvalidateAll: (reason: LayoutInvalidationReason) => void;
  onInvalidatePage: (pageNumber: number, reason: LayoutInvalidationReason) => void;
  onResizeSignal?: () => void;
}

function pageNumberOf(target: Element): number | null {
  const HTMLElementCtor = target.ownerDocument.defaultView?.HTMLElement;
  if (!HTMLElementCtor || !(target instanceof HTMLElementCtor)) return null;
  if (!target.matches(".page[data-page-number]")) return null;
  const pageNumber = Number.parseInt((target as HTMLElement).dataset.pageNumber ?? "", 10);
  return Number.isFinite(pageNumber) ? pageNumber : null;
}

// Owns public, realm-local layout signals. Scheduling deliberately remains in
// ViewerSession so resize, text-layer, and store invalidations share one rAF.
export class LayoutInvalidationController {
  private observer: ResizeObserver | null = null;
  private observedPages = new Set<HTMLElement>();
  private state: LayoutObserverState = "missing";

  constructor(private options: LayoutInvalidationControllerOptions) {}

  start(): LayoutObserverState {
    if (this.state === "disposed") return this.state;
    const win = this.options.viewerEl.ownerDocument.defaultView;
    const ResizeObserverCtor = win?.ResizeObserver;
    if (typeof ResizeObserverCtor !== "function") {
      this.state = "missing";
      return this.state;
    }
    this.observer = new ResizeObserverCtor((entries) => this.onResize(entries));
    this.observer.observe(this.options.containerEl);
    this.syncMountedPages();
    this.state = "ready";
    return this.state;
  }

  observerState(): LayoutObserverState { return this.state; }

  onTextLayerRendered(pageNumber: number, pageEl: HTMLElement | null): void {
    if (!this.active()) return;
    if (pageEl) this.observePage(pageEl);
    this.options.onInvalidatePage(pageNumber, "text-layer");
  }

  syncMountedPages(): void {
    if (!this.active()) return;
    const mounted = new Set(
      this.options.viewerEl.querySelectorAll<HTMLElement>(".page[data-page-number]"),
    );
    for (const page of this.observedPages) {
      if (mounted.has(page)) continue;
      this.observer?.unobserve(page);
      this.observedPages.delete(page);
    }
    mounted.forEach((page) => this.observePage(page));
  }

  dispose(): void {
    if (this.state === "disposed") return;
    this.state = "disposed";
    this.observer?.disconnect();
    this.observer = null;
    this.observedPages.clear();
  }

  private active(): boolean {
    return this.state !== "disposed" && this.options.isCurrent(this.options.generation);
  }

  private observePage(page: HTMLElement): void {
    if (!this.observer || this.observedPages.has(page) || !this.options.viewerEl.contains(page)) return;
    this.observer.observe(page);
    this.observedPages.add(page);
  }

  private onResize(entries: ResizeObserverEntry[]): void {
    if (!this.active()) return;
    this.options.onResizeSignal?.();
    let invalidateAll = false;
    const pages = new Set<number>();
    for (const entry of entries) {
      if (entry.target === this.options.containerEl) {
        invalidateAll = true;
        continue;
      }
      const page = entry.target as HTMLElement;
      if (!this.options.viewerEl.contains(page)) {
        this.observer?.unobserve(page);
        this.observedPages.delete(page);
        continue;
      }
      const pageNumber = pageNumberOf(page);
      if (pageNumber != null) pages.add(pageNumber);
    }
    if (invalidateAll) {
      this.syncMountedPages();
      this.options.onInvalidateAll("container-resize");
      return;
    }
    pages.forEach((page) => this.options.onInvalidatePage(page, "page-resize"));
  }
}
