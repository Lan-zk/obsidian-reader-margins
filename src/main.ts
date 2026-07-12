import { Plugin, WorkspaceLeaf } from "obsidian";
import { ViewerSession } from "src/session/viewer-session";

export default class ReaderMarginsPlugin extends Plugin {
  private sessions = new Map<WorkspaceLeaf, ViewerSession>();

  async onload() {
    await loadPdfJs();
    this.registerEvent(this.app.workspace.on("layout-change", () => this.reconcileLeaves()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.reconcileLeaves()));
    this.app.workspace.iterateAllLeaves((leaf) => this.attachLeaf(leaf));
    this.register(() => this.destroyAll());
  }

  private reconcileLeaves() {
    this.app.workspace.iterateAllLeaves((leaf) => this.attachLeaf(leaf));
  }

  private attachLeaf(leaf: WorkspaceLeaf) {
    const view: any = leaf.view;
    if (!view || view.getViewType?.() !== "pdf") return;
    if (this.sessions.has(leaf)) return;
    const session = new ViewerSession(view, view.file?.path ?? "");
    this.sessions.set(leaf, session);
    session.attach().catch((e) => console.error("reader-margins attach failed", e));
  }

  private destroyAll() {
    for (const s of this.sessions.values()) s.dispose();
    this.sessions.clear();
  }

  onunload() { this.destroyAll(); }
}
