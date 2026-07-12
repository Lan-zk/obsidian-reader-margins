// src/toolbar/persistence-status.ts
import type { PersistenceStatus } from "src/store/persistence-coordinator";

export class PersistenceStatusView {
  private el: HTMLElement;
  constructor(parent: HTMLElement) {
    this.el = parent.ownerDocument.createElement("span");
    this.el.className = "rm-persistence-status";
    this.el.style.display = "none";
    parent.appendChild(this.el);
  }
  update(s: PersistenceStatus): void {
    if (s.state === "saved") { this.el.style.display = "none"; return; }
    this.el.style.display = "inline-block";
    this.el.className = `rm-persistence-status rm-persistence-${s.state}`;
    this.el.title = s.state === "failed" ? `Save failed: ${s.message}. Retrying.` : "Saving…";
    this.el.textContent = s.state === "failed" ? "⚠" : "•";
  }
  dispose(): void { this.el.remove(); }
}
