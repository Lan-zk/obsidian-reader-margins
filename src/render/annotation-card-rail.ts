// src/render/annotation-card-rail.ts
import { createIcon } from "src/render/icons";
import type { Translate } from "src/i18n";
import { annotationElements } from "src/render/annotation-dom";

export interface CardCallbacks {
  onHover: (id: string, on: boolean) => void;
  onDragStart: (id: string, e: PointerEvent, card: HTMLElement) => void;
  onResetPosition: (id: string) => void;
  onEdit: (id: string) => void;
  onDraftUpdate: (id: string, value: string) => void;
  onCommitComment: (id: string, value: string) => void;
  onCancelEdit: (id: string) => void;
  onChangeColor: (id: string, colorId: string) => void;
  onToggleType: (id: string) => void;
  onDelete: (id: string) => void;
}
export interface BuildCardInput {
  id: string;
  quote: string;
  comment?: string;
  color: string;
  colorId?: string;
  colors: { id: string; value: string; label: string }[];
  markStyle: "highlight" | "underline";
  side: "left" | "right";
  anchorY: number;
  editing?: boolean;
  draftValue?: string;
  cardLeft: number;
  cardWidth: number;
}

// Card layout (docs/design.md): border-defined card on the base surface (no gray
// fill), quote with 1px left line, comment, color swatches (left) + delete (right),
// grip drag-handle (top-right). Hover = selected state.
// All text via textContent; never innerHTML (spec §14.1).
export function buildCard(parent: HTMLElement, input: BuildCardInput, cb: CardCallbacks, t: Translate): HTMLElement {
  const doc = parent.ownerDocument;
  const valueMatches = input.colors.filter((color) => color.value.toLowerCase() === input.color.toLowerCase());
  const activeColorId = input.colorId && input.colors.some((color) => color.id === input.colorId)
    ? input.colorId
    : valueMatches.length === 1 ? valueMatches[0].id : undefined;
  // Dedup: remove existing card for this annotation (re-render).
  annotationElements(parent, ".rm-card", input.id).forEach((node) => node.remove());

  const card = doc.createElement("div");
  card.className = "rm-card";
  card.dataset.annotationId = input.id;
  card.style.position = "absolute";
  card.style.top = `${input.anchorY}px`;
  card.style.left = `${input.cardLeft}px`;
  card.style.width = `${input.cardWidth}px`;
  card.style.setProperty("--rm-card-color", input.color); // 标注色 as a token: hover tints bg + deepens border per color

  // Grip drag-handle (top-right): pointerdown starts a drag; dblclick resets position.
  const grip = doc.createElement("button");
  grip.type = "button";
  grip.className = "rm-card-grip";
  grip.title = t("card.drag");
  grip.setAttribute("aria-label", t("card.drag.aria"));
  grip.appendChild(createIcon(doc, "grip", 14));
  grip.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); cb.onDragStart(input.id, e, card); });
  grip.addEventListener("dblclick", (e) => { e.stopPropagation(); cb.onResetPosition(input.id); });
  card.appendChild(grip);

  // Hover = selected state: highlight this card's connector (the card itself is
  // styled via CSS :hover). Re-render preserves the connector via its `selected` flag.
  card.addEventListener("mouseenter", () => cb.onHover(input.id, true));
  card.addEventListener("mouseleave", () => cb.onHover(input.id, false));
  card.addEventListener("focusin", () => cb.onHover(input.id, true));
  card.addEventListener("focusout", (event) => {
    const NodeCtor = card.ownerDocument.defaultView?.Node;
    const remainsInside = !!NodeCtor && event.relatedTarget instanceof NodeCtor && card.contains(event.relatedTarget);
    if (!remainsInside) cb.onHover(input.id, false);
  });

  // Scrollable text area (quote + comment/textarea); ops stay fixed at the bottom.
  const textArea = doc.createElement("div");
  textArea.className = "rm-card-text";

  // 高亮的原文: always shown, faint left line, muted.
  const quoteEl = doc.createElement("div");
  quoteEl.className = "rm-card-quote";
  quoteEl.textContent = input.quote;
  quoteEl.title = input.quote; // the quote is clamped to 3 lines - hover reveals it whole
  textArea.appendChild(quoteEl);

  if (input.editing) {
    // 用户批注内容: textarea (edit mode).
    const ta = doc.createElement("textarea");
    ta.className = "rm-card-edit";
    ta.value = input.draftValue ?? input.comment ?? "";
    ta.placeholder = t("card.placeholder");
    // Sync every input into the DraftController so a re-render (zoom/textlayer
    // rebuild) or conflict restores the current value instead of the stale one (H-04).
    ta.addEventListener("input", () => cb.onDraftUpdate(input.id, ta.value));
    textArea.appendChild(ta);
    card.appendChild(textArea);
    const actions = doc.createElement("div");
    actions.className = "rm-card-ops rm-card-ops-edit";
    // done flag + mousedown(preventDefault) so save/cancel don't also trigger an
    // away-click commit. The away-click listener is removed once the edit closes.
    let done = false;
    let awayListener: ((e: PointerEvent) => void) | null = null;
    const detachAway = () => {
      if (awayListener) { doc.removeEventListener("pointerdown", awayListener, true); awayListener = null; }
    };
    const commitOnce = () => { if (done) return; done = true; detachAway(); cb.onCommitComment(input.id, ta.value); };
    const cancelOnce = () => { if (done) return; done = true; detachAway(); cb.onCancelEdit(input.id); };
    const save = doc.createElement("button");
    save.className = "rm-card-save"; save.title = t("card.save"); save.appendChild(createIcon(doc, "check", 14));
    save.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); commitOnce(); });
    const cancel = doc.createElement("button");
    cancel.className = "rm-card-cancel"; cancel.title = t("card.cancel"); cancel.appendChild(createIcon(doc, "x", 14));
    cancel.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); cancelOnce(); });
    actions.append(save, cancel);
    card.appendChild(actions);
    queueMicrotask(() => ta.focus());
    ta.addEventListener("keydown", (ev) => {
      // stopPropagation keeps Obsidian's app-level keymap (and PDF.js) from also
      // acting on Ctrl/Cmd+Enter and Esc while the textarea is focused, so the
      // save/cancel actually reaches the card (issue: Ctrl+Enter did not save).
      if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") { ev.preventDefault(); ev.stopPropagation(); commitOnce(); }
      else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); cancelOnce(); }
    });
    // Click-away to save: commit when the user presses the pointer outside this
    // card. We deliberately do NOT commit on textarea blur - in the real host
    // the PDF viewer / Obsidian command system can reclaim focus right after the
    // card is built, and a blur handler would save an empty comment and close
    // the edit box before the user types (issue: edit box did not stay open).
    awayListener = (e: PointerEvent) => {
      if (done) return;
      // If this card was rebuilt/removed (zoom, textlayer re-render), detach the
      // stale listener without committing - the rebuilt card owns the edit now.
      if (!card.isConnected) { detachAway(); return; }
      const target = e.target as Node | null;
      if (target && card.contains(target)) return;
      commitOnce();
    };
    doc.addEventListener("pointerdown", awayListener, true);
  } else {
    // 用户批注内容: shown when present (no left line).
    if (input.comment) {
      const commentEl = doc.createElement("div");
      commentEl.className = "rm-card-comment";
      commentEl.textContent = input.comment;
      textArea.appendChild(commentEl);
    }
    card.appendChild(textArea);
    // Operation row: circular color swatches (left) + delete (right), fixed at bottom.
    const ops = doc.createElement("div");
    ops.className = "rm-card-ops";
    const colorsGroup = doc.createElement("div");
    colorsGroup.className = "rm-card-colors";
    for (const c of input.colors) {
      const sw = doc.createElement("button");
      sw.className = "rm-color-swatch";
      sw.title = c.label;
      sw.setAttribute("aria-label", t("card.color.aria", { label: c.label }));
      const dot = doc.createElement("span");
      dot.className = "rm-color-swatch-dot";
      dot.style.background = c.value;
      sw.appendChild(dot);
      // Mark the card's current color: recognition over recall (and it makes the
      // swatch row read as a state control, not just a palette).
      const active = c.id === activeColorId;
      sw.setAttribute("aria-pressed", String(active));
      if (active) {
        sw.classList.add("rm-color-swatch-active");
      }
      sw.addEventListener("click", (e) => { e.stopPropagation(); cb.onChangeColor(input.id, c.id); });
      colorsGroup.appendChild(sw);
    }
    const toggle = doc.createElement("button");
    toggle.className = "rm-card-toggle";
    // Icon shows the TARGET style (click to switch): highlight → underline icon, and vice versa.
    toggle.appendChild(createIcon(doc, input.markStyle === "highlight" ? "underline" : "highlighter", 14));
    toggle.title = t("card.toggleType");
    toggle.setAttribute("aria-label", t("card.toggleType"));
    toggle.addEventListener("click", (e) => { e.stopPropagation(); cb.onToggleType(input.id); });
    const del = doc.createElement("button");
    del.className = "rm-card-delete"; del.title = t("card.delete"); del.appendChild(createIcon(doc, "trash", 14));
    del.addEventListener("click", (e) => { e.stopPropagation(); cb.onDelete(input.id); });
    // Right-side action group: type toggle + delete (keeps ops row's space-between layout: colors left, actions right).
    const actionsGroup = doc.createElement("div");
    actionsGroup.className = "rm-card-ops-actions";
    actionsGroup.append(toggle, del);
    ops.append(colorsGroup, actionsGroup);
    card.appendChild(ops);
    // Click quote or comment to enter edit mode.
    textArea.addEventListener("click", () => cb.onEdit(input.id));
  }
  parent.appendChild(card);
  return card;
}
