// ---------------------------------------------------------------------------
// Where buddies COME FROM: the acquisition tables.
//
// Crystal Lich and Forgemaw come from independent per-player boss rolls.
// A successful roll attaches a pending companion that reveals when the player
// leaves the instance (src/sim/buddy_drops.ts). Horse instead comes from a
// 100,000-honor direct purchase at both honor vendors (content/pvp_honor.ts).
// Sapling comes from the inviter's fifth completed referral card (referral_rewards.ts).
//
// Active whistle items are soulbound grant tokens, consumed on use. Historical
// tokens remain readable in old inventories but cannot grant retired companions.
// The deed reward table is currently empty.
//
// Hunting derives sources from these tables and the live vendor stock
// (src/ui/collections/collection_sources.ts).
//
// `src/sim`-pure, rng-free (the rolls live in buddy_drops.ts).
// ---------------------------------------------------------------------------

import type { BuddyKey } from './buddies';

export interface BuddyBossDrop {
  key: BuddyKey;
  /** Mob template id of the boss. */
  bossId: string;
  /** 0..1 per-player chance on a normal (or non-instanced) kill. */
  chance: number;
  /** Per-player chance under a heroic claim; defaults to `chance`. */
  heroicChance?: number;
  /** True when only a heroic claim rolls at all. */
  heroicOnly?: boolean;
}

// CALIBRATE: every rate below is a design placeholder for the owner to tune.
export const BUDDY_BOSS_DROPS: readonly BuddyBossDrop[] = [
  // The raid pets.
  {
    key: 'crystal_lich',
    bossId: 'nythraxis_scourge_of_thornpeak',
    chance: 0.005,
    heroicChance: 0.01,
  },
  // Forgemaw is the one heroic-only companion: both Crucible bosses carry it,
  // neither on Normal.
  { key: 'forgemaw', bossId: 'ignivar_herald_of_the_last_flame', chance: 0.01, heroicOnly: true },
  {
    key: 'forgemaw',
    bossId: 'varkhul_forgefather_of_the_last_flame',
    chance: 0.01,
    heroicOnly: true,
  },
];

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

/** Every boss-drop row for one companion, for the Hunting pane. */
export function buddyBossDropsOf(key: BuddyKey): readonly BuddyBossDrop[] {
  return BUDDY_BOSS_DROPS.filter((drop) => drop.key === key);
}

/** The deed (if any) that grants one companion. */
export function buddyDeedOf(key: BuddyKey): string | null {
  for (const [deedId, buddy] of Object.entries(BUDDY_DEED_REWARDS)) {
    if (buddy === key) return deedId;
  }
  return null;
}
