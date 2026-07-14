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
  weaponDpsBudget,
} from '../item_budget';
import type { ItemDef, MobTemplate } from '../types';
import { NYTHRAXIS_RAID_BOSS_ID, NYTHRAXIS_RAID_LOOT_SOURCE_LEVEL } from './heroic_loot';

// The id of the Heroic variant of a base item (a stable, pure prefix).
export function heroicVariantId(baseId: string): string {
  return `heroic_${baseId}`;
}

function makeHeroicVariant(base: ItemDef, sourceLevel = HEROIC_VARIANT_SOURCE_LEVEL): ItemDef {
  const quality = base.quality ?? 'common';
  const targetLevel = sourceLevel + (QUALITY_ILVL_BONUS[quality] ?? 0);
  const targetBudget = primaryStatBudget(targetLevel, base.quality, base.slot);
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
  // dps for this variant's item level, keeping its swing speed and spread. A base
  // weapon already above that curve retains its realized dps.
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
    variant.weapon = {
      ...base.weapon,
      ...scaleWeaponDamage(base.weapon, Math.max(weaponDpsBudget(targetLevel), baseDps)),
    };
  }
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
      if (!def.slot || (def.kind !== 'armor' && def.kind !== 'weapon')) continue;
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
