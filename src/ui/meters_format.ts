// The meters' number and duration formatting, shared by the Damage Meters
// window (meters.ts) and the practice DPS tracker (hud/practice/) so the two
// surfaces can never print the same damage differently. Moved out of meters.ts
// verbatim when the tracker became the second consumer of every function here.
// Host-agnostic: digits route through formatNumber, units through t() keys.

import { formatNumber, t } from './i18n';

// Compact damage/heal/threat number. Digits route through formatNumber so the
// numerals/decimal mark follow the active locale, while the classic English
// k/m suffixes + thresholds are preserved (useGrouping:false keeps the readout
// byte-identical to the historical `toFixed(1)`/`Math.round` form in en); the
// suffix itself is a localizable key rather than a literal.
export function fmtNum(v: number): string {
  const one = { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false };
  if (v >= 1_000_000)
    return t('hudChrome.meters.millions', { value: formatNumber(v / 1_000_000, one) });
  if (v >= 10_000) return t('hudChrome.meters.thousands', { value: formatNumber(v / 1000, one) });
  return formatNumber(Math.round(v), { maximumFractionDigits: 0, useGrouping: false });
}

// "{rate}/s" cell, e.g. "1.2k/s": the /s unit comes from the localizable key.
export function fmtPerSecond(v: number): string {
  return t('hudChrome.meters.perSecond', { value: fmtNum(v) });
}

// "{total} ({rate}/s)" cell, e.g. "12.3k (1.2k/s)". Defined at module scope so
// the imported t() is in view (the render loop shadows `t` with a tally row).
export function fmtPerSecondRow(total: number, rate: number): string {
  return t('hudChrome.meters.perSecondRow', { total: fmtNum(total), rate: fmtPerSecond(rate) });
}

// "Xm Ys" / "Ys" duration; the m/s units come from localizable keys, digits via
// formatNumber.
export function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  const num = (n: number) => formatNumber(n, { maximumFractionDigits: 0, useGrouping: false });
  return m > 0
    ? t('hudChrome.meters.minutesSeconds', { m: num(m), s: num(Math.round(s % 60)) })
    : t('hudChrome.meters.seconds', { s: num(Math.round(s)) });
}
