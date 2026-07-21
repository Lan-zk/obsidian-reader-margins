// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { captureAnchor } from "src/domain/anchor-resolver";
import type { SelectionSnapshot } from "src/session/selection-snapshot-controller";

function snap(rects: { left: number; top: number; width: number; height: number }[], text = "hello"): SelectionSnapshot {
  const domRects = rects.map((r) => ({ ...r, right: r.left + r.width, bottom: r.top + r.height, toJSON: () => {} }));
  return {
    sessionId: "s1", win: window as unknown as Window, pageNumber: 1, selectedText: text,
    range: {} as Range, clientRects: domRects as unknown as DOMRectReadOnly[], capturedAt: Date.now(),
  };
}

describe("captureAnchor", () => {
  it("normalizes rects to scale=1 page-css coordinates", () => {
    const pageEl = document.createElement("div");
    Object.defineProperty(pageEl, "getBoundingClientRect", {
      value: () => ({ left: 1000, top: 2000, width: 600, height: 800, right: 1600, bottom: 2800 } as DOMRect),
    });
    const a = captureAnchor(snap([{ left: 1050, top: 2020, width: 80, height: 12 }]), pageEl, 2, { pageWidth: 600, pageHeight: 800, rotation: 0 });
    expect(a).not.toBeNull();
    expect(a!.geometry.rects[0].x).toBe(25);   // (1050-1000)/2
    expect(a!.geometry.rects[0].y).toBe(10);   // (2020-2000)/2
    expect(a!.geometry.rects[0].width).toBe(40);
    expect(a!.quote.exact).toBe("hello");
    expect(a!.geometry.space).toBe("page-css-v1");
    expect(a!.geometry.rotation).toBe(0);
  });
  it("returns null when all rects are zero-size after cleaning", () => {
    const pageEl = document.createElement("div");
    Object.defineProperty(pageEl, "getBoundingClientRect", { value: () => ({ left: 0, top: 0, width: 600, height: 800, right: 600, bottom: 800 } as DOMRect) });
    expect(captureAnchor(snap([{ left: 0, top: 0, width: 0, height: 0 }]), pageEl, 1, { pageWidth: 600, pageHeight: 800, rotation: 0 })).toBeNull();
  });
  it("stores prefix/suffix context when provided", () => {
    const pageEl = document.createElement("div");
    Object.defineProperty(pageEl, "getBoundingClientRect", { value: () => ({ left: 0, top: 0, width: 600, height: 800, right: 600, bottom: 800 } as DOMRect) });
    const a = captureAnchor(snap([{ left: 0, top: 0, width: 10, height: 10 }]), pageEl, 1, { pageWidth: 600, pageHeight: 800, rotation: 0 }, { prefix: "pre ", suffix: " post" });
    expect(a!.quote.prefix).toBe("pre ");
    expect(a!.quote.suffix).toBe(" post");
  });
  it("derives context from the selected repeated phrase instead of the first text match", () => {
    const pageEl = document.createElement("div");
    const textLayer = document.createElement("div");
    const text = document.createTextNode("A repeat B repeat C");
    textLayer.className = "textLayer";
    textLayer.appendChild(text);
    pageEl.appendChild(textLayer);
    Object.defineProperty(pageEl, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 600, height: 800, right: 600, bottom: 800 } as DOMRect),
    });
    const range = document.createRange();
    range.setStart(text, 11);
    range.setEnd(text, 17);
    const selected = snap([{ left: 10, top: 10, width: 40, height: 12 }], "repeat");
    selected.range = range;

    const a = captureAnchor(selected, pageEl, 1, { pageWidth: 600, pageHeight: 800, rotation: 0 }, { textLayer });

    expect(a?.quote.prefix).toBe("A repeat B");
    expect(a?.quote.suffix).toBe("C");
  });
});
