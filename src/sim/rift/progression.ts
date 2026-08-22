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
import { refusedWhileDead } from '../dead_gate';
import { selectedInventorySlot } from '../item_copy_ref';
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
    | 'sockets_full'
    // The while-dead refusal (dead_gate.ts): returned to callers (tests and
    // the offline probes) but NEVER emitted as a riftForgeResult event; the
    // shared "You can't do that while dead." error line is its only
    // player-facing surface, like the unresolvable-player arm above it.
    | 'dead';
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

/** Uncommon ("green") mount reins, on B clears. Excludes reins_valorsteed, which
 *  is the stablemaster's purchase and has never been a drop. */
export const RIFT_GREEN_MOUNT_REINS = [
  'reins_stormfeather_griffin',
  'reins_shadowjump_toad',
] as const;
export const RIFT_GREEN_MOUNT_CHANCE = 0.005; // 0.5%, the heroic five-man green rate

/** Rare ("blue") mount reins, on A clears. */
export const RIFT_BLUE_MOUNT_REINS = ['reins_grag_bear', 'reins_stalkglider_snail'] as const;
export const RIFT_BLUE_MOUNT_CHANCE = 0.001; // 0.1%, the heroic five-man blue rate

/** Epic mount reins, on S clears only. Rifts are their sole source. */
export const RIFT_EPIC_MOUNT_REINS = [
  'reins_aether_hover_cycle',
  'reins_thunderstrut_gobbler',
] as const;
export const RIFT_EPIC_MOUNT_CHANCE = 0.003; // 0.3% per S clear

/** Masterwrought apex ARMOR patterns (Phase 11, R8 channel doctrine): the rift
 *  pillar carries the ten armorcrafting/leatherworking/tailoring patterns
 *  (content/apex_patterns.ts) as the final appended draw on every winning
 *  B/A/S clear. SORTED, and exported for tests: the rng.int pick below indexes
 *  it, so the order is part of the draw contract. */
export const RIFT_PATTERN_ITEM_IDS = [
  'pattern_barksong_handguards',
  'pattern_briarstep_jerkin',
  'pattern_fenbloom_breeches',
  'pattern_forgefold_legguards',
  'pattern_spiritweld_girdle',
  'pattern_sunspun_handwraps',
  'pattern_sunspun_haversack',
  'pattern_sunspun_leggings',
  'pattern_sunspun_vestments',
  'pattern_wardspeaker_sabatons',
] as const;
export const RIFT_PATTERN_CHANCE = 0.08; // one draw per winning B/A/S clear

/** Farming's RIFT channel (masterwrought Phase 11f, R8): the three rung-100
 *  farm patterns the raid does not carry, plus every tier-3 and tier-4 seed, as
 *  the appended draw AFTER the apex-pattern roll on winning B/A/S clears.
 *
 *  SORTED, and exported for tests, for exactly the reason RIFT_PATTERN_ITEM_IDS
 *  above is: the rng.int pick below indexes this array, so its ORDER is part of
 *  the draw contract and a re-sort is a determinism change, not a tidy-up.
 *
 *  One list rather than two (patterns and seeds) because it must cost ONE
 *  appended draw, not two: a rift clear either sheds a farming reward or it does
 *  not, and which kind it is comes out of the same pick. That also keeps the
 *  repeatable pillar from becoming the fastest route to a pattern, since a
 *  pattern is 3 of the 11 slots behind an 8% gate. */
export const FARM_RIFT_DROP_ITEM_IDS = [
  'evergarden_greens_seed',
  'evergarden_pumpkin_seed',
  'frost_gourd_seed',
  'frost_lentils_seed',
  'gilded_sunmelon_seed',
  'gilded_yam_seed',
  'highland_barley_seed',
  'pattern_evergarden_braised_greens',
  'pattern_evergarden_harvest_platter',
  'pattern_evergarden_sunmelon_tart',
  'thornpeak_cabbage_seed',
] as const;
/** The SHIPPED rift pattern rate, reused rather than re-derived: farming's
 *  appended draw is the same 8% gate the apex patterns ride. */
export const FARM_RIFT_DROP_CHANCE = RIFT_PATTERN_CHANCE;

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
 *   6. B/A/S: one apex-pattern roll (RIFT_PATTERN_CHANCE, then an rng.int
 *         pick over the sorted RIFT_PATTERN_ITEM_IDS). C never reaches this
 *         draw BY DESIGN: the C arm returns after draw 0, so the pattern
 *         channel stays a winning ranked-clear reward (the R8 channel split).
 *   7. B/A/S: one FARMING roll (FARM_RIFT_DROP_CHANCE, then an rng.int pick
 *         over the sorted FARM_RIFT_DROP_ITEM_IDS: three rung-100 farm
 *         patterns plus every tier-3 and tier-4 seed). Appended by
 *         masterwrought Phase 11f under the same append-only rule, and C
 *         never reaches it either.
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

  // --- Draw 6: the apex armor pattern roll (see RIFT_PATTERN_ITEM_IDS) ---
  // Appended AFTER the mount roll so every existing draw keeps its stream
  // position; a plain tradable drop like the draws above, so party loot rules
  // decide who takes it.
  if (ctx.rng.chance(RIFT_PATTERN_CHANCE)) {
    loot.items.push({
      itemId: RIFT_PATTERN_ITEM_IDS[ctx.rng.int(0, RIFT_PATTERN_ITEM_IDS.length - 1)],
      count: 1,
    });
  }

  // --- Draw 7: the farming roll (see FARM_RIFT_DROP_ITEM_IDS) ---
  // Appended AFTER draw 6 for the same reason draw 6 sits after the mount roll:
  // every existing draw keeps its stream position, and only the goldens that
  // reach this far move. C never arrives here, since its arm returned after
  // draw 0, which is the same designed split the pattern channel already has.
  if (ctx.rng.chance(FARM_RIFT_DROP_CHANCE)) {
    loot.items.push({
      itemId: FARM_RIFT_DROP_ITEM_IDS[ctx.rng.int(0, FARM_RIFT_DROP_ITEM_IDS.length - 1)],
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

/** The forge's target copy. One choke point for all three actions (upgrade,
 *  enchant, socket), so the selection is threaded once here.
 *
 *  A named slot must still BE a rift piece: the index says which copy, never
 *  what it is, so a selection pointing at a plain copy refuses like any other
 *  ineligible target rather than sliding onto a different one. Without a
 *  selection this stays the legacy newest-rift-copy walk. */
function riftInventorySlot(meta: PlayerMeta, itemId: string, slotIndex?: number) {
  if (slotIndex !== undefined) {
    const named = selectedInventorySlot(meta.inventory, itemId, slotIndex);
    if (!named?.instance?.rift) return null;
    return named;
  }
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

export function upgradeRiftItem(
  ctx: SimContext,
  itemId: string,
  pid?: number,
  slotIndex?: number,
): RiftForgeResult {
  // Dead gate, matching the profession-action family (dead_gate.ts): the
  // refusal emits no riftForgeResult, only the shared error line.
  if (refusedWhileDead(ctx, pid)) return { ok: false, action: 'upgrade', itemId, reason: 'dead' };
  const r = ctx.resolve(pid);
  if (!r) return { ok: false, action: 'upgrade', itemId, reason: 'not_found' };
  const slot = riftInventorySlot(r.meta, itemId, slotIndex);
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
  slotIndex?: number,
): RiftForgeResult {
  // Same dead gate as upgradeRiftItem, for the same single-surface reason.
  if (refusedWhileDead(ctx, pid)) return { ok: false, action: 'enchant', itemId, reason: 'dead' };
  const r = ctx.resolve(pid);
  if (!r) return { ok: false, action: 'enchant', itemId, reason: 'not_found' };
  const slot = riftInventorySlot(r.meta, itemId, slotIndex);
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
  slotIndex?: number,
): RiftForgeResult {
  // Same dead gate as upgradeRiftItem, for the same single-surface reason.
  if (refusedWhileDead(ctx, pid)) return { ok: false, action: 'socket', itemId, reason: 'dead' };
  const r = ctx.resolve(pid);
  if (!r) return { ok: false, action: 'socket', itemId, reason: 'not_found' };
  const slot = riftInventorySlot(r.meta, itemId, slotIndex);
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
