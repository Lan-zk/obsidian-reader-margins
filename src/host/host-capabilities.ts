// src/host/host-capabilities.ts
import type { HostCapabilities, HostHandles } from "./host-typings";
import { readCurrentScale } from "./obsidian-pdf-host";

export interface CapabilityProbeInput {
  hasTextLayer?: boolean;
  hasSelection?: boolean;
  marginWidthPx?: number;
  sourceSignature?: "verified" | "mismatch" | "unknown";
}

const NARROW_THRESHOLD_PX = 136;

export function probeCapabilities(
  h: HostHandles,
  input: CapabilityProbeInput = {}
): HostCapabilities {
  const eventBusReady = typeof (h.eventBus as any)?.on === "function";
  const hasTextLayer = input.hasTextLayer ?? !!h.viewerEl.querySelector(".textLayer");
  const marginWidth = input.marginWidthPx ?? measureMarginWidth(h);

  let marginSlot: HostCapabilities["marginSlot"] = "missing";
  if (typeof marginWidth === "number" && Number.isFinite(marginWidth)) {
    if (marginWidth >= NARROW_THRESHOLD_PX) marginSlot = "ready";
    else marginSlot = "narrow";
  }

  // toolbarSlot: "ready" if the dedicated slot was found, else "missing".
  // The ToolbarController falls back to viewerContainerEl internally when missing.
  // ("fallback" is reserved for a future fallback-slot probe.)
  const toolbarSlot: HostCapabilities["toolbarSlot"] = h.toolbarSlot ? "ready" : "missing";

  return {
    viewerCore: "ready",
    eventBus: eventBusReady ? "ready" : "missing",
    textLayer: hasTextLayer ? "ready" : "missing",
    selection: input.hasSelection === false ? "missing" : "ready",
    marginSlot,
    toolbarSlot,
    sourceSignature: input.sourceSignature ?? "unknown",
  };
}

// Single-side margin = (containerWidth - pageWidth) / 2 - 16px padding (spec §5.4).
function measureMarginWidth(h: HostHandles): number | undefined {
  const container = h.viewerContainerEl;
  const page = h.viewerEl.querySelector<HTMLElement>(".page");
  if (!container || !page) return undefined;
  const cw = container.getBoundingClientRect().width;
  const pw = page.getBoundingClientRect().width / readCurrentScale(h);
  if (!Number.isFinite(cw) || !Number.isFinite(pw) || cw <= 0 || pw <= 0) return undefined;
  return Math.max(0, (cw - pw) / 2 - 16);
}

export function coreReady(c: HostCapabilities): boolean {
  return (
    c.viewerCore === "ready" &&
    c.eventBus === "ready" &&
    c.textLayer === "ready" &&
    c.selection === "ready" &&
    c.sourceSignature === "verified"
  );
}
