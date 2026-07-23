// src/render/icons.ts
// Inline SVG icons built via the DOM API (no innerHTML - spec §14.1).
// 24×24 viewBox, 2px round stroke: geometric rigor matching the 1px UI borders at
// 16px render size (docs/design.md: "icons should follow this geometric rigor,
// using consistent stroke weights that match the UI borders").

const SVG_NS = "http://www.w3.org/2000/svg";

type IconDef = { paths?: string[]; circles?: [number, number, number][] };

const ICONS: Record<string, IconDef> = {
  // lucide check
  check: { paths: ["M20 6 9 17l-5-5"] },
  // lucide x
  x: { paths: ["M18 6 6 18", "M6 6l12 12"] },
  // lucide trash-2
  trash: {
    paths: [
      "M3 6h18",
      "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",
      "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
      "M10 11v6",
      "M14 11v6",
    ],
  },
  // lucide underline
  underline: { paths: ["M6 4v6a6 6 0 0 0 12 0V4", "M4 20h16"] },
  // lucide highlighter
  highlighter: {
    paths: ["m9 11-6 6v3h9l3-3", "m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4Z"],
  },
  // lucide download
  download: { paths: ["M12 15V3", "M7 10l5 5 5-5", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"] },
  // lucide grip-vertical (filled dots)
  grip: { circles: [[9, 5, 1.5], [9, 12, 1.5], [9, 19, 1.5], [15, 5, 1.5], [15, 12, 1.5], [15, 19, 1.5]] },
  // lucide square-arrow-out-up-right (popout): used for the card<->popover convert
  // button. Suggests "float out as a popover" / "pop back into a card".
  popover: { paths: ["M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6", "M21 3l-6 6", "M15 3h6v6"] },
};

export type IconName = keyof typeof ICONS;

export function createIcon(doc: Document, name: IconName, size = 16): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const def = ICONS[name];
  for (const d of def.paths ?? []) {
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  // Filled dots (e.g. grip handle): stroke:none so they render solid, not outlined.
  for (const [cx, cy, r] of def.circles ?? []) {
    const circle = doc.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", String(cx));
    circle.setAttribute("cy", String(cy));
    circle.setAttribute("r", String(r));
    circle.setAttribute("fill", "currentColor");
    circle.setAttribute("stroke", "none");
    svg.appendChild(circle);
  }
  return svg;
}
