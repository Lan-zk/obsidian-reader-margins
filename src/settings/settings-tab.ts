// src/settings/settings-tab.ts
import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type ReaderMarginsPlugin from "src/main";
import { validateHexColor, canDeleteColor, validateSettingsMutation, MAX_COLORS } from "src/domain/colors";
import { makeT, type Language, type Translate } from "src/i18n";

// Re-export the pure rules so tests can import them from the settings module.
export { canDeleteColor, validateSettingsMutation };

export interface ColorRow { id: string; name: string; value: string; }

export class ReaderMarginsSettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: ReaderMarginsPlugin) {
    super(app, plugin);
  }

  private t(): Translate {
    const lang = this.plugin.store.data.settings.language;
    const locale = (this.app as any).locale ?? "en";
    return makeT(lang, locale);
  }

  display(): void {
    const { containerEl } = this;
    const t = this.t();
    containerEl.empty();

    containerEl.createEl("h2", { text: t("settings.section.language") });
    new Setting(containerEl).addDropdown((dd) => {
      dd.addOption("auto", t("language.auto"));
      dd.addOption("en", t("language.en"));
      dd.addOption("zh", t("language.zh"));
      dd.setValue(this.plugin.store.data.settings.language).onChange((id: string) => {
        this.plugin.store.setLanguage(id as Language);
        this.display();
      });
    });

    containerEl.createEl("h2", { text: t("settings.section.editing") });
    new Setting(containerEl)
      .setName(t("settings.autoOpenEdit"))
      .setDesc(t("settings.autoOpenEdit.desc"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.store.data.settings.autoOpenEdit).onChange((on) => {
          this.plugin.store.data.settings.autoOpenEdit = on;
          this.plugin.store.commitSettings();
        });
      });
    new Setting(containerEl)
      .setName(t("settings.defaultDisplayMode"))
      .setDesc(t("settings.defaultDisplayMode.desc"))
      .addDropdown((dd) => {
        dd.addOption("card", t("settings.displayMode.card"));
        dd.addOption("popover", t("settings.displayMode.popover"));
        dd.setValue(this.plugin.store.data.settings.defaultDisplayMode).onChange((mode: string) => {
          if (mode !== "card" && mode !== "popover") return;
          this.plugin.store.data.settings.defaultDisplayMode = mode;
          this.plugin.store.commitSettings();
        });
      });
    new Setting(containerEl)
      .setName(t("settings.popoverGrace"))
      .setDesc(t("settings.popoverGrace.desc"))
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "100";
        text.inputEl.max = "1000";
        text.inputEl.step = "20";
        text.setValue(String(this.plugin.store.data.settings.popoverGraceMs)).onChange((v) => {
          const ms = Math.max(100, Math.min(1000, Math.round(Number(v) || 180)));
          this.plugin.store.data.settings.popoverGraceMs = ms;
          text.setValue(String(ms));
          this.plugin.store.commitSettings();
        });
      });

    containerEl.createEl("h2", { text: t("settings.section.default") });
    const colors = this.plugin.store.data.settings.colors;
    const defaultId = this.plugin.store.data.settings.defaultColorId;
    new Setting(containerEl).addDropdown((dd) => {
      for (const c of colors) dd.addOption(c.id, c.name);
      dd.setValue(defaultId).onChange((id) => {
        this.plugin.store.setDefaultColor(id);
        this.display();
      });
    });

    containerEl.createEl("h2", { text: t("settings.section.colors") });
    colors.forEach((c, i) => {
      // Unique row labels ("Color 1", "Color 2"…) - a repeated "Color" name on
      // every row made the section unreadable in scan (critique P2).
      const setting = new Setting(containerEl)
        .setName(`${t("color.label")} ${i + 1}`)
        .addText((text) =>
          text.setValue(c.name).onChange((v) => { c.name = v; }),
        )
        .addColorPicker((picker) =>
          picker.setValue(c.value).onChange((v) => {
            const hex = validateHexColor(v);
            if (hex) c.value = hex;
          }),
        );
      if (canDeleteColor(colors, c.id, defaultId)) {
        setting.addButton((btn) =>
          btn.setButtonText(t("color.delete")).onClick(() => {
            this.plugin.store.deleteColor(c.id);
            this.display();
          }),
        );
      } else {
        setting.addButton((btn) => btn.setButtonText(t("color.delete")).setDisabled(true));
      }
      setting.settingEl.addEventListener("focusout", () => {
        const result = this.plugin.store.commitSettings();
        if (!result.ok) new Notice(result.reason, 4000);
      });
    });

    new Setting(containerEl).addButton((btn) => {
      btn.setButtonText(t("color.add")).onClick(() => {
        if (!this.plugin.store.addColor()) new Notice(t("color.cannotAdd"), 4000);
        this.display();
      });
      if (colors.length >= MAX_COLORS) btn.setDisabled(true).setTooltip(t("color.cannotAdd"));
    });

    // Destructive action lives at the bottom, styled as a warning (critique P2).
    containerEl.createEl("h2", { text: t("settings.section.reset") });
    new Setting(containerEl).addButton((btn) =>
      btn.setButtonText(t("settings.reset")).setWarning().onClick(() => {
        if (window.confirm(t("settings.reset.confirm"))) {
          this.plugin.store.resetSettings();
          this.display();
        }
      }),
    );
  }
}
