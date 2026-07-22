// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { ToolbarController } from "src/toolbar/toolbar-controller";
import { makeT } from "src/i18n";

function makeController(activeColorId = "yellow") {
  const toolbarSlot = document.createElement("div");
  document.body.appendChild(toolbarSlot);
  const h = { toolbarSlot } as any;
  const colors = [
    { id: "yellow", value: "#fff15c", label: "Yellow" },
    { id: "blue", value: "#abcbdf", label: "Blue" },
  ];
  const ctrl = new ToolbarController(h, colors, activeColorId, makeT("en", "en"));
  const callbacks = { onSelectColor: vi.fn(), onHighlight: vi.fn(), onUnderline: vi.fn(), onExport: vi.fn() };
  ctrl.render(callbacks);
  return { ctrl, toolbarSlot, callbacks };
}

describe("ToolbarController.pulseExport (MEDIUM-2)", () => {
  it("skips the success class when reduced motion is requested", () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    Object.defineProperty(window, "matchMedia", { configurable: true, value: matchMedia });
    try {
      const { ctrl, toolbarSlot } = makeController();
      const exportBtn = toolbarSlot.querySelector<HTMLElement>(".rm-toolbar-export")!;

      ctrl.pulseExport();

      expect(exportBtn.classList.contains("rm-toolbar-export-success")).toBe(false);
      ctrl.dispose();
    } finally {
      delete (window as any).matchMedia;
    }
  });

  it("clears the success-class timer on dispose so it cannot fire on the detached button", () => {
    vi.useFakeTimers();
    try {
      const { ctrl, toolbarSlot } = makeController();
      const exportBtn = toolbarSlot.querySelector<HTMLElement>(".rm-toolbar-export")!;
      ctrl.pulseExport();
      expect(exportBtn.classList.contains("rm-toolbar-export-success")).toBe(true);

      ctrl.dispose();
      vi.advanceTimersByTime(1_000);

      // Timer was cancelled by dispose, so the removal callback never ran and
      // the (now-detached) button keeps the class. Without the fix the timer
      // fires and strips the class from the detached button post-dispose.
      expect(exportBtn.classList.contains("rm-toolbar-export-success")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ToolbarController color selection + actions", () => {
  it("renders a highlight button and marks only the active swatch with a ring + aria-pressed", () => {
    const { ctrl, toolbarSlot } = makeController("blue");
    const swatches = [...toolbarSlot.querySelectorAll<HTMLElement>(".rm-color-swatch")];
    expect(swatches.map((s) => s.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    expect(swatches[0].classList.contains("rm-color-swatch-default")).toBe(false);
    expect(swatches[1].classList.contains("rm-color-swatch-default")).toBe(true);
    expect(toolbarSlot.querySelector(".rm-toolbar-highlight")).toBeTruthy();
    ctrl.dispose();
  });

  it("swatch click fires onSelectColor (not create); setActiveColor moves the ring", () => {
    const { ctrl, toolbarSlot, callbacks } = makeController("yellow");
    const swatches = [...toolbarSlot.querySelectorAll<HTMLElement>(".rm-color-swatch")];
    swatches[1].click(); // pick blue
    expect(callbacks.onSelectColor).toHaveBeenCalledWith("blue");
    expect(callbacks.onHighlight).not.toHaveBeenCalled();

    ctrl.setActiveColor("blue");
    const after = [...toolbarSlot.querySelectorAll<HTMLElement>(".rm-color-swatch")];
    expect(after[0].classList.contains("rm-color-swatch-default")).toBe(false);
    expect(after[1].classList.contains("rm-color-swatch-default")).toBe(true);
    ctrl.dispose();
  });

  it("highlight and underline buttons fire their respective callbacks", () => {
    const { ctrl, toolbarSlot, callbacks } = makeController();
    toolbarSlot.querySelector<HTMLElement>(".rm-toolbar-highlight")!.click();
    toolbarSlot.querySelector<HTMLElement>(".rm-toolbar-underline")!.click();
    expect(callbacks.onHighlight).toHaveBeenCalledTimes(1);
    expect(callbacks.onUnderline).toHaveBeenCalledTimes(1);
    ctrl.dispose();
  });
});
