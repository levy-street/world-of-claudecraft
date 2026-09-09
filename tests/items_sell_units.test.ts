// Direct unit tests for removeSellUnitsFromInventory (src/sim/items.ts), the
// INVENTORY-first walk every disposal pipe shares: the vendor sell arms, the
// trade swap's per-unit removal, and (over a scratch copy of the bags) the
// trade window's stage-time preview. Its callers only ever observe the walk
// through a whole trade or sale, so the ordering rules, the skip and
// deprioritize predicates and the clone-on-survival contract are pinned here
// against a plain array instead: a walk-order regression that two pipes happen
// to agree on is still a regression, and this is the file that says so.

import { describe, expect, it } from 'vitest';
import { removeSellUnitsFromInventory, removeVendorSellUnits } from '../src/sim/items';
import type { SimContext } from '../src/sim/sim_context';
import type { InvSlot, ItemInstancePayload } from '../src/sim/types';

// A GENUINE non-material item id (kind 'potion', never 'junk', so
// isMaterialItemId is false for it no matter what content tables ship): the
// walk below is the legacy per-slot payload/marker path, and the
// reference-identity contract below (clone-on-survival) can only be proved on
// that path, since a material unit's payload is ALWAYS a fresh clone by
// contract (material_inventory_units.ts). The material-sourced walk gets its
// own coverage in "material units (canonical source order)" below, over a
// real material id, so this rename does not drop material coverage: it moves
// it to the block that can state its own (different) contract correctly.
const ID = 'minor_healing_potion';
const MATERIAL_ID = 'wolf_fang'; // a real material id (junk-kind, HARVEST_COMPONENT_ITEMS)

describe('the plain pass', () => {
  it('consumes plain slots highest-index-first, reporting each unit with its own marker', () => {
    const inv: InvSlot[] = [
      { itemId: ID, count: 2, craftedRecipeId: 'recipe_fang' },
      { itemId: ID, count: 1 },
    ];
    const units = removeSellUnitsFromInventory(inv, ID, 2);
    // The top slot goes first, so the marker-free unit is reported before the
    // crafted one: the ORDER is what grantOffer re-grants in, so a reversed
    // walk would hand the wrong provenance to whoever receives unit one.
    expect(units).toEqual([
      { instance: undefined, craftedRecipeId: undefined },
      { instance: undefined, craftedRecipeId: 'recipe_fang' },
    ]);
    expect(inv).toEqual([{ itemId: ID, count: 1, craftedRecipeId: 'recipe_fang' }]);
  });

  it('drains every plain copy before touching an instanced one, index order notwithstanding', () => {
    // The plain-first rule beats the highest-index rule, which is the whole
    // reason this walk exists: "sell one" must take the fungible copy a player
    // almost always means, not the enchanted copy sitting above it.
    const signed: ItemInstancePayload = { signer: 'Ayla' };
    const inv: InvSlot[] = [
      { itemId: ID, count: 1 },
      { itemId: ID, count: 1, instance: signed },
    ];
    const units = removeSellUnitsFromInventory(inv, ID, 1);
    expect(units).toEqual([{ instance: undefined, craftedRecipeId: undefined }]);
    expect(inv).toEqual([{ itemId: ID, count: 1, instance: signed }]);
  });

  it('ignores another item id entirely, however it is spelled in the bags', () => {
    // The foreign id sits ABOVE the target on purpose: highest-index-first,
    // an id-blind walk would consume the bread and satisfy `left` before it
    // ever reached the fang, so this fixture order is what makes the id
    // guard load-bearing rather than a same-outcome pass.
    const inv: InvSlot[] = [
      { itemId: ID, count: 1 },
      { itemId: 'baked_bread', count: 3 },
    ];
    const units = removeSellUnitsFromInventory(inv, ID, 1);
    expect(units).toHaveLength(1);
    expect(inv).toEqual([{ itemId: 'baked_bread', count: 3 }]);
  });

  it('ignores a foreign id in the INSTANCED passes too', () => {
    // The plain pass's id guard cannot vouch for the instanced ones: an
    // id-blind instanced walk would ship the bread's enchanted copy here.
    const fang: ItemInstancePayload = { signer: 'Ayla' };
    const bread: ItemInstancePayload = { signer: 'Cedric' };
    const inv: InvSlot[] = [
      { itemId: ID, count: 1, instance: fang },
      { itemId: 'baked_bread', count: 1, instance: bread },
    ];
    const units = removeSellUnitsFromInventory(inv, ID, 1);
    expect(units).toHaveLength(1);
    expect(units[0].instance).toBe(fang);
    expect(inv).toEqual([{ itemId: 'baked_bread', count: 1, instance: bread }]);
  });
});

describe('the two instanced passes', () => {
  it('takes the preferred class first and the deprioritized class only as a remainder', () => {
    const foreign: ItemInstancePayload = { signer: 'Cedric' };
    const own: ItemInstancePayload = { signer: 'Ayla' };
    const deprioritize = (instance: ItemInstancePayload): boolean => instance.signer === 'Ayla';
    // The owner's copy sits ABOVE the foreign one, so a single highest-index
    // walk would ship it: only the second pass keeps it home.
    const one: InvSlot[] = [
      { itemId: ID, count: 1, instance: foreign },
      { itemId: ID, count: 1, instance: own },
    ];
    expect(removeSellUnitsFromInventory(one, ID, 1, undefined, deprioritize)).toEqual([
      { instance: foreign, craftedRecipeId: undefined },
    ]);
    expect(one).toEqual([{ itemId: ID, count: 1, instance: own }]);

    // Deprioritized, never spared: an offer that needs both gets both, and the
    // preferred copy is reported first.
    const two: InvSlot[] = [
      { itemId: ID, count: 1, instance: foreign },
      { itemId: ID, count: 1, instance: own },
    ];
    expect(removeSellUnitsFromInventory(two, ID, 2, undefined, deprioritize)).toEqual([
      { instance: foreign, craftedRecipeId: undefined },
      { instance: own, craftedRecipeId: undefined },
    ]);
    expect(two).toEqual([]);
  });

  it('walks a single highest-index-first pass when no deprioritize predicate is given', () => {
    // The absent-predicate arm is byte-identical to the pre-deprioritize walk:
    // the top copy ships, signer-blind.
    const lower: ItemInstancePayload = { signer: 'Cedric' };
    const upper: ItemInstancePayload = { signer: 'Ayla' };
    const inv: InvSlot[] = [
      { itemId: ID, count: 1, instance: lower },
      { itemId: ID, count: 1, instance: upper },
    ];
    expect(removeSellUnitsFromInventory(inv, ID, 1)).toEqual([
      { instance: upper, craftedRecipeId: undefined },
    ]);
    expect(inv).toEqual([{ itemId: ID, count: 1, instance: lower }]);
  });

  it('carries each instanced unit its own slot payload and marker, not the previous slot', () => {
    // IDENTITY, not deep equality: the two payloads are deliberately
    // deep-equal, so only toBe can catch a walk that reports the right
    // marker with the other slot's payload object (the bind-on-trade stamp
    // later writes into that object in place, so identity is the contract).
    const plain: ItemInstancePayload = { signer: 'Ayla' };
    const crafted: ItemInstancePayload = { signer: 'Ayla' };
    const inv: InvSlot[] = [
      { itemId: ID, count: 1, instance: plain },
      { itemId: ID, count: 1, instance: crafted, craftedRecipeId: 'recipe_fang' },
    ];
    const units = removeSellUnitsFromInventory(inv, ID, 2);
    expect(units.map((u) => u.craftedRecipeId)).toEqual(['recipe_fang', undefined]);
    expect(units[0].instance).toBe(crafted);
    expect(units[1].instance).toBe(plain);
  });
});

describe('the skip predicate', () => {
  it('spares every match, even one sitting above the copy that ships', () => {
    const bound: ItemInstancePayload = { signer: 'Ayla', boundTo: 7 };
    const free: ItemInstancePayload = { signer: 'Cedric' };
    const skip = (instance: ItemInstancePayload): boolean => instance.boundTo !== undefined;
    const inv: InvSlot[] = [
      { itemId: ID, count: 1, instance: free },
      { itemId: ID, count: 1, instance: bound },
    ];
    expect(removeSellUnitsFromInventory(inv, ID, 1, skip)).toEqual([
      { instance: free, craftedRecipeId: undefined },
    ]);
    expect(inv).toEqual([{ itemId: ID, count: 1, instance: bound }]);
  });

  it('spares a skipped copy even in the preferred pass, with both predicates live', () => {
    // The live callers (the trade swap and the staging preview) always pass
    // skip AND deprioritize together; separately-tested predicates cannot
    // catch an arm-order mutant that lets a skipped copy satisfy the
    // preferred pass. The skipped copy here is NOT deprioritized and sits on
    // top, so only the skip check keeps it home.
    const boundForeign: ItemInstancePayload = { signer: 'Cedric', boundTo: 7 };
    const own: ItemInstancePayload = { signer: 'Ayla' };
    const skip = (instance: ItemInstancePayload): boolean => instance.boundTo !== undefined;
    const deprioritize = (instance: ItemInstancePayload): boolean => instance.signer === 'Ayla';
    const inv: InvSlot[] = [
      { itemId: ID, count: 1, instance: own },
      { itemId: ID, count: 1, instance: boundForeign },
    ];
    expect(removeSellUnitsFromInventory(inv, ID, 1, skip, deprioritize)).toEqual([
      { instance: own, craftedRecipeId: undefined },
    ]);
    expect(inv).toEqual([{ itemId: ID, count: 1, instance: boundForeign }]);
  });

  it('under-delivers rather than reaching past a spared copy', () => {
    // A skipped copy is not a fallback of last resort: asking for two when only
    // one is eligible returns one, and the spared copy stays put.
    const bound: ItemInstancePayload = { boundTo: 7 };
    const free: ItemInstancePayload = { signer: 'Cedric' };
    const skip = (instance: ItemInstancePayload): boolean => instance.boundTo !== undefined;
    const inv: InvSlot[] = [
      { itemId: ID, count: 1, instance: bound },
      { itemId: ID, count: 1, instance: free },
    ];
    expect(removeSellUnitsFromInventory(inv, ID, 2, skip)).toEqual([
      { instance: free, craftedRecipeId: undefined },
    ]);
    expect(inv).toEqual([{ itemId: ID, count: 1, instance: bound }]);
  });
});

describe('the clone-on-survival contract', () => {
  it('hands a surviving stack a CLONE, so a caller stamping the unit cannot reach the bags', () => {
    // The bind-on-trade stamp writes into the returned payload in place, so a
    // surviving stack sharing that object would silently bind every unit still
    // in the giver's bags.
    const shared: ItemInstancePayload = { signer: 'Ayla', bindOnTrade: true };
    const inv: InvSlot[] = [{ itemId: ID, count: 2, instance: shared }];
    const units = removeSellUnitsFromInventory(inv, ID, 1);
    expect(units).toHaveLength(1);
    expect(units[0].instance).not.toBe(shared);
    expect(units[0].instance).toEqual(shared);
    (units[0].instance as ItemInstancePayload).boundTo = 42;
    expect(inv[0].instance).toEqual({ signer: 'Ayla', bindOnTrade: true });
    expect(inv[0].instance).toBe(shared);
  });

  it('hands a fully-consumed slot its payload AS IS, and clones only the units before it', () => {
    // The slot is gone, so nothing can alias it: the final unit carries the
    // original object. The earlier units of the same slot are still clones,
    // because they would otherwise all be one object.
    const shared: ItemInstancePayload = { signer: 'Ayla' };
    const inv: InvSlot[] = [{ itemId: ID, count: 2, instance: shared }];
    const units = removeSellUnitsFromInventory(inv, ID, 2);
    expect(inv).toEqual([]);
    expect(units[1].instance).toBe(shared);
    expect(units[0].instance).not.toBe(shared);
    expect(units[0].instance).not.toBe(units[1].instance);
    expect(units[0].instance).toEqual(shared);
  });
});

describe('asking for more than the bags hold', () => {
  it('returns only what exists and empties the slots it walked', () => {
    const signed: ItemInstancePayload = { signer: 'Ayla' };
    const inv: InvSlot[] = [
      { itemId: ID, count: 1, instance: signed },
      { itemId: ID, count: 2 },
    ];
    const units = removeSellUnitsFromInventory(inv, ID, 9);
    expect(units).toEqual([
      { instance: undefined, craftedRecipeId: undefined },
      { instance: undefined, craftedRecipeId: undefined },
      { instance: signed, craftedRecipeId: undefined },
    ]);
    expect(inv).toEqual([]);
  });

  it('returns nothing at all when the id is not held', () => {
    const inv: InvSlot[] = [{ itemId: 'baked_bread', count: 1 }];
    expect(removeSellUnitsFromInventory(inv, ID, 3)).toEqual([]);
    expect(inv).toEqual([{ itemId: 'baked_bread', count: 1 }]);
  });
});

describe('material units (canonical source order)', () => {
  // A material id routes through takeMaterialUnits (material_item_custody.ts)
  // instead of the plain/instanced walks above. Every fixture here uses
  // MATERIAL_ID so isMaterialItemId is true; the returned units carry
  // `materialSources` (material_inventory_units.ts materialInventoryUnits) and
  // the legacy `signer` moves off `instance` into `source.signer`.

  it('a legacy signed slot reports source.signer with no invented gatherer', () => {
    const inv: InvSlot[] = [{ itemId: MATERIAL_ID, count: 1, instance: { signer: 'Ayla' } }];
    const units = removeSellUnitsFromInventory(inv, MATERIAL_ID, 1);
    expect(units).toEqual([
      {
        instance: undefined,
        craftedRecipeId: undefined,
        materialSources: [{ source: { signer: 'Ayla' }, count: 1 }],
      },
    ]);
    expect(inv).toEqual([]);
  });

  it('a plain unrecorded slot reports the empty source, not a fabricated one', () => {
    const inv: InvSlot[] = [{ itemId: MATERIAL_ID, count: 1 }];
    const units = removeSellUnitsFromInventory(inv, MATERIAL_ID, 1);
    expect(units).toEqual([
      {
        instance: undefined,
        craftedRecipeId: undefined,
        materialSources: [{ source: {}, count: 1 }],
      },
    ]);
  });

  it('preserves the rest of the payload and the craftedRecipeId marker, signer only stripped', () => {
    const inv: InvSlot[] = [
      {
        itemId: MATERIAL_ID,
        count: 1,
        instance: { signer: 'Ayla', rolled: { stats: { agi: 1 } } },
        craftedRecipeId: 'recipe_material',
      },
    ];
    const units = removeSellUnitsFromInventory(inv, MATERIAL_ID, 1);
    expect(units).toEqual([
      {
        instance: { rolled: { stats: { agi: 1 } } },
        craftedRecipeId: 'recipe_material',
        materialSources: [{ source: { signer: 'Ayla' }, count: 1 }],
      },
    ]);
  });

  it('spends unrecorded stock before a premium (signed) one, even when the premium sits at the LOWER index', () => {
    // Index order would take the premium copy first (it sits at index 0); the
    // canonical spend order (material_sources.ts compareMaterialSpendOrder)
    // takes unrecorded material first regardless of index, so the signed copy
    // at index 0 must survive untouched.
    const inv: InvSlot[] = [
      { itemId: MATERIAL_ID, count: 1, instance: { signer: 'Cedric' } },
      { itemId: MATERIAL_ID, count: 1 },
    ];
    const units = removeSellUnitsFromInventory(inv, MATERIAL_ID, 1);
    expect(units).toEqual([
      {
        instance: undefined,
        craftedRecipeId: undefined,
        materialSources: [{ source: {}, count: 1 }],
      },
    ]);
    expect(inv).toEqual([{ itemId: MATERIAL_ID, count: 1, instance: { signer: 'Cedric' } }]);
  });

  it('within one spend tier, the SAME descriptor is taken from the highest index first', () => {
    const inv: InvSlot[] = [
      { itemId: MATERIAL_ID, count: 1 },
      { itemId: MATERIAL_ID, count: 1 },
    ];
    removeSellUnitsFromInventory(inv, MATERIAL_ID, 1);
    // The index-1 copy left; index 0 is the one that survives.
    expect(inv).toEqual([{ itemId: MATERIAL_ID, count: 1 }]);
  });

  it('reports units in ascending stack-index order, never in spend-priority order', () => {
    // Spend priority takes index 2 (unrecorded, highest-index tiebreak) and
    // index 0 (unrecorded) before the premium index 1 copy, but the RETURNED
    // array is ordered by which STACK each unit came from, ascending: this is
    // the "canonical descriptor ordering... replaces blind index order"
    // contract, and it is a real behavior change from the old walk (which
    // reported highest-index-first).
    const inv: InvSlot[] = [
      { itemId: MATERIAL_ID, count: 1 }, // index 0: unrecorded
      { itemId: MATERIAL_ID, count: 1, instance: { signer: 'Ayla' } }, // index 1: premium
      { itemId: MATERIAL_ID, count: 1 }, // index 2: unrecorded
    ];
    const units = removeSellUnitsFromInventory(inv, MATERIAL_ID, 3);
    expect(units).toEqual([
      {
        instance: undefined,
        craftedRecipeId: undefined,
        materialSources: [{ source: {}, count: 1 }],
      },
      {
        instance: undefined,
        craftedRecipeId: undefined,
        materialSources: [{ source: { signer: 'Ayla' }, count: 1 }],
      },
      {
        instance: undefined,
        craftedRecipeId: undefined,
        materialSources: [{ source: {}, count: 1 }],
      },
    ]);
    expect(inv).toEqual([]);
  });

  it('skip/deprioritize are judged on the EFFECTIVE payload (source.signer), same contract as the instanced walk', () => {
    const deprioritize = (instance: ItemInstancePayload): boolean => instance.signer === 'Ayla';
    const inv: InvSlot[] = [
      { itemId: MATERIAL_ID, count: 1, instance: { signer: 'Cedric' } },
      { itemId: MATERIAL_ID, count: 1, instance: { signer: 'Ayla' } },
    ];
    const units = removeSellUnitsFromInventory(inv, MATERIAL_ID, 1, undefined, deprioritize);
    expect(units).toEqual([
      {
        instance: undefined,
        craftedRecipeId: undefined,
        materialSources: [{ source: { signer: 'Cedric' }, count: 1 }],
      },
    ]);
    expect(inv).toEqual([{ itemId: MATERIAL_ID, count: 1, instance: { signer: 'Ayla' } }]);
  });

  it('no unit aliases its source slot: two units off one bucket are independent objects', () => {
    const inv: InvSlot[] = [{ itemId: MATERIAL_ID, count: 2, instance: { signer: 'Ayla' } }];
    const units = removeSellUnitsFromInventory(inv, MATERIAL_ID, 2);
    expect(units).toHaveLength(2);
    expect(units[0].materialSources).not.toBe(units[1].materialSources);
    expect(units[0].materialSources![0].source).not.toBe(units[1].materialSources![0].source);
    expect(units[0].materialSources).toEqual(units[1].materialSources);
  });
});

describe('the ctx-taking wrapper', () => {
  it('fires the quest hook exactly once, AFTER the walk mutated the bags', () => {
    // The extraction hoisted the hook out of the walk into this wrapper;
    // deleting it there would silently kill collect-quest credit on every
    // vendor sale, mail parcel, and crafting consumption. The recorded count
    // proves the ORDER: a hook fired before the walk would still see 2.
    const meta = { inventory: [{ itemId: ID, count: 2 }] as InvSlot[] };
    const observed: number[] = [];
    const ctx = {
      resolve: () => ({ meta, e: {} }),
      onInventoryChangedForQuests: (m: { inventory: InvSlot[] }) => {
        observed.push(m.inventory[0]?.count ?? 0);
      },
    } as unknown as SimContext;
    const units = removeVendorSellUnits(ctx, ID, 1, 1);
    expect(units).toHaveLength(1);
    expect(observed, 'one fire, after the walk').toEqual([1]);
  });
});
