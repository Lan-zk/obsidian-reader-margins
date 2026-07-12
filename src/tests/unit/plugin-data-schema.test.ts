import { describe, it, expect } from "vitest";
import { parsePluginData, makeDefaultData } from "src/store/plugin-data-schema";

describe("parsePluginData", () => {
  it("absent when null/undefined", () => {
    expect(parsePluginData(null).state).toBe("absent");
    expect(parsePluginData(undefined).state).toBe("absent");
  });
  it("invalid for non-object", () => {
    expect(parsePluginData("nope").state).toBe("invalid");
    expect(parsePluginData(42).state).toBe("invalid");
  });
  it("invalid when schemaVersion missing", () => {
    expect(parsePluginData({ settings: {} }).state).toBe("invalid");
  });
  it("future when schemaVersion > 1 (must NOT overwrite)", () => {
    const r = parsePluginData({ schemaVersion: 2, documents: {} });
    expect(r.state).toBe("future");
    expect(r.data).toBeNull();
  });
  it("valid for well-formed v1", () => {
    const r = parsePluginData({
      schemaVersion: 1, stateRevision: 5,
      settings: { colors: [{ id: "yellow", name: "Yellow", value: "#fff15c" }], defaultColorId: "yellow" },
      documents: {},
    });
    expect(r.state).toBe("valid");
    expect(r.data!.stateRevision).toBe(5);
    expect(r.data!.settings.defaultColorId).toBe("yellow");
  });
  it("invalid when color value is bad hex", () => {
    const r = parsePluginData({
      schemaVersion: 1, settings: { colors: [{ id: "x", name: "X", value: "bad" }], defaultColorId: "x" }, documents: {},
    });
    expect(r.state).toBe("invalid");
  });
  it("makeDefaultData has schemaVersion 1 and defaults", () => {
    const d = makeDefaultData();
    expect(d.schemaVersion).toBe(1);
    expect(d.settings.colors.length).toBeGreaterThanOrEqual(1);
    expect(d.settings.defaultColorId).toBeTruthy();
  });
});
