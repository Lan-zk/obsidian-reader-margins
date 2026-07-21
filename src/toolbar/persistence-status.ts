// src/toolbar/persistence-status.ts
import type { PersistenceStatus } from "src/store/persistence-coordinator";
import type { Translate } from "src/i18n";

export class PersistenceStatusView {
  private el: HTMLElement;
  private current: PersistenceStatus | null = null;
  constructor(parent: HTMLElement, private t: Translate) {
    this.el = parent.ownerDocument.createElement("span");
    this.el.className = "rm-persistence-status";
    this.el.style.display = "none";
    parent.appendChild(this.el);
  }
  update(s: PersistenceStatus): void {
    this.current = s;
    if (s.state === "saved") { this.el.style.display = "none"; return; }
    this.el.style.display = "inline-block";
    this.el.className = `rm-persistence-status rm-persistence-${s.state}`;
    this.el.setAttribute("role", "status");
    // Shape carries the state too (color is not the only cue): saving = hollow ring,
    // dirty = square chip, failed = solid dot. See styles.css.
    const label = s.state === "failed"
      ? this.t("persistence.failed", { message: s.message })
      : this.t(`persistence.${s.state}`);
    this.el.title = label;
    this.el.setAttribute("aria-label", label);
    this.el.textContent = "";
  }
  updateT(t: Translate): void {
    this.t = t;
    if (this.current) this.update(this.current);
  }
  dispose(): void { this.el.remove(); }
}
