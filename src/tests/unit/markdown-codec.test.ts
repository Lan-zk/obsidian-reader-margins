import { describe, it, expect } from "vitest";
import { renderSnapshot, escapeHtml } from "src/export/markdown-codec";
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

const base = (annotations: AnnotationRecordV1[]) => ({
  pdfBaseName: "example", pdfPath: "Books/example.pdf",
  documentId: "doc-1", documentRevision: 42,
  exportedAt: "2026-07-12T12:00:00+08:00", annotations,
});

describe("MarkdownCodec", () => {
  it("renders frontmatter + header", () => {
    const md = renderSnapshot(base([ann()]));
    expect(md).toContain("reader-margins-export: true");
    expect(md).toContain('reader-margins-document-id: "doc-1"');
    expect(md).toContain("reader-margins-document-revision: 42");
    expect(md).toContain("# example 批注");
  });
  it("tints the whole blockquote with the annotation color", () => {
    const md = renderSnapshot(base([ann()]));
    expect(md).toContain('<blockquote style="border-left: 4px solid #fff15c; background-color: rgba(255, 241, 92, 0.14);');
    expect(md).toContain("被标注文本");
  });
  it("places quote and comment in separate <p> with a 批注 heading", () => {
    const md = renderSnapshot(base([ann({ comment: "我的笔记" })]));
    expect(md).toContain("<p>被标注文本</p>");
    expect(md).toContain("<p><strong>批注</strong></p>");
    expect(md).toContain("我的笔记");
    expect(md.indexOf("被标注文本")).toBeLessThan(md.indexOf("<strong>批注</strong>"));
  });
  it("omits comment block when comment is empty", () => {
    const md = renderSnapshot(base([ann()]));
    expect(md).not.toContain("<strong>批注</strong>");
  });
  it("does not emit an id/revision HTML comment (export is one-way)", () => {
    const md = renderSnapshot(base([ann()]));
    expect(md).not.toContain("reader-margins:annotation");
    expect(md).not.toContain('id="a1"');
  });
  it("escapes HTML-special characters", () => {
    expect(escapeHtml('a<b>&"c')).toBe('a&lt;b&gt;&amp;&quot;c');
    const md = renderSnapshot(base([ann({ anchor: { pageNumber: 1, quote: { exact: "<script>" }, geometry: { pageWidth: 600, pageHeight: 800, rotation: 0, rects: [{ x: 0, y: 0, width: 1, height: 1 }] } } })]));
    expect(md).toContain("&lt;script&gt;");
    expect(md).not.toContain("<script>");
  });
  it("replaces newlines in quote with spaces", () => {
    const md = renderSnapshot(base([ann({ anchor: { pageNumber: 1, quote: { exact: "line1\nline2" }, geometry: { pageWidth: 600, pageHeight: 800, rotation: 0, rects: [{ x: 0, y: 0, width: 1, height: 1 }] } } })]));
    expect(md).toContain("line1 line2");
    expect(md).not.toContain("line1\nline2");
  });
  it("preserves newlines in comments as <br>", () => {
    const md = renderSnapshot(base([ann({ comment: "第一行\n第二行" })]));
    expect(md).toContain("第一行<br>第二行");
  });
  it("emits a wikilink with page anchor above the blockquote", () => {
    const md = renderSnapshot(base([ann()]));
    expect(md).toMatch(/\[\[Books\/example\.pdf#page=12\|第 12 页\]\]/);
    // link comes before the blockquote
    expect(md.indexOf("[[Books/example.pdf#page=12")).toBeLessThan(md.indexOf("<blockquote"));
  });
  it("escapes brackets and # in wikilink paths", () => {
    const md = renderSnapshot({ pdfBaseName: "weird", pdfPath: "a]b#c.pdf", documentId: "d", documentRevision: 1, exportedAt: "2026-07-12T12:00:00+08:00", annotations: [ann()] });
    expect(md).toMatch(/\[\[a\\]b\\#c\.pdf#page=12/);
  });
});
