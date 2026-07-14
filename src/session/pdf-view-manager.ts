// src/session/pdf-view-manager.ts
// Discovers PDF leaves and owns one ViewerSession per open PDF view. Handles
// split/popout (multiple leaves) and same-leaf file swap (dispose old, create
// new) so a session never renders annotations for the wrong pdfPath.
import type { Plugin, WorkspaceLeaf } from "obsidian";
import { DurableAnnotationStore } from "src/store/durable-annotation-store";
import { ViewerSession } from "src/session/viewer-session";

export class PdfViewManager {
  private sessions = new Map<WorkspaceLeaf, ViewerSession>();
  private plugin: Plugin | null = null;

  get sessionCount(): number { return this.sessions.size; }

  constructor(private store: DurableAnnotationStore, private onReconcile?: () => void) {}

  start(plugin: Plugin): void {
    this.plugin = plugin;
    plugin.registerEvent(plugin.app.workspace.on("layout-change", () => this.reconcile()));
    plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", () => this.reconcile()));
    plugin.registerEvent(plugin.app.workspace.on("window-open", () => this.reconcile()));
    plugin.registerEvent(plugin.app.workspace.on("window-close", () => this.reconcile()));
    plugin.register(() => this.stop());
    this.reconcile();
  }

  sessionFor(leaf: WorkspaceLeaf): ViewerSession | undefined {
    return this.sessions.get(leaf);
  }

  // Active PDF session for command routing (the leaf the user is focused on).
  activeSession(): ViewerSession | null {
    const leaf = this.plugin?.app.workspace.activeLeaf;
    if (!leaf) return null;
    return this.sessions.get(leaf) ?? null;
  }

  reconcile(): void {
    if (!this.plugin) return;
    const seen = new Set<WorkspaceLeaf>();
    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      const view: any = leaf.view;
      if (!view || view.getViewType?.() !== "pdf") return;
      seen.add(leaf);
      const path = view.file?.path ?? "";
      const existing = this.sessions.get(leaf);
      if (existing && existing.pdfPath === path && existing.state !== "degraded") return; // unchanged
      // Same leaf, different file, or degraded session needing a retry (H-12).
      if (existing) { existing.dispose(); this.sessions.delete(leaf); }
      const session = new ViewerSession(view, path, this.store);
      this.sessions.set(leaf, session);
      session.attach().catch((e) => console.error("reader-margins attach failed", e));
    });
    // Dispose sessions whose leaf is no longer present (closed view / popped-out window closed).
    for (const [leaf, session] of this.sessions) {
      if (!seen.has(leaf)) { session.dispose(); this.sessions.delete(leaf); }
    }
    this.onReconcile?.();
  }

  stop(): void {
    for (const s of this.sessions.values()) s.dispose();
    this.sessions.clear();
  }
}
