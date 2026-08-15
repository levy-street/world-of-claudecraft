// Pure, DOM-free formatter for the player / target / target-of-target unit
// frames' "current / max" health and resource text (mirrors coords.ts /
// clock.ts: kept out of hud.ts so it can be unit-tested in isolation instead
// of growing the coordinator). Party frames have their own equivalent,
// partyFrameHealthText in party_frames.ts, because a party row's health text
// is additionally gated by a configurable display mode (off / percent /
// value / both) these three always-on frames do not carry. The digits route
// through formatNumber with useGrouping:false so they follow the active
// locale's numerals while staying byte-identical to the historical
// hand-built "523 / 600" for English (see src/ui/CLAUDE.md "Formatters, not
// hand-built numbers").

import { formatNumber } from './i18n';

const CURRENT_MAX_OPTS: Intl.NumberFormatOptions = { maximumFractionDigits: 0, useGrouping: false };

/** Localized "current / max" text for a unit frame's HP or resource bar.
 *  Both values are expected already rounded to whole units at the call site
 *  (matching the historical `Math.round(p.resource)` on the resource bar,
 *  while hp values are already whole numbers). */
export function unitFrameCurrentMaxText(current: number, max: number): string {
  return `${formatNumber(current, CURRENT_MAX_OPTS)} / ${formatNumber(max, CURRENT_MAX_OPTS)}`;
}
