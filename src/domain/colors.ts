// src/domain/colors.ts
export interface ColorConfigV1 {
  id: string;
  name: string;
  value: string; // validated #RRGGBB
}

export const DEFAULT_COLORS: ColorConfigV1[] = [
  { id: "yellow", name: "Yellow", value: "#e1c380" },
  { id: "blue", name: "Blue", value: "#abcbdf" },
  { id: "green", name: "Green", value: "#bace97" },
  { id: "red", name: "Red", value: "#ffb4ab" },
];

export const DEFAULT_COLOR_ID = "yellow";

export const MAX_COLORS = 6;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function validateHexColor(s: unknown): string | null {
  return typeof s === "string" && HEX_RE.test(s) ? s : null;
}

export function findColor(colors: ColorConfigV1[], id: string): ColorConfigV1 | undefined {
  return colors.find((c) => c.id === id);
}

// spec §10.8 + §13.3: at least one color, valid hex, non-empty id. Capped at
// MAX_COLORS so an over-long list (e.g. from an older build) is truncated on load.
export function normalizeColors(input: unknown[]): ColorConfigV1[] {
  const out: ColorConfigV1[] = [];
  const seen = new Set<string>();
  let autoIdx = 0;
  for (const raw of input) {
    if (out.length >= MAX_COLORS) break;
    const r = raw as Record<string, unknown>;
    const value = validateHexColor(r?.value);
    if (!value) continue;
    let id = typeof r.id === "string" ? r.id : "";
    if (!id || seen.has(id)) {
      do { autoIdx++; id = `auto-${autoIdx}`; } while (seen.has(id));
    }
    seen.add(id);
    out.push({ id, name: typeof r.name === "string" && r.name ? r.name : id, value });
  }
  return out;
}

// Pure settings rules (spec §13.3). Live in domain so the store can reuse them
// without depending on the settings UI layer.
export function canDeleteColor(rows: { id: string }[], targetId: string, defaultColorId: string): boolean {
  if (rows.length <= 1) return false;       // never delete the last color
  if (targetId === defaultColorId) return false; // never delete the default
  return true;
}

export function validateSettingsMutation(
  rows: { id: string; name: string; value: string }[],
  defaultColorId: string,
): { ok: true } | { ok: false; reason: string } {
  if (rows.length === 0) return { ok: false, reason: "At least one color is required." };
  if (rows.length > MAX_COLORS) return { ok: false, reason: `At most ${MAX_COLORS} colors are allowed.` };
  const names = new Set<string>();
  for (const r of rows) {
    if (!r.name.trim()) return { ok: false, reason: "Color name cannot be empty." };
    if (names.has(r.name)) return { ok: false, reason: `Duplicate color name: ${r.name}` };
    names.add(r.name);
    if (!validateHexColor(r.value)) return { ok: false, reason: `Invalid color value: ${r.value}` };
  }
  if (!rows.some((r) => r.id === defaultColorId)) return { ok: false, reason: "Default color must exist." };
  return { ok: true };
}
