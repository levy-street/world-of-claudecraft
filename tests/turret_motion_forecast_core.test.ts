import { describe, expect, it } from 'vitest';
import { turretWireNumber } from '../server/turret_self_wire';
import {
  newTurretMonsterPose,
  type TurretMonsterInput,
  turretMonsterPoseInto,
} from '../src/render/turret_monster_pose_core';
import {
  TURRET_BLEND_MAX,
  TURRET_BLEND_SECONDS,
  TURRET_FORECAST_STEPS,
  type TurretForecastInput,
  TurretMotionForecast,
} from '../src/render/turret_motion_forecast_core';
import { TURRET_MISSION_PACK } from '../src/sim/content/fire_and_fly_missions';
import { TURRET_SCENARIO_STANDARD } from '../src/sim/content/fire_and_fly_scenarios';
import {
  TURRET_ARENA,
  TURRET_BOWLING,
  TURRET_PHYSICS,
  TURRET_TIMING,
} from '../src/sim/content/turret_defense';
import { MOBS } from '../src/sim/data';
import {
  type FlySegment,
  type MotionSegment,
  marchSegment,
  planFlight,
  positionAt,
  resolveFlightEnd,
  type SkidSegment,
  stillSegment,
  type ThrowProbe,
} from '../src/sim/minigames/thrown_body';
import {
  createTurretDefense,
  fireTurret,
  type TurretMonsterState,
  tickTurretDefense,
} from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
import { turretRallySlot } from '../src/sim/minigames/turret_rally';
import { DT } from '../src/sim/types';

const flat: ThrowProbe = { ground: () => 0, water: () => null };
const kind = { radius: 0.6, marchSpeed: 4 };
const center = { cx: 0, cz: 0 };

function body(
  state: TurretMonsterState,
  seg: MotionSegment,
  over: Partial<TurretForecastInput> = {},
): TurretForecastInput {
  return { id: 3, hp: 40, maxHp: 100, state, seg, facing: 0.3, ...over };
}

function fly(start: number, x: number, z: number, vx: number, vy: number, vz: number): FlySegment {
  return planFlight(start, x, 0, z, { x: vx, y: vy, z: vz }, kind.radius, flat, TURRET_PHYSICS);
}

describe('Fire and Fly motion forecast', () => {
  it('keeps the engine segment while it runs', () => {
    const seg = fly(10, 20, 0, 6, 12, 0);
    const f = new TurretMotionForecast().resolve(
      body('fly', seg),
      kind,
      center,
      11,
      flat,
      TURRET_PHYSICS,
    );
    expect(f.seg).toBe(seg);
    expect(f.state).toBe('fly');
    expect(f.steps).toBe(0);
  });

  it('carries a flight past its end on the bounce the engine is about to start', () => {
    const seg = fly(10, 20, 0, 6, 12, 0);
    const out = resolveFlightEnd(seg, kind.radius, flat, TURRET_PHYSICS);
    expect(out.kind).toBe('bounce');
    if (out.kind !== 'bounce') return;
    const tick = seg.end + 0.6;
    const f = new TurretMotionForecast().resolve(
      body('fly', seg),
      kind,
      center,
      tick,
      flat,
      TURRET_PHYSICS,
    );
    expect(f.state).toBe('fly');
    expect(f.seg).toEqual(out.seg);
    expect(f.seg.start).toBe(seg.end);
    // Past the contact the body keeps moving: the engine's own segment would hold it there.
    const held = positionAt(seg, tick, flat);
    const carried = positionAt(f.seg, tick, flat);
    expect(Math.hypot(carried.x - held.x, carried.y - held.y)).toBeGreaterThan(0.1);
  });

  it('forecasts a landing into its slide, a slide into its rest, a rest into the get-up and the march back', () => {
    // A low hop lands at once (too slow to bounce) and slides.
    const hop = fly(0, 20, 0, 9, 2, 0);
    const out = resolveFlightEnd(hop, kind.radius, flat, TURRET_PHYSICS);
    expect(out.kind).toBe('land');
    if (out.kind !== 'land' || !out.skid) throw new Error('expected a slide');
    const living = new TurretMotionForecast();
    living.resolve(body('fly', hop), kind, center, hop.end + 0.2, flat, TURRET_PHYSICS);
    expect(living.state).toBe('skid');
    expect(living.seg).toEqual(out.skid);
    living.resolve(body('fly', hop), kind, center, out.skid.end + 0.2, flat, TURRET_PHYSICS);
    expect(living.state).toBe('down');
    expect(living.seg.start).toBe(out.skid.end);
    expect(living.seg.end - living.seg.start).toBe(TURRET_TIMING.downTicks);
    const corpse = new TurretMotionForecast();
    corpse.resolve(
      body('fly', hop, { hp: 0 }),
      kind,
      center,
      out.skid.end + 0.2,
      flat,
      TURRET_PHYSICS,
    );
    expect(corpse.state).toBe('dead');
    expect(corpse.seg.end - corpse.seg.start).toBe(TURRET_TIMING.corpseTicks);

    const at = { x: 12, y: 0, z: 5 };
    const down = stillSegment(40, TURRET_TIMING.downTicks, at);
    const up = new TurretMotionForecast();
    up.resolve(body('down', down), kind, center, down.end + 0.5, flat, TURRET_PHYSICS);
    expect(up.state).toBe('rise');
    expect(up.seg.end - up.seg.start).toBe(TURRET_TIMING.riseTicks);
    const rise = stillSegment(60, TURRET_TIMING.riseTicks, at);
    const walk = new TurretMotionForecast();
    walk.resolve(body('rise', rise), kind, center, rise.end + 0.5, flat, TURRET_PHYSICS);
    expect(walk.state).toBe('march');
    expect(walk.seg.kind).toBe('march');
    if (walk.seg.kind !== 'march') return;
    expect(walk.seg.start).toBe(rise.end);
    expect(walk.seg.speed).toBe(kind.marchSpeed);
    const d = Math.hypot(at.x, at.z);
    expect(walk.seg.dx).toBeCloseTo(-at.x / d, 12);
    expect(walk.seg.dz).toBeCloseTo(-at.z / d, 12);
    expect(walk.facing).toBeCloseTo(Math.atan2(-at.x, -at.z), 12);
  });

  it('rests a body that slid into the strike ring on the ring, as the engine does', () => {
    const skid: SkidSegment = {
      kind: 'skid',
      start: 5,
      end: 7,
      x: 2,
      y: 0,
      z: 0,
      vx: -1,
      vz: 0,
      decel: 25,
      contact: 'stop',
    };
    const f = new TurretMotionForecast();
    f.resolve(body('skid', skid), kind, center, 7.5, flat, TURRET_PHYSICS);
    expect(f.state).toBe('down');
    const p = positionAt(f.seg, 7.5, flat);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(TURRET_ARENA.breachRadius + kind.radius, 9);
  });

  it('holds a splash or a flight lost in the void, and resolves a contact once', () => {
    const wet: ThrowProbe = { ground: () => 0, water: (x) => (x > 25 ? 3 : null) };
    const seg = planFlight(0, 20, 0, 0, { x: 8, y: 10, z: 0 }, kind.radius, wet, TURRET_PHYSICS);
    expect(seg.contact).toBe('water');
    const f = new TurretMotionForecast();
    f.resolve(body('fly', seg), kind, center, seg.end + 1, wet, TURRET_PHYSICS);
    expect(f.seg).toBe(seg);
    // A bounce chain is resolved on the tick that first passes the contact, then reused.
    const bouncing = fly(0, 20, 0, 6, 14, 0);
    const g = new TurretMotionForecast();
    g.resolve(body('fly', bouncing), kind, center, bouncing.end + 0.3, flat, TURRET_PHYSICS);
    const first = g.seg;
    g.resolve(body('fly', { ...bouncing }), kind, center, bouncing.end + 0.4, flat, TURRET_PHYSICS);
    expect(g.seg).toBe(first);
    expect(g.steps).toBe(1);
    // However far the display runs ahead, the chain stops at the step bound.
    g.resolve(body('fly', bouncing), kind, center, bouncing.end + 400, flat, TURRET_PHYSICS);
    expect(g.steps).toBeLessThanOrEqual(TURRET_FORECAST_STEPS);
  });

  it('blends a jump the engine makes out over a few frames, and never a forecast step', () => {
    const skid: SkidSegment = {
      kind: 'skid',
      start: 5,
      end: 7,
      x: 2.4,
      y: 0,
      z: 0,
      vx: -0.5,
      vz: 0,
      decel: 25,
      contact: 'stop',
    };
    const f = new TurretMotionForecast();
    const m = body('skid', skid);
    const pose = newTurretMonsterPose();
    const sample = (tick: number) => {
      f.resolve(m, kind, center, tick, flat, TURRET_PHYSICS);
      turretMonsterPoseInto(pose, f, { mass: 1 }, tick, flat, false, center);
      f.blend(pose, tick, flat);
      return { x: pose.x, z: pose.z };
    };
    const before = sample(6.9);
    const at = sample(7.1);
    // The rest is pushed out to the ring, but the body is drawn where it slid to...
    expect(Math.hypot(at.x - before.x, at.z - before.z)).toBeLessThan(0.05);
    const ring = TURRET_ARENA.breachRadius + kind.radius;
    // ...and eases onto the ring: a third after TURRET_BLEND_SECONDS, nearly all after three.
    const start = ring - at.x;
    const later = sample(7.1 + TURRET_BLEND_SECONDS / DT);
    expect(ring - later.x).toBeCloseTo(start / Math.E, 6);
    const settled = sample(7.1 + (4 * TURRET_BLEND_SECONDS) / DT);
    expect(ring - settled.x).toBeLessThan(0.03 * start);

    // A forecast bounce and the engine's identical one leave no offset at all.
    const seg = fly(10, 20, 0, 6, 12, 0);
    const out = resolveFlightEnd(seg, kind.radius, flat, TURRET_PHYSICS);
    if (out.kind !== 'bounce') throw new Error('expected a bounce');
    const g = new TurretMotionForecast();
    const p2 = newTurretMonsterPose();
    const draw = (mm: TurretMonsterInput, tick: number) => {
      g.resolve(mm, kind, center, tick, flat, TURRET_PHYSICS);
      turretMonsterPoseInto(p2, g, { mass: 1 }, tick, flat, false, center);
      const raw = positionAt(g.seg, tick, flat);
      g.blend(p2, tick, flat);
      return Math.hypot(p2.x - raw.x, p2.y - raw.y, p2.z - raw.z);
    };
    expect(draw(body('fly', seg), seg.end - 0.2)).toBe(0);
    expect(draw(body('fly', seg), seg.end + 0.3)).toBeLessThan(1e-9);
    expect(draw(body('fly', { ...out.seg }), seg.end + 0.6)).toBeLessThan(1e-9);
  });

  it('snaps a correction too large to be one (a body that changed hands)', () => {
    const f = new TurretMotionForecast();
    const pose = newTurretMonsterPose();
    const draw = (m: TurretMonsterInput, tick: number) => {
      f.resolve(m, kind, center, tick, flat, TURRET_PHYSICS);
      turretMonsterPoseInto(pose, f, { mass: 1 }, tick, flat, false, center);
      f.blend(pose, tick, flat);
      return pose.x;
    };
    draw(body('down', stillSegment(0, 16, { x: 20, y: 0, z: 0 })), 1);
    const far = 20 + TURRET_BLEND_MAX + 1;
    expect(draw(body('down', stillSegment(1, 16, { x: far, y: 0, z: 0 })), 2)).toBe(far);
  });
});

describe('Fire and Fly bodies drawn between engine ticks', () => {
  /**
   * Plays the real engine and draws one thrown body at three frames a tick, the
   * display leading the last processed tick as the painter's clock does. Returns
   * each frame's horizontal step, with the forecast or with the engine's bare
   * segments.
   */
  function frameSteps(forecast: boolean): { steps: number[]; states: string[] } {
    const plan = resolveTurretPlan(TURRET_SCENARIO_STANDARD, MOBS, {
      ...TURRET_BOWLING,
      enabled: false,
    });
    const state = createTurretDefense(plan, { x: 0, z: 0 }, 11, 0);
    let clock = 0;
    let target: (typeof state.monsters)[number] | undefined;
    while (clock < 2000 && !target) {
      tickTurretDefense(state, ++clock, flat);
      target = state.monsters.find((m) => {
        const p = positionAt(m.seg, clock, flat);
        return m.state === 'march' && Math.hypot(p.x, p.z) < 26;
      });
    }
    if (!target) throw new Error('no monster came close');
    const id = target.id;
    const p = positionAt(target.seg, clock, flat);
    const fired = fireTurret(state, clock, p.x + 0.8, p.z + 0.3, flat);
    expect(fired.ok).toBe(true);
    const k = plan.kinds[target.kind];
    const f = new TurretMotionForecast();
    const pose = newTurretMonsterPose();
    const steps: number[] = [];
    const states: string[] = [];
    let last: { x: number; z: number } | null = null;
    for (let d = clock; d < clock + 90; d += 1 / 3) {
      while (clock < Math.floor(d + 1e-9)) tickTurretDefense(state, ++clock, flat);
      const m = state.monsters.find((x) => x.id === id);
      if (!m) break;
      const view = forecast ? f.resolve(m, k, state, d, flat, TURRET_PHYSICS) : m;
      turretMonsterPoseInto(pose, view, k, d, flat, false, state);
      if (forecast) f.blend(pose, d, flat);
      if (last) steps.push(Math.hypot(pose.x - last.x, pose.z - last.z));
      states.push(view.state);
      last = { x: pose.x, z: pose.z };
    }
    return { steps, states };
  }

  /** Frames that stand still while the body is in motion on both sides, then leap. */
  function holdThenJumps(steps: number[]): number {
    let count = 0;
    for (let i = 1; i < steps.length - 1; i++) {
      const moving = Math.max(steps[i - 1], steps[i + 1]);
      if (steps[i] < 0.1 * moving && steps[i + 1] > 1.8 * steps[i - 1] && moving > 0.05) count++;
    }
    return count;
  }

  it('never holds a thrown body at a contact and then jumps it forward', () => {
    const bare = frameSteps(false);
    const carried = frameSteps(true);
    expect(carried.states).toContain('fly');
    expect(carried.states).toContain('march');
    // The engine's segments alone hold at every contact (the decisive contrast)...
    expect(holdThenJumps(bare.steps)).toBeGreaterThan(0);
    // ...the forecast never does, and no frame moves faster than the throw cap allows.
    expect(holdThenJumps(carried.steps)).toBe(0);
    const cap = 32 * (DT / 3) * 1.2;
    for (const step of carried.steps) expect(step).toBeLessThanOrEqual(cap);
  });
});

describe('a hunt forecast', () => {
  /**
   * Plays The Pack's first waves with a shell into a gathering rally every five seconds, and
   * at every engine transition of a gathering body checks that the forecast, resolved from
   * the record and rallies of the tick before (`read` as the client gets them), already stood
   * on the segment the engine then started: same state, same place, same speed, and the same
   * end, a walk or stand the departure will cut already cut there. Returns the worst gaps.
   */
  function followThePack(read: <T>(value: T) => T) {
    const plan = resolveTurretPlan(TURRET_MISSION_PACK, MOBS, {
      ...TURRET_BOWLING,
      enabled: false,
    });
    const state = createTurretDefense(plan, { x: 0, z: 0 }, 9, 0);
    const seen: Record<string, number> = {};
    const worst = { place: 0, tick: 0 };
    for (let t = 0; t < 20 * 60 && state.wave < 3; t++) {
      const before = new Map(state.monsters.map((m) => [m.id, read(structuredClone(m))]));
      const rallies = read(structuredClone(state.rallies ?? []));
      const center = { cx: 0, cz: 0, rallies };
      if (t % 100 === 0 && t >= state.readyTick) {
        const holder = state.monsters.find((m) => m.state === 'hold' && m.hp > 0);
        if (holder) {
          const p = positionAt(holder.seg, t, flat);
          fireTurret(state, t, p.x + 1.5, p.z, flat);
        }
      }
      tickTurretDefense(state, t + 1, flat);
      for (const m of state.monsters) {
        const was = before.get(m.id);
        if (!was || !(m.seg.start > t) || !(m.seg.start <= t + 1)) continue;
        if (!['muster', 'hold', 'rise'].includes(was.state)) continue;
        if (!['muster', 'hold', 'march'].includes(m.state)) continue;
        const kind = plan.kinds[m.kind];
        const f = new TurretMotionForecast().resolve(
          was,
          kind,
          center,
          t + 1.5,
          flat,
          TURRET_PHYSICS,
        );
        expect(f.state, `${was.state} to ${m.state}`).toBe(m.state);
        expect(f.seg.kind).toBe(m.seg.kind);
        const depart = rallies.find((r) => r.id === m.rally)?.departTick ?? -1;
        const cut = m.state !== 'march' && depart >= m.seg.start && depart < m.seg.end;
        const end = cut ? depart : m.seg.end;
        worst.tick = Math.max(
          worst.tick,
          Math.abs(f.seg.start - m.seg.start),
          Math.abs(f.seg.end - end),
        );
        for (const at of [t + 1.5, t + 10]) {
          if (at > end) continue;
          const a = positionAt(f.seg, at, flat);
          const b = positionAt(m.seg, at, flat);
          worst.place = Math.max(worst.place, Math.hypot(a.x - b.x, a.z - b.z));
        }
        const key = `${was.state}>${m.state}`;
        seen[key] = (seen[key] ?? 0) + 1;
      }
    }
    expect(seen['muster>hold']).toBeGreaterThan(20);
    expect(seen['hold>march']).toBeGreaterThan(10);
    expect(seen['rise>muster']).toBeGreaterThan(0);
    // Stragglers: caught walking in, or back on their feet, when their pack left.
    expect((seen['muster>march'] ?? 0) + (seen['rise>march'] ?? 0)).toBeGreaterThan(0);
    return worst;
  }

  it('starts every gathering leg, stand, departure and walk back exactly where the engine does', () => {
    const worst = followThePack((value) => value);
    expect(worst.place).toBeLessThan(1e-9);
    expect(worst.tick).toBeLessThan(1e-9);
  });

  it('stays within the wire rounding when it reads the seat online', () => {
    const online = <T>(value: T): T => JSON.parse(JSON.stringify(value, turretWireNumber));
    const worst = followThePack(online);
    // The seat's own bound (positions to the millimetre); a leg's end tick moves by the
    // rounded distance over the pace, a few thousandths of a tick.
    expect(worst.place).toBeLessThan(1e-3);
    expect(worst.tick).toBeLessThan(5e-3);
  });

  it('holds a stand the engine has not ended, then leaves on the departure the cue set', () => {
    const rally = {
      id: 0,
      x: 0,
      z: 30,
      pace: 5,
      holdTicks: 120,
      leader: 1,
      firstArrivalTick: 100,
      cueTick: -1,
      departTick: -1,
    };
    const at = { x: 0.5, y: 0, z: 30 };
    const hold = body('hold', stillSegment(110, 140 - 110, at), { rally: 0, slot: 2, pace: 4.2 });
    const scoutKind = { ...kind, role: 'scout' as const };
    const f = new TurretMotionForecast();
    // Past the bound with no cue known: it stands, never a guess at the departure.
    f.resolve(hold, kind, { ...center, rallies: [rally] }, 150, flat, TURRET_PHYSICS);
    expect(f.state).toBe('hold');
    // The cue lands: the stand is cut at the departure and the pack's pace takes over.
    const cued = { ...rally, cueTick: 105, departTick: 125 };
    f.resolve(hold, kind, { ...center, rallies: [cued] }, 130, flat, TURRET_PHYSICS);
    expect(f.state).toBe('march');
    expect(f.seg.start).toBe(125);
    expect(f.seg.kind === 'march' && f.seg.speed).toBe(5);
    // A scout breaks out at its own pace.
    const s = new TurretMotionForecast().resolve(
      hold,
      scoutKind,
      { ...center, rallies: [cued] },
      130,
      flat,
      TURRET_PHYSICS,
    );
    expect(s.seg.kind === 'march' && s.seg.speed).toBe(4.2);
  });

  it('cuts a walk back it planned in the same frame at the departure, as the engine does', () => {
    const rally = {
      id: 0,
      x: 0,
      z: 30,
      pace: 5,
      holdTicks: 120,
      leader: 1,
      firstArrivalTick: 60,
      cueTick: 85,
      departTick: 105,
    };
    const from = { x: 12, y: 0, z: 30 };
    const rise = body('rise', stillSegment(90, 10, from), { rally: 0, slot: 0, pace: 4 });
    // Back on its feet at 100 and walking to its place when its pack leaves at 105: one frame
    // at 110 covers both, so the body already marches from where the walk stood at 105.
    const f = new TurretMotionForecast().resolve(
      rise,
      kind,
      { ...center, rallies: [rally] },
      110,
      flat,
      TURRET_PHYSICS,
    );
    expect(f.state).toBe('march');
    expect(f.seg.start).toBe(105);
    expect(f.seg.kind === 'march' && f.seg.speed).toBe(5);
    const slot = turretRallySlot(rally, 0, 0, 0);
    const walk = marchSegment(100, from.x, from.y, from.z, slot.x, slot.z, 4, 0);
    const a = positionAt(f.seg, 105, flat);
    const b = positionAt(walk, 105, flat);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(1e-9);
  });
});

describe('a hunt pose', () => {
  it('walks a gathering member like a marcher, and stands a holder facing the tower', () => {
    const pose = newTurretMonsterPose();
    const walk = body('muster', {
      kind: 'march',
      start: 0,
      end: 40,
      x: 10,
      y: 0,
      z: 40,
      dx: 0,
      dz: -1,
      speed: 5,
    });
    turretMonsterPoseInto(pose, walk, { mass: 1 }, 10, flat, false, center);
    expect(pose.moving).toBe(true);
    expect(pose.speed).toBe(5);
    expect(pose.yaw).toBeCloseTo(Math.PI, 12);
    expect(pose.attitude).toBe('upright');
    const stand = body('hold', stillSegment(0, 40, { x: 10, y: 0, z: 30 }), { facing: 2 });
    turretMonsterPoseInto(pose, stand, { mass: 1 }, 10, flat, false, center);
    expect(pose.moving).toBe(false);
    expect(pose.speed).toBe(0);
    expect(pose.yaw).toBeCloseTo(Math.atan2(-10, -30), 12);
    expect(pose.attitude).toBe('upright');
    expect(pose.windup).toBe(-1);
  });

  it('keeps a holder its own facing with no tower to turn to, and freezes both states when lost', () => {
    const pose = newTurretMonsterPose();
    const stand = body('hold', stillSegment(0, 40, { x: 10, y: 0, z: 30 }), { facing: 2 });
    turretMonsterPoseInto(pose, stand, { mass: 1 }, 10, flat, false, null);
    expect(pose.yaw).toBe(2);
    expect(pose.moving).toBe(false);
    turretMonsterPoseInto(pose, stand, { mass: 1 }, 10, flat, true, center);
    expect(pose.attitude).toBe('hold');
    const walk = body('muster', {
      kind: 'march',
      start: 0,
      end: 40,
      x: 10,
      y: 0,
      z: 40,
      dx: 0,
      dz: -1,
      speed: 5,
    });
    turretMonsterPoseInto(pose, walk, { mass: 1 }, 10, flat, true, center);
    expect(pose.moving).toBe(false);
    expect(pose.speed).toBe(0);
    expect(pose.attitude).toBe('hold');
  });
});
