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
export class Menu {
  private _items: { title: string; onClick: () => void }[] = [];
  addItem(cb: (item: MockMenuItem) => any): this {
    const item = new MockMenuItem();
    cb(item);
    this._items.push({ title: item.title, onClick: item.clickHandler });
    return this;
  }
  addSeparator(): this { return this; }
  showAtMouseEvent(_e: MouseEvent): this { return this; }
  showAtPosition(_p: any): this { return this; }
  // Test helpers
  static titles(menu: Menu): string[] { return (menu as any)._items.map((i: any) => i.title); }
  static invoke(menu: Menu, index: number): void { (menu as any)._items[index]?.onClick(); }
  static count(menu: Menu): number { return (menu as any)._items.length; }
}

class MockMenuItem {
  title = "";
  clickHandler: () => void = () => {};
  setTitle(t: string): this { this.title = t; return this; }
  setIcon(_i: any): this { return this; }
  onClick(fn: () => void): this { this.clickHandler = fn; return this; }
}
export class Setting {
  constructor(_c: any) {}
  setName(_n: string) { return this; }
  setDesc(_d: string) { return this; }
  addText(_cb: any) { return this; }
  addDropdown(_cb: any) { return this; }
  addColorPicker(_cb: any) { return this; }
  addButton(_cb: any) { return this; }
  addToggle(_cb: any) { return this; }
  setWarning() { return this; }
}
export class PluginSettingTab extends Setting {}
export class TFile {}
export class TFolder {}
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}
export function loadPdfJs(): Promise<unknown> { return Promise.resolve({}); }
