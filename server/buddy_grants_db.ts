// Buddy grants queued for an OFFLINE character: the admin grant endpoint's
// offline arm (server/admin.ts grant-buddy) writes a row when the target is
// not in world, and the character's next join drains and applies it
// (server/buddy_wire.ts drainPendingBuddyGrants). SQL lives here only.
//
// Retention: rows are CONSUMED at the next join (DELETE ... RETURNING), so the
// table holds at most the grants awaiting characters that have not logged in
// since; a character deletion cascades its rows. It cannot grow per event or
// per session, so it registers no prune sweep by decision.

import { buddyDef } from '../src/sim/content/buddies';
import { pool } from './db';

export const BUDDY_GRANTS_SCHEMA = `
-- Buddy grants queued for an OFFLINE character (server/buddy_wire.ts): the
-- admin grant endpoint writes a row when the target is not in world, and the
-- character's next join drains and applies it. One row per grant, consumed
-- with DELETE ... RETURNING so a grant can never apply twice.
CREATE TABLE IF NOT EXISTS character_buddy_grants (
  id SERIAL PRIMARY KEY,
  character_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  buddy_key TEXT,
  cosmetic_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT character_buddy_grants_one_kind
    CHECK ((buddy_key IS NULL) <> (cosmetic_id IS NULL))
);
CREATE INDEX IF NOT EXISTS character_buddy_grants_character
  ON character_buddy_grants(character_id);
`;

/** One queued buddy grant (character_buddy_grants). */
export interface BuddyGrantRow {
  buddyKey?: string;
  cosmeticId?: string;
}

/** New offline grants go directly to durable account ownership. The legacy
 * queue remains readable for mixed-release joins, but no new rows accumulate. */
export async function queueBuddyGrant(characterId: number, grant: BuddyGrantRow): Promise<void> {
  if (!grant.buddyKey || !buddyDef(grant.buddyKey) || grant.cosmeticId !== undefined) return;
  await pool.query(
    `INSERT INTO account_buddies AS current (account_id, owned)
     SELECT account_id, ARRAY[$2::text] FROM characters WHERE id = $1
     ON CONFLICT (account_id) DO UPDATE SET owned = ARRAY(
       SELECT DISTINCT key FROM unnest(current.owned || EXCLUDED.owned) AS key ORDER BY key)`,
    [characterId, grant.buddyKey],
  );
}

/** Consume every queued grant for a character, oldest first. One statement,
 *  so a grant can never apply twice across two racing joins. */
export async function takePendingBuddyGrants(characterId: number): Promise<BuddyGrantRow[]> {
  const res = await pool.query(
    `WITH consumed AS (
       DELETE FROM character_buddy_grants WHERE character_id = $1
       RETURNING buddy_key, cosmetic_id, id
     ), transferred AS (
       INSERT INTO account_buddies AS current (account_id, owned)
       SELECT c.account_id, array_agg(DISTINCT g.buddy_key)
         FROM consumed g JOIN characters c ON c.id = $1
        WHERE g.buddy_key = ANY(ARRAY['horse','crystal_lich','forgemaw']::text[])
        GROUP BY c.account_id
       ON CONFLICT (account_id) DO UPDATE SET owned = ARRAY(
         SELECT DISTINCT key FROM unnest(current.owned || EXCLUDED.owned) AS key ORDER BY key)
       RETURNING account_id
     ) SELECT buddy_key, cosmetic_id, id FROM consumed`,
    [characterId],
  );
  return (res.rows as { buddy_key: string | null; cosmetic_id: string | null; id: number }[])
    .sort((a, b) => a.id - b.id)
    .map((row) =>
      row.buddy_key !== null ? { buddyKey: row.buddy_key } : { cosmeticId: row.cosmetic_id ?? '' },
    );
}
