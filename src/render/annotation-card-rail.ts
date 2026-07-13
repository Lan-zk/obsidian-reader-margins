// src/render/annotation-card-rail.ts
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
}

// Card layout (docs/design.md + user spec):
//   ┌────────────────────────┐
//   │▌ "quoted original text"  │  ← 原文 (muted, italic)
//   │▌ user comment            │  ← 批注 (normal)
//   │▌ ● ● ● ●  🗑              │  ← color swatches + delete (hover)
//   └────────────────────────┘
// All text via textContent; never innerHTML (spec §14.1).
export function buildCard(parent: HTMLElement, input: BuildCardInput, cb: CardCallbacks): HTMLElement {
  const doc = parent.ownerDocument;
  // Dedup: remove existing card for this annotation (re-render).
  parent.querySelectorAll(`.rm-card[data-annotation-id="${input.id}"]`).forEach((n) => n.remove());

  const card = doc.createElement("div");
  card.className = "rm-card";
  card.dataset.annotationId = input.id;
  card.style.position = "absolute";
  card.style.top = `${input.anchorY}px`;

  // 划线: 3px color strip on the card's page-facing edge.
  const strip = doc.createElement("div");
  strip.className = "rm-card-strip";
  strip.style.background = input.color;
  card.appendChild(strip);

  const content = doc.createElement("div");
  content.className = "rm-card-content";

  // 高亮的原文: always shown, muted quote style.
  const quoteEl = doc.createElement("div");
  quoteEl.className = "rm-card-quote";
  quoteEl.textContent = input.quote;
  content.appendChild(quoteEl);

  if (input.editing) {
    // 用户批注内容: textarea (edit mode).
    const ta = doc.createElement("textarea");
    ta.className = "rm-card-edit";
    ta.value = input.draftValue ?? input.comment ?? "";
    ta.placeholder = "写批注…";
    content.appendChild(ta);
    const ops = doc.createElement("div");
    ops.className = "rm-card-ops rm-card-ops-edit";
    // done flag + mousedown(preventDefault) so save/cancel don't also trigger blur->commit.
    let done = false;
    const commitOnce = () => { if (done) return; done = true; cb.onCommitComment(input.id, ta.value); };
    const cancelOnce = () => { if (done) return; done = true; cb.onCancelEdit(input.id); };
    const save = doc.createElement("button");
    save.className = "rm-card-save"; save.textContent = "✓"; save.title = "保存 (Cmd+Enter)";
    save.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); commitOnce(); });
    const cancel = doc.createElement("button");
    cancel.className = "rm-card-cancel"; cancel.textContent = "✕"; cancel.title = "取消 (Esc)";
    cancel.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); cancelOnce(); });
    ops.append(save, cancel);
    content.appendChild(ops);
    card.appendChild(content);
    queueMicrotask(() => ta.focus());
    ta.addEventListener("keydown", (ev) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") { ev.preventDefault(); commitOnce(); }
      else if (ev.key === "Escape") { ev.preventDefault(); cancelOnce(); }
    });
    ta.addEventListener("blur", () => commitOnce());
  } else {
    // 用户批注内容: shown when present.
    if (input.comment) {
      const commentEl = doc.createElement("div");
      commentEl.className = "rm-card-comment";
      commentEl.textContent = input.comment;
      content.appendChild(commentEl);
    }
    // Operation row (hover/focus-within): color swatches + delete.
    const ops = doc.createElement("div");
    ops.className = "rm-card-ops";
    for (const c of input.colors) {
      const sw = doc.createElement("button");
      sw.className = "rm-color-swatch";
      sw.style.background = c.value;
      sw.title = c.label;
      sw.setAttribute("aria-label", `颜色 ${c.label}`);
      sw.addEventListener("click", (e) => { e.stopPropagation(); cb.onChangeColor(input.id, c.id); });
      ops.appendChild(sw);
    }
    const del = doc.createElement("button");
    del.className = "rm-card-delete"; del.textContent = "🗑"; del.title = "删除";
    del.addEventListener("click", (e) => { e.stopPropagation(); cb.onDelete(input.id); });
    ops.appendChild(del);
    content.appendChild(ops);
    card.appendChild(content);
    // Click quote/comment to enter edit mode.
    content.addEventListener("click", () => cb.onEdit(input.id));
  }
  parent.appendChild(card);
  return card;
}
