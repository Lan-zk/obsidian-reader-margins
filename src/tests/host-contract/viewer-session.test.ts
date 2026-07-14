// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { buildHostFixture } from "src/tests/host-contract/host-shape-fixture";
import { ViewerSession } from "src/session/viewer-session";
import { DurableAnnotationStore } from "src/store/durable-annotation-store";

function makeStore() {
  const s = new DurableAnnotationStore(async () => {});
  s.loadAndValidate(null);
  return s;
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
  it("enters degraded after probe timeout when host missing", async () => {
    const session = new ViewerSession({} as any, "test.pdf", makeStore(), { probeIntervalMs: 10, probeTimeoutMs: 40 });
    await session.attach();
    expect(session.state).toBe("degraded");
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
    expect(card?.style.top).toBe("1200px");
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
});
