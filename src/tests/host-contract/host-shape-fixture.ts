import type { FakeEventBus } from "src/host/host-typings";

// Shape matches spec §7.2 object graph. NOT real Obsidian - for tests only.
export function makeFakeEventBus(): FakeEventBus & { handlers: Map<string, Set<Function>> } {
  const handlers = new Map<string, Set<Function>>();
  return {
    handlers,
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    },
    off(event, handler) { handlers.get(event)?.delete(handler); },
    dispatch(event, data) { handlers.get(event)?.forEach((h) => h(data)); },
  };
}

export interface FixturePage { el: HTMLElement; textLayer: HTMLElement; pageNumber: number; }

export interface HostFixtureOptions {
  numPages?: number;
  scale?: number;
  includeToolbar?: boolean;
  marginWidthPx?: number;
  fingerprint?: string;
}

export function buildHostFixture(opts: HostFixtureOptions = {}) {
  const numPages = opts.numPages ?? 1;
  const scale = opts.scale ?? 1;
  const eventBus = makeFakeEventBus();
  const containerEl = document.createElement("div");
  containerEl.className = "pdf-viewer-container";
  const viewerEl = document.createElement("div");
  containerEl.appendChild(viewerEl);
  const pages: FixturePage[] = [];
  for (let i = 1; i <= numPages; i++) {
    const page = document.createElement("div");
    page.className = "page";
    page.dataset.pageNumber = String(i);
    const textLayer = document.createElement("div");
    textLayer.className = "textLayer";
    page.appendChild(textLayer);
    viewerEl.appendChild(page);
    pages.push({ el: page, textLayer, pageNumber: i });
  }
  const margin = opts.marginWidthPx ?? 200;
  containerEl.style.width = `${600 + margin * 2}px`;
  const pdfJsViewer: any = { currentScale: scale, pagesCount: numPages };
  if (opts.fingerprint !== undefined) pdfJsViewer.pdfDocument = { fingerprint: opts.fingerprint };
  const obsidianViewer = { pdfViewer: pdfJsViewer, dom: { viewerContainerEl: containerEl, viewerEl }, eventBus };
  const child = { pdfViewer: obsidianViewer };
  const view = { viewer: { child }, file: { path: "test.pdf" }, containerEl };
  if (opts.includeToolbar ?? true) {
    const toolbar = document.createElement("div");
    toolbar.className = "pdf-toolbar-right";
    containerEl.appendChild(toolbar);
  }
  return { view, pages, eventBus, containerEl };
}
