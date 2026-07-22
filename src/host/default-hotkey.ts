// src/host/default-hotkey.ts
import type { Hotkey } from "obsidian";

// Obsidian's public API does not let a plugin register a *default* hotkey for
// its own command (addCommand takes no hotkey; the user binds in Settings >
// Hotkeys). The de-facto, stable-but-private path is app.hotkeyManager.
// defaultHotkeys: a Record<commandId, Hotkey[]> consulted when the user has not
// customized the command. We probe defensively and fail closed if the shape is
// unavailable rather than throwing on load.
//
// "Mod" is Ctrl on Windows/Linux and Cmd on macOS, so a Mod+Enter default is
// the platform-native "save" gesture the user expects.

export interface DefaultHotkeyHost {
  setDefaultHotkey(commandId: string, hotkey: Hotkey): boolean;
}

export function makeDefaultHotkeyHost(app: unknown): DefaultHotkeyHost {
  return {
    setDefaultHotkey(commandId: string, hotkey: Hotkey): boolean {
      const manager = (app as any)?.hotkeyManager;
      if (!manager || typeof manager !== "object") return false;
      const defaults = manager.defaultHotkeys;
      if (!defaults || typeof defaults !== "object") return false;
      try {
        // Do not overwrite a default another build set differently unless it is
        // absent: this keeps a re-load idempotent and avoids clobbering a user
        // who manually edited their default-hotkey config.
        if (defaults[commandId] === undefined) defaults[commandId] = [hotkey];
        return true;
      } catch {
        return false;
      }
    },
  };
}
