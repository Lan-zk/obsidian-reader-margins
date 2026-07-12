// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { buildHostFixture } from "src/tests/host-contract/host-shape-fixture";
import { SelectionSnapshotController } from "src/session/selection-snapshot-controller";

function fakeRange(rects: DOMRect[]): Range {
  const r = { getClientRects: () => rects, collapsed: false } as unknown as Range;
  return r;
}

describe("SelectionSnapshotController", () => {
  it("captures a valid single-page selection", () => {
    const { pages } = buildHostFixture({ numPages: 1 });
    const win = window as Window & typeof globalThis;
    const sel = {
      rangeCount: 1, isCollapsed: false,
      getRangeAt: () => fakeRange([{ left: 10, top: 20, width: 80, height: 12, right: 90, bottom: 32 } as DOMRect]),
      toString: () => "hello world",
      anchorNode: pages[0].textLayer, focusNode: pages[0].textLayer,
    } as unknown as Selection;
    vi.spyOn(win, "getSelection").mockReturnValue(sel);
    const ctrl = new SelectionSnapshotController();
    const snap = ctrl.capture("s1", win, pages[0].el);
    expect(snap).not.toBeNull();
    expect(snap!.selectedText).toBe("hello world");
    expect(snap!.pageNumber).toBe(1);
    expect(snap!.clientRects).toHaveLength(1);
  });
  it("rejects collapsed selection", () => {
    const { pages } = buildHostFixture({});
    const win = window as Window & typeof globalThis;
    const sel = { rangeCount: 1, isCollapsed: true, getRangeAt: () => fakeRange([]) } as unknown as Selection;
    vi.spyOn(win, "getSelection").mockReturnValue(sel);
    const ctrl = new SelectionSnapshotController();
    expect(ctrl.capture("s1", win, pages[0].el)).toBeNull();
  });
  it("rejects blank/whitespace text", () => {
    const { pages } = buildHostFixture({});
    const win = window as Window & typeof globalThis;
    const sel = {
      rangeCount: 1, isCollapsed: false,
      getRangeAt: () => fakeRange([{ left: 0, top: 0, width: 10, height: 10, right: 10, bottom: 10 } as DOMRect]),
      toString: () => "   \n\t  ",
      anchorNode: pages[0].textLayer, focusNode: pages[0].textLayer,
    } as unknown as Selection;
    vi.spyOn(win, "getSelection").mockReturnValue(sel);
    const ctrl = new SelectionSnapshotController();
    expect(ctrl.capture("s1", win, pages[0].el)).toBeNull();
  });
  it("rejects selection outside the viewer's text layer", () => {
    const { pages } = buildHostFixture({});
    const win = window as Window & typeof globalThis;
    const other = document.createElement("div");
    const sel = {
      rangeCount: 1, isCollapsed: false,
      getRangeAt: () => fakeRange([{ left: 0, top: 0, width: 10, height: 10, right: 10, bottom: 10 } as DOMRect]),
      toString: () => "x", anchorNode: other, focusNode: other,
    } as unknown as Selection;
    vi.spyOn(win, "getSelection").mockReturnValue(sel);
    const ctrl = new SelectionSnapshotController();
    expect(ctrl.capture("s1", win, pages[0].el)).toBeNull();
  });
});
