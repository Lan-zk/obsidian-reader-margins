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
    (view as any).viewer.child.pdfViewer.pdfViewer.pdfDocument = { fingerprint: "fp-b" };
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

    (view as any).viewer.child.pdfViewer.pdfViewer.pdfDocument = { fingerprint: "fp-b" };
    session.reconcilePage(1);
    await nextFrame();
    expect(pages[0].el.querySelector(".rm-mark")).toBeNull();

    (view as any).viewer.child.pdfViewer.pdfViewer.pdfDocument = { fingerprint: "fp-a" };
    session.reconcilePage(1);
    await nextFrame();
    expect(pages[0].el.querySelector(".rm-mark")).toBeTruthy();
    session.dispose();
  });
});
