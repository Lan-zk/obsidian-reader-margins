// src/session/selection-snapshot-controller.ts
import type { Disposable } from "src/session/disposable-scope";

export interface SelectionSnapshot {
  sessionId: string;
  win: Window;
  pageNumber: number;
  selectedText: string;
  range: Range;
  clientRects: DOMRectReadOnly[];
  capturedAt: number;
}

const SNAPSHOT_TTL_MS = 10_000;

export class SelectionSnapshotController implements Disposable {
  private snapshot: SelectionSnapshot | null = null;

  current(): SelectionSnapshot | null {
    const s = this.snapshot;
    if (!s) return null;
    if (Date.now() - s.capturedAt > SNAPSHOT_TTL_MS) { this.snapshot = null; return null; }
    return s;
  }

  // spec §8.2 + §8.3: validate rangeCount, collapsed, containment, non-blank, finite rects.
  capture(sessionId: string, win: Window, viewerEl: HTMLElement): SelectionSnapshot | null {
    const sel = win.getSelection();
    if (!sel || sel.rangeCount !== 1 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    const startInViewer = viewerEl.contains(sel.anchorNode);
    const endInViewer = viewerEl.contains(sel.focusNode);
    if (!startInViewer || !endInViewer) return null;

    // Same-page check: both endpoints must hit the same .page.
    const startPage = pageOf(sel.anchorNode);
    const endPage = pageOf(sel.focusNode);
    if (!startPage || startPage !== endPage) return null;
    const pageNumber = parseInt(startPage.dataset.pageNumber ?? "", 10);
    if (!Number.isFinite(pageNumber)) return null;

    const text = sel.toString().replace(/\s+/g, " ").trim();
    if (text.length === 0) return null;

    const rawRects = range.getClientRects();
    const rects: DOMRect[] = [];
    for (let i = 0; i < rawRects.length; i++) {
      const r = rawRects[i];
      if (r.width <= 0 || r.height <= 0) continue;
      if (![r.left, r.top, r.width, r.height].every(Number.isFinite)) continue;
      rects.push(r);
    }
    if (rects.length === 0) return null;

    this.snapshot = {
      sessionId, win, pageNumber, selectedText: text, range,
      clientRects: rects.map((r) => DOMRectReadOnly.fromRect(r)),
      capturedAt: Date.now(),
    };
    return this.snapshot;
  }

  clear(): void { this.snapshot = null; }

  dispose(): void { this.snapshot = null; }
}

function pageOf(node: Node | null): HTMLElement | null {
  let el = node instanceof HTMLElement ? node : node?.parentElement ?? null;
  while (el && !el.classList.contains("page")) el = el.parentElement;
  return el;
}
