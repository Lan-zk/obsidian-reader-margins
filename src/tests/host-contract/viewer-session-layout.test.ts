// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { LayoutInvalidationController } from "src/session/layout-invalidation-controller";
import { buildHostFixture } from "src/tests/host-contract/host-shape-fixture";
import { ViewerSession } from "src/session/viewer-session";
import { DurableAnnotationStore } from "src/store/durable-annotation-store";

function makeStore() {
  const store = new DurableAnnotationStore(async () => {});
  store.loadAndValidate(null);
  return store;
}

function resizeEntry(target: Element): ResizeObserverEntry {
  return { target } as unknown as ResizeObserverEntry;
}

function installRafQueue(win: Window) {
  const callbacks: FrameRequestCallback[] = [];
  const request = vi.spyOn(win, "requestAnimationFrame").mockImplementation((cb) => {
    callbacks.push(cb);
    return callbacks.length;
  });
  const cancel = vi.spyOn(win, "cancelAnimationFrame").mockImplementation(() => {});
  return {
    flush() {
      const current = callbacks.splice(0);
      current.forEach((callback) => callback(0));
    },
    request,
    restore() { request.mockRestore(); cancel.mockRestore(); },
  };
}

describe("ViewerSession layout ownership", () => {
  it("uses the owner realm observer and unobserves detached pages", () => {
    const { pages, containerEl } = buildHostFixture({ numPages: 2 });
    const viewerEl = pages[0].el.parentElement!;
    const observed = new Set<Element>();
    const unobserved: Element[] = [];
    let callback: ResizeObserverCallback | null = null;
    class TestResizeObserver {
      constructor(cb: ResizeObserverCallback) { callback = cb; }
      observe(target: Element) { observed.add(target); }
      unobserve(target: Element) { observed.delete(target); unobserved.push(target); }
      disconnect() { observed.clear(); }
    }
    const descriptor = Object.getOwnPropertyDescriptor(window, "ResizeObserver");
    Object.defineProperty(window, "ResizeObserver", { configurable: true, value: TestResizeObserver });
    try {
      const pageInvalidations: number[] = [];
      const controller = new LayoutInvalidationController({
        viewerEl,
        containerEl,
        generation: 4,
        isCurrent: (generation) => generation === 4,
        onInvalidateAll: vi.fn(),
        onInvalidatePage: (page) => pageInvalidations.push(page),
      });
      expect(controller.start()).toBe("ready");
      expect(observed).toEqual(new Set([containerEl, pages[0].el, pages[1].el]));

      pages[1].el.remove();
      (callback as unknown as ResizeObserverCallback)([
        resizeEntry(pages[1].el),
      ], {} as ResizeObserver);
      expect(unobserved).toContain(pages[1].el);
      expect(pageInvalidations).toEqual([]);
      controller.dispose();
    } finally {
      if (descriptor) Object.defineProperty(window, "ResizeObserver", descriptor);
      else delete (window as any).ResizeObserver;
    }
  });

  it("degrades explicitly when ResizeObserver is missing and keeps text-layer invalidation", () => {
    const { pages, containerEl } = buildHostFixture({ numPages: 1 });
    const viewerEl = pages[0].el.parentElement!;
    const descriptor = Object.getOwnPropertyDescriptor(window, "ResizeObserver");
    delete (window as any).ResizeObserver;
    try {
      const onPage = vi.fn();
      const controller = new LayoutInvalidationController({
        viewerEl,
        containerEl,
        generation: 1,
        isCurrent: () => true,
        onInvalidateAll: vi.fn(),
        onInvalidatePage: onPage,
      });
      expect(controller.start()).toBe("missing");
      controller.onTextLayerRendered(1, pages[0].el);
      expect(onPage).toHaveBeenCalledOnce();
      controller.dispose();
    } finally {
      if (descriptor) Object.defineProperty(window, "ResizeObserver", descriptor);
    }
  });

  it("coalesces repeated resize callbacks into one mounted-page render per frame", async () => {
    const { view, pages, containerEl } = buildHostFixture({ numPages: 2, marginWidthPx: 200 });
    const win = containerEl.ownerDocument.defaultView!;
    const raf = installRafQueue(win);
    let callback: ResizeObserverCallback | null = null;
    const descriptor = Object.getOwnPropertyDescriptor(win, "ResizeObserver");
    class TestResizeObserver {
      constructor(cb: ResizeObserverCallback) { callback = cb; }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    Object.defineProperty(win, "ResizeObserver", { configurable: true, value: TestResizeObserver });
    const session = new ViewerSession(view as any, "test.pdf", makeStore());
    try {
      await session.attach();
      raf.flush();
      const render = vi.spyOn(session as any, "renderPage");
      const entries = [resizeEntry(containerEl)];
      (callback as unknown as ResizeObserverCallback)(entries, {} as ResizeObserver);
      (callback as unknown as ResizeObserverCallback)(entries, {} as ResizeObserver);
      expect(render).not.toHaveBeenCalled();
      raf.flush();
      expect(render.mock.calls.map(([page]) => page).sort()).toEqual([1, 2]);

      pages[1].el.remove();
      render.mockClear();
      (callback as unknown as ResizeObserverCallback)(entries, {} as ResizeObserver);
      raf.flush();
      expect(render).toHaveBeenCalledTimes(1);
      expect(render).toHaveBeenCalledWith(1);
    } finally {
      session.dispose();
      raf.restore();
      if (descriptor) Object.defineProperty(win, "ResizeObserver", descriptor);
      else delete (win as any).ResizeObserver;
    }
  });

  it("ignores stale observer callbacks after dispose", async () => {
    const { view, containerEl } = buildHostFixture({ numPages: 1 });
    let callback: ResizeObserverCallback | null = null;
    const descriptor = Object.getOwnPropertyDescriptor(window, "ResizeObserver");
    class TestResizeObserver {
      constructor(cb: ResizeObserverCallback) { callback = cb; }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    Object.defineProperty(window, "ResizeObserver", { configurable: true, value: TestResizeObserver });
    const session = new ViewerSession(view as any, "test.pdf", makeStore());
    try {
      await session.attach();
      const reconcile = vi.spyOn(session, "reconcilePage");
      session.dispose();
      (callback as unknown as ResizeObserverCallback)([
        resizeEntry(containerEl),
      ], {} as ResizeObserver);
      expect(reconcile).not.toHaveBeenCalled();
    } finally {
      session.dispose();
      if (descriptor) Object.defineProperty(window, "ResizeObserver", descriptor);
      else delete (window as any).ResizeObserver;
    }
  });

  it("marks active drag geometry stale so pointerup cancels persistence", async () => {
    const { view, pages, containerEl } = buildHostFixture({ fingerprint: "fp-a", numPages: 1, marginWidthPx: 200 });
    Object.defineProperty(containerEl, "offsetWidth", { configurable: true, value: 1000 });
    Object.defineProperty(containerEl, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800 } as DOMRect),
    });
    Object.defineProperty(pages[0].el, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 200, top: 0, width: 600, height: 800, right: 800, bottom: 800 } as DOMRect),
    });
    let callback: ResizeObserverCallback | null = null;
    const descriptor = Object.getOwnPropertyDescriptor(window, "ResizeObserver");
    class TestResizeObserver {
      constructor(cb: ResizeObserverCallback) { callback = cb; }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    Object.defineProperty(window, "ResizeObserver", { configurable: true, value: TestResizeObserver });
    const store = makeStore();
    const created = store.create("test.pdf", {
      markStyle: "highlight", colorId: "yellow", colorLabel: "Yellow", colorValue: "#fff15c",
      anchor: {
        kind: "pdf-text", version: 1, pageNumber: 1,
        quote: { exact: "drag", normalization: "collapse-whitespace-v1" },
        geometry: { space: "page-css-v1", pageWidth: 600, pageHeight: 800, rotation: 0, rects: [{ x: 10, y: 100, width: 40, height: 14 }] },
      },
    }, { pdfFingerprint: "fp-a", numPages: 1 });
    if (!created.ok) throw new Error(created.reason);
    const session = new ViewerSession(view as any, "test.pdf", store);
    try {
      await session.attach();
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      const card = containerEl.querySelector<HTMLElement>(`.rm-card[data-annotation-id="${created.annotation.id}"]`)!;
      const grip = card.querySelector<HTMLElement>(".rm-card-grip")!;
      Object.defineProperties(card, {
        offsetWidth: { configurable: true, value: 136 },
        offsetHeight: { configurable: true, value: 40 },
        getBoundingClientRect: { configurable: true, value: () => ({ left: 12, top: 100, width: 136, height: 40, right: 148, bottom: 140 } as DOMRect) },
      });
      grip.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 20, clientY: 110 }));
      grip.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, button: 0, clientX: 30, clientY: 150 }));
      (callback as unknown as ResizeObserverCallback)([
        resizeEntry(containerEl),
      ], {} as ResizeObserver);
      grip.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 30, clientY: 150 }));
      expect(store.byId("test.pdf", created.annotation.id)?.cardPosition).toBeUndefined();
    } finally {
      session.dispose();
      if (descriptor) Object.defineProperty(window, "ResizeObserver", descriptor);
      else delete (window as any).ResizeObserver;
    }
  });

  it("dispose cancels an active drag, releases capture, and ignores later pointerup", async () => {
    const { view, pages, containerEl } = buildHostFixture({ fingerprint: "fp-a", numPages: 1, marginWidthPx: 200 });
    Object.defineProperty(containerEl, "offsetWidth", { configurable: true, value: 1000 });
    Object.defineProperty(containerEl, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800 } as DOMRect),
    });
    Object.defineProperty(pages[0].el, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 200, top: 0, width: 600, height: 800, right: 800, bottom: 800 } as DOMRect),
    });
    pages[0].textLayer.textContent = "drag";
    const store = makeStore();
    const created = store.create("test.pdf", {
      markStyle: "highlight", colorId: "yellow", colorLabel: "Yellow", colorValue: "#fff15c",
      anchor: {
        kind: "pdf-text", version: 1, pageNumber: 1,
        quote: { exact: "missing drag geometry", normalization: "collapse-whitespace-v1" },
        geometry: { space: "page-css-v1", pageWidth: 600, pageHeight: 800, rotation: 0, rects: [{ x: 10, y: 100, width: 40, height: 14 }] },
      },
    }, { pdfFingerprint: "fp-a", numPages: 1 });
    if (!created.ok) throw new Error(created.reason);
    const session = new ViewerSession(view as any, "test.pdf", store);
    await session.attach();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    const card = containerEl.querySelector<HTMLElement>(".rm-card")!;
    const grip = card.querySelector<HTMLElement>(".rm-card-grip")!;
    Object.defineProperties(card, {
      offsetWidth: { configurable: true, value: 136 },
      offsetHeight: { configurable: true, value: 40 },
      getBoundingClientRect: { configurable: true, value: () => ({ left: 12, top: 100, width: 136, height: 40, right: 148, bottom: 140 } as DOMRect) },
    });
    const release = vi.fn();
    Object.defineProperty(grip, "setPointerCapture", { configurable: true, value: vi.fn() });
    Object.defineProperty(grip, "releasePointerCapture", { configurable: true, value: release });
    grip.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 20, clientY: 110 }));
    grip.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, button: 0, clientX: 30, clientY: 150 }));

    session.dispose();
    grip.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 30, clientY: 150 }));

    expect(release).toHaveBeenCalledOnce();
    expect(store.byId("test.pdf", created.annotation.id)?.cardPosition).toBeUndefined();
  });

  it("keeps a normal page-two rail unclipped and page-local when page one is dense", async () => {
    const { view, pages, containerEl } = buildHostFixture({ fingerprint: "fp-a", numPages: 2, marginWidthPx: 200 });
    Object.defineProperty(containerEl, "offsetWidth", { configurable: true, value: 1000 });
    Object.defineProperty(containerEl, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800 } as DOMRect),
    });
    pages.forEach(({ el }, index) => {
      const top = index * 900;
      Object.defineProperty(el, "getBoundingClientRect", {
        configurable: true,
        value: () => ({ left: 200, top, width: 600, height: 800, right: 800, bottom: top + 800 } as DOMRect),
      });
    });

    const store = makeStore();
    const create = (pageNumber: number, index: number, y: number) => {
      const result = store.create("test.pdf", {
        markStyle: "highlight",
        colorId: "yellow",
        colorLabel: "Yellow",
        colorValue: "#fff15c",
        anchor: {
          kind: "pdf-text" as const,
          version: 1 as const,
          pageNumber,
          quote: { exact: `page ${pageNumber} annotation ${index}`, normalization: "collapse-whitespace-v1" as const },
          geometry: {
            space: "page-css-v1" as const,
            pageWidth: 600,
            pageHeight: 800,
            rotation: 0 as const,
            rects: [{ x: 10, y, width: 40, height: 14 }],
          },
        },
      }, { pdfFingerprint: "fp-a", numPages: 2 });
      if (!result.ok) throw new Error(result.reason);
      return result.annotation.id;
    };
    for (let index = 0; index < 17; index++) create(1, index, 0);
    const pageTwoId = create(2, 0, 300);

    const session = new ViewerSession(view as any, "test.pdf", store);
    try {
      await session.attach();
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const pageOneRail = containerEl.querySelector<HTMLElement>('.rm-page-card-rail[data-page-number="1"][data-side="left"]')!;
      const pageTwoRail = containerEl.querySelector<HTMLElement>('.rm-page-card-rail[data-page-number="2"][data-side="left"]')!;
      const pageTwoCard = pageTwoRail.querySelector<HTMLElement>(`.rm-card[data-annotation-id="${pageTwoId}"]`)!;
      expect(pageOneRail.dataset.layoutMode).toBe("dense");
      expect(pageOneRail.style.overflowY).toBe("auto");
      expect(pageTwoRail.dataset.layoutMode).toBe("normal");
      expect(pageTwoRail.style.overflowY).toBe("visible");
      expect(pageTwoRail.style.top).toBe("900px");
      expect(pageTwoCard.style.top).toBe("307px");
    } finally {
      session.dispose();
    }
  });

  it("uses the live resolved projection side for both the card rail and connector", async () => {
    const { view, pages, containerEl } = buildHostFixture({ fingerprint: "fp-a", numPages: 1, marginWidthPx: 200 });
    Object.defineProperty(containerEl, "offsetWidth", { configurable: true, value: 1000 });
    Object.defineProperty(containerEl, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800 } as DOMRect),
    });
    Object.defineProperty(pages[0].el, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 200, top: 0, width: 600, height: 800, right: 800, bottom: 800 } as DOMRect),
    });
    const store = makeStore();
    const created = store.create("test.pdf", {
      markStyle: "highlight", colorId: "yellow", colorLabel: "Yellow", colorValue: "#fff15c",
      anchor: {
        kind: "pdf-text", version: 1, pageNumber: 1,
        quote: { exact: "live-side", normalization: "collapse-whitespace-v1" },
        // Stored width would classify x=400 as left. The live 600px page
        // classifies the resolved geometry as right and must own both outputs.
        geometry: { space: "page-css-v1", pageWidth: 1000, pageHeight: 800, rotation: 0, rects: [{ x: 400, y: 100, width: 40, height: 14 }] },
      },
    }, { pdfFingerprint: "fp-a", numPages: 1 });
    if (!created.ok) throw new Error(created.reason);
    const session = new ViewerSession(view as any, "test.pdf", store);
    vi.spyOn(session as any, "resolveAnnotation").mockReturnValue({
      status: "resolved", method: "quote", rects: [{ x: 400, y: 100, width: 40, height: 14 }],
    });
    try {
      await session.attach();
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const card = containerEl.querySelector<HTMLElement>(".rm-card")!;
      const connector = containerEl.querySelector<SVGGElement>("g.rm-connector")!;
      expect(card.closest<HTMLElement>(".rm-page-card-rail")?.dataset.side).toBe("right");
      expect(connector.dataset.side).toBe("right");
    } finally {
      session.dispose();
    }
  });
});
