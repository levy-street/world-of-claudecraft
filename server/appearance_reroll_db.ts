// The appearance-redesign grant SPEND: the one column that records which grant
// a character has used, and the single UPDATE that spends the current one.
// Extracted from server/db.ts (a monolith under the ratchet) when the one-shot
// boolean grew into numbered grants (server/appearance_reroll_grants.ts owns
// the rule and the grant table; this module owns only the SQL). Takes the pool
// as a parameter (the realm_builder_db shape): db.ts applies the schema below,
// so importing the pool from it here would close a db -> schema -> db cycle.

import type { Pool } from 'pg';
import type { AppearanceRerollGrant } from './appearance_reroll_grants';
import { REALM } from './realm';

/** Applied by ensureSchema after SCHEMA (the column rides `characters`).
 *  Nullable with no default so the ADD is a catalog-only change on Postgres 11+
 *  (no table rewrite, no backfill): a NULL reads as "nothing recorded here",
 *  and the legacy appearance_reroll_used boolean then decides (TRUE = grant 1
 *  spent), through the COALESCE in consumeAppearanceReroll below. */
export const APPEARANCE_REROLL_SCHEMA = `
-- Highest appearance-redesign grant this character has spent (see
-- server/appearance_reroll_grants.ts). Written by the reroll endpoint in the
-- same statement as the new look, alongside the legacy boolean it supersedes,
-- so a rolled-back build that reads only the boolean still sees the token as
-- spent.
ALTER TABLE characters ADD COLUMN IF NOT EXISTS appearance_reroll_grant INTEGER;
`;

/** The SQL expression for the highest grant a row has spent: the recorded
 *  column, else the legacy boolean read as grant 1, else 0. Exported so the
 *  list read in db.ts and the WHERE arm here cannot drift apart. */
export const SPENT_APPEARANCE_REROLL_GRANT_SQL =
  'COALESCE(appearance_reroll_grant, CASE WHEN appearance_reroll_used THEN 1 ELSE 0 END)';

/** Spend a character's appearance redesign grant: write the new look and record
 *  the spent grant in ONE statement, so two concurrent rerolls cannot both succeed.
 *  All eligibility lives in the WHERE arm: ownership + realm (BOLA, matching
 *  getCharacter's scoping), inside the grant's free window or never designed, and
 *  the grant not yet spent, and the row is only touched when every check passes.
 *  Returns whether the reroll was applied; false = not owned / outside the window
 *  with a look already / already spent, which the route maps to its error body.
 *  The appearance is already normalized by the caller (untrusted client input,
 *  hotbar_layout's contract).
 *
 *  Two ways into the WHERE arm, and the spent-grant ratchet is what keeps each
 *  grant one-shot either way. `created_at < $6` is the PRODUCT rule: every
 *  character that existed before the grant's window gets one redesign on the
 *  house, whether or not it already carries an authored look. `appearance IS
 *  NULL` is the safety net under it, and it is why the date alone is not
 *  enough: a cutoff strands every character created after it by a client too
 *  old to post an appearance, which would then have neither a look nor any way
 *  to choose one. The OR can only ever widen eligibility, so the window stays
 *  exactly what it says. The spent check reads the legacy boolean as grant 1
 *  (SPENT_APPEARANCE_REROLL_GRANT_SQL), so a character that used its launch
 *  token before the column existed is correctly eligible for grant 2 and
 *  correctly refused a second grant 1. The boolean is still set TRUE on every
 *  spend: a rolled-back build reads only that flag.
 *
 *  The helm preference rides the SAME statement, because the redesign editor's
 *  helmet toggle is the creation toggle: a standing wardrobe choice, not a
 *  turntable view. It is sim state, so it patches the one key inside the state
 *  blob rather than rewriting it (a whole-blob write from an HTTP route would
 *  clobber a live session's progress), and follows the sim's zero-default
 *  omission convention: hidden writes the key, shown removes it, and BOTH
 *  arms are guarded on an actual change, because jsonb_set and `-` each mint a
 *  whole new datum: an unguarded write detoasts, re-serializes and re-TOASTs
 *  the entire state blob even when the value is identical, leaving dead chunks
 *  behind for autovacuum. A NULL helmHidden means the client did not offer the
 *  toggle at all and the blob is left untouched: defaulting that to false would
 *  actively UN-hide a helm the player had hidden in world. A character that has
 *  never been saved (state IS NULL) is likewise left alone; its blob is written
 *  fresh on first entry. A LIVE session still holds the old value in memory and
 *  would autosave over this, which is what the route's setHelmHiddenForCharacter
 *  push exists to prevent.
 *
 *  Unlike characterUpdateStatement, this write carries no character_leases fence.
 *  That is deliberate, not an oversight: the UPDATE only ever patches the single
 *  helmHidden key inside the state blob (never the whole thing), so a takeover
 *  racing this cannot tear it the way a full state write could, and the
 *  applyAppearanceForCharacter/setHelmHiddenForCharacter push onto the live
 *  session right after is what reconciles an online character with the row it
 *  just wrote. */
export async function consumeAppearanceReroll(
  pool: Pool,
  accountId: number,
  characterId: number,
  appearance: Record<string, unknown>,
  helmHidden: boolean | null,
  grant: AppearanceRerollGrant,
): Promise<boolean> {
  const res = await pool.query(
    `UPDATE characters
        SET appearance = $3::jsonb,
            appearance_reroll_used = TRUE,
            appearance_reroll_grant = $7::integer,
            state = CASE
                      WHEN state IS NULL OR $5::boolean IS NULL THEN state
                      WHEN $5::boolean AND state->'helmHidden' IS DISTINCT FROM 'true'::jsonb
                        THEN jsonb_set(state, '{helmHidden}', 'true'::jsonb, true)
                      WHEN NOT $5::boolean AND state ? 'helmHidden'
                        THEN state - 'helmHidden'
                      ELSE state
                    END,
            updated_at = now()
      WHERE id = $1 AND account_id = $2 AND realm = $4
        AND (created_at < $6 OR appearance IS NULL)
        AND ${SPENT_APPEARANCE_REROLL_GRANT_SQL} < $7::integer`,
    [
      characterId,
      accountId,
      JSON.stringify(appearance),
      REALM,
      helmHidden,
      grant.createdBefore,
      grant.id,
    ],
  );
  return (res.rowCount ?? 0) > 0;
}
