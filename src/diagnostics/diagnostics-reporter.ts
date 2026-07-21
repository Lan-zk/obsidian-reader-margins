// src/diagnostics/diagnostics-reporter.ts
// Collects runtime diagnostics for dev-tools inspection (spec §16.1).
// Exposed via app.plugins.plugins["reader-margins"].diagnostics.report().

import type { ViewerSessionDiagnostics } from "src/session/viewer-session";

interface SessionDiagnosticsSource {
  disposerCount: number;
  diagnosticsSnapshot(): ViewerSessionDiagnostics;
}

export function aggregateSessionDiagnostics(sessions: Iterable<SessionDiagnosticsSource>) {
  const aggregate = {
    sessionCount: 0,
    totalDisposerCount: 0,
    locatorEncodeAttempts: 0,
    locatorEncodeSuccesses: 0,
    locatorDecodeAttempts: 0,
    locatorDecodeSuccesses: 0,
    quoteResolutions: 0,
    geometryFallbacks: 0,
    unresolvedAnchors: 0,
    scaleEvents: 0,
    resizeInvalidations: 0,
    toolbarSlotStates: { ready: 0, fallback: 0, missing: 0, unknown: 0 },
    pageNavigationCapabilityStates: { ready: 0, missing: 0, unknown: 0 },
  };
  for (const session of sessions) {
    aggregate.sessionCount++;
    aggregate.totalDisposerCount += session.disposerCount;
    const snapshot = session.diagnosticsSnapshot();
    aggregate.locatorEncodeAttempts += snapshot.locatorEncodeAttempts;
    aggregate.locatorEncodeSuccesses += snapshot.locatorEncodeSuccesses;
    aggregate.locatorDecodeAttempts += snapshot.locatorDecodeAttempts;
    aggregate.locatorDecodeSuccesses += snapshot.locatorDecodeSuccesses;
    aggregate.quoteResolutions += snapshot.quoteResolutions;
    aggregate.geometryFallbacks += snapshot.geometryFallbacks;
    aggregate.unresolvedAnchors += snapshot.unresolvedAnchors;
    aggregate.scaleEvents += snapshot.scaleEvents;
    aggregate.resizeInvalidations += snapshot.resizeInvalidations;
    aggregate.toolbarSlotStates[snapshot.toolbarSlotState]++;
    aggregate.pageNavigationCapabilityStates[snapshot.pageNavigationCapabilityState]++;
  }
  return aggregate;
}

export class DiagnosticsReporter {
  private fields = new Map<string, unknown>();
  private providers = new Map<string, () => unknown>();

  set(key: string, value: unknown): void {
    this.providers.delete(key);
    this.fields.set(key, value);
  }

  provide(key: string, provider: () => unknown): void {
    this.fields.delete(key);
    this.providers.set(key, provider);
  }

  // Strings render bare; other values use JSON so numbers/booleans/objects stay legible.
  report(): string {
    const lines: string[] = ["# Reader Margins diagnostics"];
    for (const [k, v] of this.fields) {
      lines.push(`${k}: ${this.format(v)}`);
    }
    for (const [k, provider] of this.providers) {
      try {
        lines.push(`${k}: ${this.format(provider())}`);
      } catch {
        lines.push(`${k}: [unavailable]`);
      }
    }
    return lines.join("\n");
  }

  private format(value: unknown): string {
    try {
      return typeof value === "string" ? value : (JSON.stringify(value) ?? "undefined");
    } catch {
      return "[unavailable]";
    }
  }
}
