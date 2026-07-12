// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildHostFixture, makeFakeEventBus } from "src/tests/host-contract/host-shape-fixture";

describe("host shape fixture", () => {
  it("builds the spec §7.2 object graph", () => {
    const { view } = buildHostFixture({ numPages: 2, scale: 1.5 });
    expect(view.viewer.child.pdfViewer.pdfViewer.currentScale).toBe(1.5);
    expect(view.viewer.child.pdfViewer.dom.viewerContainerEl).toBeTruthy();
  });
  it("fake event bus dispatches to registered handlers", () => {
    const bus = makeFakeEventBus();
    let got: unknown = null;
    bus.on("textlayerrendered", (e) => { got = e; });
    bus.dispatch("textlayerrendered", { pageNumber: 1 });
    expect(got).toEqual({ pageNumber: 1 });
  });
  it("pages carry data-page-number", () => {
    const { pages } = buildHostFixture({ numPages: 3 });
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);
  });
});
