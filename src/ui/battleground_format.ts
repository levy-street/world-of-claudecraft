// Shared localized formatting for the Gravemarch battleground painters (the
// indicator, the window, and the in-match HUD strip all show m:ss clocks and
// team names). i18n-USING by design, so it is deliberately NOT a *_view/*_core
// pure core: the cores stay i18n-free and carry raw seconds/team ids; the
// painters resolve them through these helpers.

import type { BgTeam } from '../sim/types';
import { formatNumber, t } from './i18n';

/** A match/queue clock as a localized "m:ss" readout (formatNumber digits). */
export function bgClockText(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return t('hudChrome.bg.time', {
    m: formatNumber(m, { maximumFractionDigits: 0, useGrouping: false }),
    s: formatNumber(s, { minimumIntegerDigits: 2, maximumFractionDigits: 0, useGrouping: false }),
  });
}

/** The localized company (team) name for a BgTeam id. */
export function bgTeamName(team: BgTeam): string {
  return team === 'A' ? t('hudChrome.bg.teamA') : t('hudChrome.bg.teamB');
}
