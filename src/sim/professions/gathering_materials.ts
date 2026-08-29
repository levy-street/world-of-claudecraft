// Canonical gathering-material content tables. This leaf has type-only imports
// so material classification can read the tables eagerly without pulling the
// gathering command body, bags, or the Sim coordinator into its module graph.

import type { GatherNodeType, ItemDef } from '../types';

export type MaterialRarity = Exclude<NonNullable<ItemDef['quality']>, 'poor'>;

export interface NodeMaterialRow {
  itemId: string;
  qtyByRarity: Record<MaterialRarity, number>;
}

// Every material row yields this many units per rolled rarity (one shared
// curve; a per-family tune may diverge later if playtests want it). Frozen
// because every NODE_MATERIAL_TABLE row shares this one object: a per-family
// tune must clone it per row, never mutate it in place.
const MATERIAL_QTY_BY_RARITY: Record<MaterialRarity, number> = Object.freeze({
  common: 1,
  uncommon: 2,
  rare: 2,
  epic: 3,
  legendary: 4,
});

// Zone x node-type material matrix (Professions 2.0): which item a harvest
// grants in which zone, and the per-rarity unit counts. Eastbrook grants only
// the dedicated starter-material families, never premium vendor reagents. An
// out-tooled gatherer can still receive the fine grade of the same family.
export const NODE_MATERIAL_TABLE: Record<GatherNodeType, Record<string, NodeMaterialRow>> = {
  ore: {
    eastbrook_vale: { itemId: 'copper_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    mirefen_marsh: { itemId: 'iron_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    thornpeak_heights: { itemId: 'thorium_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    veiled_hollow: { itemId: 'thorium_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    drakelands: { itemId: 'thorium_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    frostveil: { itemId: 'thorium_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    amberfall: { itemId: 'thorium_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    willowfen: { itemId: 'thorium_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    nightbloom: { itemId: 'thorium_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    wraithwood: { itemId: 'thorium_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    galecrest: { itemId: 'thorium_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    palmreach: { itemId: 'thorium_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    evergarden: { itemId: 'thorium_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    farshore_isle: { itemId: 'iron_ore', qtyByRarity: MATERIAL_QTY_BY_RARITY },
  },
  wood: {
    eastbrook_vale: { itemId: 'ironbark_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    mirefen_marsh: { itemId: 'ashwood_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    thornpeak_heights: { itemId: 'elderwood_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    veiled_hollow: { itemId: 'elderwood_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    drakelands: { itemId: 'elderwood_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    frostveil: { itemId: 'elderwood_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    amberfall: { itemId: 'elderwood_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    willowfen: { itemId: 'elderwood_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    nightbloom: { itemId: 'elderwood_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    wraithwood: { itemId: 'elderwood_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    galecrest: { itemId: 'elderwood_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    palmreach: { itemId: 'elderwood_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    evergarden: { itemId: 'elderwood_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    farshore_isle: { itemId: 'ashwood_log', qtyByRarity: MATERIAL_QTY_BY_RARITY },
  },
  herb: {
    eastbrook_vale: { itemId: 'silverleaf_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    mirefen_marsh: { itemId: 'goldleaf_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    thornpeak_heights: { itemId: 'sunpetal_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    veiled_hollow: { itemId: 'sunpetal_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    drakelands: { itemId: 'sunpetal_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    frostveil: { itemId: 'sunpetal_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    amberfall: { itemId: 'sunpetal_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    willowfen: { itemId: 'sunpetal_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    nightbloom: { itemId: 'sunpetal_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    wraithwood: { itemId: 'sunpetal_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    galecrest: { itemId: 'sunpetal_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    palmreach: { itemId: 'sunpetal_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    evergarden: { itemId: 'sunpetal_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
    farshore_isle: { itemId: 'goldleaf_herb', qtyByRarity: MATERIAL_QTY_BY_RARITY },
  },
};

// A future zone may arrive before its material content. It gets the starter
// row rather than throwing: degraded yields, never a broken harvest.
export function nodeMaterialFor(type: GatherNodeType, zoneId: string): NodeMaterialRow {
  const byZone = NODE_MATERIAL_TABLE[type];
  // Bare index on purpose: zoneId is static GATHER_NODES content, never a
  // map-document-authored string, so a prototype key cannot reach this lookup.
  return byZone[zoneId] ?? byZone.eastbrook_vale;
}
