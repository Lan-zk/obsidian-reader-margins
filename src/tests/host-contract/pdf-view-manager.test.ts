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

  it("disposes the old-path generation and discovers a fresh session after a store rekey", () => {
    const store = new DurableAnnotationStore(async () => {});
    store.loadAndValidate(null);
    const leaf = fakeLeaf("pdf", "old.pdf");
    const mgr = new PdfViewManager(store);
    mgr.start(fakePlugin([leaf]));
    const oldSession = mgr.sessionFor(leaf)!;

    leaf.view.file = { path: "new.pdf" };
    expect(store.rekeyDocumentPaths([{ oldPath: "old.pdf", newPath: "new.pdf" }])).toEqual({ ok: true, moved: 0 });

    // Annotation-free moves are intentionally no-ops and therefore do not
    // synthesize a store rename event. A real stored document exercises the
    // manager lifecycle below.
    leaf.view.file = { path: "old.pdf" };
    const created = store.create("old.pdf", {
      markStyle: "highlight",
      colorId: "yellow",
      colorLabel: "Yellow",
      colorValue: "#fff15c",
      anchor: {
        kind: "pdf-text", version: 1, pageNumber: 1,
        quote: { exact: "hi", normalization: "collapse-whitespace-v1" },
        geometry: { space: "page-css-v1", pageWidth: 600, pageHeight: 800, rotation: 0, rects: [{ x: 0, y: 100, width: 10, height: 10 }] },
      },
    }, { pdfFingerprint: "fp", numPages: 1 });
    expect(created.ok).toBe(true);
    leaf.view.file = { path: "new.pdf" };

    expect(store.rekeyDocumentPaths([{ oldPath: "old.pdf", newPath: "new.pdf" }])).toEqual({ ok: true, moved: 1 });

    expect(oldSession.state).toBe("disposed");
    expect(mgr.sessionFor(leaf)).toBeUndefined();

    // The store event invalidates the stale generation but does not assume the
    // host has already refreshed its view path. Normal view discovery is the
    // fail-closed boundary for attaching the replacement session.
    mgr.reconcile();
    const newSession = mgr.sessionFor(leaf)!;
    expect(newSession).not.toBe(oldSession);
    expect(newSession.pdfPath).toBe("new.pdf");
    expect(store.byPath("old.pdf")).toEqual([]);
    expect(store.byId("new.pdf", (created as any).annotation.id)).toBeTruthy();
  });

  it("commits an active old-path draft before a rename moves durable data", () => {
    const store = new DurableAnnotationStore(async () => {});
    store.loadAndValidate(null);
    const created = store.create("old.pdf", {
      markStyle: "highlight", colorId: "yellow", colorLabel: "Yellow", colorValue: "#fff15c",
      anchor: {
        kind: "pdf-text", version: 1, pageNumber: 1,
        quote: { exact: "draft", normalization: "collapse-whitespace-v1" },
        geometry: { space: "page-css-v1", pageWidth: 600, pageHeight: 800, rotation: 0, rects: [{ x: 0, y: 100, width: 10, height: 10 }] },
      },
    }, { pdfFingerprint: "fp", numPages: 1 });
    if (!created.ok) throw new Error(created.reason);
    const leaf = fakeLeaf("pdf", "old.pdf");
    const mgr = new PdfViewManager(store);
    mgr.start(fakePlugin([leaf]));
    const oldSession = mgr.sessionFor(leaf)!;
    (oldSession as any).draft.begin(created.annotation.id, created.annotation.revision, "edited before rename");

    mgr.prepareForDocumentMoves([{ oldPath: "old.pdf", newPath: "new.pdf" }]);
    const result = store.rekeyDocumentPaths([{ oldPath: "old.pdf", newPath: "new.pdf" }]);

    expect(result).toEqual({ ok: true, moved: 1 });
    expect(oldSession.state).toBe("disposed");
    expect(store.byId("new.pdf", created.annotation.id)?.comment).toBe("edited before rename");
  });

  it("invalidates an annotation-free old-path session before a no-op rename", () => {
    const store = new DurableAnnotationStore(async () => {});
    store.loadAndValidate(null);
    const leaf = fakeLeaf("pdf", "empty.pdf");
    const mgr = new PdfViewManager(store);
    mgr.start(fakePlugin([leaf]));
    const oldSession = mgr.sessionFor(leaf)!;

    mgr.prepareForDocumentMoves([{ oldPath: "empty.pdf", newPath: "renamed.pdf" }]);

    expect(oldSession.state).toBe("disposed");
    expect(mgr.sessionFor(leaf)).toBeUndefined();
    expect(store.rekeyDocumentPaths([{ oldPath: "empty.pdf", newPath: "renamed.pdf" }])).toEqual({ ok: true, moved: 0 });
  });

  it("invalidates the old-path session even when the store rename collides", () => {
    const store = new DurableAnnotationStore(async () => {});
    store.loadAndValidate(null);
    const make = (path: string, quote: string) => store.create(path, {
      markStyle: "highlight", colorId: "yellow", colorLabel: "Yellow", colorValue: "#fff15c",
      anchor: {
        kind: "pdf-text" as const, version: 1 as const, pageNumber: 1,
        quote: { exact: quote, normalization: "collapse-whitespace-v1" as const },
        geometry: { space: "page-css-v1" as const, pageWidth: 600, pageHeight: 800, rotation: 0 as const, rects: [{ x: 0, y: 100, width: 10, height: 10 }] },
      },
    }, { pdfFingerprint: path, numPages: 1 });
    const source = make("old.pdf", "source");
    make("occupied.pdf", "destination");
    if (!source.ok) throw new Error(source.reason);
    const leaf = fakeLeaf("pdf", "old.pdf");
    const mgr = new PdfViewManager(store);
    mgr.start(fakePlugin([leaf]));
    const oldSession = mgr.sessionFor(leaf)!;
    (oldSession as any).draft.begin(source.annotation.id, source.annotation.revision, "preserved at source");

    mgr.prepareForDocumentMoves([{ oldPath: "old.pdf", newPath: "occupied.pdf" }]);
    const result = store.rekeyDocumentPaths([{ oldPath: "old.pdf", newPath: "occupied.pdf" }]);

    expect(result).toMatchObject({ ok: false, reason: "destination-conflict" });
    expect(oldSession.state).toBe("disposed");
    expect(mgr.sessionFor(leaf)).toBeUndefined();
    expect(store.byId("old.pdf", source.annotation.id)?.comment).toBe("preserved at source");
  });
});
