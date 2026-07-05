// Plain English money formatter for sim-emitted player text (loot, quest, vendor,
// and World Market lines). Yields fragments like "3g 5s 7c"; the client reverses
// them (parseSimMoney) and re-renders locale-aware via the i18n formatMoney at the
// HUD boundary. This is deliberately NOT the i18n formatMoney (src/ui/i18n.ts):
// the sim core stays language-agnostic.
//
// It lives in its own leaf module so sim.ts, market.ts, and loot/loot_roll.ts can
// all import it without a value-cycle through the sim.ts monolith (sim.ts imports
// market.ts/loot_roll.ts, and they used to import formatMoney back from sim.ts).
export function formatMoney(copper: number): string {
  const g = Math.floor(copper / 10000);
  const s = Math.floor((copper % 10000) / 100);
  const c = copper % 100;
  const parts: string[] = [];
  if (g > 0) parts.push(`${g}g`);
  if (s > 0) parts.push(`${s}s`);
  if (c > 0 || parts.length === 0) parts.push(`${c}c`);
  return parts.join(' ');
}
