import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import {
  SOLAR_IGNITE_DURATION,
  SOLAR_PRINT_LIFE,
  SOLAR_STRIDE,
  SolarStep,
} from '../src/render/ability_vfx/solar_step';

function fixture() {
  const scene = new THREE.Scene();
  const at = new THREE.Vector3(0, 3, 0);
  const anchor = vi.fn((id: number, height: number, out?: THREE.Vector3) =>
    id < 0 || !out ? null : out.set(at.x, at.y + height * 2, at.z),
  );
  const effect = new SolarStep(scene, anchor, () => 3);
  const program = { isReady: () => true, getUniforms: vi.fn(), getAttributes: vi.fn() };
  const gl = {
    properties: { get: () => ({ programs: new Map([['canvas', program]]) }) },
    compile: vi.fn(async () => {}),
    draw: vi.fn(),
  };
  const counts = () => {
    const g = effect.mesh.geometry;
    const shape = g.getAttribute('aShape');
    const out = new Map<number, number>();
    for (let i = 0; i < g.drawRange.count; i += 6)
      out.set(shape.getX(i), (out.get(shape.getX(i)) ?? 0) + 1);
    return out;
  };
  return {
    effect,
    scene,
    at,
    counts,
    prepare: async () => {
      for (const u of effect.preparation.units(gl)) await u.run();
    },
  };
}

/** Runs the sprint forward along +z at `speed` yards per second. */
function run(f: ReturnType<typeof fixture>, seconds: number, speed: number, steadfast = false) {
  for (let t = 0; t < seconds - 1e-6; t += 0.05) {
    f.at.z += speed * 0.05;
    f.effect.sprint(1, steadfast);
    f.effect.update(0.05);
  }
}

describe('Solar Step sprint', () => {
  it('needs preparation, ignites a sun at the feet and burns out after the cast', async () => {
    const f = fixture();
    expect(f.effect.ignite(1)).toBe(false);
    await f.prepare();
    expect(f.effect.ignite(-1)).toBe(false);
    expect(f.effect.ignite(1)).toBe(true);
    f.effect.update(0.05);
    // The ignition sun on the ground and its flare.
    expect(f.counts().get(1)).toBe(1);
    for (let t = 0; t < SOLAR_IGNITE_DURATION + 0.5; t += 0.05) f.effect.update(0.05);
    expect(f.effect.mesh.visible).toBe(false);
    f.effect.dispose();
    expect(f.scene.children).toHaveLength(0);
  });

  it('presses a sun-print every stride, kicks up embers and streams a ribbon while running', async () => {
    const f = fixture();
    await f.prepare();
    run(f, 0.6, 17.5);
    const counts = f.counts();
    // About one print per stride travelled (after the presence ramps in).
    const prints = counts.get(0) ?? 0;
    expect(prints).toBeGreaterThan(Math.floor((17.5 * 0.5) / SOLAR_STRIDE) - 2);
    expect(prints).toBeLessThanOrEqual(Math.ceil((17.5 * 0.6) / SOLAR_STRIDE));
    expect(counts.get(3) ?? 0).toBeGreaterThan(3);
    expect(counts.get(5) ?? 0).toBeGreaterThan(5);
    const position = f.effect.mesh.geometry.getAttribute('position');
    for (let i = 0; i < f.effect.mesh.geometry.drawRange.count * 3; i++)
      expect(Number.isFinite(position.array[i])).toBe(true);
    // The sprint ends: prints cool and go, the runner fades.
    for (let t = 0; t < SOLAR_PRINT_LIFE + 0.6; t += 0.05) f.effect.update(0.05);
    expect(f.effect.mesh.visible).toBe(false);
    f.effect.dispose();
  });

  it('shows Steadfast Step as a ring at the feet, and never strides across a teleport', async () => {
    const f = fixture();
    await f.prepare();
    run(f, 0.3, 0, true);
    expect(f.counts().get(2)).toBe(1);
    expect(f.counts().get(0) ?? 0).toBe(0);
    f.at.z += 40;
    f.effect.sprint(1, true);
    f.effect.update(0.05);
    expect(f.counts().get(0) ?? 0).toBe(0);
    f.effect.dispose();
  });

  it('claims the cast so no generic buff plays, and ignites the sprint', () => {
    const fx = { solarStepIgnite: vi.fn() };
    const releaseGesture = vi.fn();
    const p = Object.assign(Object.create(AbilityVfx.prototype), {
      deps: { fx },
      releaseGesture,
    }) as AbilityVfx;
    const ev = { sourceId: 1, targetId: 1, school: 'holy', ability: 'solar_step' };
    expect(p.handleSpellfx({ ...ev, fx: 'selfCast' })).toBe(true);
    expect(p.handleSpellfx({ ...ev, fx: 'buffApply' })).toBe(true);
    expect(fx.solarStepIgnite).toHaveBeenCalledExactlyOnceWith(1);
    expect(releaseGesture).toHaveBeenCalledOnce();
  });
});
