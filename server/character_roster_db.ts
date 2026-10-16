// Account roster ranking query, shared by account integrations.
import { type CharacterRow, pool } from './db';
import { REALM } from './realm';

export async function highestCharacterForAccount(accountId: number): Promise<CharacterRow | null> {
  const res = await pool.query(
    `SELECT id, account_id, name, class, level, state, is_gm, force_rename
       FROM characters
      WHERE account_id = $1 AND realm = $2
      ORDER BY level DESC, ((state->>'lifetimeXp')::bigint) DESC NULLS LAST, id ASC
      LIMIT 1`,
    [accountId, REALM],
  );
  return res.rows[0] ?? null;
}
