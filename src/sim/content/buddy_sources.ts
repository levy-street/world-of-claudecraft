// ---------------------------------------------------------------------------
// Where buddies COME FROM: the acquisition tables.
//
// Crystal Lich and Forgemaw come from independent per-player heroic boss rolls.
// A successful roll attaches a pending companion that reveals when the player
// leaves the instance (src/sim/buddy_drops.ts). Horse instead comes from a
// 10,000-honor direct purchase at both honor vendors (content/pvp_honor.ts).
// Flicker and Glimmer come from the inviter's fifth completed referral card (referral_rewards.ts).
//
// Gameplay rewards grant directly into the collection. Active whistle items
// remain usable for saved inventories and developer grants.
// The deed reward table is currently empty.
//
// `src/sim`-pure, rng-free (the rolls live in buddy_drops.ts).
// ---------------------------------------------------------------------------

import type { BuddyKey } from './buddies';

export interface BuddyBossDrop {
  key: BuddyKey;
  /** Mob template id of the boss. */
  bossId: string;
  /** 0..1 per-player chance when at least BUDDY_FULL_GROUP players share the
   *  kill. A smaller group splits the full group's total instead
   *  (buddyChancePerPlayer), so the kill's total odds never drop. */
  chance: number;
  /** True when only a heroic claim rolls at all. */
  heroicOnly?: boolean;
}

/** The roster size the per-player rate is tuned for. A kill shared by fewer
 *  players still pays `chance * BUDDY_FULL_GROUP` in total, split evenly. */
export const BUDDY_FULL_GROUP = 10;

/** The owner's rate (2026-11-02): 0.1% per player at a full group of ten,
 *  so a kill carries a 1% total chance for its companion. */
export const BUDDY_BOSS_CHANCE = 0.001;

/** Forgemaw's rate is SPREAD across the two Crucible bosses: 0.05% per player
 *  per boss, so a full clear of both still pays BUDDY_BOSS_CHANCE in total. */
export const FORGEMAW_PER_BOSS_CHANCE = BUDDY_BOSS_CHANCE / 2;

// Every boss companion is heroic-only: Crystal Lich on Heroic Nythraxis, and
// Forgemaw split across both Crucible bosses. No Normal kill rolls one.
export const BUDDY_BOSS_DROPS: readonly BuddyBossDrop[] = [
  {
    key: 'crystal_lich',
    bossId: 'nythraxis_scourge_of_thornpeak',
    chance: BUDDY_BOSS_CHANCE,
    heroicOnly: true,
  },
  {
    key: 'forgemaw',
    bossId: 'ignivar_herald_of_the_last_flame',
    chance: FORGEMAW_PER_BOSS_CHANCE,
    heroicOnly: true,
  },
  {
    key: 'forgemaw',
    bossId: 'varkhul_forgefather_of_the_last_flame',
    chance: FORGEMAW_PER_BOSS_CHANCE,
    heroicOnly: true,
  },
];

/** One recipient's chance for a row when `recipients` players share the kill:
 *  the row's rate at a full group, else the full group's total split evenly
 *  (10 players at 0.1% each, or 2 players at 0.5% each, both total 1%). */
export function buddyChancePerPlayer(chance: number, recipients: number): number {
  if (recipients >= BUDDY_FULL_GROUP) return chance;
  return (chance * BUDDY_FULL_GROUP) / Math.max(1, recipients);
}

/** Deed id -> the companion earning it grants. The deed keeps its own
 *  title/border reward; the buddy rides beside it. */
export const BUDDY_DEED_REWARDS: Readonly<Record<string, BuddyKey>> = {};

/** How far a player has to walk from an open-world boss kill before a pending
 *  companion from it reveals itself. Instance kills reveal on the zone-out. */
export const BUDDY_WORLD_REVEAL_DISTANCE = 80;

const BOSS_DROPS_BY_BOSS = new Map<string, BuddyBossDrop[]>();
for (const drop of BUDDY_BOSS_DROPS) {
  const list = BOSS_DROPS_BY_BOSS.get(drop.bossId) ?? [];
  list.push(drop);
  BOSS_DROPS_BY_BOSS.set(drop.bossId, list);
}

/** The per-player rolls a kill of `bossId` makes (empty for every other mob). */
export function buddyBossDropsFor(bossId: string): readonly BuddyBossDrop[] {
  return BOSS_DROPS_BY_BOSS.get(bossId) ?? [];
}

/** The deed (if any) that grants one companion. */
export function buddyDeedOf(key: BuddyKey): string | null {
  for (const [deedId, buddy] of Object.entries(BUDDY_DEED_REWARDS)) {
    if (buddy === key) return deedId;
  }
  return null;
}
