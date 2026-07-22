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
    expect(makeT("en", "en")("toolbar.highlight", { label: "Yellow" })).toBe("Select Yellow");
    expect(makeT("zh", "en")("toolbar.highlight", { label: "黄色" })).toBe("选择 黄色");
  });
  it("translates persistence states", () => {
    const t = makeT("zh", "zh");
    expect(t("persistence.dirty")).toBe("有未保存的更改");
    expect(t("persistence.saving")).toBe("正在保存…");
    expect(t("persistence.failed", { message: "disk full" })).toBe("保存失败：disk full。正在重试。");
  });
  it("localizes rename failures without exposing store reason codes", () => {
    const en = makeT("en", "en");
    const zh = makeT("zh", "zh");
    expect(en("notice.rename.readonly")).toBe("Cannot update annotation paths because Reader Margins data is read-only.");
    expect(en("notice.rename.conflict")).toBe("Cannot move annotations because the destination already has annotation data.");
    expect(zh("notice.rename.readonly")).toBe("无法更新批注路径：Reader Margins 数据当前为只读。");
    expect(zh("notice.rename.conflict")).toBe("无法移动批注：目标路径已有批注数据。");
  });
});
