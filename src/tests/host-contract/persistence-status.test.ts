// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { PersistenceStatusView } from "src/toolbar/persistence-status";
import { makeT } from "src/i18n";

describe("PersistenceStatusView", () => {
  it("uses the active translator for dirty, saving, and failed states", () => {
    const parent = document.createElement("div");
    const view = new PersistenceStatusView(parent, makeT("zh", "zh"));
    const el = parent.querySelector<HTMLElement>(".rm-persistence-status")!;

    view.update({ state: "dirty", revision: 1 });
    expect(el.getAttribute("aria-label")).toBe("有未保存的更改");
    view.update({ state: "saving", revision: 1 });
    expect(el.getAttribute("aria-label")).toBe("正在保存…");
    view.update({ state: "failed", revision: 1, message: "disk full" });
    expect(el.getAttribute("aria-label")).toBe("保存失败：disk full。正在重试。");
  });
  it("retranslates the currently visible state when the language changes", () => {
    const parent = document.createElement("div");
    const view = new PersistenceStatusView(parent, makeT("en", "en"));
    const el = parent.querySelector<HTMLElement>(".rm-persistence-status")!;
    view.update({ state: "dirty", revision: 1 });
    expect(el.getAttribute("aria-label")).toBe("Unsaved changes");

    view.updateT(makeT("zh", "zh"));
    expect(el.getAttribute("aria-label")).toBe("有未保存的更改");
  });
});
