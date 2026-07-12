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
});
