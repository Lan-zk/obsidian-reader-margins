// src/export/export-modal.ts
import { App, Modal, Setting } from "obsidian";
import { MarkdownExportService } from "src/export/markdown-export-service";
import type { AnnotationRecordV1 } from "src/domain/annotation";
import type { Translate } from "src/i18n";

export interface ExportModalMeta {
  documentId: string;
  documentRevision: number;
}

export class ExportModal extends Modal {
  private targetPath: string;

  constructor(
    app: App,
    private pdfPath: string,
    private annotations: AnnotationRecordV1[],
    private meta: ExportModalMeta,
    private service: MarkdownExportService,
    private t: Translate,
  ) {
    super(app);
    const base = pdfPath.slice(pdfPath.lastIndexOf("/") + 1).replace(/\.pdf$/i, "");
    const dir = pdfPath.includes("/") ? pdfPath.slice(0, pdfPath.lastIndexOf("/")) : "";
    this.targetPath = `${dir ? dir + "/" : ""}${base} 批注.md`;
  }

  onOpen(): void {
    const { contentEl } = this;
    const t = this.t;
    contentEl.createEl("h2", { text: t("modal.export.title") });
    new Setting(contentEl)
      .setName(t("modal.targetPath"))
      .setDesc(t("modal.targetPath.desc"))
      .addText((input) => input.setValue(this.targetPath).onChange((v) => (this.targetPath = v)));
    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText(t("modal.export")).setCta().onClick(() => {
          const base = this.targetPath.slice(this.targetPath.lastIndexOf("/") + 1).replace(/\.md$/, "");
          void this.service.export(this.annotations, {
            pdfBaseName: base,
            pdfPath: this.pdfPath,
            documentId: this.meta.documentId,
            documentRevision: this.meta.documentRevision,
          });
          this.close();
        }),
      )
      .addButton((b) => b.setButtonText(t("modal.cancel")).onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
