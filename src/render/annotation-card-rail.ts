// src/render/annotation-card-rail.ts
import { createIcon } from "src/render/icons";
import type { Translate } from "src/i18n";

export interface EphemeralCardInput {
  side: "left" | "right";
  text: string;
  color: string;
  anchorY: number;
  id?: string;
}

export function drawEphemeralCard(
  containerEl: HTMLElement,
  pageEl: HTMLElement,
  input: EphemeralCardInput
): HTMLElement {
  const railClass = input.side === "left" ? "rm-card-rail-left" : "rm-card-rail-right";
  let rail = containerEl.querySelector<HTMLElement>(`.${railClass}`);
  if (!rail) {
    rail = containerEl.ownerDocument.createElement("div");
    rail.className = `rm-card-rail ${railClass}`;
    containerEl.appendChild(rail);
  }
  // Remove any existing card for this annotation (prevents duplicates on re-render).
  if (input.id) rail.querySelector(`.rm-card[data-annotation-id="${input.id}"]`)?.remove();
  const card = containerEl.ownerDocument.createElement("div");
  card.className = "rm-card";
  if (input.id) card.dataset.annotationId = input.id;
  card.style.position = "absolute";
  card.style.top = `${input.anchorY}px`;

  const strip = containerEl.ownerDocument.createElement("div");
  strip.className = "rm-card-strip";
  strip.style.background = input.color;
  card.appendChild(strip);

  const body = containerEl.ownerDocument.createElement("div");
  body.className = "rm-card-body";
  body.textContent = input.text; // textContent only - spec §14.1
  card.appendChild(body);

  rail.appendChild(card);
  return card;
}

export interface CardCallbacks {
  onHover: (id: string, on: boolean) => void;
  onDragStart: (id: string, e: PointerEvent, card: HTMLElement) => void;
  onResetPosition: (id: string) => void;
  onEdit: (id: string) => void;
  onCommitComment: (id: string, value: string) => void;
  onCancelEdit: (id: string) => void;
  onChangeColor: (id: string, colorId: string) => void;
  onDelete: (id: string) => void;
}
export interface BuildCardInput {
  id: string;
  quote: string;          // 高亮的原文 (always shown)
  comment?: string;       // 用户批注的内容 (shown when present)
  color: string;
  colors: { id: string; value: string; label: string }[];
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
  // Dedup: remove existing card for this annotation (re-render).
  parent.querySelectorAll(`.rm-card[data-annotation-id="${input.id}"]`).forEach((n) => n.remove());

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

  // Scrollable text area (quote + comment/textarea); ops stay fixed at the bottom.
  const textArea = doc.createElement("div");
  textArea.className = "rm-card-text";

  // 高亮的原文: always shown, faint left line, muted.
  const quoteEl = doc.createElement("div");
  quoteEl.className = "rm-card-quote";
  quoteEl.textContent = input.quote;
  textArea.appendChild(quoteEl);

  if (input.editing) {
    // 用户批注内容: textarea (edit mode).
    const ta = doc.createElement("textarea");
    ta.className = "rm-card-edit";
    ta.value = input.draftValue ?? input.comment ?? "";
    ta.placeholder = "写批注…";
    textArea.appendChild(ta);
    card.appendChild(textArea);
    const actions = doc.createElement("div");
    actions.className = "rm-card-ops rm-card-ops-edit";
    // done flag + mousedown(preventDefault) so save/cancel don't also trigger blur->commit.
    let done = false;
    const commitOnce = () => { if (done) return; done = true; cb.onCommitComment(input.id, ta.value); };
    const cancelOnce = () => { if (done) return; done = true; cb.onCancelEdit(input.id); };
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
      if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") { ev.preventDefault(); commitOnce(); }
      else if (ev.key === "Escape") { ev.preventDefault(); cancelOnce(); }
    });
    ta.addEventListener("blur", () => commitOnce());
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
      sw.style.background = c.value;
      sw.title = c.label;
      sw.setAttribute("aria-label", t("card.color.aria", { label: c.label }));
      sw.addEventListener("click", (e) => { e.stopPropagation(); cb.onChangeColor(input.id, c.id); });
      colorsGroup.appendChild(sw);
    }
    const del = doc.createElement("button");
    del.className = "rm-card-delete"; del.title = t("card.delete"); del.appendChild(createIcon(doc, "trash", 14));
    del.addEventListener("click", (e) => { e.stopPropagation(); cb.onDelete(input.id); });
    ops.append(colorsGroup, del);
    card.appendChild(ops);
    // Click quote or comment to enter edit mode.
    textArea.addEventListener("click", () => cb.onEdit(input.id));
  }
  parent.appendChild(card);
  return card;
}
