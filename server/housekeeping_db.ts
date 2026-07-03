// SQL for the housekeeping (game-config override) feature: one JSONB document
// per realm in game_config_overrides. Logic lives in housekeeping.ts and the
// validation in src/sim/game_config.ts; this file is the only place their SQL
// runs (server/CLAUDE.md: SQL lives only in db.ts and *_db.ts).

import { pool } from './db';
import { REALM } from './realm';

export interface StoredGameConfig {
  data: unknown;
  updatedAt: string | null;
}

/** The realm's saved override document ({} when none has ever been saved). */
export async function loadGameConfigOverrides(): Promise<StoredGameConfig> {
  const res = await pool.query(
    `SELECT data, updated_at FROM game_config_overrides WHERE realm = $1`,
    [REALM],
  );
  const row = res.rows[0];
  return {
    data: row?.data ?? {},
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

/** Upsert the realm's override document (pass {} to clear everything). */
export async function saveGameConfigOverrides(
  data: unknown,
  updatedBy: number | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO game_config_overrides (realm, data, updated_at, updated_by)
     VALUES ($1, $2::jsonb, now(), $3)
     ON CONFLICT (realm) DO UPDATE
       SET data = EXCLUDED.data, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [REALM, JSON.stringify(data ?? {}), updatedBy],
  );
}
