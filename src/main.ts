import { Plugin, WorkspaceLeaf, Notice } from "obsidian";
import { DurableAnnotationStore } from "src/store/durable-annotation-store";
import { ViewerSession } from "src/session/viewer-session";

export default class ReaderMarginsPlugin extends Plugin {
  store!: DurableAnnotationStore;
  private sessions = new Map<WorkspaceLeaf, ViewerSession>();

  async onload() {
    // loadPdfJs is an Obsidian global; guard in case it's unavailable in this build.
    if (typeof loadPdfJs === "function") {
      try { await loadPdfJs(); } catch (e) { console.error("reader-margins: loadPdfJs failed", e); }
    } else {
      console.warn("reader-margins: loadPdfJs global not found");
    }
    this.store = new DurableAnnotationStore(async (data) => { await this.saveData(data); });
    const state = this.store.loadAndValidate(await this.loadData());
    if (state === "future" || state === "invalid") {
      new Notice(`Reader Margins: ${state} data.json; annotations disabled to prevent overwrite.`, 10000);
    }
    this.registerEvent(this.app.workspace.on("layout-change", () => this.reconcileLeaves()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.reconcileLeaves()));
    this.app.workspace.iterateAllLeaves((leaf) => this.attachLeaf(leaf));
    this.register(() => { this.destroyAll(); this.store.flushBestEffort(); });
  }

  private reconcileLeaves() {
    this.app.workspace.iterateAllLeaves((leaf) => this.attachLeaf(leaf));
  }

  private attachLeaf(leaf: WorkspaceLeaf) {
    const view: any = leaf.view;
    if (!view || view.getViewType?.() !== "pdf") return;
    if (this.sessions.has(leaf)) return;
    const session = new ViewerSession(view, view.file?.path ?? "", this.store);
    this.sessions.set(leaf, session);
    session.attach().catch((e) => console.error("reader-margins attach failed", e));
  }

  private destroyAll() {
    for (const s of this.sessions.values()) s.dispose();
    this.sessions.clear();
  }

  onunload() { this.destroyAll(); }
}
