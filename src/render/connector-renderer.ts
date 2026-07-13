// src/render/connector-renderer.ts
export interface ConnectorPoints { x1: number; y1: number; x2: number; y2: number; color: string; id?: string; selected?: boolean; }

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
  if (p.id) svg.querySelector(`g.rm-connector[data-annotation-id="${p.id}"]`)?.remove();

  const doc = containerEl.ownerDocument;
  const g = doc.createElementNS(SVG_NS, "g");
  g.classList.add("rm-connector");
  if (p.id) g.dataset.annotationId = p.id;
  if (p.selected) g.classList.add("rm-connector-selected");

  // Smooth horizontal-leaning bezier from the mark edge to the card edge.
  const dx = (p.x2 - p.x1) / 2;
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", `M ${p.x1} ${p.y1} C ${p.x1 + dx} ${p.y1}, ${p.x2 - dx} ${p.y2}, ${p.x2} ${p.y2}`);
  path.setAttribute("stroke", p.color);
  path.setAttribute("stroke-width", "1");
  path.setAttribute("opacity", "0.5");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("fill", "none");
  g.appendChild(path);

  // Anchor dot at the mark end: marks the exact point the note links from.
  const dot = doc.createElementNS(SVG_NS, "circle");
  dot.setAttribute("cx", String(p.x1));
  dot.setAttribute("cy", String(p.y1));
  dot.setAttribute("r", "2.5");
  dot.setAttribute("fill", p.color);
  dot.setAttribute("opacity", "0.7");
  g.appendChild(dot);

  svg.appendChild(g);
}

export function clearConnectors(containerEl: HTMLElement): void {
  containerEl.querySelector(".rm-connector-layer")?.remove();
}
