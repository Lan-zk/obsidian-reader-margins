// src/export/markdown-export-service.ts
// Writes a Markdown snapshot to the vault with ownership detection (spec §15.3).
import { App, TFile, normalizePath } from "obsidian";
import { renderSnapshot } from "src/export/markdown-codec";
import type { AnnotationRecordV1 } from "src/domain/annotation";

export interface ExportMeta {
  pdfBaseName: string;
  pdfPath: string;
  documentId: string;
  documentRevision: number;
}

export type ExportReason = "empty" | "exists_no_replace" | "exists_not_owner" | "not_found" | "write_failed";
export type ExportResult = { ok: true; path: string } | { ok: false; reason: ExportReason };

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

// Generate a truly unique default path by appending an incrementing suffix when
// the minute-precision name already collides (spec §15.2: same name -> append
// an incrementing number).
export async function defaultUniquePath(app: App, pdfPath: string, now: Date): Promise<string> {
  const base = defaultExportPath(pdfPath, now);
  let path = base;
  let i = 2;
  while (app.vault.getAbstractFileByPath(path) instanceof TFile) {
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : "";
    path = normalizePath(`${stem} ${i}${ext}`);
    i++;
  }
  return path;
}

export class MarkdownExportService {
  constructor(private app: App) {}

  // Classify an existing file at `target` for the UI: none / owner (replaceable) /
  // foreign (exists but not this document's snapshot).
  async classifyExisting(target: string, documentId: string): Promise<"none" | "owner" | "foreign"> {
    const f = this.app.vault.getAbstractFileByPath(target);
    if (!(f instanceof TFile)) return "none";
    const fm = await this.readFrontmatter(f);
    return isReplaceableSnapshot(fm, documentId) ? "owner" : "foreign";
  }

  // Write the snapshot. `replace` must be true to overwrite an existing file;
  // the caller (Modal) only sets it after an explicit Replace action and a
  // fresh ownership check. Returns a typed result so the UI can surface failures
  // without swallowing them (H-06, M-07).
  async export(
    annotations: AnnotationRecordV1[],
    meta: ExportMeta,
    target: string,
    replace: boolean,
  ): Promise<ExportResult> {
    if (annotations.length === 0) return { ok: false, reason: "empty" };
    const md = renderSnapshot({
      pdfBaseName: meta.pdfBaseName, pdfPath: meta.pdfPath,
      documentId: meta.documentId, documentRevision: meta.documentRevision,
      exportedAt: new Date().toISOString(), annotations,
    });
    const existing = this.app.vault.getAbstractFileByPath(target);
    try {
      if (existing instanceof TFile) {
        if (!replace) return { ok: false, reason: "exists_no_replace" };
        const fm = await this.readFrontmatter(existing);
        if (!isReplaceableSnapshot(fm, meta.documentId)) return { ok: false, reason: "exists_not_owner" };
        await this.app.vault.modify(existing, md);
      } else {
        if (replace) return { ok: false, reason: "not_found" };
        await this.app.vault.create(target, md);
      }
    } catch {
      return { ok: false, reason: "write_failed" };
    }
    await this.app.workspace.openLinkText(target, "", false);
    return { ok: true, path: target };
  }

  private async readFrontmatter(file: TFile): Promise<Record<string, unknown> | null> {
    try {
      const cache = this.app.metadataCache.getFileCache(file);
      return (cache?.frontmatter as Record<string, unknown>) ?? null;
    } catch { return null; }
  }
}
