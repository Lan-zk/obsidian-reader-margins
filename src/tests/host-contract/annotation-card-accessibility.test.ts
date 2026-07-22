// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { buildCard, type CardCallbacks } from "src/render/annotation-card-rail";
import { makeT } from "src/i18n";

function callbacks(): CardCallbacks {
  return {
    onHover: vi.fn(), onDragStart: vi.fn(), onResetPosition: vi.fn(),
    onEdit: vi.fn(), onDraftUpdate: vi.fn(), onCommitComment: vi.fn(),
    onCancelEdit: vi.fn(), onChangeColor: vi.fn(), onToggleType: vi.fn(), onDelete: vi.fn(),
  };
}

describe("annotation card accessibility", () => {
  it("uses a full-size button target around the 16px visual color dot", () => {
    const cb = callbacks();
    const card = buildCard(document.body, {
      id: "a1", quote: "quote", color: "#e1c380",
      colors: [{ id: "yellow", value: "#e1c380", label: "Yellow" }],
      markStyle: "highlight", side: "right", anchorY: 10, cardLeft: 20, cardWidth: 200,
    }, cb, makeT("en", "en"));

    const button = card.querySelector<HTMLButtonElement>(".rm-color-swatch")!;
    expect(button.querySelector(".rm-color-swatch-dot")).toBeTruthy();
  });

  it("mirrors pointer hover linking when keyboard focus enters and leaves the card", () => {
    const cb = callbacks();
    const card = buildCard(document.body, {
      id: "a1", quote: "quote", color: "#e1c380", colors: [],
      markStyle: "highlight", side: "right", anchorY: 10, cardLeft: 20, cardWidth: 200,
    }, cb, makeT("en", "en"));
    const grip = card.querySelector<HTMLButtonElement>(".rm-card-grip")!;

    grip.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(cb.onHover).toHaveBeenCalledWith("a1", true);
    grip.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }));
    expect(cb.onHover).toHaveBeenLastCalledWith("a1", false);
  });
  it("keeps keyboard linking active when focus moves inside a card in another window realm", () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const popupWindow = frame.contentWindow!;
    const popupDocument = frame.contentDocument!;
    const cb = callbacks();
    const card = buildCard(popupDocument.body, {
      id: "a1", quote: "quote", color: "#e1c380",
      colors: [{ id: "yellow", value: "#e1c380", label: "Yellow" }],
      markStyle: "highlight", side: "right", anchorY: 10, cardLeft: 20, cardWidth: 200,
    }, cb, makeT("en", "en"));
    const grip = card.querySelector<HTMLButtonElement>(".rm-card-grip")!;
    const swatch = card.querySelector<HTMLButtonElement>(".rm-color-swatch")!;
    const PopupFocusEvent = (popupWindow as any).FocusEvent as typeof FocusEvent;

    grip.dispatchEvent(new PopupFocusEvent("focusin", { bubbles: true }));
    grip.dispatchEvent(new PopupFocusEvent("focusout", { bubbles: true, relatedTarget: swatch }));
    expect(cb.onHover).not.toHaveBeenCalledWith("a1", false);
    frame.remove();
  });
  it("selects the current swatch by color id when multiple colors share a hex value", () => {
    const card = buildCard(document.body, {
      id: "a1", quote: "quote", color: "#e1c380", colorId: "yellow",
      colors: [
        { id: "yellow", value: "#e1c380", label: "Yellow" },
        { id: "gold", value: "#e1c380", label: "Gold" },
      ],
      markStyle: "highlight", side: "right", anchorY: 10, cardLeft: 20, cardWidth: 200,
    }, callbacks(), makeT("en", "en"));

    const swatches = [...card.querySelectorAll<HTMLButtonElement>(".rm-color-swatch")];
    expect(swatches.map((swatch) => swatch.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    expect(card.querySelectorAll(".rm-color-swatch-active")).toHaveLength(1);
  });
  it("uses a unique value match only for legacy annotations without a color id", () => {
    const unique = buildCard(document.body, {
      id: "legacy-1", quote: "quote", color: "#e1c380",
      colors: [{ id: "yellow", value: "#e1c380", label: "Yellow" }],
      markStyle: "highlight", side: "right", anchorY: 10, cardLeft: 20, cardWidth: 200,
    }, callbacks(), makeT("en", "en"));
    expect(unique.querySelectorAll(".rm-color-swatch-active")).toHaveLength(1);

    const ambiguous = buildCard(document.body, {
      id: "legacy-2", quote: "quote", color: "#e1c380",
      colors: [
        { id: "yellow", value: "#e1c380", label: "Yellow" },
        { id: "gold", value: "#e1c380", label: "Gold" },
      ],
      markStyle: "highlight", side: "right", anchorY: 10, cardLeft: 20, cardWidth: 200,
    }, callbacks(), makeT("en", "en"));
    expect(ambiguous.querySelectorAll(".rm-color-swatch-active")).toHaveLength(0);
  });
  it("Ctrl/Cmd+Enter commits the comment and Escape cancels from the edit textarea", () => {
    const cb = callbacks();
    const card = buildCard(document.body, {
      id: "a1", quote: "quote", color: "#e1c380",
      colors: [{ id: "yellow", value: "#e1c380", label: "Yellow" }],
      markStyle: "highlight", side: "right", anchorY: 10, cardLeft: 20, cardWidth: 200,
      editing: true,
    }, cb, makeT("en", "en"));
    const ta = card.querySelector<HTMLTextAreaElement>(".rm-card-edit")!;
    ta.focus();

    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(cb.onCommitComment).toHaveBeenCalledWith("a1", "");

    // Escape cancels a fresh edit card.
    const cb2 = callbacks();
    const card2 = buildCard(document.body, {
      id: "a2", quote: "quote", color: "#e1c380",
      colors: [{ id: "yellow", value: "#e1c380", label: "Yellow" }],
      markStyle: "highlight", side: "right", anchorY: 10, cardLeft: 20, cardWidth: 200,
      editing: true,
    }, cb2, makeT("en", "en"));
    const ta2 = card2.querySelector<HTMLTextAreaElement>(".rm-card-edit")!;
    ta2.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(cb2.onCancelEdit).toHaveBeenCalledWith("a2");
  });
  it("clicking outside the card commits the edit (click-away), not textarea blur", () => {
    const cb = callbacks();
    const card = buildCard(document.body, {
      id: "a1", quote: "quote", color: "#e1c380",
      colors: [{ id: "yellow", value: "#e1c380", label: "Yellow" }],
      markStyle: "highlight", side: "right", anchorY: 10, cardLeft: 20, cardWidth: 200,
      editing: true,
    }, cb, makeT("en", "en"));
    const ta = card.querySelector<HTMLTextAreaElement>(".rm-card-edit")!;
    ta.value = "click-away text";
    // A blur alone (e.g. host stealing focus) must NOT commit - that used to
    // close the edit box before the user typed.
    ta.dispatchEvent(new FocusEvent("blur"));
    expect(cb.onCommitComment).not.toHaveBeenCalled();
    // A pointerdown outside the card is an intentional click-away -> commit.
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    expect(cb.onCommitComment).toHaveBeenCalledWith("a1", "click-away text");
  });
  it("a rebuilt card's stale away-listener detaches without committing a stale value", () => {
    const cb = callbacks();
    buildCard(document.body, {
      id: "a1", quote: "quote", color: "#e1c380",
      colors: [{ id: "yellow", value: "#e1c380", label: "Yellow" }],
      markStyle: "highlight", side: "right", anchorY: 10, cardLeft: 20, cardWidth: 200,
      editing: true,
    }, cb, makeT("en", "en"));
    // Rebuild the same annotation id (zoom/textlayer re-render path): buildCard
    // dedups the old card, but its away-listener lingers on the document.
    const cb2 = callbacks();
    buildCard(document.body, {
      id: "a1", quote: "quote", color: "#e1c380",
      colors: [{ id: "yellow", value: "#e1c380", label: "Yellow" }],
      markStyle: "highlight", side: "right", anchorY: 10, cardLeft: 20, cardWidth: 200,
      editing: true,
    }, cb2, makeT("en", "en"));
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    // The stale (disconnected) card's callback must not fire.
    expect(cb.onCommitComment).not.toHaveBeenCalled();
    // The current (connected) card commits.
    expect(cb2.onCommitComment).toHaveBeenCalledWith("a1", "");
  });
});
