// src/toolbar/toolbar-controller.ts
import type { HostHandles } from "src/host/host-typings";
import { DisposableScope } from "src/session/disposable-scope";
import { PersistenceStatusView } from "src/toolbar/persistence-status";
import type { PersistenceStatus } from "src/store/persistence-coordinator";
import { createIcon, type IconName } from "src/render/icons";

export interface ToolbarColors { id: string; value: string; label: string; }
export interface ToolbarCallbacks {
  onColor: (colorId: string) => void;
  onUnderline: () => void;
  onExport: () => void;
}

export class ToolbarController {
  private scope = new DisposableScope();
  private root: HTMLElement;
  private ownRoot = false; // true if we created the root (vs using host toolbar slot)
  private statusView: PersistenceStatusView;
  private colors: ToolbarColors[];
  private defaultColorId: string;
  private group: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks | null = null;
  private underlineBtn: HTMLElement | null = null;
  private exportBtn: HTMLElement | null = null;
  private separator: HTMLElement | null = null;

  constructor(private h: HostHandles, colors: ToolbarColors[], defaultColorId: string) {
    this.colors = colors;
    this.defaultColorId = defaultColorId;
    // Prefer the host toolbar slot; fall back to a self-created bar on the view container.
    if (h.toolbarSlot) {
      this.root = h.toolbarSlot;
    } else {
      this.root = h.viewContainerEl.ownerDocument.createElement("div");
      this.root.className = "rm-toolbar-fallback";
      this.ownRoot = true;
      h.viewContainerEl.appendChild(this.root);
    }
    this.statusView = new PersistenceStatusView(this.root);
  }

  render(cb: ToolbarCallbacks): void {
    this.callbacks = cb;
    // Underline + export buttons (with a separator from the color swatches) are
    // created once; their callbacks do not change when the color set changes, so
    // they survive a swatch rebuild.
    if (!this.underlineBtn) {
      this.underlineBtn = this.makeIconButton("rm-toolbar-underline", "underline", "Underline and comment", () => this.callbacks?.onUnderline());
      this.exportBtn = this.makeIconButton("rm-toolbar-export", "download", "Export Markdown", () => this.callbacks?.onExport());
      const doc = this.root.ownerDocument;
      this.separator = doc.createElement("span");
      this.separator.className = "rm-toolbar-separator";
      this.root.append(this.separator, this.underlineBtn, this.exportBtn);
      this.scope.addDispose(() => { this.underlineBtn?.remove(); this.exportBtn?.remove(); this.separator?.remove(); });
    }
    this.rerenderSwatches();
  }

  private rerenderSwatches(): void {
    if (!this.callbacks) return;
    this.clearSwatches();
    const cb = this.callbacks;
    const doc = this.root.ownerDocument;
    const group = doc.createElement("span");
    group.className = "rm-toolbar-colors";
    for (const c of this.colors) {
      const sw = doc.createElement("button");
      sw.className = "rm-color-swatch";
      sw.style.background = c.value;
      sw.title = `Highlight: ${c.label}`;
      sw.setAttribute("aria-label", `Highlight with ${c.label}`);
      if (c.id === this.defaultColorId) sw.classList.add("rm-color-swatch-default");
      sw.addEventListener("click", () => cb.onColor(c.id));
      group.appendChild(sw);
    }
    // Swatches sit before the separator that divides them from the action buttons.
    const before = this.separator ?? this.underlineBtn;
    if (before) this.root.insertBefore(group, before);
    else this.root.appendChild(group);
    this.group = group;
  }

  private makeIconButton(cls: string, iconName: IconName, title: string, onClick: () => void): HTMLElement {
    const doc = this.root.ownerDocument;
    const btn = doc.createElement("button");
    btn.className = cls;
    btn.title = title;
    btn.setAttribute("aria-label", title);
    btn.appendChild(createIcon(doc, iconName, 16));
    btn.addEventListener("click", onClick);
    return btn;
  }

  updateColors(colors: ToolbarColors[], defaultColorId: string): void {
    this.colors = colors;
    this.defaultColorId = defaultColorId;
    this.rerenderSwatches();
  }

  setStatus(s: PersistenceStatus): void { this.statusView.update(s); }

  private clearSwatches(): void { this.root.querySelector(".rm-toolbar-colors")?.remove(); }

  dispose(): void {
    this.scope.disposeAll();
    this.statusView.dispose();
    if (this.ownRoot) this.root.remove();
  }
}
