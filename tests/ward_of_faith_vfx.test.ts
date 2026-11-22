import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import {
  PALADIN_SPEC_EMBLEMS,
  PALADIN_SPEC_SIGNATURES,
  paladinSpecEmblemIndex,
} from '../src/render/ability_vfx/paladin_spec_emblems';
import {
  PLATE_REACH,
  WARD_END,
  WARD_INTRO,
  WARD_PANELS,
  WARD_RADIUS,
  WardOfFaith,
  type WardParts,
} from '../src/render/ability_vfx/ward_of_faith';

function fixture(parts: WardParts = 'plates') {
  const scene = new THREE.Scene();
  const anchor = vi.fn((id: number, height: number, out?: THREE.Vector3) =>
    id === 1 && out ? out.set(0, height * 1.8, 0) : null,
  );
  const effect = new WardOfFaith(scene, anchor, () => 0, undefined, parts);
  const program = { isReady: () => true, getUniforms: vi.fn(), getAttributes: vi.fn() };
  const gl = {
    properties: { get: () => ({ programs: new Map([['canvas', program]]) }) },
    compile: vi.fn(async () => {}),
    draw: vi.fn(),
  };
  const count = (shape: number) => {
    const g = effect.mesh.geometry;
    const attr = g.getAttribute('aShape');
    let n = 0;
    for (let i = 0; i < g.drawRange.count; i += 6) if (attr.getX(i) === shape) n++;
    return n;
  };
  return {
    effect,
    scene,
    count,
    prepare: async () => {
      for (const u of effect.preparation.units(gl)) await u.run();
    },
  };
}

/** Steps the ward with the aura held at `value` of 100. */
function holdFor(effect: WardOfFaith, seconds: number, value: number, remaining = 8): void {
  for (let t = 0; t < seconds - 1e-6; t += 0.05) {
    effect.hold(1, value, remaining);
    effect.update(0.05);
  }
}

describe('Ward of Faith and Hallowed Wall shields', () => {
  it("Ward of Faith closes its dome over the Paladin, without Hallowed Wall's plates", async () => {
    const f = fixture('ward');
    await f.prepare();
    f.effect.raise(1);
    holdFor(f.effect, WARD_INTRO + 0.2, 100);
    expect(f.count(0)).toBe(0);
    expect(f.count(1)).toBe(1);
    expect(f.count(2)).toBe(1);
    expect(f.effect.mesh.name).toBe('ward-of-faith');
    f.effect.dispose();
    expect(f.scene.children).toHaveLength(0);
  });

  it("Hallowed Wall's plates spin out of the sigil and lock round the Paladin, no dome", async () => {
    const f = fixture();
    expect(f.effect.raise(1)).toBe(false);
    await f.prepare();
    expect(f.effect.raise(2)).toBe(false);
    expect(f.effect.raise(1)).toBe(true);
    holdFor(f.effect, 0.1, 100);
    // The first plates on their way out, one after another.
    expect(f.count(0)).toBeGreaterThan(0);
    expect(f.count(0)).toBeLessThan(WARD_PANELS);
    expect(f.count(2)).toBe(0);
    holdFor(f.effect, WARD_INTRO, 100);
    expect(f.count(0)).toBe(WARD_PANELS);
    expect(f.count(1)).toBe(0);
    // The plates stand in a ring round the Paladin.
    const g = f.effect.mesh.geometry;
    const pos = g.getAttribute('position');
    const shape = g.getAttribute('aShape');
    for (let i = 0; i < g.drawRange.count; i += 6) {
      if (shape.getX(i) !== 0) continue;
      let x = 0,
        z = 0;
      for (let k = 0; k < 6; k++) {
        x += pos.getX(i + k) / 6;
        z += pos.getZ(i + k) / 6;
      }
      expect(Math.hypot(x, z)).toBeCloseTo(WARD_RADIUS * PLATE_REACH, 1);
    }
    f.effect.dispose();
    expect(f.scene.children).toHaveLength(0);
  });

  it('sheds a plate for every sixth of the absorb spent, shards flying', async () => {
    const f = fixture();
    await f.prepare();
    f.effect.raise(1);
    holdFor(f.effect, WARD_INTRO + 0.2, 100);
    expect(f.effect.standing(1)).toBe(6);
    holdFor(f.effect, 0.1, 60);
    // 60% left: four plates stand, two shattered.
    expect(f.effect.standing(1)).toBe(4);
    expect(f.count(4)).toBeGreaterThan(0);
    expect(f.count(0)).toBe(4);
    holdFor(f.effect, 1, 60);
    expect(f.count(4)).toBe(0);
    // Recast over the worn ward: fresh plates.
    holdFor(f.effect, 0.1, 100);
    expect(f.effect.standing(1)).toBe(6);
    f.effect.dispose();
  });

  it('shatters when broken with time still left, and folds away when it runs out', async () => {
    const f = fixture();
    await f.prepare();
    f.effect.raise(1);
    holdFor(f.effect, WARD_INTRO + 0.2, 40, 5);
    f.effect.update(0.05);
    // Broken: the standing plates burst into shards.
    expect(f.effect.standing(1)).toBe(0);
    expect(f.count(4)).toBeGreaterThan(0);
    for (let t = 0; t < WARD_END + 0.1; t += 0.05) f.effect.update(0.05);
    expect(f.effect.mesh.visible).toBe(false);

    f.effect.raise(1);
    holdFor(f.effect, WARD_INTRO + 0.2, 100, 0.1);
    f.effect.update(0.05);
    // Run out: no shards, the plates rise and fade.
    expect(f.count(4)).toBe(0);
    expect(f.count(0)).toBe(WARD_PANELS);
    for (let t = 0; t < WARD_END + 0.1; t += 0.05) f.effect.update(0.05);
    expect(f.effect.mesh.visible).toBe(false);
    f.effect.dispose();
  });

  it('comes up without the fly-out when first seen mid-ward', async () => {
    const f = fixture();
    await f.prepare();
    holdFor(f.effect, 0.05, 100);
    expect(f.count(0)).toBe(WARD_PANELS);
    expect(f.effect.standing(1)).toBe(6);
    f.effect.dispose();
  });

  it("bears the caster's spec icon: their own spec, one learned from their casts, else Faithwarden", async () => {
    const f = fixture();
    await f.prepare();
    const emblem = () => {
      const g = f.effect.mesh.geometry;
      const shape = g.getAttribute('aShape');
      const param = g.getAttribute('aParam');
      const seen = new Set<number>();
      for (let i = 0; i < g.drawRange.count; i += 6)
        if (shape.getX(i) === 0) seen.add(param.getX(i));
      return [...seen];
    };
    f.effect.raise(1, 'retribution');
    holdFor(f.effect, WARD_INTRO, 100);
    expect(emblem()).toEqual([PALADIN_SPEC_EMBLEMS.indexOf('retribution')]);
    f.effect.clear();
    // Nothing known: Faithwarden, the shield spec.
    f.effect.raise(1);
    holdFor(f.effect, WARD_INTRO, 100);
    expect(emblem()).toEqual([PALADIN_SPEC_EMBLEMS.indexOf('protection')]);
    // Seen casting Mercy Lance: Sunmender, even on the ward already up.
    f.effect.learnSpec(1, PALADIN_SPEC_SIGNATURES.mercy_lance);
    holdFor(f.effect, 0.05, 100);
    expect(emblem()).toEqual([PALADIN_SPEC_EMBLEMS.indexOf('holy')]);
    expect(paladinSpecEmblemIndex('arms')).toBe(1);
    f.effect.dispose();
  });
});
