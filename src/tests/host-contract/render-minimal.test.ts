// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { buildHostFixture } from "src/tests/host-contract/host-shape-fixture";
import { drawEphemeralMark, clearMarks } from "src/render/mark-renderer";
import { drawEphemeralCard } from "src/render/annotation-card-rail";
import { drawEphemeralConnector } from "src/render/connector-renderer";
import { PageCardRailRegistry } from "src/render/page-card-rail";
import { setMarkHover } from "src/render/mark-renderer";
import { clearPageConnectors } from "src/render/connector-renderer";

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
  it("underline draws a 2.5px bar with its bottom edge flush to the rect", () => {
    const { pages } = buildHostFixture({});
    const pageEl = pages[0].el;
    drawEphemeralMark(pageEl, [{ x: 5, y: 30, width: 40, height: 14 }], "#5cc8ff", "underline", 1);
    const mark = pageEl.querySelector(".rm-mark") as HTMLElement;
    expect(mark.classList.contains("rm-mark-underline")).toBe(true);
    expect(parseFloat(mark.style.height)).toBe(2.5);
    expect(parseFloat(mark.style.top)).toBe(30 + 14 - 2.5);
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
    expect(group.style.opacity).toBe("0.42");
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

  it("treats hostile annotation ids as exact dataset values without selector parsing", () => {
    const { containerEl, pages } = buildHostFixture({});
    const hostileId = `quote\"] .rm-card, [data-any="x`;
    drawEphemeralCard(containerEl, pages[0].el, { side: "right", text: "one", color: "#fff15c", anchorY: 20, id: hostileId });
    drawEphemeralCard(containerEl, pages[0].el, { side: "right", text: "two", color: "#fff15c", anchorY: 30, id: hostileId });
    drawEphemeralConnector(containerEl, { x1: 0, y1: 10, x2: 100, y2: 10, color: "#fff15c", id: hostileId });
    drawEphemeralConnector(containerEl, { x1: 0, y1: 20, x2: 100, y2: 20, color: "#fff15c", id: hostileId });
    drawEphemeralMark(pages[0].el, [{ x: 1, y: 2, width: 3, height: 4 }], "#fff15c", "highlight", 1, hostileId);

    expect([...containerEl.querySelectorAll<HTMLElement>(".rm-card")].filter((node) => node.dataset.annotationId === hostileId)).toHaveLength(1);
    expect([...containerEl.querySelectorAll<SVGGElement>("g.rm-connector")].filter((node) => node.dataset.annotationId === hostileId)).toHaveLength(1);
    expect(() => setMarkHover(pages[0].el, hostileId, true)).not.toThrow();
    expect(pages[0].el.querySelector(".rm-mark-group")?.classList.contains("rm-mark-hover")).toBe(true);
  });
  it("stitch intro degrades gracefully when getTotalLength is unavailable (jsdom)", () => {
    const { containerEl } = buildHostFixture({});
    drawEphemeralConnector(containerEl, { x1: 0, y1: 10, x2: 100, y2: 10, color: "#fff15c", stitching: true });
    const path = containerEl.querySelector(".rm-connector-layer path")!;
    // No crash, path drawn, intro class skipped (jsdom has no getTotalLength).
    expect(path.classList.contains("rm-connector-stitch")).toBe(false);
  });
  it("removes the stitch class when its one-shot animation finishes", () => {
    const { containerEl } = buildHostFixture({});
    (SVGElement.prototype as any).getTotalLength = () => 100;
    drawEphemeralConnector(containerEl, { x1: 0, y1: 10, x2: 100, y2: 10, color: "#fff15c", stitching: true });
    const path = containerEl.querySelector<SVGPathElement>(".rm-connector-layer path")!;
    expect(path.classList.contains("rm-connector-stitch")).toBe(true);
    path.dispatchEvent(new Event("animationend"));
    expect(path.classList.contains("rm-connector-stitch")).toBe(false);
    delete (SVGElement.prototype as any).getTotalLength;
  });
  it("clears the stitch class if animationend is lost", () => {
    vi.useFakeTimers();
    try {
      const { containerEl } = buildHostFixture({});
      (SVGElement.prototype as any).getTotalLength = () => 100;
      drawEphemeralConnector(containerEl, { x1: 0, y1: 10, x2: 100, y2: 10, color: "#fff15c", stitching: true });
      const path = containerEl.querySelector<SVGPathElement>(".rm-connector-layer path")!;
      expect(path.classList.contains("rm-connector-stitch")).toBe(true);
      vi.advanceTimersByTime(1_000);
      expect(path.classList.contains("rm-connector-stitch")).toBe(false);
    } finally {
      delete (SVGElement.prototype as any).getTotalLength;
      vi.useRealTimers();
    }
  });
  it("connector carries a card-end attachment dot", () => {
    const { containerEl } = buildHostFixture({});
    drawEphemeralConnector(containerEl, { x1: 0, y1: 10, x2: 100, y2: 10, color: "#fff15c" });
    expect(containerEl.querySelectorAll(".rm-connector-layer circle")).toHaveLength(2);
    expect(containerEl.querySelector(".rm-connector-end")).toBeTruthy();
  });
  it("mark group carries the annotation id and style modifier for hover lift", () => {
    const { pages } = buildHostFixture({});
    drawEphemeralMark(pages[0].el, [{ x: 1, y: 1, width: 20, height: 10 }], "#fff15c", "highlight", 1, "ann-1");
    const group = pages[0].el.querySelector(".rm-mark-group") as HTMLElement;
    expect(group.dataset.annotationId).toBe("ann-1");
    expect(group.classList.contains("rm-mark-group-highlight")).toBe(true);
  });
  it("owns one rail viewport per page and side and preserves scroll for the same page element", () => {
    const { containerEl, pages } = buildHostFixture({ numPages: 2 });
    const registry = new PageCardRailRegistry(containerEl, 7, vi.fn());
    const first = registry.ensure({
      pageNumber: 1, pageEl: pages[0].el, side: "left",
      top: 10, height: 800, left: 0, width: 200,
    });
    const second = registry.ensure({
      pageNumber: 2, pageEl: pages[1].el, side: "left",
      top: 900, height: 800, left: 0, width: 200,
    });
    first.element.scrollTop = 64;
    expect(registry.ensure({
      pageNumber: 1, pageEl: pages[0].el, side: "left",
      top: 12, height: 780, left: 0, width: 220,
    }).element.scrollTop).toBe(64);
    expect(first.element).not.toBe(second.element);
    expect(containerEl.querySelectorAll(".rm-page-card-rail")).toHaveLength(2);

    const replacement = pages[0].el.cloneNode(true) as HTMLElement;
    pages[0].el.replaceWith(replacement);
    const replaced = registry.ensure({
      pageNumber: 1, pageEl: replacement, side: "left",
      top: 12, height: 780, left: 0, width: 220,
    });
    expect(replaced.element).not.toBe(first.element);
    expect(replaced.element.scrollTop).toBe(0);
    registry.dispose();
  });
  it("converts durable container x at the rail boundary", () => {
    const { containerEl, pages } = buildHostFixture({});
    const registry = new PageCardRailRegistry(containerEl, 1, vi.fn());
    const rail = registry.ensure({
      pageNumber: 1, pageEl: pages[0].el, side: "right",
      top: 0, height: 800, left: 700, width: 300,
    });
    expect(rail.containerXToLocal(742)).toBe(42);
    expect(rail.localXToContainer(42)).toBe(742);
    registry.dispose();
  });

  it("removes an inactive dense rail instead of leaving an empty input surface", () => {
    const { containerEl, pages } = buildHostFixture({});
    const registry = new PageCardRailRegistry(containerEl, 1, () => {});
    const base = { pageNumber: 1, pageEl: pages[0].el, top: 0, height: 800, width: 200 };
    const left = registry.ensure({ ...base, side: "left", left: 0 });
    const right = registry.ensure({ ...base, side: "right", left: 800 });
    right.setLayout("dense", 1200);

    registry.prunePage(1, new Set(["left"]));

    expect(registry.get(1, "left")?.element).toBe(left.element);
    expect(registry.get(1, "right")).toBeNull();
    expect(containerEl.querySelector('.rm-page-card-rail[data-side="right"]')).toBeNull();
  });
  it("clears connectors for only the affected page", () => {
    const { containerEl } = buildHostFixture({});
    drawEphemeralConnector(containerEl, { pageNumber: 1, side: "left", x1: 0, y1: 10, x2: 100, y2: 10, color: "#fff15c", id: "a" });
    drawEphemeralConnector(containerEl, { pageNumber: 2, side: "right", x1: 0, y1: 20, x2: 100, y2: 20, color: "#fff15c", id: "b" });
    clearPageConnectors(containerEl, 1);
    expect(containerEl.querySelector(`g[data-annotation-id="a"]`)).toBeNull();
    expect(containerEl.querySelector(`g[data-annotation-id="b"]`)).toBeTruthy();
  });
});
