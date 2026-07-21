import { describe, expect, it, vi } from "vitest";
import { TFile, type App, type PluginManifest } from "obsidian";
import ReaderMarginsPlugin, { collectStoredPathMoves } from "src/main";

const TEST_MANIFEST = {
  id: "reader-margins",
  name: "Reader Margins",
  version: "0.1.0",
  minAppVersion: "1.0.0",
  description: "Host-contract fixture",
  author: "Test",
} as PluginManifest;

function createPlugin(): ReaderMarginsPlugin {
  vi.stubGlobal("loadPdfJs", vi.fn(async () => ({})));
  return new ReaderMarginsPlugin({} as App, TEST_MANIFEST);
}

function installHost(plugin: ReaderMarginsPlugin, order: string[]) {
  let rename: ((file: any, oldPath: string) => void) | undefined;
  (plugin as any).app = {
    appVersion: "test",
    locale: "en",
    vault: {
      on: vi.fn((event: string, callback: (file: any, oldPath: string) => void) => {
        if (event === "rename") {
          order.push("rename-listener");
          rename = callback;
        }
        return () => {};
      }),
    },
    workspace: {
      activeLeaf: null,
      on: vi.fn(() => () => {}),
      iterateAllLeaves: vi.fn(() => { order.push("view-discovery"); }),
    },
  };
  (plugin as any).loadData = vi.fn(async () => null);
  (plugin as any).saveData = vi.fn(async () => {});
  (plugin as any).registerEvent = vi.fn();
  (plugin as any).register = vi.fn();
  (plugin as any).addSettingTab = vi.fn();
  (plugin as any).addCommand = vi.fn();
  return { triggerRename: (file: any, oldPath: string) => rename?.(file, oldPath) };
}

function createStoredPdf(plugin: ReaderMarginsPlugin, path: string, fingerprint = path) {
  const result = plugin.store.create(path, {
    markStyle: "highlight",
    colorId: "yellow",
    colorLabel: "Yellow",
    colorValue: "#fff15c",
    anchor: {
      kind: "pdf-text", version: 1, pageNumber: 1,
      quote: { exact: path, normalization: "collapse-whitespace-v1" },
      geometry: { space: "page-css-v1", pageWidth: 600, pageHeight: 800, rotation: 0, rects: [{ x: 0, y: 100, width: 10, height: 10 }] },
    },
  }, { pdfFingerprint: fingerprint, numPages: 1 });
  if (!result.ok) throw new Error(result.reason);
  return result.annotation.id;
}

describe("vault rename host contract", () => {
  it("registers the vault rename listener before discovering PDF views", async () => {
    const order: string[] = [];
    const plugin = createPlugin();
    installHost(plugin, order);

    await plugin.onload();

    expect(order.indexOf("rename-listener")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("rename-listener")).toBeLessThan(order.indexOf("view-discovery"));
  });

  it("maps a file rename to one exact stored-path move", async () => {
    const plugin = createPlugin();
    const host = installHost(plugin, []);
    await plugin.onload();
    const id = createStoredPdf(plugin, "old.pdf");
    const file = Object.assign(new TFile(), { path: "renamed.pdf", extension: "pdf" });

    host.triggerRename(file, "old.pdf");

    expect(plugin.store.byPath("old.pdf")).toEqual([]);
    expect(plugin.store.byId("renamed.pdf", id)).toBeTruthy();
  });

  it("maps a folder rename to stored descendants while preserving nested suffixes", async () => {
    const plugin = createPlugin();
    const host = installHost(plugin, []);
    await plugin.onload();
    const firstId = createStoredPdf(plugin, "old/a.pdf", "a");
    const nestedId = createStoredPdf(plugin, "old/nested/b.pdf", "b");
    createStoredPdf(plugin, "outside.pdf", "outside");
    const folder = { path: "renamed", children: [] };

    host.triggerRename(folder, "old");

    expect(plugin.store.byId("renamed/a.pdf", firstId)).toBeTruthy();
    expect(plugin.store.byId("renamed/nested/b.pdf", nestedId)).toBeTruthy();
    expect(plugin.store.byPath("old/a.pdf")).toEqual([]);
    expect(plugin.store.byPath("old/nested/b.pdf")).toEqual([]);
    expect(plugin.store.byPath("outside.pdf")).toHaveLength(1);
  });

  it("fails closed for an unknown abstract-file shape", async () => {
    const plugin = createPlugin();
    const host = installHost(plugin, []);
    await plugin.onload();
    const id = createStoredPdf(plugin, "old.pdf");

    host.triggerRename({ path: "renamed.pdf" }, "old.pdf");

    expect(plugin.store.byId("old.pdf", id)).toBeTruthy();
    expect(plugin.store.byPath("renamed.pdf")).toEqual([]);
  });

  it("collects only exact folder descendants and is safe for an empty prefix match", () => {
    expect(collectStoredPathMoves(["old/a.pdf", "oldish/b.pdf", "old/nested/c.pdf"], "old", "new")).toEqual([
      { oldPath: "old/a.pdf", newPath: "new/a.pdf" },
      { oldPath: "old/nested/c.pdf", newPath: "new/nested/c.pdf" },
    ]);
    expect(collectStoredPathMoves(["other.pdf"], "old", "new")).toEqual([]);
  });
});
