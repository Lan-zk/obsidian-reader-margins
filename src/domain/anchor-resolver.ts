// src/domain/anchor-resolver.ts
import type { SelectionSnapshot } from "src/session/selection-snapshot-controller";
import { cleanGeometry, normalizeQuote, type PdfTextAnchorV1, type AnchorRect } from "src/domain/pdf-text-anchor";

export interface PageDims { pageWidth: number; pageHeight: number; rotation: 0 | 90 | 180 | 270; }
export interface CaptureContext {
  prefix?: string;
  suffix?: string;
  locator?: PdfTextAnchorV1["locator"];
  textLayer?: HTMLElement | null;
}

export function captureAnchor(
  snap: SelectionSnapshot,
  pageEl: HTMLElement,
  scale: number,
  dims: PageDims,
  ctx: CaptureContext = {}
): PdfTextAnchorV1 | null {
  const pageRect = pageEl.getBoundingClientRect();
  const raw: AnchorRect[] = snap.clientRects.map((c) => ({
    x: (c.left - pageRect.left) / scale,
    y: (c.top - pageRect.top) / scale,
    width: c.width / scale,
    height: c.height / scale,
  }));
  const rects = cleanGeometry(raw, dims.pageWidth, dims.pageHeight);
  if (rects.length === 0) return null;
  const exact = normalizeQuote(snap.selectedText);
  if (!exact) return null;
  const rangeContext = ctx.textLayer ? quoteContextFromRange(snap.range, ctx.textLayer) : {};
  return {
    kind: "pdf-text", version: 1, pageNumber: snap.pageNumber,
    locator: ctx.locator,
    quote: {
      exact,
      prefix: ctx.prefix ?? rangeContext.prefix,
      suffix: ctx.suffix ?? rangeContext.suffix,
      normalization: "collapse-whitespace-v1",
    },
    geometry: { space: "page-css-v1", pageWidth: dims.pageWidth, pageHeight: dims.pageHeight, rotation: dims.rotation, rects },
  };
}

export type AnchorResolveResult =
  | { status: "resolved"; rects: AnchorRect[]; method: "locator" | "quote" | "geometry" }
  | { status: "unresolved"; reason: string };

export interface ResolveHit { range: Range; rects: AnchorRect[]; }

export type QuoteSearchResult =
  | { status: "resolved"; hit: ResolveHit }
  | { status: "not-found" }
  | { status: "ambiguous" };

export interface ResolveContext {
  findRangeByLocator: (locator: PdfTextAnchorV1["locator"]) => ResolveHit | null;
  searchPageText: (exact: string, prefix: string | undefined, suffix: string | undefined) => QuoteSearchResult;
  pageDims: PageDims;
}

const DIM_TOL = 0.01; // 1% relative tolerance (spec §9.6)

// spec §9.6: locator -> quote -> geometry -> unresolved
export function resolveAnchor(anchor: PdfTextAnchorV1, ctx: ResolveContext): AnchorResolveResult {
  const exact = anchor.quote.exact;

  if (anchor.locator) {
    const hit = ctx.findRangeByLocator(anchor.locator);
    // locator success must return the freshly computed rects (tracking text
    // reflow), not the stale stored geometry (H-03).
    if (hit && normalizeQuote(hit.range.toString()) === exact) {
      return { status: "resolved", rects: hit.rects, method: "locator" };
    }
  }
  const quoteResult = ctx.searchPageText(exact, anchor.quote.prefix, anchor.quote.suffix);
  if (quoteResult.status === "resolved") {
    return { status: "resolved", rects: quoteResult.hit.rects, method: "quote" };
  }
  if (quoteResult.status === "ambiguous") {
    return { status: "unresolved", reason: "quote is ambiguous" };
  }
  const g = anchor.geometry;
  const d = ctx.pageDims;
  const wOk = Math.abs(d.pageWidth - g.pageWidth) / g.pageWidth <= DIM_TOL;
  const hOk = Math.abs(d.pageHeight - g.pageHeight) / g.pageHeight <= DIM_TOL;
  if (wOk && hOk && d.rotation === g.rotation) {
    return { status: "resolved", rects: g.rects, method: "geometry" };
  }
  return { status: "unresolved", reason: "locator, quote, and geometry all failed; dims or rotation mismatch" };
}

const CONTEXT_CHARS = 16;

function quoteContextFromRange(range: Range, textLayer: HTMLElement): { prefix?: string; suffix?: string } {
  if (!textLayer.contains(range.startContainer) || !textLayer.contains(range.endContainer)) return {};
  try {
    const before = textLayer.ownerDocument.createRange();
    before.selectNodeContents(textLayer);
    before.setEnd(range.startContainer, range.startOffset);
    const after = textLayer.ownerDocument.createRange();
    after.selectNodeContents(textLayer);
    after.setStart(range.endContainer, range.endOffset);
    const prefix = normalizeQuote(before.toString()).slice(-CONTEXT_CHARS);
    const suffix = normalizeQuote(after.toString()).slice(0, CONTEXT_CHARS);
    return { prefix: prefix || undefined, suffix: suffix || undefined };
  } catch {
    return {};
  }
}

interface TextChunk { node: Text; start: number; end: number; }
interface NormalizedText { text: string; rawStarts: number[]; rawEnds: number[]; }

export function searchTextLayerQuote(
  textLayer: HTMLElement,
  exact: string,
  prefix: string | undefined,
  suffix: string | undefined,
  toHit: (range: Range) => ResolveHit | null,
): QuoteSearchResult {
  const chunks = collectTextChunks(textLayer);
  const raw = chunks.map((chunk) => chunk.node.data).join("");
  const normalized = normalizeTextWithOffsets(raw);
  const normalizedExact = normalizeQuote(exact);
  if (!normalizedExact) return { status: "not-found" };

  const candidates: number[] = [];
  let from = 0;
  while (from <= normalized.text.length - normalizedExact.length) {
    const index = normalized.text.indexOf(normalizedExact, from);
    if (index < 0) break;
    candidates.push(index);
    from = index + 1;
  }
  if (candidates.length === 0) return { status: "not-found" };

  let selected = candidates;
  if (candidates.length > 1) {
    const normalizedPrefix = prefix ? normalizeQuote(prefix) : "";
    const normalizedSuffix = suffix ? normalizeQuote(suffix) : "";
    if (normalizedPrefix || normalizedSuffix) {
      selected = candidates.filter((start) => {
        const end = start + normalizedExact.length;
        const prefixMatches = !normalizedPrefix || normalized.text.slice(0, start).trimEnd().endsWith(normalizedPrefix);
        const suffixMatches = !normalizedSuffix || normalized.text.slice(end).trimStart().startsWith(normalizedSuffix);
        return prefixMatches && suffixMatches;
      });
    }
    if (selected.length !== 1) return { status: "ambiguous" };
  }

  const start = selected[0];
  const end = start + normalizedExact.length;
  const rawStart = normalized.rawStarts[start];
  const rawEnd = normalized.rawEnds[end - 1];
  const startBoundary = boundaryAt(chunks, rawStart);
  const endBoundary = boundaryAt(chunks, rawEnd);
  if (!startBoundary || !endBoundary) return { status: "not-found" };
  const range = textLayer.ownerDocument.createRange();
  range.setStart(startBoundary.node, startBoundary.offset);
  range.setEnd(endBoundary.node, endBoundary.offset);
  const hit = toHit(range);
  // Text was found but live geometry was not usable. Fail closed so this is not
  // mistaken for a genuine no-match that is allowed to use stored geometry.
  if (!hit) return { status: "ambiguous" };
  return { status: "resolved", hit };
}

function collectTextChunks(textLayer: HTMLElement): TextChunk[] {
  const showText = textLayer.ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = textLayer.ownerDocument.createTreeWalker(textLayer, showText);
  const chunks: TextChunk[] = [];
  let start = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node as Text;
    const end = start + text.data.length;
    chunks.push({ node: text, start, end });
    start = end;
  }
  return chunks;
}

function normalizeTextWithOffsets(raw: string): NormalizedText {
  let text = "";
  const rawStarts: number[] = [];
  const rawEnds: number[] = [];
  let whitespaceStart = -1;
  let whitespaceEnd = -1;
  for (let i = 0; i < raw.length; i++) {
    if (/\s/.test(raw[i])) {
      if (text.length > 0) {
        if (whitespaceStart < 0) whitespaceStart = i;
        whitespaceEnd = i + 1;
      }
      continue;
    }
    if (whitespaceStart >= 0) {
      text += " ";
      rawStarts.push(whitespaceStart);
      rawEnds.push(whitespaceEnd);
      whitespaceStart = -1;
      whitespaceEnd = -1;
    }
    text += raw[i];
    rawStarts.push(i);
    rawEnds.push(i + 1);
  }
  return { text, rawStarts, rawEnds };
}

function boundaryAt(chunks: TextChunk[], rawOffset: number): { node: Text; offset: number } | null {
  for (const chunk of chunks) {
    if (rawOffset <= chunk.end) return { node: chunk.node, offset: Math.max(0, rawOffset - chunk.start) };
  }
  return null;
}
