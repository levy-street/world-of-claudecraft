// Pack-ripping catalog and the pure gacha engine over it. A pack is bought by
// burning $WOC; ripping it reveals `rolls` weighted rewards drawn from the
// pack's table, filtered by the realm's pay-to-win policy (PACK_POWER_POLICY)
// and shaped by a pity guarantee. The catalog is server-side economy content
// (the deterministic sim never reads it; it only grants the item/augment ids a
// roll produces), so this lives in server/ and stays a pure function of its
// inputs for full unit-testability.
//
// Rewards reference REAL content by id: gear/consumable/cosmetic refs are keys
// of the sim ITEMS table, buff refs are augment ids. validatePackCatalog (run in
// the test against the live registries) enforces that every ref exists and that
// each reward's declared rarity matches the item's actual quality, so the
// catalog can never drift into referencing content that is not there.
import { PackPowerPolicy, policyPermits } from './engagement_config';

/** Item rarity bands, mirroring ItemDef['quality'] in src/sim/types.ts. */
export type ItemQuality = 'poor' | 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export const RARITY_RANK: Readonly<Record<ItemQuality, number>> = {
  poor: 0,
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
  legendary: 5,
};

/**
 * gear      -> an equippable ITEMS id (persistent power; gated by policy).
 * consumable-> a usable ITEMS id (potion/elixir/food/drink).
 * buff      -> an augment id, applied only in opt-in PvP modes (never the world).
 * cosmetic  -> a cosmetic ITEMS id (transmog token etc.; no gameplay power).
 */
export type RewardKind = 'gear' | 'consumable' | 'buff' | 'cosmetic';

export interface PackReward {
  kind: RewardKind;
  /** ITEMS id (gear/consumable/cosmetic) or augment id (buff). */
  ref: string;
  /** Stack size granted (1 for gear/buff/cosmetic; >= 1 for consumables). */
  qty: number;
  /** The minimum realm policy under which this reward may be granted. */
  minPolicy: PackPowerPolicy;
}

export interface WeightedReward {
  reward: PackReward;
  /** Display + pity rarity. For item-backed rewards this must equal ITEMS[ref].quality. */
  rarity: ItemQuality;
  /** Relative selection weight within the pack (> 0). */
  weight: number;
}

export interface PityConfig {
  /** Guarantee at least one reward of this rarity (or higher) ... */
  rarity: ItemQuality;
  /** ... within this many consecutive opens of the pack. */
  within: number;
}

export interface PackDef {
  id: string;
  /** English; re-localized at the client boundary by key. */
  name: string;
  /** Burn price in whole $WOC. */
  priceWoc: number;
  /** Rewards revealed per rip. */
  rolls: number;
  table: WeightedReward[];
  pity?: PityConfig;
}

export interface RolledReward {
  reward: PackReward;
  rarity: ItemQuality;
  /** True when this slot was forced by the pity guarantee rather than rolled. */
  pity: boolean;
}

export interface PackRollResult {
  rewards: RolledReward[];
  /** Opens since the last pity-rarity hit, after this open (feeds the next roll). */
  opensSincePityAfter: number;
}

// Augment tiers map to display rarities so a pulled buff still reads as a chase.
const SILVER: ItemQuality = 'uncommon';
const GOLD: ItemQuality = 'rare';
const PRISMATIC: ItemQuality = 'epic';

const buff = (ref: string, rarity: ItemQuality, weight: number): WeightedReward => ({
  reward: { kind: 'buff', ref, qty: 1, minPolicy: 'cosmetic' },
  rarity,
  weight,
});
const food = (ref: string, rarity: ItemQuality, weight: number, qty = 1): WeightedReward => ({
  reward: { kind: 'consumable', ref, qty, minPolicy: 'cosmetic' },
  rarity,
  weight,
});
const potion = (ref: string, rarity: ItemQuality, weight: number, qty = 1): WeightedReward => ({
  reward: { kind: 'consumable', ref, qty, minPolicy: 'seasonal' },
  rarity,
  weight,
});
const elixir = (ref: string, rarity: ItemQuality, weight: number, qty = 1): WeightedReward => ({
  reward: { kind: 'consumable', ref, qty, minPolicy: 'open' },
  rarity,
  weight,
});
const lateralGear = (ref: string, rarity: ItemQuality, weight: number): WeightedReward => ({
  reward: { kind: 'gear', ref, qty: 1, minPolicy: 'cosmetic' },
  rarity,
  weight,
});
const verticalGear = (ref: string, rarity: ItemQuality, weight: number, minPolicy: PackPowerPolicy): WeightedReward => ({
  reward: { kind: 'gear', ref, qty: 1, minPolicy },
  rarity,
  weight,
});
const cosmetic = (ref: string, rarity: ItemQuality, weight: number): WeightedReward => ({
  reward: { kind: 'cosmetic', ref, qty: 1, minPolicy: 'cosmetic' },
  rarity,
  weight,
});

/**
 * The default catalog. Three escalating packs, all priced in $WOC to burn. Each
 * table spans the three policy bands so the realm's PACK_POWER_POLICY visibly
 * changes what can drop:
 *   cosmetic -> mode-scoped augment buffs, out-of-combat food/drink, lateral
 *               common gear, the epic cosmetic token.
 *   seasonal -> uncommon vertical gear + basic combat potions.
 *   open     -> rare vertical gear + the strongest combat elixir.
 */
export const PACK_CATALOG: readonly PackDef[] = [
  {
    id: 'common_cache',
    name: 'Common Cache',
    priceWoc: 250,
    rolls: 2,
    pity: { rarity: 'uncommon', within: 5 },
    table: [
      food('baked_bread', 'common', 220, 2),
      food('spring_water', 'common', 220, 2),
      lateralGear('worn_sword', 'common', 150),
      lateralGear('recruit_tunic', 'common', 150),
      buff('aug_brutality', SILVER, 90),
      buff('aug_toughness', SILVER, 90),
      potion('minor_healing_potion', 'common', 70, 3),
      verticalGear('redbrook_blade', 'uncommon', 10, 'seasonal'),
    ],
  },
  {
    id: 'rare_cache',
    name: 'Rare Cache',
    priceWoc: 1000,
    rolls: 3,
    pity: { rarity: 'rare', within: 4 },
    table: [
      food('baked_bread', 'common', 120, 3),
      buff('aug_brutality', SILVER, 120),
      buff('aug_warlords_might', GOLD, 90),
      buff('aug_vampirism', GOLD, 90),
      potion('healing_potion', 'common', 110, 3),
      potion('mana_potion', 'common', 110, 3),
      verticalGear('keen_dirk', 'uncommon', 100, 'seasonal'),
      verticalGear('redbrook_blade', 'uncommon', 100, 'seasonal'),
      verticalGear('boundstone_helm', 'rare', 30, 'open'),
      elixir('elixir_of_the_bear', 'uncommon', 30, 2),
    ],
  },
  {
    id: 'prismatic_cache',
    name: 'Prismatic Cache',
    priceWoc: 5000,
    rolls: 3,
    pity: { rarity: 'epic', within: 3 },
    table: [
      buff('aug_warlords_might', GOLD, 140),
      buff('aug_vampirism', GOLD, 140),
      buff('aug_apex_predator', PRISMATIC, 60),
      buff('aug_archmage', PRISMATIC, 60),
      potion('healing_potion', 'common', 120, 5),
      verticalGear('keen_dirk', 'uncommon', 110, 'seasonal'),
      verticalGear('boundstone_helm', 'rare', 70, 'open'),
      verticalGear('gravewyrm_mantle', 'rare', 70, 'open'),
      verticalGear('valeborn_spellblade', 'rare', 70, 'open'),
      elixir('elixir_of_the_bear', 'uncommon', 60, 3),
      cosmetic('event_skin_token', 'epic', 20),
    ],
  },
] as const;

export const PACKS_BY_ID: Readonly<Record<string, PackDef>> = Object.fromEntries(
  PACK_CATALOG.map((p) => [p.id, p]),
);

/** The rewards in `table` grantable under `policy` (the realm filter). */
export function eligibleRewards(table: readonly WeightedReward[], policy: PackPowerPolicy): WeightedReward[] {
  return table.filter((w) => policyPermits(policy, w.reward.minPolicy));
}

/** Cumulative-weight selection from a non-empty entry list using a unit in [0,1). */
export function pickByWeight(entries: readonly WeightedReward[], unit: number): WeightedReward {
  if (entries.length === 0) throw new Error('pickByWeight: no entries');
  let total = 0;
  for (const e of entries) total += e.weight;
  const u = unit <= 0 ? 0 : unit >= 1 ? 0.9999999999999999 : unit;
  let threshold = u * total;
  for (const e of entries) {
    threshold -= e.weight;
    if (threshold < 0) return e;
  }
  return entries[entries.length - 1];
}

/**
 * Normalized drop odds for `pack` under `policy`, summing to 1 across the eligible
 * rewards. Drives the published provable-odds disclosure. Returns [] if the realm
 * policy filters every reward out (a misconfiguration the validator forbids).
 */
export function oddsForPolicy(pack: PackDef, policy: PackPowerPolicy): Array<{ reward: PackReward; rarity: ItemQuality; probability: number }> {
  const eligible = eligibleRewards(pack.table, policy);
  let total = 0;
  for (const e of eligible) total += e.weight;
  if (total <= 0) return [];
  return eligible.map((e) => ({ reward: e.reward, rarity: e.rarity, probability: e.weight / total }));
}

/**
 * Rip one pack. `units` are server-derived uniforms in [0,1) (one per roll plus
 * one for a possible pity pick); `opensSincePity` is this account's running count
 * for this pack. Applies the policy filter, then the pity guarantee: if no roll
 * reached the pity rarity and the streak hit `pity.within`, the lowest-rarity
 * slot is replaced with a guaranteed pity-or-higher reward. The counter resets on
 * any pity-rarity hit (rolled or guaranteed) and otherwise increments. Throws on
 * a structurally impossible request (no eligible rewards, too few units) because
 * those are configuration bugs, not runtime conditions to paper over.
 */
export function rollPack(
  pack: PackDef,
  policy: PackPowerPolicy,
  units: readonly number[],
  opensSincePity: number,
): PackRollResult {
  const eligible = eligibleRewards(pack.table, policy);
  if (eligible.length === 0) throw new Error(`rollPack: no eligible rewards for ${pack.id} under ${policy}`);
  if (units.length < pack.rolls) throw new Error(`rollPack: ${pack.id} needs ${pack.rolls} units, got ${units.length}`);

  const rewards: RolledReward[] = [];
  for (let i = 0; i < pack.rolls; i++) {
    const w = pickByWeight(eligible, units[i]);
    rewards.push({ reward: w.reward, rarity: w.rarity, pity: false });
  }

  let opens = opensSincePity + 1;
  const pity = pack.pity;
  if (pity) {
    const target = RARITY_RANK[pity.rarity];
    const hit = rewards.some((r) => RARITY_RANK[r.rarity] >= target);
    if (hit) {
      opens = 0;
    } else if (opens >= pity.within) {
      const pityPool = eligible.filter((w) => RARITY_RANK[w.rarity] >= target);
      // A strict realm may filter every pity-rarity reward out; then the guarantee
      // simply cannot apply and the streak keeps counting (harmless: it never fires).
      if (pityPool.length > 0) {
        const guaranteed = pickByWeight(pityPool, units[Math.min(pack.rolls, units.length - 1)]);
        let lowIdx = 0;
        for (let i = 1; i < rewards.length; i++) {
          if (RARITY_RANK[rewards[i].rarity] < RARITY_RANK[rewards[lowIdx].rarity]) lowIdx = i;
        }
        rewards[lowIdx] = { reward: guaranteed.reward, rarity: guaranteed.rarity, pity: true };
        opens = 0;
      }
    }
  }
  return { rewards, opensSincePityAfter: opens };
}

export interface PackValidation {
  ok: boolean;
  errors: string[];
}

/**
 * Referential + structural integrity for a catalog, checked against the live
 * registries. `itemQuality(ref)` returns the quality of an ITEMS entry or
 * undefined if absent; `augmentIds` is the set of valid augment ids. Enforces:
 * unique pack ids, positive integer price, >= 1 roll, non-empty table, positive
 * weights, every ref resolvable in the right registry, declared rarity equal to
 * the item's real quality for item-backed rewards, and a sane pity config.
 */
export function validatePackCatalog(
  packs: readonly PackDef[],
  itemQuality: (ref: string) => ItemQuality | undefined,
  augmentIds: ReadonlySet<string>,
): PackValidation {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const pack of packs) {
    if (seen.has(pack.id)) errors.push(`duplicate pack id: ${pack.id}`);
    seen.add(pack.id);
    if (!Number.isInteger(pack.priceWoc) || pack.priceWoc <= 0) errors.push(`${pack.id}: bad priceWoc ${pack.priceWoc}`);
    if (!Number.isInteger(pack.rolls) || pack.rolls < 1) errors.push(`${pack.id}: bad rolls ${pack.rolls}`);
    if (pack.table.length === 0) errors.push(`${pack.id}: empty table`);
    for (const w of pack.table) {
      const { kind, ref } = w.reward;
      if (!Number.isFinite(w.weight) || w.weight <= 0) errors.push(`${pack.id}/${ref}: bad weight ${w.weight}`);
      if (!(w.rarity in RARITY_RANK)) errors.push(`${pack.id}/${ref}: bad rarity ${w.rarity}`);
      if (w.reward.qty < 1 || !Number.isInteger(w.reward.qty)) errors.push(`${pack.id}/${ref}: bad qty ${w.reward.qty}`);
      if (kind === 'buff') {
        if (!augmentIds.has(ref)) errors.push(`${pack.id}: unknown augment ref ${ref}`);
      } else {
        const q = itemQuality(ref);
        if (q === undefined) errors.push(`${pack.id}: unknown item ref ${ref}`);
        else if (q !== w.rarity) errors.push(`${pack.id}/${ref}: rarity ${w.rarity} != item quality ${q}`);
      }
    }
    if (pack.pity) {
      if (!(pack.pity.rarity in RARITY_RANK)) errors.push(`${pack.id}: bad pity rarity ${pack.pity.rarity}`);
      if (!Number.isInteger(pack.pity.within) || pack.pity.within < 1) errors.push(`${pack.id}: bad pity.within ${pack.pity.within}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
