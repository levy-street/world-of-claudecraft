import { FARM_CROPS } from '../../src/sim/content/farm_crops';
import { isShieldItem } from '../../src/sim/equipment_rules';
import { MATERIAL_ITEM_IDS } from '../../src/sim/material_taxonomy';
import { baseMaterialFor } from '../../src/sim/professions/material_grades';
import type { ItemDef } from '../../src/sim/types';

// Where a non-equipment item sits in the Items catalog: [hub section, group page].
export type Placement = [facet: string, label: string];

const SEEDS = new Set(Object.values(FARM_CROPS).map((c) => c.seedItemId));
const TOOL_USES: Record<string, Placement> = {
  gatherTool: ['Professions and supplies', 'Tools and tool upgrades'],
  fishing: ['Professions and supplies', 'Tools and tool upgrades'],
  harvestPreference: ['Professions and supplies', 'Tools and tool upgrades'],
  toolEffect: ['Professions and supplies', 'Tools and tool upgrades'],
  placeMobileStation: ['Professions and supplies', 'Crafting stations and kits'],
  armorKit: ['Professions and supplies', 'Crafting stations and kits'],
  sharpeningStone: ['Professions and supplies', 'Crafting stations and kits'],
  mechChroma: ['Collections and appearance', 'Dyes and appearances'],
  skinSelect: ['Collections and appearance', 'Dyes and appearances'],
  seasonal: ['Collections and appearance', 'Toys and event items'],
  dawnStandard: ['Collections and appearance', 'Toys and event items'],
  targetDummy: ['Collections and appearance', 'Toys and event items'],
  shockBomb: ['Collections and appearance', 'Toys and event items'],
  container: ['Adventure and trade', 'Caches and pouches'],
  alliedHearthstone: ['Bags and travel', 'Travel and riding'],
  riftGlider: ['Bags and travel', 'Travel and riding'],
};
const CURRENCY: Placement = ['Currencies and tokens', 'Currencies and tokens'];

function toolPlacement(item: ItemDef): Placement {
  const use = (item as { use?: { type?: string } }).use?.type;
  if (use && TOOL_USES[use]) return TOOL_USES[use];
  if ((item as { teachesRiding?: unknown }).teachesRiding)
    return ['Bags and travel', 'Travel and riding'];
  if (item.id.startsWith('sigil_')) return ['Currencies and tokens', 'Armor sigils'];
  return CURRENCY;
}

function junkPlacement(item: ItemDef): Placement {
  if ((item as { feast?: unknown }).feast) return ['Consumables', 'Feasts'];
  if (item.id.startsWith('reins_')) return ['Collections and appearance', 'Legacy mount keys'];
  if (SEEDS.has(item.id)) return ['Professions and supplies', 'Seeds'];
  if (MATERIAL_ITEM_IDS.has(item.id) || baseMaterialFor(item.id) !== undefined)
    return ['Professions and supplies', 'Materials'];
  if (item.id === 'membership_token' || item.id === 'deed_of_making') return CURRENCY;
  return ['Adventure and trade', 'Vendor junk'];
}

const KINDS: Partial<Record<ItemDef['kind'], Placement>> = {
  food: ['Consumables', 'Food'],
  drink: ['Consumables', 'Drinks'],
  potion: ['Consumables', 'Potions'],
  elixir: ['Consumables', 'Elixirs and flasks'],
  flask: ['Consumables', 'Elixirs and flasks'],
  scroll: ['Consumables', 'Scrolls'],
  recipe: ['Professions and supplies', 'Crafting patterns'],
  bag: ['Bags and travel', 'Bags'],
  mount: ['Collections and appearance', 'Mount items'],
  buddy: ['Collections and appearance', 'Companion items'],
  buddy_cosmetic: ['Collections and appearance', 'Companion cosmetics'],
  quest: ['Adventure and trade', 'Quest items'],
};

export function itemPlacement(item: ItemDef): Placement {
  if (item.kind === 'tool') return toolPlacement(item);
  if (item.kind === 'junk') return junkPlacement(item);
  return KINDS[item.kind] ?? ['Adventure and trade', 'Vendor junk'];
}

export function offhandSection(item: ItemDef): string {
  if (isShieldItem(item)) return 'Shields';
  if (item.kind === 'held_offhand')
    return (item as { occupiesHand?: false }).occupiesHand === false ? 'Quivers' : 'Orbs and tomes';
  return '';
}
