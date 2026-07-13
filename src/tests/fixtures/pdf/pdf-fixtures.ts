// src/tests/fixtures/pdf/pdf-fixtures.ts
// Describes the real PDFs needed for manual anchor testing (spec §17.3).
// The PDFs themselves are added as .pdf assets alongside this file.

export interface PdfFixture { name: string; file: string; expects: string; }

export const PDF_FIXTURES: PdfFixture[] = [
  { name: "cjk", file: "cjk.pdf", expects: "Chinese text selectable; quote normalization preserves CJK; rects align." },
  { name: "english-multiline", file: "english-multiline.pdf", expects: "Multi-line selection merges same-line rects; cross-line keeps separate rects." },
  { name: "ligature", file: "ligature.pdf", expects: "fi/fl ligatures: quote text matches visible glyphs." },
  { name: "hyphenation", file: "hyphenation.pdf", expects: "Soft hyphen at line break: exact quote excludes the hyphen or matches search." },
  { name: "two-column", file: "two-column.pdf", expects: "Selection in column 2: rects have large x; sort order may interleave (known limit)." },
  { name: "page-labels", file: "page-labels.pdf", expects: "Roman-numeral front matter; pageLabel differs from pageNumber." },
  { name: "rotation", file: "rotation-90.pdf", expects: "rotation=90: anchor resolve returns unresolved (fail closed) or known limit." },
  { name: "scanned", file: "scanned.pdf", expects: "No text layer; selection capture returns null (no create)." },
  { name: "repeated-quote", file: "repeated-quote.pdf", expects: "Same sentence twice: quote search uses prefix/suffix to disambiguate." },
  { name: "text-boundary", file: "text-boundary.pdf", expects: "Selection crossing a text item boundary: locator encode/decode round-trips." },
];
