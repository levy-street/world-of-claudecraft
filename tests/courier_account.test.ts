// The courier's other-character leg in the sim: dispatch rules, the arrival
// order (bank and vault first, then the leg while the courier waits), the
// offline abandon, custody across a reload, and the pure plan the server runs
// inside its database transaction.
import { describe, expect, it, vi } from 'vitest';
import { emptyBankState } from '../src/sim/bank';
import {
  type CourierAccountLeg,
  courierDispatch,
  courierSlotFingerprint,
  courierSummon,
  planCourierAccountExchange,
  sanitizeCourierState,
  savedCourierState,
  updateCourier,
} from '../src/sim/courier';
import type { PlayerMeta } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, InvSlot } from '../src/sim/types';

function fixture(exchange?: (pid: number) => 'pending' | 'settled') {
  const player = { id: 1, pos: { x: 0, y: 0, z: 0 }, dead: false } as Entity;
  const banker = { id: 2, kind: 'npc', pos: { x: 17.5, y: 0, z: 0 }, dead: false } as Entity;
  const meta = {
    entityId: 1,
    characterId: 11,
    name: 'Courier test',
    inventory: [],
    bank: emptyBankState(),
    vault: { stock: {}, special: [], upgrades: 1 },
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
    courierAccountExchange: exchange,
  } as unknown as SimContext;
  courierSummon(ctx, 1);
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) updateCourier(ctx, meta, player);
  };
  return { ctx, meta, player, tick };
}
const pick = (slots: InvSlot[], index = 0) => ({
  index,
  fingerprint: courierSlotFingerprint(slots[index]),
});
const potion = (count: number): InvSlot => ({ itemId: 'healing_potion', count });
const bread = (count: number): InvSlot => ({ itemId: 'baked_bread', count });
const trip = (meta: PlayerMeta, index = 0, characterId = 12) => ({
  deposits: [],
  withdrawals: [],
  account: { characterId, deposits: [pick(meta.inventory, index)], withdrawals: [] },
});

describe('courier other-character leg', () => {
  it('refuses its own character, untradeable stacks and a stack sent to two stores', () => {
    const f = fixture();
    f.meta.inventory = [potion(2), { itemId: 'membership_helmet', count: 1 }];
    expect(courierDispatch(f.ctx, trip(f.meta, 0, 11), 1)).toBe(false);
    expect(courierDispatch(f.ctx, trip(f.meta, 1), 1)).toBe(false);
    const same = pick(f.meta.inventory);
    expect(
      courierDispatch(
        f.ctx,
        {
          deposits: [same],
          withdrawals: [],
          account: { characterId: 12, deposits: [same], withdrawals: [] },
        },
        1,
      ),
    ).toBe(false);
    expect(f.meta.inventory).toHaveLength(2);
  });

  it('runs the bank leg first, then waits at the banker until the host settles the leg', () => {
    let answer: 'pending' | 'settled' = 'pending';
    const exchange = vi.fn(() => answer);
    const f = fixture(exchange);
    f.meta.inventory = [potion(2), bread(3)];
    const request = trip(f.meta);
    expect(courierDispatch(f.ctx, { ...request, deposits: [pick(f.meta.inventory, 1)] }, 1)).toBe(
      true,
    );
    for (let i = 0; i < 400 && !f.meta.courier?.banked; i++) f.tick();
    expect(f.meta.courier?.banked).toBe(true);
    expect(f.meta.bank.inventory).toMatchObject([bread(3)]);
    f.tick(200);
    expect(f.meta.courier?.phase).toBe('outbound');
    expect(exchange).toHaveBeenCalled();
    // The host settles by clearing the leg (committed here: the potion is gone).
    delete f.meta.courier!.account;
    answer = 'settled';
    for (let i = 0; i < 400 && f.meta.courier; i++) f.tick();
    expect(f.meta.courier).toBeUndefined();
    expect(f.meta.inventory).toEqual([]);
    // The bank leg ran exactly once: nothing came back out of the bank.
    expect(f.meta.bank.inventory).toMatchObject([bread(3)]);
  });

  it('brings the leg home untouched in an offline world with no other characters', () => {
    const f = fixture();
    f.meta.inventory = [potion(2)];
    expect(courierDispatch(f.ctx, trip(f.meta), 1)).toBe(true);
    for (let i = 0; i < 800 && f.meta.courier; i++) f.tick();
    expect(f.meta.inventory).toMatchObject([potion(2)]);
  });

  it('keeps an outbound leg through a reload and brings it home from any other phase', () => {
    const f = fixture();
    f.meta.inventory = [potion(2)];
    courierDispatch(f.ctx, trip(f.meta), 1);
    f.meta.courier!.banked = true;
    const saved = JSON.parse(JSON.stringify(savedCourierState(f.meta.courier!)));
    const loaded = sanitizeCourierState(saved, 'Courier test');
    expect(loaded?.account).toMatchObject({ characterId: 12, cargo: [potion(2)] });
    expect(loaded?.banked).toBe(true);
    const home = sanitizeCourierState({ ...saved, phase: 'returning' }, 'Courier test');
    expect(home?.account).toBeUndefined();
    expect(home?.banked).toBeUndefined();
    expect(home?.cargo).toMatchObject([potion(2)]);
    // After the leg committed (no leg left), the bank leg must still never rerun.
    const { account: _settled, ...committed } = saved;
    expect(sanitizeCourierState(committed, 'Courier test')?.banked).toBe(true);
  });
});

describe('planCourierAccountExchange', () => {
  const fits = () => true;
  const leg = (cargo: InvSlot[], withdrawals: CourierAccountLeg['withdrawals'] = []) => ({
    characterId: 12,
    cargo,
    withdrawals,
  });
  it('deposits into that bank, takes a picked stack whole, and records both moves', () => {
    const saved = { inventory: [bread(5)], purchasedSlots: 0, bonusSlots: 0 };
    const plan = planCourierAccountExchange(
      leg([potion(2)], [pick(saved.inventory)]),
      [],
      saved,
      fits,
    );
    expect(plan.bank.inventory).toMatchObject([potion(2)]);
    expect(plan.cargo).toMatchObject([bread(5)]);
    expect(plan.moves.map((m) => [m.direction, m.item.itemId, m.moved])).toEqual([
      ['deposit', 'healing_potion', 2],
      ['withdraw', 'baked_bread', 5],
    ]);
    // The input bank is never touched.
    expect(saved.inventory).toEqual([bread(5)]);
  });
  it('takes the picked quantity even after a deposit topped the same slot up', () => {
    const saved = { inventory: [potion(3)], purchasedSlots: 0, bonusSlots: 0 };
    const plan = planCourierAccountExchange(
      leg([potion(2)], [pick(saved.inventory)]),
      [],
      saved,
      fits,
    );
    expect(plan.bank.inventory).toMatchObject([potion(2)]);
    expect(plan.cargo).toMatchObject([potion(3)]);
  });
  it('skips a stale pick and a pick the cargo cannot hold, and brings back what did not fit', () => {
    const full = {
      inventory: Array.from({ length: 24 }, () => bread(20)),
      purchasedSlots: 0,
      bonusSlots: 0,
    };
    const stale = { index: 0, fingerprint: 'not this stack' };
    const plan = planCourierAccountExchange(leg([potion(2)], [stale]), [], full, fits);
    expect(plan.cargo).toMatchObject([potion(2)]);
    expect(plan.moves).toEqual([]);
    const saved = { inventory: [bread(5)], purchasedSlots: 0, bonusSlots: 0 };
    const refused = planCourierAccountExchange(
      leg([], [pick(saved.inventory)]),
      [],
      saved,
      () => false,
    );
    expect(refused.cargo).toEqual([]);
    expect(refused.bank.inventory).toMatchObject([bread(5)]);
  });

  describe('courier custody budget across legs', () => {
    it('leaves room for the other-character leg when vault rows come back', () => {
      const f = fixture(() => 'pending');
      f.meta.vault.upgrades = 5;
      f.meta.vault.stock = { copper_ore: 200, linen_scrap: 200, wolf_fang: 200 };
      f.meta.inventory = [potion(1), potion(2)];
      expect(
        courierDispatch(
          f.ctx,
          {
            deposits: [],
            withdrawals: [],
            vaultWithdrawals: [
              { itemId: 'copper_ore', count: 200 },
              { itemId: 'linen_scrap', count: 200 },
              { itemId: 'wolf_fang', count: 200 },
            ],
            account: {
              characterId: 12,
              deposits: [pick(f.meta.inventory, 0), pick(f.meta.inventory, 1)],
              withdrawals: [],
            },
          },
          1,
        ),
      ).toBe(true);
      for (let i = 0; i < 400 && !f.meta.courier?.banked; i++) f.tick();
      const courier = f.meta.courier!;
      expect(courier.cargo.length + (courier.account?.cargo.length ?? 0)).toBeLessThanOrEqual(24);
      // The custody a save would write must load again.
      const saved = JSON.parse(JSON.stringify(savedCourierState(courier)));
      expect(() => sanitizeCourierState(saved, 'Courier test')).not.toThrow();
    });
  });
});
