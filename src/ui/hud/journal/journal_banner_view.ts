// Pure view model for the Adventure Journal's page furniture: the phase
// header's health pill, the fact chips an opened ability prints (its damage and
// its timer), and the status line under each boss in the list (Defeated, Next
// up, Final boss). DOM-free and world-free: the markup module
// (journal_page_html.ts) translates what this returns.
//
// The fact chips read each mechanic's ENGLISH summary template, never the
// player's locale, so a chip appears in every language exactly when the English
// source says "{min} to {max} Fire damage" or "Every {every} sec" with those
// values resolved for the tier. A swing count ("every {every} swings") or a
// damage-per-second line never becomes a timer or a hit chip.

import type {
  JournalHealthRange,
  JournalRank,
  JournalValues,
} from '../../boss_journal/journal_view';
import { en } from '../../i18n.resolved.generated/en';

/** A phase pill's shape, before translation. Fractions of 1. */
export type JournalRangeLabel =
  | { kind: 'whole' }
  | { kind: 'band'; from: number; to: number }
  | { kind: 'toEnd'; from: number }
  | { kind: 'at'; at: readonly number[] };

export function journalRangeLabel(range: JournalHealthRange | undefined): JournalRangeLabel | null {
  if (range === undefined) return null;
  if (range === 'whole') return { kind: 'whole' };
  if ('at' in range) return range.at.length > 0 ? { kind: 'at', at: range.at } : null;
  if (range.to <= 0) return { kind: 'toEnd', from: range.from };
  return { kind: 'band', from: range.from, to: range.to };
}

export type JournalDamageSchool = 'arcane' | 'fire' | 'frost' | 'nature' | 'physical' | 'shadow';

export interface JournalMechanicFacts {
  damage: { min: number; max: number; school: JournalDamageSchool | null } | null;
  /** Seconds between casts. */
  every: number | null;
}

const DAMAGE_RE =
  /\{min\} to \{max\}(?: (Arcane|Fire|Frost|Nature|Physical|Shadow))? damage(?! a second)/;
const EVERY_RE = /\{every\} sec\b/;

/** The facts an ability's English summary states with values the tier resolved. */
export function journalMechanicFacts(
  englishSummary: string | null,
  values: JournalValues | undefined,
): JournalMechanicFacts {
  if (!englishSummary || !values) return { damage: null, every: null };
  const hit = englishSummary.match(DAMAGE_RE);
  const damage =
    hit && values.min !== undefined && values.max !== undefined
      ? {
          min: values.min,
          max: values.max,
          school: hit[1] ? (hit[1].toLowerCase() as JournalDamageSchool) : null,
        }
      : null;
  const every =
    EVERY_RE.test(englishSummary) && values.every !== undefined && values.every > 0
      ? values.every
      : null;
  return { damage, every };
}

/** A catalog key's English template (the source the facts are read from). */
export function englishTemplate(key: string): string | null {
  let current: unknown = en;
  for (const part of key.split('.')) {
    if (!current || typeof current !== 'object' || !(part in current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : null;
}

/** The line under a boss in the list. */
export type JournalNavStatus = 'engaged' | 'defeated' | 'next' | 'final' | 'miniboss' | null;

export function journalNavStatus(boss: {
  engaged: boolean;
  defeated: boolean;
  next: boolean;
  rank: JournalRank;
}): JournalNavStatus {
  if (boss.engaged) return 'engaged';
  if (boss.defeated) return 'defeated';
  if (boss.next) return 'next';
  if (boss.rank === 'final') return 'final';
  if (boss.rank === 'miniboss') return 'miniboss';
  return null;
}
