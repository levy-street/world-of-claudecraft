// The courier's Materials Vault leg: carried materials go into the vault and
// vault rows come back, all at the one banker the courier visits, with the
// targeted vault command's rules and the courier's whole-stack custody.
import { describe, expect, it, vi } from 'vitest';
import { emptyBankState } from '../src/sim/bank';
import {
  courierDispatch,
  courierInfoFor,
  courierSlotFingerprint,
  courierSummon,
  sanitizeCourierState,
  savedCourierState,
  updateCourier,
} from '../src/sim/courier';
import type { PlayerMeta } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, InvSlot } from '../src/sim/types';

function fixture(upgrades = 1) {
  const player = { id: 1, pos: { x: 0, y: 0, z: 0 }, dead: false } as Entity;
  const banker = { id: 2, kind: 'npc', pos: { x: 17.5, y: 0, z: 0 }, dead: false } as Entity;
  const meta = {
    entityId: 1,
    name: 'Courier test',
    inventory: [],
    bank: emptyBankState(),
    vault: { stock: {}, special: [], upgrades },
    bags: [null, null, null, null],
    bankWireRev: 0,
    vaultWireRev: 0,
    wireRev: 0,
    membershipExpiresAt: 1000,
  } as unknown as PlayerMeta;
  const ctx = {
    time: 0,
    players: new Map([[1, meta]]),
    entities: new Map([
      [1, player],
      [2, banker],
    ]),
    bankerIds: [2],
    resolve: () => ({ meta, e: player }),
    emit: vi.fn(),
    onInventoryChangedForQuests: vi.fn(),
    storagePrices: { vaultUpgrades: [1, 2, 3, 4, 5] },
  } as unknown as SimContext;
  courierSummon(ctx, 1);
  const finish = () => {
    for (let i = 0; i < 400 && meta.courier; i++) updateCourier(ctx, meta, player);
    expect(meta.courier).toBeUndefined();
  };
  return { ctx, meta, player, finish };
}
const pick = (slots: InvSlot[], index = 0) => ({
  index,
  fingerprint: courierSlotFingerprint(slots[index]),
});
const ore = (count: number): InvSlot => ({ itemId: 'copper_ore', count });
const bread = (count: number): InvSlot => ({ itemId: 'baked_bread', count });

describe('courier Materials Vault leg', () => {
  it('carries a material stack into the vault and brings a pooled row back', () => {
    const f = fixture();
    f.meta.inventory = [ore(12)];
    f.meta.vault.stock.linen_scrap = 7;
    const request = {
      deposits: [],
      withdrawals: [],
      vaultDeposits: [pick(f.meta.inventory)],
      vaultWithdrawals: [{ itemId: 'linen_scrap', count: 7 }],
    };
    expect(courierDispatch(f.ctx, request, 1)).toBe(true);
    expect(f.meta.inventory).toEqual([]);
    expect(f.meta.courier?.vaultCargo).toMatchObject([ore(12)]);
    f.finish();
    expect(f.meta.vault.stock).toEqual({ copper_ore: 12 });
    expect(f.meta.inventory).toMatchObject([{ itemId: 'linen_scrap', count: 7 }]);
  });

  it('brings back what the vault could not hold, and nothing is lost', () => {
    const f = fixture();
    f.meta.vault.stock.copper_ore = 35;
    f.meta.inventory = [ore(12)];
    const request = {
      deposits: [],
      withdrawals: [],
      vaultDeposits: [pick(f.meta.inventory)],
    };
    expect(courierDispatch(f.ctx, request, 1)).toBe(true);
    f.finish();
    expect(f.meta.vault.stock.copper_ore).toBe(40);
    expect(f.meta.inventory).toMatchObject([ore(7)]);
    expect(f.meta.bank.inventory).toEqual([]);
  });

  it('refuses a vault leg for a locked vault or a non-material stack, touching nothing', () => {
    const locked = fixture(0);
    locked.meta.inventory = [ore(3)];
    const before = savedCourierState(locked.meta.courier!);
    expect(
      courierDispatch(
        locked.ctx,
        { deposits: [], withdrawals: [], vaultDeposits: [pick(locked.meta.inventory)] },
        1,
      ),
    ).toBe(false);
    expect(locked.meta.inventory).toEqual([ore(3)]);
    expect(locked.meta.courier).toEqual(before);
    const f = fixture();
    f.meta.inventory = [bread(2)];
    expect(
      courierDispatch(
        f.ctx,
        { deposits: [], withdrawals: [], vaultDeposits: [pick(f.meta.inventory)] },
        1,
      ),
    ).toBe(false);
    expect(f.meta.inventory).toEqual([bread(2)]);
  });

  it('never sends one carried stack to both the bank and the vault', () => {
    const f = fixture();
    f.meta.inventory = [ore(3)];
    const same = pick(f.meta.inventory);
    expect(
      courierDispatch(f.ctx, { deposits: [same], withdrawals: [], vaultDeposits: [same] }, 1),
    ).toBe(false);
    expect(f.meta.inventory).toEqual([ore(3)]);
  });

  it('brings an identity row back whole only while it still matches what was picked', () => {
    const f = fixture();
    const signed: InvSlot = { itemId: 'copper_ore', count: 4, craftedRecipeId: 'smelt_copper' };
    f.meta.vault.special = [signed];
    const row = { itemId: 'copper_ore', count: 4, special: pick(f.meta.vault.special) };
    expect(
      courierDispatch(f.ctx, { deposits: [], withdrawals: [], vaultWithdrawals: [row] }, 1),
    ).toBe(true);
    f.finish();
    expect(f.meta.vault.special).toEqual([]);
    expect(f.meta.inventory).toMatchObject([signed]);
    const stale = fixture();
    stale.meta.vault.special = [{ ...signed }];
    const staleRow = { itemId: 'copper_ore', count: 4, special: pick(stale.meta.vault.special) };
    stale.meta.vault.special[0].count = 3;
    expect(
      courierDispatch(
        stale.ctx,
        { deposits: [], withdrawals: [], vaultWithdrawals: [staleRow] },
        1,
      ),
    ).toBe(false);
  });

  it('shows the vault only while ready, and saves vault cargo through a reload', () => {
    const f = fixture();
    expect(courierInfoFor(f.ctx, 1)?.vault).toMatchObject({ upgrades: 1, perMaterialCap: 40 });
    f.meta.inventory = [ore(5)];
    // A pooled row the vault does not hold refuses the whole trip.
    const missing = { itemId: 'linen_scrap', count: 2 };
    const trip = { deposits: [], withdrawals: [], vaultDeposits: [pick(f.meta.inventory)] };
    expect(courierDispatch(f.ctx, { ...trip, vaultWithdrawals: [missing] }, 1)).toBe(false);
    expect(f.meta.inventory).toMatchObject([ore(5)]);
    expect(courierDispatch(f.ctx, trip, 1)).toBe(true);
    expect(courierInfoFor(f.ctx, 1)?.vault).toBeNull();
    const saved = JSON.parse(JSON.stringify(savedCourierState(f.meta.courier!)));
    const loaded = sanitizeCourierState(saved, 'Courier test');
    expect(loaded?.phase).toBe('outbound');
    expect(loaded?.vaultCargo).toMatchObject([ore(5)]);
    // A trip that is no longer outbound brings its vault-bound stacks home.
    const home = sanitizeCourierState({ ...saved, phase: 'returning' }, 'Courier test');
    expect(home?.vaultCargo).toBeUndefined();
    expect(home?.cargo).toMatchObject([ore(5)]);
  });

  it('brings back exactly the picked identity row even when a deposit merged into it', () => {
    const f = fixture(5);
    const picked: InvSlot = {
      itemId: 'copper_ore',
      count: 4,
      materialSources: [{ source: { signer: 'C' }, count: 4 }],
    };
    f.meta.vault.special = [structuredClone(picked)];
    f.meta.inventory = [
      {
        itemId: 'copper_ore',
        count: 2,
        materialSources: [
          { source: { signer: 'A' }, count: 1 },
          { source: { signer: 'B' }, count: 1 },
        ],
      },
    ];
    const row = { itemId: 'copper_ore', count: 4, special: pick(f.meta.vault.special) };
    expect(
      courierDispatch(
        f.ctx,
        {
          deposits: [],
          withdrawals: [],
          vaultDeposits: [pick(f.meta.inventory)],
          vaultWithdrawals: [row],
        },
        1,
      ),
    ).toBe(true);
    f.finish();
    expect(f.meta.inventory).toEqual([picked]);
    expect(f.meta.vault.special).toMatchObject([{ itemId: 'copper_ore', count: 2 }]);
  });
});
