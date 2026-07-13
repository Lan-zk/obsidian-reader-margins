import { describe, it, expect } from "vitest";
import { isReplaceableSnapshot, defaultExportPath } from "src/export/markdown-export-service";

describe("export ownership", () => {
  it("replaceable when frontmatter matches document id", () => {
    const fm = { "reader-margins-export": true, "reader-margins-format": 1, "reader-margins-document-id": "doc-1" };
    expect(isReplaceableSnapshot(fm, "doc-1")).toBe(true);
  });
  it("not replaceable when document id differs", () => {
    const fm = { "reader-margins-export": true, "reader-margins-format": 1, "reader-margins-document-id": "other" };
    expect(isReplaceableSnapshot(fm, "doc-1")).toBe(false);
  });
  it("not replaceable when frontmatter absent (unknown file)", () => {
    expect(isReplaceableSnapshot({}, "doc-1")).toBe(false);
    expect(isReplaceableSnapshot(null, "doc-1")).toBe(false);
  });
  it("defaultExportPath uses PDF dir + basename + date", () => {
    const p = defaultExportPath("Books/example.pdf", new Date("2026-07-12T12:34:00+08:00"));
    expect(p).toMatch(/^Books\/example 批注 \d{4}-\d{2}-\d{2} \d{4}\.md$/);
  });
});
