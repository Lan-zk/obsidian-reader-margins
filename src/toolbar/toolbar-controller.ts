// src/toolbar/toolbar-controller.ts
import type { HostHandles } from "src/host/host-typings";
import { DisposableScope } from "src/session/disposable-scope";
import { PersistenceStatusView } from "src/toolbar/persistence-status";
import type { PersistenceStatus } from "src/store/persistence-coordinator";
import { createIcon, type IconName } from "src/render/icons";
import type { Translate } from "src/i18n";

export interface ToolbarColors { id: string; value: string; label: string; }
export interface ToolbarCallbacks {
  onSelectColor: (colorId: string) => void;
  onHighlight: () => void;
  onUnderline: () => void;
  onExport: () => void;
  onConvertAll: () => void;
}

export class ToolbarController {
  private scope = new DisposableScope();
  private root: HTMLElement;
  private ownRoot = false; // true if we created the root (vs using host toolbar slot)
  private statusView: PersistenceStatusView;
  private colors: ToolbarColors[];
  private activeColorId: string;
  private group: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks | null = null;
  private highlightBtn: HTMLElement | null = null;
  private underlineBtn: HTMLElement | null = null;
  private exportBtn: HTMLElement | null = null;
  private convertBtn: HTMLElement | null = null;
  private separator: HTMLElement | null = null;
  private t: Translate;

  constructor(private h: HostHandles, colors: ToolbarColors[], activeColorId: string, t: Translate) {
    this.colors = colors;
    this.activeColorId = activeColorId;
    this.t = t;
    // Prefer the host toolbar slot; fall back to a self-created bar on the view container.
    if (h.toolbarSlot) {
      this.root = h.toolbarSlot;
    } else {
      this.root = h.viewContainerEl.ownerDocument.createElement("div");
      this.root.className = "rm-toolbar-fallback";
      this.ownRoot = true;
      h.viewContainerEl.appendChild(this.root);
    }
    this.statusView = new PersistenceStatusView(this.root, this.t);
  }

  render(cb: ToolbarCallbacks): void {
    this.callbacks = cb;
    // Highlight + underline + export buttons (with a separator from the color
    // swatches) are created once; their callbacks do not change when the color
    // set changes, so they survive a swatch rebuild.
    if (!this.underlineBtn) {
      this.highlightBtn = this.makeIconButton("rm-toolbar-highlight", "highlighter", this.t("toolbar.highlightBtn"), () => this.callbacks?.onHighlight());
      this.underlineBtn = this.makeIconButton("rm-toolbar-underline", "underline", this.t("toolbar.underline"), () => this.callbacks?.onUnderline());
      this.exportBtn = this.makeIconButton("rm-toolbar-export", "download", this.t("toolbar.export"), () => this.callbacks?.onExport());
      this.convertBtn = this.makeIconButton("rm-toolbar-convert", "popover", this.t("toolbar.convertAll"), () => this.callbacks?.onConvertAll());
      this.convertBtn.setAttribute("aria-pressed", "false");
      const doc = this.root.ownerDocument;
      this.separator = doc.createElement("span");
      this.separator.className = "rm-toolbar-separator";
      this.root.append(this.separator, this.highlightBtn!, this.underlineBtn, this.exportBtn, this.convertBtn);
      this.scope.addDispose(() => { this.highlightBtn?.remove(); this.underlineBtn?.remove(); this.exportBtn?.remove(); this.convertBtn?.remove(); this.separator?.remove(); });
    }
    this.rerenderSwatches();
  }

  // Update button titles/aria after a language change without rebuilding icons.
  updateT(t: Translate): void {
    this.t = t;
    this.statusView.updateT(t);
    if (this.highlightBtn) {
      this.highlightBtn.title = t("toolbar.highlightBtn");
      this.highlightBtn.setAttribute("aria-label", t("toolbar.highlightBtn"));
    }
    if (this.underlineBtn) {
      this.underlineBtn.title = t("toolbar.underline");
      this.underlineBtn.setAttribute("aria-label", t("toolbar.underline"));
    }
    if (this.exportBtn) {
      this.exportBtn.title = t("toolbar.export");
      this.exportBtn.setAttribute("aria-label", t("toolbar.export"));
    }
    if (this.convertBtn) {
      this.convertBtn.title = t("toolbar.convertAll");
      this.convertBtn.setAttribute("aria-label", t("toolbar.convertAll"));
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
      sw.title = this.t("toolbar.highlight", { label: c.label });
      sw.setAttribute("aria-label", this.t("toolbar.highlight.aria", { label: c.label }));
      // The active swatch (the color the next highlight/underline uses) gets a
      // ring + a pressed state, so the control reads as a selector, not a palette
      // of fire-and-forget highlight buttons.
      const active = c.id === this.activeColorId;
      sw.setAttribute("aria-pressed", String(active));
      if (active) sw.classList.add("rm-color-swatch-default");
      const dot = doc.createElement("span");
      dot.className = "rm-color-swatch-dot";
      dot.style.background = c.value;
      sw.appendChild(dot);
      sw.addEventListener("click", () => cb.onSelectColor(c.id));
      group.appendChild(sw);
    }
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

  updateColors(colors: ToolbarColors[], activeColorId: string): void {
    this.colors = colors;
    this.activeColorId = activeColorId;
    this.rerenderSwatches();
  }

  // Select the active color (ring moves). Called when the user clicks a swatch
  // or when the session's active color otherwise changes.
  setActiveColor(colorId: string): void {
    this.activeColorId = colorId;
    this.rerenderSwatches();
  }

  setStatus(s: PersistenceStatus): void { this.statusView.update(s); }

  // Reflect "all annotations are popover" on the convert-all button so it reads
  // as a two-state toggle (aria-pressed). Called after reconcile/change events.
  setConvertAllState(allPopover: boolean): void {
    this.convertBtn?.setAttribute("aria-pressed", String(allPopover));
  }

  // One-shot success pulse on the export button (delight pass): primary-color
  // flash for 700ms, then back to normal. The timer is owned by this scope so
  // dispose cancels it (it must not fire on a detached button), and reduced-
  // motion skips the class entirely (CSS alone would disable the animation but
  // leave an unowned timer and a no-op class behind) - MEDIUM-2.
  pulseExport(): void {
    if (!this.exportBtn) return;
    const win = this.root.ownerDocument.defaultView;
    if (!win) return;
    if (win.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    this.exportBtn.classList.add("rm-toolbar-export-success");
    const btn = this.exportBtn;
    const timer = win.setTimeout(() => btn.classList.remove("rm-toolbar-export-success"), 750);
    // Cancel the pending timer on dispose so it cannot fire on the (soon-to-be
    // detached) button. We do not strip the class here: the render disposer
    // removes exportBtn from the DOM, so the one-shot class is irrelevant once
    // the scope tears down.
    this.scope.addDispose(() => win.clearTimeout(timer));
  }

  private clearSwatches(): void { this.root.querySelector(".rm-toolbar-colors")?.remove(); }

  dispose(): void {
    this.scope.disposeAll();
    this.statusView.dispose();
    if (this.ownRoot) this.root.remove();
  }
}
