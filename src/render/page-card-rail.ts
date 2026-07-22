export type PageCardRailSide = "left" | "right";

export interface PageCardRailGeometry {
  pageNumber: number;
  pageEl: HTMLElement;
  side: PageCardRailSide;
  top: number;
  height: number;
  left: number;
  width: number;
}

export interface PageCardRailHandle {
  element: HTMLElement;
  pageNumber: number;
  side: PageCardRailSide;
  containerXToLocal(containerX: number): number;
  localXToContainer(localX: number): number;
  setLayout(mode: "normal" | "dense", contentHeight: number): void;
}

interface OwnedRail {
  element: HTMLElement;
  pageEl: HTMLElement;
  left: number;
  onScroll: () => void;
}

function railKey(pageNumber: number, side: PageCardRailSide): string {
  return `${pageNumber}:${side}`;
}

export class PageCardRailRegistry {
  private rails = new Map<string, OwnedRail>();
  private disposed = false;

  constructor(
    private containerEl: HTMLElement,
    private generation: number,
    private onScroll: (pageNumber: number, side: PageCardRailSide) => void,
  ) {}

  ensure(geometry: PageCardRailGeometry): PageCardRailHandle {
    const key = railKey(geometry.pageNumber, geometry.side);
    let owned = this.rails.get(key);
    if (owned && owned.pageEl !== geometry.pageEl) {
      this.removeOwned(key, owned);
      owned = undefined;
    }
    if (!owned) {
      const element = this.containerEl.ownerDocument.createElement("div");
      element.className = `rm-card-rail rm-page-card-rail rm-card-rail-${geometry.side}`;
      element.dataset.pageNumber = String(geometry.pageNumber);
      element.dataset.side = geometry.side;
      element.dataset.generation = String(this.generation);
      const onScroll = () => {
        if (!this.disposed) this.onScroll(geometry.pageNumber, geometry.side);
      };
      element.addEventListener("scroll", onScroll, { passive: true });
      this.containerEl.appendChild(element);
      owned = { element, pageEl: geometry.pageEl, left: geometry.left, onScroll };
      this.rails.set(key, owned);
    }
    owned.left = geometry.left;
    owned.element.style.top = `${geometry.top}px`;
    owned.element.style.height = `${geometry.height}px`;
    owned.element.style.left = `${geometry.left}px`;
    owned.element.style.width = `${Math.max(0, geometry.width)}px`;
    return this.handle(geometry.pageNumber, geometry.side, owned);
  }

  get(pageNumber: number, side: PageCardRailSide): PageCardRailHandle | null {
    const owned = this.rails.get(railKey(pageNumber, side));
    return owned ? this.handle(pageNumber, side, owned) : null;
  }

  removePage(pageNumber: number): void {
    for (const side of ["left", "right"] as const) {
      const key = railKey(pageNumber, side);
      const owned = this.rails.get(key);
      if (!owned) continue;
      // Spare a rail that still hosts a card mid-exit-animation; the exit
      // cleanup calls pruneRailIfEmpty once the fade finishes. Removing the
      // rail here would cut the delete exit-fade to zero (MEDIUM-1).
      if (owned.element.querySelector(".rm-card-exit")) continue;
      this.removeOwned(key, owned);
    }
  }

  clearPageCards(pageNumber: number): void {
    for (const side of ["left", "right"] as const) {
      // Skip cards mid-exit-animation: a delete fires the change event (which
      // schedules a reconcile) AND removeAnnotationDom({animate}) in the same
      // task. The reconcile would otherwise remove the exiting card before its
      // 150ms fade paints. The exit card self-removes on animationend/backstop.
      this.rails.get(railKey(pageNumber, side))?.element
        .querySelectorAll(".rm-card:not(.rm-card-exit)")
        .forEach((card) => card.remove());
    }
  }

  prunePage(pageNumber: number, activeSides: ReadonlySet<PageCardRailSide>): void {
    for (const side of ["left", "right"] as const) {
      if (activeSides.has(side)) continue;
      const key = railKey(pageNumber, side);
      const owned = this.rails.get(key);
      if (!owned) continue;
      // Same exit-animation sparing as removePage (MEDIUM-1): a side rail with
      // a deleting card is pruned by the exit cleanup, not by this rebuild.
      if (owned.element.querySelector(".rm-card-exit")) continue;
      this.removeOwned(key, owned);
    }
  }

  // Remove a single page/side rail iff it has no cards left. Called by the
  // exit-animation cleanup so a rail spared during a delete is reclaimed once
  // the exiting card finishes its fade (MEDIUM-1).
  pruneRailIfEmpty(pageNumber: number, side: PageCardRailSide): void {
    const key = railKey(pageNumber, side);
    const owned = this.rails.get(key);
    if (!owned) return;
    if (owned.element.querySelector(".rm-card")) return;
    this.removeOwned(key, owned);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [key, owned] of this.rails) this.removeOwned(key, owned);
  }

  private handle(pageNumber: number, side: PageCardRailSide, owned: OwnedRail): PageCardRailHandle {
    return {
      element: owned.element,
      pageNumber,
      side,
      containerXToLocal: (containerX) => containerX - owned.left,
      localXToContainer: (localX) => owned.left + localX,
      setLayout: (mode, contentHeight) => {
        owned.element.dataset.layoutMode = mode;
        owned.element.style.overflowY = mode === "dense" ? "auto" : "visible";
        let spacer = owned.element.querySelector<HTMLElement>(":scope > .rm-page-card-rail-spacer");
        if (mode === "dense") {
          if (!spacer) {
            spacer = owned.element.ownerDocument.createElement("div");
            spacer.className = "rm-page-card-rail-spacer";
            owned.element.prepend(spacer);
          }
          spacer.style.height = `${contentHeight}px`;
        } else {
          spacer?.remove();
          owned.element.scrollTop = 0;
        }
      },
    };
  }

  private removeOwned(key: string, owned: OwnedRail): void {
    owned.element.removeEventListener("scroll", owned.onScroll);
    owned.element.remove();
    this.rails.delete(key);
  }
}
