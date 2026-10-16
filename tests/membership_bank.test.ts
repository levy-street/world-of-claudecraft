import { describe, expect, it } from 'vitest';
import type { SavedBankState } from '../src/sim/bank';
import { ITEMS } from '../src/sim/data';
import {
  applyMembershipBankInventoryPlan,
  membershipBankView,
  planMembershipBankTransfer,
} from '../src/sim/membership_bank';
import { Rng } from '../src/sim/rng';
import type { InvSlot } from '../src/sim/types';

const bread = (count = 3): InvSlot => ({ itemId: 'baked_bread', count });
const bank = (inventory: InvSlot[] = []): SavedBankState => ({
  inventory,
  purchasedSlots: 0,
  bonusSlots: 0,
});

describe('membership bank exact transfers', () => {
  it('moves a selected partial stack without mutating either input', () => {
    const item = bread(5);
    const target = bank();
    const result = planMembershipBankTransfer({ inventory: [item] }, target, {
      direction: 'deposit',
      slotIndex: 0,
      count: 2,
      expectedSlot: bread(5),
    });
    expect(result).toMatchObject({
      ok: true,
      moved: 2,
      inventory: [bread(3)],
      bank: { inventory: [bread(2)] },
    });
    expect(item).toEqual(bread(5));
    expect(target.inventory).toEqual([]);
  });

  it('preserves exact instances and crafted provenance on withdrawal', () => {
    const item: InvSlot = {
      itemId: 'baked_bread',
      count: 2,
      craftedRecipeId: 'recipe-proof',
      instance: { signer: 'Mira', enchant: 'test-enchant' },
    };
    const result = planMembershipBankTransfer({ inventory: [] }, bank([item]), {
      direction: 'withdraw',
      slotIndex: 0,
      expectedSlot: structuredClone(item),
    });
    expect(result).toMatchObject({
      ok: true,
      moved: 2,
      inventory: [item],
      bank: { inventory: [] },
    });
    if (result.ok) {
      result.inventory[0].instance!.signer = 'Changed';
      expect(item.instance!.signer).toBe('Mira');
    }
  });

  it('keeps material gatherer counts and refuses a stale provenance fingerprint', () => {
    const item: InvSlot = {
      itemId: 'wolf_fang',
      count: 5,
      materialSources: [
        { source: { gatherer: { kind: 'character', id: 10, name: 'Mira' } }, count: 2 },
        { source: { signer: 'Kai' }, count: 3 },
      ],
    };
    const result = planMembershipBankTransfer({ inventory: [item] }, bank(), {
      direction: 'deposit',
      slotIndex: 0,
      expectedSlot: structuredClone(item),
    });
    expect(result).toMatchObject({
      ok: true,
      moved: 5,
      inventory: [],
      bank: {
        inventory: [
          {
            itemId: 'wolf_fang',
            count: 5,
            materialSources: [
              { source: { signer: 'Kai' }, count: 3 },
              { source: { gatherer: { kind: 'character', id: 10, name: 'Mira' } }, count: 2 },
            ],
          },
        ],
      },
    });
    expect(
      planMembershipBankTransfer({ inventory: [item] }, bank(), {
        direction: 'deposit',
        slotIndex: 0,
        expectedSlot: { ...item, materialSources: [{ source: {}, count: 5 }] },
      }),
    ).toEqual({ ok: false, error: 'stale' });
  });

  it.each([{ boundTo: 1 }, { bindOnTrade: true }, { locked: true }])(
    'refuses a protected copy in either direction: %j',
    (instance) => {
      const item = { ...bread(), instance };
      for (const direction of ['deposit', 'withdraw'] as const) {
        expect(
          planMembershipBankTransfer({ inventory: [item] }, bank([item]), {
            direction,
            slotIndex: 0,
            expectedSlot: item,
          }),
        ).toEqual({ ok: false, error: 'bound' });
      }
    },
  );

  it('refuses soulbound and quest items even within the same account', () => {
    for (const def of [
      Object.values(ITEMS).find((item) => item.soulbound),
      Object.values(ITEMS).find((item) => item.kind === 'quest'),
    ]) {
      expect(def).toBeDefined();
      const item = { itemId: def!.id, count: 1 };
      expect(
        planMembershipBankTransfer({ inventory: [item] }, bank(), {
          direction: 'deposit',
          slotIndex: 0,
          expectedSlot: item,
        }),
      ).toEqual({ ok: false, error: 'bound' });
    }
  });

  it('rejects a full bank without partially depositing and preserves legacy overflow views', () => {
    const full = bank(Array.from({ length: 24 }, () => bread(20)));
    expect(
      planMembershipBankTransfer({ inventory: [bread()] }, full, {
        direction: 'deposit',
        slotIndex: 0,
        expectedSlot: bread(),
      }),
    ).toEqual({ ok: false, error: 'no_fit' });
    expect(full.inventory).toHaveLength(24);
    const overflow = bank(Array.from({ length: 30 }, () => bread(20)));
    expect(membershipBankView(overflow)).toMatchObject({ capacity: 24, generalUsed: 30 });
    expect(membershipBankView(overflow).slots).toHaveLength(30);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses invalid counts %s',
    (count) => {
      expect(
        planMembershipBankTransfer({ inventory: [bread()] }, bank(), {
          direction: 'deposit',
          slotIndex: 0,
          count,
          expectedSlot: bread(),
        }),
      ).toEqual({ ok: false, error: 'invalid' });
    },
  );

  it('does not substitute a same-id different instance after a stale index', () => {
    expect(
      planMembershipBankTransfer(
        { inventory: [{ ...bread(), instance: { signer: 'New' } }] },
        bank(),
        {
          direction: 'deposit',
          slotIndex: 0,
          expectedSlot: { ...bread(), instance: { signer: 'Old' } },
        },
      ),
    ).toEqual({ ok: false, error: 'stale' });
  });
});

describe('committed bank inventory reconciliation', () => {
  it('reconciles 1,000 seeded overflow slots with linear record reads and preserves passive grants', () => {
    const rng = new Rng(4281);
    const before = Array.from({ length: 1000 }, (_, index) => ({
      itemId: 'baked_bread',
      count: rng.int(1, 20),
      instance: { signer: `${index}-${rng.int(0, 100000)}` },
    }));
    let itemReads = 0;
    // Reversed order makes a repeated equality search genuinely quadratic.
    // Count inspected fields instead of using a machine-dependent stopwatch.
    const after = before
      .slice(1)
      .reverse()
      .map((slot) => ({
        ...slot,
        get itemId() {
          itemReads++;
          return 'baked_bread';
        },
      }));
    const reward = { itemId: 'roasted_boar', count: 1 };
    expect(applyMembershipBankInventoryPlan([...before, reward], before, after, [])).toEqual([
      ...before.slice(1),
      reward,
    ]);
    expect(itemReads).toBeLessThan(20_000);
  });

  it('counts duplicate exact slots and compares nested keys independent of JSONB order', () => {
    const first = {
      ...bread(),
      instance: { signer: 'Mira', rolled: { stats: { str: 1, sta: 2 } } },
    } as InvSlot;
    const reordered = {
      count: 3,
      itemId: 'baked_bread',
      instance: { rolled: { stats: { sta: 2, str: 1 } }, signer: 'Mira' },
    } as InvSlot;
    expect(
      applyMembershipBankInventoryPlan([first, first], [first, first], [reordered], []),
    ).toEqual([first]);
    expect(applyMembershipBankInventoryPlan([], [first, first], [reordered], [])).toBeNull();
  });

  it('preserves passive grants appended during the SQL transaction', () => {
    const reward = { itemId: 'roasted_boar', count: 1 };
    expect(
      applyMembershipBankInventoryPlan([bread(5), reward], [bread(5)], [bread(3)], []),
    ).toEqual([reward, bread(3)]);
  });

  it('fails closed when a passive grant changed the affected stack', () => {
    expect(applyMembershipBankInventoryPlan([bread(6)], [bread(5)], [bread(3)], [])).toBeNull();
  });

  it('refuses a withdrawal when a passive grant occupied its last bag cell', () => {
    const full = Array.from({ length: 16 }, (_, index) => ({
      ...bread(20),
      instance: { signer: String(index) },
    }));
    expect(applyMembershipBankInventoryPlan(full, [], [bread()], [])).toBeNull();
  });
});
