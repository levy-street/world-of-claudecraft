// The one multi-unit duration phrase for the money surfaces: days, hours,
// minutes, or seconds through the Intl unit formatter (each locale's plural
// rules apply). Auction and settlement windows span days and a buy-now
// cooldown spans half an hour, and a raw formatDuration renders those as
// tens of thousands of seconds ("Try again in 1,800 seconds"). Truncating
// on purpose: these are courtesy figures beside a server-enforced deadline,
// and "1 hour" for 5,400 seconds is the established Exchange reading.
//
// DOM-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { formatDuration, formatNumber } from './i18n';

const unit = (value: number, unitName: 'day' | 'hour' | 'minute'): string =>
  formatNumber(value, { style: 'unit', unit: unitName, unitDisplay: 'long' });

/** Seconds as the largest whole unit that fits: 2+ days, hours, minutes,
 *  else Intl seconds. Negative or fractional input rounds up to a whole
 *  second first (a countdown never shows a negative figure). */
export function durationText(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  if (s >= 172_800) return unit(Math.floor(s / 86_400), 'day');
  if (s >= 3_600) return unit(Math.floor(s / 3_600), 'hour');
  if (s >= 60) return unit(Math.floor(s / 60), 'minute');
  return formatDuration(s);
}
