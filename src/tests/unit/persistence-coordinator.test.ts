import { describe, it, expect, vi } from "vitest";
import { PersistenceCoordinator } from "src/store/persistence-coordinator";
import { makeDefaultData, type PluginDataV1 } from "src/store/plugin-data-schema";

describe("PersistenceCoordinator", () => {
  it("serializes: only one save in flight; latest snapshot wins", async () => {
    let resolveSave: () => void = () => {};
    const save = vi.fn((_data: PluginDataV1) => new Promise<void>((res) => { resolveSave = res; }));
    const coord = new PersistenceCoordinator(save);

    coord.enqueue({ ...makeDefaultData(), stateRevision: 1 }, 1);
    coord.enqueue({ ...makeDefaultData(), stateRevision: 2 }, 2);
    coord.enqueue({ ...makeDefaultData(), stateRevision: 3 }, 3);
    expect(save).toHaveBeenCalledTimes(1);
    resolveSave();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    resolveSave();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0].stateRevision).toBe(3);
  });
  it("sets failed status and retries with backoff on save error", async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new Error("disk"))
      .mockResolvedValueOnce(undefined);
    const coord = new PersistenceCoordinator(save, { backoffMs: 5 });
    const statuses: string[] = [];
    coord.onStatus((s) => statuses.push(s.state));
    coord.enqueue({ ...makeDefaultData(), stateRevision: 1 }, 1);
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(statuses).toContain("failed");
    expect(statuses[statuses.length - 1]).toBe("saved");
  });
  it("flushBestEffort awaits an in-flight save", async () => {
    let resolveSave: () => void = () => {};
    const save = vi.fn((_data: PluginDataV1) => new Promise<void>((res) => { resolveSave = res; }));
    const coord = new PersistenceCoordinator(save);
    coord.enqueue({ ...makeDefaultData(), stateRevision: 1 }, 1);
    const flushP = coord.flushBestEffort();
    resolveSave();
    await flushP;
    expect(save).toHaveBeenCalledTimes(1);
  });
  it("failure does not clobber a newer pending snapshot (C-01)", async () => {
    let resolveSave: (ok: boolean) => void = () => {};
    const save = vi.fn((_data: PluginDataV1) => new Promise<void>((res, rej) => {
      resolveSave = (ok) => (ok ? res() : rej(new Error("disk")));
    }));
    const coord = new PersistenceCoordinator(save, { backoffMs: 5 });
    const statuses: string[] = [];
    coord.onStatus((s) => statuses.push(`${s.state}:${s.revision}`));

    coord.enqueue({ ...makeDefaultData(), stateRevision: 1 }, 1);
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1)); // saving rev1
    // While rev1 is in flight, enqueue rev2 (a newer full-state snapshot)
    coord.enqueue({ ...makeDefaultData(), stateRevision: 2 }, 2);
    // rev1 fails
    resolveSave(false);
    // After failure + backoff, rev2 (not rev1) must be the next save
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    resolveSave(true);
    await vi.waitFor(() => expect(statuses).toContain("saved:2"));
    // The last save must be rev2, not a stale rev1 retry
    expect(save.mock.calls.at(-1)![0].stateRevision).toBe(2);
  });
  it("failure with no newer pending retries the failed snapshot", async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new Error("disk"))
      .mockResolvedValueOnce(undefined);
    const coord = new PersistenceCoordinator(save, { backoffMs: 5 });
    const statuses: string[] = [];
    coord.onStatus((s) => statuses.push(`${s.state}:${s.revision}`));
    coord.enqueue({ ...makeDefaultData(), stateRevision: 5 }, 5);
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(statuses.at(-1)).toBe("saved:5");
    expect(save.mock.calls.at(-1)![0].stateRevision).toBe(5);
  });

  // finalize() is the unload path. Obsidian does not await onunload/register
  // callbacks, so flushBestEffort() (which only returns the in-flight promise)
  // can leave the newest snapshot unsaved. finalize() writes the latest full
  // snapshot, chained after any in-flight save so an older snapshot cannot
  // overwrite it (spec §5.1).
  it("finalize saves the latest snapshot when nothing is in flight", async () => {
    const save = vi.fn(async (_d: PluginDataV1) => {});
    const coord = new PersistenceCoordinator(save);
    await coord.finalize({ ...makeDefaultData(), stateRevision: 7 });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].stateRevision).toBe(7);
  });

  it("finalize chains after an in-flight save so the newest snapshot is written last", async () => {
    let resolveFirst: () => void = () => {};
    const save = vi.fn((d: PluginDataV1) => {
      if (d.stateRevision === 1) return new Promise<void>((res) => { resolveFirst = res; });
      return Promise.resolve();
    });
    const coord = new PersistenceCoordinator(save);
    // rev1 is in flight (blocked); rev2 is pending.
    coord.enqueue({ ...makeDefaultData(), stateRevision: 1 }, 1);
    coord.enqueue({ ...makeDefaultData(), stateRevision: 2 }, 2);
    expect(save).toHaveBeenCalledTimes(1); // rev1 saving
    // finalize with rev3 (the newest full snapshot). Must not fire until rev1 completes.
    const finalizeP = coord.finalize({ ...makeDefaultData(), stateRevision: 3 });
    expect(save).toHaveBeenCalledTimes(1); // still only rev1 in flight
    resolveFirst();
    await finalizeP;
    // rev3 (the finalize snapshot) is the last write; rev2's pending is dropped
    // because rev3 is a newer full snapshot that supersedes it.
    expect(save.mock.calls.at(-1)![0].stateRevision).toBe(3);
  });

  it("finalize drops a pending older snapshot and writes the finalized one", async () => {
    const saved: number[] = [];
    const save = vi.fn(async (d: PluginDataV1) => { saved.push(d.stateRevision); });
    const coord = new PersistenceCoordinator(save);
    coord.enqueue({ ...makeDefaultData(), stateRevision: 1 }, 1);
    await coord.finalize({ ...makeDefaultData(), stateRevision: 9 });
    // rev1 may or may not have started, but the last write must be rev9.
    expect(saved.at(-1)).toBe(9);
  });

  it("enqueue after finalize is a no-op (coordinator is sealed)", async () => {
    const save = vi.fn(async (_d: PluginDataV1) => {});
    const coord = new PersistenceCoordinator(save);
    await coord.finalize({ ...makeDefaultData(), stateRevision: 4 });
    coord.enqueue({ ...makeDefaultData(), stateRevision: 5 }, 5);
    expect(save).toHaveBeenCalledTimes(1); // no second save
  });

  it("a failed in-flight save does not re-queue after finalize (no older overwrite)", async () => {
    let resolveFirst: (ok: boolean) => void = () => {};
    const save = vi.fn((d: PluginDataV1) => {
      if (d.stateRevision === 1) return new Promise<void>((res, rej) => { resolveFirst = (ok) => (ok ? res() : rej(new Error("disk"))); });
      return Promise.resolve();
    });
    const coord = new PersistenceCoordinator(save, { backoffMs: 5 });
    coord.enqueue({ ...makeDefaultData(), stateRevision: 1 }, 1);
    // finalize rev2 while rev1 is in flight, then fail rev1.
    const finalizeP = coord.finalize({ ...makeDefaultData(), stateRevision: 2 });
    resolveFirst(false); // rev1 fails
    await finalizeP;
    // rev1's failure must not re-queue rev1 after rev2 was written.
    expect(save.mock.calls.at(-1)![0].stateRevision).toBe(2);
  });
});
