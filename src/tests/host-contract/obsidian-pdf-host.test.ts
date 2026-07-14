// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildHostFixture } from "src/tests/host-contract/host-shape-fixture";
import { probeHostHandles, readPdfFingerprint } from "src/host/obsidian-pdf-host";
import { probeCapabilities } from "src/host/host-capabilities";

describe("probeHostHandles", () => {
  it("extracts handles from a well-formed view", () => {
    const { view } = buildHostFixture({ scale: 2 });
    const h = probeHostHandles(view);
    expect(h).not.toBeNull();
    expect((h!.pdfJsViewer as any).currentScale).toBe(2);
    expect(h!.viewerContainerEl).toBe(view.containerEl);
  });
  it("returns null when viewer is missing", () => {
    expect(probeHostHandles({})).toBeNull();
    expect(probeHostHandles({ viewer: {} })).toBeNull();
    expect(probeHostHandles({ viewer: { child: {} } })).toBeNull();
  });
  it("returns null when dom.viewerContainerEl is missing", () => {
    const view = { viewer: { child: { pdfViewer: { pdfViewer: {}, dom: {} } } } };
    expect(probeHostHandles(view)).toBeNull();
  });
});

describe("probeCapabilities", () => {
  it("reports ready when all core parts present", () => {
    const { view } = buildHostFixture({ includeToolbar: true, marginWidthPx: 200 });
    const h = probeHostHandles(view)!;
    const caps = probeCapabilities(h, { hasTextLayer: true, hasSelection: true, marginWidthPx: 200, sourceSignature: "verified" });
    expect(caps.viewerCore).toBe("ready");
    expect(caps.eventBus).toBe("ready");
    expect(caps.marginSlot).toBe("ready");
    expect(caps.toolbarSlot).toBe("ready");
    expect(caps.sourceSignature).toBe("verified");
  });
  it("reports marginSlot narrow below 136px", () => {
    const { view } = buildHostFixture({ marginWidthPx: 100 });
    const caps = probeCapabilities(probeHostHandles(view)!, { marginWidthPx: 100 });
    expect(caps.marginSlot).toBe("narrow");
  });
  it("reports toolbarSlot missing when no toolbar element", () => {
    const { view } = buildHostFixture({ includeToolbar: false });
    const caps = probeCapabilities(probeHostHandles(view)!, {});
    expect(caps.toolbarSlot).toBe("missing");
  });
});

describe("readPdfFingerprint", () => {
  it("reads fingerprints[0] (PDF.js 5.x API)", () => {
    const { view } = buildHostFixture({ fingerprint: "fp-a" });
    expect(readPdfFingerprint(probeHostHandles(view)!)).toBe("fp-a");
  });
  it("returns undefined when fingerprints[0] is null", () => {
    const { view } = buildHostFixture({});
    (view as any).viewer.child.pdfViewer.pdfViewer.pdfDocument = { fingerprints: [null, null] };
    expect(readPdfFingerprint(probeHostHandles(view)!)).toBeUndefined();
  });
  it("returns undefined when no pdfDocument", () => {
    const { view } = buildHostFixture({});
    expect(readPdfFingerprint(probeHostHandles(view)!)).toBeUndefined();
  });
});
