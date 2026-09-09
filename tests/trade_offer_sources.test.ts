// The source-aware half of a player trade (src/sim/social/trade_offer_sources.ts),
// driven directly over real inventory arrays. These are the decisive cases for
// the custody promise the program contract makes about trading material: the
// exact quantities a player pinned are the ones that leave, a pinned choice is
// never quietly substituted, and a restricted bucket narrows an offer instead of
// refusing or laundering the row it sits in.

import { describe, expect, it } from 'vitest';
import { isMaterialItemId } from '../src/sim/material_ids';
import type { MaterialComposition, MaterialSource } from '../src/sim/material_sources';
import {
  carriersReadable,
  mergedUnitSources,
  offerEligibleSource,
  pinnedOfferSources,
  pinnedTradeUnits,
  plainGrantBatches,
  unitGrantCarriers,
} from '../src/sim/social/trade_offer_sources';
import type { InventoryUnit, InvSlot, ItemInstancePayload } from '../src/sim/types';

// A real material (kind 'junk' AND a recipe reagent), pinned below so a
// derivation change that reclassified it fails here rather than turning every
// case in this file into a study of the non-material path.
const MATERIAL = 'wolf_fang';

const ANA: MaterialSource = { gatherer: { kind: 'character', id: 11, name: 'Ana' } };
const BRU: MaterialSource = { gatherer: { kind: 'character', id: 12, name: 'Bru' } };
const SIGNED: MaterialSource = { signer: 'Cyd' };
const UNRECORDED: MaterialSource = {};

const held = (source: MaterialSource, count: number) => ({ source, count });
const unit = (source: MaterialSource, extra: Partial<InventoryUnit> = {}): InventoryUnit => ({
  instance: undefined,
  craftedRecipeId: undefined,
  materialSources: [held(source, 1)],
  ...extra,
});

/** A mixed stack: four unrecorded units, three of Ana's, two premium-signed. */
const mixedStack = (): InvSlot => ({
  itemId: MATERIAL,
  count: 9,
  materialSources: [held(UNRECORDED, 4), held(ANA, 3), held(SIGNED, 2)],
});

/** Nothing skipped: the ordinary unrestricted offer. */
const allowAll = () => false;

describe('trade offer source fixtures', () => {
  it('runs on a REAL material, so every case below exercises the source path', () => {
    expect(isMaterialItemId(MATERIAL)).toBe(true);
  });
});

describe('pinnedOfferSources', () => {
  it('reads a staged line as pinned only when it really carries a composition', () => {
    expect(pinnedOfferSources({ itemId: MATERIAL, count: 3 })).toBeUndefined();
    // Present empty provenance must reach the pinned refusal path. Treating it
    // as absent would silently select different stock through the legacy path.
    expect(pinnedOfferSources({ itemId: MATERIAL, count: 3, materialSources: [] })).toEqual([]);
    expect(
      pinnedOfferSources({ itemId: MATERIAL, count: 3, materialSources: [held(ANA, 3)] }),
    ).toEqual([held(ANA, 3)]);
  });
});

describe('pinnedTradeUnits', () => {
  it('moves EXACTLY the pinned descriptors and leaves the rest of the block in place', () => {
    const inventory: InvSlot[] = [mixedStack()];

    const units = pinnedTradeUnits({
      inventory,
      itemId: MATERIAL,
      sources: [held(UNRECORDED, 2), held(ANA, 1)],
      skip: allowAll,
    });

    expect(units).not.toBeNull();
    // Three units left, one per unit, each carrying its own one-unit bucket.
    expect(units?.map((u) => u.materialSources)).toEqual([
      [held(UNRECORDED, 1)],
      [held(UNRECORDED, 1)],
      [held(ANA, 1)],
    ]);
    // The SOURCE BUDGET on the giver's side is intact: two unrecorded and one
    // of Ana's are gone, every other bucket is untouched, and the survivor's
    // buckets still sum to its own count. The remainder is re-emitted in the
    // ALGEBRA's canonical key order (a signer-only descriptor sorts ahead of a
    // gatherer-bearing one), which is not the order the stack was written in.
    expect(inventory).toEqual([
      {
        itemId: MATERIAL,
        count: 6,
        materialSources: [held(UNRECORDED, 2), held(SIGNED, 2), held(ANA, 2)],
      },
    ]);
  });

  it('refuses a pinned descriptor the bags no longer cover, substituting nothing', () => {
    // Ana's units are gone since staging; the offer pinned three of them.
    const inventory: InvSlot[] = [
      { itemId: MATERIAL, count: 9, materialSources: [held(UNRECORDED, 9)] },
    ];
    const before = structuredClone(inventory);

    const units = pinnedTradeUnits({
      inventory,
      itemId: MATERIAL,
      sources: [held(ANA, 3)],
      skip: allowAll,
    });

    // Null, not three unrecorded units: a shortfall in a PINNED choice is a
    // refusal. Substituting here would ship a stranger's provenance under an
    // agreement that named Ana.
    expect(units).toBeNull();
    expect(inventory).toEqual(before);
  });

  it('refuses a partial pinned take rather than shipping the part it could cover', () => {
    const inventory: InvSlot[] = [{ itemId: MATERIAL, count: 2, materialSources: [held(ANA, 2)] }];
    const before = structuredClone(inventory);

    expect(
      pinnedTradeUnits({
        inventory,
        itemId: MATERIAL,
        sources: [held(ANA, 3)],
        skip: allowAll,
      }),
    ).toBeNull();
    expect(inventory).toEqual(before);
  });

  it('spends a restricted row down to its ELIGIBLE buckets instead of refusing it whole', () => {
    // The skip excludes premium-signed units (the effective per-unit payload
    // carries the signer). The unrecorded and gatherer-attributed units in the
    // SAME row stay perfectly tradeable.
    const inventory: InvSlot[] = [mixedStack()];
    const skip = (instance: ItemInstancePayload | undefined) => instance?.signer !== undefined;

    const units = pinnedTradeUnits({
      inventory,
      itemId: MATERIAL,
      sources: [held(UNRECORDED, 4), held(ANA, 3)],
      skip,
    });

    expect(units).toHaveLength(7);
    // The signed pair never moved, and it kept its own bucket: the row was
    // narrowed, not stripped of identity and not refused.
    expect(inventory).toEqual([{ itemId: MATERIAL, count: 2, materialSources: [held(SIGNED, 2)] }]);
  });

  it('refuses when the pinned choice names a bucket the skip excludes', () => {
    const inventory: InvSlot[] = [mixedStack()];
    const before = structuredClone(inventory);
    const skip = (instance: ItemInstancePayload | undefined) => instance?.signer !== undefined;

    // No silent downgrade to the eligible units: the pin named the signed
    // bucket, the predicate forbids it, so the whole take refuses.
    expect(
      pinnedTradeUnits({ inventory, itemId: MATERIAL, sources: [held(SIGNED, 1)], skip }),
    ).toBeNull();
    expect(inventory).toEqual(before);
  });

  it('takes one block across two stacks of the same material', () => {
    const inventory: InvSlot[] = [
      { itemId: MATERIAL, count: 3, materialSources: [held(ANA, 3)] },
      { itemId: MATERIAL, count: 2, materialSources: [held(ANA, 2)] },
    ];

    const units = pinnedTradeUnits({
      inventory,
      itemId: MATERIAL,
      sources: [held(ANA, 4)],
      skip: allowAll,
    });

    expect(units).toHaveLength(4);
    // Exactly four of Ana's units left, and the remaining one is still hers.
    const remaining = inventory.filter((s) => s.count > 0);
    expect(remaining.reduce((n, s) => n + s.count, 0)).toBe(1);
    expect(remaining[0].materialSources).toEqual([held(ANA, 1)]);
  });

  it('writes nothing when asked for an empty pin', () => {
    const inventory: InvSlot[] = [mixedStack()];
    const before = structuredClone(inventory);
    expect(
      pinnedTradeUnits({ inventory, itemId: MATERIAL, sources: [], skip: allowAll }),
    ).toBeNull();
    expect(inventory).toEqual(before);
  });
});

describe('offerEligibleSource', () => {
  it('asks the skip about the EFFECTIVE per-unit payload, one bucket at a time', () => {
    const eligible = offerEligibleSource((instance) => instance?.signer !== undefined);
    const slot = mixedStack();
    // Same row, three different answers: the signer lives in the descriptor
    // now, so a whole-stack reading would have to pick one of these for all.
    expect(eligible(UNRECORDED, slot)).toBe(true);
    expect(eligible(ANA, slot)).toBe(true);
    expect(eligible(SIGNED, slot)).toBe(false);
  });

  it('does not treat a recorded gatherer as a signature', () => {
    // Provenance is not premium: a skip written against `signer` must not start
    // excluding ordinary gathered units merely because they gained attribution.
    const eligible = offerEligibleSource((instance) => !!instance?.signer);
    expect(eligible(ANA, mixedStack())).toBe(true);
  });
});

describe('mergedUnitSources', () => {
  it('coalesces identical descriptors and keeps distinct ones apart', () => {
    const merged = mergedUnitSources([unit(ANA), unit(ANA), unit(BRU)]);
    expect(merged.ok).toBe(true);
    expect(merged.ok && merged.value).toEqual([held(ANA, 2), held(BRU, 1)]);
  });

  it('reports no composition at all for legacy sourceless units', () => {
    const merged = mergedUnitSources([
      { instance: undefined, craftedRecipeId: undefined },
      { instance: undefined, craftedRecipeId: undefined },
    ]);
    expect(merged.ok && merged.value).toBeUndefined();
  });

  it('REPORTS a malformed composition rather than dropping the attribution', () => {
    const broken = [{ source: ANA, count: 0 }] as unknown as MaterialComposition;
    const merged = mergedUnitSources([unit(ANA), { ...unit(BRU), materialSources: broken }]);
    expect(merged.ok).toBe(false);
  });
});

describe('plainGrantBatches', () => {
  it('keeps a bulk material line as ONE grant carrying every contributor', () => {
    const units = [unit(UNRECORDED), unit(ANA), unit(ANA), unit(BRU)];

    const batches = plainGrantBatches(units);

    expect(batches.ok).toBe(true);
    expect(batches.ok && batches.value).toEqual([
      {
        craftedRecipeId: undefined,
        count: 4,
        materialSources: [held(UNRECORDED, 1), held(ANA, 2), held(BRU, 1)],
      },
    ]);
  });

  it('still splits by crafted marker, with each batch carrying its own sources', () => {
    const units = [
      unit(ANA),
      unit(BRU, { craftedRecipeId: 'r_one' }),
      unit(BRU, { craftedRecipeId: 'r_one' }),
    ];

    const batches = plainGrantBatches(units);

    expect(batches.ok && batches.value).toEqual([
      { craftedRecipeId: undefined, count: 1, materialSources: [held(ANA, 1)] },
      { craftedRecipeId: 'r_one', count: 2, materialSources: [held(BRU, 2)] },
    ]);
  });

  it('answers carriersReadable on the SAME question the batching asks', () => {
    const broken = [{ source: ANA, count: 0 }] as unknown as MaterialComposition;
    expect(carriersReadable(MATERIAL, [unit(ANA), unit(BRU)])).toBe(true);
    expect(carriersReadable(MATERIAL, [{ ...unit(ANA), materialSources: broken }])).toBe(false);
  });

  it('falls back to one merge-free carrier per unit, which cannot itself refuse', () => {
    // The rollback shape: no merging, so a composition the batching could not
    // read still travels back to its owner rather than being dropped.
    const broken = [{ source: ANA, count: 0 }] as unknown as MaterialComposition;
    const units = [unit(ANA), { ...unit(BRU), materialSources: broken }];
    expect(plainGrantBatches(units).ok).toBe(false);

    const carriers = unitGrantCarriers(units);

    // Every unit is accounted for, each keeping its own composition verbatim.
    expect(carriers).toHaveLength(2);
    expect(carriers.reduce((n, c) => n + c.count, 0)).toBe(2);
    expect(carriers[0]).toEqual({
      craftedRecipeId: undefined,
      count: 1,
      materialSources: [held(ANA, 1)],
    });
    expect(carriers[1].materialSources).toBe(broken);
  });

  it('leaves payload-bearing units to the instanced arm', () => {
    const instanced: InventoryUnit = {
      instance: { charges: { zap: 1 } },
      craftedRecipeId: undefined,
      materialSources: [held(ANA, 1)],
    };
    const batches = plainGrantBatches([unit(BRU), instanced]);
    expect(batches.ok && batches.value).toEqual([
      { craftedRecipeId: undefined, count: 1, materialSources: [held(BRU, 1)] },
    ]);
  });
});

describe('mergedUnitSources validates EVERY present composition', () => {
  /** A carrier whose composition claims a quantity a ONE-unit carrier cannot
   *  hold. Nothing downstream can tell this from a legitimate merge result once
   *  it is inside a batch, so it has to refuse at the door. */
  const inflated = (): InventoryUnit => ({
    instance: undefined,
    craftedRecipeId: undefined,
    materialSources: [held(ANA, 5)],
  });

  it('refuses a corrupt composition even when it arrives FIRST', () => {
    // The defect: the first present composition was adopted verbatim and only
    // later ones were merged, so a single-unit group was never checked at all.
    expect(mergedUnitSources([inflated()]).ok).toBe(false);
    expect(mergedUnitSources([inflated(), unit(BRU)]).ok).toBe(false);
    // ...and still refuses when it arrives second, which always worked.
    expect(mergedUnitSources([unit(BRU), inflated()]).ok).toBe(false);
  });

  it('refuses a malformed descriptor in the leading position', () => {
    const bad: InventoryUnit = {
      instance: undefined,
      craftedRecipeId: undefined,
      materialSources: [
        { source: { gatherer: { kind: 'sky', id: 1, name: 'Nobody' } }, count: 1 },
      ] as unknown as MaterialComposition,
    };

    expect(mergedUnitSources([bad]).ok).toBe(false);
    expect(mergedUnitSources([bad, unit(ANA)]).ok).toBe(false);
  });

  it('refuses an EXPLICITLY EMPTY composition instead of reading it as absent', () => {
    // An absent list is legacy stock. A present-but-empty list is a carrier
    // claiming to describe zero units, which for a one-unit carrier is
    // malformed data, and skipping it silently dropped that unit's provenance.
    const empty: InventoryUnit = {
      instance: undefined,
      craftedRecipeId: undefined,
      materialSources: [],
    };

    expect(mergedUnitSources([empty]).ok).toBe(false);
    expect(mergedUnitSources([unit(ANA), empty]).ok).toBe(false);
    expect(mergedUnitSources([empty, unit(ANA)]).ok).toBe(false);
  });

  it('refuses a zero or negative bucket count', () => {
    const zero: InventoryUnit = {
      instance: undefined,
      craftedRecipeId: undefined,
      materialSources: [held(ANA, 0)],
    };
    const signed: InventoryUnit = {
      instance: undefined,
      craftedRecipeId: undefined,
      materialSources: [held(ANA, 2), held(BRU, -1)],
    };

    expect(mergedUnitSources([zero]).ok).toBe(false);
    // Totals 1, so only the algebra's own count rule can catch it.
    expect(mergedUnitSources([signed]).ok).toBe(false);
  });

  it('keeps ALL-absent units legacy: nothing recorded pins nothing', () => {
    const legacy: InventoryUnit = {
      instance: undefined,
      craftedRecipeId: undefined,
      materialSources: undefined,
    };

    const merged = mergedUnitSources([legacy, legacy, legacy]);
    expect(merged.ok && merged.value).toBeUndefined();
  });

  it('retains the UNKNOWN count when absent and present units are mixed', () => {
    // The conservation defect: the absent units used to contribute nothing, so
    // a three-unit batch shipped a composition describing one unit. They are
    // units whose gatherer nobody recorded, and they must say so.
    const legacy: InventoryUnit = {
      instance: undefined,
      craftedRecipeId: undefined,
      materialSources: undefined,
    };

    const merged = mergedUnitSources([legacy, unit(ANA), legacy]);
    expect(merged.ok).toBe(true);
    const value = merged.ok ? (merged.value ?? []) : [];
    expect(value.reduce((n, entry) => n + entry.count, 0)).toBe(3);
    expect(value).toEqual(expect.arrayContaining([held(UNRECORDED, 2), held(ANA, 1)]));
  });

  it('still coalesces identical descriptors into one bucket', () => {
    const merged = mergedUnitSources([unit(ANA), unit(ANA), unit(BRU)]);
    expect(merged.ok && merged.value).toEqual(expect.arrayContaining([held(ANA, 2), held(BRU, 1)]));
  });
});

describe('carriersReadable preflights INSTANCED carriers too', () => {
  const instancedWith = (sources: MaterialComposition | undefined): InventoryUnit => ({
    instance: { charges: { zap: 1 } },
    craftedRecipeId: undefined,
    materialSources: sources,
  });

  it('refuses a corrupt composition on a payload-bearing unit', () => {
    // The defect: plainGrantBatches skips instanced units, so asking it alone
    // preflighted the payload-free subset only and a corrupt instanced
    // composition reached the grant with both sides' goods already moved.
    expect(carriersReadable(MATERIAL, [instancedWith([held(ANA, 5)])])).toBe(false);
    expect(carriersReadable(MATERIAL, [instancedWith([])])).toBe(false);
    expect(carriersReadable(MATERIAL, [unit(BRU), instancedWith([held(ANA, 0)])])).toBe(false);
  });

  it('refuses an AMBIGUOUS carrier: a composition beside a payload signer', () => {
    // Two conflicting records of who signed the unit. A composition-only check
    // waves it through and the GRANT then refuses it, after both sides'
    // removals have run, which is the one outcome a trade must never reach.
    const ambiguous: InventoryUnit = {
      instance: { signer: 'Cyd' },
      craftedRecipeId: undefined,
      materialSources: [held(ANA, 1)],
    };

    expect(carriersReadable(MATERIAL, [ambiguous])).toBe(false);
    expect(carriersReadable(MATERIAL, [unit(BRU), ambiguous])).toBe(false);
    // The same payload WITHOUT a composition is ordinary legacy stock, and the
    // same composition without the payload signer is ordinary recorded stock:
    // it is the pair that is unreadable, so neither half is refused alone.
    expect(
      carriersReadable(MATERIAL, [
        { instance: { signer: 'Cyd' }, craftedRecipeId: undefined, materialSources: undefined },
      ]),
    ).toBe(true);
    expect(carriersReadable(MATERIAL, [unit(ANA)])).toBe(true);
  });

  it('accepts a sound instanced carrier and a legacy one', () => {
    expect(carriersReadable(MATERIAL, [instancedWith([held(ANA, 1)])])).toBe(true);
    expect(carriersReadable(MATERIAL, [instancedWith(undefined)])).toBe(true);
    expect(carriersReadable(MATERIAL, [unit(ANA), instancedWith([held(BRU, 1)])])).toBe(true);
  });

  it('leaves a NON-material id to the batching question alone', () => {
    // Outside the taxonomy the shared normalize would answer `not-material` for
    // every unit, so the item gate is what keeps an ordinary equipment trade on
    // exactly the check it always had.
    const gear = 'worn_sword';
    expect(isMaterialItemId(gear)).toBe(false);
    expect(carriersReadable(gear, [instancedWith(undefined)])).toBe(true);
    expect(carriersReadable(gear, [{ ...unit(ANA), materialSources: undefined }])).toBe(true);
  });
});

describe('pinnedTradeUnits pins the WHOLE staged identity', () => {
  const ENCHANT: ItemInstancePayload = { enchant: 'flame_weapon' };

  /** Two stacks holding the SAME descriptor behind different identities. */
  const twoIdentities = (): InvSlot[] => [
    { itemId: MATERIAL, count: 2, materialSources: [held(ANA, 2)], instance: { ...ENCHANT } },
    { itemId: MATERIAL, count: 2, materialSources: [held(ANA, 2)] },
  ];

  it('ships the pinned PAYLOAD, never a descriptor-equal twin behind another one', () => {
    // The substitution defect: the take matched on item plus sources only, so a
    // line that staged the plain copy could consume the enchanted one, which is
    // the copy-swap the per-copy pin exists to prevent.
    const inventory = twoIdentities();

    const units = pinnedTradeUnits({
      inventory,
      itemId: MATERIAL,
      sources: [held(ANA, 2)],
      instance: undefined,
      craftedRecipeId: undefined,
      skip: allowAll,
    });

    expect(units).not.toBeNull();
    expect(units).toHaveLength(2);
    for (const u of units ?? []) expect(u.instance).toBeUndefined();
    // The enchanted stack is untouched: it was never what the line staged.
    expect(inventory).toHaveLength(1);
    expect(inventory[0].instance).toEqual(ENCHANT);
    expect(inventory[0].count).toBe(2);
  });

  it('ships the pinned ENCHANTED copy when that is what was staged', () => {
    const inventory = twoIdentities();

    const units = pinnedTradeUnits({
      inventory,
      itemId: MATERIAL,
      sources: [held(ANA, 2)],
      instance: { ...ENCHANT },
      craftedRecipeId: undefined,
      skip: allowAll,
    });

    expect(units).toHaveLength(2);
    for (const u of units ?? []) expect(u.instance).toEqual(ENCHANT);
    expect(inventory).toHaveLength(1);
    expect(inventory[0].instance).toBeUndefined();
  });

  it('ships the pinned CRAFTED marker, never the descriptor-equal unmarked twin', () => {
    const inventory: InvSlot[] = [
      { itemId: MATERIAL, count: 2, materialSources: [held(ANA, 2)] },
      {
        itemId: MATERIAL,
        count: 2,
        materialSources: [held(ANA, 2)],
        craftedRecipeId: 'recipe_x',
      },
    ];

    const units = pinnedTradeUnits({
      inventory,
      itemId: MATERIAL,
      sources: [held(ANA, 2)],
      instance: undefined,
      craftedRecipeId: 'recipe_x',
      skip: allowAll,
    });

    expect(units).toHaveLength(2);
    for (const u of units ?? []) expect(u.craftedRecipeId).toBe('recipe_x');
    expect(inventory).toHaveLength(1);
    expect(inventory[0].craftedRecipeId).toBeUndefined();
  });

  it('REFUSES rather than falling back when the pinned identity is gone', () => {
    // A stale pin must never reach for a descriptor-equal copy behind another
    // identity: a pin miss fails the swap, it does not substitute.
    const inventory: InvSlot[] = [
      { itemId: MATERIAL, count: 2, materialSources: [held(ANA, 2)], instance: { ...ENCHANT } },
    ];
    const before = structuredClone(inventory);

    const units = pinnedTradeUnits({
      inventory,
      itemId: MATERIAL,
      sources: [held(ANA, 2)],
      instance: undefined,
      craftedRecipeId: undefined,
      skip: allowAll,
    });

    expect(units).toBeNull();
    expect(inventory).toEqual(before);
  });

  it('an EXPLICIT EMPTY pin is not an absent pin: it takes nothing', () => {
    const inventory: InvSlot[] = [{ itemId: MATERIAL, count: 2, materialSources: [held(ANA, 2)] }];
    const before = structuredClone(inventory);

    expect(
      pinnedTradeUnits({
        inventory,
        itemId: MATERIAL,
        sources: [],
        instance: undefined,
        craftedRecipeId: undefined,
        skip: allowAll,
      }),
    ).toBeNull();
    expect(inventory).toEqual(before);
  });
});
