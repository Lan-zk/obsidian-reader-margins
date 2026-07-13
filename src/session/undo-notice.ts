// src/session/undo-notice.ts
import { Notice } from "obsidian";

// Shows a Notice with an Undo button for 10 seconds (spec §4.4).
// All text via textContent; the notice container is Obsidian's own element.
export function showUndoNotice(message: string, onUndo: () => void): void {
  const notice = new Notice("", 10_000);
  const container = (notice as unknown as { noticeEl: HTMLElement }).noticeEl;
  if (!container) return;
  const text = document.createElement("span");
  text.textContent = message;
  text.style.marginRight = "8px";
  const btn = document.createElement("button");
  btn.textContent = "Undo";
  btn.addEventListener("click", () => { onUndo(); notice.hide(); });
  container.append(text, btn);
}
