import { Plugin, Notice, TFile, TFolder, type TAbstractFile } from "obsidian";
import { DurableAnnotationStore, type DocumentPathMove, type RekeyDocumentPathsResult } from "src/store/durable-annotation-store";
import { PdfViewManager } from "src/session/pdf-view-manager";
import { ReaderMarginsSettingsTab } from "src/settings/settings-tab";
import { aggregateSessionDiagnostics, DiagnosticsReporter } from "src/diagnostics/diagnostics-reporter";
import { makeDefaultHotkeyHost } from "src/host/default-hotkey";
import { makeT } from "src/i18n";

export function collectStoredPathMoves(
  storedPaths: readonly string[],
  oldFolderPath: string,
  newFolderPath: string,
): DocumentPathMove[] {
  if (!oldFolderPath || oldFolderPath === newFolderPath) return [];
  const prefix = `${oldFolderPath}/`;
  return storedPaths
    .filter((path) => path.startsWith(prefix))
    .map((oldPath) => ({ oldPath, newPath: `${newFolderPath}/${oldPath.slice(prefix.length)}` }));
}

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
    this.viewManager = new PdfViewManager(this.store);
    this.diagnostics.provide("sessionDiagnostics", () => aggregateSessionDiagnostics(this.viewManager.allSessions()));
    // Register before start(): start() performs immediate view discovery. A
    // rename must be able to rekey durable paths and invalidate old sessions
    // before any newly discovered view can bind annotations by its new path.
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.onVaultRename(file, oldPath)));
    this.viewManager.start(this);
    this.addSettingTab(new ReaderMarginsSettingsTab(this.app, this));
    this.registerCommands();
    this.register(() => { this.viewManager.stop(); this.store.flushBestEffort(); });
  }

  private onVaultRename(file: TAbstractFile, oldPath: string): void {
    let moves: DocumentPathMove[];
    if (file instanceof TFile) {
      moves = [{ oldPath, newPath: file.path }];
    } else if (file instanceof TFolder) {
      moves = collectStoredPathMoves(
        [...this.store.documentPaths(), ...this.viewManager.sessionPaths()],
        oldPath,
        file.path,
      );
    } else {
      // Unknown TAbstractFile shape: fail closed rather than guessing whether a
      // prefix rewrite is safe.
      new Notice(this.renameT()("notice.rename.unsupported"), 8000);
      return;
    }

    this.viewManager.prepareForDocumentMoves(moves);
    const result = this.store.rekeyDocumentPaths(moves);
    if (!result.ok) new Notice(this.renameFailureMessage(result), 8000);
  }

  private renameFailureMessage(result: Extract<RekeyDocumentPathsResult, { ok: false }>): string {
    const key = result.reason === "readonly" ? "notice.rename.readonly" : "notice.rename.conflict";
    return this.renameT()(key);
  }

  private renameT() {
    return makeT(this.store.data.settings.language, (this.app as any).locale ?? "en");
  }

  private registerCommands() {
    // Each command is "mark only" or "mark + annotate" (annotate opens the card
    // edit box so the user can type immediately). All use the toolbar's active
    // color, so a color is picked once and reused across shortcuts.
    const run = (checking: boolean, markStyle: "highlight" | "underline", annotate: boolean): boolean | void => {
      const session = this.viewManager.activeSession();
      if (!session || !session.hasSelection()) return false;
      if (checking) return true;
      const result = session.createAnnotation(markStyle, { annotate });
      if (!result.ok) {
        const key = markStyle === "highlight" ? "notice.cannotHighlight" : "notice.cannotUnderline";
        new Notice(session.tNotice(key, { reason: result.reason }));
      }
    };
    this.addCommand({
      id: "highlight-selection",
      name: "Highlight selected text (active color)",
      checkCallback: (checking) => run(checking, "highlight", false),
    });
    this.addCommand({
      id: "highlight-and-annotate",
      name: "Highlight and annotate selected text",
      checkCallback: (checking) => run(checking, "highlight", true),
    });
    this.addCommand({
      id: "underline-selection",
      name: "Underline selected text (active color)",
      checkCallback: (checking) => run(checking, "underline", false),
    });
    this.addCommand({
      id: "underline-and-annotate",
      name: "Underline and annotate selected text",
      checkCallback: (checking) => run(checking, "underline", true),
    });
    // "Save annotation" commits the open card edit box. Bound by default to
    // Mod+Enter (Ctrl+Enter on Windows/Linux, Cmd+Enter on macOS) via the
    // default-hotkey host adapter, so the save goes through Obsidian's hotkey
    // system instead of the textarea keydown (which the host keymap can swallow).
    this.addCommand({
      id: "save-annotation",
      name: "Save annotation edit box",
      checkCallback: (checking) => {
        const session = this.viewManager.activeSession();
        if (!session || !session.hasActiveEdit()) return false;
        if (checking) return true;
        session.commitActiveEdit();
      },
    });
    // Register the default hotkey after the command exists. The scoped id is
    // "<pluginId>:<commandId>"; this is the key Obsidian's defaultHotkeys uses.
    makeDefaultHotkeyHost(this.app).setDefaultHotkey(`${this.manifest.id}:save-annotation`, { modifiers: ["Mod"], key: "Enter" });
  }

  onunload() {
    this.viewManager?.stop();
  }
}
