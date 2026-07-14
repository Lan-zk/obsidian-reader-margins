import { describe, it, expect } from "vitest";
import { DEFAULT_COLORS, validateHexColor, findColor, normalizeColors, validateSettingsMutation, MAX_COLORS } from "src/domain/colors";

describe("colors", () => {
  it("validates #RRGGBB", () => {
    expect(validateHexColor("#fff15c")).toBe("#fff15c");
    expect(validateHexColor("#FFF15C")).toBe("#FFF15C");
    expect(validateHexColor("fff15c")).toBeNull();
    expect(validateHexColor("#fff15")).toBeNull();
    expect(validateHexColor("#gggggg")).toBeNull();
    expect(validateHexColor("")).toBeNull();
  });
  it("DEFAULT_COLORS has Yellow/Blue/Green/Red with stable ids", () => {
    const ids = DEFAULT_COLORS.map((c) => c.id);
    expect(ids).toEqual(["yellow", "blue", "green", "red"]);
    for (const c of DEFAULT_COLORS) expect(validateHexColor(c.value)).toBe(c.value);
  });
  it("findColor by id", () => {
    expect(findColor(DEFAULT_COLORS, "blue")?.name).toBe("Blue");
    expect(findColor(DEFAULT_COLORS, "nope")).toBeUndefined();
  });
  it("normalizeColors dedupes empty/duplicate ids and filters invalid hex", () => {
    const out = normalizeColors([
      { id: "a", name: "A", value: "#111111" },
      { id: "", name: "B", value: "#222222" },
      { id: "a", name: "A2", value: "#333333" },
      { id: "c", name: "C", value: "bad" },
    ]);
    expect(out.map((c) => c.id)).toEqual(["a", "auto-1", "auto-2"]);
    expect(out.every((c) => validateHexColor(c.value))).toBe(true);
  });
  it("normalizeColors caps at MAX_COLORS", () => {
    const input = Array.from({ length: MAX_COLORS + 4 }, (_, i) => ({ id: `c${i}`, name: `C${i}`, value: "#111111" }));
    expect(normalizeColors(input)).toHaveLength(MAX_COLORS);
  });
  it("validateSettingsMutation rejects more than MAX_COLORS", () => {
    const rows = Array.from({ length: MAX_COLORS + 1 }, (_, i) => ({ id: `c${i}`, name: `C${i}`, value: "#111111" }));
    expect(validateSettingsMutation(rows, "c0").ok).toBe(false);
    expect(validateSettingsMutation(rows.slice(0, MAX_COLORS), "c0").ok).toBe(true);
  });
});
