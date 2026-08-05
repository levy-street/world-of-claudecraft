// Production census loader: this realm's characters plus summed play_sessions
// durations. Deliberately NEVER selects from accounts and never selects the
// play_sessions ip/ua columns; GM characters are excluded so dev characters
// cannot skew population views. Mirrors the woc-scout ETL field mapping
// (talents/equipment/prestige/arena/deedStats out of the state JSONB, vlevel
// recomputed from lifetimeXp via the sim's own virtualLevel).
import { virtualLevel } from '../../src/sim/types';
import { pool } from '../db';
import type { CensusRecord } from './contract';

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

interface CensusRowRaw {
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

export async function loadCensusRows(realm: string, snapshotDate: string): Promise<CensusRecord[]> {
  const res = await pool.query<CensusRowRaw>(
    `SELECT c.id, c.name, c.class, c.level, c.state,
            c.created_at::text AS created_at, c.last_login::text AS last_login,
            COALESCE(p.playtime, 0)::text AS playtime, COALESCE(p.sessions, 0)::int AS sessions
     FROM characters c
     LEFT JOIN (
       SELECT character_id,
              SUM(LEAST(GREATEST(EXTRACT(EPOCH FROM (ended_at - started_at)), 0), 86400))::bigint AS playtime,
              COUNT(*) AS sessions
       FROM play_sessions
       WHERE ended_at IS NOT NULL
       GROUP BY character_id
     ) p ON p.character_id = c.id
     WHERE c.realm = $1 AND c.is_gm = FALSE`,
    [realm],
  );
  return res.rows.map((row) => toCensusRecord(row, snapshotDate));
}

function toCensusRecord(row: CensusRowRaw, snapshotDate: string): CensusRecord {
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
