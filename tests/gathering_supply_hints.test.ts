// Pins the gathering-source reverse lookup (Intentional Gathering PR4):
// gathering_supply.ts's gatheringSupplyHintsForItem. See
// tests/gathering_supply_coverage.test.ts for the forward derivation this
// reuses; this file covers ONLY the reverse index and its dedupe/refusal
// contracts, never a second copy of the coverage guard.

import { describe, expect, it } from 'vitest';
import {
  HARVEST_COMPONENT_ITEMS,
  HARVEST_COMPONENT_SPECIMENS,
} from '../src/sim/content/professions';
import { NODE_MATERIAL_TABLE } from '../src/sim/professions/gathering';
import {
  CORPSE_HARVEST_FAMILY,
  farmingSupply,
  fishingSupply,
  gatheringSupplyHintsForItem,
} from '../src/sim/professions/gathering_supply';

describe('gatheringSupplyHintsForItem: exact family membership', () => {
  it('a node material resolves to exactly its own family, with no corpse preference id', () => {
    const hints = gatheringSupplyHintsForItem('iron_ore');
    expect(hints).toHaveLength(1);
    expect(hints[0]).toEqual({ familyId: 'mining', corpsePreferenceItemId: null });
    expect(gatheringSupplyHintsForItem('ashwood_log')).toEqual([
      { familyId: 'logging', corpsePreferenceItemId: null },
    ]);
    expect(gatheringSupplyHintsForItem('goldleaf_herb')).toEqual([
      { familyId: 'herbalism', corpsePreferenceItemId: null },
    ]);
  });

  it('a fishing catch resolves to fishing alone', () => {
    const [anyFishId] = [...fishingSupply()].sort();
    expect(gatheringSupplyHintsForItem(anyFishId)).toEqual([
      { familyId: 'fishing', corpsePreferenceItemId: null },
    ]);
  });

  it('a farmed material resolves to farming alone', () => {
    const [anyFarmId] = [...farmingSupply()].sort();
    expect(gatheringSupplyHintsForItem(anyFarmId)).toEqual([
      { familyId: 'farming', corpsePreferenceItemId: null },
    ]);
  });

  it('a plain corpse-harvest component resolves to the corpse family, naming ITSELF as the preference target', () => {
    expect(gatheringSupplyHintsForItem('rough_hide')).toEqual([
      { familyId: CORPSE_HARVEST_FAMILY, corpsePreferenceItemId: 'rough_hide' },
    ]);
    expect(gatheringSupplyHintsForItem('wolf_fang')).toEqual([
      { familyId: CORPSE_HARVEST_FAMILY, corpsePreferenceItemId: 'wolf_fang' },
    ]);
  });

  it('a Pristine specimen resolves to the corpse family, naming its ORDINARY material as the preference target', () => {
    // pristine_hide is the hide component's specimen; the preference a player
    // would set is rough_hide (the plain material), never the specimen id.
    expect(gatheringSupplyHintsForItem('pristine_hide')).toEqual([
      { familyId: CORPSE_HARVEST_FAMILY, corpsePreferenceItemId: 'rough_hide' },
    ]);
    expect(gatheringSupplyHintsForItem('prime_cut')).toEqual([
      { familyId: CORPSE_HARVEST_FAMILY, corpsePreferenceItemId: 'game_meat' },
    ]);
  });
});

describe('gatheringSupplyHintsForItem: horn/tusk dedupe', () => {
  it('curved_tusk (shared by BOTH the tusk and horn tags) yields exactly ONE hint, not two', () => {
    // Precondition: two distinct tags really do map to the same item id.
    expect(HARVEST_COMPONENT_ITEMS.tusk).toBe('curved_tusk');
    expect(HARVEST_COMPONENT_ITEMS.horn).toBe('curved_tusk');
    const hints = gatheringSupplyHintsForItem('curved_tusk');
    expect(hints).toEqual([
      { familyId: CORPSE_HARVEST_FAMILY, corpsePreferenceItemId: 'curved_tusk' },
    ]);
  });
});

describe('gatheringSupplyHintsForItem: refusal and immutability', () => {
  it('an unknown id returns the shared frozen empty array', () => {
    const hints = gatheringSupplyHintsForItem('not_a_real_item_id');
    expect(hints).toEqual([]);
    expect(Object.isFrozen(hints)).toBe(true);
  });

  it('never resolves an id via the prototype chain', () => {
    for (const prototypeId of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const hints = gatheringSupplyHintsForItem(prototypeId);
      expect(hints, prototypeId).toEqual([]);
      expect(Object.isFrozen(hints), prototypeId).toBe(true);
    }
  });

  it('the returned array for a real id is frozen too: a caller cannot corrupt the shared cache', () => {
    const hints = gatheringSupplyHintsForItem('iron_ore');
    expect(Object.isFrozen(hints)).toBe(true);
    expect(() => {
      (hints as unknown as unknown[]).push({ familyId: 'farming', corpsePreferenceItemId: null });
    }).toThrow();
    // A second call still answers the original, unmutated hint.
    expect(gatheringSupplyHintsForItem('iron_ore')).toEqual([
      { familyId: 'mining', corpsePreferenceItemId: null },
    ]);
  });

  it('each individual hint ROW object is frozen too, not just the array holding it', () => {
    const [hint] = gatheringSupplyHintsForItem('iron_ore');
    expect(Object.isFrozen(hint)).toBe(true);
    expect(() => {
      (hint as { familyId: string }).familyId = 'farming';
    }).toThrow();
    expect(gatheringSupplyHintsForItem('iron_ore')[0]).toEqual({
      familyId: 'mining',
      corpsePreferenceItemId: null,
    });
  });

  it('a false source is absent: a crafted intermediate no gathering family supplies answers empty', () => {
    // NODE_MATERIAL_TABLE's own yields are the supply set; a plain fine grade
    // this table does not enumerate directly proves nothing is credited to a
    // family it does not belong to. Use an id that resolves in no table at
    // all as the clean negative.
    expect(gatheringSupplyHintsForItem('gold_coin')).toEqual([]);
  });
});

describe('gatheringSupplyHintsForItem: specimen-to-parent mapping is exhaustive over the shipped tables', () => {
  it('every HARVEST_COMPONENT_SPECIMENS entry resolves through its own tag to the matching HARVEST_COMPONENT_ITEMS material', () => {
    for (const [component, specimenId] of Object.entries(HARVEST_COMPONENT_SPECIMENS)) {
      const materialId = HARVEST_COMPONENT_ITEMS[component];
      expect(materialId, component).toBeDefined();
      expect(gatheringSupplyHintsForItem(specimenId), specimenId).toEqual([
        { familyId: CORPSE_HARVEST_FAMILY, corpsePreferenceItemId: materialId },
      ]);
    }
  });
});
