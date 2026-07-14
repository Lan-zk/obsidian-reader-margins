// src/host/obsidian-pdf-host.ts
// ALL private Obsidian/PDF.js access lives here (spec §6.3, §7.2).
// Every access is defensive; failure returns null, never throws.

import type { HostHandles } from "./host-typings";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function isElement(v: unknown): v is HTMLElement {
  return v instanceof HTMLElement;
}

// Probe the spec §7.2 object graph: view.viewer.child.pdfViewer (.pdfViewer inner)
export function probeHostHandles(view: unknown): HostHandles | null {
  if (!isObject(view)) return null;
  const component = (view as any).viewer;
  if (!isObject(component)) return null;
  const child = component.child;
  if (!isObject(child)) return null;
  const obsidianViewer = child.pdfViewer;       // wrapper
  if (!isObject(obsidianViewer)) return null;
  const pdfJsViewer = obsidianViewer.pdfViewer; // inner PDF.js viewer
  if (!isObject(pdfJsViewer)) return null;
  const dom = obsidianViewer.dom;
  if (!isObject(dom)) return null;
  const viewerContainerEl = dom.viewerContainerEl;
  if (!isElement(viewerContainerEl)) return null;
  const viewerEl = dom.viewerEl;
  if (!isElement(viewerEl)) return null;
  const eventBus = obsidianViewer.eventBus ?? pdfJsViewer.eventBus ?? null;

  // view.containerEl is the PDF view root (standard FileView property).
  const viewContainerEl: HTMLElement = isElement((view as any).containerEl) ? (view as any).containerEl : viewerContainerEl;

  // Toolbar slot: search the view container broadly (it may live outside viewerContainerEl).
  const toolbarSlot =
    viewContainerEl.querySelector<HTMLElement>(".pdf-toolbar-right") ??
    viewerContainerEl.querySelector<HTMLElement>(".pdf-toolbar-right") ??
    viewContainerEl.querySelector<HTMLElement>(".pdf-toolbar") ??
    undefined;

  return {
    pdfViewerComponent: component,
    pdfViewerChild: child,
    obsidianViewer,
    pdfJsViewer,
    eventBus,
    viewerContainerEl,
    viewerEl,
    viewContainerEl,
    toolbarSlot: toolbarSlot ?? undefined,
  };
}

// Read the inner PDF.js currentScale (NEVER from the wrapper).
export function readCurrentScale(h: HostHandles): number {
  const s = (h.pdfJsViewer as any)?.currentScale;
  return typeof s === "number" && Number.isFinite(s) && s > 0 ? s : 1;
}

// Find a rendered page element by 1-based page number.
export function findPageEl(h: HostHandles, pageNumber: number): HTMLElement | null {
  return h.viewerEl.querySelector<HTMLElement>(
    `.page[data-page-number="${pageNumber}"]`
  );
}

// Read PDF fingerprint for sourceSignature (spec §10.2). Private access - defensive.
// pdfDocument may be on the wrapper or the inner PDF.js viewer; check both.
// PDF.js 5.x exposes `fingerprints` (a [string|null, string|null] getter) on
// PDFDocumentProxy; fingerprints[0] is the primary fingerprint and is always
// present. Older `fingerprint`/`_pdfInfo.fingerprint` kept as fallbacks.
export function readPdfFingerprint(h: HostHandles): string | undefined {
  const doc = (h.obsidianViewer as any)?.pdfDocument ?? (h.pdfJsViewer as any)?.pdfDocument;
  if (!doc) return undefined;
  const fps = doc.fingerprints;
  const fp = Array.isArray(fps) ? fps[0] : (doc.fingerprint ?? doc._pdfInfo?.fingerprint);
  return typeof fp === "string" && fp.length > 0 ? fp : undefined;
}

// Read page count from the inner PDF.js viewer.
export function readPageCount(h: HostHandles): number | undefined {
  const pc = (h.pdfJsViewer as any)?.pagesCount;
  return typeof pc === "number" && Number.isFinite(pc) && pc > 0 ? pc : undefined;
}
