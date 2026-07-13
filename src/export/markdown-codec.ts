// src/export/markdown-codec.ts
// Pure snapshot renderer (spec §15.4). No DOM, no obsidian - unit-testable.
//
// Design note: the annotation color is rendered on the whole quote block via an
// HTML <blockquote style="..."> (left border + tinted background), mirroring the
// PDF++ export look. A plain Markdown ">" blockquote cannot take inline color, so
// we use HTML. The page link stays a wikilink (kept outside the blockquote so
// Obsidian resolves it). The id/revision HTML comment is dropped: export is a
// one-way snapshot (spec §15.1) with no re-import, so it carried no consumer.
import type { AnnotationRecordV1, MarkStyle } from "src/domain/annotation";
import { computeSortKey } from "src/domain/pdf-text-anchor";
import { validateHexColor } from "src/domain/colors";

export interface SnapshotInput {
  pdfBaseName: string;
  pdfPath: string;
  documentId: string;
  documentRevision: number;
  exportedAt: string; // ISO 8601
  annotations: AnnotationRecordV1[];
}

// Escape HTML-special characters (including ") so untrusted text is safe both as
// element text and inside attribute values.
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Escape ] and # inside a wikilink target so the link stays valid (spec §15.5).
function escapeWikilinkPath(path: string): string {
  return path.replace(/([\]#])/g, "\\$1");
}

function styleLabel(s: MarkStyle): string {
  return s === "highlight" ? "高亮" : "下划线";
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

// Open an HTML blockquote tinted with the annotation color (left border + faint
// background) so the whole quote block renders the color in reading view.
function styledBlockquoteOpen(colorRaw: string): string {
  const color = validateHexColor(colorRaw) ?? "#cccccc";
  const rgb = hexToRgb(color) ?? { r: 204, g: 204, b: 204 };
  return `<blockquote style="border-left: 4px solid ${color}; background-color: rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.14); margin: 4px 0; padding: 8px 12px;">`;
}

export function renderSnapshot(input: SnapshotInput): string {
  const sorted = [...input.annotations].sort((a, b) => {
    const ra = a.anchor.geometry.rects[0] ?? { x: 0, y: 0, width: 0, height: 0 };
    const rb = b.anchor.geometry.rects[0] ?? { x: 0, y: 0, width: 0, height: 0 };
    const ka = computeSortKey(a.anchor.pageNumber, ra);
    const kb = computeSortKey(b.anchor.pageNumber, rb);
    if (ka !== kb) return ka < kb ? -1 : 1;
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });

  const lines: string[] = [];
  lines.push("---");
  lines.push("reader-margins-export: true");
  lines.push("reader-margins-format: 1");
  lines.push(`reader-margins-document-id: "${input.documentId}"`);
  lines.push(`reader-margins-document-revision: ${input.documentRevision}`);
  lines.push(`reader-margins-source: "${input.pdfPath}"`);
  lines.push(`reader-margins-exported-at: "${input.exportedAt}"`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${input.pdfBaseName} 批注`);
  lines.push("");
  lines.push(`导出自 [[${escapeWikilinkPath(input.pdfPath)}]] · ${sorted.length} 条批注`);
  lines.push("");

  for (const ann of sorted) {
    const page = ann.anchor.pageNumber;
    const link = `[[${escapeWikilinkPath(input.pdfPath)}#page=${page}|第 ${page} 页]]`;
    // Page link stays a wikilink (outside the blockquote) so Obsidian resolves it.
    lines.push(`${link} · ${styleLabel(ann.markStyle)}`);
    lines.push("");
    lines.push(styledBlockquoteOpen(ann.colorValueSnapshot));
    lines.push(`<p>${escapeHtml(ann.anchor.quote.exact.replace(/\n/g, " "))}</p>`);
    if (ann.comment && ann.comment.trim()) {
      lines.push(`<p><strong>批注</strong></p>`);
      const commentHtml = escapeHtml(ann.comment).replace(/\n/g, "<br>");
      lines.push(`<p>${commentHtml}</p>`);
    }
    lines.push(`</blockquote>`);
    lines.push("");
  }
  return lines.join("\n");
}
