// src/session/pdf-view-manager.ts
// Discovers PDF leaves and owns one ViewerSession per open PDF view. Handles
// split/popout (multiple leaves) and same-leaf file swap (dispose old, create
// new) so a session never renders annotations for the wrong pdfPath.
import type { Plugin, WorkspaceLeaf } from "obsidian";
import { DurableAnnotationStore, type DocumentPathMove } from "src/store/durable-annotation-store";
import { ViewerSession } from "src/session/viewer-session";

export class PdfViewManager {
  private sessions = new Map<WorkspaceLeaf, ViewerSession>();
  private plugin: Plugin | null = null;
  private unsubscribeStore: (() => void) | null = null;

  get sessionCount(): number { return this.sessions.size; }

  constructor(private store: DurableAnnotationStore, private onReconcile?: () => void) {}

  start(plugin: Plugin): void {
    this.plugin = plugin;
    this.unsubscribeStore?.();
    this.unsubscribeStore = this.store.onChange((_path, _changes, payload) => {
      const moves = payload?.documentMoves;
      if (!moves || moves.length === 0) return;
      const oldPaths = new Set(moves.map((move) => move.oldPath));
      for (const [leaf, session] of this.sessions) {
        if (!oldPaths.has(session.pdfPath)) continue;
        // Disposal advances the session generation. Any delayed probe/render
        // callback that captured the old path can no longer affect the fresh
        // session discovered below.
        session.dispose();
        this.sessions.delete(leaf);
      }
      // Do not immediately rediscover from the rename callback. The ordering
      // between Vault.rename and the private PDF view's file-path refresh has
      // not been verified in the real host. A subsequent workspace discovery
      // event can attach the new path; until then, failing closed prevents a
      // stale old-path view from creating a replacement session.
    });
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
  allSessions(): ViewerSession[] { return Array.from(this.sessions.values()); }
  sessionPaths(): string[] { return Array.from(new Set(this.allSessions().map((session) => session.pdfPath))); }

  // Vault rename ordering relative to the private PDF view's file-path refresh
  // is not established. Commit best-effort drafts against the still-valid old
  // path and invalidate every affected generation before mutating store keys.
  // This also covers annotation-free and rejected/colliding moves, neither of
  // which emits a successful store documentMoves payload.
  prepareForDocumentMoves(moves: readonly DocumentPathMove[]): void {
    const oldPaths = new Set(moves.filter((move) => move.oldPath !== move.newPath).map((move) => move.oldPath));
    for (const [leaf, session] of this.sessions) {
      if (!oldPaths.has(session.pdfPath)) continue;
      session.dispose();
      this.sessions.delete(leaf);
    }
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
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    for (const s of this.sessions.values()) s.dispose();
    this.sessions.clear();
    this.plugin = null;
  }
}
