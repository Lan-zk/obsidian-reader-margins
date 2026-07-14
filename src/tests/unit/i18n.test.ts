import { describe, it, expect } from "vitest";
import { makeT, resolveLanguage, type Language } from "src/i18n";

describe("i18n", () => {
  it("resolveLanguage honors an explicit choice over the Obsidian locale", () => {
    expect(resolveLanguage("en" as Language, "zh")).toBe("en");
    expect(resolveLanguage("zh" as Language, "en")).toBe("zh");
  });
  it("auto follows the Obsidian locale", () => {
    expect(resolveLanguage("auto" as Language, "zh")).toBe("zh");
    expect(resolveLanguage("auto" as Language, "zh-TW")).toBe("zh");
    expect(resolveLanguage("auto" as Language, "en")).toBe("en");
    expect(resolveLanguage("auto" as Language, "fr")).toBe("en");
  });
  it("translates keys per language", () => {
    expect(makeT("zh", "en")("color.add")).toBe("添加颜色");
    expect(makeT("en", "zh")("color.add")).toBe("Add color");
  });
  it("falls back to the key when missing in both tables", () => {
    expect(makeT("zh", "en")("__missing__")).toBe("__missing__");
  });
  it("interpolates {vars}", () => {
    expect(makeT("en", "en")("toolbar.highlight", { label: "Yellow" })).toBe("Highlight: Yellow");
    expect(makeT("zh", "en")("toolbar.highlight", { label: "黄色" })).toBe("高亮：黄色");
  });
});
