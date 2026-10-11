// craft_roll_events: the append-only audit ledger of chance-based crafting
// outcomes (the sim's `craftRoll` event, src/sim/types.ts). One row per
// resolved roll: the draw the sim made, the chance it was measured against,
// the verdict, and (for Perfecting) the rank walked from and to. It exists so
// a player report such as "I failed the same item three times at 80%" can be
// checked against what the server actually rolled, and so the real success
// rate of a system is one GROUP BY away, rather than a guess from chat.
//
// Pure over a Pool (no game.ts import), the progress_events_db.ts shape:
// schema + bounded inserts + the retention prune. Writes are fire-and-forget
// through server/craft_roll_events.ts, so every argument is validated here
// (a rejected row logs, it never throws into the game loop).

import type { Pool } from 'pg';

/** The closed roll vocabulary, enforced by insertCraftRollEvent below and
 *  deliberately NOT a DB CHECK constraint (CREATE TABLE IF NOT EXISTS never
 *  revises a constraint on a deployed database; a widened vocabulary would
 *  23514 silently on every fire-and-forget insert of the new kind). The TS
 *  guard is the one source of truth; it mirrors the sim's craftRoll `kind`. */
export const CRAFT_ROLL_KINDS = ['masterwork', 'perfecting'] as const;
export type CraftRollKind = (typeof CRAFT_ROLL_KINDS)[number];

export const CRAFT_ROLL_EVENTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS craft_roll_events (
  id BIGSERIAL PRIMARY KEY,
  realm TEXT NOT NULL,
  character_id INT REFERENCES characters(id) ON DELETE SET NULL,
  account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  recipe_id TEXT,
  item_id TEXT NOT NULL,
  roll DOUBLE PRECISION NOT NULL,
  chance DOUBLE PRECISION NOT NULL,
  success BOOLEAN NOT NULL,
  rank_before INT,
  rank_after INT,
  rolled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS craft_roll_events_rolled
  ON craft_roll_events(rolled_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS craft_roll_events_kind_rolled
  ON craft_roll_events(kind, rolled_at);
CREATE INDEX IF NOT EXISTS craft_roll_events_account
  ON craft_roll_events(account_id) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS craft_roll_events_character
  ON craft_roll_events(character_id) WHERE character_id IS NOT NULL;
`;

export interface CraftRollEventRow {
  realm: string;
  characterId: number;
  accountId: number;
  kind: CraftRollKind;
  recipeId: string | null;
  itemId: string;
  /** The draw, in [0, 1). */
  roll: number;
  /** The effective chance the draw was measured against, in [0, 1]. */
  chance: number;
  success: boolean;
  rankBefore?: number | null;
  rankAfter?: number | null;
}

const ID_MAX_LENGTH = 128;

function positiveId(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
  return value;
}

function unitInterval(value: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${field} must be a finite number in [0, 1]`);
  }
  return value;
}

function nullableRank(value: number | null | undefined, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > 1000) {
    throw new TypeError(`${field} must be a safe integer between 0 and 1000`);
  }
  return value;
}

function requiredId(value: string, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.slice(0, ID_MAX_LENGTH);
}

function nullableId(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.length === 0) return null;
  return value.slice(0, ID_MAX_LENGTH);
}

/** Record one resolved roll. Append-only, no conflict target on purpose: a
 *  player legitimately rolls the same recipe many times and the observer
 *  never replays. */
export async function insertCraftRollEvent(db: Pool, row: CraftRollEventRow): Promise<void> {
  if (!CRAFT_ROLL_KINDS.includes(row.kind)) {
    throw new TypeError(`unknown craft roll kind: ${String(row.kind)}`);
  }
  await db.query(
    `INSERT INTO craft_roll_events
       (realm, character_id, account_id, kind, recipe_id, item_id,
        roll, chance, success, rank_before, rank_after)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      row.realm,
      positiveId(row.characterId, 'characterId'),
      positiveId(row.accountId, 'accountId'),
      row.kind,
      nullableId(row.recipeId),
      requiredId(row.itemId, 'itemId'),
      unitInterval(row.roll, 'roll'),
      unitInterval(row.chance, 'chance'),
      row.success === true,
      nullableRank(row.rankBefore, 'rankBefore'),
      nullableRank(row.rankAfter, 'rankAfter'),
    ],
  );
}

/** Retention prune, oldest first, bounded per call (the retention sweep's
 *  batch contract, server/retention_sweep.ts). 0 or a non-finite window keeps
 *  every row (the untrimmed 0-keeps-forever contract the other tables share). */
export async function pruneCraftRollEventsBatch(
  db: Pool,
  retentionDays: number,
  batchSize: number,
): Promise<number> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  const days = Math.max(1, Math.floor(retentionDays));
  const res = await db.query(
    `DELETE FROM craft_roll_events
      WHERE id IN (
        SELECT id FROM craft_roll_events
         WHERE rolled_at < now() - ($1::int * INTERVAL '1 day')
         ORDER BY rolled_at ASC, id ASC
         LIMIT $2)`,
    [days, Math.max(1, Math.floor(batchSize))],
  );
  return res.rowCount ?? 0;
}
