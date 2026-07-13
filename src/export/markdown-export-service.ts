// src/export/markdown-export-service.ts
// Writes a Markdown snapshot to the vault with ownership detection (spec §15.3).
import { App, Notice, TFile, normalizePath } from "obsidian";
import { renderSnapshot } from "src/export/markdown-codec";
import type { AnnotationRecordV1 } from "src/domain/annotation";

export interface ExportMeta {
  pdfBaseName: string;
  pdfPath: string;
  documentId: string;
  documentRevision: number;
}

// A snapshot may only be overwritten in place when its frontmatter proves it
// belongs to the same document (spec §15.3). Unknown files are never overwritten.
export function isReplaceableSnapshot(frontmatter: Record<string, unknown> | null, documentId: string): boolean {
  if (!frontmatter) return false;
  return frontmatter["reader-margins-export"] === true &&
    frontmatter["reader-margins-format"] === 1 &&
    frontmatter["reader-margins-document-id"] === documentId;
}

// <pdfDir>/<pdfBaseName> 批注 YYYY-MM-DD HHmm.md
export function defaultExportPath(pdfPath: string, now: Date): string {
  const dir = pdfPath.includes("/") ? pdfPath.slice(0, pdfPath.lastIndexOf("/")) : "";
  const base = pdfPath.slice(pdfPath.lastIndexOf("/") + 1).replace(/\.pdf$/i, "");
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const name = `${base} 批注 ${stamp}.md`;
  return normalizePath(dir ? `${dir}/${name}` : name);
}

export class MarkdownExportService {
  constructor(private app: App) {}

  async export(annotations: AnnotationRecordV1[], meta: ExportMeta): Promise<void> {
    if (annotations.length === 0) { new Notice("当前 PDF 没有批注"); return; }
    const md = renderSnapshot({
      pdfBaseName: meta.pdfBaseName, pdfPath: meta.pdfPath,
      documentId: meta.documentId, documentRevision: meta.documentRevision,
      exportedAt: new Date().toISOString(), annotations,
    });
    const target = defaultExportPath(meta.pdfPath, new Date());
    const existing = this.app.vault.getAbstractFileByPath(target);
    if (existing instanceof TFile) {
      const fm = await this.readFrontmatter(existing);
      if (!isReplaceableSnapshot(fm, meta.documentId)) {
        new Notice("目标文件已存在且不属于本 PDF 的导出快照；请手动选择路径。", 8000);
        return;
      }
      await this.app.vault.modify(existing, md);
      new Notice(`已导出 ${annotations.length} 条批注（覆盖）`);
      await this.app.workspace.openLinkText(target, "", false);
      return;
    }
    await this.app.vault.create(target, md);
    new Notice(`已导出 ${annotations.length} 条批注`);
    await this.app.workspace.openLinkText(target, "", false);
  }

  private async readFrontmatter(file: TFile): Promise<Record<string, unknown> | null> {
    try {
      const cache = this.app.metadataCache.getFileCache(file);
      return (cache?.frontmatter as Record<string, unknown>) ?? null;
    } catch { return null; }
  }
}
