import { describe, it, expect } from "vitest";
import { DiagnosticsReporter } from "src/diagnostics/diagnostics-reporter";

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
});
