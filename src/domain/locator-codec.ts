// src/domain/locator-codec.ts
export interface Locator { beginIndex: number; beginOffset: number; endIndex: number; endOffset: number; }

function itemOf(node: Node, layer: HTMLElement): { item: HTMLElement; index: number } | null {
  let el = node instanceof HTMLElement ? node : node.parentElement;
  while (el && el !== layer && !el.classList.contains("textLayerNode")) el = el.parentElement;
  if (!el || !el.classList.contains("textLayerNode")) return null;
  const index = parseInt(el.dataset.idx ?? "", 10);
  if (!Number.isFinite(index)) return null;
  return { item: el, index };
}

export function encodeLocator(startNode: Node, startOffset: number, endNode: Node, endOffset: number, layer: HTMLElement): Locator | null {
  const s = itemOf(startNode, layer); const e = itemOf(endNode, layer);
  if (!s || !e) return null;
  return { beginIndex: s.index, beginOffset: startOffset, endIndex: e.index, endOffset: endOffset };
}

export function decodeLocator(loc: Locator, layer: HTMLElement): Range | null {
  const items = layer.querySelectorAll<HTMLElement>(".textLayerNode[data-idx]");
  const byIndex = new Map<number, HTMLElement>();
  items.forEach((it) => { const i = parseInt(it.dataset.idx ?? "", 10); if (Number.isFinite(i)) byIndex.set(i, it); });
  const s = byIndex.get(loc.beginIndex); const e = byIndex.get(loc.endIndex);
  if (!s || !e) return null;
  const range = layer.ownerDocument.createRange();
  const sText = s.firstChild; const eText = e.firstChild;
  if (!sText || !eText) return null;
  const so = Math.min(loc.beginOffset, (sText.textContent ?? "").length);
  const eo = Math.min(loc.endOffset, (eText.textContent ?? "").length);
  range.setStart(sText, so);
  range.setEnd(eText, eo);
  return range;
}
