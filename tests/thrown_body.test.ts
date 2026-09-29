import { describe, expect, it } from 'vitest';
import {
  TURRET_PHYSICS,
  TURRET_SIZE_CLASSES,
  TURRET_WEAPON,
} from '../src/sim/content/turret_defense';
import {
  blastFalloff,
  type FlySegment,
  launchVelocity,
  type MotionSegment,
  marchSegment,
  planFlight,
  planSkid,
  positionAt,
  resolveFlightEnd,
  type SweepResult,
  sweepCylinder,
  type ThrowProbe,
  throwDirection,
  velocityAt,
} from '../src/sim/minigames/thrown_body';
import { DT, type TurretSizeClass } from '../src/sim/types';

const flat: ThrowProbe = { ground: () => 0, water: () => null };
const sloped: ThrowProbe = {
  ground: (x, z) => 0.35 * x + 1.5 * Math.sin(z * 0.4) + 0.8 * Math.cos(x * 0.7),
  water: () => null,
};
const R = TURRET_WEAPON.blastRadius;
const CORE = TURRET_WEAPON.blastCore;
const SIZES = Object.keys(TURRET_SIZE_CLASSES) as TurretSizeClass[];

function coreThrow(size: TurretSizeClass, probe: ThrowProbe = flat, dirX = 1, dirZ = 0) {
  const c = TURRET_SIZE_CLASSES[size];
  const v = launchVelocity(
    1,
    c.mass,
    dirX,
    dirZ,
    TURRET_WEAPON.push,
    TURRET_WEAPON.pop,
    TURRET_WEAPON.massExponent,
  );
  const y = probe.ground(0, 0);
  return { v, seg: planFlight(0, 0, y, 0, v, c.radius, probe, TURRET_PHYSICS), radius: c.radius };
}

function rawFly(seg: FlySegment, tick: number) {
  const s = (tick - seg.start) * DT;
  return {
    x: seg.x + seg.vx * s,
    y: seg.y + seg.vy * s - 0.5 * seg.g * s * s,
    z: seg.z + seg.vz * s,
  };
}

/** Follows a thrown body through every flight and the final skid; returns all segments. */
function chain(seg: FlySegment, radius: number, probe: ThrowProbe) {
  const segs: MotionSegment[] = [seg];
  const kinds: string[] = [];
  let cur = seg;
  for (let i = 0; i < 20; i++) {
    const out = resolveFlightEnd(cur, radius, probe, TURRET_PHYSICS);
    kinds.push(out.kind);
    if (out.kind === 'bounce' || out.kind === 'wall') {
      cur = out.seg;
      segs.push(cur);
      continue;
    }
    if (out.kind === 'land' && out.skid) segs.push(out.skid);
    break;
  }
  return { segs, kinds };
}

function restingPoint(segs: MotionSegment[], probe: ThrowProbe) {
  const last = segs[segs.length - 1];
  return positionAt(last, last.end, probe);
}

const free = (tx: number, tz: number): SweepResult => ({ x: tx, z: tz, blocked: false });

describe('blast falloff', () => {
  it('is 1 in the core, linear to 0 at the rim, and 0 outside', () => {
    expect(blastFalloff(0, R, CORE)).toBe(1);
    expect(blastFalloff(CORE, R, CORE)).toBe(1);
    expect(blastFalloff((CORE + R) / 2, R, CORE)).toBeCloseTo(0.5, 12);
    expect(blastFalloff(R - 0.045, R, CORE)).toBeCloseTo(0.01, 12);
    expect(blastFalloff(R, R, CORE)).toBe(0);
    expect(blastFalloff(R + 1, R, CORE)).toBe(0);
    expect(blastFalloff(Number.NaN, R, CORE)).toBe(0);
  });
});

describe('launch velocity', () => {
  it('scales push and pop by the falloff over the mass raised to the exponent', () => {
    const v = launchVelocity(0.5, 8, 0.6, 0.8, 10, 12, 1 / 3);
    expect(v.x).toBeCloseTo(1.5, 12);
    expect(v.y).toBeCloseTo(3, 12);
    expect(v.z).toBeCloseTo(2, 12);
    expect(launchVelocity(1, 4, 1, 0, 10, 12, 0.5)).toEqual({ x: 5, y: 6, z: 0 });
  });
});

describe('core-hit throw tuning on flat ground', () => {
  const targets: Record<TurretSizeClass, { distance: number; peak?: number }> = {
    small: { distance: 24, peak: 6.4 },
    medium: { distance: 17.5 },
    large: { distance: 11.5 },
    huge: { distance: 8.8, peak: 2.35 },
  };
  const firstContact = (size: TurretSizeClass) => {
    const { seg } = coreThrow(size);
    const end = positionAt(seg, seg.end, flat);
    return Math.hypot(end.x, end.z);
  };

  it.each(SIZES)('%s flies to its target distance and peak (within 15 percent)', (size) => {
    const { seg } = coreThrow(size);
    const distance = firstContact(size);
    let peak = 0;
    for (let t = seg.start; t <= seg.end; t += 0.05)
      peak = Math.max(peak, positionAt(seg, t, flat).y);
    const want = targets[size];
    expect(distance).toBeGreaterThan(want.distance * 0.85);
    expect(distance).toBeLessThan(want.distance * 1.15);
    if (want.peak !== undefined) {
      expect(peak).toBeGreaterThan(want.peak * 0.85);
      expect(peak).toBeLessThan(want.peak * 1.15);
    }
    expect(seg.contact).toBe('ground');
  });

  it('keeps a single core hit on the lightest body under the juggle caps', () => {
    const lightest = SIZES.reduce((a, b) =>
      TURRET_SIZE_CLASSES[a].mass <= TURRET_SIZE_CLASSES[b].mass ? a : b,
    );
    const { v } = coreThrow(lightest);
    expect(Math.hypot(v.x, v.z)).toBeLessThan(TURRET_WEAPON.maxLaunchSpeed);
    expect(v.y).toBeLessThan(TURRET_WEAPON.maxLaunchLift);
  });

  it('ranks the size classes by distance: a wolf flies farther than an ogre, an ogre than a yeti', () => {
    expect(firstContact('small')).toBeGreaterThan(firstContact('medium'));
    expect(firstContact('medium')).toBeGreaterThan(firstContact('large'));
    expect(firstContact('large')).toBeGreaterThan(firstContact('huge'));
  });
});

describe('closed-form segments', () => {
  it('gives the ballistic position at any fractional tick', () => {
    const { seg, v } = coreThrow('small');
    for (const tick of [0.5, 3.25, 7.9, 11.111]) {
      const s = tick * DT;
      const p = positionAt(seg, tick, flat);
      expect(p.x).toBeCloseTo(v.x * s, 12);
      expect(p.z).toBeCloseTo(v.z * s, 12);
      expect(p.y).toBeCloseTo(v.y * s - 0.5 * TURRET_PHYSICS.gravity * s * s, 12);
    }
  });

  it('clamps to the segment span before the start and after the end', () => {
    const { seg } = coreThrow('medium');
    expect(positionAt(seg, seg.start - 5, flat)).toEqual(positionAt(seg, seg.start, flat));
    expect(positionAt(seg, seg.end + 40, flat)).toEqual(positionAt(seg, seg.end, flat));
  });

  it('marches at its speed and stops at the stop distance, reading only a ground function', () => {
    const groundOnly = { ground: () => 0.5 };
    const m = marchSegment(10, 0, 0.5, 46, 0, 0, 4.4, 4.1);
    expect(m.end - m.start).toBeCloseTo((46 - 4.1) / 4.4 / DT, 9);
    const end = positionAt(m, m.end + 100, groundOnly);
    expect(Math.hypot(end.x, end.z)).toBeCloseTo(4.1, 9);
    const mid = positionAt(m, 10 + 20, groundOnly);
    expect(mid).toEqual({ x: 0, y: 0.5, z: expect.closeTo(46 - 4.4, 9) });
  });

  it('never produces NaN for degenerate marches (inside the stop distance, zero speed)', () => {
    for (const m of [marchSegment(0, 1, 0, 1, 1, 1, 4, 3), marchSegment(0, 10, 0, 0, 0, 0, 0, 3)]) {
      expect(m.end).toBe(m.start);
      const p = positionAt(m, 5, flat);
      expect([p.x, p.y, p.z].every(Number.isFinite)).toBe(true);
    }
  });
});

describe('non-finite ground', () => {
  const holey: ThrowProbe = { ground: (x) => (x > 5 ? Number.NaN : 0), water: () => null };

  it('falls back to the segment height instead of writing NaN', () => {
    const m = marchSegment(0, 0, 0.25, 0, 20, 0, 5, 0);
    const p = positionAt(m, 40, holey);
    expect(p.x).toBeGreaterThan(5);
    expect(p.y).toBe(0.25);
    const skid = planSkid(0, 4, 0.25, 0, 12, 0, 0.6, holey, TURRET_PHYSICS);
    if (!skid) throw new Error('no skid');
    const q = positionAt(skid, skid.end, holey);
    expect(q.x).toBeGreaterThan(5);
    expect(q.y).toBe(0.25);
  });

  it('treats non-finite ground as no contact, never a landing', () => {
    const { seg } = coreThrow('small', holey);
    expect(seg.contact).toBe('void');
    const p = positionAt(seg, seg.start + 30, holey);
    expect([p.x, p.y, p.z].every(Number.isFinite)).toBe(true);
  });
});

describe('ground contact: bounce, then skid, then rest', () => {
  it('bounces while the fall is fast, keeping 0.35 of the vertical and 0.6 of the horizontal speed', () => {
    const { seg } = coreThrow('small');
    const out = resolveFlightEnd(seg, 0.6, flat, TURRET_PHYSICS);
    expect(out.kind).toBe('bounce');
    if (out.kind !== 'bounce') return;
    const impact = velocityAt(seg, seg.end);
    expect(impact.y).toBeLessThan(-4);
    expect(out.speed).toBeCloseTo(-impact.y, 9);
    expect(out.seg.vy).toBeCloseTo(-impact.y * 0.35, 9);
    expect(out.seg.vx).toBeCloseTo(seg.vx * 0.6, 9);
    expect(out.seg.start).toBe(seg.end);
  });

  it('lands once the fall is slow and skids to the stop speed', () => {
    const { seg } = coreThrow('small');
    const { segs, kinds } = chain(seg, 0.6, flat);
    expect(kinds[kinds.length - 1]).toBe('land');
    expect(kinds.slice(0, -1).every((k) => k === 'bounce')).toBe(true);
    const skid = segs[segs.length - 1];
    expect(skid.kind).toBe('skid');
    if (skid.kind !== 'skid') return;
    expect(skid.contact).toBe('stop');
    const v = velocityAt(skid, skid.end);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(0.3, 9);
    const lastFly = segs[segs.length - 2] as FlySegment;
    expect(velocityAt(lastFly, lastFly.end).y).toBeGreaterThanOrEqual(-4);
  });

  it('returns no skid for a body already slower than the stop speed', () => {
    expect(planSkid(0, 0, 0, 0, 0.2, 0.1, 0.6, flat, TURRET_PHYSICS)).toBeNull();
    expect(planSkid(0, 0, 0, 0, 0, 0, 0.6, flat, TURRET_PHYSICS)).toBeNull();
  });

  it('bounds a skid by its own tick budget, whatever the speed', () => {
    const skid = planSkid(0, 0, 0, 0, 5000, 0, 0.6, flat, TURRET_PHYSICS);
    if (!skid) throw new Error('no skid');
    expect(skid.end - skid.start).toBe(TURRET_PHYSICS.maxSkidTicks);
    expect(Number.isFinite(positionAt(skid, skid.end, flat).x)).toBe(true);
  });
});

describe('sloped terrain', () => {
  it('never reads below the ground at any sampled fractional tick, and ends each flight on the surface', () => {
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0.6, 0.8],
      [-0.28, -0.96],
    ]) {
      for (const size of SIZES) {
        const { seg, radius } = coreThrow(size, sloped, dx, dz);
        const { segs } = chain(seg, radius, sloped);
        for (const s of segs) {
          for (let t = s.start; t <= s.end; t += 0.137) {
            const p = positionAt(s, t, sloped);
            expect([p.x, p.y, p.z].every(Number.isFinite)).toBe(true);
            expect(p.y).toBeGreaterThanOrEqual(sloped.ground(p.x, p.z) - 1e-9);
          }
          if (s.kind === 'fly' && s.contact === 'ground') {
            const end = rawFly(s, s.end);
            expect(Math.abs(end.y - sloped.ground(end.x, end.z))).toBeLessThan(0.05);
          }
        }
      }
    }
  });

  it('reflects off a thin raised step instead of tunneling through or climbing it', () => {
    // Placed between the samples a two-per-tick search would take at this speed.
    const STEP = 10.45;
    const stepped: ThrowProbe = {
      ground: (x) => (x >= STEP && x < STEP + 0.5 ? 3 : 0),
      water: () => null,
    };
    const first = planFlight(0, 0, 0, 0, { x: 32, y: 8, z: 0 }, 0.6, stepped, TURRET_PHYSICS);
    expect(first.contact).toBe('wall');
    expect(first.nx).toBeCloseTo(-1, 9);
    const { segs } = chain(first, 0.6, stepped);
    for (const s of segs) {
      if (s.kind !== 'fly') continue;
      const ticks: number[] = [s.end];
      for (let t = s.start; t < s.end; t += 0.02) ticks.push(t);
      for (const t of ticks) {
        const p = rawFly(s, t);
        expect(p.y, `raw y at tick ${t}`).toBeGreaterThanOrEqual(stepped.ground(p.x, p.z) - 1e-3);
      }
    }
    expect(restingPoint(segs, stepped).x).toBeLessThan(STEP);
  });
});

describe('colliders', () => {
  const WALL_X = 10;
  const walled: ThrowProbe = {
    ground: () => 0,
    water: () => null,
    sweep: (_fx, _fz, tx, tz, r) =>
      tx > WALL_X - r ? { x: WALL_X - r, z: tz, blocked: true } : free(tx, tz),
  };

  it('reflects a flight off a collider, keeping 0.4 of the horizontal speed', () => {
    const { seg, v } = coreThrow('small', walled, 0.8, 0.6);
    expect(seg.contact).toBe('wall');
    expect(seg.nx).toBeCloseTo(-1, 9);
    expect(positionAt(seg, seg.end, walled).x).toBeCloseTo(WALL_X - 0.6, 6);
    const out = resolveFlightEnd(seg, 0.6, walled, TURRET_PHYSICS);
    expect(out.kind).toBe('wall');
    if (out.kind !== 'wall') return;
    expect(out.seg.vx).toBeCloseTo(-v.x * 0.4, 9);
    expect(out.seg.vz).toBeCloseTo(v.z * 0.4, 9);
    expect(out.seg.vy).toBeCloseTo(velocityAt(seg, seg.end).y, 9);
    const { segs } = chain(out.seg, 0.6, walled);
    for (const s of [seg, ...segs]) {
      for (let t = s.start; t <= s.end; t += 0.1) {
        expect(positionAt(s, t, walled).x).toBeLessThanOrEqual(WALL_X - 0.6 + 1e-6);
      }
    }
  });

  it('reverses off a resolver that stops at the last good point, and never re-enters', () => {
    const FENCE = 8;
    const fenced: ThrowProbe = {
      ground: () => 0,
      water: () => null,
      sweep: (fx, fz, tx, tz) => (tx > FENCE ? { x: fx, z: fz, blocked: true } : free(tx, tz)),
    };
    const { seg, v } = coreThrow('small', fenced, 0.8, 0.6);
    expect(seg.contact).toBe('wall');
    const out = resolveFlightEnd(seg, 0.6, fenced, TURRET_PHYSICS);
    if (out.kind !== 'wall') throw new Error(out.kind);
    expect(out.seg.vx).toBeCloseTo(-v.x * 0.4, 9);
    expect(out.seg.vz).toBeCloseTo(-v.z * 0.4, 9);
    const { segs } = chain(out.seg, 0.6, fenced);
    for (const s of [seg, ...segs]) {
      for (let t = s.start; t <= s.end; t += 0.05) {
        expect(positionAt(s, t, fenced).x).toBeLessThanOrEqual(FENCE);
      }
    }
  });

  it('hands the feet height to the sweep: a high flight clears a knee-high collider, a low one hits it', () => {
    const KNEE_X = 5;
    const knee: ThrowProbe = {
      ground: () => 0,
      water: () => null,
      sweep: (fx, _fz, tx, tz, r, fromY, toY) => {
        const edge = KNEE_X - r;
        if (!(fx < edge && tx >= edge)) return free(tx, tz);
        const feet = fromY + ((edge - fx) / (tx - fx)) * (toY - fromY);
        return feet < 1 ? { x: edge, z: tz, blocked: true } : free(tx, tz);
      },
    };
    expect(coreThrow('small', knee).seg.contact).toBe('ground');
    const low = planFlight(0, 0, 0, 0, { x: 20, y: 5, z: 0 }, 0.6, knee, TURRET_PHYSICS);
    expect(low.contact).toBe('wall');
    expect(positionAt(low, low.end, knee).x).toBeCloseTo(KNEE_X - 0.6, 6);
  });

  it('stops a skid against a collider', () => {
    const skid = planSkid(0, 8.5, 0, 0, 12, 0, 0.6, walled, TURRET_PHYSICS);
    expect(skid?.contact).toBe('wall');
    if (!skid) return;
    expect(positionAt(skid, skid.end, walled).x).toBeCloseTo(WALL_X - 0.6, 6);
  });
});

describe('a cylinder body (the turret)', () => {
  const at = (fx: number, tx: number, fromY: number, toY: number) =>
    sweepCylinder(0, 0, 2.8, 3, fx, 0.5, tx, 0.5, fromY, toY);

  it('blocks a move entering it below its top and slides the target out radially', () => {
    const hit = at(5, 2, 1, 1);
    expect(hit.blocked).toBe(true);
    expect(Math.hypot(hit.x, hit.z)).toBeCloseTo(2.8, 9);
    expect(hit.z / hit.x).toBeCloseTo(0.5 / 2, 9);
  });

  it('lets a move pass over its top, out from inside, or beside it', () => {
    expect(at(5, 2, 3.5, 3.2).blocked).toBe(false);
    expect(at(1, 4, 0, 0).blocked).toBe(false);
    expect(sweepCylinder(0, 0, 2.8, 3, 5, 4, 2, 4, 0, 0).blocked).toBe(false);
  });

  it('interpolates the feet height at the point of entry', () => {
    expect(at(6, 0, 5.5, 1).blocked).toBe(false);
    expect(at(6, 0, 3.5, 1).blocked).toBe(true);
  });
});

describe('water and the void', () => {
  const lake = (depth: number): ThrowProbe => ({
    ground: (x) => (x > 12 ? -depth : 0),
    water: (x) => (x > 12 ? 0 : null),
  });

  it('ends a flight in deep water as a splash on the water surface', () => {
    const { seg } = coreThrow('small', lake(2));
    expect(seg.contact).toBe('water');
    const out = resolveFlightEnd(seg, 0.6, lake(2), TURRET_PHYSICS);
    expect(out).toMatchObject({ kind: 'splash', y: 0 });
  });

  it('lands normally in shallow water', () => {
    const { seg } = coreThrow('small', lake(0.5));
    expect(seg.contact).toBe('ground');
    expect(resolveFlightEnd(seg, 0.6, lake(0.5), TURRET_PHYSICS).kind).toBe('bounce');
  });

  it('ends a skid that slides into deep water', () => {
    const skid = planSkid(0, 11, 0, 0, 8, 0, 0.6, lake(2), TURRET_PHYSICS);
    expect(skid?.contact).toBe('water');
  });

  it('loses a flight that finds no contact within the bound, instead of bouncing it', () => {
    expect(TURRET_PHYSICS.maxFlightTicks).toBe(200);
    const abyss: ThrowProbe = { ground: () => -1e9, water: () => null };
    const v = launchVelocity(
      1,
      1,
      1,
      0,
      TURRET_WEAPON.push,
      TURRET_WEAPON.pop,
      TURRET_WEAPON.massExponent,
    );
    const seg = planFlight(0, 0, 0, 0, v, 0.6, abyss, TURRET_PHYSICS);
    expect(seg.end - seg.start).toBe(200);
    expect(seg.contact).toBe('void');
    expect(resolveFlightEnd(seg, 0.6, abyss, TURRET_PHYSICS).kind).toBe('void');
  });
});

describe('dead-center hits', () => {
  it('throws outward from the turret center when the blast lands on the body', () => {
    const d = throwDirection(10, 5, 10, 5.01, 0, 0, TURRET_WEAPON.deadCenter);
    expect(d.x).toBeCloseTo(10 / Math.hypot(10, 5.01), 12);
    expect(d.z).toBeCloseTo(5.01 / Math.hypot(10, 5.01), 12);
  });

  it('stays finite when the body sits on both the blast and the center', () => {
    const d = throwDirection(0, 0, 0, 0, 0, 0, TURRET_WEAPON.deadCenter);
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(1, 12);
    const v = launchVelocity(
      1,
      1,
      d.x,
      d.z,
      TURRET_WEAPON.push,
      TURRET_WEAPON.pop,
      TURRET_WEAPON.massExponent,
    );
    const seg = planFlight(0, 0, 0, 0, v, 0.6, flat, TURRET_PHYSICS);
    const p = positionAt(seg, 3.3, flat);
    expect([p.x, p.y, p.z, seg.end].every(Number.isFinite)).toBe(true);
  });

  it('points away from the blast otherwise', () => {
    const d = throwDirection(0, 0, 3, 4, 50, 50, TURRET_WEAPON.deadCenter);
    expect(d).toEqual({ x: 0.6, z: 0.8 });
  });
});
