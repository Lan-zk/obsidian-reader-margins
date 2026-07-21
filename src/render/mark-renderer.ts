// src/render/mark-renderer.ts
export interface AnchorRect { x: number; y: number; width: number; height: number; }
export type MarkStyle = "highlight" | "underline";

export function drawEphemeralMark(
  pageEl: HTMLElement,
  rects: AnchorRect[],
  color: string,
  style: MarkStyle,
  scale: number,
  annotationId?: string,
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
  // Style modifier lets CSS target highlight vs underline groups separately
  // (hover "taut" lift must not dim underlines - they have no group opacity).
  group.className = `rm-mark-group rm-mark-group-${style}`;
  if (annotationId) group.dataset.annotationId = annotationId;
  if (style === "highlight") {
    // 0.42 (was 0.35): bolder presence - the mark must hold its own next to the
    // saturated card border and connector (bolder pass: color as thread).
    group.style.opacity = "0.42";
    group.style.mixBlendMode = "multiply";
  }
  for (const r of rects) {
    const el = doc.createElement("div");
    el.className = style === "highlight" ? "rm-mark rm-mark-highlight" : "rm-mark rm-mark-underline";
    el.style.left = `${r.x * scale}px`;
    el.style.width = `${r.width * scale}px`;
    if (style === "highlight") {
      el.style.top = `${r.y * scale}px`;
      el.style.height = `${r.height * scale}px`;
      el.style.background = color;
    } else {
      // 2.5px stroke (was 2px), bottom edge flush with the text rect; pill ends
      // come from .rm-mark-underline in CSS (Soft-Square language).
      const thickness = 2.5 * scale;
      el.style.top = `${(r.y + r.height) * scale - thickness}px`;
      el.style.height = `${thickness}px`;
      el.style.background = color;
    }
    group.appendChild(el);
  }
  layer.appendChild(group);
}

export function setMarkHover(pageEl: HTMLElement, annotationId: string, on: boolean): void {
  const group = annotationElement<HTMLElement>(pageEl, ".rm-mark-group", annotationId);
  if (group) group.classList.toggle("rm-mark-hover", on);
}

export function clearMarks(pageEl: HTMLElement): void {
  // Remove ALL mark layers (defensive: a stray second layer should not leave
  // duplicate marks behind). Normal case is exactly one.
  pageEl.querySelectorAll(".rm-mark-layer").forEach((n) => n.remove());
}
import { annotationElement } from "src/render/annotation-dom";
