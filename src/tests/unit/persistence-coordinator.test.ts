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
});
