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
  layer.innerHTML = "";
  for (const r of rects) {
    const el = pageEl.ownerDocument.createElement("div");
    el.className = "rm-mark";
    el.style.left = `${r.x * scale}px`;
    el.style.width = `${r.width * scale}px`;
    if (style === "highlight") {
      el.style.top = `${r.y * scale}px`;
      el.style.height = `${r.height * scale}px`;
      el.style.background = color;
      el.style.opacity = "0.35";
      el.style.mixBlendMode = "multiply";
    } else {
      el.style.top = `${(r.y + r.height - 2) * scale}px`;
      el.style.height = "2px";
      el.style.background = color;
    }
    layer.appendChild(el);
  }
}

export function clearMarks(pageEl: HTMLElement): void {
  pageEl.querySelector(".rm-mark-layer")?.remove();
}
