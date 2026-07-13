// src/tests/host-contract/pdf-view-manager.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { PdfViewManager } from "src/session/pdf-view-manager";
import { DurableAnnotationStore } from "src/store/durable-annotation-store";

function fakeApp(leaves: any[]) {
  return {
    workspace: {
      iterateAllLeaves: (cb: (l: any) => void) => leaves.forEach(cb),
      on: vi.fn(() => () => {}),
    },
  };
}
function fakePlugin(leaves: any[]) {
  return {
    app: fakeApp(leaves),
    registerEvent: vi.fn(),
    register: vi.fn((fn: any) => {}),
  } as any;
}
function fakeLeaf(viewType: string, path: string): any {
  return { view: { getViewType: () => viewType, file: { path } } };
}

describe("PdfViewManager", () => {
  it("creates a session per PDF leaf and ignores non-pdf leaves", () => {
    const store = new DurableAnnotationStore(async () => {});
    const leaves = [fakeLeaf("pdf", "a.pdf"), fakeLeaf("markdown", "b.md")];
    const mgr = new PdfViewManager(store);
    mgr.start(fakePlugin(leaves));
    expect(mgr.sessionCount).toBe(1);
    mgr.stop();
    expect(mgr.sessionCount).toBe(0);
  });

  it("disposes and recreates a session when its leaf swaps to a different file", () => {
    const store = new DurableAnnotationStore(async () => {});
    const leaf = fakeLeaf("pdf", "a.pdf");
    const mgr = new PdfViewManager(store);
    mgr.start(fakePlugin([leaf]));
    expect(mgr.sessionCount).toBe(1);
    const firstSession = mgr.sessionFor(leaf);
    expect(firstSession?.pdfPath).toBe("a.pdf");

    leaf.view.file = { path: "b.pdf" };
    mgr.reconcile();

    expect(mgr.sessionCount).toBe(1); // old disposed, new created
    const secondSession = mgr.sessionFor(leaf);
    expect(secondSession?.pdfPath).toBe("b.pdf");
    expect(secondSession).not.toBe(firstSession);
  });

  it("disposes sessions whose leaf is gone", () => {
    const store = new DurableAnnotationStore(async () => {});
    const leaf = fakeLeaf("pdf", "a.pdf");
    const leaves = [leaf];
    const mgr = new PdfViewManager(store);
    mgr.start(fakePlugin(leaves));
    expect(mgr.sessionCount).toBe(1);
    leaves.length = 0; // leaf no longer reported by iterateAllLeaves
    mgr.reconcile();
    expect(mgr.sessionCount).toBe(0);
  });

  it("keeps the existing session when the file is unchanged", () => {
    const store = new DurableAnnotationStore(async () => {});
    const leaf = fakeLeaf("pdf", "a.pdf");
    const mgr = new PdfViewManager(store);
    mgr.start(fakePlugin([leaf]));
    const before = mgr.sessionFor(leaf);
    mgr.reconcile();
    expect(mgr.sessionFor(leaf)).toBe(before);
  });
});
