import { describe, it, expect } from "vitest";
import { aggregateSessionDiagnostics, DiagnosticsReporter } from "src/diagnostics/diagnostics-reporter";

describe("DiagnosticsReporter", () => {
  it("formats a report with all required fields", () => {
    const r = new DiagnosticsReporter();
    r.set("obsidianVersion", "1.12.7");
    r.set("pdfJsVersion", "5.3.34");
    r.set("unresolvedCount", 2);
    r.set("persistenceStatus", "saved");
    const out = r.report();
    expect(out).toContain("obsidianVersion: 1.12.7");
    expect(out).toContain("pdfJsVersion: 5.3.34");
    expect(out).toContain("unresolvedCount: 2");
    expect(out).toContain("persistenceStatus: saved");
  });
  it("overwrites a field when set twice", () => {
    const r = new DiagnosticsReporter();
    r.set("count", 1);
    r.set("count", 5);
    expect(r.report()).toContain("count: 5");
  });
  it("emits the header line first", () => {
    const r = new DiagnosticsReporter();
    r.set("a", 1);
    expect(r.report().split("\n")[0]).toContain("Reader Margins");
  });
  it("serializes a fresh aggregate provider value for every report", () => {
    const r = new DiagnosticsReporter();
    let locatorEncodeAttempts = 1;
    r.provide("sessionDiagnostics", () => ({
      locatorEncodeAttempts,
      toolbarSlotStates: { ready: 1, fallback: 0, missing: 0, unknown: 0 },
    }));

    expect(r.report()).toContain(
      'sessionDiagnostics: {"locatorEncodeAttempts":1,"toolbarSlotStates":{"ready":1,"fallback":0,"missing":0,"unknown":0}}',
    );

    locatorEncodeAttempts = 2;
    expect(r.report()).toContain(
      'sessionDiagnostics: {"locatorEncodeAttempts":2,"toolbarSlotStates":{"ready":1,"fallback":0,"missing":0,"unknown":0}}',
    );
  });
  it("increments the toolbar fallback bucket from a session snapshot", () => {
    const aggregate = aggregateSessionDiagnostics([{
      disposerCount: 3,
      diagnosticsSnapshot: () => ({
        locatorEncodeAttempts: 0,
        locatorEncodeSuccesses: 0,
        locatorDecodeAttempts: 0,
        locatorDecodeSuccesses: 0,
        quoteResolutions: 0,
        geometryFallbacks: 0,
        unresolvedAnchors: 0,
        scaleEvents: 0,
        resizeInvalidations: 0,
        toolbarSlotState: "fallback" as const,
        pageNavigationCapabilityState: "unknown" as const,
      }),
    }]);

    expect(aggregate.toolbarSlotStates).toEqual({ ready: 0, fallback: 1, missing: 0, unknown: 0 });
    expect(aggregate.pageNavigationCapabilityStates).toEqual({ ready: 0, missing: 0, unknown: 1 });
  });
  it("isolates throwing and unserializable providers without exposing error details", () => {
    const r = new DiagnosticsReporter();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    r.provide("throwing", () => { throw new Error("private provider detail"); });
    r.provide("healthy", () => ({ count: 2 }));
    r.provide("circular", () => circular);

    const out = r.report();
    expect(out).toContain("throwing: [unavailable]");
    expect(out).toContain('healthy: {"count":2}');
    expect(out).toContain("circular: [unavailable]");
    expect(out).not.toContain("private provider detail");
  });
  it("uses only the most recently registered value for a duplicate key", () => {
    const fromSetThenProvider = new DiagnosticsReporter();
    fromSetThenProvider.set("duplicate", 1);
    fromSetThenProvider.provide("duplicate", () => 2);
    expect(fromSetThenProvider.report().match(/^duplicate:/gm)).toHaveLength(1);
    expect(fromSetThenProvider.report()).toContain("duplicate: 2");

    const fromProviderThenSet = new DiagnosticsReporter();
    fromProviderThenSet.provide("duplicate", () => 1);
    fromProviderThenSet.set("duplicate", 2);
    expect(fromProviderThenSet.report().match(/^duplicate:/gm)).toHaveLength(1);
    expect(fromProviderThenSet.report()).toContain("duplicate: 2");
  });
});
