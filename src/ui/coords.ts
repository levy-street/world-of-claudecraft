// Pure, DOM-free formatter for the minimap coordinate readout. Kept separate
// from hud.ts so it can be unit-tested in isolation (mirrors xp_bar.ts /
// clock.ts). The world uses yard-space x (east-west) and z (north-south); the
// readout floors them to whole yards so the text stays stable as the player
// walks, matching the coordinates the /where chat command reports. The digits
// route through formatNumber so they follow the active locale's numerals (the
// ', ' delimiter between the two axes is kept).
import { formatNumber } from './i18n';

export function formatMinimapCoords(x: number, z: number): string {
  const fx = Number.isFinite(x) ? Math.floor(x) : 0;
  const fz = Number.isFinite(z) ? Math.floor(z) : 0;
  const opts: Intl.NumberFormatOptions = { maximumFractionDigits: 0, useGrouping: false };
  return `${formatNumber(fx, opts)}, ${formatNumber(fz, opts)}`;
}
