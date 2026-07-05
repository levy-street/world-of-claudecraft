// World bosses: server-wide elites that rise on a fixed cadence, announce
// themselves, and reward every player who damaged them with PERSONAL loot, gated
// to once per day per boss.
//
// This module owns the world-boss DATA (the spawn registry) and the pure pieces of
// the system: the per-player daily-loot gate, the contributor set derived from a
// boss's hate table, and the personal-loot roller. The SCHEDULER state and the
// spawn primitive live on `Sim` (it needs createMob/addEntity/groundPos), which
// drives this module each tick; the loot roller is reached through the SimContext
// seam (ctx.rollWorldBossLoot), exactly like ctx.rollLoot.
//
// Determinism (this is sim-core): no Math.random/Date.now, randomness is ctx.rng
// only, and the daily boundary is the host-injected ctx.utcDay string (empty in
// headless/replay, so the gate never rolls over and same-seed runs reproduce). The
// personal-loot roller draws rng in a FIXED order (contributors sorted by entityId,
// loot entries in array order) so the parity gate's rng draw-order log stays stable.

import { MOBS } from './data';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { Entity, LootSlot } from './types';

// Sim-time cadence: a fresh boss rises this many seconds after the previous one
// was scheduled. On the live server the sim runs at wall-clock speed (20 Hz), so
// this is "every 3 hours". Lives here with the system that uses it.
export const WORLD_BOSS_INTERVAL_SECONDS = 3 * 3600;

// How long a slain world boss's lootable corpse lingers before it is removed. Much
// longer than a normal corpse so every contributor has time to walk over and loot
// their personal drops; the scheduler drops the entity once this elapses.
export const WORLD_BOSS_CORPSE_SECONDS = 300;

export interface WorldBossDef {
  // MobTemplate id (must have `worldBoss: true`).
  templateId: string;
  // Fixed overworld spawn point (y is grounded at spawn time).
  pos: { x: number; z: number };
  // Seconds of sim time between scheduled spawns.
  intervalSeconds: number;
}

// The world bosses of the live world. One per entry; the scheduler tracks each
// independently. Thunzharr rises at Stormcrag in Thornpeak Heights.
export const WORLD_BOSSES: readonly WorldBossDef[] = [
  {
    templateId: 'thunzharr_waking_peak',
    pos: { x: 110, z: 760 },
    intervalSeconds: WORLD_BOSS_INTERVAL_SECONDS,
  },
];

// Per-player daily loot record. `date` is the UTC day the `looted` set belongs to;
// `looted` holds the boss template ids already looted that day.
export interface WorldBossDaily {
  date: string;
  looted: Set<string>;
}

export function emptyWorldBossDaily(): WorldBossDaily {
  return { date: '', looted: new Set() };
}

// Roll the daily window over when the host's UTC day changes. A no-op when the day
// is unknown (headless/replay, utcDay === ''), keeping replays reproducible.
export function refreshWorldBossDaily(meta: PlayerMeta, utcDay: string): void {
  if (utcDay && meta.worldBossDaily.date !== utcDay) {
    meta.worldBossDaily = { date: utcDay, looted: new Set() };
  }
}

// Eligible if this player has not already looted this boss today. When the calendar
// day is unknown (utcDay === ''), there is no daily window to enforce, so the player
// is always eligible (offline/headless play is non-authoritative).
export function isWorldBossLootEligible(meta: PlayerMeta, bossId: string, utcDay: string): boolean {
  refreshWorldBossDaily(meta, utcDay);
  if (!utcDay) return true;
  return !meta.worldBossDaily.looted.has(bossId);
}

// Record that this player looted this boss today (so they cannot loot it again
// until the daily reset). Called from lootCorpse when a personal world-boss slot
// is actually taken, NOT at kill/roll time. A no-op when the calendar day is unknown.
export function markWorldBossLooted(meta: PlayerMeta, bossId: string, utcDay: string): void {
  if (!utcDay) return;
  refreshWorldBossDaily(meta, utcDay);
  meta.worldBossDaily.looted.add(bossId);
}

// The players who contributed to (damaged or healed against) this boss, derived
// from its hate table. Pet threat is credited to the pet's owner; the set is
// deduped and resolved to live PlayerMeta, then sorted by entityId so any
// downstream rng draws happen in a fixed order. Read BEFORE handleDeath clears the
// boss's threat.
export function worldBossContributors(ctx: SimContext, mob: Entity): PlayerMeta[] {
  const seen = new Set<number>();
  const out: PlayerMeta[] = [];
  for (const attackerId of mob.threat.keys()) {
    const attacker = ctx.entities.get(attackerId);
    // controlled pets credit their owner; everyone else credits themselves. A pet
    // already despawned at the death frame cannot resolve to its owner (the hate
    // table holds only the pet's id), so that credit is dropped: rare, and
    // deterministic either way.
    const pid = attacker && attacker.ownerId !== null ? attacker.ownerId : attackerId;
    if (seen.has(pid)) continue;
    seen.add(pid);
    const meta = ctx.players.get(pid);
    if (meta) out.push(meta);
  }
  return out.sort((a, b) => a.entityId - b.entityId);
}

// Drop PERSONAL loot for a slain world boss: every contributor who has not already
// looted this boss today gets an independent roll of the boss's loot table, added
// to the shared corpse as `personalFor` slots only that player can take. Mirrors
// rollLoot's per-entry semantics (exclusive rollGroups via one partitioned draw,
// plain per-entry chance) but runs the whole table once per eligible contributor.
// SUPPORTED ENTRY SHAPES: itemId with optional rollGroup only. Unlike rollLoot,
// there is no questId gating and no per-entry copper here; a world-boss loot
// table must not use those fields (they would hand quest items to everyone
// ungated / silently drop the copper).
export function rollWorldBossLoot(ctx: SimContext, mob: Entity, contributors: PlayerMeta[]): void {
  const template = MOBS[mob.templateId];
  if (!template) return;
  const items: LootSlot[] = mob.loot?.items ?? [];
  const copper = mob.loot?.copper ?? 0;
  // contributors arrive sorted by entityId (worldBossContributors); iterate in that
  // fixed order so the rng draw order is deterministic for the parity gate.
  // Eligibility is checked here, but the daily lockout is consumed only when the
  // player actually LOOTS a personal slot (lootCorpse in interaction.ts): a
  // contributor who dies or never reaches the corpse inside the loot window keeps
  // their daily and can try again at the next spawn. Corpse windows (300s) never
  // overlap the 3h cadence, so at most one corpse is ever lootable at a time.
  for (const meta of contributors) {
    if (!isWorldBossLootEligible(meta, mob.templateId, ctx.utcDay)) continue;
    const rolledGroups = new Set<string>();
    for (const entry of template.loot) {
      if (entry.rollGroup) {
        if (rolledGroups.has(entry.rollGroup)) continue;
        rolledGroups.add(entry.rollGroup);
        const group = template.loot.filter((l) => l.rollGroup === entry.rollGroup);
        const roll = ctx.rng.next();
        let cumulative = 0;
        for (const g of group) {
          cumulative += g.chance;
          if (roll < cumulative) {
            if (g.itemId) items.push({ itemId: g.itemId, count: 1, personalFor: [meta.entityId] });
            break;
          }
        }
        continue;
      }
      if (!ctx.rng.chance(entry.chance)) continue;
      if (entry.itemId)
        items.push({ itemId: entry.itemId, count: 1, personalFor: [meta.entityId] });
    }
  }
  if (copper > 0 || items.length > 0) {
    mob.loot = { copper, items };
    mob.lootable = true;
  }
}
