// src/render/mark-renderer.ts
export interface AnchorRect { x: number; y: number; width: number; height: number; }
export type MarkStyle = "highlight" | "underline";

export function drawEphemeralMark(
  pageEl: HTMLElement,
  rects: AnchorRect[],
  color: string,
  style: MarkStyle,
  scale: number
): void {
  let layer = pageEl.querySelector<HTMLElement>(".rm-mark-layer");
  if (!layer) {
    layer = pageEl.ownerDocument.createElement("div");
    layer.className = "rm-mark-layer";
    pageEl.appendChild(layer);
  }
  // NOTE: do NOT clear here - clearMarks() at render start handles it, so multiple
  // annotations on the same page accumulate their marks instead of overwriting.
  //
  // Wrap one annotation's rects in a group element. The group carries the
  // opacity/blend; children are opaque. Overlapping rects within the same
  // selection then paint opaquely over each other (no alpha compositing between
  // siblings), and the group's opacity is applied exactly once - so the overlap
  // between adjacent line rects is not double-tinted. (Per-rect opacity would
  // alpha-composite the overlap into a darker band.)
  const doc = pageEl.ownerDocument;
  const group = doc.createElement("div");
  group.className = "rm-mark-group";
  if (style === "highlight") {
    group.style.opacity = "0.35";
    group.style.mixBlendMode = "multiply";
  }
  for (const r of rects) {
    const el = doc.createElement("div");
    el.className = "rm-mark";
    el.style.left = `${r.x * scale}px`;
    el.style.width = `${r.width * scale}px`;
    if (style === "highlight") {
      el.style.top = `${r.y * scale}px`;
      el.style.height = `${r.height * scale}px`;
      el.style.background = color;
    } else {
      el.style.top = `${(r.y + r.height - 2) * scale}px`;
      el.style.height = `${2 * scale}px`;
      el.style.background = color;
    }
    group.appendChild(el);
  }
  layer.appendChild(group);
}

export function clearMarks(pageEl: HTMLElement): void {
  // Remove ALL mark layers (defensive: a stray second layer should not leave
  // duplicate marks behind). Normal case is exactly one.
  pageEl.querySelectorAll(".rm-mark-layer").forEach((n) => n.remove());
}
