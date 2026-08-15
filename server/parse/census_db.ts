// Production census loader: this realm's characters plus lifetime playtime.
// Deliberately NEVER selects from accounts and never selects the play_sessions
// ip/ua columns; GM characters are excluded so dev characters cannot skew
// population views. Mirrors the woc-scout ETL field mapping (talents/
// equipment/prestige/arena/deedStats out of the state JSONB, vlevel recomputed
// from lifetimeXp via the sim's own virtualLevel).
//
// Cost discipline (review): the read is BATCHED with a keyset on c.id (the
// loadGuildBankRows precedent) and projects only the state sub-paths
// toCensusRecord reads, never the whole blob, so a large realm neither holds
// every state JSONB in memory at once nor runs one unbounded statement on the
// pool shared with the world loop.
import { virtualLevel } from '../../src/sim/types';
import { runWithStatementTimeout } from '../db';
import type { CensusRecord } from './contract';

/** Per-batch statement timeout; each batch is small by construction. */
const CENSUS_BATCH_TIMEOUT_MS = 15_000;
export const CENSUS_BATCH_SIZE = 500;

/** The lifetime counters worth carrying (the scout allowlist). */
const COUNTER_KEYS = [
  'damageDealt',
  'kills',
  'deaths',
  'crits',
  'duelsWon',
  'duelsLost',
  'dungeonFinalBossKills',
  'fullPartyDungeonClears',
  'partiesJoined',
  'thunzharrKills',
  'dummyDamage',
] as const;

/**
 * One keyset batch. Exported so the PII test can pin its text: it may never
 * join accounts, never select play_sessions ip/ua, and must exclude GM
 * characters. Session durations are clamped to [0, 86400] per row, and the
 * play_session_totals rollup term keeps lifetime playtime identical after the
 * retention sweep folds old sessions forward (the listCharacters precedent).
 */
export const CENSUS_SQL = `SELECT c.id, c.name, c.class, c.level,
            jsonb_build_object(
              'talents', c.state->'talents',
              'equipment', c.state->'equipment',
              'prestigeRank', c.state->'prestigeRank',
              'lifetimeXp', c.state->'lifetimeXp',
              'delveClears', c.state->'delveClears',
              'deedStats', jsonb_build_object(
                'counters', c.state->'deedStats'->'counters',
                'dungeonClears', c.state->'deedStats'->'dungeonClears'
              ),
              'arenaWins', c.state->'arenaWins',
              'arenaLosses', c.state->'arenaLosses',
              'arena1v1Wins', c.state->'arena1v1Wins',
              'arena1v1Losses', c.state->'arena1v1Losses',
              'arena1v1Rating', c.state->'arena1v1Rating',
              'arena2v2Wins', c.state->'arena2v2Wins',
              'arena2v2Losses', c.state->'arena2v2Losses',
              'arena2v2Rating', c.state->'arena2v2Rating'
            ) AS state,
            c.created_at::text AS created_at, c.last_login::text AS last_login,
            (COALESCE(p.playtime, 0) + COALESCE(totals.playtime_seconds, 0))::text AS playtime,
            (COALESCE(p.sessions, 0) + COALESCE(totals.sessions, 0))::int AS sessions
     FROM characters c
     LEFT JOIN LATERAL (
       SELECT SUM(LEAST(GREATEST(EXTRACT(EPOCH FROM (s.ended_at - s.started_at)), 0), 86400))::bigint AS playtime,
              COUNT(*)::int AS sessions
       FROM play_sessions s
       WHERE s.character_id = c.id AND s.ended_at IS NOT NULL
     ) p ON TRUE
     LEFT JOIN play_session_totals totals
       ON totals.character_id = c.id AND totals.account_id = c.account_id
     WHERE c.realm = $1 AND c.is_gm = FALSE AND c.id > $2
     ORDER BY c.id
     LIMIT $3`;

export async function loadCensusRows(realm: string, snapshotDate: string): Promise<CensusRecord[]> {
  const out: CensusRecord[] = [];
  let lastId = 0;
  for (;;) {
    const res = await runWithStatementTimeout(CENSUS_BATCH_TIMEOUT_MS, (query) =>
      query(CENSUS_SQL, [realm, lastId, CENSUS_BATCH_SIZE]),
    );
    const rows = res.rows as CensusRowRaw[];
    for (const row of rows) out.push(toCensusRecord(row, snapshotDate));
    if (rows.length < CENSUS_BATCH_SIZE) break;
    lastId = Number(rows[rows.length - 1]?.id);
  }
  return out;
}

export interface CensusRowRaw {
  id: string;
  name: string;
  class: string;
  level: number;
  state: Record<string, unknown> | null;
  created_at: string | null;
  last_login: string | null;
  playtime: string;
  sessions: number;
}

export function toCensusRecord(row: CensusRowRaw, snapshotDate: string): CensusRecord {
  const state = row.state ?? {};
  const talents = asObj(state.talents);
  const deedStats = asObj(state.deedStats);
  const lifetimeXp = asNumber(state.lifetimeXp);
  const counters: Record<string, number> = {};
  const rawCounters = asObj(deedStats?.counters);
  if (rawCounters !== null) {
    for (const key of COUNTER_KEYS) {
      const value = rawCounters[key];
      if (typeof value === 'number' && value > 0) counters[key] = value;
    }
  }
  const arena = pickArena(state);
  return {
    t: 'census',
    snapshotDate,
    characterId: Number(row.id),
    name: row.name,
    class: row.class,
    level: row.level,
    vlevel: Math.max(row.level, virtualLevel(lifetimeXp)),
    spec: typeof talents?.spec === 'string' ? talents.spec : null,
    talents:
      talents !== null && (talents.ranks !== undefined || talents.choices !== undefined)
        ? { ranks: talents.ranks ?? {}, choices: talents.choices ?? {} }
        : null,
    equipment: asObj(state.equipment),
    prestigeRank: asNumber(state.prestigeRank),
    counters: Object.keys(counters).length > 0 ? counters : null,
    arena,
    dungeonClears: asObj(deedStats?.dungeonClears),
    delveClears: asObj(state.delveClears),
    playtimeSeconds: Number(row.playtime),
    playSessions: row.sessions,
    createdAt: row.created_at,
    lastLogin: row.last_login,
  };
}

function asObj(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function pickArena(state: Record<string, unknown>): Record<string, number> | null {
  const mapping: [string, string][] = [
    ['wins', 'arenaWins'],
    ['losses', 'arenaLosses'],
    ['wins_1v1', 'arena1v1Wins'],
    ['losses_1v1', 'arena1v1Losses'],
    ['rating_1v1', 'arena1v1Rating'],
    ['wins_2v2', 'arena2v2Wins'],
    ['losses_2v2', 'arena2v2Losses'],
    ['rating_2v2', 'arena2v2Rating'],
  ];
  const arena: Record<string, number> = {};
  for (const [key, stateKey] of mapping) {
    const value = state[stateKey];
    if (typeof value === 'number' && value !== 0) arena[key] = value;
  }
  return Object.keys(arena).length > 0 ? arena : null;
}
