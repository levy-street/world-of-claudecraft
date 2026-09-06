// bags.ts through the material arm: countFit / addStacked / fitsAll and the
// capacity wrappers routed through them now answer from the shared packing leaf
// (src/sim/material_stack_packing.ts) for an honest material.
//
// Everything here runs on REAL content ids and the REAL derived material
// registry (nothing is injected, unlike the packing leaf's own suite), so the
// membership and stack-cap pins below are load-bearing: without them the whole
// file could be exercising the non-material arm and still be green.
//
// tests/bags.test.ts keeps the non-material contracts; the arms here that
// re-state one do so as a REGRESSION pin against the new branch, not a move.

import { describe, expect, it } from 'vitest';
import type { PoolCapacity } from '../src/sim/bag_pools';
import {
  addStacked,
  canAddItem,
  canGrantCopies,
  canGrantItemInstance,
  consumeOneScratch,
  countFit,
  fitsAll,
  freeBagSlotsFor,
  removeStacked,
  stackSizeOf,
} from '../src/sim/bags';
import { ITEMS } from '../src/sim/data';
import { materialItemIds } from '../src/sim/material_ids';
import type { MaterialComposition, MaterialSource } from '../src/sim/material_sources';
import type { InvSlot, ItemInstancePayload } from '../src/sim/types';

// Real shipped ids, classified by the assertions in the first block rather than
// assumed: two gathering materials, a food and a weapon that are not materials.
const ORE = 'copper_ore';
const IRON = 'iron_ore';
const FOOD = 'baked_bread';
const GEAR = 'worn_sword';

/** The junk-kind default cap these materials really carry; pinned below. */
const STACK = 20;

const ANA: MaterialSource = { gatherer: { kind: 'character', id: 11, name: 'Ana' } };
const BRU: MaterialSource = { gatherer: { kind: 'character', id: 22, name: 'Bru' } };
const UNRECORDED: MaterialSource = {};
const SIGNED_ANA: MaterialSource = { signer: 'Ana' };
const SIGNED_BRU: MaterialSource = { signer: 'Bru' };

/** Descriptor identity by FIELD, independent of the model's key encoding. */
const sameSource = (a: MaterialSource, b: MaterialSource): boolean => {
  if ((a.signer ?? null) !== (b.signer ?? null)) return false;
  const ga = a.gatherer;
  const gb = b.gatherer;
  if (ga === undefined || gb === undefined) return ga === gb;
  return ga.kind === gb.kind && ga.id === gb.id && ga.name === gb.name;
};

/** Units of one descriptor held across the WHOLE inventory. */
const unitsOf = (inventory: readonly InvSlot[], source: MaterialSource): number =>
  inventory.reduce(
    (total, slot) =>
      total +
      (slot.materialSources ?? [])
        .filter((entry) => sameSource(entry.source, source))
        .reduce((n, entry) => n + entry.count, 0),
    0,
  );

const totalUnits = (inventory: readonly InvSlot[], itemId: string): number =>
  inventory.filter((s) => s.itemId === itemId).reduce((n, s) => n + s.count, 0);

/** Any slot carrying a composition holds exactly the units it claims. */
const expectSourcesAgree = (inventory: readonly InvSlot[]): void => {
  for (const slot of inventory) {
    if (slot.materialSources === undefined) continue;
    const total = slot.materialSources.reduce((n, entry) => n + entry.count, 0);
    expect(total, slot.itemId).toBe(slot.count);
  }
};

const noPool = (general: number): PoolCapacity => ({ general, materials: 0 });

describe('the fixture ids, classified from the real registry', () => {
  it('the two ore ids ARE materials, the food and the weapon are not, at the real caps', () => {
    const materials = materialItemIds();
    expect(materials.has(ORE)).toBe(true);
    expect(materials.has(IRON)).toBe(true);
    expect(materials.has(FOOD)).toBe(false);
    expect(materials.has(GEAR)).toBe(false);
    // The arithmetic below is written against these caps, not against a guess.
    expect(stackSizeOf(ITEMS[ORE])).toBe(STACK);
    expect(stackSizeOf(ITEMS[IRON])).toBe(STACK);
    expect(stackSizeOf(ITEMS[FOOD])).toBe(STACK);
    expect(stackSizeOf(ITEMS[GEAR])).toBe(1);
  });
});

describe('countFit: differently sourced material shares real room', () => {
  it('lets differently signed and unrecorded legacy stacks all offer their top-up room', () => {
    const pools = noPool(3);
    const inventory: InvSlot[] = [
      { itemId: ORE, count: 6, instance: { signer: 'Ana' } },
      { itemId: ORE, count: 6, instance: { signer: 'Bru' } },
      { itemId: ORE, count: 5 },
    ];

    // Three slots for three stacks: no free slot at all, and 14 + 14 + 15 units
    // of top-up room that the identical-payload rule alone could never see.
    expect(freeBagSlotsFor(inventory, pools, ORE)).toBe(0);
    expect(countFit(inventory, pools, ORE, 43)).toBe(43);
    expect(countFit(inventory, pools, ORE, 44)).toBe(43);
    expect(canAddItem(inventory, pools, ORE, 43)).toBe(true);
    expect(canAddItem(inventory, pools, ORE, 44)).toBe(false);

    // The discriminator: the same shaped inventory of a NON-material still
    // answers the old way, seeing only the one byte-equal stack.
    const food: InvSlot[] = [
      { itemId: FOOD, count: 6, instance: { signer: 'Ana' } },
      { itemId: FOOD, count: 6, instance: { signer: 'Bru' } },
      { itemId: FOOD, count: 5 },
    ];
    expect(countFit(food, pools, FOOD, 99, { signer: 'Ana' })).toBe(14);
    expect(countFit(food, pools, FOOD, 99)).toBe(15);
  });

  it('lands the promised units in the existing stacks, taking no new slot', () => {
    const inventory: InvSlot[] = [
      { itemId: ORE, count: 6, instance: { signer: 'Ana' } },
      { itemId: ORE, count: 6, instance: { signer: 'Bru' } },
      { itemId: ORE, count: 5 },
    ];

    addStacked(inventory, ORE, 43);

    expect(inventory).toHaveLength(3);
    expect(inventory.map((s) => s.count)).toEqual([STACK, STACK, STACK]);
    expect(totalUnits(inventory, ORE)).toBe(60);
    expectSourcesAgree(inventory);
    // The legacy signers projected losslessly into their own buckets, and the
    // unsigned grant joined the unrecorded one. Nothing was invented.
    expect(unitsOf(inventory, SIGNED_ANA)).toBe(6);
    expect(unitsOf(inventory, SIGNED_BRU)).toBe(6);
    expect(unitsOf(inventory, UNRECORDED)).toBe(48);
    // The signer moved OFF the payload, so no stack still carries one.
    expect(inventory.every((s) => s.instance === undefined)).toBe(true);
  });

  it('tops up a compatible stack in a slot-full bag', () => {
    const pools = noPool(2);
    const inventory: InvSlot[] = [
      { itemId: GEAR, count: 1 },
      { itemId: ORE, count: 18, instance: { signer: 'Ana' } },
    ];

    expect(freeBagSlotsFor(inventory, pools, ORE)).toBe(0);
    expect(countFit(inventory, pools, ORE, 2, { signer: 'Bru' })).toBe(2);
    expect(countFit(inventory, pools, ORE, 3, { signer: 'Bru' })).toBe(2);

    addStacked(inventory, ORE, 2, { signer: 'Bru' });

    expect(inventory).toHaveLength(2);
    expect(inventory[1].count).toBe(STACK);
    expect(inventory[1].instance).toBeUndefined();
    expect(unitsOf(inventory, SIGNED_ANA)).toBe(18);
    expect(unitsOf(inventory, SIGNED_BRU)).toBe(2);
    // The unrelated gear slot was never read or rewritten.
    expect(inventory[0]).toEqual({ itemId: GEAR, count: 1 });
  });
});

describe('addStacked: exact units across the cap', () => {
  it('tops the partial stack to the cap, then splits the rest into capped stacks', () => {
    const pools = noPool(4);
    const inventory: InvSlot[] = [{ itemId: ORE, count: 15 }];

    // 5 into the open stack plus 3 free slots at the cap.
    expect(countFit(inventory, pools, ORE, 999)).toBe(65);

    addStacked(inventory, ORE, 48);

    expect(inventory.map((s) => s.count)).toEqual([STACK, STACK, STACK, 3]);
    expect(totalUnits(inventory, ORE)).toBe(63);
    expect(unitsOf(inventory, UNRECORDED)).toBe(63);
    expectSourcesAgree(inventory);
  });

  it('the fit prediction matches the slots the grant really uses', () => {
    const pools = noPool(5);
    const inventory: InvSlot[] = [{ itemId: ORE, count: 19, instance: { signer: 'Ana' } }];

    const fit = countFit(inventory, pools, ORE, 999);
    expect(fit).toBe(81); // 1 unit of merge room plus 4 fresh capped stacks
    expect(canAddItem(inventory, pools, ORE, fit)).toBe(true);
    expect(canAddItem(inventory, pools, ORE, fit + 1)).toBe(false);

    addStacked(inventory, ORE, fit);

    // Exactly the budget the gate promised, never one slot past it (#2139).
    expect(inventory).toHaveLength(pools.general);
    expect(totalUnits(inventory, ORE)).toBe(19 + fit);
    expect(unitsOf(inventory, SIGNED_ANA)).toBe(19);
    expect(unitsOf(inventory, UNRECORDED)).toBe(fit);
    expectSourcesAgree(inventory);
  });

  it('carries an explicit source composition into every stack it lands in', () => {
    const pools = noPool(3);
    const inventory: InvSlot[] = [{ itemId: ORE, count: 18 }];
    const sources: MaterialComposition = [
      { source: ANA, count: 10 },
      { source: BRU, count: 15 },
    ];

    expect(countFit(inventory, pools, ORE, 25, undefined, undefined, sources)).toBe(25);

    addStacked(inventory, ORE, 25, undefined, undefined, sources);

    expect(inventory.map((s) => s.count)).toEqual([STACK, STACK, 3]);
    // Which bucket landed in which stack is the algebra's spend order; what is
    // pinned here is that the TOTALS are exactly what went in.
    expect(unitsOf(inventory, ANA)).toBe(10);
    expect(unitsOf(inventory, BRU)).toBe(15);
    expect(unitsOf(inventory, UNRECORDED)).toBe(18);
    expect(totalUnits(inventory, ORE)).toBe(43);
    expectSourcesAgree(inventory);
    // The caller's own composition was not adopted by reference.
    expect(inventory.some((s) => s.materialSources === sources)).toBe(false);
  });

  it('answers a zero count exactly as it always did, stamping nothing', () => {
    const pools = noPool(1);
    const inventory: InvSlot[] = [{ itemId: ORE, count: STACK }];

    expect(countFit(inventory, pools, ORE, 0)).toBe(0);
    expect(canAddItem(inventory, pools, ORE, 0)).toBe(true);
    expect(canGrantCopies(inventory, pools, ORE, 0)).toBe(true);

    addStacked(inventory, ORE, 0);

    expect(inventory).toEqual([{ itemId: ORE, count: STACK }]);
  });
});

describe('fitsAll threads the sources on every add', () => {
  const stackOf = (itemId: string, count: number, source: MaterialSource): InvSlot => ({
    itemId,
    count,
    materialSources: [{ source, count }],
  });

  it('simulates a source-carrying batch cumulatively', () => {
    const pools = noPool(2);
    const adds: InvSlot[] = [stackOf(ORE, STACK, ANA), stackOf(ORE, STACK, BRU)];

    // Two capped stacks into two free slots, and not a unit more.
    expect(fitsAll([], pools, adds)).toBe(true);
    expect(fitsAll([], pools, [...adds, stackOf(ORE, 1, ANA)])).toBe(false);
  });

  it('lets an earlier add open the room the next add really uses', () => {
    const pools = noPool(1);
    // One free slot: the first add fills half a stack, the second finds the
    // room the scratch add left, even though its source differs.
    expect(fitsAll([], pools, [stackOf(ORE, 12, ANA), stackOf(ORE, 8, BRU)])).toBe(true);
    expect(fitsAll([], pools, [stackOf(ORE, 12, ANA), stackOf(ORE, 9, BRU)])).toBe(false);
    // A different GRADE cannot share that stack, so it needs a slot there is not.
    expect(fitsAll([], pools, [stackOf(ORE, 12, ANA), stackOf(IRON, 1, BRU)])).toBe(false);
  });

  it('refuses the whole batch when one add carries malformed provenance', () => {
    const pools = noPool(4);
    const malformed: InvSlot = {
      itemId: ORE,
      count: 2,
      materialSources: [{ source: ANA, count: 3 }],
    };

    expect(fitsAll([], pools, [malformed])).toBe(false);
    expect(fitsAll([], pools, [stackOf(ORE, 2, ANA), malformed])).toBe(false);
  });
});

describe('the owner grouping bags never overrides', () => {
  it('never tops up a separated block, and leaves it exactly as it was', () => {
    const pools = noPool(3);
    const inventory: InvSlot[] = [{ itemId: ORE, count: 5, materialSeparated: true }];

    // The separated block's 15 units of room are deliberately not offered:
    // only the two free slots answer.
    expect(countFit(inventory, pools, ORE, 999)).toBe(40);

    addStacked(inventory, ORE, 4);

    expect(inventory).toHaveLength(2);
    expect(inventory[0]).toEqual({ itemId: ORE, count: 5, materialSeparated: true });
    expect(inventory[1].count).toBe(4);
    // A fresh stack is not separated: bags has no incoming-grouping argument,
    // and a repack caller that wants one builds the slot itself.
    expect(inventory[1].materialSeparated).toBeUndefined();
    expect(unitsOf(inventory, UNRECORDED)).toBe(4);
  });

  it('the identical block without the grouping DOES take the top-up', () => {
    const pools = noPool(3);
    const inventory: InvSlot[] = [{ itemId: ORE, count: 5 }];

    expect(countFit(inventory, pools, ORE, 999)).toBe(55);
    addStacked(inventory, ORE, 4);
    expect(inventory).toHaveLength(1);
    expect(inventory[0].count).toBe(9);
  });
});

describe('malformed material provenance refuses, and refuses cleanly', () => {
  const pools = noPool(4);
  const malformedHeld = (): InvSlot[] => [
    { itemId: ORE, count: 3, materialSources: [{ source: ANA, count: 99 }] },
  ];

  it('answers a zero fit rather than reading the stack as unrecorded stock', () => {
    const held = malformedHeld();
    const before = structuredClone(held);

    expect(countFit(held, pools, ORE, 5)).toBe(0);
    expect(canAddItem(held, pools, ORE, 5)).toBe(false);
    expect(canGrantCopies(held, pools, ORE, 5)).toBe(false);
    expect(canGrantItemInstance(held, pools, ORE, { signer: 'Ana' }, 5)).toBe(false);
    expect(held).toEqual(before);

    // The discriminator: repair the composition and the SAME shape answers with
    // real room, so the zero above is the refusal and not an empty inventory.
    const sound: InvSlot[] = [
      { itemId: ORE, count: 3, materialSources: [{ source: ANA, count: 3 }] },
    ];
    expect(countFit(sound, pools, ORE, 5)).toBe(5);
  });

  it('refuses the grant before writing a single slot', () => {
    const held = malformedHeld();
    const before = structuredClone(held);

    expect(() => addStacked(held, ORE, 5)).toThrow();
    expect(held).toEqual(before);
  });

  it('refuses a malformed INCOMING composition the same way', () => {
    const bad: MaterialComposition = [{ source: ANA, count: 3 }];
    const inventory: InvSlot[] = [];

    expect(countFit(inventory, pools, ORE, 2, undefined, undefined, bad)).toBe(0);
    expect(() => addStacked(inventory, ORE, 2, undefined, undefined, bad)).toThrow();
    expect(inventory).toEqual([]);
  });
});

describe('every capacity wrapper agrees with countFit', () => {
  it('answers the same boundary through all four gates', () => {
    const pools = noPool(2);
    const inventory: InvSlot[] = [{ itemId: ORE, count: 18, instance: { signer: 'Ana' } }];

    // 2 units of merge room plus one fresh capped stack.
    expect(countFit(inventory, pools, ORE, 999)).toBe(22);
    expect(canAddItem(inventory, pools, ORE, 22)).toBe(true);
    expect(canAddItem(inventory, pools, ORE, 23)).toBe(false);
    expect(canGrantCopies(inventory, pools, ORE, 22)).toBe(true);
    expect(canGrantCopies(inventory, pools, ORE, 23)).toBe(false);
    // A differently signed grant now sees the same room, which is the point.
    expect(canGrantItemInstance(inventory, pools, ORE, { signer: 'Bru' }, 22)).toBe(true);
    expect(canGrantItemInstance(inventory, pools, ORE, { signer: 'Bru' }, 23)).toBe(false);
  });

  it('keeps the two-pool split: a material reaches materials headroom, a food does not', () => {
    const pools: PoolCapacity = { general: 1, materials: 2 };
    const inventory: InvSlot[] = [{ itemId: GEAR, count: 1 }];

    // General is full; the materials pool is still open to the ore alone.
    expect(countFit(inventory, pools, ORE, 999)).toBe(40);
    expect(countFit(inventory, pools, FOOD, 999)).toBe(0);
    expect(canGrantCopies(inventory, pools, ORE, 40)).toBe(true);
    expect(canGrantCopies(inventory, pools, ORE, 41)).toBe(false);
  });
});

describe('non-material behavior is unchanged by the material arm', () => {
  it('stacks food and gear exactly as before, stamping no sources', () => {
    const pools = noPool(3);
    const food: InvSlot[] = [{ itemId: FOOD, count: 5, instance: { signer: 'Ana' } }];

    expect(countFit(food, pools, FOOD, 99)).toBe(40);
    addStacked(food, FOOD, 3);
    expect(food).toEqual([
      { itemId: FOOD, count: 5, instance: { signer: 'Ana' } },
      { itemId: FOOD, count: 3 },
    ]);

    const gear: InvSlot[] = [];
    addStacked(gear, GEAR, 3);
    expect(gear).toEqual([
      { itemId: GEAR, count: 1 },
      { itemId: GEAR, count: 1 },
      { itemId: GEAR, count: 1 },
    ]);
  });

  it('keeps a charge-bearing NON-material one per fresh slot', () => {
    const pools = noPool(3);
    const charged = { signer: 'Ana', charges: { zap: 2 } };
    const inventory: InvSlot[] = [
      { itemId: FOOD, count: 1, instance: { ...charged, charges: { zap: 2 } } },
    ];

    expect(countFit(inventory, pools, FOOD, 99, charged)).toBe(2);
    addStacked(inventory, FOOD, 2, charged);
    expect(inventory).toHaveLength(3);
    for (const slot of inventory) expect(slot.count).toBe(1);
  });

  it('keeps a charge-bearing MATERIAL one per fresh slot too, now via the core', () => {
    const pools = noPool(3);
    const charged = { charges: { zap: 2 } };
    const inventory: InvSlot[] = [{ itemId: ORE, count: 5 }];

    // The plain stack offers a charged add nothing, and each free slot holds one.
    expect(countFit(inventory, pools, ORE, 99, charged)).toBe(2);

    addStacked(inventory, ORE, 2, charged);

    expect(inventory).toHaveLength(3);
    expect(inventory[0]).toEqual({ itemId: ORE, count: 5 });
    expect(inventory[1].count).toBe(1);
    expect(inventory[2].count).toBe(1);
    expect(inventory[1].instance).toEqual(charged);
    expect(inventory[1].instance).not.toBe(inventory[2].instance);
    expect(unitsOf(inventory, UNRECORDED)).toBe(2);
    expectSourcesAgree(inventory);
  });

  it('keeps the legacy end-first walk when removing a NON-material', () => {
    const inventory: InvSlot[] = [
      { itemId: FOOD, count: 3 },
      { itemId: FOOD, count: 3 },
    ];

    removeStacked(inventory, FOOD, 4);

    expect(inventory).toEqual([{ itemId: FOOD, count: 2 }]);
  });

  it('keeps a crafted-marker mismatch apart for a material, as for anything else', () => {
    const pools = noPool(3);
    const inventory: InvSlot[] = [
      { itemId: ORE, count: 5, craftedRecipeId: 'recipe_a' },
      { itemId: ORE, count: 5, craftedRecipeId: 'recipe_b' },
    ];

    // Only the matching marker offers room; the other stack is not a target.
    expect(countFit(inventory, pools, ORE, 999, undefined, 'recipe_a')).toBe(35);
    addStacked(inventory, ORE, 15, undefined, 'recipe_a');
    expect(inventory).toHaveLength(2);
    expect(inventory[0].count).toBe(STACK);
    expect(inventory[0].craftedRecipeId).toBe('recipe_a');
    expect(inventory[1]).toEqual({ itemId: ORE, count: 5, craftedRecipeId: 'recipe_b' });
  });
});

describe('removeStacked spends material through the shared planner', () => {
  it('takes unrecorded material before premium, across stacks', () => {
    const inventory: InvSlot[] = [
      { itemId: ORE, count: 5, instance: { signer: 'Ana' } },
      { itemId: ORE, count: 5 },
    ];

    removeStacked(inventory, ORE, 5);

    // The signed stack survives whole, and untouched stacks are not rewritten.
    expect(inventory).toEqual([{ itemId: ORE, count: 5, instance: { signer: 'Ana' } }]);
  });

  it('conserves every descriptor and spends the plain buckets first', () => {
    const inventory: InvSlot[] = [
      {
        itemId: ORE,
        count: 4,
        materialSources: [
          { source: ANA, count: 2 },
          { source: SIGNED_ANA, count: 2 },
        ],
      },
      { itemId: ORE, count: 3, materialSources: [{ source: BRU, count: 3 }] },
    ];

    removeStacked(inventory, ORE, 5);

    // Exactly the five plain units; both premium units survive.
    expect(unitsOf(inventory, ANA)).toBe(0);
    expect(unitsOf(inventory, BRU)).toBe(0);
    expect(unitsOf(inventory, SIGNED_ANA)).toBe(2);
    expect(totalUnits(inventory, ORE)).toBe(2);
    expectSourcesAgree(inventory);
  });

  it('takes only what is held, never refusing a shortfall', () => {
    const inventory: InvSlot[] = [{ itemId: ORE, count: 3 }];

    removeStacked(inventory, ORE, 10);

    expect(inventory).toEqual([]);
  });

  it('leaves a LOCKED stack alone while spending the rest', () => {
    const inventory: InvSlot[] = [
      { itemId: ORE, count: 4, instance: { locked: true } },
      { itemId: ORE, count: 4 },
    ];

    removeStacked(inventory, ORE, 6);

    // Only the four unlocked units were ever spendable.
    expect(inventory).toEqual([{ itemId: ORE, count: 4, instance: { locked: true } }]);
  });

  it('DOES spend a separated block, without merging it into anything', () => {
    const inventory: InvSlot[] = [
      { itemId: ORE, count: 3, materialSeparated: true },
      { itemId: ORE, count: 3 },
    ];

    removeStacked(inventory, ORE, 4);

    expect(inventory).toHaveLength(1);
    expect(inventory[0].materialSeparated).toBe(true);
    expect(inventory[0].count).toBe(2);
  });

  it('refuses malformed provenance before writing anything', () => {
    const inventory: InvSlot[] = [
      { itemId: ORE, count: 3, materialSources: [{ source: ANA, count: 99 }] },
    ];
    const before = structuredClone(inventory);

    expect(() => removeStacked(inventory, ORE, 1)).toThrow();
    expect(inventory).toEqual(before);
  });

  it('leaves a zero or negative count as the no-op it always was', () => {
    const inventory: InvSlot[] = [{ itemId: ORE, count: 3 }];

    removeStacked(inventory, ORE, 0);
    removeStacked(inventory, ORE, -2);

    expect(inventory).toEqual([{ itemId: ORE, count: 3 }]);
  });
});

describe('consumeOneScratch reports the unit it really spent', () => {
  it('stamps the SPENT descriptor legacy signer back onto the reported payload', () => {
    const scratch: InvSlot[] = [
      { itemId: ORE, count: 2, materialSources: [{ source: SIGNED_ANA, count: 2 }] },
    ];

    const payload = consumeOneScratch(scratch, ORE);

    // The transform commands still read `.signer` off this payload, even though
    // the signer now lives in the bucket.
    expect(payload).toEqual({ signer: 'Ana' });
    expect(scratch[0].count).toBe(1);
    expect(unitsOf(scratch, SIGNED_ANA)).toBe(1);
    expectSourcesAgree(scratch);
  });

  it('preserves an EMPTY-string legacy signer, which is not premium', () => {
    const scratch: InvSlot[] = [
      { itemId: ORE, count: 2, materialSources: [{ source: { signer: '' }, count: 2 }] },
    ];

    expect(consumeOneScratch(scratch, ORE)).toEqual({ signer: '' });
  });

  it('never turns a gatherer alone into a signer', () => {
    const scratch: InvSlot[] = [
      { itemId: ORE, count: 2, materialSources: [{ source: ANA, count: 2 }] },
    ];

    expect(consumeOneScratch(scratch, ORE)).toBeUndefined();
    expect(unitsOf(scratch, ANA)).toBe(1);
  });

  it('spends unrecorded material before premium', () => {
    const scratch: InvSlot[] = [
      { itemId: ORE, count: 1, materialSources: [{ source: SIGNED_ANA, count: 1 }] },
      { itemId: ORE, count: 1 },
    ];

    expect(consumeOneScratch(scratch, ORE)).toBeUndefined();
    expect(scratch).toHaveLength(1);
    expect(unitsOf(scratch, SIGNED_ANA)).toBe(1);
  });

  it('ranks by the canonical source order, NOT by whether a stack has a payload', () => {
    const scratch: InvSlot[] = [
      { itemId: ORE, count: 1 },
      { itemId: ORE, count: 1, instance: { boundTo: 7 } },
    ];

    // Both units are unrecorded, so the one descriptor ties and the highest
    // index wins. A remaining payload is not a spend priority for a material:
    // the legacy plain-slot-first walk would have taken index 0 instead.
    expect(consumeOneScratch(scratch, ORE)).toEqual({ boundTo: 7 });
    expect(scratch).toEqual([{ itemId: ORE, count: 1 }]);
  });

  it('never burns a premium unit while plain material sits in a payload-bearing stack', () => {
    const scratch: InvSlot[] = [
      // Bound, but the unit inside it is ordinary unrecorded stock.
      {
        itemId: ORE,
        count: 1,
        instance: { boundTo: 7 },
        materialSources: [{ source: UNRECORDED, count: 1 }],
      },
      // No payload left at all, but its only unit is premium.
      { itemId: ORE, count: 1, materialSources: [{ source: SIGNED_ANA, count: 1 }] },
    ];

    // The discriminator for the whole correction: a raw plain-slot-first walk
    // sees index 1 as the only "plain slot" and spends the last premium unit.
    expect(consumeOneScratch(scratch, ORE)).toEqual({ boundTo: 7 });
    expect(scratch).toHaveLength(1);
    expect(unitsOf(scratch, SIGNED_ANA)).toBe(1);
  });

  it('answers the same for a raw legacy stack and its normalized twin', () => {
    const raw: InvSlot[] = [{ itemId: ORE, count: 2, instance: { signer: 'Ana' } }];
    const normalized: InvSlot[] = [
      { itemId: ORE, count: 2, materialSources: [{ source: SIGNED_ANA, count: 2 }] },
    ];

    // Representation changed at load and grant; the spend answer must not.
    expect(consumeOneScratch(raw, ORE)).toEqual({ signer: 'Ana' });
    expect(consumeOneScratch(normalized, ORE)).toEqual({ signer: 'Ana' });
    expect(raw).toEqual(normalized);
    expectSourcesAgree(raw);
  });

  it('honours excludeInstance first, and reaches the excluded units only last', () => {
    const scratch: InvSlot[] = [
      { itemId: ORE, count: 1, instance: { enchant: 'enchant_a' } },
      { itemId: ORE, count: 1, instance: { boundTo: 7 } },
    ];
    const isEnchanted = (p: ItemInstancePayload): boolean => p.enchant !== undefined;

    expect(consumeOneScratch(scratch, ORE, isEnchanted)).toEqual({ boundTo: 7 });
    expect(scratch).toEqual([{ itemId: ORE, count: 1, instance: { enchant: 'enchant_a' } }]);

    // Nothing unexcluded is left, so the fallback pass takes the excluded unit.
    expect(consumeOneScratch(scratch, ORE, isEnchanted)).toEqual({ enchant: 'enchant_a' });
    expect(scratch).toEqual([]);
  });

  it('judges the exclusion on the EFFECTIVE payload, and it outranks the source order', () => {
    const scratch: InvSlot[] = [
      // Source-preferred (unrecorded) but excluded by its payload.
      {
        itemId: ORE,
        count: 1,
        instance: { enchant: 'enchant_a' },
        materialSources: [{ source: UNRECORDED, count: 1 }],
      },
      // Source-LAST (premium) but not excluded; its signer lives in the
      // descriptor, so only the effective payload can carry it back out.
      {
        itemId: ORE,
        count: 1,
        instance: { boundTo: 7 },
        materialSources: [{ source: SIGNED_ANA, count: 1 }],
      },
    ];

    const payload = consumeOneScratch(scratch, ORE, (p) => p.enchant !== undefined);

    expect(payload).toEqual({ boundTo: 7, signer: 'Ana' });
    expect(scratch).toHaveLength(1);
    expect(unitsOf(scratch, UNRECORDED)).toBe(1);
  });

  it('never spends a LOCKED material unit, in either pass', () => {
    const scratch: InvSlot[] = [{ itemId: ORE, count: 2, instance: { locked: true } }];
    const before = structuredClone(scratch);

    expect(consumeOneScratch(scratch, ORE)).toBeUndefined();
    expect(consumeOneScratch(scratch, ORE, (p) => p.enchant !== undefined)).toBeUndefined();
    expect(scratch).toEqual(before);
  });

  it('answers undefined when no stack of the material is held', () => {
    const scratch: InvSlot[] = [{ itemId: FOOD, count: 2 }];

    expect(consumeOneScratch(scratch, ORE)).toBeUndefined();
    expect(scratch).toEqual([{ itemId: FOOD, count: 2 }]);
  });

  it('refuses malformed provenance before writing anything', () => {
    const scratch: InvSlot[] = [
      { itemId: ORE, count: 3, materialSources: [{ source: ANA, count: 99 }] },
    ];
    const before = structuredClone(scratch);

    expect(() => consumeOneScratch(scratch, ORE)).toThrow();
    expect(scratch).toEqual(before);
  });

  it('predicts exactly what a one-unit removeStacked really does', () => {
    // The #2139 property on the spend side: a capacity simulation that models
    // the removal differently from the remover it gates is a defect.
    const build = (): InvSlot[] => [
      { itemId: ORE, count: 2, materialSources: [{ source: SIGNED_ANA, count: 2 }] },
      { itemId: ORE, count: 2, materialSources: [{ source: ANA, count: 2 }] },
    ];

    const scratch = build();
    consumeOneScratch(scratch, ORE);
    const real = build();
    removeStacked(real, ORE, 1);

    expect(scratch).toEqual(real);
    expect(unitsOf(scratch, SIGNED_ANA)).toBe(2);
  });
});
