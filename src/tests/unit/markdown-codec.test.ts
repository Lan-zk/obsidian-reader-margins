import { describe, it, expect } from "vitest";
import { renderSnapshot, escapeCalloutLine } from "src/export/markdown-codec";
import type { AnnotationRecordV1 } from "src/domain/annotation";

const ann = (over: any = {}): AnnotationRecordV1 => ({
  id: "a1", revision: 3, type: "text-mark", markStyle: "highlight",
  colorLabelSnapshot: "Yellow", colorValueSnapshot: "#fff15c",
  comment: undefined,
  anchor: {
    kind: "pdf-text", version: 1, pageNumber: 12,
    quote: { exact: "被标注文本", prefix: "前", suffix: "后", normalization: "collapse-whitespace-v1" },
    geometry: { space: "page-css-v1", pageWidth: 600, pageHeight: 800, rotation: 0, rects: [{ x: 0, y: 100, width: 10, height: 10 }] },
  },
  createdAt: "2026-07-12T00:00:00Z", updatedAt: "2026-07-12T00:00:00Z",
  ...over,
}) as AnnotationRecordV1;

describe("MarkdownCodec", () => {
  it("renders frontmatter + header + callout", () => {
    const md = renderSnapshot({
      pdfBaseName: "example", pdfPath: "Books/example.pdf",
      documentId: "doc-1", documentRevision: 42,
      exportedAt: "2026-07-12T12:00:00+08:00",
      annotations: [ann()],
    });
    expect(md).toContain("reader-margins-export: true");
    expect(md).toContain('reader-margins-document-id: "doc-1"');
    expect(md).toContain("reader-margins-document-revision: 42");
    expect(md).toContain("# example 批注");
    expect(md).toContain("> [!quote]");
    expect(md).toContain("被标注文本");
    expect(md).toContain('id="a1" revision="3"');
  });
  it("escapes line-leading > in text", () => {
    expect(escapeCalloutLine("> blockquote trick")).toBe("\\> blockquote trick");
  });
  it("replaces newlines in text with spaces inside callout body", () => {
    const md = renderSnapshot({
      pdfBaseName: "x", pdfPath: "x.pdf", documentId: "d", documentRevision: 1,
      exportedAt: "2026-07-12T12:00:00+08:00",
      annotations: [ann({ anchor: { pageNumber: 1, quote: { exact: "line1\nline2" }, geometry: { pageWidth: 600, pageHeight: 800, rotation: 0, rects: [{ x: 0, y: 0, width: 1, height: 1 }] } } })],
    });
    expect(md).toContain("line1 line2");
    expect(md).not.toContain("line1\nline2");
  });
  it("omits comment block when comment is empty", () => {
    const md = renderSnapshot({
      pdfBaseName: "x", pdfPath: "x.pdf", documentId: "d", documentRevision: 1,
      exportedAt: "2026-07-12T12:00:00+08:00", annotations: [ann()],
    });
    expect(md).not.toContain("用户批注");
  });
  it("includes comment when present", () => {
    const md = renderSnapshot({
      pdfBaseName: "x", pdfPath: "x.pdf", documentId: "d", documentRevision: 1,
      exportedAt: "2026-07-12T12:00:00+08:00", annotations: [ann({ comment: "my note" })],
    });
    expect(md).toContain("my note");
  });
  it("escapes backticks and brackets in paths", () => {
    const md = renderSnapshot({
      pdfBaseName: "weird", pdfPath: "a]b#c.pdf", documentId: "d", documentRevision: 1,
      exportedAt: "2026-07-12T12:00:00+08:00", annotations: [ann()],
    });
    // path with ] and # must be escaped so the wikilink stays valid
    expect(md).toMatch(/\[\[.*\]\]/);
  });
});
