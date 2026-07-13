// src/diagnostics/diagnostics-reporter.ts
// Collects runtime diagnostics for dev-tools inspection (spec §16.1).
// Exposed via app.plugins.plugins["reader-margins"].diagnostics.report().

export class DiagnosticsReporter {
  private fields = new Map<string, unknown>();

  set(key: string, value: unknown): void {
    this.fields.set(key, value);
  }

  // Strings render bare; other values use JSON so numbers/booleans/objects stay legible.
  report(): string {
    const lines: string[] = ["# Reader Margins diagnostics"];
    for (const [k, v] of this.fields) {
      const val = typeof v === "string" ? v : JSON.stringify(v);
      lines.push(`${k}: ${val}`);
    }
    return lines.join("\n");
  }
}
