// src/store/persistence-coordinator.ts
import type { PluginDataV1 } from "src/store/plugin-data-schema";
import { snapshotData } from "src/store/plugin-data-schema";

export type PersistenceStatus =
  | { state: "saved"; revision: number }
  | { state: "saving"; revision: number }
  | { state: "dirty"; revision: number }
  | { state: "failed"; revision: number; message: string };

export type SaveFn = (data: PluginDataV1) => Promise<void>;

export interface CoordinatorOptions { backoffMs?: number; maxBackoffMs?: number; }

export class PersistenceCoordinator {
  private inFlight: Promise<void> | null = null;
  private pending: { data: PluginDataV1; revision: number } | null = null;
  private status: PersistenceStatus = { state: "saved", revision: 0 };
  private listeners = new Set<(s: PersistenceStatus) => void>();
  private backoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly initialBackoffMs: number;
  // Sealed by finalize(): the unload path. Once set, enqueue/drain stop
  // accepting or re-queueing work so a stale older snapshot cannot overwrite
  // the finalized newest one (spec §5.1).
  private finalized = false;

  constructor(private save: SaveFn, opts: CoordinatorOptions = {}) {
    this.initialBackoffMs = opts.backoffMs ?? 100;
    this.backoffMs = this.initialBackoffMs;
    this.maxBackoffMs = opts.maxBackoffMs ?? 5000;
  }

  onStatus(cb: (s: PersistenceStatus) => void): () => void {
    this.listeners.add(cb);
    cb(this.status);
    return () => this.listeners.delete(cb);
  }

  enqueue(data: PluginDataV1, revision: number): void {
    if (this.finalized) return; // coordinator sealed by finalize()
    this.pending = { data: snapshotData(data), revision };
    this.setStatus({ state: "dirty", revision });
    if (!this.inFlight) void this.drain();
  }

  flushBestEffort(): Promise<void> {
    return this.inFlight ?? Promise.resolve();
  }

  // Best-effort final save on unload. Obsidian does not await onunload or
  // register callbacks, so flushBestEffort() alone can leave the newest
  // snapshot unsaved. finalize() writes the latest full snapshot, chained
  // after any in-flight save so an older snapshot cannot overwrite it. The
  // coordinator is sealed: pending is dropped (the finalized snapshot is newer
  // and full) and a failed in-flight save is not re-queued. Returns the chain
  // so callers/tests can await it; on unload the promise runs to completion in
  // the background (for local vaults the Node.js fs write outlives the plugin
  // JS context).
  finalize(data: PluginDataV1): Promise<void> {
    this.finalized = true;
    this.pending = null;
    const snapshot = snapshotData(data);
    const prev = this.inFlight;
    return (prev ?? Promise.resolve())
      .then(() => this.save(snapshot))
      .catch(() => { /* best-effort: swallow on unload */ });
  }

  private async drain(): Promise<void> {
    while (this.pending && !this.finalized) {
      const { data, revision } = this.pending;
      this.pending = null;
      this.setStatus({ state: "saving", revision });
      this.inFlight = this.save(data).then(
        () => {
          this.backoffMs = this.initialBackoffMs;
          this.setStatus({ state: "saved", revision });
        },
        (err) => {
          this.setStatus({ state: "failed", revision, message: String(err?.message ?? err) });
          const wait = this.backoffMs;
          this.backoffMs = Math.min(this.maxBackoffMs, this.backoffMs * 2);
          // C-01: do not clobber a newer pending that arrived during save. The
          // failed snapshot is superseded by the newer one (snapshots are full
          // state), so only re-queue the failed snapshot when nothing newer is
          // waiting. Otherwise the newer pending is saved next and the stale
          // failure is discarded.
          if (this.pending === null && !this.finalized) {
            this.pending = { data, revision };
          }
          return new Promise<void>((res) => setTimeout(res, wait));
        }
      );
      await this.inFlight;
    }
    this.inFlight = null;
  }

  private setStatus(s: PersistenceStatus): void {
    this.status = s;
    for (const cb of this.listeners) cb(s);
  }
}
