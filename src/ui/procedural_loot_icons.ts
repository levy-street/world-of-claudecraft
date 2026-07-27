// Project-owned, hand-authored legendary-power rune. It is deliberately
// geometric and code-native: no third-party art, raster dependency, or
// per-instance cache key. The hollow diamond gives a non-color rarity cue while
// the inner knot communicates that the item carries an active power.
export const LEGENDARY_POWER_RUNE_MARKUP =
  '<path fill-rule="evenodd" d="M256 28 484 256 256 484 28 256 256 28zm0 62L90 256l166 166 166-166L256 90z"/><path d="m256 132 62 62-30 30-32-32-32 32-30-30 62-62zm-62 186 30-30 32 32 32-32 30 30-62 62-62-62zm-62-62 62-62 30 30-32 32 32 32-30 30-62-62zm248 0-62 62-30-30 32-32-32-32 30-30 62 62z"/>';

export function legendaryPowerRuneSvg(className = ''): string {
  const cls = className ? ` ${className}` : '';
  return `<svg class="item-power-rune${cls}" viewBox="0 0 512 512" fill="currentColor" aria-hidden="true" focusable="false">${LEGENDARY_POWER_RUNE_MARKUP}</svg>`;
}
