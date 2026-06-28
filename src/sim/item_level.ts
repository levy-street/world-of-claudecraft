// Item level: a single "how powerful is this drop" number derived from WHERE an
// item comes from (the level of the mob that drops it, or the boss a quest-reward
// is gated behind) plus a rarity bump, and the stat budget that an item of that
// level + quality + slot is expected to carry.
//
// This is a pure, host-agnostic leaf (no DOM, no rng, no Sim state): it reads only
// the static content tables and does arithmetic, so the HUD imports it directly the
// same way it already consumes other pure sim leaves (data, world, equipment_rules,
// lockpick). The architecture purity gate (tests/architecture.test.ts) keeps it
// host-agnostic. Keeping the formula on the sim side gives one source of truth;
// tests import it directly.
//
// Two distinct outputs:
//   - itemLevel(item): the tier number shown in the tooltip ("Item Level 10").
//   - primaryStatBudget(...): the total primary-stat points an item of that tier
//     SHOULD grant. normalizePrimaryStats() distributes that budget back across an
//     item's existing stats so two drops from the same place carry the same total
//     power while keeping their own stat identity (a warrior plate piece stays
//     str/sta, a mage cloth piece stays int/spi). itemScore() is the realized
//     power (stats + armor + weapon dps) for at-a-glance comparison.
import { MOBS, QUESTS } from './data';
import type { EquipSlot, ItemDef, Stats } from './types';

// The five primary attributes an item can carry (armor is handled separately: it
// is an armor-class/slot property, not part of the comparable stat budget).
export const PRIMARY_STATS = ['str', 'agi', 'sta', 'int', 'spi'] as const;
export type PrimaryStat = (typeof PRIMARY_STATS)[number];

// A rarer item "punches above" the level of the content that drops it. Grounded in
// the classic convention that a blue from a level-N pull outclasses a green from
// the same pull; the exact bumps are tuned to this game's level-20 cap.
export const QUALITY_ILVL_BONUS: Record<string, number> = {
  poor: 0,
  common: 0,
  uncommon: 1,
  rare: 3,
  epic: 6,
  legendary: 10,
};

// Share of a level's stat budget that each quality grants. Whites/greys carry no
// primary stats (armor only), greens roughly half, blues most, purples/oranges the
// full ladder, mirroring the existing hand-authored content (uncommon mid pieces
// ~2-4 pts, class-neutral rares ~5-7 pts; cf. the items.ts budget comment).
export const QUALITY_STAT_MULT: Record<string, number> = {
  poor: 0,
  common: 0,
  uncommon: 0.55,
  rare: 0.8,
  epic: 1.0,
  legendary: 1.2,
};

// Slot weight for the stat budget: chest and main-hand carry the most, the smaller
// slots less. Matches the slot weighting already described for armor in items.ts
// (head ~1.0, shoulder ~0.75, gloves ~0.65, waist ~0.55) applied to stat points.
export const SLOT_STAT_MULT: Record<EquipSlot, number> = {
  mainhand: 1.0,
  chest: 1.0,
  legs: 0.9,
  helmet: 0.85,
  shoulder: 0.75,
  waist: 0.7,
  gloves: 0.7,
  feet: 0.65,
};

// Primary-stat points granted per item level at full (rare-mult x chest-mult = 1).
export const STAT_PER_ILVL = 0.7;

// itemScore weights: how many armor points and how much weapon DPS count as one
// primary-stat point, so a single comparable number can span gear types.
export const ARMOR_PER_POINT = 12;
export const WEAPON_DPS_WEIGHT = 0.5;

// itemId -> the level the item drops at: the top of the dropping mob's band, or the
// hardest boss a quest-reward is gated behind. Built once, lazily, from the static
// tables (so data.ts is fully initialized first) and memoized. Deterministic: pure
// function of the content tables, no rng, no clock.
let sourceIndex: Map<string, number> | null = null;

function buildSourceIndex(): Map<string, number> {
  const idx = new Map<string, number>();
  const bump = (itemId: string | undefined, level: number | undefined): void => {
    if (!itemId || level === undefined) return;
    const prev = idx.get(itemId);
    if (prev === undefined || level > prev) idx.set(itemId, level);
  };
  // Mob loot: an item is "current" at the top of the dropping mob's level band.
  for (const mob of Object.values(MOBS)) {
    if (!mob.loot) continue;
    for (const entry of mob.loot) bump(entry.itemId, mob.maxLevel);
  }
  // Quest rewards: gated behind the quest's hardest kill objective (the boss you
  // had to beat for it), falling back to the quest's own minLevel.
  for (const quest of Object.values(QUESTS)) {
    const killLevels = quest.objectives
      .map((o) => (o.type === 'kill' && o.targetMobId ? MOBS[o.targetMobId]?.maxLevel : undefined))
      .filter((n): n is number => typeof n === 'number');
    const level = killLevels.length ? Math.max(...killLevels) : quest.minLevel;
    for (const itemId of Object.values(quest.itemRewards)) bump(itemId, level);
  }
  return idx;
}

function sourceIndexOf(): Map<string, number> {
  if (!sourceIndex) sourceIndex = buildSourceIndex();
  return sourceIndex;
}

// The level of the content an item drops from, or undefined for items with no
// drop/quest source (vendor stock, starter gear, junk, conjured/quest items).
export function itemSourceLevel(itemId: string): number | undefined {
  return sourceIndexOf().get(itemId);
}

// The item level (tier number) shown in the tooltip, or undefined when there is no
// derivable source (so the UI simply omits the line for sourceless items).
export function itemLevel(item: ItemDef): number | undefined {
  const src = itemSourceLevel(item.id);
  if (src === undefined) return undefined;
  const bonus = QUALITY_ILVL_BONUS[item.quality ?? 'common'] ?? 0;
  return Math.max(1, src + bonus);
}

// The total primary-stat points an item of this level + quality + slot should grant.
export function primaryStatBudget(
  level: number,
  quality: ItemDef['quality'],
  slot: EquipSlot | undefined,
): number {
  if (!slot) return 0;
  const q = QUALITY_STAT_MULT[quality ?? 'common'] ?? 0;
  const s = SLOT_STAT_MULT[slot] ?? 0.7;
  return Math.max(0, Math.round(level * q * s * STAT_PER_ILVL));
}

// The budget an item is expected to carry given its own source/quality/slot, or
// undefined when the item has no derivable item level.
export function expectedStatBudget(item: ItemDef): number | undefined {
  const level = itemLevel(item);
  if (level === undefined) return undefined;
  return primaryStatBudget(level, item.quality, item.slot);
}

// The sum of an item's primary stats (its realized stat budget).
export function primaryStatSum(item: ItemDef): number {
  if (!item.stats) return 0;
  let sum = 0;
  for (const k of PRIMARY_STATS) sum += item.stats[k] ?? 0;
  return sum;
}

// A single comparable power number: primary stats + armor (converted) + weapon DPS
// (converted). Rounded to one decimal for stable display/sorting.
export function itemScore(item: ItemDef): number {
  let score = primaryStatSum(item);
  if (item.stats?.armor) score += item.stats.armor / ARMOR_PER_POINT;
  if (item.weapon) {
    const dps = (item.weapon.min + item.weapon.max) / 2 / item.weapon.speed;
    score += dps * WEAPON_DPS_WEIGHT;
  }
  return Math.round(score * 10) / 10;
}

// Redistribute `budget` primary-stat points across whichever attributes the item
// already uses, keeping their ratio (its stat identity) and the integer sum EXACTLY
// equal to `budget`. armor is passed through untouched. Largest-remainder rounding
// makes it deterministic (ties broken by PRIMARY_STATS order). Note: under a very
// lopsided ratio with a tiny budget a minor attribute can still round to 0; the
// authored tiers use balanced ratios where every attribute survives.
export function normalizePrimaryStats(stats: Partial<Stats>, budget: number): Partial<Stats> {
  const out: Partial<Stats> = {};
  if (stats.armor !== undefined) out.armor = stats.armor;
  const present = PRIMARY_STATS.filter((k) => (stats[k] ?? 0) > 0);
  const total = present.reduce((a, k) => a + (stats[k] ?? 0), 0);
  if (present.length === 0 || total === 0 || budget <= 0) return out;
  const parts = present.map((k) => {
    const exact = (budget * (stats[k] ?? 0)) / total;
    const base = Math.floor(exact);
    return { k, base, frac: exact - base };
  });
  let assigned = parts.reduce((a, p) => a + p.base, 0);
  // Hand out the leftover points to the largest fractional parts first; the stable
  // PRIMARY_STATS order keeps ties deterministic across runs and hosts.
  const order = [...parts].sort((a, b) => b.frac - a.frac);
  for (let i = 0; assigned < budget; i++, assigned++) order[i % order.length].base += 1;
  for (const p of parts) out[p.k] = p.base;
  return out;
}

// Test/tooling hook: drop the memoized index so a test that mutates the tables can
// rebuild it. Not used by the running game.
export function resetItemLevelCache(): void {
  sourceIndex = null;
}
