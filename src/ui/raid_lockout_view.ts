// Pure view for the raid-lockout indicator panel (the hover/tap tooltip on the
// minimap badge). DOM/i18n-runtime free: the HUD injects the localized title,
// the "all ready" line, a raid-name resolver, and a duration formatter, so this
// is unit-tested directly (mirrors stat_tooltip_view's injection pattern).
import { esc } from './esc';
import type { RaidLockout } from './raid_lockout';

export interface RaidLockoutI18n {
  title: string;
  allReady: string;
  raidName: (id: string) => string;
  duration: (msRemaining: number) => string;
}

/** Build the lockout panel HTML from the live lockouts: locked raids listed
 *  soonest-first (ties by id), or a single "all ready" line when none. */
export function raidLockoutPanelHtml(
  lockouts: readonly RaidLockout[],
  i18n: RaidLockoutI18n,
): string {
  const locked = [...lockouts]
    .filter((l) => l.msRemaining > 0)
    .sort((a, b) => a.msRemaining - b.msRemaining || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const body =
    locked.length === 0
      ? `<div class="rl-empty">${esc(i18n.allReady)}</div>`
      : locked
          .map(
            (l) =>
              `<div class="rl-row"><span class="rl-name">${esc(i18n.raidName(l.id))}</span>` +
              `<span class="rl-time">${esc(i18n.duration(l.msRemaining))}</span></div>`,
          )
          .join('');
  return `<div class="tt-title rl-panel-title">${esc(i18n.title)}</div>${body}`;
}
