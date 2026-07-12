import { describe, it, expect, vi } from "vitest";
import { DisposableScope } from "src/session/disposable-scope";

describe("DisposableScope", () => {
  it("runs disposer fns in reverse order on disposeAll", () => {
    const log: string[] = [];
    const scope = new DisposableScope();
    scope.addDispose(() => log.push("a"));
    scope.addDispose(() => log.push("b"));
    scope.disposeAll();
    expect(log).toEqual(["b", "a"]);
  });
  it("disposes a Disposable object via its dispose()", () => {
    const d = { dispose: vi.fn() };
    const scope = new DisposableScope();
    scope.add(d);
    scope.disposeAll();
    expect(d.dispose).toHaveBeenCalledOnce();
  });
  it("is idempotent and reports size", () => {
    const scope = new DisposableScope();
    scope.addDispose(() => {});
    expect(scope.size).toBe(1);
    scope.disposeAll();
    scope.disposeAll();
    expect(scope.size).toBe(0);
  });
  it("one throwing disposer does not block the rest", () => {
    const log: string[] = [];
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const scope = new DisposableScope();
    scope.addDispose(() => { throw new Error("x"); });
    scope.addDispose(() => log.push("after"));
    scope.disposeAll();
    expect(log).toEqual(["after"]);
    errSpy.mockRestore();
  });
});
