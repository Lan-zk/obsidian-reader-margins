// src/toolbar/toolbar-controller.ts
import type { HostHandles } from "src/host/host-typings";
import { DisposableScope } from "src/session/disposable-scope";
import { PersistenceStatusView } from "src/toolbar/persistence-status";
import type { PersistenceStatus } from "src/store/persistence-coordinator";

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
    this.clearSwatches();
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
    const underline = doc.createElement("button");
    underline.className = "rm-toolbar-underline";
    underline.textContent = "U̲";
    underline.title = "Underline and comment";
    underline.addEventListener("click", () => cb.onUnderline());
    const exportBtn = doc.createElement("button");
    exportBtn.className = "rm-toolbar-export";
    exportBtn.textContent = "⤓";
    exportBtn.title = "Export Markdown";
    exportBtn.addEventListener("click", () => cb.onExport());
    this.root.append(group, underline, exportBtn);
    this.group = group;
    this.scope.addDispose(() => { group.remove(); underline.remove(); exportBtn.remove(); });
  }

  updateColors(colors: ToolbarColors[], defaultColorId: string): void {
    this.colors = colors;
    this.defaultColorId = defaultColorId;
  }

  setStatus(s: PersistenceStatus): void { this.statusView.update(s); }

  private clearSwatches(): void { this.root.querySelector(".rm-toolbar-colors")?.remove(); }

  dispose(): void {
    this.scope.disposeAll();
    this.statusView.dispose();
    if (this.ownRoot) this.root.remove();
  }
}
