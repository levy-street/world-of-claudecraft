// Heroic upgraded drop variants. When a mob dies in a HEROIC dungeon instance, its
// normal (base-table) epic and rare drops are swapped for a "Heroic" copy: the same
// item identity one tier up. Epics read item level 28, rares 25 (see
// HEROIC_VARIANT_SOURCE_LEVEL in ../item_level), with primary stats rescaled to the
// matching budget. The swap happens in loot/loot_roll.ts, and only when it is an
// UPGRADE (raid epics, already item level 29, are left alone).
//
// These are real ItemDefs merged into ITEMS (data.ts), so every downstream reader
// (tooltip, equip, itemScore, the server->client wire) treats a Heroic variant like
// any other item with no special handling. The display name is the base item's name
// (classic behavior: a heroic drop reads the same as its normal counterpart); the
// heroic distinction shows as an "[HEROIC]" tag on the tooltip's quality/kind line
// (ui/hud.ts + ui/entity_i18n.ts), so a variant never needs its own translated name
// key, and the entity manifest skips it.
import {
  HEROIC_VARIANT_SOURCE_LEVEL,
  normalizePrimaryStats,
  PRIMARY_STATS,
  primaryStatBudget,
  QUALITY_ILVL_BONUS,
  scaleWeaponDamage,
  TWOHAND_DPS_MULT,
  TWOHAND_STAT_MULT,
  weaponDpsBudget,
} from '../item_budget';
import type { ItemDef, MobTemplate } from '../types';
import { NYTHRAXIS_RAID_BOSS_ID, NYTHRAXIS_RAID_LOOT_SOURCE_LEVEL } from './heroic_loot';

// The id of the Heroic variant of a base item (a stable, pure prefix).
export function heroicVariantId(baseId: string): string {
  return `heroic_${baseId}`;
}

// Combat ratings on the Heroic RAID variants (item level 33/37): the dual-rating
// tier. Unlike the five-man heroic variants (which inherit their base's ratings
// unchanged, so ilvl-26 dungeon bases with no rating stay rating-free at ilvl 28),
// a raid variant SCALES its base's primary rating up to the raid allowance AND adds
// a complementary secondary rating. Two ratings per piece is the raid tier's
// identity, a step nothing below ilvl 33 has. See docs/prd/combat-ratings-and-jewelry.md.
const RAID_RATING_KEYS = ['hitRating', 'critRating', 'hasteRating'] as const;
type RatingKey = (typeof RAID_RATING_KEYS)[number];
const RAID_PRIMARY_ARMOR = 55; // 5.5%
const RAID_PRIMARY_WEAPON = 65; // 6.5%
const RAID_PRIMARY_LEGENDARY = 70; // 7.0%
const RAID_SECONDARY = 20; // 2.0%
const RAID_SECONDARY_LEGENDARY = 30; // 3.0%

// Apply the raid-tier dual rating to a variant, in place. The primary keeps the
// base's rating TYPE (scaled to the tier allowance); the secondary is complementary.
// Physical Hit pairs with crit and a physical non-Hit primary pairs with Hit. A
// spell-facing Hit seed marks caster DPS and keeps Hit, paired with haste. A
// spell-facing throughput seed (or no seed, like the Heartwood healer staff) stays
// throughput-only and pairs crit + haste, so healer-facing gear never gains Hit.
function applyRaidVariantRatings(variant: ItemDef, base: ItemDef): void {
  const isLegendary = (base.quality ?? 'common') === 'legendary';
  const s = base.stats;
  // Spell-facing: carries caster stats (int/spirit/Spell Power) and no attack-power
  // stats (strength/agility). It only carries Hit when the authored base explicitly
  // seeds Hit, which distinguishes caster-DPS pieces from throughput/healer pieces.
  const spellFacing =
    ((s?.int ?? 0) > 0 || (s?.spi ?? 0) > 0 || (base.spellPower ?? 0) > 0) &&
    (s?.str ?? 0) === 0 &&
    (s?.agi ?? 0) === 0;
  const baseRatingKey = RAID_RATING_KEYS.find((k) => (base[k] ?? 0) > 0);
  const primaryKey: RatingKey = baseRatingKey ?? (spellFacing ? 'hasteRating' : 'hitRating');
  // Spell-facing pieces use the other throughput rating as their secondary: an
  // authored Hit seed becomes Hit + haste, while crit/haste/rating-less bases remain
  // throughput-only. Physical pieces retain the Hit <-> crit complement rule.
  const secondaryKey: RatingKey = spellFacing
    ? primaryKey === 'hasteRating'
      ? 'critRating'
      : 'hasteRating'
    : primaryKey === 'hitRating'
      ? 'critRating'
      : 'hitRating';
  const primaryVal = isLegendary
    ? RAID_PRIMARY_LEGENDARY
    : base.weapon
      ? RAID_PRIMARY_WEAPON
      : RAID_PRIMARY_ARMOR;
  variant[primaryKey] = primaryVal;
  variant[secondaryKey] = isLegendary ? RAID_SECONDARY_LEGENDARY : RAID_SECONDARY;
}

function makeHeroicVariant(base: ItemDef, sourceLevel = HEROIC_VARIANT_SOURCE_LEVEL): ItemDef {
  const quality = base.quality ?? 'common';
  const targetLevel = sourceLevel + (QUALITY_ILVL_BONUS[quality] ?? 0);
  const isTwoHand = base.kind === 'weapon' && base.hand === 'twohand';
  const handMultiplier = isTwoHand ? TWOHAND_STAT_MULT : 1;
  // Rounded like expectedStatBudget so variant budgets stay integral under the
  // fractional TWOHAND_STAT_MULT.
  const targetBudget = Math.round(
    primaryStatBudget(targetLevel, base.quality, base.slot) * handMultiplier,
  );
  const baseBudget = base.stats
    ? PRIMARY_STATS.reduce((sum, stat) => sum + (base.stats?.[stat] ?? 0), 0)
    : 0;
  // normalizePrimaryStats keeps the item's stat identity (its str/agi/int ratio)
  // and passes armor through untouched; only the primary-stat sum grows to the
  // larger of the heroic target budget and the base item's realized budget.
  const stats = base.stats
    ? normalizePrimaryStats(base.stats, Math.max(targetBudget, baseBudget))
    : base.stats;
  // Weapon damage tracks item level too: scale the base weapon to the heroic-tier
  // dps for this variant's item level (two-handers ride TWOHAND_DPS_MULT above the
  // one-hand line), keeping its swing speed and spread. A base weapon already above
  // that curve retains its realized dps.
  const variant = {
    ...base,
    id: heroicVariantId(base.id),
    // Same name as the base item; the heroic distinction is the tooltip "[HEROIC]"
    // tag, resolved from `heroicOf` (ui/entity_i18n.ts), never a name prefix.
    name: base.name,
    heroicOf: base.id,
    stats,
  };
  if (base.weapon) {
    const baseDps = (base.weapon.min + base.weapon.max) / 2 / base.weapon.speed;
    const curveDps = weaponDpsBudget(targetLevel) * (isTwoHand ? TWOHAND_DPS_MULT : 1);
    variant.weapon = {
      ...base.weapon,
      ...scaleWeaponDamage(base.weapon, Math.max(curveDps, baseDps)),
    };
  }
  // Heroic RAID variants (source level 27 -> item level 33/37) get the dual rating;
  // five-man heroic variants inherit their base's ratings unchanged via the spread.
  if (sourceLevel === NYTHRAXIS_RAID_LOOT_SOURCE_LEVEL) applyRaidVariantRatings(variant, base);
  // The spread widens ItemDef's discriminated union; the transform preserves the
  // base item's kind/slot shape, so this is a valid ItemDef of the same variant.
  return variant as ItemDef;
}

// Build a Heroic variant for every epic/rare EQUIPPABLE item that drops from a mob's
// base loot table. Vendor jewelry, quest rewards, the item-level-31 heroic set
// (appended via HEROIC_BOSS_LOOT, never a mob-loot entry), and non-gear are excluded
// because they never appear in a MobTemplate.loot list.
export function buildHeroicVariants(
  items: Record<string, ItemDef>,
  mobs: Record<string, MobTemplate>,
): Record<string, ItemDef> {
  const eligible = new Set<string>();
  for (const mob of Object.values(mobs)) {
    for (const entry of mob.loot ?? []) {
      const id = entry.itemId;
      if (!id) continue;
      const def = items[id];
      if (!def || def.heroicOf) continue; // skip missing ids and already-variants
      if (def.quality !== 'epic' && def.quality !== 'rare' && def.quality !== 'legendary') continue;
      // Equippable combat gear only: armor (incl. shields), weapons, and held
      // offhands, so every raid-boss normal drop has a heroic-claim upgrade.
      if (
        !def.slot ||
        (def.kind !== 'armor' && def.kind !== 'weapon' && def.kind !== 'held_offhand')
      )
        continue;
      eligible.add(id);
    }
  }
  // The heroic Nythraxis raid boss's own set pieces and legendaries upgrade to
  // the RAID tier (source 27), one step above the five-man heroic variants
  // (source 22). Anchored on the raid boss's normal loot so the loot-roll
  // auto-swap in a heroic claim yields the same raid-tier variant, and it stays
  // the single source of truth shared with the item-level source index.
  const raidBases = new Set(
    (mobs[NYTHRAXIS_RAID_BOSS_ID]?.loot ?? []).flatMap((e) => (e.itemId ? [e.itemId] : [])),
  );
  const out: Record<string, ItemDef> = {};
  for (const id of eligible) {
    const sourceLevel = raidBases.has(id)
      ? NYTHRAXIS_RAID_LOOT_SOURCE_LEVEL
      : HEROIC_VARIANT_SOURCE_LEVEL;
    out[heroicVariantId(id)] = makeHeroicVariant(items[id], sourceLevel);
  }
  return out;
}
