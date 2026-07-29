// Pure helper: derive a paperdoll socket's soft glow from an item's quality
// color. The showcase sockets carry a ~0.45-alpha outer glow in the item's
// quality hue (plus a fixed inner shade for depth). Deriving it from the known
// quality hex (QUALITY_COLOR) keeps the paint path off getComputedStyle: the
// painter sets the box-shadow inline from this string, no style round-trip.
//
// DOM-free and deterministic, so tests/quality_glow.test.ts pins the exact
// shadow string for a quality color.

/** Parse a #rgb or #rrggbb hex string to its 0-255 channels, or null when the
 *  input is not a plain hex color (e.g. an empty slot's CSS-var border, which
 *  gets no quality glow). */
function hexToRgb(color: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(color.trim());
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  const n = Number.parseInt(hex, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/** The box-shadow for a filled socket: a 9px outer glow at 0.45 alpha in the
 *  item's quality color, plus a fixed inset shade. Returns '' for a non-hex
 *  color (an empty slot), so the caller leaves the socket's box-shadow unset. */
export function qualityGlowShadow(color: string): string {
  const rgb = hexToRgb(color);
  if (!rgb) return '';
  const { r, g, b } = rgb;
  return `0 0 9px 0 rgba(${r}, ${g}, ${b}, 0.45), inset 0 0 6px rgba(0, 0, 0, 0.5)`;
}
