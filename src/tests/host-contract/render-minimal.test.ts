// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildHostFixture } from "src/tests/host-contract/host-shape-fixture";
import { drawEphemeralMark, clearMarks } from "src/render/mark-renderer";
import { drawEphemeralCard } from "src/render/annotation-card-rail";
import { drawEphemeralConnector } from "src/render/connector-renderer";

describe("ephemeral render (M-1 tracer)", () => {
  it("draws a highlight mark layer with one rect", () => {
    const { pages } = buildHostFixture({ scale: 1 });
    const pageEl = pages[0].el;
    Object.defineProperty(pageEl, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 600, height: 800, right: 600, bottom: 800 } as DOMRect),
    });
    drawEphemeralMark(pageEl, [{ x: 10, y: 20, width: 80, height: 12 }], "#fff15c", "highlight", 1);
    const layer = pageEl.querySelector(".rm-mark-layer");
    expect(layer).toBeTruthy();
    const mark = layer!.querySelector(".rm-mark") as HTMLElement;
    expect(mark.style.background).toMatch(/#fff15c|rgb\(255,\s*241,\s*92\)/i);
    expect(mark.style.left).toBe("10px");
  });
  it("underline draws a 2px bar at rect bottom", () => {
    const { pages } = buildHostFixture({});
    const pageEl = pages[0].el;
    drawEphemeralMark(pageEl, [{ x: 5, y: 30, width: 40, height: 14 }], "#5cc8ff", "underline", 1);
    const mark = pageEl.querySelector(".rm-mark") as HTMLElement;
    expect(parseFloat(mark.style.height)).toBe(2);
    expect(parseFloat(mark.style.top)).toBe(30 + 14 - 2);
  });
  it("groups one annotation's rects under a single opacity so overlaps don't stack", () => {
    const { pages } = buildHostFixture({});
    const pageEl = pages[0].el;
    drawEphemeralMark(pageEl, [
      { x: 0, y: 100, width: 100, height: 22 },
      { x: 0, y: 120, width: 100, height: 22 },
    ], "#fff15c", "highlight", 1);
    const group = pageEl.querySelector(".rm-mark-group") as HTMLElement;
    expect(group).toBeTruthy();
    expect(group.style.opacity).toBe("0.35");
    const marks = group.querySelectorAll(".rm-mark");
    expect(marks).toHaveLength(2);
    // opacity lives on the group, not on each mark (so siblings don't alpha-composite)
    expect((marks[0] as HTMLElement).style.opacity).toBe("");
  });
  it("clearMarks removes the mark layer", () => {
    const { pages } = buildHostFixture({});
    drawEphemeralMark(pages[0].el, [{ x: 1, y: 1, width: 2, height: 2 }], "#fff15c", "highlight", 1);
    clearMarks(pages[0].el);
    expect(pages[0].el.querySelector(".rm-mark-layer")).toBeNull();
  });
  it("clearMarks removes every stray mark layer (no duplicate marks)", () => {
    const { pages } = buildHostFixture({});
    const pageEl = pages[0].el;
    // Simulate stray layers left behind by a rebuilt page.
    for (let i = 0; i < 2; i++) {
      const stray = pageEl.ownerDocument.createElement("div");
      stray.className = "rm-mark-layer";
      stray.appendChild(pageEl.ownerDocument.createElement("div"));
      pageEl.appendChild(stray);
    }
    expect(pageEl.querySelectorAll(".rm-mark-layer")).toHaveLength(2);
    clearMarks(pageEl);
    expect(pageEl.querySelectorAll(".rm-mark-layer")).toHaveLength(0);
  });
  it("draws a card on the right rail with a color strip", () => {
    const { containerEl, pages } = buildHostFixture({ marginWidthPx: 200 });
    drawEphemeralCard(containerEl, pages[0].el, { side: "right", text: "hello", color: "#fff15c", anchorY: 20 });
    const card = containerEl.querySelector(".rm-card") as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.textContent).toContain("hello");
    const strip = card.querySelector(".rm-card-strip") as HTMLElement;
    expect(strip.style.background).toMatch(/#fff15c|rgb\(255,\s*241,\s*92\)/i);
  });
  it("draws an SVG connector with one path", () => {
    const { containerEl, pages } = buildHostFixture({});
    drawEphemeralConnector(containerEl, { x1: 0, y1: 10, x2: 100, y2: 10, color: "#fff15c" });
    const svg = containerEl.querySelector(".rm-connector-layer");
    expect(svg?.querySelector("path")).toBeTruthy();
  });
});
