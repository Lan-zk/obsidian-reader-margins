import { describe, it, expect } from "vitest";
import { parsePluginData } from "src/store/plugin-data-schema";
import { cleanGeometry } from "src/domain/pdf-text-anchor";
import { validateHexColor } from "src/domain/colors";
import { isReplaceableSnapshot } from "src/export/markdown-export-service";

describe("hostile-input hardening", () => {
  it("future schema is never overwritten", () => {
    expect(parsePluginData({ schemaVersion: 99 }).state).toBe("future");
  });
  it("garbage data is invalid, not reset", () => {
    expect(parsePluginData("garbage").state).toBe("invalid");
    expect(parsePluginData({ weird: true }).state).toBe("invalid");
  });
  it("bad hex rejected everywhere", () => {
    expect(validateHexColor("javascript:alert(1)")).toBeNull();
    expect(validateHexColor("#fff;evil")).toBeNull();
  });
  it("too many rects rejected", () => {
    const rects = Array.from({ length: 300 }, () => ({ x: 0, y: 0, width: 1, height: 1 }));
    expect(() => cleanGeometry(rects, 600, 800)).toThrow();
  });
  it("non-finite coords dropped", () => {
    const out = cleanGeometry([{ x: Infinity, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 1, height: 1 }] as any, 600, 800);
    expect(out).toHaveLength(1);
  });
  it("export never overwrites an unknown file", () => {
    expect(isReplaceableSnapshot({}, "doc-1")).toBe(false);
    expect(isReplaceableSnapshot({ "reader-margins-export": false }, "doc-1")).toBe(false);
  });
});
