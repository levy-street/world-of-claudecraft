// The one clock-seconds formatter for the HUD's m:ss and "3m 09s" readouts.
// Three sites hand-built the two-digit pad with String(n).padStart(2, '0')
// (the harvest journal's countdown, the gather-node respawn clock, the dungeon
// finder clock) beside a formatNumber-routed minutes token, so a locale with
// its own digits would have padded in ASCII while the minutes beside it did
// not. The pad is an Intl option here (minimumIntegerDigits, the battleground
// scoreboard's num2 precedent), so every digit of a clock comes from the same
// formatter. English is byte-identical to the padStart form ("09", "5").
//
// DOM-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { formatNumber } from './i18n';

/** `seconds` as a whole number: zero-padded to two digits when `pad` is true
 *  (the arm a minutes value precedes, so 3m 9s and 3m 10s hold one width) and
 *  bare otherwise (the final-minute arm, where "07s" would read as a
 *  truncated clock). Never grouped: a seconds token is under 60. */
export function clockSeconds(seconds: number, pad: boolean): string {
  return formatNumber(seconds, {
    maximumFractionDigits: 0,
    useGrouping: false,
    ...(pad ? { minimumIntegerDigits: 2 } : {}),
  });
}
