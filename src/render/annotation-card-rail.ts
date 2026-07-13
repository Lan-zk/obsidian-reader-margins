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
  onToggleType: (id: string) => void;
  onDelete: (id: string) => void;
}
export interface BuildCardInput {
  id: string;
  comment?: string;
  quotePreview: string;
  color: string;
  colors: { id: string; value: string; label: string }[];
  markStyle: "highlight" | "underline";
  side: "left" | "right";
  anchorY: number;
  editing?: boolean;
  draftValue?: string;
}

// Full card with color strip, body, and hover operation row (spec §3.1, §5.2).
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

  const strip = doc.createElement("div");
  strip.className = "rm-card-strip";
  strip.style.background = input.color;
  card.appendChild(strip);

  const body = doc.createElement("div");
  body.className = "rm-card-body";
  if (!input.comment) body.classList.add("rm-card-preview");

  if (input.editing) {
    const ta = doc.createElement("textarea");
    ta.className = "rm-card-edit";
    ta.value = input.draftValue ?? input.comment ?? "";
    body.appendChild(ta);
    card.appendChild(body);
    // Operation row (save/cancel visible in edit mode)
    const ops = doc.createElement("div");
    ops.className = "rm-card-ops rm-card-ops-edit";
    const save = doc.createElement("button");
    save.className = "rm-card-save"; save.textContent = "✓"; save.title = "Save (Cmd+Enter)";
    save.addEventListener("click", (e) => { e.stopPropagation(); cb.onCommitComment(input.id, ta.value); });
    const cancel = doc.createElement("button");
    cancel.className = "rm-card-cancel"; cancel.textContent = "✕"; cancel.title = "Cancel (Esc)";
    cancel.addEventListener("click", (e) => { e.stopPropagation(); cb.onCancelEdit(input.id); });
    ops.append(save, cancel);
    card.appendChild(ops);
    // Focus + keyboard shortcuts
    queueMicrotask(() => ta.focus());
    ta.addEventListener("keydown", (ev) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") { ev.preventDefault(); cb.onCommitComment(input.id, ta.value); }
      else if (ev.key === "Escape") { ev.preventDefault(); cb.onCancelEdit(input.id); }
    });
    ta.addEventListener("blur", () => cb.onCommitComment(input.id, ta.value));
  } else {
    body.textContent = input.comment ?? input.quotePreview;
    card.appendChild(body);
    // Operation row (hover/focus-within)
    const ops = doc.createElement("div");
    ops.className = "rm-card-ops";
    for (const c of input.colors) {
      const sw = doc.createElement("button");
      sw.className = "rm-color-swatch";
      sw.style.background = c.value;
      sw.title = c.label;
      sw.setAttribute("aria-label", `Color ${c.label}`);
      sw.addEventListener("click", (e) => { e.stopPropagation(); cb.onChangeColor(input.id, c.id); });
      ops.appendChild(sw);
    }
    const toggle = doc.createElement("button");
    toggle.className = "rm-card-toggle";
    toggle.textContent = input.markStyle === "highlight" ? "U̲" : "H";
    toggle.title = input.markStyle === "highlight" ? "Convert to underline" : "Convert to highlight";
    toggle.addEventListener("click", (e) => { e.stopPropagation(); cb.onToggleType(input.id); });
    ops.appendChild(toggle);
    const del = doc.createElement("button");
    del.className = "rm-card-delete"; del.textContent = "🗑"; del.title = "Delete";
    del.addEventListener("click", (e) => { e.stopPropagation(); cb.onDelete(input.id); });
    ops.appendChild(del);
    card.appendChild(ops);
    // Click body to enter edit mode
    body.addEventListener("click", () => cb.onEdit(input.id));
  }
  parent.appendChild(card);
  return card;
}
