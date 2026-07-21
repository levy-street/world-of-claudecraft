// Pure formatting for the minimap clock (no DOM) so it can be snapshot-tested
// like xp_bar.ts. The HUD owns the DOM element and the per-frame update; this
// module just turns a Date + a format flag into the displayed string.

import { formatDateTime, type SupportedLanguage } from './i18n';

// Format the hours/minutes of `date` as a classic minimap clock readout.
// `use24` → "08:05" / "17:42"; otherwise 12-hour "8:05 AM" / "5:42 PM".
// Routes through formatDateTime so the hour cycle, AM/PM wording, and digits
// follow the active locale (the optional `lang` lets callers/tests pin one).
// 24-hour: zero-padded hours+minutes; 12-hour: numeric (1–12) hour with a
// zero-padded minute and the locale's day-period marker.
export function formatClockTime(date: Date, use24: boolean, lang?: SupportedLanguage): string {
  const options: Intl.DateTimeFormatOptions = use24
    ? { hour: '2-digit', minute: '2-digit', hour12: false }
    : { hour: 'numeric', minute: '2-digit', hour12: true };
  return formatDateTime(date, options, lang);
}
