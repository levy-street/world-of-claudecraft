// The free appearance-redesign GRANTS: the product rule behind the roster's
// one-shot Redesign button, as data. Each grant hands every character that
// existed before its `createdBefore` instant one free redesign, and a
// character can spend each grant at most once. Adding a grant (appending a
// row with the next id and a fresh window) is how the whole population gets
// another reset on the house; nothing else has to change.
//
// Pure: no DB, no clock, no Postgres. The SQL authority that spends a grant
// lives in server/appearance_reroll_db.ts (consumeAppearanceReroll), whose
// WHERE arm mirrors appearanceRerollAvailable below exactly; the JS mirror is
// what the character-list payload reads so the roster button renders exactly
// when the UPDATE would accept.

export interface AppearanceRerollGrant {
  /** Monotonic generation number. A character records the highest grant it
   *  has spent; it is eligible while that number is below the current one. */
  readonly id: number;
  /** The free window: every character created before this UTC instant is
   *  inside it, whether or not it already carries an authored look. Set AHEAD
   *  of the ship date, deliberately: a window that has already shut when the
   *  change merges gives nothing to the characters created in between. */
  readonly createdBefore: Date;
  /** Why the grant exists (a maintainer note, never player-facing). */
  readonly reason: string;
}

/** Every grant ever issued, oldest first. Ids are dense and ascending; the
 *  last row is the live one. Grants do not accumulate: a character records
 *  the HIGHEST grant it spent, so one that never used its launch redesign and
 *  now spends grant 2 has spent both. A grant is "everyone may reset their
 *  look once from here", not a second token in the bank; that keeps the
 *  roster button one-shot per grant and the SQL a single comparison. Never renumber or delete a row: spent ids are
 *  persisted per character (characters.appearance_reroll_grant), and the
 *  legacy boolean appearance_reroll_used reads as "spent grant 1". */
export const APPEARANCE_REROLL_GRANTS: readonly AppearanceRerollGrant[] = [
  {
    id: 1,
    createdBefore: new Date('2026-08-24T00:00:00Z'),
    reason:
      'Modular character creator launch: every character authored before it ' +
      'gets one redesign, whether or not it already carries a look.',
  },
  {
    id: 2,
    createdBefore: new Date('2026-09-28T00:00:00Z'),
    reason:
      'Outfit colorway dye was a silent no-op on the low graphics tier ' +
      '(a1dc96f205), so looks were saved without a true preview of the ' +
      'dyed clothing. Everyone gets a free reset now that the preview is fixed.',
  },
];

/** The grant the roster and the reroll route spend today. */
export const CURRENT_APPEARANCE_REROLL_GRANT: AppearanceRerollGrant =
  APPEARANCE_REROLL_GRANTS[APPEARANCE_REROLL_GRANTS.length - 1];

/** The persisted grant-spend fields of a characters row. */
export interface AppearanceRerollSpendRow {
  /** Highest grant id spent (NULL = none recorded in the column). */
  appearance_reroll_grant?: number | null;
  /** The legacy one-shot flag: TRUE means grant 1 was spent before the
   *  column existed, and it stays TRUE on every later spend for rollback
   *  safety (an older build reads only this flag). */
  appearance_reroll_used?: boolean;
  appearance?: Record<string, unknown> | null;
  created_at?: Date | string | null;
}

/** The highest grant this row has spent: the integer column when recorded,
 *  else the legacy boolean read as grant 1, else nothing (0). Mirrors the
 *  COALESCE in consumeAppearanceReroll's WHERE arm. */
export function spentAppearanceRerollGrant(row: AppearanceRerollSpendRow): number {
  if (typeof row.appearance_reroll_grant === 'number') return row.appearance_reroll_grant;
  return row.appearance_reroll_used ? 1 : 0;
}

/** Whether this character can spend `grant`. Two ways in, and the spent-grant
 *  ratchet is what makes each grant one-shot either way:
 *   - CREATED INSIDE THE GRANT'S WINDOW (before grant.createdBefore). Every
 *     character that existed when the grant was issued gets one redesign on the
 *     house, including one that already carries an authored look.
 *   - NEVER DESIGNED AT ALL, whenever it was made. Not the product rule but
 *     the safety net under it: a character created after the window by a
 *     client too old to post an appearance would otherwise have neither a
 *     look nor a way to choose one, permanently. It can only ADD eligibility.
 *  Mirrors consumeAppearanceReroll's WHERE arm, which is the authority. */
export function appearanceRerollAvailable(
  row: AppearanceRerollSpendRow,
  grant: AppearanceRerollGrant = CURRENT_APPEARANCE_REROLL_GRANT,
): boolean {
  if (spentAppearanceRerollGrant(row) >= grant.id) return false;
  if (row.appearance === null || row.appearance === undefined) return true;
  const created = row.created_at ? new Date(row.created_at).getTime() : Number.NaN;
  return Number.isFinite(created) && created < grant.createdBefore.getTime();
}
