// Pure, DOM-free formatters for the player / target / target-of-target unit
// frames' health and resource text (mirrors coords.ts / clock.ts: kept out of
// hud.ts so it can be unit-tested in isolation instead of growing the
// coordinator). The health text follows a configurable display mode shared
// with the party frames (partyFrameHealthText in party_frames.ts delegates to
// healthTextForMode below): none, percent, current, current / max, or
// current / max with the percent in parentheses. The digits route through
// formatNumber with useGrouping:false so they follow the active locale's
// numerals while staying byte-identical to the historical hand-built
// "523 / 600" for English (see src/ui/CLAUDE.md "Formatters, not hand-built
// numbers").

import { formatNumber } from './i18n';

const CURRENT_MAX_OPTS: Intl.NumberFormatOptions = { maximumFractionDigits: 0, useGrouping: false };
const PERCENT_OPTS: Intl.NumberFormatOptions = { style: 'percent', maximumFractionDigits: 0 };

/** Health text display mode, shared by the player, target, target-of-target and
 *  party frames (the settings keys playerFrameHealthText, targetFrameHealthText
 *  and partyFrameHealthText): 0 none, 1 percent, 2 current, 3 current / max,
 *  4 current / max (percent). */
export type HealthTextMode = 0 | 1 | 2 | 3 | 4;

export const HEALTH_TEXT_MODE_NONE = 0;
export const HEALTH_TEXT_MODE_MAX = 4;

/** Clamp a raw numeric setting value to a HealthTextMode. */
export function healthTextMode(
  value: number | undefined,
  fallback: HealthTextMode,
): HealthTextMode {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  if (rounded < HEALTH_TEXT_MODE_NONE) return HEALTH_TEXT_MODE_NONE;
  if (rounded > HEALTH_TEXT_MODE_MAX) return HEALTH_TEXT_MODE_MAX;
  return rounded as HealthTextMode;
}

/** The mode-to-text rule, with formatting injected so the party painter and the
 *  unit frames share one decision table. `format(value, percent)` renders a whole
 *  number, or a 0..1 fraction as a percent when `percent` is true. */
export function healthTextForMode(
  hp: number,
  maxHp: number,
  mode: HealthTextMode,
  format: (value: number, percent?: boolean) => string,
): string {
  const current = Math.max(0, Math.round(hp));
  const maximum = Math.max(1, Math.round(maxHp));
  if (mode === 1) return format(current / maximum, true);
  if (mode === 2) return format(current);
  if (mode === 3) return `${format(current)} / ${format(maximum)}`;
  if (mode === 4)
    return `${format(current)} / ${format(maximum)} (${format(current / maximum, true)})`;
  return '';
}

const unitFrameFormat = (value: number, percent?: boolean): string =>
  formatNumber(value, percent ? PERCENT_OPTS : CURRENT_MAX_OPTS);

/** Localized health text for the player / target / target-of-target frames in
 *  the given display mode. Mode 3 is byte-identical to unitFrameCurrentMaxText. */
export function unitFrameHealthText(hp: number, maxHp: number, mode: HealthTextMode): string {
  return healthTextForMode(hp, maxHp, mode, unitFrameFormat);
}

/** Localized "current / max" text for a unit frame's HP or resource bar.
 *  Both values are expected already rounded to whole units at the call site
 *  (matching the historical `Math.round(p.resource)` on the resource bar,
 *  while hp values are already whole numbers). */
export function unitFrameCurrentMaxText(current: number, max: number): string {
  return `${formatNumber(current, CURRENT_MAX_OPTS)} / ${formatNumber(max, CURRENT_MAX_OPTS)}`;
}
