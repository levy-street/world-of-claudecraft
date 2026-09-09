// Host-agnostic helpers for the Realm Builder of the Month page (the
// moderation_actions.ts shape: request shaping and validation live here as
// plain TS so they are unit-tested directly, without mounting a component).
//
// The server validates all of this again in realm_builder_db.ts, which is the
// authority. What these add is telling an operator WHY the save button is off
// before they press it.

import { fmtMonthYear } from './format';

/** Kept in step with server/realm_builder_db.ts by tests/admin_realm_builders.test.ts. */
export const REALM_BUILDER_MAX_NAME_LENGTH = 64;
export const REALM_BUILDER_MAX_NOTE_LENGTH = 280;
export const REALM_BUILDER_MIN_YEAR = 2000;
export const REALM_BUILDER_MAX_YEAR = 4000;

export interface RealmBuilderEntryDraft {
  year: number;
  month: number;
  name: string;
  note: string;
}

export interface RealmBuilderMonth {
  year: number;
  month: number;
}

/**
 * The i18n key naming what is wrong with a draft, or null when it would save.
 * A KEY rather than a sentence: operators are users, so this renders through
 * t() like everything else on the page.
 */
export function validateRealmBuilderEntry(draft: RealmBuilderEntryDraft): string | null {
  if (
    !Number.isInteger(draft.year) ||
    draft.year < REALM_BUILDER_MIN_YEAR ||
    draft.year > REALM_BUILDER_MAX_YEAR
  ) {
    return 'realmBuilders.errorYear';
  }
  if (!Number.isInteger(draft.month) || draft.month < 1 || draft.month > 12) {
    return 'realmBuilders.errorMonth';
  }
  const name = draft.name.trim();
  if (name.length === 0) return 'realmBuilders.errorNameEmpty';
  if (name.length > REALM_BUILDER_MAX_NAME_LENGTH) return 'realmBuilders.errorNameLong';
  if (draft.note.trim().length > REALM_BUILDER_MAX_NOTE_LENGTH)
    return 'realmBuilders.errorNoteLong';
  return null;
}

/**
 * "August 2026" in the operator's own language.
 *
 * Through format.ts rather than an Intl constructed here: locale-aware
 * formatting is centralized in that one module, and a guard
 * (tests/i18n_extra_tables.test.ts) holds the line.
 */
export function describeRealmBuilderMonth(year: number, month: number): string {
  return fmtMonthYear(year, month);
}

/**
 * The month AFTER the newest entry on the roll, which is nearly always the one
 * an operator is about to name. With an empty roll that is the current month,
 * because the first award is being made now rather than backfilled.
 */
export function nextRealmBuilderMonth(
  newest: RealmBuilderMonth | null,
  now: Date = new Date(),
): RealmBuilderMonth {
  if (!newest) return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  return newest.month === 12
    ? { year: newest.year + 1, month: 1 }
    : { year: newest.year, month: newest.month + 1 };
}
