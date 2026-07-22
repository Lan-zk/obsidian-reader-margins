// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { PageCardRailRegistry } from "src/render/page-card-rail";

function makeRegistry(containerEl: HTMLElement) {
  return new PageCardRailRegistry(containerEl, 1, () => {});
}

function geometry(overrides: Partial<Parameters<PageCardRailRegistry["ensure"]>[0]> = {}) {
  const pageEl = document.createElement("div");
  pageEl.dataset.pageNumber = "1";
  return {
    pageNumber: 1,
    pageEl,
    side: "left" as const,
    top: 0,
    height: 800,
    left: 0,
    width: 200,
    ...overrides,
  };
}

describe("PageCardRailRegistry.clearPageCards", () => {
  it("keeps a card that is playing its exit animation so the fade is not cut short", () => {
    const containerEl = document.createElement("div");
    document.body.appendChild(containerEl);
    const registry = makeRegistry(containerEl);
    const rail = registry.ensure(geometry())!;

    const staying = document.createElement("div");
    staying.className = "rm-card rm-card-exit";
    const removed = document.createElement("div");
    removed.className = "rm-card";
    rail.element.append(staying, removed);

    registry.clearPageCards(1);

    // MEDIUM-1: clearPageCards must skip exiting cards so the delete exit-fade
    // survives the immediate reconcile that rebuilds the page's remaining cards.
    expect(containerEl.contains(staying)).toBe(true);
    expect(staying.classList.contains("rm-card-exit")).toBe(true);
    expect(containerEl.contains(removed)).toBe(false);

    registry.dispose();
    containerEl.remove();
  });
});
