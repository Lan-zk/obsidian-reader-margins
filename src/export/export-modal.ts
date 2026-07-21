// src/export/export-modal.ts
import { App, Modal, Notice, Setting } from "obsidian";
import { MarkdownExportService, defaultUniquePath, type ExportMeta, type ExportResult } from "src/export/markdown-export-service";
import type { AnnotationRecordV1 } from "src/domain/annotation";
import type { Translate } from "src/i18n";

export class ExportModal extends Modal {
  private targetPath: string;
  private existing: "none" | "owner" | "foreign" = "none";
  private busy = false;

  constructor(
    app: App,
    private pdfPath: string,
    private annotations: AnnotationRecordV1[],
    private meta: { documentId: string; documentRevision: number },
    private service: MarkdownExportService,
    private t: Translate,
    private onSuccess?: () => void,
  ) {
    super(app);
    // Start with a plain default; onOpen upgrades to a unique path.
    this.targetPath = "";
  }

  async onOpen(): Promise<void> {
    this.targetPath = await defaultUniquePath(this.app, this.pdfPath, new Date());
    await this.refreshExisting();
    this.render();
  }

  private async refreshExisting(): Promise<void> {
    this.existing = await this.service.classifyExisting(this.targetPath, this.meta.documentId);
  }

  private render(): void {
    const { contentEl } = this;
    const t = this.t;
    contentEl.empty();
    contentEl.createEl("h2", { text: t("modal.export.title") });

    new Setting(contentEl)
      .setName(t("modal.targetPath"))
      .setDesc(t("modal.targetPath.desc"))
      .addText((input) =>
        input.setValue(this.targetPath).onChange((v) => { this.targetPath = v; }),
      )
      .addExtraButton((btn) =>
        btn.setIcon("refresh-cw").setTooltip(t("modal.targetPath")).onClick(async () => {
          this.targetPath = await defaultUniquePath(this.app, this.pdfPath, new Date());
          await this.refreshExisting();
          this.render();
        }),
      );

    const statusKey = `modal.status.${this.existing}`;
    const status = contentEl.createEl("p", { text: t(statusKey) });
    status.classList.add("rm-export-status", `rm-export-status-${this.existing}`);

    new Setting(contentEl)
      .addButton((b) => {
        b.setButtonText(t("modal.export")).setCta().onClick(() => this.run(false));
        if (this.existing !== "none") b.setDisabled(true);
      })
      .addButton((b) => {
        b.setButtonText(t("modal.replace")).setWarning().onClick(() => this.run(true));
        if (this.existing !== "owner") b.setDisabled(true).setTooltip(t("export.reason.exists_not_owner"));
      })
      .addButton((b) => b.setButtonText(t("modal.cancel")).onClick(() => this.close()));
  }

  private async run(replace: boolean): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    // Re-check ownership right before writing (the file may have changed).
    if (replace) {
      this.existing = await this.service.classifyExisting(this.targetPath, this.meta.documentId);
      if (this.existing !== "owner") {
        new Notice(this.t("export.reason.exists_not_owner"), 6000);
        this.busy = false;
        this.render();
        return;
      }
    }
    const meta: ExportMeta = {
      pdfBaseName: this.targetPath.slice(this.targetPath.lastIndexOf("/") + 1).replace(/\.md$/, ""),
      pdfPath: this.pdfPath,
      documentId: this.meta.documentId,
      documentRevision: this.meta.documentRevision,
    };
    let result: ExportResult;
    try {
      result = await this.service.export(this.annotations, meta, this.targetPath, replace);
    } catch {
      result = { ok: false, reason: "write_failed" };
    }
    this.busy = false;
    if (result.ok) {
      new Notice(this.t(replace ? "modal.exportedReplace" : "modal.exported", { count: String(this.annotations.length) }));
      this.onSuccess?.();
      this.close();
      return;
    }
    new Notice(this.t(`export.reason.${result.reason}`), 6000);
    await this.refreshExisting();
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
