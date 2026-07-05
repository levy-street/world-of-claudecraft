// Pure, host-agnostic helpers for the raid lockout indicator (the minimap badge
// + its panel). No DOM and no i18n runtime import: the countdown is split into
// whole day/hour/minute parts here and the thin HUD consumer (hud.ts) splices
// them into a localized t() template. Unit tested in tests/raid_lockout.test.ts.

import type { RaidLockout } from '../world_api';

export type { RaidLockout };

export interface LockoutParts {
  days: number;
  hours: number;
  minutes: number;
}

/** Which granularity to render: pick the two coarsest non-zero units so a long
 *  lockout reads "2d 3h", a same-day one "5h 12m", under an hour "12m", and a
 *  sub-minute tail "<1m" (never a bare "0m" while still locked). */
export type LockoutShape = 'daysHours' | 'hoursMinutes' | 'minutes' | 'lessThanMinute';

/** Split a remaining-ms span into whole days/hours/minutes, rounding the minute
 *  UP so an active countdown never shows 0m while the raid is still locked. */
export function lockoutParts(ms: number): LockoutParts {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60000));
  return {
    days: Math.floor(totalMinutes / 1440),
    hours: Math.floor((totalMinutes % 1440) / 60),
    minutes: totalMinutes % 60,
  };
}

/** Choose the display shape for a remaining-ms span (see LockoutShape). A
 *  positive span under a minute is `lessThanMinute`; <= 0 is also that (callers
 *  should not render a finished lockout, but it degrades safely). */
export function lockoutShape(ms: number): LockoutShape {
  const { days, hours } = lockoutParts(ms);
  if (days > 0) return 'daysHours';
  if (hours > 0) return 'hoursMinutes';
  if (ms >= 60000) return 'minutes';
  return 'lessThanMinute';
}

/** The single coarsest part for the always-visible badge glyph text (e.g. a
 *  span of 5h12m shows "5h", 47m shows "47m", 2d3h shows "2d"). Returns the
 *  number + a unit tag the consumer maps to a localized suffix. */
export function lockoutBadgeUnit(ms: number): { value: number; unit: 'd' | 'h' | 'm' } {
  const { days, hours, minutes } = lockoutParts(ms);
  if (days > 0) return { value: days, unit: 'd' };
  if (hours > 0) return { value: hours, unit: 'h' };
  return { value: Math.max(1, minutes), unit: 'm' };
}

/** The soonest-unlocking raid in a set (smallest msRemaining), or null when the
 *  set is empty. Drives the badge: when any raid is locked the badge shows this
 *  one's countdown. Ties resolve by id for determinism. */
export function soonestLockout(lockouts: readonly RaidLockout[]): RaidLockout | null {
  let best: RaidLockout | null = null;
  for (const l of lockouts) {
    if (l.msRemaining <= 0) continue;
    if (
      !best ||
      l.msRemaining < best.msRemaining ||
      (l.msRemaining === best.msRemaining && l.id < best.id)
    ) {
      best = l;
    }
  }
  return best;
}
