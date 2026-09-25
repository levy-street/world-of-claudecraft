// Profession Schools display names: a small closed catalog (one school, six
// ranks, four task kinds today), localized the craft_name_view.ts way (an
// id-to-key table plus a resolver) rather than the lazy-chunk deed_i18n.ts /
// reliquary_i18n.ts machinery those two catalogs earn only by being much
// bigger. The English source for the raw ids lives in
// src/sim/content/profession_schools.ts (school `name`, rank `name`), which
// stays language-agnostic per root CLAUDE.md; this module is the client-side
// re-localization the i18n rule requires in the SAME change.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import type { SchoolTaskKind } from '../../../sim/content/profession_schools';
import { type TranslationKey, t } from '../../i18n';

/** School id -> its display-name key. src/sim/content/profession_schools.ts
 *  PROFESSION_SCHOOLS is the id source; an id absent here renders its raw id
 *  rather than crashing (the stale-content doctrine other id resolvers in
 *  this family follow, e.g. gathering_profession_name.ts). */
export const SCHOOL_NAME_KEYS: Readonly<Record<string, TranslationKey>> = {
  enchanters_school: 'hudChrome.school.name.enchantersSchool',
};

/** Localized display name for one school id, or the raw id when unrecognized. */
export function schoolNameText(schoolId: string): string {
  const key = SCHOOL_NAME_KEYS[schoolId];
  return key ? t(key) : schoolId;
}

/** `${schoolId}:${rankId}` -> its display-name key. Nested rather than a
 *  bare rank-id table because a rank id (e.g. 'initiate') is not unique
 *  across schools once a second school ships. */
export const SCHOOL_RANK_NAME_KEYS: Readonly<Record<string, TranslationKey>> = {
  'enchanters_school:initiate': 'hudChrome.school.rank.enchantersSchool.initiate',
  'enchanters_school:apprentice': 'hudChrome.school.rank.enchantersSchool.apprentice',
  'enchanters_school:journeyman': 'hudChrome.school.rank.enchantersSchool.journeyman',
  'enchanters_school:adept': 'hudChrome.school.rank.enchantersSchool.adept',
  'enchanters_school:master': 'hudChrome.school.rank.enchantersSchool.master',
  'enchanters_school:grandmaster': 'hudChrome.school.rank.enchantersSchool.grandmaster',
};

/** Localized display name for one school's rank id, or the raw rank id when
 *  unrecognized. */
export function schoolRankNameText(schoolId: string, rankId: string): string {
  const key = SCHOOL_RANK_NAME_KEYS[`${schoolId}:${rankId}`];
  return key ? t(key) : rankId;
}

/** Task kind -> its display-name key: the closed SchoolTaskKind union, shared
 *  across every school (unlike rank ids, task kinds are not school-scoped). */
export const SCHOOL_TASK_KIND_KEYS: Readonly<Record<SchoolTaskKind, TranslationKey>> = {
  daily: 'hudChrome.school.taskKind.daily',
  contract: 'hudChrome.school.taskKind.contract',
  materials: 'hudChrome.school.taskKind.materials',
  weekly_group: 'hudChrome.school.taskKind.weeklyGroup',
};

/** Localized display name for one task kind. */
export function schoolTaskKindText(kind: SchoolTaskKind): string {
  return t(SCHOOL_TASK_KIND_KEYS[kind]);
}
