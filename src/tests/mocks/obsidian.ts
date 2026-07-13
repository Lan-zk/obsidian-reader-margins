// Minimal stub so modules importing "obsidian" load under vitest.
// Add fields as later tests require; keep stubs inert.
export class Plugin {
  app: any = { workspace: {}, vault: {}, fileManager: {}, metadataCache: {} };
  manifest = { id: "reader-margins", version: "0.1.0" };
  async loadData() { return null; }
  async saveData(_d: unknown) {}
  registerEvent(_r: unknown) {}
  registerDomEvent(_t: any, _e: string, _h: any) {}
  registerInterval(_id: any) {}
  addCommand(_c: any) { return {}; }
  addSettingTab(_t: any) {}
  onunload() {}
}
export class Notice {
  constructor(_m: string, _d?: number) {}
}
export class Modal {
  constructor(_app: any) {}
  open() {}
  close() {}
}
export class Setting {
  constructor(_c: any) {}
  setName(_n: string) { return this; }
  setDesc(_d: string) { return this; }
  addText(_cb: any) { return this; }
  addDropdown(_cb: any) { return this; }
  addColorPicker(_cb: any) { return this; }
  addButton(_cb: any) { return this; }
}
export class PluginSettingTab extends Setting {}
export class TFile {}
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}
export function loadPdfJs(): Promise<unknown> { return Promise.resolve({}); }
