import { describe, it, expect } from "vitest";
import { DraftController } from "src/session/draft-controller";

describe("DraftController", () => {
  it("begins with original value and commits current value", () => {
    const d = new DraftController();
    d.begin("a1", 1, "orig");
    d.update("a1", "changed");
    const c = d.commit("a1");
    expect(c).toEqual({ id: "a1", value: "changed", baseRevision: 1 });
    expect(d.has("a1")).toBe(false);
  });
  it("cancel restores nothing and clears draft", () => {
    const d = new DraftController();
    d.begin("a1", 1, "orig");
    d.update("a1", "temp");
    d.cancel("a1");
    expect(d.has("a1")).toBe(false);
  });
  it("peek exposes baseRevision for conflict detection", () => {
    const d = new DraftController();
    d.begin("a1", 1, "orig");
    const draft = d.peek("a1");
    expect(draft?.baseRevision).toBe(1);
  });
});
