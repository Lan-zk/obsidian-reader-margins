// src/export/markdown-codec.ts
// Pure snapshot renderer (spec §15.4). No DOM, no obsidian - unit-testable.
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

// Escape a line so it cannot break out of a callout block (> prefix).
export function escapeCalloutLine(text: string): string {
  return text.replace(/^>/gm, "\\>");
}

// Escape HTML-special characters so untrusted quote text is safe inside <mark>/<u>.
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Escape ] and # inside a wikilink target so the link stays valid (spec §15.5).
function escapeWikilinkPath(path: string): string {
  return path.replace(/([\]#])/g, "\\$1");
}

function styleLabel(s: MarkStyle): string {
  return s === "highlight" ? "高亮" : "下划线";
}

// Wrap quote text in a colored <mark> (highlight) or <u> (underline) so the
// annotation color renders in Obsidian's reading view (cf. PDF++ export).
// Color is re-validated; an invalid value falls back to a neutral swatch.
function styledQuote(exact: string, markStyle: MarkStyle, colorRaw: string): string {
  const safe = escapeHtml(exact.replace(/\n/g, " "));
  const color = validateHexColor(colorRaw) ?? "#cccccc";
  if (markStyle === "underline") {
    return `<u style="text-decoration-color: ${color}; text-decoration-thickness: 2px;">${safe}</u>`;
  }
  return `<mark style="background-color: ${color};">${safe}</mark>`;
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
    // HTML comment carries id+revision for future reconciliation (spec §15.4).
    // It is invisible in reading view.
    lines.push(`<!-- reader-margins:annotation id="${ann.id}" revision="${ann.revision}" -->`);
    lines.push(`> [!quote] ${link} · ${styleLabel(ann.markStyle)}`);
    lines.push(`> ${styledQuote(ann.anchor.quote.exact, ann.markStyle, ann.colorValueSnapshot)}`);
    if (ann.comment && ann.comment.trim()) {
      lines.push(">");
      lines.push("> **批注**");
      for (const line of ann.comment.split("\n")) {
        lines.push(`> ${escapeCalloutLine(line)}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}
