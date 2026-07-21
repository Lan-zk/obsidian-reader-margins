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
  it("isolates a corrupted document (null) instead of crashing (H-02)", () => {
    const r = parsePluginData({
      schemaVersion: 1,
      settings: { colors: [{ id: "y", name: "Y", value: "#fff15c" }], defaultColorId: "y" },
      documents: { "bad.pdf": null, "good.pdf": {
        documentId: "d1", sourceSignature: { pdfFingerprint: "fp", numPages: 3 }, revision: 0, annotations: {},
      } },
    });
    expect(r.state).toBe("valid");
    expect(Object.keys(r.data!.documents)).toEqual(["good.pdf"]);
  });
  it("isolates a corrupted annotation, keeps the valid one (H-02)", () => {
    const validAnn = {
      id: "good", revision: 1, type: "text-mark", markStyle: "highlight",
      colorLabelSnapshot: "Y", colorValueSnapshot: "#fff15c",
      anchor: { kind: "pdf-text", version: 1, pageNumber: 1,
        quote: { exact: "hi", normalization: "collapse-whitespace-v1" },
        geometry: { space: "page-css-v1", pageWidth: 600, pageHeight: 800, rotation: 0, rects: [{ x: 0, y: 0, width: 10, height: 10 }] } },
      createdAt: "t", updatedAt: "t",
    };
    const r = parsePluginData({
      schemaVersion: 1,
      settings: { colors: [{ id: "y", name: "Y", value: "#fff15c" }], defaultColorId: "y" },
      documents: { "a.pdf": {
        documentId: "d1", sourceSignature: { pdfFingerprint: "fp", numPages: 3 }, revision: 0,
        annotations: { good: validAnn, bad: null, worse: { id: "x", type: "text-mark", markStyle: "neon" } },
      } },
    });
    expect(r.state).toBe("valid");
    expect(Object.keys(r.data!.documents["a.pdf"].annotations)).toEqual(["good"]);
  });
  it("preserves a valid legacy mixed-space card position as a fresh plain object", () => {
    const cardPosition = { space: "page-css-v1", x: 420, y: 780 };
    const r = parsePluginData({
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
    });

    const parsed = r.data!.documents["a.pdf"].annotations.a1.cardPosition;
    expect(parsed).toEqual(cardPosition);
    expect(parsed).not.toBe(cardPosition);
    expect(Object.getPrototypeOf(parsed!)).toBe(Object.prototype);
  });
  it("rejects an annotation with invalid color hex (H-02)", () => {
    const r = parsePluginData({
      schemaVersion: 1,
      settings: { colors: [{ id: "y", name: "Y", value: "#fff15c" }], defaultColorId: "y" },
      documents: { "a.pdf": {
        documentId: "d1", sourceSignature: { pdfFingerprint: "fp", numPages: 3 }, revision: 0,
        annotations: { bad: {
          id: "bad", revision: 1, type: "text-mark", markStyle: "highlight",
          colorLabelSnapshot: "Y", colorValueSnapshot: "javascript:alert(1)",
          anchor: { kind: "pdf-text", version: 1, pageNumber: 1,
            quote: { exact: "hi", normalization: "collapse-whitespace-v1" },
            geometry: { space: "page-css-v1", pageWidth: 600, pageHeight: 800, rotation: 0, rects: [{ x: 0, y: 0, width: 10, height: 10 }] } },
          createdAt: "t", updatedAt: "t",
        } },
      } },
    });
    expect(r.state).toBe("valid");
    expect(r.data!.documents["a.pdf"].annotations).toEqual({});
  });
});
