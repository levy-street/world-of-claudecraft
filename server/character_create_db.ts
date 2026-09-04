// The capped character CREATE, moved whole out of server/db.ts at the Phase 18
// database review (the monolith ratchet: db.ts pays for growth by extraction,
// server/CLAUDE.md module-first). Its sibling on the other end of a
// character's life, server/character_delete_db.ts, was already its own module;
// this is the create half, unchanged in behavior by the move.
//
// db.ts keeps the export so no caller re-points (the characters RouteDef arm,
// its retained legacy twin in main.ts, and the PBE boost roster all import it
// from there); the pool comes back from db.ts the way every other *_db.ts
// module takes it.

import type { CharacterState } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';
import { type CharacterRow, pool } from './db';
import { enqueueLinkChange } from './discord_link_changes';
import { recordCharacterCreation } from './player_metrics_db';
import { REALM } from './realm';

/** The RETURNING list every create answers with, one text so the two INSERT
 *  shapes below cannot drift apart in what they hand back. */
const CREATE_RETURNING =
  'RETURNING id, account_id, name, class, level, state, is_gm, force_rename, appearance';

/**
 * Insert one character for `accountId`, refusing past `limit` characters on
 * this realm. The account row is locked FOR UPDATE and the realm-scoped count
 * taken inside the same transaction, so two racing creates cannot both see
 * room; a refusal rolls back having written nothing and answers null.
 */
export async function createCharacterCapped(
  accountId: number,
  name: string,
  cls: PlayerClass,
  limit = 10,
  state: CharacterState | null = null,
  // The authored modular look, already normalized by the route handler.
  // Null = created without the creator (legacy rig).
  appearance: Record<string, unknown> | null = null,
  // The starting level. NULL, the default, omits the column so the DDL's own
  // default decides, which is every caller's behavior but the PBE boost's: it
  // creates level-20 characters, and before this it wrote the whole ~38 KB
  // blob a SECOND time immediately after, only to set this one column (the
  // Phase 18 database review). Naming it here costs one column and saves nine
  // full-blob rewrites per boosted registration.
  level: number | null = null,
): Promise<CharacterRow | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const account = await client.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [
      accountId,
    ]);
    if ((account.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const count = await client.query(
      'SELECT count(*)::int AS n FROM characters WHERE account_id = $1 AND realm = $2',
      [accountId, REALM],
    );
    if (Number(count.rows[0]?.n ?? 0) >= limit) {
      await client.query('ROLLBACK');
      return null;
    }
    // Two texts rather than a COALESCE over the default: the level column's
    // default lives in the DDL alone, so a create that does not ask for a
    // level must not name the column at all (a duplicated `1` here is a
    // second place for the starting level to drift).
    const values: unknown[] = [
      accountId,
      name,
      cls,
      REALM,
      state ? JSON.stringify(state) : null,
      appearance ? JSON.stringify(appearance) : null,
    ];
    if (level !== null) values.push(level);
    const res = await client.query(
      level === null
        ? `INSERT INTO characters (account_id, name, class, realm, state, appearance) VALUES ($1, $2, $3, $4, $5, $6) ${CREATE_RETURNING}`
        : `INSERT INTO characters (account_id, name, class, realm, state, appearance, level) VALUES ($1, $2, $3, $4, $5, $6, $7) ${CREATE_RETURNING}`,
      values,
    );
    await recordCharacterCreation(client, accountId, REALM);
    await client.query('COMMIT');
    // A created character can become the account's top one, and its class is fixed
    // here forever (no statement ever updates characters.class). Enqueued inside the
    // db function rather than at the route so the RouteDef arm, its retained legacy
    // twin in main.ts, and the PBE boost roster are all covered by one site. After
    // COMMIT: a rolled-back create must never have enqueued.
    enqueueLinkChange({ accountId, kinds: ['flex'] }, Date.now());
    return res.rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
