import { describe, it, expect, vi } from "vitest";
import { DurableAnnotationStore } from "src/store/durable-annotation-store";
import { DEFAULT_COLORS, DEFAULT_COLOR_ID } from "src/domain/colors";
import type { CreateAnnotationInput } from "src/domain/annotation";
import type { PdfTextAnchorV1 } from "src/domain/pdf-text-anchor";

const SIG = { pdfFingerprint: "fp", numPages: 3 };
function anchor(page = 1, y = 100): PdfTextAnchorV1 {
  return { kind: "pdf-text", version: 1, pageNumber: page,
    quote: { exact: "hi", normalization: "collapse-whitespace-v1" },
    geometry: { space: "page-css-v1", pageWidth: 600, pageHeight: 800, rotation: 0, rects: [{ x: 0, y, width: 10, height: 10 }] } };
}
function input(page = 1, y = 100): CreateAnnotationInput {
  return { markStyle: "highlight", colorId: "yellow", colorLabel: "Yellow", colorValue: "#fff15c", anchor: anchor(page, y) };
}

describe("DurableAnnotationStore", () => {
  it("loadAndValidate initializes defaults when absent", () => {
    const s = new DurableAnnotationStore(async () => {});
    expect(s.loadAndValidate(null)).toBe("absent");
    expect(s.data.settings.colors.length).toBeGreaterThanOrEqual(1);
  });
  it("loadAndValidate refuses future schema without overwriting", () => {
    const s = new DurableAnnotationStore(async () => {});
    expect(s.loadAndValidate({ schemaVersion: 2 })).toBe("future");
    expect(s.isReadonly).toBe(true);
  });
  it("create writes, bumps revision, emits change, enqueues save", async () => {
    const save = vi.fn(async () => {});
    const s = new DurableAnnotationStore(save);
    s.loadAndValidate(null);
    const changes: { p: string; ids: string[] }[] = [];
    s.onChange((p, chs) => changes.push({ p, ids: chs.map(c => c.id) }));
    const res = s.create("a.pdf", input(), SIG);
    expect(res.ok).toBe(true);
    expect(changes).toEqual([{ p: "a.pdf", ids: [(res as any).annotation.id] }]);
    expect((res as any).revision).toBe(1);
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    expect(s.data.documents["a.pdf"].annotations).toBeTruthy();
  });
  it("sourceSignature mismatch refuses create", () => {
    const save = vi.fn(async () => {});
    const s = new DurableAnnotationStore(save);
    s.loadAndValidate(null);
    s.create("a.pdf", input(), SIG);
    const res = s.create("a.pdf", input(), { pdfFingerprint: "other", numPages: 3 });
    expect(res.ok).toBe(false);
    expect((res as any).reason).toMatch(/signature/i);
  });
  it("labels create, update, and restore changes so projections do not infer intent from DOM", () => {
    const s = new DurableAnnotationStore(async () => {});
    s.loadAndValidate(null);
    const kinds: Array<string | undefined> = [];
    s.onChange((_path, changes) => kinds.push(...changes.map((change) => change.kind)));
    const created = s.create("a.pdf", input(), SIG);
    if (!created.ok) throw new Error(created.reason);
    s.update("a.pdf", created.annotation.id, { comment: "updated" }, created.annotation.revision);
    const tombstone = structuredClone(s.byId("a.pdf", created.annotation.id)!);
    const docId = s.data.documents["a.pdf"].documentId;
    s.delete("a.pdf", created.annotation.id);
    s.restore("a.pdf", tombstone, docId, SIG);
    expect(kinds).toEqual(["created", "updated", "deleted", "restored"]);
  });
  it("upgrades a legacy unknown fingerprint only when the verified PDF has the same page count", async () => {
    const save = vi.fn(async (_data: any) => {});
    const s = new DurableAnnotationStore(save);
    s.loadAndValidate(null);
    const created = s.create("a.pdf", input(), { pdfFingerprint: "unknown", numPages: 3 });
    expect(created.ok).toBe(true);

    expect(s.upgradeLegacySourceSignature("a.pdf", { pdfFingerprint: "verified-fp", numPages: 3 })).toBe(true);
    expect(s.data.documents["a.pdf"].sourceSignature).toEqual({ pdfFingerprint: "verified-fp", numPages: 3 });
    expect(s.byPath("a.pdf")).toHaveLength(1);
    await s.flushBestEffort();
    expect(save.mock.calls.at(-1)?.[0].documents["a.pdf"].sourceSignature).toEqual({ pdfFingerprint: "verified-fp", numPages: 3 });

    expect(s.upgradeLegacySourceSignature("a.pdf", { pdfFingerprint: "other-fp", numPages: 3 })).toBe(false);
    expect(s.data.documents["a.pdf"].sourceSignature).toEqual({ pdfFingerprint: "verified-fp", numPages: 3 });

    s.create("b.pdf", input(), { pdfFingerprint: "unknown", numPages: 3 });
    expect(s.upgradeLegacySourceSignature("b.pdf", { pdfFingerprint: "verified-fp", numPages: 4 })).toBe(false);
    expect(s.data.documents["b.pdf"].sourceSignature).toEqual({ pdfFingerprint: "unknown", numPages: 3 });
  });
  it("update with stale baseRevision is rejected", () => {
    const save = vi.fn(async () => {});
    const s = new DurableAnnotationStore(save);
    s.loadAndValidate(null);
    const res = s.create("a.pdf", input(), SIG) as any;
    const ok = s.update("a.pdf", res.annotation.id, { comment: "first" }, res.annotation.revision);
    expect(ok.ok).toBe(true);
    const stale = s.update("a.pdf", res.annotation.id, { comment: "stale" }, res.annotation.revision);
    expect(stale.ok).toBe(false);
  });
  it.each([
    ["non-finite y", { space: "page-css-v2", y: Number.NaN }],
    ["non-finite x", { space: "page-css-v2", y: 10, x: Number.POSITIVE_INFINITY }],
    ["unknown space", { space: "viewport-v1", y: 10, x: 10 }],
    ["legacy v1 non-finite y", { space: "page-css-v1", y: Number.NaN, x: 10 }],
    ["null payload", null],
  ])("rejects a card-position update with %s without mutation or persistence", async (_label, cardPosition) => {
    const save = vi.fn(async () => {});
    const s = new DurableAnnotationStore(save);
    s.loadAndValidate(null);
    const created = s.create("a.pdf", input(), SIG);
    if (!created.ok) throw new Error(created.reason);
    await s.flushBestEffort();
    save.mockClear();
    const changes = vi.fn();
    s.onChange(changes);
    const before = {
      stateRevision: s.data.stateRevision,
      documentRevision: s.data.documents["a.pdf"].revision,
      annotation: structuredClone(s.byId("a.pdf", created.annotation.id)),
    };

    const result = s.update("a.pdf", created.annotation.id, { cardPosition: cardPosition as any }, created.annotation.revision);
    await s.flushBestEffort();

    expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/position/i) });
    expect(s.data.stateRevision).toBe(before.stateRevision);
    expect(s.data.documents["a.pdf"].revision).toBe(before.documentRevision);
    expect(s.byId("a.pdf", created.annotation.id)).toEqual(before.annotation);
    expect(changes).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
  it("normalizes durable y and page-local x against the annotation page bounds", () => {
    const s = new DurableAnnotationStore(async () => {});
    s.loadAndValidate(null);
    const created = s.create("a.pdf", input(), SIG);
    if (!created.ok) throw new Error(created.reason);

    const below = s.update("a.pdf", created.annotation.id,
      { cardPosition: { space: "page-css-v2", y: -10, x: 100_000 } }, created.annotation.revision);
    if (!below.ok) throw new Error(below.reason);
    // anchor pageWidth 600, pageHeight 800: y in [0,800], page-local x in [-480, 1080].
    expect(below.annotation.cardPosition).toEqual({ space: "page-css-v2", y: 0, x: 1080 });

    const above = s.update("a.pdf", created.annotation.id,
      { cardPosition: { space: "page-css-v2", y: 900, x: -100_000 } }, below.annotation.revision);
    if (!above.ok) throw new Error(above.reason);
    expect(above.annotation.cardPosition).toEqual({ space: "page-css-v2", y: 800, x: -480 });
  });
  it("keeps read-only and revision-conflict failures ahead of card-position validation", async () => {
    const save = vi.fn(async () => {});
    const s = new DurableAnnotationStore(save);
    s.loadAndValidate(null);
    const created = s.create("a.pdf", input(), SIG);
    if (!created.ok) throw new Error(created.reason);
    const advanced = s.update("a.pdf", created.annotation.id, { comment: "advanced" }, created.annotation.revision);
    if (!advanced.ok) throw new Error(advanced.reason);
    await s.flushBestEffort();
    save.mockClear();

    const conflict = s.update("a.pdf", created.annotation.id,
      { cardPosition: { space: "viewport-v1", y: Number.NaN } as any }, created.annotation.revision);
    expect(conflict).toMatchObject({ ok: false, reason: expect.stringMatching(/revision conflict/i) });

    s.isReadonly = true;
    const readonly = s.update("a.pdf", created.annotation.id,
      { cardPosition: { space: "viewport-v1", y: Number.NaN } as any }, advanced.annotation.revision);
    expect(readonly).toMatchObject({ ok: false, reason: expect.stringMatching(/read-only/i) });
    await s.flushBestEffort();
    expect(save).not.toHaveBeenCalled();
  });
  it("delete removes and emits change", () => {
    const save = vi.fn(async () => {});
    const s = new DurableAnnotationStore(save);
    s.loadAndValidate(null);
    const res = s.create("a.pdf", input(), SIG) as any;
    const changes: { p: string; ids: string[] }[] = [];
    s.onChange((p, chs) => changes.push({ p, ids: chs.map(c => c.id) }));
    s.delete("a.pdf", res.annotation.id);
    expect(changes.at(-1)).toEqual({ p: "a.pdf", ids: [res.annotation.id] });
    expect(s.byPage("a.pdf", 1)).toHaveLength(0);
  });
  it("empty document is pruned on save snapshot", () => {
    const save = vi.fn(async () => {});
    const s = new DurableAnnotationStore(save);
    s.loadAndValidate(null);
    const res = s.create("a.pdf", input(), SIG) as any;
    s.delete("a.pdf", res.annotation.id);
    expect(s.data.documents["a.pdf"]).toBeUndefined();
  });
  it("addColor refuses beyond MAX_COLORS (6)", () => {
    const s = new DurableAnnotationStore(async () => {});
    s.loadAndValidate(null);
    // defaults already have 4; fill to 6
    expect(s.addColor()).toBe(true);
    expect(s.addColor()).toBe(true);
    expect(s.data.settings.colors).toHaveLength(6);
    expect(s.addColor()).toBe(false); // 7th rejected
    expect(s.data.settings.colors).toHaveLength(6);
  });
  it("resetSettings restores defaults (colors, default, language)", () => {
    const s = new DurableAnnotationStore(async () => {});
    s.loadAndValidate(null);
    s.addColor();
    s.setLanguage("zh");
    s.setDefaultColor(s.data.settings.colors[1].id);
    expect(s.data.settings.colors.length).toBeGreaterThan(DEFAULT_COLORS.length);
    expect(s.data.settings.language).toBe("zh");
    s.resetSettings();
    expect(s.data.settings.colors.map((c) => c.id)).toEqual(DEFAULT_COLORS.map((c) => c.id));
    expect(s.data.settings.defaultColorId).toBe(DEFAULT_COLOR_ID);
    expect(s.data.settings.language).toBe("auto");
  });
  it("setLanguage persists a valid language and ignores invalid", () => {
    const s = new DurableAnnotationStore(async () => {});
    s.loadAndValidate(null);
    s.setLanguage("zh");
    expect(s.data.settings.language).toBe("zh");
    s.setLanguage("fr" as any);
    expect(s.data.settings.language).toBe("zh"); // unchanged
  });
  it("restore keeps the original id and documentId (H-10)", () => {
    const s = new DurableAnnotationStore(async () => {});
    s.loadAndValidate(null);
    const res = s.create("a.pdf", input(), SIG) as any;
    const annId = res.annotation.id;
    const docId = s.data.documents["a.pdf"].documentId;
    const tombstone = structuredClone(s.byId("a.pdf", annId)!);
    s.delete("a.pdf", annId);
    expect(s.data.documents["a.pdf"]).toBeUndefined(); // pruned
    const r = s.restore("a.pdf", tombstone, docId, SIG) as any;
    expect(r.ok).toBe(true);
    expect(r.annotation.id).toBe(annId); // same id, not a new UUID
    expect(s.data.documents["a.pdf"].documentId).toBe(docId); // document identity preserved
  });

  it("transactionally rekeys one PDF with one immutable persisted snapshot", async () => {
    const save = vi.fn(async (_data: any) => {});
    const s = new DurableAnnotationStore(save);
    s.loadAndValidate(null);
    const created = s.create("old.pdf", input(2, 240), SIG);
    if (!created.ok) throw new Error(created.reason);
    await s.flushBestEffort();
    save.mockClear();

    const before = structuredClone(s.data.documents["old.pdf"]);
    const changes = vi.fn();
    s.onChange(changes);
    const stateRevision = s.data.stateRevision;

    const result = s.rekeyDocumentPaths([{ oldPath: "old.pdf", newPath: "archive/new.pdf" }]);

    expect(result).toEqual({ ok: true, moved: 1 });
    expect(s.data.stateRevision).toBe(stateRevision + 1);
    expect(s.data.documents["old.pdf"]).toBeUndefined();
    expect(s.data.documents["archive/new.pdf"]).toEqual({ ...before, revision: before.revision + 1 });
    expect(s.data.documents["archive/new.pdf"].documentId).toBe(before.documentId);
    expect(s.data.documents["archive/new.pdf"].sourceSignature).toEqual(before.sourceSignature);
    expect(s.data.documents["archive/new.pdf"].annotations).toEqual(before.annotations);
    expect(s.byId("archive/new.pdf", created.annotation.id)).toEqual(created.annotation);
    expect(s.byPath("old.pdf")).toEqual([]);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(changes).toHaveBeenCalledWith("documents", [], {
      documentMoves: [{ oldPath: "old.pdf", newPath: "archive/new.pdf" }],
    });

    expect(save).toHaveBeenCalledTimes(1);
    const persisted = save.mock.calls[0][0];
    s.data.documents["archive/new.pdf"].sourceSignature.pdfFingerprint = "live-mutation";
    expect(persisted.documents["archive/new.pdf"].sourceSignature.pdfFingerprint).toBe("fp");
    await s.flushBestEffort();

    const reloaded = new DurableAnnotationStore(async () => {});
    expect(reloaded.loadAndValidate(persisted)).toBe("valid");
    expect(reloaded.data.documents["archive/new.pdf"]).toEqual({ ...before, revision: before.revision + 1 });
    expect(reloaded.byId("archive/new.pdf", created.annotation.id)).toEqual(created.annotation);
  });

  it("rekeys a folder-prefix batch with one global revision and one revision per moved document", async () => {
    const save = vi.fn(async (_data: any) => {});
    const s = new DurableAnnotationStore(save);
    s.loadAndValidate(null);
    const first = s.create("old/a.pdf", input(1), SIG);
    await s.flushBestEffort();
    const second = s.create("old/nested/b.pdf", input(3), { pdfFingerprint: "fp-b", numPages: 3 });
    if (!first.ok) throw new Error(first.reason);
    if (!second.ok) throw new Error(second.reason);
    await s.flushBestEffort();
    save.mockClear();
    const beforeStateRevision = s.data.stateRevision;
    const beforeA = structuredClone(s.data.documents["old/a.pdf"]);
    const beforeB = structuredClone(s.data.documents["old/nested/b.pdf"]);

    const result = s.rekeyDocumentPaths([
      { oldPath: "old/a.pdf", newPath: "renamed/a.pdf" },
      { oldPath: "old/nested/b.pdf", newPath: "renamed/nested/b.pdf" },
    ]);

    expect(result).toEqual({ ok: true, moved: 2 });
    expect(s.data.stateRevision).toBe(beforeStateRevision + 1);
    expect(s.data.documents["renamed/a.pdf"]).toEqual({ ...beforeA, revision: beforeA.revision + 1 });
    expect(s.data.documents["renamed/nested/b.pdf"]).toEqual({ ...beforeB, revision: beforeB.revision + 1 });
    expect(s.byId("renamed/a.pdf", first.annotation.id)).toEqual(first.annotation);
    expect(s.byId("renamed/nested/b.pdf", second.annotation.id)).toEqual(second.annotation);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("treats an annotation-free rename and replay of an applied rename as no-ops", async () => {
    const save = vi.fn(async (_data: any) => {});
    const s = new DurableAnnotationStore(save);
    s.loadAndValidate(null);
    const changes = vi.fn();
    s.onChange(changes);

    expect(s.rekeyDocumentPaths([{ oldPath: "empty.pdf", newPath: "renamed.pdf" }])).toEqual({ ok: true, moved: 0 });
    expect(s.data.stateRevision).toBe(0);
    expect(changes).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();

    const created = s.create("old.pdf", input(), SIG);
    if (!created.ok) throw new Error(created.reason);
    await s.flushBestEffort();
    save.mockClear();
    changes.mockClear();
    expect(s.rekeyDocumentPaths([{ oldPath: "old.pdf", newPath: "new.pdf" }])).toEqual({ ok: true, moved: 1 });
    await s.flushBestEffort();
    save.mockClear();
    changes.mockClear();
    const revision = s.data.stateRevision;

    expect(s.rekeyDocumentPaths([{ oldPath: "old.pdf", newPath: "new.pdf" }])).toEqual({ ok: true, moved: 0 });
    expect(s.data.stateRevision).toBe(revision);
    expect(s.byId("new.pdf", created.annotation.id)).toEqual(created.annotation);
    expect(changes).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects rekeying in read-only mode without changing either path", async () => {
    const save = vi.fn(async (_data: any) => {});
    const s = new DurableAnnotationStore(save);
    s.loadAndValidate(null);
    const created = s.create("old.pdf", input(), SIG);
    if (!created.ok) throw new Error(created.reason);
    await s.flushBestEffort();
    save.mockClear();
    const before = structuredClone(s.data);
    const changes = vi.fn();
    s.onChange(changes);
    s.isReadonly = true;

    expect(s.rekeyDocumentPaths([{ oldPath: "old.pdf", newPath: "new.pdf" }])).toEqual({
      ok: false,
      reason: "readonly",
    });
    expect(s.data).toEqual(before);
    expect(changes).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects a destination collision atomically and preserves both documents", async () => {
    const save = vi.fn(async (_data: any) => {});
    const s = new DurableAnnotationStore(save);
    s.loadAndValidate(null);
    const source = s.create("source.pdf", input(), SIG);
    await s.flushBestEffort();
    const destination = s.create("destination.pdf", input(2), { pdfFingerprint: "destination-fp", numPages: 3 });
    if (!source.ok) throw new Error(source.reason);
    if (!destination.ok) throw new Error(destination.reason);
    await s.flushBestEffort();
    save.mockClear();
    const before = structuredClone(s.data);
    const changes = vi.fn();
    s.onChange(changes);

    expect(s.rekeyDocumentPaths([{ oldPath: "source.pdf", newPath: "destination.pdf" }])).toEqual({
      ok: false,
      reason: "destination-conflict",
    });
    expect(s.data).toEqual(before);
    expect(s.byId("source.pdf", source.annotation.id)).toEqual(source.annotation);
    expect(s.byId("destination.pdf", destination.annotation.id)).toEqual(destination.annotation);
    expect(changes).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  // finalize() is the unload path (main.ts registers it). It must write the
  // latest full snapshot so unsaved mutations survive a plugin reload that
  // Obsidian performs without awaiting async cleanup.
  it("finalize writes the latest full snapshot including mutations made after the last drain", async () => {
    const saved: number[] = [];
    const save = vi.fn(async (data: any) => { saved.push(data.stateRevision); });
    const s = new DurableAnnotationStore(save);
    s.loadAndValidate(null);
    // Mutate after load. The coordinator's drain is async; finalize must save
    // the current snapshot regardless of whether drain has picked it up.
    s.create("a.pdf", input(), SIG);
    s.create("a.pdf", input(2), SIG);
    await s.finalize();
    // The last persisted snapshot includes both annotations.
    const last = save.mock.calls.at(-1)![0];
    expect(Object.keys(last.documents["a.pdf"].annotations)).toHaveLength(2);
    expect(saved.at(-1)).toBe(s.data.stateRevision);
  });

  it("finalize seals the store: later mutations do not enqueue saves", async () => {
    const save = vi.fn(async () => {});
    const s = new DurableAnnotationStore(save);
    s.loadAndValidate(null);
    await s.finalize();
    save.mockClear();
    s.create("a.pdf", input(), SIG); // mutation after finalize
    // Give any stray drain a chance to fire.
    await new Promise((r) => setTimeout(r, 10));
    expect(save).not.toHaveBeenCalled();
  });

  // displayMode: each annotation carries a "card" | "popover" display form.
  // New annotations inherit settings.defaultDisplayMode; update() can patch it;
  // setDisplayModeForAll is the bulk toolbar action (atomic, single revision).
  it("create stamps displayMode from settings.defaultDisplayMode", () => {
    const s = new DurableAnnotationStore(async () => {});
    s.loadAndValidate(null);
    s.data.settings.defaultDisplayMode = "popover";
    const r = s.create("a.pdf", input(), SIG);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.annotation.displayMode).toBe("popover");
    // Default is "card".
    s.data.settings.defaultDisplayMode = "card";
    const r2 = s.create("a.pdf", input(2), SIG);
    if (r2.ok) expect(r2.annotation.displayMode).toBe("card");
  });
  it("update patches displayMode", () => {
    const s = new DurableAnnotationStore(async () => {});
    s.loadAndValidate(null);
    const created = s.create("a.pdf", input(), SIG);
    if (!created.ok) throw new Error(created.reason);
    const r = s.update("a.pdf", created.annotation.id, { displayMode: "popover" }, created.annotation.revision);
    expect(r.ok).toBe(true);
    expect(s.byId("a.pdf", created.annotation.id)?.displayMode).toBe("popover");
  });
  it("setDisplayModeForAll atomically sets every annotation's displayMode in one revision bump", () => {
    const save = vi.fn(async () => {});
    const s = new DurableAnnotationStore(save);
    s.loadAndValidate(null);
    s.create("a.pdf", input(1), SIG);
    s.create("a.pdf", input(2), SIG);
    s.create("b.pdf", input(1), { pdfFingerprint: "fp-b", numPages: 3 });
    const before = s.data.stateRevision;
    const result = s.setDisplayModeForAll("a.pdf", "popover");
    expect(result).toEqual({ ok: true, changed: 2 });
    expect(s.data.stateRevision).toBe(before + 1); // single bump, not one-per-annotation
    expect(s.byPath("a.pdf").every((a) => a.displayMode === "popover")).toBe(true);
    expect(s.byPath("b.pdf").every((a) => a.displayMode === "card")).toBe(true); // other docs untouched
  });
  it("setDisplayModeForAll refuses a readonly store", () => {
    const s = new DurableAnnotationStore(async () => {});
    s.loadAndValidate({ schemaVersion: 2 }); // future -> readonly
    expect(s.setDisplayModeForAll("a.pdf", "popover")).toEqual({ ok: false, reason: "store is read-only" });
  });
});
