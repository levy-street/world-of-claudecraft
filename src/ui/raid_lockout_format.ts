// Localized countdown text for the raid lockout indicator: the one place the
// HUD's lockout countdown calls t(). The pure split (whole day/hour/minute
// parts and the display shape) stays in raid_lockout.ts, which deliberately
// carries no i18n runtime import; this thin sibling splices those parts into
// the hudChrome.raidLockout templates so hud.ts is a consumer of both (the
// minimap panel and the entry-denied toast read the same string). Unit tested
// in tests/raid_lockout_format.test.ts.

import { formatNumber, t } from './i18n';
import { lockoutParts, lockoutShape } from './raid_lockout';

/** Localized "Xd Yh" / "Xh Ym" / "Xm" / "<1m" for a remaining-ms span; the
 *  digits run through formatNumber (ungrouped, so a long lockout never picks
 *  up a thousands separator) and the units reorder via the t() template. */
export function formatLockoutDuration(ms: number): string {
  const { days, hours, minutes } = lockoutParts(ms);
  const n = (v: number) => formatNumber(v, { maximumFractionDigits: 0, useGrouping: false });
  switch (lockoutShape(ms)) {
    case 'daysHours':
      return t('hudChrome.raidLockout.daysHours', {
        d: n(days),
        h: n(hours),
      });
    case 'hoursMinutes':
      return t('hudChrome.raidLockout.hoursMinutes', {
        h: n(hours),
        m: n(minutes),
      });
    case 'minutes':
      return t('hudChrome.raidLockout.minutes', { m: n(minutes) });
    default:
      return t('hudChrome.raidLockout.lessThanMinute');
  }
}
