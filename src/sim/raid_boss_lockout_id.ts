// The per-boss raid lockout's id, as a dependency-free leaf: the sim stamps it
// (instances/raid_boss_lockout.ts), the save and the wire carry it verbatim in
// the character's `raidLockouts` map (lockout id -> absolute unlock epoch ms),
// character select groups it (raid_lockout_state.ts) and the client names it
// (src/ui/raid_lockout_format.ts) and shows it in the Adventure Journal
// (src/ui/hud/journal/journal_progress_view.ts) without booting a Sim.
//
// The older raids lock per ROOM on its final boss (a bare room id for Normal,
// `<room>:heroic` for Heroic, src/sim/raid_rooms.ts). A raid listed below
// locks per BOSS instead: every encounter of its route locks the character
// for that boss on that difficulty until the weekly raid reset, under
//
//   `<raid>:<encounter>`          Normal
//   `<raid>:<encounter>:heroic`   Heroic
//
// where `<encounter>` is the boss kill tally's encounter id
// (boss_kill_tally.ts BOSS_KILL_ENCOUNTERS: a council of two locks under its
// first member). The raid id carries no colon and the room ids of the older
// raids are never listed here, so no older id (`nythraxis_boss_arena:heroic`,
// `worldboss:<mob>`, `weeklyquest:<quest>`) ever parses as a boss lock.

import type { DungeonDifficulty } from './types';

/** The raids that lock per boss on the weekly reset (Normal and Heroic each
 *  their own lock). Explicit by the owner's ruling of 2026-11-28 for the
 *  Smith's Heart (the literal is its SMITH_HEART_DUNGEON id, pinned by
 *  tests/smith_heart_lockout.test.ts); never derived from content, so a new
 *  raid opts in here or keeps the per-room model. */
export const PER_BOSS_LOCKOUT_RAIDS: ReadonlySet<string> = new Set(['smith_heart']);

/** The id suffix of each difficulty's lock. Typed over DungeonDifficulty on
 *  purpose: the day a Mythic tier joins that union, this table stops compiling
 *  until it names Mythic's own suffix, so the new tier never shares a lock. */
const DIFFICULTY_SUFFIX: Readonly<Record<DungeonDifficulty, string>> = {
  normal: '',
  heroic: ':heroic',
};

const SEGMENT_RE = /^[a-z0-9_]{1,80}$/;
/** Difficulty words (Mythic included ahead of its tier), never boss ids. */
const RESERVED_SEGMENTS: ReadonlySet<string> = new Set(['normal', 'heroic', 'mythic']);

/** One parsed per-boss lock. */
export interface BossLockoutRef {
  raidId: string;
  encounterId: string;
  difficulty: DungeonDifficulty;
}

/** The lock id of one boss of a per-boss raid on one difficulty. */
export function bossLockoutId(
  raidId: string,
  encounterId: string,
  difficulty: DungeonDifficulty,
): string {
  return `${raidId}:${encounterId}${DIFFICULTY_SUFFIX[difficulty]}`;
}

/** The per-boss lock an id names, or null for every other lockout id (a room
 *  lock, a world boss, a weekly quest, a raid that is not per boss, junk). */
export function parseBossLockoutId(id: string): BossLockoutRef | null {
  const parts = id.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  const [raidId, encounterId, tier] = parts;
  if (!PER_BOSS_LOCKOUT_RAIDS.has(raidId) || !SEGMENT_RE.test(encounterId)) return null;
  // A difficulty name is never an encounter: `<raid>:heroic` is the room-style
  // heroic lock shape (dungeons.ts heroicLockoutId), not a boss called heroic.
  if (RESERVED_SEGMENTS.has(encounterId)) return null;
  if (tier === undefined) return { raidId, encounterId, difficulty: 'normal' };
  for (const difficulty of Object.keys(DIFFICULTY_SUFFIX) as DungeonDifficulty[]) {
    if (DIFFICULTY_SUFFIX[difficulty] === `:${tier}`) return { raidId, encounterId, difficulty };
  }
  return null;
}
