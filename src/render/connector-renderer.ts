// src/render/connector-renderer.ts
export interface ConnectorPoints { x1: number; y1: number; x2: number; y2: number; color: string; }

export function drawEphemeralConnector(containerEl: HTMLElement, p: ConnectorPoints): void {
  let svg = containerEl.querySelector<SVGSVGElement>(".rm-connector-layer");
  if (!svg) {
    svg = containerEl.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("rm-connector-layer");
    containerEl.appendChild(svg);
  }
  const path = containerEl.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path");
  const dx = (p.x2 - p.x1) / 2;
  path.setAttribute("d", `M ${p.x1} ${p.y1} C ${p.x1 + dx} ${p.y1}, ${p.x2 - dx} ${p.y2}, ${p.x2} ${p.y2}`);
  path.setAttribute("stroke", p.color);
  path.setAttribute("stroke-width", "1");
  path.setAttribute("opacity", "0.45");
  path.setAttribute("fill", "none");
  svg.appendChild(path);
}
