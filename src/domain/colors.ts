// src/domain/colors.ts
export interface ColorConfigV1 {
  id: string;
  name: string;
  value: string; // validated #RRGGBB
}

export const DEFAULT_COLORS: ColorConfigV1[] = [
  { id: "yellow", name: "Yellow", value: "#fff15c" },
  { id: "blue", name: "Blue", value: "#5cc8ff" },
  { id: "green", name: "Green", value: "#7ee787" },
  { id: "red", name: "Red", value: "#ff7b72" },
];

export const DEFAULT_COLOR_ID = "yellow";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function validateHexColor(s: unknown): string | null {
  return typeof s === "string" && HEX_RE.test(s) ? s : null;
}

export function findColor(colors: ColorConfigV1[], id: string): ColorConfigV1 | undefined {
  return colors.find((c) => c.id === id);
}

// spec §10.8 + §13.3: at least one color, valid hex, non-empty id.
export function normalizeColors(input: unknown[]): ColorConfigV1[] {
  const out: ColorConfigV1[] = [];
  const seen = new Set<string>();
  let autoIdx = 0;
  for (const raw of input) {
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
