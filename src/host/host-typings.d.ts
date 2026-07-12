// Shadow types for Obsidian's private PDF viewer structure (spec §7.2).
// Runtime MUST validate every field; these types are NOT a guarantee.
// Verified against PDF++ typings at design time; re-verify in M-1 smoke gate.

export interface HostHandles {
  pdfViewerComponent: unknown;      // view.viewer
  pdfViewerChild: unknown;          // view.viewer.child
  obsidianViewer: unknown;          // view.viewer.child.pdfViewer  (wrapper)
  pdfJsViewer: unknown;             // view.viewer.child.pdfViewer.pdfViewer  (inner PDF.js)
  eventBus: unknown;                // PDF.js EventBus
  viewerContainerEl: HTMLElement;   // obsidianViewer.dom.viewerContainerEl
  viewerEl: HTMLElement;            // obsidianViewer.dom.viewerEl
  toolbarSlot?: HTMLElement;        // probed toolbar container
}

export interface HostCapabilities {
  viewerCore: "ready" | "missing";
  eventBus: "ready" | "missing";
  textLayer: "ready" | "missing";
  selection: "ready" | "missing";
  marginSlot: "ready" | "narrow" | "missing";
  toolbarSlot: "ready" | "fallback" | "missing";
  sourceSignature: "verified" | "mismatch" | "unknown";
}

// Minimal shape of the fake event bus used in host-contract tests.
export interface FakeEventBus {
  on(event: string, handler: (e: unknown) => void): void;
  off(event: string, handler: (e: unknown) => void): void;
  dispatch(event: string, data?: unknown): void;
}
