// src/export/markdown-codec.ts
// Pure snapshot renderer (spec §15.4). No DOM, no obsidian - unit-testable.
import type { AnnotationRecordV1 } from "src/domain/annotation";
import { computeSortKey } from "src/domain/pdf-text-anchor";

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

// Escape ] and # inside a wikilink target so the link stays valid (spec §15.5).
function escapeWikilinkPath(path: string): string {
  return path.replace(/([\]#])/g, "\\$1");
}

function styleLabel(s: "highlight" | "underline"): string {
  return s === "highlight" ? "高亮" : "下划线";
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
    lines.push(`<!-- reader-margins:annotation id="${ann.id}" revision="${ann.revision}" -->`);
    lines.push(`> [!quote] ${link} · ${ann.colorLabelSnapshot} · ${styleLabel(ann.markStyle)}`);
    const text = escapeCalloutLine(ann.anchor.quote.exact.replace(/\n/g, " "));
    lines.push(`> ${text}`);
    if (ann.comment && ann.comment.trim()) {
      lines.push(">");
      for (const line of ann.comment.split("\n")) {
        lines.push(`> ${escapeCalloutLine(line)}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}
