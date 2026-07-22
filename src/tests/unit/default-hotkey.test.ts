import { describe, it, expect } from "vitest";
import type { Hotkey } from "obsidian";
import { makeDefaultHotkeyHost } from "src/host/default-hotkey";

const SAVE_HOTKEY: Hotkey = { modifiers: ["Mod"], key: "Enter" };

describe("makeDefaultHotkeyHost", () => {
  it("sets a default hotkey on app.hotkeyManager.defaultHotkeys when available", () => {
    const defaults: Record<string, unknown> = {};
    const app = { hotkeyManager: { defaultHotkeys: defaults } };
    const host = makeDefaultHotkeyHost(app);
    expect(host.setDefaultHotkey("reader-margins:save-annotation", { modifiers: ["Mod"], key: "Enter" })).toBe(true);
    expect(defaults["reader-margins:save-annotation"]).toEqual([{ modifiers: ["Mod"], key: "Enter" }]);
  });

  it("does not overwrite a default another build or the user already set", () => {
    const existing = [{ modifiers: ["Alt"], key: "S" }];
    const defaults: Record<string, unknown> = { "reader-margins:save-annotation": existing };
    const app = { hotkeyManager: { defaultHotkeys: defaults } };
    makeDefaultHotkeyHost(app).setDefaultHotkey("reader-margins:save-annotation", { modifiers: ["Mod"], key: "Enter" });
    expect(defaults["reader-margins:save-annotation"]).toBe(existing);
  });

  it("fails closed when hotkeyManager or defaultHotkeys is absent", () => {
    expect(makeDefaultHotkeyHost({}).setDefaultHotkey("reader-margins:save-annotation", SAVE_HOTKEY)).toBe(false);
    expect(makeDefaultHotkeyHost(null).setDefaultHotkey("reader-margins:save-annotation", SAVE_HOTKEY)).toBe(false);
    expect(makeDefaultHotkeyHost({ hotkeyManager: {} }).setDefaultHotkey("reader-margins:save-annotation", SAVE_HOTKEY)).toBe(false);
    expect(makeDefaultHotkeyHost({ hotkeyManager: { defaultHotkeys: "not-a-record" } }).setDefaultHotkey("reader-margins:save-annotation", SAVE_HOTKEY)).toBe(false);
  });
});
