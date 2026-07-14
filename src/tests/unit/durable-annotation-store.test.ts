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
    s.onChange((p, ids) => changes.push({ p, ids }));
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
  it("delete removes and emits change", () => {
    const save = vi.fn(async () => {});
    const s = new DurableAnnotationStore(save);
    s.loadAndValidate(null);
    const res = s.create("a.pdf", input(), SIG) as any;
    const changes: { p: string; ids: string[] }[] = [];
    s.onChange((p, ids) => changes.push({ p, ids }));
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
    const tombstone = structuredClone(s.byId("a.pdf", annId));
    s.delete("a.pdf", annId);
    expect(s.data.documents["a.pdf"]).toBeUndefined(); // pruned
    const r = s.restore("a.pdf", tombstone, docId, SIG) as any;
    expect(r.ok).toBe(true);
    expect(r.annotation.id).toBe(annId); // same id, not a new UUID
    expect(s.data.documents["a.pdf"].documentId).toBe(docId); // document identity preserved
  });
});
