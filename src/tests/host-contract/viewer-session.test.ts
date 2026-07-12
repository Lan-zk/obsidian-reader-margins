// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { buildHostFixture } from "src/tests/host-contract/host-shape-fixture";
import { ViewerSession } from "src/session/viewer-session";
import { DurableAnnotationStore } from "src/store/durable-annotation-store";

function makeStore() {
  const s = new DurableAnnotationStore(async () => {});
  s.loadAndValidate(null);
  return s;
}

describe("ViewerSession (M-1)", () => {
  it("attaches to a ready view and is idempotent", async () => {
    const { view } = buildHostFixture({ numPages: 1, marginWidthPx: 200 });
    const session = new ViewerSession(view as any, "test.pdf", makeStore());
    await session.attach();
    expect(session.state).toBe("attached");
    await session.attach();
    expect(session.state).toBe("attached");
    session.dispose();
    expect(session.state).toBe("disposed");
  });
  it("reconciles on textlayerrendered", async () => {
    const { view, eventBus } = buildHostFixture({ numPages: 1, marginWidthPx: 200 });
    const session = new ViewerSession(view as any, "test.pdf", makeStore());
    await session.attach();
    const spy = vi.spyOn(session, "reconcilePage");
    eventBus.dispatch("textlayerrendered", { pageNumber: 1 });
    expect(spy).toHaveBeenCalledWith(1);
    session.dispose();
  });
  it("dispose removes all injected DOM", async () => {
    const { view, eventBus, containerEl } = buildHostFixture({ numPages: 1, marginWidthPx: 200 });
    const session = new ViewerSession(view as any, "test.pdf", makeStore());
    await session.attach();
    eventBus.dispatch("textlayerrendered", { pageNumber: 1 });
    session.dispose();
    expect(containerEl.querySelector(".rm-card-rail")).toBeNull();
    expect(containerEl.querySelector(".rm-connector-layer")).toBeNull();
    expect(session.disposerCount).toBe(0);
  });
  it("enters degraded after probe timeout when host missing", async () => {
    const session = new ViewerSession({} as any, "test.pdf", makeStore(), { probeIntervalMs: 10, probeTimeoutMs: 40 });
    await session.attach();
    expect(session.state).toBe("degraded");
    session.dispose();
  });
});
