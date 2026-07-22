// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import * as obsidian from "obsidian";
import { buildHostFixture } from "src/tests/host-contract/host-shape-fixture";
import { ViewerSession } from "src/session/viewer-session";
import { DurableAnnotationStore } from "src/store/durable-annotation-store";

function makeStore() {
  const s = new DurableAnnotationStore(async () => {});
  s.loadAndValidate(null);
  return s;
}

// Build an attached session with a ready selection on page 1. Returns the
// session plus the fixture pieces tests need. The selection range lands on a
// tracked text-layer span so createAnnotation's anchor capture succeeds.
function setupWithSelection() {
  const { view, pages, containerEl } = buildHostFixture({ fingerprint: "fp-a", numPages: 1, marginWidthPx: 200 });
  Object.defineProperty(containerEl, "offsetWidth", { configurable: true, value: 1000 });
  Object.defineProperty(containerEl, "getBoundingClientRect", { configurable: true, value: () => ({ left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800 } as DOMRect) });
  Object.defineProperty(pages[0].el, "getBoundingClientRect", { configurable: true, value: () => ({ left: 200, top: 0, width: 600, height: 800, right: 800, bottom: 800 } as DOMRect) });
  const item = document.createElement("span");
  item.className = "textLayerNode";
  item.dataset.idx = "0";
  item.textContent = "private selected words";
  pages[0].textLayer.textContent = "";
  pages[0].textLayer.appendChild(item);
  const range = document.createRange();
  range.setStart(item.firstChild!, 0);
  range.setEnd(item.firstChild!, 22);
  const store = makeStore();
  const session = new ViewerSession(view as any, "test.pdf", store);
  // The context-menu handler reads view.app for the Menu; provide a stub.
  (view as any).app = { locale: "en" };
  // Attach synchronously by resolving the probe; the fixture's host handles are
  // available immediately so attach() resolves on the first tryProbe.
  return { view, pages, containerEl, store, session, item, setSelection: () => {
    (session as any).sel.snapshot = {
      sessionId: "test", win: window, pageNumber: 1,
      selectedText: "private selected words", range,
      clientRects: [DOMRectReadOnly.fromRect({ x: 10, y: 10, width: 80, height: 14 })],
      capturedAt: Date.now(),
    };
  } };
}

describe("ViewerSession (M-1)", () => {
  it("attaches to a ready view and is idempotent", async () => {
    const { view } = buildHostFixture({ numPages: 1, marginWidthPx: 200 });
    const session = new ViewerSession(view as any, "test.pdf", makeStore());
    await session.attach();
    expect(session.state).toBe("attached");
    await session.attach();
    expect(session.state).toBe("attached");
    session.dispose();
    expect(session.state).toBe("disposed");
  });
  it("reconciles on textlayerrendered", async () => {
    const { view, eventBus } = buildHostFixture({ numPages: 1, marginWidthPx: 200 });
    const session = new ViewerSession(view as any, "test.pdf", makeStore());
    await session.attach();
    const spy = vi.spyOn(session, "reconcilePage");
    eventBus.dispatch("textlayerrendered", { pageNumber: 1 });
    expect(spy).toHaveBeenCalledWith(1);
    session.dispose();
  });
  it("reports aggregate-only session diagnostics and stops collecting after dispose", async () => {
    const { view, pages } = buildHostFixture({ fingerprint: "fp-a", numPages: 1, marginWidthPx: 200 });
    const item = document.createElement("span");
    item.className = "textLayerNode";
    item.dataset.idx = "0";
    item.textContent = "private selected words";
    pages[0].textLayer.appendChild(item);

    let resizeCallback: ResizeObserverCallback | null = null;
    let resizeDisconnects = 0;
    const resizeDescriptor = Object.getOwnPropertyDescriptor(window, "ResizeObserver");
    const rectDescriptor = Object.getOwnPropertyDescriptor(Range.prototype, "getClientRects");
    class TestResizeObserver {
      constructor(cb: ResizeObserverCallback) { resizeCallback = cb; }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void { resizeDisconnects++; }
    }
    Object.defineProperty(window, "ResizeObserver", { value: TestResizeObserver, configurable: true });
    Object.defineProperty(Range.prototype, "getClientRects", {
      value: () => [{ left: 10, top: 10, width: 80, height: 14 }],
      configurable: true,
    });

    const store = makeStore();
    const session = new ViewerSession(view as any, "test.pdf", store);
    try {
      await session.attach();
      const baseAnchor = {
        kind: "pdf-text" as const, version: 1 as const, pageNumber: 1,
        quote: { exact: "private selected words", normalization: "collapse-whitespace-v1" as const },
        geometry: { space: "page-css-v1" as const, pageWidth: 600, pageHeight: 800, rotation: 0 as const, rects: [{ x: 10, y: 10, width: 80, height: 14 }] },
      };
      const create = (anchor: typeof baseAnchor & { locator?: { beginIndex: number; beginOffset: number; endIndex: number; endOffset: number } }) => {
        const result = store.create("test.pdf", {
          markStyle: "highlight", colorId: "yellow", colorLabel: "Yellow", colorValue: "#fff15c", anchor,
        }, { pdfFingerprint: "fp-a", numPages: 1 });
        if (!result.ok) throw new Error(result.reason);
        return result.annotation;
      };
      const locator = create({ ...baseAnchor, locator: { beginIndex: 0, beginOffset: 0, endIndex: 0, endOffset: 22 } });
      const quote = create(baseAnchor);
      const geometry = create({ ...baseAnchor, quote: { ...baseAnchor.quote, exact: "missing geometry text" } });
      const unresolved = create({
        ...baseAnchor,
        quote: { ...baseAnchor.quote, exact: "missing unresolved text" },
        geometry: { ...baseAnchor.geometry, pageWidth: 300 },
      });

      expect((session as any).resolveAnnotation(locator, pages[0].el, 1)).not.toBeNull();
      expect((session as any).resolveAnnotation(quote, pages[0].el, 1)).not.toBeNull();
      expect((session as any).resolveAnnotation(geometry, pages[0].el, 1)).not.toBeNull();
      expect((session as any).resolveAnnotation(unresolved, pages[0].el, 1)).toBeNull();

      const selectionRange = document.createRange();
      selectionRange.setStart(item.firstChild!, 0);
      selectionRange.setEnd(item.firstChild!, 22);
      (session as any).sel.snapshot = {
        sessionId: "test", win: window, pageNumber: 1,
        selectedText: "private selected words", range: selectionRange,
        clientRects: [DOMRectReadOnly.fromRect({ x: 10, y: 10, width: 80, height: 14 })],
        capturedAt: Date.now(),
      };
      expect(session.createAnnotation("highlight").ok).toBe(true);

      expect(resizeCallback).not.toBeNull();
      (resizeCallback as unknown as ResizeObserverCallback)([], {} as ResizeObserver);

      const beforeDispose = session.diagnosticsSnapshot();
      expect(beforeDispose).toMatchObject({
        locatorEncodeAttempts: 1,
        locatorEncodeSuccesses: 1,
        locatorDecodeAttempts: 1,
        locatorDecodeSuccesses: 1,
        quoteResolutions: 1,
        geometryFallbacks: 1,
        unresolvedAnchors: 1,
        resizeInvalidations: 1,
        toolbarSlotState: "ready",
        pageNavigationCapabilityState: "unknown",
      });
      expect(JSON.stringify(beforeDispose)).not.toContain("private selected words");
      expect(JSON.stringify(beforeDispose)).not.toContain("test.pdf");

      session.dispose();
      (resizeCallback as unknown as ResizeObserverCallback)([], {} as ResizeObserver);
      expect(session.diagnosticsSnapshot()).toEqual(beforeDispose);
      expect(resizeDisconnects).toBe(1);
    } finally {
      session.dispose();
      if (resizeDescriptor) Object.defineProperty(window, "ResizeObserver", resizeDescriptor);
      else delete (window as any).ResizeObserver;
      if (rectDescriptor) Object.defineProperty(Range.prototype, "getClientRects", rectDescriptor);
      else delete (Range.prototype as any).getClientRects;
    }
  });
  it("fails closed when the PDFViewer rotation capability is unavailable", async () => {
    const { view, pages } = buildHostFixture({ fingerprint: "fp-a", numPages: 1, marginWidthPx: 200 });
    pages[0].textLayer.textContent = "ordinary quote";
    delete (view as any).viewer.child.pdfViewer.pdfViewer.pagesRotation;
    const store = makeStore();
    const created = store.create("test.pdf", {
      markStyle: "highlight", colorId: "yellow", colorLabel: "Yellow", colorValue: "#fff15c",
      anchor: {
        kind: "pdf-text", version: 1, pageNumber: 1,
        quote: { exact: "ordinary quote", normalization: "collapse-whitespace-v1" },
        geometry: { space: "page-css-v1", pageWidth: 600, pageHeight: 800, rotation: 0, rects: [{ x: 10, y: 20, width: 40, height: 12 }] },
      },
    }, { pdfFingerprint: "fp-a", numPages: 1 });
    if (!created.ok) throw new Error(created.reason);
    const session = new ViewerSession(view as any, "test.pdf", store);
    await session.attach();
    expect((session as any).resolveAnnotation(created.annotation, pages[0].el, 1)).toBeNull();
    session.dispose();
  });
  it("reports toolbar fallback while current host handles exist and unknown after the probe fails", async () => {
    const { view } = buildHostFixture({ numPages: 1, includeToolbar: false, marginWidthPx: 200 });
    const session = new ViewerSession(view as any, "test.pdf", makeStore());
    await session.attach();

    expect(session.diagnosticsSnapshot()).toMatchObject({
      toolbarSlotState: "fallback",
      pageNavigationCapabilityState: "unknown",
    });

    delete (view as any).viewer.child;
    expect(session.diagnosticsSnapshot()).toMatchObject({
      toolbarSlotState: "unknown",
      pageNavigationCapabilityState: "unknown",
    });
    session.dispose();
  });
  it("fails closed instead of using stored geometry while the text layer is empty", async () => {
    const { view, pages } = buildHostFixture({ fingerprint: "fp-a", numPages: 1, marginWidthPx: 200 });
    const store = makeStore();
    pages[0].textLayer.textContent = "";
    const created = store.create("test.pdf", {
      markStyle: "highlight", colorId: "yellow", colorLabel: "Yellow", colorValue: "#fff15c",
      anchor: {
        kind: "pdf-text", version: 1, pageNumber: 1,
        quote: { exact: "not rendered yet", normalization: "collapse-whitespace-v1" },
        geometry: { space: "page-css-v1", pageWidth: 600, pageHeight: 800, rotation: 0, rects: [{ x: 10, y: 20, width: 40, height: 12 }] },
      },
    }, { pdfFingerprint: "fp-a", numPages: 1 });
    if (!created.ok) throw new Error(created.reason);
    const session = new ViewerSession(view as any, "test.pdf", store);
    await session.attach();

    expect((session as any).resolveAnnotation(created.annotation, pages[0].el, 1)).toBeNull();
    session.dispose();
  });
  it("fails closed for a nonzero stored page rotation even when quote text matches", async () => {
    const { view, pages } = buildHostFixture({ fingerprint: "fp-a", numPages: 1, marginWidthPx: 200, rotation: 90 });
    pages[0].textLayer.textContent = "rotated quote";
    const rectDescriptor = Object.getOwnPropertyDescriptor(Range.prototype, "getClientRects");
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => [{ left: 10, top: 20, width: 40, height: 12 }],
    });
    const store = makeStore();
    const created = store.create("test.pdf", {
      markStyle: "highlight", colorId: "yellow", colorLabel: "Yellow", colorValue: "#fff15c",
      anchor: {
        kind: "pdf-text", version: 1, pageNumber: 1,
        quote: { exact: "rotated quote", normalization: "collapse-whitespace-v1" },
        geometry: { space: "page-css-v1", pageWidth: 600, pageHeight: 800, rotation: 90, rects: [{ x: 10, y: 20, width: 40, height: 12 }] },
      },
    }, { pdfFingerprint: "fp-a", numPages: 1 });
    if (!created.ok) throw new Error(created.reason);
    const session = new ViewerSession(view as any, "test.pdf", store);
    try {
      await session.attach();
      expect((session as any).resolveAnnotation(created.annotation, pages[0].el, 1)).toBeNull();
    } finally {
      session.dispose();
      if (rectDescriptor) Object.defineProperty(Range.prototype, "getClientRects", rectDescriptor);
      else delete (Range.prototype as any).getClientRects;
    }
  });
  it("applies enter and stitch motion after a created card is rendered on its own page", async () => {
    const { view, containerEl } = buildHostFixture({ fingerprint: "fp-a", numPages: 2, marginWidthPx: 200 });
    Object.defineProperty(SVGElement.prototype, "getTotalLength", { value: () => 100, configurable: true });
    const store = makeStore();
    const session = new ViewerSession(view as any, "test.pdf", store);
    await session.attach();
    session.reconcilePage(1); // an earlier pending page must not consume page 2's motion intent
    const anchor = {
      kind: "pdf-text" as const, version: 1 as const, pageNumber: 2,
      quote: { exact: "new", normalization: "collapse-whitespace-v1" as const },
      geometry: { space: "page-css-v1" as const, pageWidth: 600, pageHeight: 800, rotation: 0 as const, rects: [{ x: 10, y: 10, width: 50, height: 14 }] },
    };
    const created = store.create("test.pdf", { markStyle: "highlight", colorId: "yellow", colorLabel: "Yellow", colorValue: "#fff15c", anchor }, { pdfFingerprint: "fp-a", numPages: 2 });
    if (!created.ok) throw new Error(created.reason);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    expect(containerEl.querySelector(`.rm-card[data-annotation-id="${created.annotation.id}"]`)?.classList.contains("rm-card-enter")).toBe(true);
    expect(containerEl.querySelector(`g.rm-connector[data-annotation-id="${created.annotation.id}"] path`)?.classList.contains("rm-connector-stitch")).toBe(true);
    delete (SVGElement.prototype as any).getTotalLength;
    session.dispose();
  });
  it("keeps one-shot motion pending until the target page can actually render", async () => {
    const { view, pages, containerEl } = buildHostFixture({ fingerprint: "fp-a", numPages: 2, marginWidthPx: 200 });
    Object.defineProperty(SVGElement.prototype, "getTotalLength", { value: () => 100, configurable: true });
    const viewerEl = pages[1].el.parentElement!;
    const detachedPage = pages[1].el;
    detachedPage.remove();
    const store = makeStore();
    const session = new ViewerSession(view as any, "test.pdf", store);
    await session.attach();
    const anchor = {
      kind: "pdf-text" as const, version: 1 as const, pageNumber: 2,
      quote: { exact: "later", normalization: "collapse-whitespace-v1" as const },
      geometry: { space: "page-css-v1" as const, pageWidth: 600, pageHeight: 800, rotation: 0 as const, rects: [{ x: 10, y: 10, width: 50, height: 14 }] },
    };
    const created = store.create("test.pdf", { markStyle: "highlight", colorId: "yellow", colorLabel: "Yellow", colorValue: "#fff15c", anchor }, { pdfFingerprint: "fp-a", numPages: 2 });
    if (!created.ok) throw new Error(created.reason);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(containerEl.querySelector(`[data-annotation-id="${created.annotation.id}"]`)).toBeNull();

    viewerEl.appendChild(detachedPage);
    session.reconcilePage(2);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(containerEl.querySelector(`.rm-card[data-annotation-id="${created.annotation.id}"]`)?.classList.contains("rm-card-enter")).toBe(true);
    expect(containerEl.querySelector(`g.rm-connector[data-annotation-id="${created.annotation.id}"] path`)?.classList.contains("rm-connector-stitch")).toBe(true);
    delete (SVGElement.prototype as any).getTotalLength;
    session.dispose();
  });
  it("does not attach one-shot motion classes when reduced motion is requested", async () => {
    const { view, containerEl } = buildHostFixture({ fingerprint: "fp-a", numPages: 1, marginWidthPx: 200 });
    Object.defineProperty(window, "matchMedia", { value: () => ({ matches: true }), configurable: true });
    Object.defineProperty(SVGElement.prototype, "getTotalLength", { value: () => 100, configurable: true });
    const store = makeStore();
    const session = new ViewerSession(view as any, "test.pdf", store);
    await session.attach();
    const anchor = {
      kind: "pdf-text" as const, version: 1 as const, pageNumber: 1,
      quote: { exact: "still", normalization: "collapse-whitespace-v1" as const },
      geometry: { space: "page-css-v1" as const, pageWidth: 600, pageHeight: 800, rotation: 0 as const, rects: [{ x: 10, y: 10, width: 50, height: 14 }] },
    };
    const created = store.create("test.pdf", { markStyle: "highlight", colorId: "yellow", colorLabel: "Yellow", colorValue: "#fff15c", anchor }, { pdfFingerprint: "fp-a", numPages: 1 });
    if (!created.ok) throw new Error(created.reason);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    const card = containerEl.querySelector<HTMLElement>(`.rm-card[data-annotation-id="${created.annotation.id}"]`)!;
    (session as any).pulseCard(created.annotation.id, "rm-card-saved");
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    expect(card.classList.contains("rm-card-enter")).toBe(false);
    expect(card.classList.contains("rm-card-saved")).toBe(false);
    expect(containerEl.querySelector(".rm-connector-stitch")).toBeNull();
    delete (SVGElement.prototype as any).getTotalLength;
    delete (window as any).matchMedia;
    session.dispose();
  });
  it("keeps the complete source quote in the clamped card and its hover title", async () => {
    const { view, containerEl } = buildHostFixture({ fingerprint: "fp-a", numPages: 1, marginWidthPx: 200 });
    const store = makeStore();
    const exact = "This is a deliberately long source quote that exceeds sixty characters and must remain available in full.";
    const anchor = {
      kind: "pdf-text" as const, version: 1 as const, pageNumber: 1,
      quote: { exact, normalization: "collapse-whitespace-v1" as const },
      geometry: { space: "page-css-v1" as const, pageWidth: 600, pageHeight: 800, rotation: 0 as const, rects: [{ x: 10, y: 10, width: 50, height: 14 }] },
    };
    store.create("test.pdf", { markStyle: "highlight", colorId: "yellow", colorLabel: "Yellow", colorValue: "#fff15c", anchor }, { pdfFingerprint: "fp-a", numPages: 1 });
    const session = new ViewerSession(view as any, "test.pdf", store);
    await session.attach();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    const quote = containerEl.querySelector<HTMLElement>(".rm-card-quote")!;
    expect(quote.textContent).toBe(exact);
    expect(quote.title).toBe(exact);
    session.dispose();
  });
  it("dispose removes all injected DOM", async () => {
    const { view, eventBus, containerEl } = buildHostFixture({ numPages: 1, marginWidthPx: 200 });
    const session = new ViewerSession(view as any, "test.pdf", makeStore());
    await session.attach();
    eventBus.dispatch("textlayerrendered", { pageNumber: 1 });
    session.dispose();
    expect(containerEl.querySelector(".rm-card-rail")).toBeNull();
    expect(containerEl.querySelector(".rm-connector-layer")).toBeNull();
    expect(session.disposerCount).toBe(0);
  });
  it("removes, flashes, and hovers hostile ids by exact dataset equality", async () => {
    const { view, pages, containerEl } = buildHostFixture({ numPages: 1, marginWidthPx: 200 });
    const session = new ViewerSession(view as any, "test.pdf", makeStore());
    await session.attach();
    const hostileId = `bad\"] ~ * [data-x="y`;
    const card = document.createElement("div");
    card.className = "rm-card";
    card.dataset.annotationId = hostileId;
    const connector = document.createElementNS("http://www.w3.org/2000/svg", "g");
    connector.classList.add("rm-connector");
    connector.dataset.annotationId = hostileId;
    const mark = document.createElement("div");
    mark.className = "rm-mark-group";
    mark.dataset.annotationId = hostileId;
    containerEl.append(card, connector);
    pages[0].el.append(mark);

    expect(() => (session as any).flashCard(hostileId)).not.toThrow();
    expect(card.classList.contains("rm-card-linked")).toBe(true);
    expect(() => (session as any).hoverCard(hostileId)).not.toThrow();
    expect(connector.classList.contains("rm-connector-selected")).toBe(true);
    expect(mark.classList.contains("rm-mark-hover")).toBe(true);
    expect(() => (session as any).removeAnnotationDom(hostileId)).not.toThrow();
    expect(card.isConnected).toBe(false);
    expect(connector.isConnected).toBe(false);
    session.dispose();
  });
  it("enters degraded after probe timeout when host missing", async () => {
    const session = new ViewerSession({} as any, "test.pdf", makeStore(), { probeIntervalMs: 10, probeTimeoutMs: 40 });
    await session.attach();
    expect(session.state).toBe("degraded");
    session.dispose();
  });
  it("upgrades a legacy unknown fingerprint and renders its existing annotations", async () => {
    const { view, pages } = buildHostFixture({ fingerprint: "verified-fp", numPages: 1, marginWidthPx: 200 });
    const store = makeStore();
    const anchor = {
      kind: "pdf-text" as const, version: 1 as const, pageNumber: 1,
      quote: { exact: "legacy", normalization: "collapse-whitespace-v1" as const },
      geometry: { space: "page-css-v1" as const, pageWidth: 600, pageHeight: 800, rotation: 0 as const, rects: [{ x: 10, y: 10, width: 50, height: 14 }] },
    };
    const created = store.create("test.pdf", { markStyle: "highlight", colorId: "yellow", colorLabel: "Yellow", colorValue: "#fff15c", anchor }, { pdfFingerprint: "unknown", numPages: 1 });
    expect(created.ok).toBe(true);

    const session = new ViewerSession(view as any, "test.pdf", store);
    await session.attach();
    session.reconcilePage(1);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    expect(store.data.documents["test.pdf"].sourceSignature.pdfFingerprint).toBe("verified-fp");
    expect(pages[0].el.querySelector(".rm-mark")).toBeTruthy();
    session.dispose();
  });
  it("does not render annotations when sourceSignature mismatches (PDF replaced)", async () => {
    const { view, pages } = buildHostFixture({ fingerprint: "fp-a", numPages: 1, marginWidthPx: 200 });
    const store = makeStore();
    const anchor = {
      kind: "pdf-text" as const, version: 1 as const, pageNumber: 1,
      quote: { exact: "hi", normalization: "collapse-whitespace-v1" as const },
      geometry: { space: "page-css-v1" as const, pageWidth: 600, pageHeight: 800, rotation: 0 as const, rects: [{ x: 10, y: 10, width: 50, height: 14 }] },
    };
    store.create("test.pdf", { markStyle: "highlight", colorId: "yellow", colorLabel: "Yellow", colorValue: "#fff15c", anchor }, { pdfFingerprint: "fp-a", numPages: 1 });
    const session = new ViewerSession(view as any, "test.pdf", store);
    await session.attach();
    const nextFrame = () => new Promise<void>((r) => setTimeout(r, 20));

    session.reconcilePage(1);
    await nextFrame();
    expect(pages[0].el.querySelector(".rm-mark")).toBeTruthy();

    // PDF replaced at the same path with a different fingerprint
    (view as any).viewer.child.pdfViewer.pdfViewer.pdfDocument = { fingerprints: ["fp-b", null] };
    session.reconcilePage(1);
    await nextFrame();
    expect(pages[0].el.querySelector(".rm-mark")).toBeNull();
    session.dispose();
  });
  it("re-renders when the signature matches again (PDF swapped back)", async () => {
    const { view, pages } = buildHostFixture({ fingerprint: "fp-a", numPages: 1, marginWidthPx: 200 });
    const store = makeStore();
    const anchor = {
      kind: "pdf-text" as const, version: 1 as const, pageNumber: 1,
      quote: { exact: "hi", normalization: "collapse-whitespace-v1" as const },
      geometry: { space: "page-css-v1" as const, pageWidth: 600, pageHeight: 800, rotation: 0 as const, rects: [{ x: 10, y: 10, width: 50, height: 14 }] },
    };
    store.create("test.pdf", { markStyle: "highlight", colorId: "yellow", colorLabel: "Yellow", colorValue: "#fff15c", anchor }, { pdfFingerprint: "fp-a", numPages: 1 });
    const session = new ViewerSession(view as any, "test.pdf", store);
    await session.attach();
    const nextFrame = () => new Promise<void>((r) => setTimeout(r, 20));

    (view as any).viewer.child.pdfViewer.pdfViewer.pdfDocument = { fingerprints: ["fp-b", null] };
    session.reconcilePage(1);
    await nextFrame();
    expect(pages[0].el.querySelector(".rm-mark")).toBeNull();

    (view as any).viewer.child.pdfViewer.pdfViewer.pdfDocument = { fingerprints: ["fp-a", null] };
    session.reconcilePage(1);
    await nextFrame();
    expect(pages[0].el.querySelector(".rm-mark")).toBeTruthy();
    session.dispose();
  });
  it("renders a pinned card in its second-page band instead of clamping it to page one", async () => {
    const { view, pages, containerEl } = buildHostFixture({ fingerprint: "fp-a", numPages: 2, marginWidthPx: 200 });
    Object.defineProperties(containerEl, {
      offsetWidth: { value: 1000 },
    });
    Object.defineProperties(pages[1].el, {
      offsetTop: { value: 900 },
      offsetLeft: { value: 200 },
      offsetWidth: { value: 600 },
      offsetHeight: { value: 800 },
    });
    Object.defineProperty(containerEl, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800 } as DOMRect),
    });
    Object.defineProperty(pages[1].el, "getBoundingClientRect", {
      value: () => ({ left: 200, top: 900, width: 600, height: 800, right: 800, bottom: 1700 } as DOMRect),
    });
    const store = makeStore();
    const anchor = {
      kind: "pdf-text" as const, version: 1 as const, pageNumber: 2,
      quote: { exact: "page two", normalization: "collapse-whitespace-v1" as const },
      geometry: { space: "page-css-v1" as const, pageWidth: 600, pageHeight: 800, rotation: 0 as const, rects: [{ x: 10, y: 300, width: 50, height: 14 }] },
    };
    const created = store.create("test.pdf", { markStyle: "highlight", colorId: "yellow", colorLabel: "Yellow", colorValue: "#fff15c", anchor }, { pdfFingerprint: "fp-a", numPages: 2 });
    if (!created.ok) throw new Error(created.reason);
    store.update("test.pdf", created.annotation.id, { cardPosition: { space: "page-css-v1", y: 300 } }, created.annotation.revision);

    const session = new ViewerSession(view as any, "test.pdf", store);
    await session.attach();
    session.reconcilePage(2);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    const card = containerEl.querySelector<HTMLElement>(`.rm-card[data-annotation-id="${created.annotation.id}"]`);
    expect(card?.style.top).toBe("300px");
    expect(card?.closest<HTMLElement>(".rm-page-card-rail")?.style.top).toBe("900px");
    session.dispose();
  });
  it("moves a card horizontally inside the page margin and persists container-relative x", async () => {
    const { view, pages, containerEl } = buildHostFixture({ fingerprint: "fp-a", numPages: 1, marginWidthPx: 200 });
    Object.defineProperty(containerEl, "offsetWidth", { value: 1000 });
    Object.defineProperty(containerEl, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800 } as DOMRect),
    });
    Object.defineProperties(pages[0].el, {
      offsetWidth: { value: 400 },
      offsetHeight: { value: 800 },
    });
    Object.defineProperty(pages[0].el, "getBoundingClientRect", {
      value: () => ({ left: 300, top: 0, width: 400, height: 800, right: 700, bottom: 800 } as DOMRect),
    });
    const store = makeStore();
    const anchor = {
      kind: "pdf-text" as const, version: 1 as const, pageNumber: 1,
      quote: { exact: "drag me", normalization: "collapse-whitespace-v1" as const },
      geometry: { space: "page-css-v1" as const, pageWidth: 400, pageHeight: 800, rotation: 0 as const, rects: [{ x: 10, y: 100, width: 50, height: 14 }] },
    };
    const created = store.create("test.pdf", { markStyle: "highlight", colorId: "yellow", colorLabel: "Yellow", colorValue: "#fff15c", anchor }, { pdfFingerprint: "fp-a", numPages: 1 });
    if (!created.ok) throw new Error(created.reason);
    const session = new ViewerSession(view as any, "test.pdf", store);
    await session.attach();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    const card = containerEl.querySelector<HTMLElement>(`.rm-card[data-annotation-id="${created.annotation.id}"]`)!;
    const grip = card.querySelector<HTMLElement>(".rm-card-grip")!;
    Object.defineProperties(card, {
      offsetWidth: { value: 240 },
      offsetHeight: { value: 40 },
      getBoundingClientRect: {
        value: () => {
          const left = parseFloat(card.style.left) || 0;
          const top = parseFloat(card.style.top) || 0;
          return { left, top, width: 240, height: 40, right: left + 240, bottom: top + 40 } as DOMRect;
        },
      },
    });
    expect(card.style.left).toBe("12px");
    grip.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 20, clientY: 110 }));
    grip.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, button: 0, clientX: 50, clientY: 110 }));
    expect(card.style.left).toBe("42px");
    grip.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 50, clientY: 110 }));
    expect(store.byId("test.pdf", created.annotation.id)?.cardPosition?.x).toBe(42);
    session.dispose();
  });
  it("re-clamps a reloaded card only in the DOM while preserving its durable position", async () => {
    let persisted: unknown = null;
    const store = new DurableAnnotationStore(async (data) => { persisted = structuredClone(data); });
    store.loadAndValidate(null);
    const first = buildHostFixture({ fingerprint: "fp-a", numPages: 1, marginWidthPx: 200 });
    Object.defineProperty(first.containerEl, "offsetWidth", { value: 1000 });
    Object.defineProperty(first.containerEl, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800 } as DOMRect),
    });
    Object.defineProperties(first.pages[0].el, {
      offsetWidth: { value: 400 },
      offsetHeight: { value: 800 },
    });
    Object.defineProperty(first.pages[0].el, "getBoundingClientRect", {
      value: () => ({ left: 300, top: 0, width: 400, height: 800, right: 700, bottom: 800 } as DOMRect),
    });
    const anchor = {
      kind: "pdf-text" as const, version: 1 as const, pageNumber: 1,
      quote: { exact: "reload me", normalization: "collapse-whitespace-v1" as const },
      geometry: { space: "page-css-v1" as const, pageWidth: 400, pageHeight: 800, rotation: 0 as const, rects: [{ x: 10, y: 100, width: 50, height: 14 }] },
    };
    const created = store.create("test.pdf",
      { markStyle: "highlight", colorId: "yellow", colorLabel: "Yellow", colorValue: "#fff15c", anchor },
      { pdfFingerprint: "fp-a", numPages: 1 });
    if (!created.ok) throw new Error(created.reason);
    const firstSession = new ViewerSession(first.view as any, "test.pdf", store);
    let secondSession: ViewerSession | null = null;
    const offsetHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    try {
      await firstSession.attach();
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      const card = first.containerEl.querySelector<HTMLElement>(`.rm-card[data-annotation-id="${created.annotation.id}"]`)!;
      const grip = card.querySelector<HTMLElement>(".rm-card-grip")!;
      Object.defineProperties(card, {
        offsetWidth: { value: 240 },
        offsetHeight: { value: 40 },
        getBoundingClientRect: {
          value: () => {
            const left = parseFloat(card.style.left) || 0;
            const top = parseFloat(card.style.top) || 0;
            return { left, top, width: 240, height: 40, right: left + 240, bottom: top + 40 } as DOMRect;
          },
        },
      });
      grip.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 20, clientY: 110 }));
      grip.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, button: 0, clientX: 50, clientY: 900 }));
      grip.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 50, clientY: 900 }));
      await store.flushBestEffort();
      firstSession.dispose();

      const reloadSave = vi.fn(async () => {});
      const reloaded = new DurableAnnotationStore(reloadSave);
      expect(reloaded.loadAndValidate(persisted)).toBe("valid");
      expect(reloaded.byId("test.pdf", created.annotation.id)?.cardPosition).toEqual({ space: "page-css-v1", x: 42, y: 760 });

      const second = buildHostFixture({ fingerprint: "fp-a", numPages: 1, marginWidthPx: 200 });
      Object.defineProperty(second.containerEl, "offsetWidth", { value: 800 });
      Object.defineProperty(second.containerEl, "getBoundingClientRect", {
        value: () => ({ left: 0, top: 0, width: 800, height: 800, right: 800, bottom: 800 } as DOMRect),
      });
      Object.defineProperties(second.pages[0].el, {
        offsetWidth: { value: 400 },
        offsetHeight: { value: 800 },
      });
      Object.defineProperty(second.pages[0].el, "getBoundingClientRect", {
        value: () => ({ left: 200, top: 0, width: 400, height: 800, right: 600, bottom: 800 } as DOMRect),
      });
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get(this: HTMLElement) {
          if (this.classList?.contains("rm-card")) return 80;
          return offsetHeightDescriptor?.get?.call(this) ?? 0;
        },
      });

      secondSession = new ViewerSession(second.view as any, "test.pdf", reloaded);
      await secondSession.attach();
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      const reloadedCard = second.containerEl.querySelector<HTMLElement>(`.rm-card[data-annotation-id="${created.annotation.id}"]`)!;
      expect(reloadedCard.style.left).toBe("36px");
      expect(reloadedCard.style.top).toBe("720px");
      expect(reloaded.byId("test.pdf", created.annotation.id)?.cardPosition).toEqual({ space: "page-css-v1", x: 42, y: 760 });
      expect(reloadSave).not.toHaveBeenCalled();
    } finally {
      firstSession.dispose();
      secondSession?.dispose();
      if (offsetHeightDescriptor) Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeightDescriptor);
      else delete (HTMLElement.prototype as any).offsetHeight;
    }
  });
  it("does not render an annotation whose anchor cannot be resolved (H-03)", async () => {
    const { view, pages } = buildHostFixture({ fingerprint: "fp-a", numPages: 1, marginWidthPx: 200 });
    // Page dims no longer match the stored geometry -> geometry fallback fails;
    // no locator/quote either -> unresolved.
    Object.defineProperty(pages[0].el, "offsetWidth", { value: 300, configurable: true });
    const store = makeStore();
    const anchor = {
      kind: "pdf-text" as const, version: 1 as const, pageNumber: 1,
      quote: { exact: "hi", normalization: "collapse-whitespace-v1" as const },
      geometry: { space: "page-css-v1" as const, pageWidth: 600, pageHeight: 800, rotation: 0 as const, rects: [{ x: 10, y: 10, width: 50, height: 14 }] },
    };
    store.create("test.pdf", { markStyle: "highlight", colorId: "yellow", colorLabel: "Yellow", colorValue: "#fff15c", anchor }, { pdfFingerprint: "fp-a", numPages: 1 });
    const session = new ViewerSession(view as any, "test.pdf", store);
    await session.attach();
    const nextFrame = () => new Promise<void>((r) => setTimeout(r, 20));
    session.reconcilePage(1);
    await nextFrame();
    expect(pages[0].el.querySelector(".rm-mark")).toBeNull();
    session.dispose();
  });
  it("hit-tests the live resolved rectangles instead of stale stored geometry", async () => {
    const { view, pages, containerEl } = buildHostFixture({ fingerprint: "fp-a", numPages: 1, marginWidthPx: 200 });
    const item = document.createElement("span");
    item.className = "textLayerNode";
    item.dataset.idx = "0";
    item.textContent = "live quote";
    pages[0].textLayer.appendChild(item);
    const rectDescriptor = Object.getOwnPropertyDescriptor(Range.prototype, "getClientRects");
    Object.defineProperty(Range.prototype, "getClientRects", {
      value: () => [{ left: 100, top: 20, width: 60, height: 14 }], configurable: true,
    });
    const store = makeStore();
    const anchor = {
      kind: "pdf-text" as const, version: 1 as const, pageNumber: 1,
      quote: { exact: "live quote", normalization: "collapse-whitespace-v1" as const },
      geometry: { space: "page-css-v1" as const, pageWidth: 600, pageHeight: 800, rotation: 0 as const, rects: [{ x: 10, y: 20, width: 60, height: 14 }] },
    };
    const created = store.create("test.pdf", { markStyle: "highlight", colorId: "yellow", colorLabel: "Yellow", colorValue: "#fff15c", anchor }, { pdfFingerprint: "fp-a", numPages: 1 });
    if (!created.ok) throw new Error(created.reason);
    const session = new ViewerSession(view as any, "test.pdf", store);
    try {
      await session.attach();
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      const card = containerEl.querySelector<HTMLElement>(`.rm-card[data-annotation-id="${created.annotation.id}"]`)!;
      const click = (x: number, y: number) => {
        pages[0].el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: x, clientY: y }));
        pages[0].el.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: y }));
      };

      click(15, 25);
      expect(card.classList.contains("rm-card-linked")).toBe(false);
      click(105, 25);
      expect(card.classList.contains("rm-card-linked")).toBe(true);
      expect(pages[0].el.querySelector<HTMLElement>(`.rm-mark-group[data-annotation-id="${created.annotation.id}"] .rm-mark`)?.style.left).toBe("100px");
    } finally {
      session.dispose();
      if (rectDescriptor) Object.defineProperty(Range.prototype, "getClientRects", rectDescriptor);
      else delete (Range.prototype as any).getClientRects;
    }
  });
  it("fails closed on a placeholder page and counts repeated unresolved renders once", async () => {
    const { view, pages, containerEl } = buildHostFixture({ fingerprint: "fp-a", numPages: 1, marginWidthPx: 200 });
    pages[0].textLayer.remove();
    const store = makeStore();
    const anchor = {
      kind: "pdf-text" as const, version: 1 as const, pageNumber: 1,
      quote: { exact: "not ready", normalization: "collapse-whitespace-v1" as const },
      geometry: { space: "page-css-v1" as const, pageWidth: 600, pageHeight: 800, rotation: 0 as const, rects: [{ x: 10, y: 20, width: 60, height: 14 }] },
    };
    store.create("test.pdf", { markStyle: "highlight", colorId: "yellow", colorLabel: "Yellow", colorValue: "#fff15c", anchor }, { pdfFingerprint: "fp-a", numPages: 1 });
    const session = new ViewerSession(view as any, "test.pdf", store);
    await session.attach();
    session.reconcilePage(1);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    session.reconcilePage(1);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    expect(pages[0].el.querySelector(".rm-mark")).toBeNull();
    expect(containerEl.querySelector(".rm-card")).toBeNull();
    expect(containerEl.querySelector(".rm-connector")).toBeNull();
    expect(session.diagnosticsSnapshot().unresolvedAnchors).toBe(1);
    session.dispose();
  });
  it("clears page-scoped resolved anchors before rebuild, page detach, and dispose", async () => {
    const { view, pages } = buildHostFixture({ fingerprint: "fp-a", numPages: 1, marginWidthPx: 200 });
    const viewerEl = pages[0].el.parentElement!;
    const store = makeStore();
    const anchor = {
      kind: "pdf-text" as const, version: 1 as const, pageNumber: 1,
      quote: { exact: "geometry", normalization: "collapse-whitespace-v1" as const },
      geometry: { space: "page-css-v1" as const, pageWidth: 600, pageHeight: 800, rotation: 0 as const, rects: [{ x: 10, y: 20, width: 60, height: 14 }] },
    };
    store.create("test.pdf", { markStyle: "highlight", colorId: "yellow", colorLabel: "Yellow", colorValue: "#fff15c", anchor }, { pdfFingerprint: "fp-a", numPages: 1 });
    const session = new ViewerSession(view as any, "test.pdf", store);
    await session.attach();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect((session as any).resolvedAnchors.hitEntries(0, 1)).toHaveLength(1);

    pages[0].el.remove();
    session.reconcilePage(1);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect((session as any).resolvedAnchors.hitEntries(0, 1)).toEqual([]);

    viewerEl.appendChild(pages[0].el);
    session.reconcilePage(1);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect((session as any).resolvedAnchors.hitEntries(0, 1)).toHaveLength(1);
    session.dispose();
    expect((session as any).resolvedAnchors.hitEntries(0, 1)).toEqual([]);
  });
  it("resolves marks in narrow mode and removes stale cards and connectors", async () => {
    const { view, pages, containerEl } = buildHostFixture({ fingerprint: "fp-a", numPages: 1, marginWidthPx: 200 });
    Object.defineProperty(containerEl, "offsetWidth", { value: 1000, configurable: true });
    const store = makeStore();
    const anchor = {
      kind: "pdf-text" as const, version: 1 as const, pageNumber: 1,
      quote: { exact: "narrow geometry", normalization: "collapse-whitespace-v1" as const },
      geometry: { space: "page-css-v1" as const, pageWidth: 600, pageHeight: 800, rotation: 0 as const, rects: [{ x: 10, y: 20, width: 60, height: 14 }] },
    };
    const created = store.create("test.pdf", { markStyle: "highlight", colorId: "yellow", colorLabel: "Yellow", colorValue: "#fff15c", anchor }, { pdfFingerprint: "fp-a", numPages: 1 });
    if (!created.ok) throw new Error(created.reason);
    const session = new ViewerSession(view as any, "test.pdf", store);
    await session.attach();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(containerEl.querySelector(`.rm-card[data-annotation-id="${created.annotation.id}"]`)).not.toBeNull();
    expect(containerEl.querySelector(`g.rm-connector[data-annotation-id="${created.annotation.id}"]`)).not.toBeNull();

    Object.defineProperty(containerEl, "offsetWidth", { value: 800, configurable: true });
    session.reconcilePage(1);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    expect(containerEl.querySelector(`.rm-card[data-annotation-id="${created.annotation.id}"]`)).toBeNull();
    expect(containerEl.querySelector(`g.rm-connector[data-annotation-id="${created.annotation.id}"]`)).toBeNull();
    expect(pages[0].el.querySelector(`.rm-mark-group[data-annotation-id="${created.annotation.id}"]`)).not.toBeNull();
    session.dispose();
  });
  it("enters degraded when eventBus is missing (fail closed, H-07)", async () => {
    const { view } = buildHostFixture({ numPages: 1, marginWidthPx: 200 });
    delete (view as any).viewer.child.pdfViewer.eventBus;
    const session = new ViewerSession(view as any, "test.pdf", makeStore());
    await session.attach();
    expect(session.state).toBe("degraded");
    session.dispose();
  });
  it("lets the delete exit-fade play through the immediate reconcile and self-remove on animationend (MEDIUM-1)", async () => {
    const { view, containerEl } = buildHostFixture({ fingerprint: "fp-a", numPages: 1, marginWidthPx: 200 });
    const store = makeStore();
    const anchor = {
      kind: "pdf-text" as const, version: 1 as const, pageNumber: 1,
      quote: { exact: "exit fade", normalization: "collapse-whitespace-v1" as const },
      geometry: { space: "page-css-v1" as const, pageWidth: 600, pageHeight: 800, rotation: 0 as const, rects: [{ x: 10, y: 10, width: 50, height: 14 }] },
    };
    const created = store.create("test.pdf", { markStyle: "highlight", colorId: "yellow", colorLabel: "Yellow", colorValue: "#fff15c", anchor }, { pdfFingerprint: "fp-a", numPages: 1 });
    if (!created.ok) throw new Error(created.reason);
    const session = new ViewerSession(view as any, "test.pdf", store);
    await session.attach();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    const id = created.annotation.id;
    expect(containerEl.querySelector(`.rm-card[data-annotation-id="${id}"]`)).not.toBeNull();

    // store.delete fires onChange synchronously: removeAnnotationDom({animate})
    // adds the exit class AND reconcilePage schedules a rebuild rAF. The rebuild
    // must not tear down the exiting card (or its rail) before the fade paints.
    store.delete("test.pdf", id);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    const exiting = containerEl.querySelector<HTMLElement>(`.rm-card[data-annotation-id="${id}"]`);
    expect(exiting).not.toBeNull();
    expect(exiting!.classList.contains("rm-card-exit")).toBe(true);

    // The exit card self-removes on animationend; its now-empty rail is pruned.
    exiting!.dispatchEvent(new Event("animationend"));
    expect(containerEl.querySelector(`.rm-card[data-annotation-id="${id}"]`)).toBeNull();
    session.dispose();
  });
  it("preserves a deleting card on one side while the page rebuilds around a remaining card on the other side (MEDIUM-1)", async () => {
    const { view, containerEl } = buildHostFixture({ fingerprint: "fp-a", numPages: 1, marginWidthPx: 200 });
    const store = makeStore();
    const leftAnchor = {
      kind: "pdf-text" as const, version: 1 as const, pageNumber: 1,
      quote: { exact: "left side", normalization: "collapse-whitespace-v1" as const },
      geometry: { space: "page-css-v1" as const, pageWidth: 600, pageHeight: 800, rotation: 0 as const, rects: [{ x: 10, y: 10, width: 50, height: 14 }] },
    };
    const rightAnchor = {
      kind: "pdf-text" as const, version: 1 as const, pageNumber: 1,
      quote: { exact: "right side", normalization: "collapse-whitespace-v1" as const },
      geometry: { space: "page-css-v1" as const, pageWidth: 600, pageHeight: 800, rotation: 0 as const, rects: [{ x: 400, y: 10, width: 50, height: 14 }] },
    };
    const left = store.create("test.pdf", { markStyle: "highlight", colorId: "yellow", colorLabel: "Yellow", colorValue: "#fff15c", anchor: leftAnchor }, { pdfFingerprint: "fp-a", numPages: 1 });
    const right = store.create("test.pdf", { markStyle: "highlight", colorId: "yellow", colorLabel: "Yellow", colorValue: "#fff15c", anchor: rightAnchor }, { pdfFingerprint: "fp-a", numPages: 1 });
    if (!left.ok || !right.ok) throw new Error("create failed");
    const session = new ViewerSession(view as any, "test.pdf", store);
    await session.attach();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    // Deleting the left card leaves only the right card. prunePage would remove
    // the (now childless) left rail - it must spare the exiting left card.
    store.delete("test.pdf", left.annotation.id);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    const exiting = containerEl.querySelector<HTMLElement>(`.rm-card[data-annotation-id="${left.annotation.id}"]`);
    expect(exiting).not.toBeNull();
    expect(exiting!.classList.contains("rm-card-exit")).toBe(true);
    // The remaining right card is rebuilt normally.
    expect(containerEl.querySelector(`.rm-card[data-annotation-id="${right.annotation.id}"]`)).not.toBeNull();

    exiting!.dispatchEvent(new Event("animationend"));
    expect(containerEl.querySelector(`.rm-card[data-annotation-id="${left.annotation.id}"]`)).toBeNull();
    session.dispose();
  });
  it("surfaces a notice when a dispose-time draft commit hits a revision conflict (LOW-5)", async () => {
    const { view } = buildHostFixture({ fingerprint: "fp-a", numPages: 1, marginWidthPx: 200 });
    const store = makeStore();
    const anchor = {
      kind: "pdf-text" as const, version: 1 as const, pageNumber: 1,
      quote: { exact: "draft conflict", normalization: "collapse-whitespace-v1" as const },
      geometry: { space: "page-css-v1" as const, pageWidth: 600, pageHeight: 800, rotation: 0 as const, rects: [{ x: 10, y: 10, width: 50, height: 14 }] },
    };
    const created = store.create("test.pdf", { markStyle: "highlight", colorId: "yellow", colorLabel: "Yellow", colorValue: "#fff15c", anchor }, { pdfFingerprint: "fp-a", numPages: 1 });
    if (!created.ok) throw new Error(created.reason);
    const session = new ViewerSession(view as any, "test.pdf", store);
    await session.attach();
    const id = created.annotation.id;
    const baseRevision = created.annotation.revision;
    (session as any).draft.begin(id, baseRevision, "unsaved draft text");
    // Another view saves the same annotation, bumping its revision past the draft base.
    const other = store.update("test.pdf", id, { comment: "saved elsewhere" }, baseRevision);
    expect(other.ok).toBe(true);

    const noticeCalls: string[] = [];
    const RealNotice = obsidian.Notice;
    Object.defineProperty(obsidian, "Notice", {
      configurable: true,
      value: function (this: unknown, msg: string, _d?: number) { noticeCalls.push(String(msg)); },
    });
    try {
      session.dispose();
      expect(noticeCalls.some((m) => /draft could not be saved/i.test(m))).toBe(true);
    } finally {
      Object.defineProperty(obsidian, "Notice", { configurable: true, value: RealNotice });
    }
  });
  it("enters edit mode only for the explicit 'annotate' variants (highlight and underline parity)", async () => {
    const setup = setupWithSelection();
    const { session, store, setSelection } = setup;
    await session.attach();
    try {
      // Plain highlight: no edit mode.
      setSelection();
      let r = session.createAnnotation("highlight", { annotate: false });
      expect(r.ok).toBe(true);
      expect((session as any).editingId).toBeNull();

      // Highlight & annotate: enters edit mode.
      setSelection();
      r = session.createAnnotation("highlight", { annotate: true });
      expect(r.ok).toBe(true);
      expect((session as any).editingId).toBe((r as any).annotation.id);
      (session as any).editingId = null;

      // Plain underline: no edit mode (was auto-edit before - now consistent).
      setSelection();
      r = session.createAnnotation("underline", { annotate: false });
      expect(r.ok).toBe(true);
      expect((session as any).editingId).toBeNull();

      // Underline & annotate: enters edit mode.
      setSelection();
      r = session.createAnnotation("underline", { annotate: true });
      expect(r.ok).toBe(true);
      expect((session as any).editingId).toBe((r as any).annotation.id);

      expect(store.byPath("test.pdf")).toHaveLength(4);
    } finally {
      session.dispose();
    }
  });
  it("uses the toolbar-active color for highlight/underline and updates it via setActiveColor", async () => {
    const setup = setupWithSelection();
    const { session, store, setSelection } = setup;
    await session.attach();
    try {
      // Default active color is the settings default (yellow).
      expect(session.getActiveColorId()).toBe("yellow");

      setSelection();
      let r = session.createAnnotation("highlight");
      expect(r.ok).toBe(true);
      expect((r as any).annotation.colorIdSnapshot).toBe("yellow");

      // Select blue via the toolbar; subsequent marks use it.
      session.setActiveColor("blue");
      expect(session.getActiveColorId()).toBe("blue");

      setSelection();
      r = session.createAnnotation("underline", { annotate: false });
      expect(r.ok).toBe(true);
      expect((r as any).annotation.colorIdSnapshot).toBe("blue");

      // Unknown color id is ignored.
      session.setActiveColor("does-not-exist");
      expect(session.getActiveColorId()).toBe("blue");
    } finally {
      session.dispose();
    }
  });
  it("commitActiveEdit saves the open edit box (Save annotation command path)", async () => {
    const setup = setupWithSelection();
    const { session, store, setSelection } = setup;
    await session.attach();
    try {
      // No active edit -> command unavailable.
      expect(session.hasActiveEdit()).toBe(false);
      expect(session.commitActiveEdit().ok).toBe(false);

      setSelection();
      const r = session.createAnnotation("highlight", { annotate: true });
      if (!r.ok) throw new Error(r.reason);
      expect(session.hasActiveEdit()).toBe(true);
      (session as any).draft.update(r.annotation.id, "typed note");

      const save = session.commitActiveEdit();
      expect(save.ok).toBe(true);
      expect(session.hasActiveEdit()).toBe(false);
      expect(store.byId("test.pdf", r.annotation.id)?.comment).toBe("typed note");

      // Idempotent: if the textarea's Ctrl+Enter also reaches commitComment
      // after the command already saved, it must not bump the revision again.
      const revisionBefore = store.data.stateRevision;
      const again = (session as any).commitComment(r.annotation.id, "typed note");
      expect(again.ok).toBe(true);
      expect(store.data.stateRevision).toBe(revisionBefore);
    } finally {
      session.dispose();
    }
  });
  it("respects autoOpenEdit: annotate actions skip the edit box when the setting is off", async () => {
    const setup = setupWithSelection();
    const { session, store, setSelection } = setup;
    store.data.settings.autoOpenEdit = false;
    await session.attach();
    try {
      setSelection();
      const r = session.createAnnotation("highlight", { annotate: true });
      expect(r.ok).toBe(true);
      // Auto-open suppressed by the setting; the mark is still created.
      expect((session as any).editingId).toBeNull();
      expect(store.byPath("test.pdf")).toHaveLength(1);
    } finally {
      session.dispose();
    }
  });
  it("right-click with a selection shows highlight / highlight&annotate / underline / underline&annotate; no menu without a selection", async () => {
    const setup = setupWithSelection();
    const { pages, session, setSelection } = setup;
    const viewerEl = pages[0].el.parentElement!;
    await session.attach();
    const shown: obsidian.Menu[] = [];
    const spy = vi.spyOn(obsidian.Menu.prototype, "showAtMouseEvent").mockImplementation(function (this: obsidian.Menu) { shown.push(this); return this; });
    try {
      // No selection -> no menu (host context menu left intact).
      viewerEl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      expect(shown).toHaveLength(0);

      // With a selection -> 4-item menu in the documented order.
      setSelection();
      const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      viewerEl.dispatchEvent(ev);
      expect(shown).toHaveLength(1);
      const MenuHelper = obsidian.Menu as any;
      expect(MenuHelper.titles(shown[0])).toEqual([
        "Highlight", "Highlight & annotate", "Underline", "Underline & annotate",
      ]);
      expect(ev.defaultPrevented).toBe(true);

      // Invoking "Highlight & annotate" creates a highlight and enters edit mode.
      MenuHelper.invoke(shown[0], 1);
      const anns = (session as any).store.byPath("test.pdf");
      expect(anns).toHaveLength(1);
      expect(anns[0].markStyle).toBe("highlight");
      expect((session as any).editingId).toBe(anns[0].id);
    } finally {
      spy.mockRestore();
      session.dispose();
    }
  });
});