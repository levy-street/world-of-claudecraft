import { describe, expect, it } from 'vitest';
import { GATHER_NODE_TYPES, GATHER_NODES } from '../src/sim/content/gather_nodes';
import { ITEMS } from '../src/sim/data';
import {
  type MaterialRarity,
  NODE_MATERIAL_TABLE,
  nodeMaterialFor,
} from '../src/sim/professions/gathering';
import type { GatherNodeType } from '../src/sim/types';

const ZONES = ['eastbrook_vale', 'mirefen_marsh', 'thornpeak_heights'] as const;
const RARITIES: MaterialRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

// The shared contract's zone x type matrix, spelled out literally so a table
// edit (a swapped id, a dropped zone row) fails here by name.
const EXPECTED_MATRIX: Record<GatherNodeType, Record<(typeof ZONES)[number], string>> = {
  ore: {
    eastbrook_vale: 'copper_ore',
    mirefen_marsh: 'iron_ore',
    thornpeak_heights: 'thorium_ore',
  },
  wood: {
    eastbrook_vale: 'ironbark_log',
    mirefen_marsh: 'ashwood_log',
    thornpeak_heights: 'elderwood_log',
  },
  herb: {
    eastbrook_vale: 'silverleaf_herb',
    mirefen_marsh: 'goldleaf_herb',
    thornpeak_heights: 'sunpetal_herb',
  },
};

describe('NODE_MATERIAL_TABLE (Professions 2.0 Phase 4)', () => {
  it('pins the full zone x type item matrix', () => {
    for (const type of GATHER_NODE_TYPES) {
      for (const zone of ZONES) {
        expect(NODE_MATERIAL_TABLE[type][zone]?.itemId, `${type}/${zone}`).toBe(
          EXPECTED_MATRIX[type][zone],
        );
      }
    }
  });

  it('every row defines the shared qtyByRarity curve for every rarity the roll can land', () => {
    for (const type of GATHER_NODE_TYPES) {
      for (const zone of ZONES) {
        const row = NODE_MATERIAL_TABLE[type][zone];
        // Deep-equality on the whole record: a missing rarity key or a changed
        // unit count both fail, so every rollMaterialRarity outcome maps to a
        // defined yield in every zone.
        expect(row.qtyByRarity, `${type}/${zone}`).toEqual({
          common: 1,
          uncommon: 2,
          rare: 2,
          epic: 3,
          legendary: 4,
        });
        for (const rarity of RARITIES) {
          expect(typeof row.qtyByRarity[rarity], `${type}/${zone}/${rarity}`).toBe('number');
        }
      }
    }
  });

  it('every referenced material item exists in ITEMS', () => {
    for (const type of GATHER_NODE_TYPES) {
      for (const zone of Object.keys(NODE_MATERIAL_TABLE[type])) {
        const { itemId } = NODE_MATERIAL_TABLE[type][zone];
        expect(ITEMS[itemId], `${type}/${zone} -> ${itemId}`).toBeDefined();
      }
    }
  });

  it('every placed gather node zone has its own explicit row (no live node rides the fallback)', () => {
    for (const node of GATHER_NODES) {
      expect(NODE_MATERIAL_TABLE[node.type][node.zoneId], `${node.id}`).toBeDefined();
    }
  });

  it('nodeMaterialFor resolves the zone row, and falls back to eastbrook_vale for unknown zones', () => {
    expect(nodeMaterialFor('ore', 'mirefen_marsh').itemId).toBe('iron_ore');
    expect(nodeMaterialFor('herb', 'thornpeak_heights').itemId).toBe('sunpetal_herb');
    // Unknown (future) zone: degraded starter yields, never a broken harvest.
    expect(nodeMaterialFor('ore', 'zone_that_does_not_exist')).toBe(
      NODE_MATERIAL_TABLE.ore.eastbrook_vale,
    );
    expect(nodeMaterialFor('wood', 'zone_that_does_not_exist').itemId).toBe('ironbark_log');
  });
});

describe('zone-1 starter material cap (the stockpiling mitigation)', () => {
  const STARTER_IDS = ['copper_ore', 'ironbark_log', 'silverleaf_herb'];

  it('eastbrook_vale rows reference ONLY the dedicated starter materials', () => {
    for (const type of GATHER_NODE_TYPES) {
      expect(STARTER_IDS, `${type}/eastbrook_vale`).toContain(
        NODE_MATERIAL_TABLE[type].eastbrook_vale.itemId,
      );
    }
  });

  it('each starter material is a common-quality item worth at most 5 copper', () => {
    for (const id of STARTER_IDS) {
      const def = ITEMS[id];
      expect(def, id).toBeDefined();
      expect(def.quality, id).toBe('common');
      expect(def.sellValue ?? 0, id).toBeLessThanOrEqual(5);
    }
  });

  it('negative arm: the higher zones grant the higher-tier reagents, never the starter ids', () => {
    // Without this arm the cap test above could pass vacuously if every zone
    // were flattened onto the starter materials.
    for (const type of GATHER_NODE_TYPES) {
      for (const zone of ['mirefen_marsh', 'thornpeak_heights'] as const) {
        expect(STARTER_IDS, `${type}/${zone}`).not.toContain(
          NODE_MATERIAL_TABLE[type][zone].itemId,
        );
      }
    }
    expect(NODE_MATERIAL_TABLE.ore.mirefen_marsh.itemId).toBe('iron_ore');
    expect(NODE_MATERIAL_TABLE.ore.thornpeak_heights.itemId).toBe('thorium_ore');
    expect(NODE_MATERIAL_TABLE.wood.mirefen_marsh.itemId).toBe('ashwood_log');
    expect(NODE_MATERIAL_TABLE.wood.thornpeak_heights.itemId).toBe('elderwood_log');
    expect(NODE_MATERIAL_TABLE.herb.mirefen_marsh.itemId).toBe('goldleaf_herb');
    expect(NODE_MATERIAL_TABLE.herb.thornpeak_heights.itemId).toBe('sunpetal_herb');
  });
});

describe('retired placeholder junk grants (bone_fragments/linen_scrap/spider_leg)', () => {
  const RETIRED = ['bone_fragments', 'linen_scrap', 'spider_leg'] as const;

  it('no material row references a retired placeholder junk item', () => {
    for (const type of GATHER_NODE_TYPES) {
      for (const zone of Object.keys(NODE_MATERIAL_TABLE[type])) {
        expect(RETIRED as readonly string[], `${type}/${zone}`).not.toContain(
          NODE_MATERIAL_TABLE[type][zone].itemId,
        );
      }
    }
  });

  it('the three ItemDefs survive unchanged (recipes consume them, players hold them)', () => {
    // Exact-field pins: only the NODE SOURCE went away in Phase 4; the defs
    // themselves are load-bearing (crafting reagents + existing inventories).
    expect(ITEMS.bone_fragments).toEqual({
      id: 'bone_fragments',
      name: 'Bone Fragments',
      kind: 'junk',
      quality: 'common',
      sellValue: 7,
    });
    expect(ITEMS.linen_scrap).toEqual({
      id: 'linen_scrap',
      name: 'Linen Scrap',
      kind: 'junk',
      quality: 'common',
      sellValue: 3,
    });
    expect(ITEMS.spider_leg).toEqual({
      id: 'spider_leg',
      name: 'Twitching Spider Leg',
      kind: 'junk',
      quality: 'common',
      sellValue: 4,
    });
  });
});

describe('the four new material defs (Phase 4)', () => {
  it('are pinned exactly: tier reads from sellValue, and none is vendor-stocked', () => {
    // Exact toEqual pins mirroring the retired-junk pins above: the sellValue
    // IS the tier signal (items.ts house rule) and the deliberate absence of
    // buyValue keeps the new node materials off vendor inventories.
    expect(ITEMS.copper_ore).toEqual({
      id: 'copper_ore',
      name: 'Copper Ore',
      kind: 'junk',
      quality: 'common',
      sellValue: 4,
    });
    expect(ITEMS.iron_ore).toEqual({
      id: 'iron_ore',
      name: 'Iron Ore',
      kind: 'junk',
      quality: 'common',
      sellValue: 8,
    });
    expect(ITEMS.ironbark_log).toEqual({
      id: 'ironbark_log',
      name: 'Ironbark Log',
      kind: 'junk',
      quality: 'common',
      sellValue: 4,
    });
    expect(ITEMS.silverleaf_herb).toEqual({
      id: 'silverleaf_herb',
      name: 'Silverleaf Herb',
      kind: 'junk',
      quality: 'common',
      sellValue: 4,
    });
  });

  it('nodeMaterialFor falls back to the eastbrook starter row for an unknown zone', () => {
    // A future zone added before its material row lands must degrade to
    // starter yields, never throw or grant undefined.
    for (const type of GATHER_NODE_TYPES) {
      expect(nodeMaterialFor(type, 'zone_that_does_not_exist')).toEqual(
        NODE_MATERIAL_TABLE[type].eastbrook_vale,
      );
    }
  });
});
