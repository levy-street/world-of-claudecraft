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
import { courierFlightBlend, courierTravelSpeed, travelCourier } from '../src/sim/courier/motion';
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

describe('courier straight flight and grounded endpoints', () => {
  it('pins smooth takeoff and landing to the same ground and cruise distances', () => {
    for (const [distance, blend, speed] of [
      [0, 0, 7],
      [3, 0, 7],
      [5.5, 0.5, 12.25],
      [8, 1, 17.5],
    ]) {
      expect(courierFlightBlend(distance, 100)).toBe(blend);
      expect(courierFlightBlend(8, distance)).toBe(blend);
      expect(courierTravelSpeed(distance, 100)).toBe(speed);
      expect(courierTravelSpeed(8, distance)).toBe(speed);
    }
  });

  it('selects the closest banker once, then stays on a straight line through both accelerated legs', () => {
    const f = journey();
    f.ctx.entities.set(3, { ...f.banker, id: 3, pos: { x: -101, y: 0, z: 0 } });
    f.ctx.bankerIds.unshift(3);
    expect(f.dispatch()).toBe(true);
    const state = f.meta.courier!;
    expect(state.bankerId).toBe(2);
    const legs: Record<string, number[]> = { outbound: [], returning: [] };
    let transitions = 0;
    for (let i = 0; i < 800 && state.phase !== 'ready'; i++) {
      const phase = state.phase;
      const before = { x: state.x, z: state.z };
      f.tick();
      legs[phase].push(Math.hypot(state.x - before.x, state.z - before.z) / DT);
      expect(state.z).toBeCloseTo((state.x * 4) / 3, 10);
      expect(state.x).toBeGreaterThanOrEqual(0);
      expect(state.x).toBeLessThanOrEqual(60);
      if (phase === 'outbound' && state.phase === 'returning') {
        transitions++;
        expect(state.travelDistance).toBe(0);
        expect(state.x).toBe(60);
        expect(state.z).toBe(80);
      }
    }
    expect(transitions).toBe(1);
    expect(state.phase).toBe('ready');
    for (const speeds of Object.values(legs)) {
      expect(speeds[0]).toBeCloseTo(7);
      expect(speeds.some((speed) => speed > 7.1 && speed < 17.4)).toBe(true);
      expect(Math.max(...speeds)).toBeCloseTo(17.5);
      expect(speeds.at(-2)).toBeCloseTo(7);
      expect(speeds.at(-1)).toBeLessThanOrEqual(7.000001);
    }
  });

  it('keeps a trip shorter than both ground runs entirely grounded', () => {
    const f = journey(3.6, 4.8);
    expect(f.dispatch()).toBe(true);
    const state = f.meta.courier!;
    for (let i = 0; i < 100 && state.phase !== 'ready'; i++) {
      const pose = courierPoseFor(f.ctx, 1)!;
      expect(courierFlightBlend(pose.travelDistance, pose.remainingDistance)).toBe(0);
      f.tick();
    }
    expect(state.phase).toBe('ready');
    expect(f.meta.bank.inventory).toEqual([{ itemId: 'baked_bread', count: 1 }]);
  });

  it('resumes the same trajectory after save and clamps legacy or malformed ramp metadata without losing cargo', () => {
    const f = journey();
    f.dispatch();
    for (let i = 0; i < 15; i++) f.tick();
    const saved = savedCourierState(f.meta.courier!);
    const loaded = sanitizeCourierState(saved)!;
    expect(loaded.travelDistance).toBe(saved.travelDistance);
    const expected = savedCourierState(saved);
    travelCourier(expected, 60, 80);
    f.meta.courier = loaded;
    f.tick();
    expect(loaded).toEqual(expected);
    const { travelDistance: _distance, ...legacy } = saved;
    for (const travelDistance of [undefined, -1, NaN, Infinity, 'bad']) {
      const repaired = sanitizeCourierState({ ...legacy, travelDistance })!;
      expect(repaired.travelDistance).toBe(0);
      expect(repaired.cargo).toEqual(saved.cargo);
    }
    expect(sanitizeCourierState({ ...saved, travelDistance: 1e100 })!.travelDistance).toBe(8);
    for (let i = 0; i < 20; i++) f.tick();
    expect(f.meta.courier!.travelDistance).toBe(8);
  });

  it('ground poses use direct target lookups and moving pose reads never clone a grown ready bank', () => {
    const f = journey();
    f.meta.bank.inventory = Array.from({ length: 10000 }, () => ({
      itemId: 'baked_bread',
      count: 1,
    }));
    const clone = vi.spyOn(f.meta.bank.inventory, 'map');
    const ready = courierInfoFor(f.ctx, 1)!;
    f.player.pos.x = 20;
    const revision = courierWireRevisionFor(f.ctx, 1);
    for (let i = 0; i < 10; i++) {
      f.tick();
      expect(courierInfoFor(f.ctx, 1)).toBe(ready);
      expect(ready.remainingDistance).toBe(0);
      expect(courierWireRevisionFor(f.ctx, 1)).toBe(revision);
    }
    expect(clone).toHaveBeenCalledTimes(1);
    f.dispatch();
    const flying = courierInfoFor(f.ctx, 1)!;
    const flyingRevision = courierWireRevisionFor(f.ctx, 1);
    vi.spyOn(f.ctx.entities, 'values').mockImplementation(() => {
      throw new Error('entity scan');
    });
    for (let i = 0; i < 30; i++) {
      f.tick();
      const pose = courierPoseFor(f.ctx, 1)!;
      expect(courierInfoFor(f.ctx, 1)).toBe(flying);
      expect(flying.travelDistance).toBe(pose.travelDistance);
      expect(flying.remainingDistance).toBe(pose.remainingDistance);
      expect(pose.remainingDistance).toBeCloseTo(Math.hypot(60 - pose.x, 80 - pose.z));
      expect(courierWireRevisionFor(f.ctx, 1)).toBe(flyingRevision);
    }
    expect(clone).toHaveBeenCalledTimes(1);
    f.ctx.entities.delete(2);
    expect(courierPoseFor(f.ctx, 1)!.remainingDistance).toBe(0);
    f.tick();
    expect(f.meta.courier!.travelDistance).toBe(0);
    f.player.dead = true;
    expect(courierPoseFor(f.ctx, 1)!.remainingDistance).toBe(0);
    const frozen = savedCourierState(f.meta.courier!);
    f.tick();
    expect(f.meta.courier).toEqual(frozen);
    f.player.dead = false;
    f.player.pos.x = INSTANCE_X_BASE;
    expect(courierPoseFor(f.ctx, 1)!.remainingDistance).toBe(0);
  });

  it('does not reset leg progress on a refused bank retry and resets once on successful exchange', () => {
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
    for (let i = 0; i < 100 && f.meta.courier!.x !== 30; i++) f.tick();
    expect(f.meta.courier!.travelDistance).toBe(8);
    for (let i = 0; i < 25; i++) f.tick();
    expect(f.meta.courier!.travelDistance).toBe(8);
    expect(courierPoseFor(f.ctx, 1)!.remainingDistance).toBe(0);
    admitted = true;
    for (let i = 0; i < 30 && f.meta.courier!.phase === 'outbound'; i++) f.tick();
    expect(f.meta.courier!.travelDistance).toBe(0);
    f.tick();
    expect(f.meta.courier!.travelDistance).toBeCloseTo(0.35);
  });
});
