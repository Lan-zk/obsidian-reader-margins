import { Plugin, Notice } from "obsidian";
import { DurableAnnotationStore } from "src/store/durable-annotation-store";
import { PdfViewManager } from "src/session/pdf-view-manager";
import { ReaderMarginsSettingsTab } from "src/settings/settings-tab";
import { DiagnosticsReporter } from "src/diagnostics/diagnostics-reporter";

export default class ReaderMarginsPlugin extends Plugin {
  store!: DurableAnnotationStore;
  diagnostics = new DiagnosticsReporter();
  private viewManager!: PdfViewManager;

  async onload() {
    // loadPdfJs is an Obsidian global; guard in case it's unavailable in this build.
    if (typeof loadPdfJs === "function") {
      try { await loadPdfJs(); this.diagnostics.set("pdfJsLoaded", true); } catch (e) { console.error("reader-margins: loadPdfJs failed", e); this.diagnostics.set("pdfJsLoaded", false); }
    } else {
      console.warn("reader-margins: loadPdfJs global not found");
      this.diagnostics.set("pdfJsLoaded", false);
    }
    this.store = new DurableAnnotationStore(async (data) => { await this.saveData(data); });
    const state = this.store.loadAndValidate(await this.loadData());
    this.diagnostics.set("obsidianVersion", (this.app as any).appVersion ?? "unknown");
    this.diagnostics.set("manifestVersion", this.manifest.version);
    this.diagnostics.set("schemaLoadState", state);
    this.diagnostics.set("isReadonly", this.store.isReadonly);
    this.store.onStatus((s) => this.diagnostics.set("persistenceStatus", s.state));
    if (state === "future" || state === "invalid") {
      new Notice(`Reader Margins: ${state} data.json; annotations disabled to prevent overwrite.`, 10000);
    }
    this.viewManager = new PdfViewManager(this.store, () =>
      this.diagnostics.set("sessionCount", this.viewManager.sessionCount));
    this.viewManager.start(this);
    this.addSettingTab(new ReaderMarginsSettingsTab(this.app, this));
    this.registerCommands();
    this.register(() => { this.viewManager.stop(); this.store.flushBestEffort(); });
  }

  private registerCommands() {
    this.addCommand({
      id: "highlight-selection",
      name: "Highlight selected text (default color)",
      checkCallback: (checking) => {
        const session = this.viewManager.activeSession();
        if (!session || !session.hasSelection()) return false;
        if (checking) return true;
        const result = session.createAnnotation("highlight");
        if (!result.ok) new Notice(session.tNotice("notice.cannotHighlight", { reason: result.reason }));
      },
    });
    this.addCommand({
      id: "underline-and-comment",
      name: "Underline and comment selected text",
      checkCallback: (checking) => {
        const session = this.viewManager.activeSession();
        if (!session || !session.hasSelection()) return false;
        if (checking) return true;
        const result = session.createAnnotation("underline");
        if (!result.ok) new Notice(session.tNotice("notice.cannotUnderline", { reason: result.reason }));
      },
    });
  }

  onunload() {
    this.viewManager?.stop();
  }
}
