// src/settings/settings-tab.ts
import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type ReaderMarginsPlugin from "src/main";
import { validateHexColor, canDeleteColor, validateSettingsMutation } from "src/domain/colors";

// Re-export the pure rules so tests can import them from the settings module.
export { canDeleteColor, validateSettingsMutation };

export interface ColorRow { id: string; name: string; value: string; }

export class ReaderMarginsSettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: ReaderMarginsPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "批注颜色" });

    const colors = this.plugin.store.data.settings.colors;
    const defaultId = this.plugin.store.data.settings.defaultColorId;

    for (const c of colors) {
      const setting = new Setting(containerEl)
        .setName("颜色")
        .addText((text) =>
          text
            .setValue(c.name)
            .onChange((v) => { c.name = v; }),
        )
        .addColorPicker((picker) =>
          picker.setValue(c.value).onChange((v) => {
            const hex = validateHexColor(v);
            if (hex) c.value = hex;
          }),
        );
      if (canDeleteColor(colors, c.id, defaultId)) {
        setting.addButton((btn) =>
          btn.setButtonText("删除").onClick(() => {
            this.plugin.store.deleteColor(c.id);
            this.display();
          }),
        );
      } else {
        setting.addButton((btn) => btn.setButtonText("删除").setDisabled(true));
      }
      // Commit on blur so typing does not persist half-edited state.
      setting.settingEl.addEventListener("focusout", () => {
        const result = this.plugin.store.commitSettings();
        if (!result.ok) new Notice(result.reason, 4000);
      });
    }

    new Setting(containerEl).addButton((btn) =>
      btn.setButtonText("添加颜色").onClick(() => {
        this.plugin.store.addColor();
        this.display();
      }),
    );

    containerEl.createEl("h2", { text: "默认颜色" });
    new Setting(containerEl).addDropdown((dd) => {
      for (const c of colors) dd.addOption(c.id, c.name);
      dd.setValue(defaultId).onChange((id: string) => {
        this.plugin.store.setDefaultColor(id);
        this.display();
      });
    });
  }
}
