import { describe, it, expect } from "vitest";
import { parsePluginData } from "src/store/plugin-data-schema";
import { cleanGeometry } from "src/domain/pdf-text-anchor";
import { validateHexColor } from "src/domain/colors";
import { isReplaceableSnapshot } from "src/export/markdown-export-service";

function pluginDataWithCardPosition(cardPosition: unknown) {
  return {
    schemaVersion: 1,
    settings: { colors: [{ id: "y", name: "Y", value: "#fff15c" }], defaultColorId: "y" },
    documents: { "a.pdf": {
      documentId: "d1", sourceSignature: { pdfFingerprint: "fp", numPages: 1 }, revision: 1,
      annotations: { a1: {
        id: "a1", revision: 1, type: "text-mark", markStyle: "highlight",
        colorLabelSnapshot: "Y", colorValueSnapshot: "#fff15c", cardPosition,
        anchor: { kind: "pdf-text", version: 1, pageNumber: 1,
          quote: { exact: "hi", normalization: "collapse-whitespace-v1" },
          geometry: { space: "page-css-v1", pageWidth: 600, pageHeight: 800, rotation: 0, rects: [{ x: 0, y: 0, width: 10, height: 10 }] } },
        createdAt: "t", updatedAt: "t",
      } },
    } },
  };
}

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
  it.each([
    ["non-finite y", { space: "page-css-v1", y: Number.NaN, x: 10 }],
    ["non-finite x", { space: "page-css-v1", y: 10, x: Number.POSITIVE_INFINITY }],
    ["unknown space", { space: "viewport-v1", y: 10, x: 10 }],
    ["negative container x", { space: "page-css-v1", y: 10, x: -1 }],
    ["nonsensical y", { space: "page-css-v1", y: "10", x: 10 }],
  ])("rejects a persisted card position with %s", (_label, cardPosition) => {
    const parsed = parsePluginData(pluginDataWithCardPosition(cardPosition));
    expect(parsed.data!.documents["a.pdf"].annotations).toEqual({});
  });
  it("rejects a persisted card position with a custom object prototype", () => {
    const cardPosition = Object.create({ space: "page-css-v1", y: 10, x: 10 });
    const parsed = parsePluginData(pluginDataWithCardPosition(cardPosition));
    expect(parsed.data!.documents["a.pdf"].annotations).toEqual({});
  });
  it("normalizes only durable y against the annotation page bounds", () => {
    const below = parsePluginData(pluginDataWithCardPosition({ space: "page-css-v1", y: -10, x: 10 }));
    const above = parsePluginData(pluginDataWithCardPosition({ space: "page-css-v1", y: 900, x: 100_000 }));
    expect(below.data!.documents["a.pdf"].annotations.a1.cardPosition).toEqual({ space: "page-css-v1", y: 0, x: 10 });
    expect(above.data!.documents["a.pdf"].annotations.a1.cardPosition).toEqual({ space: "page-css-v1", y: 800, x: 100_000 });
  });
  it("export never overwrites an unknown file", () => {
    expect(isReplaceableSnapshot({}, "doc-1")).toBe(false);
    expect(isReplaceableSnapshot({ "reader-margins-export": false }, "doc-1")).toBe(false);
  });

  // displayMode (card | popover) is the per-annotation display-form field. It
  // must fail closed to "card" (the current, backwards-compatible behavior) for
  // any missing/invalid value so old data and hostile input cannot force an
  // unknown render path.
  it.each([
    ["missing", undefined],
    ["non-string", 42],
    ["unknown value", "tooltip"],
    ["empty string", ""],
  ])("displayMode %s defaults to 'card'", (_label, displayMode) => {
    const raw = pluginDataWithCardPosition(undefined);
    (raw as any).documents["a.pdf"].annotations.a1.displayMode = displayMode;
    const parsed = parsePluginData(raw);
    expect(parsed.data!.documents["a.pdf"].annotations.a1.displayMode).toBe("card");
  });
  it("displayMode 'card' and 'popover' are preserved", () => {
    for (const mode of ["card", "popover"] as const) {
      const raw = pluginDataWithCardPosition(undefined);
      (raw as any).documents["a.pdf"].annotations.a1.displayMode = mode;
      const parsed = parsePluginData(raw);
      expect(parsed.data!.documents["a.pdf"].annotations.a1.displayMode).toBe(mode);
    }
  });
  it("settings.defaultDisplayMode defaults to 'card' for missing/invalid values", () => {
    for (const v of [undefined, 1, "tooltip", null]) {
      const raw = {
        schemaVersion: 1,
        settings: { colors: [{ id: "y", name: "Y", value: "#fff15c" }], defaultColorId: "y", defaultDisplayMode: v },
        documents: {},
      };
      expect(parsePluginData(raw).data!.settings.defaultDisplayMode).toBe("card");
    }
  });
  it.each([
    ["missing", undefined],
    ["non-number", "180"],
    ["NaN", Number.NaN],
    ["zero", 0],
    ["negative", -50],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("settings.popoverGraceMs %s defaults to 180 (must be a positive finite number)", (_label, v) => {
    const raw = {
      schemaVersion: 1,
      settings: { colors: [{ id: "y", name: "Y", value: "#fff15c" }], defaultColorId: "y", popoverGraceMs: v },
      documents: {},
    };
    expect(parsePluginData(raw).data!.settings.popoverGraceMs).toBe(180);
  });
  it("settings.popoverGraceMs preserves any positive value (no upper bound)", () => {
    for (const v of [1, 50, 100, 180, 500, 1000, 2000, 5000]) {
      const raw = {
        schemaVersion: 1,
        settings: { colors: [{ id: "y", name: "Y", value: "#fff15c" }], defaultColorId: "y", popoverGraceMs: v },
        documents: {},
      };
      expect(parsePluginData(raw).data!.settings.popoverGraceMs).toBe(v);
    }
  });
});
