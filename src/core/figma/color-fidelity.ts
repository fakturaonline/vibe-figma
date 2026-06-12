/**
 * Color fidelity
 *
 * The AI cleanup step occasionally drifts a color by a few units when it
 * transcribes hex/rgb values from the markup (e.g. #097fb5 → #097fb1). For a
 * design system that is wrong — the colors must be exactly the design's.
 *
 * This module fixes that deterministically: it extracts the ground-truth
 * palette from the RAW rendered markup (before the AI touches it), then snaps
 * every color literal in the AI output to the nearest palette color when it is
 * within a small distance. Far-off colors (intentional choices, Tailwind
 * classes, etc.) are left untouched, and palette colors are well separated, so
 * this only repairs drift — it never merges distinct design colors.
 */

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, n));
}

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => clampByte(n).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function normalizeHex(hex: string): string | null {
  const m = hex.replace('#', '');
  if (/^[0-9a-fA-F]{3}$/.test(m)) {
    return `#${m[0]}${m[0]}${m[1]}${m[1]}${m[2]}${m[2]}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(m)) {
    return `#${m.toLowerCase()}`;
  }
  return null;
}

function hexToRgb(hex: string): Rgb {
  const m = hex.slice(1);
  return {
    r: parseInt(m.slice(0, 2), 16),
    g: parseInt(m.slice(2, 4), 16),
    b: parseInt(m.slice(4, 6), 16),
  };
}

function distance(a: Rgb, b: Rgb): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

/** Extract the set of normalized `#rrggbb` colors used in some markup. */
export function extractPalette(code: string): string[] {
  const palette = new Set<string>();

  for (const m of code.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
    const n = normalizeHex(m[0]);
    if (n) palette.add(n);
  }
  for (const m of code.matchAll(/#[0-9a-fA-F]{3}\b/g)) {
    const n = normalizeHex(m[0]);
    if (n) palette.add(n);
  }
  for (const m of code.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) {
    palette.add(toHex(Number(m[1]), Number(m[2]), Number(m[3])));
  }

  return Array.from(palette);
}

function nearestPaletteColor(hex: string, palette: Rgb[], paletteHex: string[], threshold: number): string | null {
  const c = hexToRgb(hex);
  let best: string | null = null;
  let bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const d = distance(c, palette[i]);
    if (d < bestD) {
      bestD = d;
      best = paletteHex[i];
    }
  }
  return best && bestD > 0 && bestD <= threshold ? best : null;
}

export interface SnapResult {
  code: string;
  snapped: number;
}

/**
 * Snap every hex/rgb color literal in `code` to the nearest palette color when
 * it is within `threshold` (RGB Euclidean distance). Returns the rewritten code
 * and how many literals were corrected.
 */
export function snapColorsToPalette(code: string, paletteHex: string[], threshold = 16): SnapResult {
  if (paletteHex.length === 0) return { code, snapped: 0 };
  const paletteRgb = paletteHex.map(hexToRgb);
  let snapped = 0;

  // Snap 6-digit hex literals (Tailwind arbitrary values like bg-[#097fb1]).
  let out = code.replace(/#[0-9a-fA-F]{6}\b/g, (lit) => {
    const norm = normalizeHex(lit);
    if (!norm) return lit;
    const near = nearestPaletteColor(norm, paletteRgb, paletteHex, threshold);
    if (near && near !== norm) {
      snapped++;
      return near;
    }
    return lit;
  });

  // Snap rgb()/rgba() literals, preserving any alpha.
  out = out.replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)([^)]*)\)/g, (lit, r, g, b, rest) => {
    const hex = toHex(Number(r), Number(g), Number(b));
    const near = nearestPaletteColor(hex, paletteRgb, paletteHex, threshold);
    if (near && near !== hex) {
      snapped++;
      const c = hexToRgb(near);
      const alpha = String(rest).trim();
      return alpha.startsWith(',')
        ? `rgba(${c.r}, ${c.g}, ${c.b}${alpha})`
        : `rgb(${c.r}, ${c.g}, ${c.b})`;
    }
    return lit;
  });

  return { code: out, snapped };
}

/** Extract the palette from `source` and snap `code`'s colors to it. */
export function applyColorFidelity(code: string, source: string, threshold = 16): SnapResult {
  return snapColorsToPalette(code, extractPalette(source), threshold);
}
