// Durable store for #478 wagered arena matches. The ArenaWagerCoordinator is
// otherwise in-memory, which would strand on-chain pots across a restart: a match
// that has both stakes locked on-chain but is forgotten by the server can never be
// settled or refunded. This persists every match through its lifecycle so a fresh
// process can recover. It also owns the match-id ALLOCATOR: a single Postgres
// sequence shared by every realm process on the one DATABASE_URL, so ids are
// globally unique and monotonic and two realms can never collide on the same
// match PDA.
//
// SQL lives only here (the server SQL-only-in-*_db.ts invariant). WAGER_MATCH_SCHEMA
// is applied by db.ts ensureSchema() under the shared advisory lock.
import { pool } from './db';
import { REALM } from './realm';

export const WAGER_MATCH_SCHEMA = `
CREATE SEQUENCE IF NOT EXISTS woc_wager_match_id_seq;
CREATE TABLE IF NOT EXISTS woc_wager_matches (
  match_id BIGINT PRIMARY KEY,
  realm TEXT NOT NULL,
  creator_pid INTEGER NOT NULL,
  opponent_pid INTEGER NOT NULL,
  creator_wallet TEXT NOT NULL,
  opponent_wallet TEXT NOT NULL,
  stake_base BIGINT NOT NULL,
  rake_bps INTEGER NOT NULL,
  phase TEXT NOT NULL,
  open_sig TEXT,
  join_sig TEXT,
  settle_sig TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS woc_wager_matches_realm_phase ON woc_wager_matches (realm, phase);
`;

export type WagerMatchPhase = 'awaiting_stakes' | 'in_bout' | 'settling' | 'settled' | 'refunded' | 'cancelled';

export interface WagerMatchRow {
  matchId: bigint;
  creatorPid: number;
  opponentPid: number;
  creatorWallet: string;
  opponentWallet: string;
  stakeBase: bigint;
  rakeBps: number;
  phase: WagerMatchPhase;
  openSig: string | null;
  joinSig: string | null;
  settleSig: string | null;
}

/**
 * Allocate a globally-unique, monotonic match id from the shared sequence. Every
 * realm process draws from the same sequence (one DATABASE_URL), so ids never
 * collide across realms on the same on-chain program.
 */
export async function allocateWagerMatchId(): Promise<bigint> {
  const r = await pool.query<{ id: string }>(`SELECT nextval('woc_wager_match_id_seq') AS id`);
  return BigInt(r.rows[0].id);
}

/** Persist a freshly paired match (awaiting both stakes). */
export async function insertWagerMatch(m: {
  matchId: bigint; creatorPid: number; opponentPid: number;
  creatorWallet: string; opponentWallet: string; stakeBase: bigint; rakeBps: number;
}): Promise<void> {
  await pool.query(
    `INSERT INTO woc_wager_matches
       (match_id, realm, creator_pid, opponent_pid, creator_wallet, opponent_wallet, stake_base, rake_bps, phase)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'awaiting_stakes')`,
    [m.matchId.toString(), REALM, m.creatorPid, m.opponentPid, m.creatorWallet, m.opponentWallet, m.stakeBase.toString(), m.rakeBps],
  );
}

/** Record a player's confirmed stake signature (the open_match or join_match tx). */
export async function recordWagerStake(matchId: bigint, role: 'open' | 'join', signature: string): Promise<void> {
  const col = role === 'open' ? 'open_sig' : 'join_sig';
  await pool.query(`UPDATE woc_wager_matches SET ${col} = $2, updated_at = now() WHERE match_id = $1`, [matchId.toString(), signature]);
}

/** Advance a match to a new phase, optionally recording the settle signature. */
export async function setWagerPhase(matchId: bigint, phase: WagerMatchPhase, settleSig?: string): Promise<void> {
  await pool.query(
    `UPDATE woc_wager_matches SET phase = $2, settle_sig = COALESCE($3, settle_sig), updated_at = now() WHERE match_id = $1`,
    [matchId.toString(), phase, settleSig ?? null],
  );
}

function rowToMatch(r: Record<string, unknown>): WagerMatchRow {
  return {
    matchId: BigInt(r.match_id as string),
    creatorPid: r.creator_pid as number,
    opponentPid: r.opponent_pid as number,
    creatorWallet: r.creator_wallet as string,
    opponentWallet: r.opponent_wallet as string,
    stakeBase: BigInt(r.stake_base as string),
    rakeBps: r.rake_bps as number,
    phase: r.phase as WagerMatchPhase,
    openSig: (r.open_sig as string) ?? null,
    joinSig: (r.join_sig as string) ?? null,
    settleSig: (r.settle_sig as string) ?? null,
  };
}

/**
 * Matches for THIS realm that were locked on-chain (both stakes in) but never
 * reached a terminal phase before the process stopped: in_bout (the bout was
 * running) or settling (settle was attempted). On boot these must be resolved by
 * refunding both players, since the bout outcome did not survive the restart.
 */
export async function recoverableLockedMatches(): Promise<WagerMatchRow[]> {
  const r = await pool.query(
    `SELECT * FROM woc_wager_matches WHERE realm = $1 AND phase IN ('in_bout', 'settling') ORDER BY match_id`,
    [REALM],
  );
  return r.rows.map(rowToMatch);
}

/** Stale pairings (still awaiting stakes) from a previous run: nothing is locked that
 * a player cannot reclaim via cancel_match, so they are simply marked cancelled. */
export async function cancelStaleAwaitingMatches(): Promise<number> {
  const r = await pool.query(
    `UPDATE woc_wager_matches SET phase = 'cancelled', updated_at = now() WHERE realm = $1 AND phase = 'awaiting_stakes'`,
    [REALM],
  );
  return r.rowCount ?? 0;
}

export async function getWagerMatch(matchId: bigint): Promise<WagerMatchRow | null> {
  const r = await pool.query(`SELECT * FROM woc_wager_matches WHERE match_id = $1`, [matchId.toString()]);
  return r.rows[0] ? rowToMatch(r.rows[0]) : null;
}
