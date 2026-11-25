import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HUSH_SHATTER_DURATION,
  HUSH_STRIKE_DURATION,
  Hushbrand,
} from '../src/render/ability_vfx/hushbrand';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import { setPaladinVfxDetailForTest } from '../src/render/ability_vfx/paladin_vfx_detail';
import { AbilityVfxBudget } from '../src/render/ability_vfx_core';

function fixture() {
  const scene = new THREE.Scene();
  // The Paladin (1) stands at the origin, the enemy (2) 2 yards ahead; feet at y 0.
  const where = new Map<number, [number, number]>([
    [1, [0, 0]],
    [2, [0, 2]],
  ]);
  const anchor = vi.fn((id: number, height: number, out?: THREE.Vector3) => {
    const at = where.get(id);
    return at && out ? out.set(at[0], height * 2, at[1]) : null;
  });
  const effect = new Hushbrand(scene, anchor);
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
    shapes,
    prepare: async () => {
      for (const u of effect.preparation.units(gl)) await u.run();
    },
  };
}

// The authored composition; the detail tiers have their own block below.
beforeEach(() => setPaladinVfxDetailForTest('full'));
afterEach(() => setPaladinVfxDetailForTest(null));

describe('Hushbrand', () => {
  it('stamps the brand on the side of the enemy facing the Paladin, then lets it go', async () => {
    const f = fixture();
    expect(f.effect.strike(1, 2)).toBe(false);
    await f.prepare();
    expect(f.effect.strike(1, 1)).toBe(false);
    expect(f.effect.strike(1, -1)).toBe(false);
    expect(f.effect.strike(1, 2)).toBe(true);
    f.effect.update(0.05);
    // Brand, shock ring and flare.
    expect(f.shapes()).toEqual(
      new Map([
        [0, 1],
        [1, 1],
        [2, 1],
      ]),
    );
    const g = f.effect.mesh.geometry;
    const position = g.getAttribute('position');
    let z = 0;
    for (let i = 0; i < 6; i++) z += position.getZ(i) / 6;
    // The brand sits between the enemy's centre (z 2) and the Paladin (z 0).
    expect(z).toBeLessThan(2);
    expect(z).toBeGreaterThan(1);
    for (let t = 0; t < HUSH_STRIKE_DURATION; t += 0.05) f.effect.update(0.05);
    expect(f.effect.mesh.visible).toBe(false);
    f.effect.dispose();
    expect(f.scene.children).toHaveLength(0);
  });

  it('shatters the spell, then holds the collar and chest brand while the lockout lasts', async () => {
    const f = fixture();
    await f.prepare();
    f.effect.hold(2, 1);
    f.effect.update(0.05);
    const opening = f.shapes();
    expect(opening.get(3) ?? 0).toBeGreaterThan(8);
    expect(opening.get(4)).toBe(1);
    expect(opening.get(5)).toBe(1);
    for (let t = 0; t < HUSH_SHATTER_DURATION; t += 0.05) {
      f.effect.hold(2, 0.8);
      f.effect.update(0.05);
    }
    expect(f.shapes()).toEqual(
      new Map([
        [4, 1],
        [5, 1],
      ]),
    );
    // The lockout ends: the brand fades away on its own.
    for (let i = 0; i < 10; i++) f.effect.update(0.05);
    expect(f.effect.mesh.visible).toBe(false);
    f.effect.dispose();
  });

  it('claims the cast so only the brand plays', () => {
    const fx = { hushbrandStrike: vi.fn() };
    const releaseGesture = vi.fn();
    const p = Object.assign(Object.create(AbilityVfx.prototype), {
      deps: { fx },
      releaseGesture,
      // The painter reads the cast budget for every Paladin cue.
      budget: new AbilityVfxBudget(),
      castChargeAt: new Map(),
      now: () => 0,
    }) as AbilityVfx;
    const ev = { sourceId: 1, targetId: 2, school: 'physical', ability: 'hushbrand' };
    expect(p.handleSpellfx({ ...ev, fx: 'selfCast' })).toBe(true);
    expect(fx.hushbrandStrike).toHaveBeenCalledExactlyOnceWith(1, 2);
    expect(releaseGesture).toHaveBeenCalledOnce();
  });
});

describe('Hushbrand detail tiers', () => {
  async function strikeAndHold(detail: 'full' | 'light' | 'minimal') {
    setPaladinVfxDetailForTest(detail);
    const f = fixture();
    await f.prepare();
    f.effect.strike(1, 2);
    f.effect.hold(2, 1);
    f.effect.update(0.05);
    const shapes = f.shapes();
    // A later tier change never reshapes the running effect.
    setPaladinVfxDetailForTest('full');
    let strikeFrames = 1;
    while (f.effect.mesh.geometry.drawRange.count > 0 && strikeFrames < 40) {
      f.effect.hold(2, 1);
      f.effect.update(0.05);
      const seen = f.shapes();
      if (!seen.has(0)) break;
      strikeFrames++;
    }
    f.effect.dispose();
    return { shapes, strikeFrames };
  }

  it('keeps the brand and sigil on every tier and thins everything around them', async () => {
    const full = await strikeAndHold('full');
    const light = await strikeAndHold('light');
    const minimal = await strikeAndHold('minimal');
    const total = (m: Map<number, number>) => [...m.values()].reduce((a, b) => a + b, 0);
    // Core: the brand stamped on the enemy (0) and the hush sigil (5) draw on every tier.
    for (const tier of [full, light, minimal]) {
      expect(tier.shapes.get(0)).toBe(1);
      expect(tier.shapes.get(5)).toBe(1);
    }
    // Light keeps the shock ring and the collar but drops the flares and half the shards.
    expect(light.shapes.get(1)).toBe(1);
    expect(light.shapes.get(4)).toBe(1);
    expect(full.shapes.get(2)).toBe(2);
    expect(light.shapes.has(2)).toBe(false);
    expect(light.shapes.get(3) ?? 0).toBeLessThan(full.shapes.get(3) ?? 0);
    // Minimal keeps only the core and a few shards.
    expect(minimal.shapes.has(1)).toBe(false);
    expect(minimal.shapes.has(4)).toBe(false);
    expect(minimal.shapes.has(2)).toBe(false);
    expect(minimal.shapes.get(3) ?? 0).toBeGreaterThan(0);
    expect(minimal.shapes.get(3) ?? 0).toBeLessThan(light.shapes.get(3) ?? 0);
    expect(total(light.shapes)).toBeLessThan(total(full.shapes));
    expect(total(minimal.shapes)).toBeLessThan(total(light.shapes));
    // The brand's fade tail is shorter on the lighter tiers.
    expect(light.strikeFrames).toBeLessThan(full.strikeFrames);
    expect(minimal.strikeFrames).toBeLessThan(light.strikeFrames);
  });
});
