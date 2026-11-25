import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GRACE_CAPACITY,
  GRACE_DURATION,
  GRACE_FLIGHT_LIMIT,
  GRACE_MOTES,
  GRACE_RETURN,
  GRACE_SCATTER,
  GRACE_SHAPE,
  GRACE_SPEED,
  GRACE_STAGGER,
  GRACE_STAMP,
  GRACE_TRAIL_SEGMENTS,
  GraceHammer,
} from '../src/render/ability_vfx/grace_hammer';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import { setPaladinVfxDetailForTest } from '../src/render/ability_vfx/paladin_vfx_detail';
import type { PaladinVfxDetail } from '../src/render/ability_vfx/paladin_vfx_detail_core';
import { AbilityVfxBudget } from '../src/render/ability_vfx_core';
import { PROJECTILE_SPEED } from '../src/sim/projectile_travel';

function fixture() {
  const scene = new THREE.Scene();
  // The Paladin (1) at the origin, the enemy (2) 12 yards ahead.
  const where = new Map<number, [number, number]>([
    [1, [0, 0]],
    [2, [0, 12]],
  ]);
  const anchor = vi.fn((id: number, height: number, out?: THREE.Vector3) => {
    const at = where.get(id);
    return at && out ? out.set(at[0], height * 2, at[1]) : null;
  });
  const effect = new GraceHammer(scene, anchor);
  const program = { isReady: () => true, getUniforms: vi.fn(), getAttributes: vi.fn() };
  const gl = {
    properties: { get: () => ({ programs: new Map([['canvas', program]]) }) },
    compile: vi.fn(async () => {}),
    draw: vi.fn(),
  };
  const shapes = () => {
    const g = effect.mesh.geometry;
    const shape = g.getAttribute('aShape');
    const seen = new Map<number, number>();
    for (let i = 0; i < g.drawRange.count; i += 6)
      seen.set(shape.getX(i), (seen.get(shape.getX(i)) ?? 0) + 1);
    return seen;
  };
  return {
    effect,
    scene,
    where,
    shapes,
    prepare: async () => {
      for (const u of effect.preparation.units(gl)) await u.run();
    },
  };
}

function step(effect: GraceHammer, seconds: number, reduced = false): void {
  for (let t = 0; t < seconds - 1e-6; t += 0.05) effect.update(0.05, reduced);
}

// Node runs at the Medium preset: pin the authored composition.
beforeEach(() => setPaladinVfxDetailForTest('full'));
afterEach(() => setPaladinVfxDetailForTest(null));

describe('Hammer of Grace', () => {
  it('flies at the projectile speed, never predicting a hit, and retires on arrival', async () => {
    const f = fixture();
    expect(GRACE_SPEED).toBe(PROJECTILE_SPEED);
    expect(f.effect.throw(1, 2)).toBe(false);
    await f.prepare();
    expect(f.effect.throw(1, 1)).toBe(false);
    expect(f.effect.throw(1, 2)).toBe(true);
    f.effect.update(0.05);
    // Hammer, release flare and ring, trail; no whirl, it never spins.
    expect(f.shapes().get(GRACE_SHAPE.hammer)).toBe(1);
    expect(f.shapes().get(GRACE_SHAPE.flare)).toBe(1);
    expect(f.shapes().get(GRACE_SHAPE.ring)).toBe(1);
    expect(f.shapes().get(GRACE_SHAPE.beam)).toBe(1);
    // A twin helix of gold and sky winds round the flight.
    step(f.effect, 0.2);
    expect(f.shapes().get(GRACE_SHAPE.strand)).toBe(2 * GRACE_TRAIL_SEGMENTS);
    expect(f.shapes().get(GRACE_SHAPE.hammer)).toBe(1);
    // Reduced motion: no helix.
    f.effect.update(0.01, true);
    expect(f.shapes().get(GRACE_SHAPE.strand)).toBeUndefined();
    step(f.effect, 12 / GRACE_SPEED);
    expect(f.effect.mesh.visible).toBe(false);
    f.effect.dispose();
    expect(f.scene.children).toHaveLength(0);
  });

  it('stamps into the enemy, shatters into grace and brings it home in a helix', async () => {
    const f = fixture();
    await f.prepare();
    f.effect.throw(1, 2);
    step(f.effect, 0.5);
    expect(f.effect.contact(1, 2, 'damage')).toBe(true);
    f.effect.update(0.05);
    // The blow: flare, starburst, the ring, and the hammer stamping in.
    expect(f.shapes().get(GRACE_SHAPE.hammer)).toBe(1);
    expect(f.shapes().get(GRACE_SHAPE.rays)).toBe(1);
    expect(f.shapes().get(GRACE_SHAPE.ring)).toBe(1);
    // Shattered: the hammer is gone and its shards hang round the blow.
    step(f.effect, GRACE_STAMP + 0.05);
    expect(f.shapes().get(GRACE_SHAPE.hammer)).toBeUndefined();
    const hanging =
      (f.shapes().get(GRACE_SHAPE.plus) ?? 0) + (f.shapes().get(GRACE_SHAPE.spark) ?? 0);
    expect(hanging).toBe(GRACE_MOTES);
    // On their way home, gold pluses and sky sparks, all between the enemy
    // and the Paladin.
    step(f.effect, GRACE_SCATTER + GRACE_STAGGER * GRACE_MOTES - (GRACE_STAMP + 0.1));
    const g = f.effect.mesh.geometry;
    const position = g.getAttribute('position');
    const shape = g.getAttribute('aShape');
    let pluses = 0,
      sparks = 0;
    for (let i = 0; i < g.drawRange.count; i += 6) {
      const kind = shape.getX(i);
      if (kind === GRACE_SHAPE.plus) pluses++;
      else if (kind === GRACE_SHAPE.spark) sparks++;
      else continue;
      expect(position.getZ(i)).toBeGreaterThan(-2);
      expect(position.getZ(i)).toBeLessThan(14);
    }
    expect(pluses).toBe(GRACE_MOTES / 2);
    expect(sparks).toBe(GRACE_MOTES / 2);
    // Home: the grace spirals up round the Paladin.
    step(f.effect, GRACE_RETURN * 0.9);
    expect(f.shapes().get(GRACE_SHAPE.strand) ?? 0).toBeGreaterThan(4);
    for (let i = 0; i < g.drawRange.count; i += 6)
      if (shape.getX(i) === GRACE_SHAPE.strand) {
        expect(Math.hypot(position.getX(i), position.getZ(i))).toBeLessThan(1.2);
      }
    step(f.effect, GRACE_DURATION);
    expect(f.effect.mesh.visible).toBe(false);
    f.effect.dispose();
  });

  it('shatters an absorbed blow into fewer shards that never go home', async () => {
    const f = fixture();
    await f.prepare();
    expect(f.effect.contact(1, 2, 'absorb')).toBe(true);
    step(f.effect, GRACE_STAMP + 0.1);
    const shards =
      (f.shapes().get(GRACE_SHAPE.plus) ?? 0) + (f.shapes().get(GRACE_SHAPE.spark) ?? 0);
    expect(shards).toBe(GRACE_MOTES / 2);
    // No self-heal from an absorbed blow: no shards fly home, no helix blooms.
    step(f.effect, GRACE_SCATTER + GRACE_RETURN);
    expect(f.shapes().get(GRACE_SHAPE.plus) ?? 0).toBe(0);
    expect(f.shapes().get(GRACE_SHAPE.spark) ?? 0).toBe(0);
    expect(f.shapes().get(GRACE_SHAPE.strand) ?? 0).toBe(0);
    f.effect.dispose();
  });

  it('drops avoided and stale throws, and bounds its pool', async () => {
    const f = fixture();
    await f.prepare();
    f.effect.throw(1, 2);
    expect(f.effect.contact(1, 2, 'none')).toBe(false);
    f.effect.update(0.05);
    expect(f.effect.mesh.visible).toBe(false);
    f.effect.throw(1, 2);
    f.effect.cancelEntity(2);
    f.effect.update(0.05);
    expect(f.effect.mesh.visible).toBe(false);
    f.where.set(2, [0, 200]);
    f.effect.throw(1, 2);
    step(f.effect, GRACE_FLIGHT_LIMIT + 0.1);
    expect(f.effect.mesh.visible).toBe(false);
    f.where.set(2, [0, 12]);
    for (let i = 0; i < GRACE_CAPACITY; i++) expect(f.effect.throw(1, 2)).toBe(true);
    expect(f.effect.throw(1, 2)).toBe(false);
    f.effect.dispose();
  });

  it('claims the throw and its damage so no generic bolt or impact plays', () => {
    const fx = { graceHammerThrow: vi.fn(), graceHammerContact: vi.fn() };
    const receiveHit = vi.fn(),
      releaseGesture = vi.fn();
    const p = Object.assign(Object.create(AbilityVfx.prototype), {
      // The painter reads the cast budget for every Paladin cue.
      budget: new AbilityVfxBudget(),
      castChargeAt: new Map(),
      now: () => 0,
      deps: { fx, receiveHit },
      releaseGesture,
    }) as AbilityVfx;
    const base = { sourceId: 1, targetId: 2, ability: 'hammer_of_grace', school: 'holy' };
    expect(p.handleSpellfx({ ...base, fx: 'projectile' })).toBe(true);
    expect(fx.graceHammerThrow).toHaveBeenCalledExactlyOnceWith(1, 2);
    expect(releaseGesture).toHaveBeenCalledOnce();
    const hit = { ...base, ability: 'Hammer of Grace', amount: 60, kind: 'hit', crit: false };
    expect(p.onDamage({ ...hit, abilityId: 'hammer_of_grace' })).toBe(true);
    p.onDamage({ ...hit, abilityId: 'hammer_of_grace', amount: 0, absorbed: 60 });
    expect(fx.graceHammerContact.mock.calls).toEqual([
      [1, 2, 'damage'],
      [1, 2, 'absorb'],
    ]);
    expect(receiveHit).toHaveBeenCalledOnce();
  });
});

describe('Hammer of Grace detail', () => {
  /** Quads per shape through one throw and hit at `detail`: in flight, at the
   * blow, the shards on their way home, and the bloom round the Paladin. */
  const cast = async (detail: PaladinVfxDetail) => {
    const f = fixture();
    await f.prepare();
    setPaladinVfxDetailForTest(detail);
    f.effect.throw(1, 2);
    // A later detail change never reshapes the running hammer.
    setPaladinVfxDetailForTest('full');
    f.effect.update(0.05);
    const release = f.shapes();
    step(f.effect, 0.25);
    const flight = f.shapes();
    f.effect.contact(1, 2, 'damage');
    f.effect.update(0.05);
    const blow = f.shapes();
    step(f.effect, GRACE_SCATTER + GRACE_STAGGER * GRACE_MOTES - 0.05);
    const homing = f.shapes();
    step(f.effect, GRACE_RETURN * 0.9);
    const bloom = f.shapes();
    let tail = 0;
    while (f.effect.mesh.visible && tail < 3) {
      f.effect.update(0.02);
      tail += 0.02;
    }
    f.effect.dispose();
    const total = (m: Map<number, number>) => [...m.values()].reduce((a, b) => a + b, 0);
    return {
      release,
      flight,
      blow,
      homing,
      bloom,
      tail,
      quads: total(release) + total(flight) + total(homing),
    };
  };

  it('throws the same hammer and brings the grace home lighter at light and minimal', async () => {
    const full = await cast('full');
    const light = await cast('light');
    const minimal = await cast('minimal');
    const shards = (m: Map<number, number>) =>
      (m.get(GRACE_SHAPE.plus) ?? 0) + (m.get(GRACE_SHAPE.spark) ?? 0);
    // Core on every tier: the hammer in flight and stamping in, the ring of
    // the blow and the shards going home.
    for (const d of [full, light, minimal]) {
      expect(d.flight.get(GRACE_SHAPE.hammer)).toBe(1);
      expect(d.blow.get(GRACE_SHAPE.hammer)).toBe(1);
      expect(d.blow.get(GRACE_SHAPE.ring)).toBeGreaterThanOrEqual(1);
      expect(shards(d.homing)).toBeGreaterThan(0);
    }
    // Full: the release flare, the trail's twin helix, the starburst, the
    // ghosts behind the shards and the helix round the Paladin.
    expect(full.release.get(GRACE_SHAPE.flare)).toBe(1);
    expect(full.flight.get(GRACE_SHAPE.strand)).toBe(2 * GRACE_TRAIL_SEGMENTS);
    expect(full.blow.get(GRACE_SHAPE.rays)).toBe(1);
    expect(full.homing.get(GRACE_SHAPE.mote) ?? 0).toBeGreaterThan(0);
    expect(full.bloom.get(GRACE_SHAPE.strand) ?? 0).toBeGreaterThan(4);
    // Light keeps the trail, ghosts and helix, drops the flares and starburst,
    // and thins the shards.
    expect(light.release.get(GRACE_SHAPE.flare)).toBeUndefined();
    expect(light.release.get(GRACE_SHAPE.ring)).toBe(1);
    expect(light.flight.get(GRACE_SHAPE.strand)).toBe(2 * GRACE_TRAIL_SEGMENTS);
    expect(light.blow.get(GRACE_SHAPE.rays)).toBeUndefined();
    expect(light.homing.get(GRACE_SHAPE.mote) ?? 0).toBeGreaterThan(0);
    expect(light.bloom.get(GRACE_SHAPE.strand) ?? 0).toBeGreaterThan(4);
    expect(shards(light.homing)).toBeLessThan(shards(full.homing));
    // Minimal: only the core, no trail, ghosts or helix.
    expect(minimal.flight.get(GRACE_SHAPE.strand)).toBeUndefined();
    expect(minimal.flight.get(GRACE_SHAPE.beam)).toBeUndefined();
    expect(minimal.release.get(GRACE_SHAPE.ring)).toBeUndefined();
    expect(minimal.homing.get(GRACE_SHAPE.mote)).toBeUndefined();
    expect(minimal.bloom.get(GRACE_SHAPE.strand)).toBeUndefined();
    expect(shards(minimal.homing)).toBeLessThan(shards(light.homing));
    // Strictly less each step down, and the bloom fades sooner.
    expect(light.quads).toBeLessThan(full.quads);
    expect(minimal.quads).toBeLessThan(light.quads);
    expect(light.tail).toBeLessThan(full.tail);
    expect(minimal.tail).toBeLessThan(light.tail);
  });
});
