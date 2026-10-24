// The Lantern Hall Destrier's embers (src/render/mount_embers_core.ts + mount_embers.ts): the
// rates per gait, the hoof-strike weight, and the Three-side emitter finding its bones and
// feeding the particle sink from the right places.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { type MountEmberSink, updateMountEmbers } from '../src/render/mount_embers';
import { hoofStrikeWeight, mountEmberRates } from '../src/render/mount_embers_core';

describe('the ember rates', () => {
  it('sparks the hooves only at a gallop, and lets the lanterns breathe at every gait', () => {
    expect(mountEmberRates(true, true)).toEqual({ hoof: 44, lantern: 26 });
    expect(mountEmberRates(true, false)).toEqual({ hoof: 0, lantern: 8 });
    expect(mountEmberRates(false, false)).toEqual({ hoof: 0, lantern: 3 });
    // standing still with a stale running flag is still standing
    expect(mountEmberRates(false, true).hoof).toBe(0);
  });

  it('weighs a hoof by its height over the ground in model units', () => {
    const scale = 2.5;
    expect(hoofStrikeWeight(0, scale)).toBe(1);
    expect(hoofStrikeWeight(0.1 * scale, scale)).toBe(1);
    expect(hoofStrikeWeight(0.175 * scale, scale)).toBeCloseTo(0.5, 6);
    expect(hoofStrikeWeight(0.25 * scale, scale)).toBe(0);
    expect(hoofStrikeWeight(3, scale)).toBe(0);
    // a degenerate scale never divides by zero
    expect(hoofStrikeWeight(0.05, 0)).toBe(1);
  });
});

describe('the emitter', () => {
  function horse() {
    const root = new THREE.Group();
    const hoofDown = new THREE.Object3D();
    hoofDown.name = 'toes_01l_011';
    hoofDown.position.set(0.5, 0.02, 0);
    const hoofUp = new THREE.Object3D();
    hoofUp.name = 'toes_01r_018';
    hoofUp.position.set(-0.5, 1.5, 0);
    const lantern = new THREE.Object3D();
    lantern.name = 'lantern_l';
    lantern.position.set(0.8, 3, 0);
    root.add(hoofDown, hoofUp, lantern);
    root.updateMatrixWorld(true);
    return root;
  }
  const spec = {
    hooves: ['toes_01l_011', 'toes_01r_018', 'missing_bone'],
    lanterns: [{ bone: 'lantern_l', offset: [0, -0.5, 0] as const }],
  };
  function sink() {
    const sparks: { at: number[]; rate: number }[] = [];
    const cinders: { at: number[]; rate: number; moving: boolean }[] = [];
    const s: MountEmberSink = {
      mountHoofSparks: (at, rate) => sparks.push({ at: at.toArray(), rate }),
      mountLanternCinders: (at, rate, _dt, moving) =>
        cinders.push({ at: at.toArray(), rate, moving }),
    };
    return { s, sparks, cinders };
  }

  it('strikes sparks off the planted hoof only, and sheds cinders at the lantern glass', () => {
    const root = horse();
    const { s, sparks, cinders } = sink();
    updateMountEmbers(root, spec, s, 1 / 60, true, true, 0);
    // the lifted hoof and the missing bone shed nothing; the planted one at full rate
    expect(sparks).toEqual([{ at: [0.5, 0.02, 0], rate: 44 }]);
    expect(cinders).toEqual([{ at: [0.8, 2.5, 0], rate: 26, moving: true }]);
  });

  it('standing, the hooves are quiet and the lanterns breathe', () => {
    const root = horse();
    const { s, sparks, cinders } = sink();
    updateMountEmbers(root, spec, s, 1 / 60, false, false, 0);
    expect(sparks).toEqual([]);
    expect(cinders.map((c) => [c.rate, c.moving])).toEqual([[3, false]]);
  });
});
