import { findCharacterReportTargetByName, pool } from './db';
import type { ModerationWatchlist } from './moderation_service';
import { createStaffWatchlistCache } from './staff_watchlist_cache';

// The staff watchlist behind the in-game /watch and /unwatch commands
// (server/moderation_service.ts). One row per watched ACCOUNT, so a watched
// player is caught on any character and any realm; the character name is the
// one the GM typed, kept for the list and the login ping. An entry stays until
// a GM removes it: every login of the account pings the GMs online on the
// realm the player joined. Who added and removed entries is audited in
// account_moderation_actions (watch / unwatch).
export const STAFF_WATCHLIST_SCHEMA = `
CREATE TABLE IF NOT EXISTS staff_watchlist (
  account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  character_name TEXT NOT NULL,
  note TEXT,
  added_by_account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_watchlist_created ON staff_watchlist(created_at DESC);
CREATE INDEX IF NOT EXISTS staff_watchlist_added_by ON staff_watchlist(added_by_account_id)
  WHERE added_by_account_id IS NOT NULL;
`;

// The list form is a chat readout, so it is bounded.
export const STAFF_WATCHLIST_LIST_MAX = 25;

export interface StaffWatchEntry {
  accountId: number;
  characterName: string;
  note: string | null;
  addedBy: string | null;
  createdAt: string;
}

function rowToEntry(row: Record<string, unknown>): StaffWatchEntry {
  return {
    accountId: Number(row.account_id),
    characterName: String(row.character_name),
    note: typeof row.note === 'string' && row.note ? row.note : null,
    addedBy: typeof row.added_by === 'string' ? row.added_by : null,
    createdAt: new Date(row.created_at as string | Date).toISOString(),
  };
}

// Upsert: watching an already-watched account refreshes the name, note, and
// author instead of failing, so a GM can re-watch to update the note.
export async function addStaffWatch(input: {
  accountId: number;
  characterName: string;
  note: string | null;
  addedByAccountId: number;
}): Promise<void> {
  await pool.query(
    `INSERT INTO staff_watchlist (account_id, character_name, note, added_by_account_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (account_id) DO UPDATE
       SET character_name = EXCLUDED.character_name,
           note = EXCLUDED.note,
           added_by_account_id = EXCLUDED.added_by_account_id,
           created_at = now()`,
    [input.accountId, input.characterName, input.note, input.addedByAccountId],
  );
  listCache.bust();
}

// True when a row was removed.
export async function removeStaffWatch(accountId: number): Promise<boolean> {
  const res = await pool.query('DELETE FROM staff_watchlist WHERE account_id = $1', [accountId]);
  listCache.bust();
  return (res.rowCount ?? 0) > 0;
}

export async function staffWatchForAccount(accountId: number): Promise<StaffWatchEntry | null> {
  const res = await pool.query(
    `SELECT w.account_id, w.character_name, w.note, w.created_at, a.username AS added_by
       FROM staff_watchlist w
       LEFT JOIN accounts a ON a.id = w.added_by_account_id
      WHERE w.account_id = $1`,
    [accountId],
  );
  const row = res.rows[0];
  return row ? rowToEntry(row) : null;
}

async function queryStaffWatches(): Promise<{ entries: StaffWatchEntry[]; total: number }> {
  const res = await pool.query(
    // The exact count still scans the watchlist once per refresh, O(N).
    // Limit before joining authors so only the newest 25 need account reads.
    // One statement keeps the list and exact count on the same MVCC snapshot.
    `WITH newest AS MATERIALIZED (
       SELECT account_id, character_name, note, created_at, added_by_account_id
         FROM staff_watchlist
        ORDER BY created_at DESC
        LIMIT $1
     )
     SELECT w.account_id, w.character_name, w.note, w.created_at, a.username AS added_by,
            (SELECT count(*) FROM staff_watchlist) AS total
       FROM newest w
       LEFT JOIN accounts a ON a.id = w.added_by_account_id
      ORDER BY w.created_at DESC`,
    [STAFF_WATCHLIST_LIST_MAX],
  );
  return {
    entries: res.rows.map(rowToEntry),
    total: res.rows.length > 0 ? Number(res.rows[0].total) : 0,
  };
}

const listCache = createStaffWatchlistCache(queryStaffWatches);

export function listStaffWatches(): Promise<{ entries: StaffWatchEntry[]; total: number }> {
  return listCache.read();
}

export function resetStaffWatchlistCacheForTests(): void {
  listCache.bust();
}

// The live adapter ModerationService takes. Names resolve on this realm (names
// are unique per realm), then everything is keyed by the account.
export const pgStaffWatchlist: ModerationWatchlist = {
  findCharacter: async (name) => {
    const target = await findCharacterReportTargetByName(name);
    return target ? { accountId: target.accountId, characterName: target.characterName } : null;
  },
  add: addStaffWatch,
  remove: removeStaffWatch,
  forAccount: staffWatchForAccount,
  list: listStaffWatches,
};
