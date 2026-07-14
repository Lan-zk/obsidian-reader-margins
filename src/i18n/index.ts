// src/i18n/index.ts
// Internationalization for settings, toolbar, and card surfaces. The active
// language is stored in plugin settings; "auto" defers to the Obsidian locale.
export type Language = "auto" | "en" | "zh";
export type ResolvedLanguage = "en" | "zh";

export const DEFAULT_LANGUAGE: Language = "auto";

export function isLanguage(v: unknown): v is Language {
  return v === "auto" || v === "en" || v === "zh";
}

const STRINGS: Record<ResolvedLanguage, Record<string, string>> = {
  en: {
    "settings.section.colors": "Annotation colors",
    "settings.section.default": "Default color",
    "settings.section.language": "Language",
    "settings.section.reset": "Reset",
    "color.label": "Color",
    "color.add": "Add color",
    "color.delete": "Delete",
    "color.max": "Up to 6 colors",
    "color.cannotAdd": "Maximum 6 colors reached",
    "language.auto": "Auto (follow Obsidian)",
    "language.en": "English",
    "language.zh": "中文",
    "settings.reset": "Reset to defaults",
    "settings.reset.confirm": "Reset all settings to their defaults?",
    "toolbar.underline": "Underline and comment",
    "toolbar.export": "Export Markdown",
    "toolbar.highlight": "Highlight: {label}",
    "toolbar.highlight.aria": "Highlight with {label}",
    "card.drag": "Drag",
    "card.drag.aria": "Drag annotation card",
    "card.save": "Save (Cmd+Enter)",
    "card.cancel": "Cancel (Esc)",
    "card.delete": "Delete",
    "card.toggleType": "Switch highlight/underline",
    "card.color.aria": "Color {label}",
    "notice.pdfReplaced": "Reader Margins: PDF replaced; stale annotations hidden (signature mismatch).",
    "notice.noAnnotations": "No annotations in this PDF.",
    "notice.cannotExport": "Cannot export: app unavailable.",
    "notice.cannotHighlight": "Cannot highlight: {reason}",
    "notice.cannotUnderline": "Cannot underline: {reason}",
    "notice.conflict": "Annotation was modified in another view.",
    "notice.cannotRestore": "Cannot restore: signature unavailable.",
    "notice.deleted": "Annotation deleted.",
    "notice.undo": "Undo",
    "notice.duplicateName": "Duplicate color name",
    "modal.export.title": "Export Markdown snapshot",
    "modal.targetPath": "Target path",
    "modal.targetPath.desc": "Overwriting an existing snapshot requires it to belong to the same PDF (frontmatter).",
    "modal.export": "Export",
    "modal.cancel": "Cancel",
    "modal.replace": "Replace",
    "modal.status.none": "Target does not exist - a new snapshot will be created.",
    "modal.status.owner": "Target is an existing snapshot of this PDF. Use Replace to overwrite.",
    "modal.status.foreign": "Target exists but is not this PDF's snapshot. Choose another path.",
    "modal.exported": "Exported {count} annotations.",
    "modal.exportedReplace": "Replaced snapshot ({count} annotations).",
    "export.reason.empty": "No annotations to export.",
    "export.reason.exists_no_replace": "File already exists. Use Replace to overwrite.",
    "export.reason.exists_not_owner": "File exists but is not this PDF's snapshot.",
    "export.reason.not_found": "File not found. Use Export to create a new snapshot.",
    "export.reason.write_failed": "Write failed. Check the path and vault permissions.",
  },
  zh: {
    "settings.section.colors": "批注颜色",
    "settings.section.default": "默认颜色",
    "settings.section.language": "语言",
    "settings.section.reset": "恢复",
    "color.label": "颜色",
    "color.add": "添加颜色",
    "color.delete": "删除",
    "color.max": "最多 6 个颜色",
    "color.cannotAdd": "已达上限 6 个颜色",
    "language.auto": "自动（跟随 Obsidian）",
    "language.en": "English",
    "language.zh": "中文",
    "settings.reset": "恢复默认配置",
    "settings.reset.confirm": "将所有设置恢复为默认值？",
    "toolbar.underline": "下划线并批注",
    "toolbar.export": "导出 Markdown",
    "toolbar.highlight": "高亮：{label}",
    "toolbar.highlight.aria": "用 {label} 高亮",
    "card.drag": "拖动",
    "card.drag.aria": "拖动批注卡片",
    "card.save": "保存 (Cmd+Enter)",
    "card.cancel": "取消 (Esc)",
    "card.delete": "删除",
    "card.toggleType": "切换高亮/下划线",
    "card.color.aria": "颜色 {label}",
    "notice.pdfReplaced": "Reader Margins：PDF 已替换，旧批注暂不显示（签名不匹配）。",
    "notice.noAnnotations": "当前 PDF 没有批注。",
    "notice.cannotExport": "无法导出：应用不可用。",
    "notice.cannotHighlight": "无法高亮：{reason}",
    "notice.cannotUnderline": "无法加下划线：{reason}",
    "notice.conflict": "该批注已在另一窗口修改。",
    "notice.cannotRestore": "无法恢复：签名不可用。",
    "notice.deleted": "已删除批注。",
    "notice.undo": "撤销",
    "notice.duplicateName": "颜色名称重复",
    "modal.export.title": "导出 Markdown 批注快照",
    "modal.targetPath": "目标路径",
    "modal.targetPath.desc": "覆盖已有快照需属于同一 PDF（按 frontmatter 判定）。",
    "modal.export": "导出",
    "modal.cancel": "取消",
    "modal.replace": "替换",
    "modal.status.none": "目标不存在——将创建新快照。",
    "modal.status.owner": "目标是本 PDF 的已有快照。点「替换」覆盖。",
    "modal.status.foreign": "目标已存在但不属于本 PDF 的快照。请另选路径。",
    "modal.exported": "已导出 {count} 条批注。",
    "modal.exportedReplace": "已替换快照（{count} 条批注）。",
    "export.reason.empty": "没有批注可导出。",
    "export.reason.exists_no_replace": "文件已存在。点「替换」覆盖。",
    "export.reason.exists_not_owner": "文件已存在但不属于本 PDF 的快照。",
    "export.reason.not_found": "文件不存在。点「导出」创建新快照。",
    "export.reason.write_failed": "写入失败。请检查路径和库权限。",
  },
};

export function resolveLanguage(lang: Language, obsidianLocale: string): ResolvedLanguage {
  if (lang === "en") return "en";
  if (lang === "zh") return "zh";
  return obsidianLocale?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export type Translate = (key: string, vars?: Record<string, string>) => string;

export function makeT(lang: Language, obsidianLocale: string): Translate {
  const resolved = resolveLanguage(lang, obsidianLocale);
  const table = STRINGS[resolved];
  return (key, vars) => {
    let s = table[key] ?? STRINGS.en[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
    }
    return s;
  };
}
