// The guild book's MATERIAL source custody: the load path that preserves an
// exact composition, the delta shape that names the units a command moved, and
// the forward/backward/netted replays that must move exactly those units.
//
// Everything runs on REAL content ids and the REAL derived material registry
// (nothing injected), so the membership pin in the first block is load-bearing:
// without it the whole file could be exercising the non-material arm and still
// be green.
//
// The contracts under test, stated as failures they would be:
//   * a one-unit deposit into a mixed stack must journal ONE unit, never the
//     whole after-stack it merged into;
//   * a withdraw that names exact descriptors must move exactly those, and
//     refuse (never substitute) a short one;
//   * a count-0 re-attribution must survive netting and replay, because its
//     unit total nets to zero while its provenance did not;
//   * a legacy delta must project losslessly and must NEVER assert its
//     projection against recorded stock;
//   * a refused replay must leave the composition it started from.

import { describe, expect, it } from 'vitest';
import { stackSizeOf } from '../src/sim/bags';
import { ITEMS } from '../src/sim/data';
import {
  applyGuildBankDeltasTo,
  type GuildBankOpDelta,
  type GuildBankState,
  netGuildBankOpLogForReplay,
  revertGuildBankDeltasTo,
  sanitizeGuildBankState,
} from '../src/sim/guild_bank';
import { canonicalMaterialSourceLegs } from '../src/sim/guild_bank_material';
import { materialItemIds } from '../src/sim/material_ids';
import type { MaterialSource, MaterialSourceDelta } from '../src/sim/material_sources';
import type { InvSlot } from '../src/sim/types';

const ORE = 'copper_ore';
const GEAR = 'worn_sword';
const STACK = 20;

const ANA: MaterialSource = { gatherer: { kind: 'character', id: 11, name: 'Ana' } };
const BRU: MaterialSource = { gatherer: { kind: 'character', id: 22, name: 'Bru' } };
const CAI: MaterialSource = { gatherer: { kind: 'character', id: 33, name: 'Cai' } };
const UNRECORDED: MaterialSource = {};
const SIGNED_ANA: MaterialSource = { signer: 'Ana' };
const SIGNED_BRU: MaterialSource = { signer: 'Bru' };
const MAX = Number.MAX_SAFE_INTEGER;

const sameSource = (a: MaterialSource, b: MaterialSource): boolean => {
  if ((a.signer ?? null) !== (b.signer ?? null)) return false;
  const ga = a.gatherer;
  const gb = b.gatherer;
  if (ga === undefined || gb === undefined) return ga === gb;
  return ga.kind === gb.kind && ga.id === gb.id && ga.name === gb.name;
};

/** Units of one descriptor held across the WHOLE book, however it is stacked. */
const unitsOf = (book: GuildBankState, source: MaterialSource): number =>
  book.inventory.reduce(
    (total, slot) =>
      total +
      (slot.materialSources ?? [])
        .filter((entry) => sameSource(entry.source, source))
        .reduce((n, entry) => n + entry.count, 0),
    0,
  );

const totalUnits = (book: GuildBankState, itemId: string): number =>
  book.inventory.filter((s) => s.itemId === itemId).reduce((n, s) => n + s.count, 0);

/** Every source-bearing slot holds exactly the units it claims. */
const expectSourcesAgree = (book: GuildBankState): void => {
  for (const slot of book.inventory) {
    if (slot.materialSources === undefined) continue;
    const total = slot.materialSources.reduce((n, entry) => n + entry.count, 0);
    expect(total, slot.itemId).toBe(slot.count);
  }
};

function bookWith(inventory: InvSlot[]): GuildBankState {
  return { treasury: 0, inventory, purchasedSlots: 24 };
}

function itemDelta(overrides: Partial<GuildBankOpDelta> = {}): GuildBankOpDelta {
  return {
    op: 'deposit',
    itemId: ORE,
    count: 1,
    instance: null,
    craftedRecipeId: null,
    copperDelta: 0,
    purchasedSlotsBefore: 24,
    purchasedSlotsAfter: 24,
    ...overrides,
  };
}

const legs = (...entries: readonly [MaterialSource, number][]): MaterialSourceDelta[] =>
  entries.map(([source, count]) => ({ source, count }));

describe('the fixture ids, classified from the real registry', () => {
  it('the ore id IS a material and the weapon is not, at the real cap', () => {
    expect(materialItemIds().has(ORE)).toBe(true);
    expect(materialItemIds().has(GEAR)).toBe(false);
    expect(stackSizeOf(ITEMS[ORE])).toBe(STACK);
  });
});

// The guild book runs the SHARED material_slot_load pair, exactly like the
// carried bags, the personal bank and the vault. These arms are here to prove
// the guild path has no policy of its own: a row the shared model refuses
// REFUSES the load (it is never demoted to unrecorded stock, which would launder
// attribution a character save would have rejected outright).
describe('sanitizeGuildBankState: the shared material load path, not a guild one', () => {
  const bookOf = (inventory: unknown[]) => ({ treasury: 0, purchasedSlots: 24, inventory });

  it('keeps an exact composition and its grouping choice', () => {
    const book = sanitizeGuildBankState(
      bookOf([
        {
          itemId: ORE,
          count: 5,
          materialSources: [
            { source: BRU, count: 2 },
            { source: ANA, count: 3 },
          ],
          materialSeparated: true,
        },
      ]),
    );

    expect(book.inventory).toHaveLength(1);
    expect(book.inventory[0].count).toBe(5);
    expect(book.inventory[0].materialSeparated).toBe(true);
    expect(unitsOf(book, ANA)).toBe(3);
    expect(unitsOf(book, BRU)).toBe(2);
    expectSourcesAgree(book);
  });

  it('preserves a LEGAL legacy over-cap holding instead of clipping it to the stack cap', () => {
    const book = sanitizeGuildBankState(
      bookOf([
        {
          itemId: ORE,
          count: STACK + 7,
          instance: { rolled: { stats: { str: 1 } } },
          materialSources: [{ source: ANA, count: STACK + 7 }],
        },
      ]),
    );

    // The composition's own total is the authority: clipping to 20 here would
    // destroy 7 units that the buckets still account for.
    expect(book.inventory[0].count).toBe(27);
    expect(unitsOf(book, ANA)).toBe(27);
    expectSourcesAgree(book);
  });

  it('REFUSES the load when the buckets disagree with the count they describe', () => {
    // Four units claimed of a stack of five: unreadable, not partial. Demoting
    // it to unrecorded stock would be a silent laundering of the difference.
    expect(() =>
      sanitizeGuildBankState(
        bookOf([{ itemId: ORE, count: 5, materialSources: [{ source: ANA, count: 4 }] }]),
      ),
    ).toThrow(/refusing character load/);
  });

  it('REFUSES a legacy signer sitting beside explicit legs, rather than letting one overwrite the other', () => {
    expect(() =>
      sanitizeGuildBankState(
        bookOf([
          {
            itemId: ORE,
            count: 3,
            instance: { signer: 'Ana' },
            materialSources: [{ source: BRU, count: 3 }],
          },
        ]),
      ),
    ).toThrow(/refusing character load/);
  });

  it('REFUSES a known NON-material row that carries a material marker', () => {
    expect(() =>
      sanitizeGuildBankState(
        bookOf([{ itemId: GEAR, count: 1, materialSources: [{ source: ANA, count: 1 }] }]),
      ),
    ).toThrow(/refusing character load/);
  });

  it('projects a legacy signed row into its own bucket, inventing no gatherer', () => {
    const book = sanitizeGuildBankState(
      bookOf([{ itemId: ORE, count: 6, instance: { signer: 'Ana' } }]),
    );

    // The shared normalize moves the signature into the composition and leaves
    // the payload empty; the signature itself is never lost or widened.
    expect(book.inventory[0].count).toBe(6);
    expect(book.inventory[0].instance).toBeUndefined();
    expect(unitsOf(book, SIGNED_ANA)).toBe(6);
    expect(unitsOf(book, ANA)).toBe(0);
    expectSourcesAgree(book);
  });
});

describe('applyGuildBankDeltasTo: a material move lands exactly the units it names', () => {
  it('adds ONE unit of a third gatherer to an A/B stack without touching A or B', () => {
    const book = bookWith([
      {
        itemId: ORE,
        count: 8,
        materialSources: [
          { source: ANA, count: 5 },
          { source: BRU, count: 3 },
        ],
      },
    ]);

    const deficit = applyGuildBankDeltasTo(book, [
      itemDelta({ op: 'deposit', count: 1, materialSources: legs([CAI, 1]) }),
    ]);

    expect(deficit).toBeNull();
    // Nine units, not eighteen: the one-unit deposit journalled one unit, and
    // the whole after-stack was never re-deposited.
    expect(totalUnits(book, ORE)).toBe(9);
    expect(unitsOf(book, ANA)).toBe(5);
    expect(unitsOf(book, BRU)).toBe(3);
    expect(unitsOf(book, CAI)).toBe(1);
    expectSourcesAgree(book);
  });

  it('withdraws exactly the selected descriptors out of a mixed stack', () => {
    const book = bookWith([
      {
        itemId: ORE,
        count: 10,
        materialSources: [
          { source: ANA, count: 4 },
          { source: BRU, count: 3 },
          { source: UNRECORDED, count: 3 },
        ],
      },
    ]);

    const deficit = applyGuildBankDeltasTo(book, [
      itemDelta({ op: 'withdraw', count: 5, materialSources: legs([ANA, -4], [BRU, -1]) }),
    ]);

    expect(deficit).toBeNull();
    expect(totalUnits(book, ORE)).toBe(5);
    // The unrecorded units are the ones an UNSPECIFIED take would have spent
    // first, so a passing assertion here proves the selection was honoured.
    expect(unitsOf(book, ANA)).toBe(0);
    expect(unitsOf(book, BRU)).toBe(2);
    expect(unitsOf(book, UNRECORDED)).toBe(3);
    expectSourcesAgree(book);
  });

  it('refuses a named descriptor durable truth is short of, and reports the exact shortfall', () => {
    const book = bookWith([
      { itemId: ORE, count: 4, materialSources: [{ source: ANA, count: 4 }] },
    ]);

    const deficit = applyGuildBankDeltasTo(book, [
      itemDelta({ op: 'withdraw', count: 3, materialSources: legs([BRU, -3]) }),
    ]);

    expect(deficit?.kind).toBe('missing_items');
    expect(deficit?.shortfall).toBe(3);
    // A refused replay never half-empties the stack it could not satisfy.
    expect(unitsOf(book, ANA)).toBe(4);
  });

  it('refuses legs that disagree with their own count as unreadable, never as a shortfall', () => {
    const book = bookWith([
      { itemId: ORE, count: 4, materialSources: [{ source: ANA, count: 4 }] },
    ]);

    const deficit = applyGuildBankDeltasTo(book, [
      itemDelta({ op: 'withdraw', count: 3, materialSources: legs([ANA, -2]) }),
    ]);

    expect(deficit?.kind).toBe('source_unreadable');
    expect(unitsOf(book, ANA)).toBe(4);
  });

  it('lets an UNSIGNED legacy removal spend non-premium stock in the canonical order', () => {
    const book = bookWith([
      {
        itemId: ORE,
        count: 6,
        materialSources: [
          { source: ANA, count: 4 },
          { source: UNRECORDED, count: 2 },
        ],
      },
    ]);

    // Carrying no signer is exactly what the old model recorded, so the pool is
    // the non-premium buckets and the shared order chooses inside it
    // (unrecorded first). Asserting the `{}` projection EXACTLY would refuse
    // this honest replay outright.
    const deficit = applyGuildBankDeltasTo(book, [itemDelta({ op: 'withdraw', count: 3 })]);

    expect(deficit).toBeNull();
    expect(totalUnits(book, ORE)).toBe(3);
    expect(unitsOf(book, UNRECORDED)).toBe(0);
    expect(unitsOf(book, ANA)).toBe(3);
  });

  it('projects a legacy signed deposit losslessly into its own bucket, inventing no gatherer', () => {
    const book = bookWith([]);

    const deficit = applyGuildBankDeltasTo(book, [
      itemDelta({ op: 'deposit', count: 4, instance: { signer: 'Ana' } }),
    ]);

    expect(deficit).toBeNull();
    expect(unitsOf(book, SIGNED_ANA)).toBe(4);
    expect(unitsOf(book, ANA)).toBe(0);
    // The signature moved into the bucket, so it no longer sits on the payload.
    expect(book.inventory[0].instance).toBeUndefined();
    expectSourcesAgree(book);
  });
});

// A legacy delta has no per-unit provenance, but it is NOT silent: the payload's
// signer (or the absence of one) is a real constraint, and a replay that ignored
// it would satisfy one premium identity out of another's units.
describe('the legacy SIGNATURE constraint on a removal', () => {
  const mixed = (): GuildBankState =>
    bookWith([
      {
        itemId: ORE,
        count: 7,
        materialSources: [
          { source: SIGNED_ANA, count: 3 },
          { source: SIGNED_BRU, count: 4 },
        ],
      },
    ]);

  it("spends the named signature's own units", () => {
    const book = mixed();
    const deficit = applyGuildBankDeltasTo(book, [
      itemDelta({ op: 'withdraw', count: 3, instance: { signer: 'Ana' } }),
    ]);

    expect(deficit).toBeNull();
    expect(unitsOf(book, SIGNED_ANA)).toBe(0);
    expect(unitsOf(book, SIGNED_BRU)).toBe(4);
  });

  it("REFUSES rather than consuming another signer's units to balance the books", () => {
    const book = mixed();
    // Ana holds 3; the delta asks for 5. Bru's 4 are RIGHT THERE and would
    // cover it, which is exactly what must not happen.
    const deficit = applyGuildBankDeltasTo(book, [
      itemDelta({ op: 'withdraw', count: 5, instance: { signer: 'Ana' } }),
    ]);

    expect(deficit?.kind).toBe('missing_items');
    expect(deficit?.shortfall).toBe(2);
    expect(unitsOf(book, SIGNED_ANA)).toBe(3);
    expect(unitsOf(book, SIGNED_BRU)).toBe(4);
  });

  it('refuses a signed removal outright when the book holds only the OTHER signature', () => {
    const book = bookWith([
      { itemId: ORE, count: 4, materialSources: [{ source: SIGNED_BRU, count: 4 }] },
    ]);
    const deficit = applyGuildBankDeltasTo(book, [
      itemDelta({ op: 'withdraw', count: 3, instance: { signer: 'Ana' } }),
    ]);

    expect(deficit?.kind).toBe('missing_items');
    expect(deficit?.shortfall).toBe(3);
    expect(unitsOf(book, SIGNED_BRU)).toBe(4);
  });

  it('never lets an UNSIGNED legacy removal consume a premium bucket', () => {
    const book = bookWith([
      { itemId: ORE, count: 5, materialSources: [{ source: SIGNED_ANA, count: 5 }] },
    ]);
    // Carrying no signer meant "not premium" under the old model, so this
    // delta provably did not hold Ana's signed units and cannot eat them.
    const deficit = applyGuildBankDeltasTo(book, [itemDelta({ op: 'withdraw', count: 2 })]);

    expect(deficit?.kind).toBe('missing_items');
    expect(deficit?.shortfall).toBe(2);
    expect(unitsOf(book, SIGNED_ANA)).toBe(5);
  });

  it('treats the legal EMPTY-STRING legacy signer as its own descriptor, not as unrecorded', () => {
    const book = bookWith([
      {
        itemId: ORE,
        count: 4,
        materialSources: [
          { source: { signer: '' }, count: 2 },
          { source: UNRECORDED, count: 2 },
        ],
      },
    ]);
    const deficit = applyGuildBankDeltasTo(book, [
      itemDelta({ op: 'withdraw', count: 2, instance: { signer: '' } }),
    ]);

    expect(deficit).toBeNull();
    expect(unitsOf(book, { signer: '' })).toBe(0);
    expect(unitsOf(book, UNRECORDED)).toBe(2);
  });
});

// The guild pipe does not consult the player item lock (transfer_lock.ts scopes
// that to the $WOC rail), so a locked copy really moves through a guild bank and
// the replay has to land the same units the live move did.
describe('a LOCKED material copy', () => {
  const lockedBook = (): GuildBankState =>
    bookWith([
      {
        itemId: ORE,
        count: 4,
        instance: { locked: true },
        materialSources: [{ source: ANA, count: 4 }],
      },
    ]);

  it('replays a withdraw out of the locked stack, keeping the locked payload on what is left', () => {
    const book = lockedBook();
    const deficit = applyGuildBankDeltasTo(book, [
      itemDelta({
        op: 'withdraw',
        count: 2,
        instance: { locked: true },
        materialSources: legs([ANA, -2]),
      }),
    ]);

    expect(deficit).toBeNull();
    expect(totalUnits(book, ORE)).toBe(2);
    expect(unitsOf(book, ANA)).toBe(2);
    // The replay moves units; it never strips the owner's lock off the copy.
    expect(book.inventory[0].instance).toEqual({ locked: true });
    expectSourcesAgree(book);
  });

  it('reverts back into the locked stack rather than minting an unlocked one', () => {
    const book = lockedBook();
    const log = [
      itemDelta({
        op: 'withdraw',
        count: 2,
        instance: { locked: true },
        materialSources: legs([ANA, -2]),
      }),
    ];

    expect(applyGuildBankDeltasTo(book, log)).toBeNull();
    revertGuildBankDeltasTo(book, log);

    // CONSERVATION, not layout: a locked copy is one per slot by the shared
    // packing rule, so the restored units come back as their own stacks. What
    // must hold is that every unit is back, still attributed, and still locked.
    expect(totalUnits(book, ORE)).toBe(4);
    expect(unitsOf(book, ANA)).toBe(4);
    for (const slot of book.inventory) expect(slot.instance).toEqual({ locked: true });
    expectSourcesAgree(book);
  });
});

describe('a count-0 re-attribution', () => {
  const swap = itemDelta({
    op: 'deposit',
    count: 0,
    materialSources: legs([ANA, -2], [BRU, 2]),
  });

  it('replays as the swap it is, moving no units and re-attributing two', () => {
    const book = bookWith([
      {
        itemId: ORE,
        count: 5,
        materialSources: [
          { source: ANA, count: 3 },
          { source: BRU, count: 2 },
        ],
      },
    ]);

    expect(applyGuildBankDeltasTo(book, [swap])).toBeNull();
    expect(totalUnits(book, ORE)).toBe(5);
    expect(unitsOf(book, ANA)).toBe(1);
    expect(unitsOf(book, BRU)).toBe(4);
    expectSourcesAgree(book);
  });

  it('survives netting instead of vanishing at a zero unit total', () => {
    const netted = netGuildBankOpLogForReplay([swap]);

    expect(netted).toHaveLength(1);
    expect(netted[0].count).toBe(0);
    const carried = netted[0].materialSources ?? [];
    expect(carried).toHaveLength(2);
    expect(carried.find((leg) => sameSource(leg.source, ANA))?.count).toBe(-2);
    expect(carried.find((leg) => sameSource(leg.source, BRU))?.count).toBe(2);
  });

  it('nets a deposit and a withdraw of DIFFERENT gatherers into one surviving swap', () => {
    const netted = netGuildBankOpLogForReplay([
      itemDelta({ op: 'withdraw', count: 2, materialSources: legs([ANA, -2]) }),
      itemDelta({ op: 'deposit', count: 2, materialSources: legs([BRU, 2]) }),
    ]);

    // Units net to zero. Provenance does not, so the pair must NOT be dropped.
    const material = netted.filter((d) => d.itemId === ORE);
    expect(material).toHaveLength(1);
    expect(material[0].count).toBe(0);
    const canonical = canonicalMaterialSourceLegs(material[0].materialSources);
    expect(canonical.ok).toBe(true);
    if (canonical.ok) {
      expect(canonical.value.reduce((n, leg) => n + leg.count, 0)).toBe(0);
      expect(canonical.value).toHaveLength(2);
    }

    const book = bookWith([
      { itemId: ORE, count: 4, materialSources: [{ source: ANA, count: 4 }] },
    ]);
    expect(applyGuildBankDeltasTo(book, netted)).toBeNull();
    expect(unitsOf(book, ANA)).toBe(2);
    expect(unitsOf(book, BRU)).toBe(2);
  });

  it('drops a pair that cancels on BOTH axes, which really is a no-op', () => {
    const netted = netGuildBankOpLogForReplay([
      itemDelta({ op: 'deposit', count: 2, materialSources: legs([ANA, 2]) }),
      itemDelta({ op: 'withdraw', count: 2, materialSources: legs([ANA, -2]) }),
    ]);

    expect(netted.filter((d) => d.itemId === ORE)).toHaveLength(0);
  });
});

describe('revertGuildBankDeltasTo: the exact prior composition comes back', () => {
  it('restores the buckets a mixed withdraw removed', () => {
    const before: InvSlot[] = [
      {
        itemId: ORE,
        count: 10,
        materialSources: [
          { source: ANA, count: 4 },
          { source: BRU, count: 3 },
          { source: UNRECORDED, count: 3 },
        ],
      },
    ];
    const book = bookWith(before.map((slot) => ({ ...slot })));
    const log = [
      itemDelta({ op: 'withdraw', count: 5, materialSources: legs([ANA, -4], [BRU, -1]) }),
    ];

    expect(applyGuildBankDeltasTo(book, log)).toBeNull();
    revertGuildBankDeltasTo(book, log);

    expect(totalUnits(book, ORE)).toBe(10);
    expect(unitsOf(book, ANA)).toBe(4);
    expect(unitsOf(book, BRU)).toBe(3);
    expect(unitsOf(book, UNRECORDED)).toBe(3);
    expectSourcesAgree(book);
  });

  it('takes back exactly the unit a one-unit deposit added', () => {
    const book = bookWith([
      { itemId: ORE, count: 8, materialSources: [{ source: ANA, count: 8 }] },
    ]);
    const log = [itemDelta({ op: 'deposit', count: 1, materialSources: legs([CAI, 1]) })];

    expect(applyGuildBankDeltasTo(book, log)).toBeNull();
    revertGuildBankDeltasTo(book, log);

    expect(totalUnits(book, ORE)).toBe(8);
    expect(unitsOf(book, CAI)).toBe(0);
    expect(unitsOf(book, ANA)).toBe(8);
  });

  it('undoes a count-0 swap exactly', () => {
    const book = bookWith([
      {
        itemId: ORE,
        count: 5,
        materialSources: [
          { source: ANA, count: 3 },
          { source: BRU, count: 2 },
        ],
      },
    ]);
    const log = [
      itemDelta({ op: 'deposit', count: 0, materialSources: legs([ANA, -2], [BRU, 2]) }),
    ];

    expect(applyGuildBankDeltasTo(book, log)).toBeNull();
    revertGuildBankDeltasTo(book, log);

    expect(unitsOf(book, ANA)).toBe(3);
    expect(unitsOf(book, BRU)).toBe(2);
    expectSourcesAgree(book);
  });
});

describe('payload custody across a material move', () => {
  it("carries unknown persisted fields and an own '__proto__' key through the grant", () => {
    // JSON.parse is what mints an OWN '__proto__' key; an object literal cannot.
    const payload = JSON.parse('{"rolled":{"ilvl":7},"futureField":3,"__proto__":{"tag":1}}');
    const book = bookWith([]);

    const deficit = applyGuildBankDeltasTo(book, [
      itemDelta({ op: 'deposit', count: 2, instance: payload, materialSources: legs([ANA, 2]) }),
    ]);

    expect(deficit).toBeNull();
    const landed = book.inventory[0];
    expect(landed.instance).not.toBe(payload);
    expect(Object.hasOwn(landed.instance as object, '__proto__')).toBe(true);
    expect((landed.instance as Record<string, unknown>).futureField).toBe(3);
    expect(unitsOf(book, ANA)).toBe(2);
  });

  it('keeps a crafted copy and a plain copy of one item as separate stock', () => {
    const book = bookWith([
      {
        itemId: ORE,
        count: 4,
        craftedRecipeId: 'r1',
        materialSources: [{ source: ANA, count: 4 }],
      },
      { itemId: ORE, count: 4, materialSources: [{ source: ANA, count: 4 }] },
    ]);

    const deficit = applyGuildBankDeltasTo(book, [
      itemDelta({
        op: 'withdraw',
        count: 4,
        craftedRecipeId: 'r1',
        materialSources: legs([ANA, -4]),
      }),
    ]);

    expect(deficit).toBeNull();
    // The plain copy is untouched: crossing the craft-provenance line would
    // have destroyed another officer's provenance.
    const remaining = book.inventory.filter((slot) => slot.itemId === ORE);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].craftedRecipeId).toBeUndefined();
    expect(remaining[0].count).toBe(4);
  });
});

describe('canonicalMaterialSourceLegs', () => {
  it('coalesces, drops a net-zero descriptor and orders deterministically', () => {
    const a = canonicalMaterialSourceLegs(legs([BRU, 3], [ANA, -2], [BRU, -3], [ANA, 5]));
    const b = canonicalMaterialSourceLegs(legs([ANA, 5], [BRU, -3], [ANA, -2], [BRU, 3]));

    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // BRU cancels away entirely; ANA coalesces to +3, and observation order
    // cannot change the bytes.
    expect(a.value).toHaveLength(1);
    expect(a.value[0].count).toBe(3);
    expect(JSON.stringify(a.value)).toBe(JSON.stringify(b.value));
  });

  it('refuses a zero-count leg, an unknown field and a malformed descriptor', () => {
    expect(canonicalMaterialSourceLegs([{ source: ANA, count: 0 }]).ok).toBe(false);
    expect(
      canonicalMaterialSourceLegs([
        { source: ANA, count: 1, extra: 1 } as unknown as MaterialSourceDelta,
      ]).ok,
    ).toBe(false);
    expect(
      canonicalMaterialSourceLegs([
        { source: { gatherer: { kind: 'character', id: -1, name: 'Ana' } }, count: 1 },
      ]).ok,
    ).toBe(false);
  });

  it('reads an absent leg list as no legs at all, never as an empty claim', () => {
    expect(canonicalMaterialSourceLegs(undefined)).toEqual({ ok: true, value: [] });
    expect(canonicalMaterialSourceLegs(null)).toEqual({ ok: true, value: [] });
  });

  it('accepts a net that lands in the safe range however the legs are ORDERED', () => {
    // Summing in `number` and bounding each running subtotal makes the answer
    // depend on arrival order: this order crosses the safe range at the second
    // leg while netting to a perfectly legal MAX, and the reverse order never
    // crosses it at all. Both must answer the same.
    const crossesEarly = canonicalMaterialSourceLegs(legs([ANA, MAX], [ANA, MAX], [ANA, -MAX]));
    const neverCrosses = canonicalMaterialSourceLegs(legs([ANA, MAX], [ANA, -MAX], [ANA, MAX]));

    expect(crossesEarly.ok).toBe(true);
    expect(neverCrosses.ok).toBe(true);
    if (!crossesEarly.ok || !neverCrosses.ok) return;
    expect(crossesEarly.value).toHaveLength(1);
    expect(crossesEarly.value[0].count).toBe(MAX);
    expect(JSON.stringify(crossesEarly.value)).toBe(JSON.stringify(neverCrosses.value));
  });

  it('still refuses a FINISHED net outside the safe range', () => {
    // The bound is not removed, only moved to where it belongs: the coalesced
    // per-descriptor result, which is the only figure that has to describe a
    // legal holding.
    expect(canonicalMaterialSourceLegs(legs([ANA, MAX], [ANA, MAX]))).toEqual({
      ok: false,
      error: 'count-overflow',
    });
  });

  it('cancels a descriptor away even when its own legs cross the safe range first', () => {
    const cancelled = canonicalMaterialSourceLegs(
      legs([ANA, MAX], [BRU, 5], [ANA, MAX], [ANA, -MAX], [ANA, -MAX]),
    );

    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    // ANA nets to nothing and is dropped; only BRU survives.
    expect(cancelled.value).toHaveLength(1);
    expect(cancelled.value[0].count).toBe(5);
    expect(sameSource(cancelled.value[0].source, BRU)).toBe(true);
  });
});
