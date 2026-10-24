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
  COURIER_CRUISE_SPEED,
  COURIER_FOLLOW_BACK,
  COURIER_FOLLOW_LEFT,
  COURIER_GROUND_SPEED,
  COURIER_LANDING_OFFSET,
  COURIER_MAX_LEG_TICKS,
  courierFollowPoint,
  courierLandingPoint,
  courierLegPlan,
  courierLegProgress,
  courierLegSegmentAt,
  travelCourier,
} from '../src/sim/courier/motion';
import { INSTANCE_X_BASE } from '../src/sim/data';
import { savedMaterialSlot } from '../src/sim/material_slot_load';
import type { PlayerMeta } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { DT, type Entity } from '../src/sim/types';

function journey(x = 60, z = 80) {
  const player = { id: 1, kind: 'player', pos: { x: 0, y: 0, z: 0 }, dead: false } as Entity;
  const banker = { id: 2, kind: 'npc', pos: { x, y: 0, z }, dead: false } as Entity;
  const meta = {
    entityId: 1,
    inventory: [savedMaterialSlot({ itemId: 'baked_bread', count: 1 })],
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

/** Ticks of the leg the courier is flying right now. */
function legTicksOf(f: ReturnType<typeof journey>): number {
  return courierLegPlan(f.meta.courier!.legDistance!).ticks;
}

describe('courier capped-duration flight and grounded endpoints', () => {
  it.each([0, 0.1, 6, 100, 10000])(
    'arrives at the bank on its planned tick, never past fifteen seconds, at distance %s',
    (distance) => {
      const f = journey(distance * 0.6, distance * 0.8);
      expect(f.dispatch()).toBe(true);
      const state = f.meta.courier!;
      expect(state.legDistance).toBeCloseTo(distance, 9);
      const plan = courierLegPlan(distance);
      expect(plan.ticks).toBeLessThanOrEqual(COURIER_MAX_LEG_TICKS);
      for (let i = 1; i < plan.ticks; i++) {
        f.tick();
        expect(state.phase).toBe('outbound');
        expect(state.travelTicks).toBe(i);
        expect(f.meta.bank.inventory).toEqual([]);
        expect(state.x).toBeCloseTo(distance * 0.6 * courierLegProgress(plan, i), 9);
        expect(state.z).toBeCloseTo(distance * 0.8 * courierLegProgress(plan, i), 9);
      }
      f.tick();
      expect(state.phase).toBe('returning');
      expect(state.travelTicks).toBe(0);
      expect(state.x).toBe(distance * 0.6);
      expect(state.z).toBe(distance * 0.8);
      expect(f.meta.bank.inventory).toEqual([
        savedMaterialSlot({ itemId: 'baked_bread', count: 1 }),
      ]);
      const back = legTicksOf(f);
      expect(back).toBeLessThanOrEqual(COURIER_MAX_LEG_TICKS);
      for (let i = 1; i < back; i++) {
        f.tick();
        expect(f.meta.courier).toBe(state);
        expect(state.phase).toBe('returning');
        expect(state.travelTicks).toBe(i);
      }
      f.tick();
      // Delivered: the courier is gone until summoned again.
      expect(f.meta.courier).toBeUndefined();
      expect(courierPoseFor(f.ctx, 1)).toBeNull();
      expect(courierInfoFor(f.ctx, 1)).toBeNull();
      expect(courierWireRevisionFor(f.ctx, 1)).toBeNull();
      expect(courierSummon(f.ctx, 1)).toBe(true);
      expect(f.meta.courier?.phase).toBe('ready');
    },
  );

  it('flies at natural speed on short routes and speeds up to hold the fifteen-second cap', () => {
    const short = courierLegPlan(150);
    expect(short.ticks).toBeLessThan(COURIER_MAX_LEG_TICKS);
    expect(short.cruiseSpeed).toBeCloseTo(COURIER_CRUISE_SPEED, 0);
    expect(short.groundSpeed).toBe(COURIER_GROUND_SPEED);
    // The exact natural-speed boundary sits a little above 300 yards.
    const atCap = courierLegPlan(320);
    expect(atCap.ticks).toBe(COURIER_MAX_LEG_TICKS);
    for (const distance of [1000, 5000, 100000]) {
      const plan = courierLegPlan(distance);
      expect(plan.ticks).toBe(COURIER_MAX_LEG_TICKS);
      // Takeoff and descent keep natural speed; only the airborne cruise is boosted.
      expect(plan.cruiseSpeed).toBe(COURIER_CRUISE_SPEED);
      expect(plan.boostSpeed).toBeGreaterThan(COURIER_CRUISE_SPEED);
      expect(courierLegProgress(plan, COURIER_MAX_LEG_TICKS)).toBe(1);
    }
    expect(courierLegPlan(5000).boostSpeed).toBeGreaterThan(courierLegPlan(1000).boostSpeed);
    expect(short.boostSpeed).toBe(short.cruiseSpeed);
    // Durations never shrink as routes grow.
    let previous = 0;
    for (let distance = 0; distance <= 1000; distance += 5) {
      const ticks = courierLegPlan(distance).ticks;
      expect(ticks).toBeGreaterThanOrEqual(previous);
      previous = ticks;
    }
  });

  it('runs, hops, accelerates into flight, cruises, brakes and skids to a stop', () => {
    const plan = courierLegPlan(5000);
    const steps = Array.from(
      { length: plan.ticks },
      (_, i) => courierLegProgress(plan, i + 1) - courierLegProgress(plan, i),
    );
    // Ground run and hops: two seconds at constant ground speed.
    for (let i = 1; i < 40; i++) expect(steps[i]).toBeCloseTo(steps[0], 12);
    // Takeoff: 1.2 seconds of acceleration.
    for (let i = 41; i < 64; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1]);
    // Airborne: one second easing into the boost, a steady boost, one second easing out.
    for (let i = 65; i < 84; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1]);
    for (let i = 85; i < 244; i++) expect(steps[i]).toBeCloseTo(steps[84], 12);
    for (let i = 245; i < 264; i++) expect(steps[i]).toBeLessThan(steps[i - 1]);
    // Descent then skid only ever slow down, ending nearly stationary.
    for (let i = 265; i < 300; i++) expect(steps[i]).toBeLessThan(steps[i - 1]);
    expect(steps[299]).toBeLessThan(steps[0] / 10);
    expect(steps.reduce((sum, step) => sum + step, 0)).toBeCloseTo(1, 12);
    const at = (ticks: number) => courierLegSegmentAt(ticks, 300);
    expect(at(0)).toEqual({ segment: 'run', u: 0, hop: 0 });
    expect(at(16)).toMatchObject({ segment: 'hop', hop: 0 });
    expect(at(28)).toMatchObject({ segment: 'hop', hop: 1 });
    expect(at(39)).toMatchObject({ segment: 'hop', hop: 2 });
    expect(at(40)).toMatchObject({ segment: 'takeoff', u: 0 });
    expect(at(64).segment).toBe('cruise');
    expect(at(264)).toMatchObject({ segment: 'descent', u: 0 });
    expect(at(263).segment).toBe('cruise');
    expect(at(288)).toMatchObject({ segment: 'skid', u: 0 });
    expect(at(287).segment).toBe('descent');
    expect(at(300)).toMatchObject({ segment: 'skid', u: 1 });
  });

  it('applies the fifteen-second boost only while fully airborne', () => {
    for (const distance of [400, 2000, 100000]) {
      const plan = courierLegPlan(distance);
      const total = distance;
      // Yards per tick at the natural flight speed, with a hair of float slack.
      const natural = COURIER_CRUISE_SPEED * DT * (1 + 1e-9);
      for (let i = 0; i < plan.ticks; i++) {
        const step = (courierLegProgress(plan, i + 1) - courierLegProgress(plan, i)) * total;
        const { segment } = courierLegSegmentAt(i, plan.ticks);
        if (segment === 'cruise') continue;
        expect(step).toBeLessThanOrEqual(natural);
        if (segment === 'run' || segment === 'hop')
          expect(step).toBeCloseTo(COURIER_GROUND_SPEED * DT, 9);
      }
    }
  });

  it('chooses the closest bank once and lands in front of a moving owner on its final tick', () => {
    const f = journey();
    f.ctx.entities.set(3, { ...f.banker, id: 3, pos: { x: -101, y: 0, z: 0 } });
    f.ctx.bankerIds.unshift(3);
    f.dispatch();
    expect(f.meta.courier!.bankerId).toBe(2);
    const out = legTicksOf(f);
    for (let i = 0; i < out; i++) f.tick();
    const state = f.meta.courier!;
    expect(state.phase).toBe('returning');
    // The landing side locked at leg start (facing +Z) ignores later turning.
    expect(state.landingYaw).toBe(0);
    const plan = courierLegPlan(state.legDistance!);
    for (let i = 1; i <= plan.ticks; i++) {
      f.player.pos.x += 2;
      f.player.pos.z += 1;
      f.player.facing = i * 0.7;
      f.tick();
      const landing = courierLandingPoint(f.player.pos, 0);
      expect(state.x).toBeCloseTo(60 + (landing.x - 60) * courierLegProgress(plan, i), 9);
      if (i < plan.ticks) expect(f.meta.courier).toBe(state);
    }
    expect(f.meta.courier).toBeUndefined();
    expect(state.x).toBeCloseTo(f.player.pos.x, 9);
    expect(state.z).toBe(f.player.pos.z + COURIER_LANDING_OFFSET);
  });

  it('never swings the landing point sideways when the owner turns mid-skid', () => {
    const f = journey();
    f.player.facing = Math.PI / 2;
    f.dispatch();
    for (let i = 0; i < legTicksOf(f); i++) f.tick();
    const state = f.meta.courier!;
    expect(state.landingYaw).toBe(Math.PI / 2);
    const back = legTicksOf(f);
    for (let i = 1; i < back - 5; i++) f.tick();
    let x = state.x;
    let z = state.z;
    for (let i = 0; i < 5; i++) {
      f.player.facing += Math.PI;
      f.tick();
      // Skid steps are a fraction of a yard; a swung target would jump ~4 yd.
      expect(Math.hypot(state.x - x, state.z - z)).toBeLessThan(0.5);
      x = state.x;
      z = state.z;
    }
    f.tick();
    expect(f.meta.courier).toBeUndefined();
    expect(state.x).toBeCloseTo(COURIER_LANDING_OFFSET, 9);
    expect(state.z).toBeCloseTo(0, 9);
  });

  it.each(['instanced', 'dead'] as const)(
    'plans the return only once a %s owner is back, from their real position',
    (situation) => {
      const f = journey();
      f.dispatch();
      const out = legTicksOf(f);
      for (let i = 0; i < out - 1; i++) f.tick();
      if (situation === 'instanced') f.player.pos.x = INSTANCE_X_BASE + 5000;
      else f.player.dead = true;
      f.tick();
      const state = f.meta.courier!;
      expect(state.phase).toBe('returning');
      expect(state.travelTicks).toBeUndefined();
      expect(state.legDistance).toBeUndefined();
      for (let i = 0; i < 50; i++) f.tick();
      expect(state.travelTicks).toBeUndefined();
      f.player.pos.x = 0;
      f.player.dead = false;
      f.tick();
      expect(state.travelTicks).toBe(1);
      expect(state.legDistance).toBeCloseTo(Math.hypot(60, 80 - COURIER_LANDING_OFFSET), 9);
      expect(legTicksOf(f)).toBeLessThan(COURIER_MAX_LEG_TICKS);
    },
  );

  it('keeps the landing side through save and reload', () => {
    const f = journey();
    f.player.facing = 1.25;
    f.dispatch();
    for (let i = 0; i < legTicksOf(f) + 5; i++) f.tick();
    const loaded = sanitizeCourierState(savedCourierState(f.meta.courier!))!;
    expect(loaded.landingYaw).toBe(1.25);
    expect(sanitizeCourierState({ ...loaded, landingYaw: NaN })!.landingYaw).toBeUndefined();
  });

  it.each([73, 147, 148, 221, 290])(
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
      const out = legTicksOf(f);
      // Route home from the bank at (60, 80) to the owner's front at (0, 2.2).
      const total = out + courierLegPlan(Math.hypot(60, 80 - COURIER_LANDING_OFFSET)).ticks;
      for (let i = 0; i < count; i++) f.tick();
      const saved = savedCourierState(f.meta.courier!);
      const loaded = sanitizeCourierState(saved)!;
      expect(loaded).toEqual(saved);
      expect(loaded.cargo).not.toBe(saved.cargo);
      f.meta.courier = loaded;
      // Expiry and time spent offline never cancel or advance owned cargo.
      f.meta.membershipExpiresAt = 0;
      for (let i = count; i < total - 1; i++) f.tick();
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
    for (const patch of [
      { travelTicks: undefined },
      { travelTicks: -1 },
      { travelTicks: 1.5 },
      { travelTicks: 301 },
      { travelTicks: NaN },
      { travelTicks: Infinity },
      { travelTicks: 'bad' },
      // A fixed ten-second save predates per-leg distance.
      { legDistance: undefined },
      { legDistance: -1 },
      { legDistance: NaN },
      // Past the end of this route's own plan.
      { travelTicks: courierLegPlan(saved.legDistance!).ticks + 1 },
    ]) {
      const loaded = sanitizeCourierState({ ...saved, ...patch })!;
      expect(loaded.travelTicks).toBeUndefined();
      expect(loaded.legDistance).toBeUndefined();
      expect(loaded.cargo).toEqual(saved.cargo);
      const oldX = loaded.x;
      travelCourier(loaded, 60, 80);
      expect(loaded.travelTicks).toBe(1);
      expect(loaded.legStartX).toBe(oldX);
      expect(loaded.legDistance).toBeCloseTo(Math.hypot(60 - oldX, 80 - loaded.legStartZ!), 9);
    }
  });

  it('pauses a returning leg for a dead or instanced owner, then finishes its remaining ticks', () => {
    const f = journey();
    f.dispatch();
    const out = legTicksOf(f);
    for (let i = 0; i < out + 40; i++) f.tick();
    const back = legTicksOf(f);
    const state = savedCourierState(f.meta.courier!);
    expect(state.travelTicks).toBe(40);
    f.player.dead = true;
    for (let i = 0; i < 300; i++) f.tick();
    expect(f.meta.courier).toEqual(state);
    f.player.dead = false;
    f.player.pos.x = INSTANCE_X_BASE;
    for (let i = 0; i < 300; i++) f.tick();
    expect(f.meta.courier).toEqual(state);
    f.player.pos.x = 0;
    for (let i = 0; i < back - 41; i++) f.tick();
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
    const out = legTicksOf(f);
    for (let i = 0; i < out + 40; i++) f.tick();
    expect(f.meta.courier!.travelTicks).toBe(out);
    expect(f.meta.courier!.x).toBe(30);
    expect(f.meta.bank.inventory).toEqual([]);
    admitted = true;
    for (let i = 0; i < 20; i++) f.tick();
    expect(f.meta.courier!.phase).toBe('returning');
    expect(f.meta.courier!.travelTicks).toBe(0);
    f.tick();
    expect(f.meta.courier!.travelTicks).toBe(1);
  });

  it('waits off the left shoulder and behind, mirroring the buddy, never underfoot', () => {
    // Facing +Z: left is +X, behind is -Z (forward (sin f, cos f), right (-cos f, sin f)).
    expect(courierFollowPoint({ x: 10, z: 10 }, 0)).toEqual({
      x: 10 + COURIER_FOLLOW_LEFT,
      z: 10 - COURIER_FOLLOW_BACK,
    });
    // Facing +X: left is -Z, behind is -X.
    const east = courierFollowPoint({ x: 0, z: 0 }, Math.PI / 2);
    expect(east.x).toBeCloseTo(-COURIER_FOLLOW_BACK, 9);
    expect(east.z).toBeCloseTo(-COURIER_FOLLOW_LEFT, 9);
    // The buddy's right-and-behind heel sits on the other side of the owner.
    expect(COURIER_FOLLOW_LEFT).toBe(3);
    expect(COURIER_FOLLOW_BACK).toBe(2.2);
    const f = journey();
    const state = f.meta.courier!;
    expect(state.phase).toBe('ready');
    expect([state.x, state.z]).toEqual([COURIER_FOLLOW_LEFT, -COURIER_FOLLOW_BACK]);
    f.player.pos.x = 20;
    for (let i = 0; i < 200; i++) f.tick();
    expect(state.x).toBeCloseTo(20 + COURIER_FOLLOW_LEFT, 9);
    expect(state.z).toBeCloseTo(-COURIER_FOLLOW_BACK, 9);
    expect(Math.hypot(state.x - f.player.pos.x, state.z - f.player.pos.z)).toBeGreaterThan(3);
  });

  it('an empty request dismisses only a waiting, empty courier, even after expiry', () => {
    const empty = { deposits: [], withdrawals: [] };
    const f = journey();
    f.meta.membershipExpiresAt = 0;
    expect(courierDispatch(f.ctx, empty, 1)).toBe(true);
    expect(f.meta.courier).toBeUndefined();
    expect(courierDispatch(f.ctx, empty, 1)).toBe(false);
    for (const phase of ['outbound', 'returning', 'waiting'] as const) {
      const g = journey();
      g.meta.courier!.phase = phase;
      expect(courierDispatch(g.ctx, empty, 1), phase).toBe(false);
      expect(g.meta.courier, phase).toBeDefined();
    }
    const loaded = journey();
    loaded.meta.courier!.cargo = [{ itemId: 'baked_bread', count: 1 }];
    expect(courierDispatch(loaded.ctx, empty, 1)).toBe(false);
    expect(loaded.meta.courier!.cargo).toHaveLength(1);
  });
});
