// Pure model for the memorial plaque (the Roll of Honour you get for reading
// Warden Hale's memorial). DOM-free, i18n-free: it emits translation KEYS plus
// the already-composed proper nouns, and the window localizes and paints.
//
// Names are proper nouns and are never translated; only the chrome around them
// is. Composition ("J T" + "Hale" -> "J T Hale") lives here so the window holds
// no formatting logic and a Vitest can pin the reading order directly.
//
// The TranslationKey import is TYPE-ONLY, so this core stays i18n-free at
// runtime while the keys it names stay checked against the catalog.

import type { TranslationKey } from '../../i18n';

export interface MemorialRollName {
  initials: string;
  surname: string;
}

export interface MemorialDefLike {
  id: string;
  roll: readonly MemorialRollName[];
}

export interface MemorialPlaqueModel {
  memorialId: string;
  titleKey: TranslationKey;
  dedicationKey: TranslationKey;
  rollHeadingKey: TranslationKey;
  /** Shown under the last name: the memorial deliberately has room for more. */
  roomRemainingKey: TranslationKey;
  closeKey: TranslationKey;
  /**
   * Balanced columns, read top-to-bottom then left-to-right, so the oldest name
   * is first and the newest is last however many columns the plaque is cut into.
   */
  columns: readonly (readonly string[])[];
  /** Every name in reading order, for callers that want one flat list. */
  names: readonly string[];
  total: number;
}

export const MEMORIAL_PLAQUE_DEFAULT_COLUMNS = 2;

/** "J T" + "Hale" -> "J T Hale". Initials may be a single letter or absent. */
export function composeRollName(entry: MemorialRollName): string {
  const initials = entry.initials.trim();
  const surname = entry.surname.trim();
  return initials ? `${initials} ${surname}` : surname;
}

/**
 * Deal `names` into `columnCount` balanced columns that still read oldest-first
 * down each column in turn. Earlier columns take the extra name when the split
 * is uneven, which is how a cut roll reads on a real memorial.
 */
export function splitIntoColumns(
  names: readonly string[],
  columnCount: number,
): readonly (readonly string[])[] {
  const columns = Math.max(1, Math.floor(columnCount));
  if (names.length === 0) return [];
  const base = Math.floor(names.length / columns);
  const remainder = names.length % columns;
  const out: string[][] = [];
  let cursor = 0;
  for (let i = 0; i < columns; i++) {
    const take = base + (i < remainder ? 1 : 0);
    if (take === 0) continue;
    out.push(names.slice(cursor, cursor + take));
    cursor += take;
  }
  return out;
}

export function buildMemorialPlaqueModel(
  def: MemorialDefLike,
  columnCount: number = MEMORIAL_PLAQUE_DEFAULT_COLUMNS,
): MemorialPlaqueModel {
  const names = def.roll.map(composeRollName);
  return {
    memorialId: def.id,
    titleKey: 'hudChrome.memorial.title',
    dedicationKey: 'hudChrome.memorial.dedication',
    rollHeadingKey: 'hudChrome.memorial.rollHeading',
    roomRemainingKey: 'hudChrome.memorial.roomRemaining',
    closeKey: 'hudChrome.memorial.close',
    columns: splitIntoColumns(names, columnCount),
    names,
    total: names.length,
  };
}
