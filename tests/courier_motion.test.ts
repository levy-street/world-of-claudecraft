import { describe, expect, it, vi } from 'vitest';
import { emptyBankState } from '../src/sim/bank';
import {
  courierDispatch,
  courierInfoFor,
  courierPoseFor,
  courierSlotFingerprint,
  courierSummon,
  courierWireRevisionFor,
  sanitizeCourierState,
  savedCourierState,
  updateCourier,
} from '../src/sim/courier';
import {
  COURIER_LEG_TICKS,
  courierLegProgress,
  courierTimedFlightBlend,
  travelCourier,
} from '../src/sim/courier/motion';
import { INSTANCE_X_BASE } from '../src/sim/data';
import type { PlayerMeta } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { DT, type Entity } from '../src/sim/types';

function journey(x = 60, z = 80) {
  const player = { id: 1, kind: 'player', pos: { x: 0, y: 0, z: 0 }, dead: false } as Entity;
  const banker = { id: 2, kind: 'npc', pos: { x, y: 0, z }, dead: false } as Entity;
  const meta = {
    entityId: 1,
    inventory: [{ itemId: 'baked_bread', count: 1 }],
    bank: emptyBankState(),
    bags: [null, null, null, null],
    wireRev: 0,
    bankWireRev: 0,
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
  } as unknown as SimContext;
  courierSummon(ctx, 1);
  const dispatch = () =>
    courierDispatch(
      ctx,
      {
        deposits: [{ index: 0, fingerprint: courierSlotFingerprint(meta.inventory[0]) }],
        withdrawals: [],
      },
      1,
    );
  const tick = () => updateCourier(ctx, meta, player);
  return { player, banker, meta, ctx, dispatch, tick };
}

describe('courier fixed-duration flight and grounded endpoints', () => {
  it.each([0, 0.1, 6, 100, 10000])(
    'takes exactly 200 ticks each way at distance %s',
    (distance) => {
      const f = journey(distance * 0.6, distance * 0.8);
      expect(f.dispatch()).toBe(true);
      const state = f.meta.courier!;
      for (let i = 1; i < 200; i++) {
        f.tick();
        expect(state.phase).toBe('outbound');
        expect(state.travelTicks).toBe(i);
        expect(f.meta.bank.inventory).toEqual([]);
        expect(state.x).toBeCloseTo(distance * 0.6 * courierLegProgress(i), 9);
        expect(state.z).toBeCloseTo(distance * 0.8 * courierLegProgress(i), 9);
      }
      f.tick();
      expect(state.phase).toBe('returning');
      expect(state.travelTicks).toBe(0);
      expect(state.x).toBe(distance * 0.6);
      expect(state.z).toBe(distance * 0.8);
      expect(f.meta.bank.inventory).toEqual([{ itemId: 'baked_bread', count: 1 }]);
      for (let i = 1; i < 200; i++) {
        f.tick();
        expect(f.meta.courier).toBe(state);
        expect(state.phase).toBe('returning');
        expect(state.travelTicks).toBe(i);
      }
      f.tick();
      expect(f.meta.courier).toBeUndefined();
      expect(courierPoseFor(f.ctx, 1)).toBeNull();
      expect(courierInfoFor(f.ctx, 1)).toBeNull();
      expect(courierWireRevisionFor(f.ctx, 1)).toBeNull();
      expect(courierSummon(f.ctx, 1)).toBe(true);
      expect(f.meta.courier?.phase).toBe('ready');
    },
  );

  it('accelerates smoothly for two seconds, cruises, then brakes symmetrically', () => {
    const steps = Array.from(
      { length: COURIER_LEG_TICKS },
      (_, i) => courierLegProgress(i + 1) - courierLegProgress(i),
    );
    for (let i = 1; i < 40; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1]);
    for (let i = 41; i < 160; i++) expect(steps[i]).toBeCloseTo(steps[40], 12);
    for (let i = 161; i < 200; i++) expect(steps[i]).toBeLessThan(steps[i - 1]);
    for (let i = 0; i < 200; i++) expect(steps[i]).toBeCloseTo(steps[199 - i], 12);
    expect(steps.reduce((sum, step) => sum + step, 0)).toBe(1);
    for (const [ticks, lift] of [
      [0, 0],
      [12, 0],
      [26, 0.5],
      [40, 1],
      [100, 1],
      [160, 1],
      [174, 0.5],
      [188, 0],
      [200, 0],
    ]) {
      expect(courierTimedFlightBlend(ticks)).toBeCloseTo(lift);
    }
  });

  it('chooses the closest bank once and reaches a continuously moving owner on tick 200', () => {
    const f = journey();
    f.ctx.entities.set(3, { ...f.banker, id: 3, pos: { x: -101, y: 0, z: 0 } });
    f.ctx.bankerIds.unshift(3);
    f.dispatch();
    expect(f.meta.courier!.bankerId).toBe(2);
    for (let i = 0; i < 200; i++) f.tick();
    const state = f.meta.courier!;
    for (let i = 1; i <= 200; i++) {
      f.player.pos.x += 2;
      f.player.pos.z += 1;
      f.tick();
      expect(state.x).toBeCloseTo(60 + (f.player.pos.x - 60) * courierLegProgress(i), 9);
      if (i < 200) expect(f.meta.courier).toBe(state);
    }
    expect(f.meta.courier).toBeUndefined();
    expect(state.x).toBe(f.player.pos.x);
    expect(state.z).toBe(f.player.pos.z);
  });

  it.each([73, 199, 200, 273, 399])(
    'save/reconnect at tick %s preserves trajectory and custody',
    (count) => {
      const f = journey();
      f.meta.bank.inventory = [
        {
          itemId: 'wolf_fang',
          count: 2,
          materialSources: [{ source: { signer: 'miner' }, count: 2 }],
        },
      ];
      courierDispatch(
        f.ctx,
        {
          deposits: [{ index: 0, fingerprint: courierSlotFingerprint(f.meta.inventory[0]) }],
          withdrawals: [
            { index: 0, fingerprint: courierSlotFingerprint(f.meta.bank.inventory[0]) },
          ],
        },
        1,
      );
      for (let i = 0; i < count; i++) f.tick();
      const saved = savedCourierState(f.meta.courier!);
      const loaded = sanitizeCourierState(saved)!;
      expect(loaded).toEqual(saved);
      expect(loaded.cargo).not.toBe(saved.cargo);
      f.meta.courier = loaded;
      // Expiry and time spent offline never cancel or advance owned cargo.
      f.meta.membershipExpiresAt = 0;
      for (let i = count; i < 399; i++) f.tick();
      expect(f.meta.courier).toBeDefined();
      f.tick();
      expect(f.meta.courier).toBeUndefined();
      expect(f.meta.inventory).toEqual([
        {
          itemId: 'wolf_fang',
          count: 2,
          materialSources: [{ source: { signer: 'miner' }, count: 2 }],
        },
      ]);
      expect(courierSummon(f.ctx, 1)).toBe(false);
    },
  );

  it('repairs legacy or malformed timing without losing cargo or consuming time offline', () => {
    const f = journey();
    f.dispatch();
    for (let i = 0; i < 15; i++) f.tick();
    const saved = savedCourierState(f.meta.courier!);
    for (const travelTicks of [undefined, -1, 1.5, 201, NaN, Infinity, 'bad']) {
      const loaded = sanitizeCourierState({ ...saved, travelTicks })!;
      expect(loaded.travelTicks).toBeUndefined();
      expect(loaded.cargo).toEqual(saved.cargo);
      const oldX = loaded.x;
      travelCourier(loaded, 60, 80);
      expect(loaded.travelTicks).toBe(1);
      expect(loaded.legStartX).toBe(oldX);
    }
  });

  it('pauses a returning leg for a dead or instanced owner, then finishes its remaining ticks', () => {
    const f = journey();
    f.dispatch();
    for (let i = 0; i < 240; i++) f.tick();
    const state = savedCourierState(f.meta.courier!);
    f.player.dead = true;
    for (let i = 0; i < 300; i++) f.tick();
    expect(f.meta.courier).toEqual(state);
    f.player.dead = false;
    f.player.pos.x = INSTANCE_X_BASE;
    for (let i = 0; i < 300; i++) f.tick();
    expect(f.meta.courier).toEqual(state);
    f.player.pos.x = 0;
    for (let i = 0; i < 159; i++) f.tick();
    expect(f.meta.courier).toBeDefined();
    f.tick();
    expect(f.meta.courier).toBeUndefined();
  });

  it('never restarts elapsed time while bank admission is refused', () => {
    const f = journey(30, 0);
    let admitted = false;
    Object.assign(f.ctx, {
      courierBankExchange: (_pid: number, deposit: () => void, withdraw: () => void) => {
        if (!admitted) return false;
        deposit();
        withdraw();
        return true;
      },
    });
    f.dispatch();
    for (let i = 0; i < 240; i++) f.tick();
    expect(f.meta.courier!.travelTicks).toBe(200);
    expect(f.meta.courier!.x).toBe(30);
    expect(f.meta.bank.inventory).toEqual([]);
    admitted = true;
    for (let i = 0; i < 20; i++) f.tick();
    expect(f.meta.courier!.phase).toBe('returning');
    expect(f.meta.courier!.travelTicks).toBe(0);
    f.tick();
    expect(f.meta.courier!.travelTicks).toBe(1);
  });
});
