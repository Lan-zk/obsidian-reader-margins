import { describe, it, expect } from "vitest";
import { canDeleteColor, validateSettingsMutation } from "src/settings/settings-tab";

describe("settings rules", () => {
  it("cannot delete the last color", () => {
    expect(canDeleteColor([{ id: "a" }], "a", "a")).toBe(false);
  });
  it("cannot delete the default color", () => {
    expect(canDeleteColor([{ id: "a" }, { id: "b" }], "b", "b")).toBe(false);
  });
  it("can delete a non-default non-last color", () => {
    expect(canDeleteColor([{ id: "a" }, { id: "b" }], "b", "a")).toBe(true);
  });
  it("rejects duplicate color names", () => {
    expect(validateSettingsMutation(
      [{ id: "a", name: "Yellow", value: "#fff15c" }, { id: "b", name: "Yellow", value: "#5cc8ff" }],
      "a"
    ).ok).toBe(false);
  });
});
