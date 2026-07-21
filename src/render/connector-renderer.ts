// src/render/connector-renderer.ts
import { annotationElement } from "src/render/annotation-dom";
export interface ConnectorPoints {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  id?: string;
  pageNumber?: number;
  side?: "left" | "right";
  selected?: boolean;
  stitching?: boolean;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function drawEphemeralConnector(containerEl: HTMLElement, p: ConnectorPoints): void {
  let svg = containerEl.querySelector<SVGSVGElement>(".rm-connector-layer");
  if (!svg) {
    svg = containerEl.ownerDocument.createElementNS(SVG_NS, "svg");
    svg.classList.add("rm-connector-layer");
    svg.style.width = "100%";
    svg.style.height = "100%";
    containerEl.appendChild(svg);
  }
  // Remove any existing connector group for this annotation (prevents duplicates on re-render).
  if (p.id) annotationElement(svg, "g.rm-connector", p.id)?.remove();

  const doc = containerEl.ownerDocument;
  const g = doc.createElementNS(SVG_NS, "g");
  g.classList.add("rm-connector");
  if (p.id) g.dataset.annotationId = p.id;
  if (p.pageNumber != null) g.dataset.pageNumber = String(p.pageNumber);
  if (p.side) g.dataset.side = p.side;
  if (p.selected) g.classList.add("rm-connector-selected");

  // Smooth horizontal-leaning bezier from the mark edge to the card edge.
  const dx = (p.x2 - p.x1) / 2;
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", `M ${p.x1} ${p.y1} C ${p.x1 + dx} ${p.y1}, ${p.x2 - dx} ${p.y2}, ${p.x2} ${p.y2}`);
  path.setAttribute("stroke", p.color);
  path.setAttribute("stroke-width", "1.5"); // was 1: the thread must read at a glance (bolder pass)
  path.setAttribute("opacity", "0.6");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("fill", "none");
  const win = containerEl.ownerDocument.defaultView;
  const reducedMotion = win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  if (p.stitching && !reducedMotion) {
    // Exact path length drives the draw-in (dasharray/dashoffset need the true
    // length - a guessed constant would mistime the stitch). jsdom lacks
    // getTotalLength; tests simply skip the intro.
    try {
      const len = path.getTotalLength();
      if (Number.isFinite(len) && len > 0) {
        path.style.setProperty("--rm-stitch-len", `${len}`);
        path.classList.add("rm-connector-stitch");
        let cleanupTimer: number | undefined;
        const clearStitch = () => {
          if (cleanupTimer !== undefined) win?.clearTimeout(cleanupTimer);
          path.classList.remove("rm-connector-stitch");
          path.style.removeProperty("--rm-stitch-len");
        };
        path.addEventListener("animationend", clearStitch, { once: true });
        // animationend is not guaranteed when the host rebuilds a layer or
        // changes motion settings mid-flight. Do not let this one-shot class
        // permanently override the connector's steady-state dash style.
        cleanupTimer = win?.setTimeout(clearStitch, 1_000);
      }
    } catch { /* no getTotalLength in this DOM - draw static */ }
  }
  g.appendChild(path);

  // Anchor dot at the mark end: marks the exact point the note links from.
  const dot = doc.createElementNS(SVG_NS, "circle");
  dot.setAttribute("cx", String(p.x1));
  dot.setAttribute("cy", String(p.y1));
  dot.setAttribute("r", "3");
  dot.setAttribute("fill", p.color);
  dot.setAttribute("opacity", "0.85");
  g.appendChild(dot);

  // Card-end dot: the thread visibly ATTACHES to the card, faint at rest and
  // full when the link is active/selected (.rm-connector-end in CSS).
  const end = doc.createElementNS(SVG_NS, "circle");
  end.setAttribute("cx", String(p.x2));
  end.setAttribute("cy", String(p.y2));
  end.setAttribute("r", "2");
  end.setAttribute("fill", p.color);
  end.setAttribute("opacity", "0.45");
  end.classList.add("rm-connector-end");
  g.appendChild(end);

  svg.appendChild(g);
}

export function clearConnectors(containerEl: HTMLElement): void {
  containerEl.querySelector(".rm-connector-layer")?.remove();
}

export function clearPageConnectors(containerEl: HTMLElement, pageNumber: number, side?: "left" | "right"): void {
  const selector = side
    ? `g.rm-connector[data-page-number="${pageNumber}"][data-side="${side}"]`
    : `g.rm-connector[data-page-number="${pageNumber}"]`;
  containerEl.querySelectorAll(selector).forEach((node) => node.remove());
  const layer = containerEl.querySelector(".rm-connector-layer");
  if (layer && !layer.querySelector(".rm-connector")) layer.remove();
}
