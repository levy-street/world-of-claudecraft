// Long-term Rift itemization: personal Rift gear drops plus deterministic forge
// operations (upgrade, enchant, gems). Static ItemDefs remain the combat-safe
// shell; all per-copy progression lives in ItemInstancePayload.

import {
  RIFT_ESSENCE_ITEM_ID,
  RIFT_GEM_IDS,
  RIFT_LEGENDARY_ITEM_IDS,
  type RiftGemId,
} from '../content/rift/items';
import { ITEMS } from '../data';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity, ItemInstancePayload, PlayerClass, RiftTier } from '../types';
import { riftHeroicClearPool, riftNormalClearPool } from './loot_pools';
import { riftRankForBaseLevel } from './ranks';

export const RIFT_ENCHANT_STATS = [
  'str',
  'agi',
  'sta',
  'int',
  'spi',
  'critRating',
  'hasteRating',
] as const;
export type RiftEnchantStat = (typeof RIFT_ENCHANT_STATS)[number];

const TIER_POWER: Record<RiftTier, number> = { C: 1, B: 2, A: 3, S: 4 };
const MELEE_CLASSES = new Set<PlayerClass>(['warrior', 'paladin', 'shaman']);
const AGILITY_CLASSES = new Set<PlayerClass>(['rogue', 'hunter', 'druid']);

export type RiftForgeAction = 'upgrade' | 'enchant' | 'socket';
export interface RiftForgeResult {
  ok: boolean;
  action: RiftForgeAction;
  itemId: string;
  reason?:
    | 'not_found'
    | 'not_rift_gear'
    | 'max_upgrade'
    | 'insufficient_essence'
    | 'invalid_stat'
    | 'invalid_gem'
    | 'sockets_full';
  upgradeLevel?: number;
  essenceSpent?: number;
}

function shellForClass(cls: PlayerClass): {
  itemId: string;
  primary: 'str' | 'agi' | 'int';
  secondary: 'sta' | 'spi';
} {
  if (MELEE_CLASSES.has(cls)) {
    return { itemId: 'riftbound_band_of_might', primary: 'str', secondary: 'sta' };
  }
  if (AGILITY_CLASSES.has(cls)) {
    return { itemId: 'riftbound_band_of_guile', primary: 'agi', secondary: 'sta' };
  }
  return { itemId: 'riftbound_band_of_insight', primary: 'int', secondary: 'spi' };
}

function rebuildRolledStats(instance: ItemInstancePayload): void {
  const rift = instance.rift;
  if (!rift) return;
  const stats: Record<string, number> = { ...rift.baseStats };
  const primary = Object.keys(rift.baseStats)[0];
  if (primary) stats[primary] = (stats[primary] ?? 0) + rift.upgradeLevel;
  stats.sta = (stats.sta ?? 0) + Math.floor(rift.upgradeLevel / 2);
  if (rift.enchant) stats[rift.enchant.stat] = (stats[rift.enchant.stat] ?? 0) + rift.enchant.value;
  for (const gem of rift.gems) {
    if (gem === 'rift_gem_crimson') stats.str = (stats.str ?? 0) + 2;
    else if (gem === 'rift_gem_azure') stats.int = (stats.int ?? 0) + 2;
    else if (gem === 'rift_gem_verdant') stats.sta = (stats.sta ?? 0) + 2;
  }
  instance.rolled = { ...(instance.rolled ?? {}), quality: 'epic', stats };
}

const SHELL_STATS: Readonly<
  Record<string, { primary: 'str' | 'agi' | 'int'; secondary: 'sta' | 'spi' }>
> = {
  riftbound_band_of_might: { primary: 'str', secondary: 'sta' },
  riftbound_band_of_insight: { primary: 'int', secondary: 'spi' },
  riftbound_band_of_guile: { primary: 'agi', secondary: 'sta' },
};

/** Rebuild a persisted copy from bounded progression inputs; rolled stats and
 * baseStats are never trusted from JSONB. Null downgrades a malformed copy to
 * its harmless static ItemDef shell at the load boundary. */
export function sanitizeRiftGearInstance(
  itemId: string,
  input: ItemInstancePayload,
  ownerId: number,
): ItemInstancePayload | null {
  const source = input.rift;
  const shell = SHELL_STATS[itemId];
  if (!source || !shell || !['C', 'B', 'A', 'S'].includes(source.tier)) return null;
  const power = TIER_POWER[source.tier];
  if (
    !Number.isInteger(source.upgradeLevel) ||
    source.upgradeLevel < 0 ||
    source.upgradeLevel > 5 ||
    typeof source.sourceEventId !== 'string' ||
    source.sourceEventId.length < 1 ||
    source.sourceEventId.length > 128
  ) {
    return null;
  }
  const gemSlots = source.tier === 'S' ? 2 : 1;
  const gems = Array.isArray(source.gems)
    ? source.gems.filter((gem): gem is RiftGemId =>
        (RIFT_GEM_IDS as readonly string[]).includes(gem),
      )
    : [];
  if (gems.length > gemSlots) return null;
  const enchant = source.enchant;
  if (
    enchant &&
    (!(RIFT_ENCHANT_STATS as readonly string[]).includes(enchant.stat) ||
      enchant.value !== Math.max(1, Math.ceil(power / 2)))
  ) {
    return null;
  }
  const clean: ItemInstancePayload = {
    boundTo: ownerId,
    rolled: { quality: 'epic', stats: {} },
    rift: {
      sourceEventId: source.sourceEventId,
      tier: source.tier,
      power,
      upgradeLevel: source.upgradeLevel,
      maxUpgradeLevel: 5,
      baseStats: {
        [shell.primary]: power,
        [shell.secondary]: Math.max(1, Math.ceil(power / 2)),
      },
      ...(enchant && { enchant: { ...enchant } }),
      gemSlots,
      gems: [...gems],
    },
  };
  rebuildRolledStats(clean);
  return clean;
}

export function createRiftGearInstance(
  eventId: string,
  tier: RiftTier,
  cls: PlayerClass,
  boundTo: number,
): { itemId: string; instance: ItemInstancePayload } {
  const shell = shellForClass(cls);
  const power = TIER_POWER[tier];
  const instance: ItemInstancePayload = {
    boundTo,
    rolled: { quality: 'epic', stats: {} },
    rift: {
      sourceEventId: eventId,
      tier,
      power,
      upgradeLevel: 0,
      maxUpgradeLevel: 5,
      baseStats: { [shell.primary]: power, [shell.secondary]: Math.max(1, Math.ceil(power / 2)) },
      gemSlots: tier === 'S' ? 2 : 1,
      gems: [],
    },
  };
  rebuildRolledStats(instance);
  return { itemId: shell.itemId, instance };
}

// Clear-time epic/legendary odds per rank. Economy rationale: these land ONLY
// on a completed final-boss kill (never a static loot table), and the cadence is
// bound by the ranked portal spawns (one every 2-4 h server-wide, 3 open at most),
// which is a HARDER gate than the per-player heroic lockout. C pays from the
// normal five-man pool; B guarantees one epic from the heroic five-man pool,
// matching the heroic floor for a rank that carries the same heroic stat transform.
// A guarantees one epic; S guarantees one with a real shot at a second, plus an
// independent chase roll for each of the two rift legendaries.
const RIFT_EPIC_CHANCE_B = 1.0; // guaranteed: B carries heroic stat transform
const RIFT_SECOND_EPIC_CHANCE_S = 0.35;
// 0.3% per S clear PER legendary, deliberately the same rate as the epic mount
// below rather than the 4% it shipped at. S clears carry no lockout on this roll,
// so 4% made a legendary a matter of a few evenings; at 0.3% each is a chase item
// on the same cadence as the rarest mount.
export const RIFT_LEGENDARY_CHANCE_S = 0.003;

// Clear-time coin bonuses by rank (added on top of the static boss coin, which
// stays rank-invariant). C mirrors the normal-dungeon economy; B tastes a small
// windfall; A matches the Korzul Heroic peak (50 000c); S holds at the same cap
// (gear quality, mounts, and legendaries differentiate it from A, not raw coin).
// Nythraxis pays 150 000c over 10 players = 15 000c per capita; S at 5 players
// and 55 000c total = 11 000c per capita, modestly below the raid benchmark, which
// is appropriate given the shorter portal format.
// Named constants so balance tuning stays in one place.
export const RIFT_COIN_BONUS_C = 10_000; // 10 000c: mirrors normal-dungeon economy
export const RIFT_COIN_BONUS_B = 10_000; // 10 000c (10 silver)
export const RIFT_COIN_BONUS_A = 35_000; // 35 000c (35 silver), matches Korzul Heroic
export const RIFT_COIN_BONUS_S = 50_000; // 50 000c; +5 000c static boss coin = 55 000c total

// The mount ladder: one rarity tier per rank, each at the rate that tier already
// earns elsewhere in the game, so a rift is never a cheaper route to a mount than
// the content the mount belongs to.
//
//   C  none          normal-mode tables shed no mounts at all (the greens were
//                    deliberately moved to heroic-only, see heroic_loot.ts), so
//                    the normal-tier rank matches that and rolls nothing.
//   B  green  0.5%   exactly HEROIC_GREEN_MOUNT_CHANCE, the five-man heroic rate.
//   A  blue   0.1%   exactly HEROIC_BLUE_MOUNT_CHANCE, the five-man heroic rate.
//   S  epic   0.3%   the top tier, and the only source of these two reins.
//
// Each rank rolls its OWN tier only: a rank does not inherit the tiers below it,
// so the ladder climbs in rarity rather than accumulating chances.

/** Green (common) mount reins, on B clears. Excludes reins_valorsteed, which is
 *  the stablemaster's purchase and has never been a drop. */
export const RIFT_GREEN_MOUNT_REINS = ['reins_grag_bear', 'reins_stalkglider_snail'] as const;
export const RIFT_GREEN_MOUNT_CHANCE = 0.005; // 0.5%, the heroic five-man green rate

/** Blue (rare) mount reins, on A clears. */
export const RIFT_BLUE_MOUNT_REINS = ['reins_aether_hover_cycle', 'reins_shadowjump_toad'] as const;
export const RIFT_BLUE_MOUNT_CHANCE = 0.001; // 0.1%, the heroic five-man blue rate

/** Epic mount reins, on S clears only. Rifts are their sole source. */
export const RIFT_EPIC_MOUNT_REINS = [
  'reins_stormfeather_griffin',
  'reins_thunderstrut_gobbler',
] as const;
export const RIFT_EPIC_MOUNT_CHANCE = 0.003; // 0.3% per S clear

/** Rank-gated gear payout on the winning clear: pushed onto the final boss's
 * corpse as PLAIN drops, so the normal party loot rules (rolls) decide who
 * takes them. Runs for every winning clear, ranked race or dev portal, with
 * the rank derived from the descriptor baseLevel.
 *
 * Draw order (APPEND-ONLY; inserting before any existing draw breaks parity):
 *   0. C: guaranteed drop from riftNormalClearPool() (rng.int pick)
 *   1. B: guaranteed epic from riftHeroicClearPool() (RIFT_EPIC_CHANCE_B = 1.0,
 *         the chance() call is kept so the draw survives)
 *   2. A/S: guaranteed first heroic epic (rng.int pick)
 *   3. S: optional second heroic epic (RIFT_SECOND_EPIC_CHANCE_S)
 *   4. S: one independent legendary roll PER id in RIFT_LEGENDARY_ITEM_IDS,
 *         in array order (RIFT_LEGENDARY_CHANCE_S each)
 *   5. B/A/S: exactly one mount roll, for the rank's own tier only
 *         (green/blue/epic chance + rng.int pick)
 *
 * B/A/S draws are unaffected by the new C draw (C returns after draw 0).
 */
export function addRiftClearGearLoot(ctx: SimContext, boss: Entity, baseLevel: number): void {
  const rank = riftRankForBaseLevel(baseLevel);
  const loot = boss.loot ?? { copper: 0, items: [] };

  // --- Draw 0: C-rank guaranteed normal-dungeon drop + coin (exits here) ---
  if (rank === 'C') {
    const pool = riftNormalClearPool();
    loot.items.push({ itemId: pool[ctx.rng.int(0, pool.length - 1)], count: 1 });
    loot.copper = (loot.copper ?? 0) + RIFT_COIN_BONUS_C;
    boss.loot = loot;
    boss.lootable = true;
    return;
  }

  const heroicPool = riftHeroicClearPool();
  const epic = (): string => heroicPool[ctx.rng.int(0, heroicPool.length - 1)];

  // --- Draws 1-4: clear-time gear (existing order preserved for parity) ---
  if (rank === 'B') {
    if (ctx.rng.chance(RIFT_EPIC_CHANCE_B)) loot.items.push({ itemId: epic(), count: 1 });
  } else {
    loot.items.push({ itemId: epic(), count: 1 });
    if (rank === 'S') {
      if (ctx.rng.chance(RIFT_SECOND_EPIC_CHANCE_S)) {
        loot.items.push({ itemId: epic(), count: 1 });
      }
      // One INDEPENDENT roll per legendary, not a pick from a pool: an S clear
      // that beats both rolls sheds both, which is the point of a chase tier.
      for (const legendaryId of RIFT_LEGENDARY_ITEM_IDS) {
        if (ctx.rng.chance(RIFT_LEGENDARY_CHANCE_S)) {
          loot.items.push({ itemId: legendaryId, count: 1 });
        }
      }
    }
  }

  // --- Draw 5: the mount ladder, one tier per rank (see the constants above) ---
  // Ranks do not inherit each other's tiers, so exactly one mount roll happens
  // per clear (none at C), and it is always for the tier that rank earns.
  const mount =
    rank === 'B'
      ? { reins: RIFT_GREEN_MOUNT_REINS, chance: RIFT_GREEN_MOUNT_CHANCE }
      : rank === 'A'
        ? { reins: RIFT_BLUE_MOUNT_REINS, chance: RIFT_BLUE_MOUNT_CHANCE }
        : { reins: RIFT_EPIC_MOUNT_REINS, chance: RIFT_EPIC_MOUNT_CHANCE };
  if (ctx.rng.chance(mount.chance)) {
    loot.items.push({
      itemId: mount.reins[ctx.rng.int(0, mount.reins.length - 1)],
      count: 1,
    });
  }

  // --- Rank coin bonus (no rng; purely additive to the static boss coin) ---
  const coinBonus =
    rank === 'B' ? RIFT_COIN_BONUS_B : rank === 'A' ? RIFT_COIN_BONUS_A : RIFT_COIN_BONUS_S;
  loot.copper = (loot.copper ?? 0) + coinBonus;

  boss.loot = loot;
  if (loot.items.length > 0 || loot.copper > 0) boss.lootable = true;
}

/** First-clear personal loot. Every winner gets a class-appropriate non-fungible
 * ring, Rift Essence, and an A/S gem; all remain on the corpse until looted. */
export function addRiftProgressionLoot(
  ctx: SimContext,
  boss: Entity,
  eventId: string,
  tier: RiftTier,
  participants: readonly number[],
  lootMultiplier = 1,
  craftingMaterialBias = 0.25,
): void {
  const loot = boss.loot ?? { copper: 0, items: [] };
  loot.copper = Math.round(loot.copper * Math.max(0.5, Math.min(2, lootMultiplier)));
  const essenceCount = Math.max(
    1,
    Math.min(8, Math.round(TIER_POWER[tier] * Math.max(0.5, Math.min(2, lootMultiplier)))),
  );
  for (let i = 0; i < participants.length; i++) {
    const pid = participants[i];
    const meta = ctx.players.get(pid);
    if (!meta) continue;
    const gear = createRiftGearInstance(eventId, tier, meta.cls, pid);
    loot.items.push({
      itemId: gear.itemId,
      count: 1,
      instance: gear.instance,
      personalFor: [pid],
    });
    for (let essence = 0; essence < essenceCount; essence++) {
      loot.items.push({
        itemId: RIFT_ESSENCE_ITEM_ID,
        count: 1,
        personalFor: [pid],
      });
    }
    if (tier === 'A' || tier === 'S' || craftingMaterialBias >= 0.5) {
      loot.items.push({
        itemId: RIFT_GEM_IDS[i % RIFT_GEM_IDS.length],
        count: 1,
        personalFor: [pid],
      });
    }
  }
  boss.loot = loot;
  boss.lootable = true;
}

function riftInventorySlot(meta: PlayerMeta, itemId: string) {
  for (let i = meta.inventory.length - 1; i >= 0; i--) {
    const slot = meta.inventory[i];
    if (slot.itemId === itemId && slot.instance?.rift) return slot;
  }
  return null;
}

function emitResult(ctx: SimContext, pid: number, result: RiftForgeResult): RiftForgeResult {
  ctx.emit({ type: 'riftForgeResult', pid, ...result });
  if (result.ok) {
    const name = ITEMS[result.itemId]?.name ?? result.itemId;
    const line =
      result.action === 'upgrade'
        ? `Rift upgrade completed for ${name}.`
        : result.action === 'enchant'
          ? `Rift enchant completed for ${name}.`
          : `Rift gem socketed for ${name}.`;
    ctx.emit({
      type: 'log',
      text: line,
      color: '#c9f',
      pid,
    });
  }
  return result;
}

export function upgradeRiftItem(ctx: SimContext, itemId: string, pid?: number): RiftForgeResult {
  const r = ctx.resolve(pid);
  if (!r) return { ok: false, action: 'upgrade', itemId, reason: 'not_found' };
  const slot = riftInventorySlot(r.meta, itemId);
  if (!slot?.instance?.rift) {
    return emitResult(ctx, r.meta.entityId, {
      ok: false,
      action: 'upgrade',
      itemId,
      reason: 'not_rift_gear',
    });
  }
  const gear = slot.instance.rift;
  if (gear.upgradeLevel >= gear.maxUpgradeLevel) {
    return emitResult(ctx, r.meta.entityId, {
      ok: false,
      action: 'upgrade',
      itemId,
      reason: 'max_upgrade',
    });
  }
  const cost = 2 + gear.upgradeLevel * 2;
  if (ctx.countItem(RIFT_ESSENCE_ITEM_ID, r.meta.entityId) < cost) {
    return emitResult(ctx, r.meta.entityId, {
      ok: false,
      action: 'upgrade',
      itemId,
      reason: 'insufficient_essence',
    });
  }
  ctx.removeItem(RIFT_ESSENCE_ITEM_ID, cost, r.meta.entityId);
  gear.upgradeLevel += 1;
  rebuildRolledStats(slot.instance);
  r.meta.wireRev++;
  return emitResult(ctx, r.meta.entityId, {
    ok: true,
    action: 'upgrade',
    itemId,
    upgradeLevel: gear.upgradeLevel,
    essenceSpent: cost,
  });
}

export function enchantRiftItem(
  ctx: SimContext,
  itemId: string,
  stat: string,
  pid?: number,
): RiftForgeResult {
  const r = ctx.resolve(pid);
  if (!r) return { ok: false, action: 'enchant', itemId, reason: 'not_found' };
  const slot = riftInventorySlot(r.meta, itemId);
  if (!slot?.instance?.rift) {
    return emitResult(ctx, r.meta.entityId, {
      ok: false,
      action: 'enchant',
      itemId,
      reason: 'not_rift_gear',
    });
  }
  if (!(RIFT_ENCHANT_STATS as readonly string[]).includes(stat)) {
    return emitResult(ctx, r.meta.entityId, {
      ok: false,
      action: 'enchant',
      itemId,
      reason: 'invalid_stat',
    });
  }
  const cost = 4;
  if (ctx.countItem(RIFT_ESSENCE_ITEM_ID, r.meta.entityId) < cost) {
    return emitResult(ctx, r.meta.entityId, {
      ok: false,
      action: 'enchant',
      itemId,
      reason: 'insufficient_essence',
    });
  }
  ctx.removeItem(RIFT_ESSENCE_ITEM_ID, cost, r.meta.entityId);
  slot.instance.rift.enchant = {
    stat,
    value: Math.max(1, Math.ceil(slot.instance.rift.power / 2)),
  };
  rebuildRolledStats(slot.instance);
  r.meta.wireRev++;
  return emitResult(ctx, r.meta.entityId, {
    ok: true,
    action: 'enchant',
    itemId,
    essenceSpent: cost,
  });
}

export function socketRiftGem(
  ctx: SimContext,
  itemId: string,
  gemId: string,
  pid?: number,
): RiftForgeResult {
  const r = ctx.resolve(pid);
  if (!r) return { ok: false, action: 'socket', itemId, reason: 'not_found' };
  const slot = riftInventorySlot(r.meta, itemId);
  if (!slot?.instance?.rift) {
    return emitResult(ctx, r.meta.entityId, {
      ok: false,
      action: 'socket',
      itemId,
      reason: 'not_rift_gear',
    });
  }
  if (
    !(RIFT_GEM_IDS as readonly string[]).includes(gemId) ||
    ctx.countItem(gemId, r.meta.entityId) < 1
  ) {
    return emitResult(ctx, r.meta.entityId, {
      ok: false,
      action: 'socket',
      itemId,
      reason: 'invalid_gem',
    });
  }
  if (slot.instance.rift.gems.length >= slot.instance.rift.gemSlots) {
    return emitResult(ctx, r.meta.entityId, {
      ok: false,
      action: 'socket',
      itemId,
      reason: 'sockets_full',
    });
  }
  ctx.removeItem(gemId, 1, r.meta.entityId);
  slot.instance.rift.gems.push(gemId as RiftGemId);
  rebuildRolledStats(slot.instance);
  r.meta.wireRev++;
  return emitResult(ctx, r.meta.entityId, { ok: true, action: 'socket', itemId });
}

export function riftSalvageYield(instance: ItemInstancePayload): number {
  const gear = instance.rift;
  return gear ? Math.max(2, Math.min(20, gear.power * 2 + gear.upgradeLevel * 2)) : 0;
}
