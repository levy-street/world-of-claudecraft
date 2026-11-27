// Pure view model of the Adventure Journal's personal progress layer: how many
// times this character has felled a page's boss on each difficulty
// (IWorld.bossKills, src/sim/boss_kill_tally.ts), and whether the character is
// saved to the instance on the difficulty being read (IWorld.raidLockouts).
// DOM-free and clock-free: the window hands in the tally, the live lockouts and
// the time once per render, and journal_progress_html.ts translates the result.
//
// LOCKOUTS ARE THE SIM'S OWN, never a rule invented here. A lockout is stamped
// on a ROOM's final-boss kill (src/sim/instances/dungeons.ts): a raid room
// locks per difficulty (the bare room id for Normal, `<room>:heroic` for
// Heroic), a five-player dungeon only on Heroic. An instance's rooms are its
// Dungeon Finder activity's own (the Crucible: its arena and the Inner
// Crucible); each room's lock belongs to the journal page whose bodies hold
// that room's final boss. The reset boundary is the room's (weekly for the
// raid rooms the sim lists in WEEKLY_LOCKOUT_RAID_ROOMS, the realm day for the
// rest). An instance with no rooms the sim locks (the Smith's Heart today)
// shows its kills and no lockout at all.

import { bossKillCount } from '../../../sim/boss_kill_tally';
import { HEROIC_DUNGEON_TUNING } from '../../../sim/content/dungeon_difficulty';
import { FINDER_ACTIVITIES } from '../../../sim/content/dungeon_finder';
import { isRaidRoom, WEEKLY_LOCKOUT_RAID_ROOMS } from '../../../sim/raid_rooms';
import type { RaidLockout } from '../../../world_api/dungeons';
import type { JournalInstance, JournalTier } from './journal_catalog';
import { journalPageBodies } from './journal_catalog';

/** How long a lockout lasts: to the weekly raid reset, or the realm day's. */
export type JournalLockBoundary = 'weekly' | 'daily';

/** One room the sim locks, and the journal page its final boss has. */
export interface JournalLockRoom {
  room: string;
  bossKey: string;
  boundary: JournalLockBoundary;
}

/** One difficulty's cell of the "Your kills" strip. */
export interface JournalKillCell {
  tier: JournalTier;
  /** The kill count; null for a tier with no content yet (Mythic). */
  count: number | null;
  /** The difficulty being read. */
  selected: boolean;
}

/** The instance's lockout on the difficulty being read, when any room of it
 *  is saved. `total` counts the rooms the sim locks on that difficulty. */
export interface JournalLockoutSummary {
  saved: number;
  total: number;
  boundary: JournalLockBoundary;
  /** Time left on the soonest of the saved rooms. */
  msRemaining: number;
  /** When that lock lifts, epoch ms on the clock the window handed in. */
  resetAtMs: number;
}

export interface JournalPageProgress {
  kills: readonly JournalKillCell[];
  lockout: JournalLockoutSummary | null;
  /** This page's own boss is saved on the difficulty being read. */
  pageSaved: JournalLockBoundary | null;
}

const roomCache = new Map<string, readonly JournalLockRoom[]>();

/** The rooms the sim locks inside an instance, each with its page. Built once
 *  per instance from immutable content. */
export function journalLockRooms(instance: JournalInstance): readonly JournalLockRoom[] {
  const cached = roomCache.get(instance.id);
  if (cached) return cached;
  const rooms = new Set<string>();
  for (const activity of FINDER_ACTIVITIES) {
    if (activity.dungeonId !== instance.id || activity.lockout === 'none') continue;
    rooms.add(activity.dungeonId);
    for (const room of activity.lockoutDungeonIds ?? []) rooms.add(room);
  }
  const out: JournalLockRoom[] = [];
  for (const room of rooms) {
    const finalBossId = HEROIC_DUNGEON_TUNING[room]?.finalBossId;
    if (!finalBossId) continue;
    const bossKey = instance.source.bossKeys.find((key) =>
      journalPageBodies(instance.source, key).includes(finalBossId),
    );
    if (!bossKey) continue;
    out.push({
      room,
      bossKey,
      boundary: WEEKLY_LOCKOUT_RAID_ROOMS.has(room) ? 'weekly' : 'daily',
    });
  }
  roomCache.set(instance.id, out);
  return out;
}

/** The lockout id the sim stamps for a room on a difficulty, or null when that
 *  difficulty never locks there (a dungeon's Normal, any room's Mythic). */
export function journalLockoutId(room: string, tier: JournalTier): string | null {
  if (tier === 'heroic') return `${room}:heroic`;
  if (tier === 'normal') return isRaidRoom(room) ? room : null;
  return null;
}

/** A page's kills on one difficulty: its lead body's count, or for a council
 *  the member the tally keys it under (the highest of its bodies). */
export function journalPageKills(
  instance: JournalInstance,
  bossKey: string,
  tier: JournalTier,
  tally: Readonly<Record<string, number>>,
): number {
  if (tier === 'mythic') return 0;
  let best = 0;
  for (const body of journalPageBodies(instance.source, bossKey)) {
    best = Math.max(best, bossKillCount(tally, body, tier));
  }
  return best;
}

/** The time left on every live lockout, by id (the IWorld read's rows). */
function lockoutsById(lockouts: readonly RaidLockout[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of lockouts) if (row.msRemaining > 0) out.set(row.id, row.msRemaining);
  return out;
}

/** The pages of an instance saved on a difficulty (the list's Defeated). */
export function journalSavedPages(
  instance: JournalInstance,
  tier: JournalTier,
  lockouts: readonly RaidLockout[],
): ReadonlySet<string> {
  const live = lockoutsById(lockouts);
  const out = new Set<string>();
  for (const room of journalLockRooms(instance)) {
    const id = journalLockoutId(room.room, tier);
    if (id && live.has(id)) out.add(room.bossKey);
  }
  return out;
}

/** The whole progress layer of one page on the difficulty being read. */
export function journalPageProgress(
  instance: JournalInstance,
  bossKey: string,
  tier: JournalTier,
  tally: Readonly<Record<string, number>>,
  lockouts: readonly RaidLockout[],
  nowMs: number,
): JournalPageProgress {
  const kills = instance.tiers.map(
    (entry): JournalKillCell => ({
      tier: entry,
      count: entry === 'mythic' ? null : journalPageKills(instance, bossKey, entry, tally),
      selected: entry === tier,
    }),
  );
  const live = lockoutsById(lockouts);
  let total = 0;
  let saved = 0;
  let soonest = Number.POSITIVE_INFINITY;
  let boundary: JournalLockBoundary = 'daily';
  let pageSaved: JournalLockBoundary | null = null;
  for (const room of journalLockRooms(instance)) {
    const id = journalLockoutId(room.room, tier);
    if (!id) continue;
    total++;
    const remaining = live.get(id);
    if (remaining === undefined) continue;
    saved++;
    if (room.boundary === 'weekly') boundary = 'weekly';
    soonest = Math.min(soonest, remaining);
    if (room.bossKey === bossKey) pageSaved = room.boundary;
  }
  const lockout: JournalLockoutSummary | null =
    saved > 0 ? { saved, total, boundary, msRemaining: soonest, resetAtMs: nowMs + soonest } : null;
  return { kills, lockout, pageSaved };
}
