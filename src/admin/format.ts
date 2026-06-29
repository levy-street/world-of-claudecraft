// Small display formatters shared across the admin dashboard.
import { adminLanguageTag, t } from './i18n';

// Locale-aware unit abbreviations (mirrors the fmtCopper t()-keyed-unit pattern):
// each carries the {n} value so a translator can reorder the number/unit per locale.
const durSeconds = (n: number) => t('duration.secondsShort', { n });
const durMinutes = (n: number) => t('duration.minutesShort', { n });
const durHours = (n: number) => t('duration.hoursShort', { n });
const durDays = (n: number) => t('duration.daysShort', { n });

export function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return durSeconds(s);
  const m = Math.floor(s / 60);
  if (m < 60) return `${durMinutes(m)} ${durSeconds(s % 60)}`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${durHours(h)} ${durMinutes(m % 60)}`;
  return `${durDays(Math.floor(h / 24))} ${durHours(h % 24)}`;
}

export function fmtDate(iso: string | null): string {
  if (!iso) return t('common.emptyValue');
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return t('common.emptyValue');
  return new Intl.DateTimeFormat(adminLanguageTag(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function fmtChartBucket(iso: string, bucket: 'hour' | 'day'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(
    adminLanguageTag(),
    bucket === 'hour' ? { hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric' },
  ).format(d);
}

export function fmtRelative(iso: string | null): string {
  if (!iso) return t('common.never');
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return t('common.never');
  if (ms < 0) return t('common.justNow');
  const sec = Math.floor(ms / 1000);
  let value: string;
  if (sec < 60) value = durSeconds(sec);
  else {
    const min = Math.floor(sec / 60);
    if (min < 60) value = durMinutes(min);
    else {
      const hr = Math.floor(min / 60);
      value = hr < 24 ? durHours(hr) : durDays(Math.floor(hr / 24));
    }
  }
  return t('common.ago', { value });
}

// 12345 copper -> "1g 23s 45c"
export function fmtCopper(copper: number): string {
  const c = Math.max(0, Math.round(copper));
  const gold = Math.floor(c / 10_000);
  const silver = Math.floor((c % 10_000) / 100);
  const rest = c % 100;
  const g = t('money.gold'),
    s = t('money.silver'),
    cu = t('money.copper');
  if (gold > 0) return `${gold}${g} ${silver}${s} ${rest}${cu}`;
  if (silver > 0) return `${silver}${s} ${rest}${cu}`;
  return `${rest}${cu}`;
}

export function fmtBytes(bytes: number): string {
  // Digits route through Intl (mirrors fmtDate's locale-aware formatting) and the
  // unit/order comes from a t() key. useGrouping:false keeps the en output
  // byte-identical to the historical toFixed(2)/Math.round form.
  const num = (n: number, opts: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat(adminLanguageTag(), { useGrouping: false, ...opts }).format(n);
  if (bytes >= 1024 * 1024 * 1024)
    return t('bytes.gigabytes', {
      n: num(bytes / (1024 * 1024 * 1024), { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    });
  if (bytes >= 1024 * 1024)
    return t('bytes.megabytes', {
      n: num(Math.round(bytes / (1024 * 1024)), { maximumFractionDigits: 0 }),
    });
  return t('bytes.kilobytes', { n: num(Math.round(bytes / 1024), { maximumFractionDigits: 0 }) });
}

export function fmtNumber(value: number): string {
  return new Intl.NumberFormat(adminLanguageTag()).format(Math.round(value));
}

export function fmtPercent(value: number): string {
  return new Intl.NumberFormat(adminLanguageTag(), {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(value);
}
