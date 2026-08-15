import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Vfx } from '../../src/render/vfx';

type VfxProbe = {
  life: Float32Array;
  pos: Float32Array;
  vel: Float32Array;
  col: Float32Array;
  spriteAttr: Float32Array;
};

function activeParticles(vfx: VfxProbe): number {
  let active = 0;
  for (const remaining of vfx.life) if (remaining > 0) active++;
  return active;
}

function activeIndices(vfx: VfxProbe): number[] {
  const indices: number[] = [];
  for (let index = 0; index < vfx.life.length; index++) {
    if (vfx.life[index] > 0) indices.push(index);
  }
  return indices;
}

function maxHorizontalSpeed(vfx: VfxProbe): number {
  let max = 0;
  for (const index of activeIndices(vfx)) {
    max = Math.max(max, Math.hypot(vfx.vel[index * 3], vfx.vel[index * 3 + 2]));
  }
  return max;
}

function maxDistanceFrom(vfx: VfxProbe, x: number, z: number): number {
  let max = 0;
  for (const index of activeIndices(vfx)) {
    max = Math.max(max, Math.hypot(vfx.pos[index * 3] - x, vfx.pos[index * 3 + 2] - z));
  }
  return max;
}

describe('Paladin Ascension VFX', () => {
  it('emits visible particles for every empowered impact identity', () => {
    const scene = new THREE.Scene();
    const vfx = new Vfx(scene, (id, heightFrac) => new THREE.Vector3(id, heightFrac, id * 2));
    const probe = vfx as unknown as VfxProbe;

    for (const impact of ['offensive', 'area', 'defensive', 'healing'] as const) {
      vfx.clear();
      vfx.paladinAscensionImpact(1, 2, impact);
      expect(activeParticles(probe), impact).toBeGreaterThan(0);
    }
  });

  it('draws distinct golden weapon silhouettes for Dawnfall and Final Edict', () => {
    const scene = new THREE.Scene();
    const vfx = new Vfx(scene, (id, heightFrac) => new THREE.Vector3(id, heightFrac, id * 2));
    const probe = vfx as unknown as VfxProbe;

    vfx.paladinDawnfall(1, 6);
    vfx.update(0.34);
    const dawnfallParticles = activeParticles(probe);
    expect(dawnfallParticles).toBeGreaterThan(70);
    expect(activeIndices(probe).some((index) => probe.spriteAttr[index] === 13)).toBe(true);
    expect(activeIndices(probe).some((index) => probe.spriteAttr[index] === 12)).toBe(true);
    for (const index of activeIndices(probe)) {
      const offset = index * 3;
      expect(probe.col[offset]).toBeGreaterThanOrEqual(probe.col[offset + 1]);
      expect(probe.col[offset + 1]).toBeGreaterThan(probe.col[offset + 2]);
    }

    vfx.clear();
    vfx.paladinFinalEdict(1, 2);
    const edictParticles = activeParticles(probe);
    expect(edictParticles).toBeGreaterThan(20);
    expect(edictParticles).toBeLessThan(dawnfallParticles);
    expect(maxDistanceFrom(probe, 2, 4)).toBeLessThan(1);
  });

  it('expands Dawnfall to its supplied normal and Ascension radii', () => {
    const normal = new Vfx(
      new THREE.Scene(),
      (id, heightFrac) => new THREE.Vector3(id, heightFrac, id * 2),
    );
    const ascended = new Vfx(
      new THREE.Scene(),
      (id, heightFrac) => new THREE.Vector3(id, heightFrac, id * 2),
    );
    const normalProbe = normal as unknown as VfxProbe;
    const ascendedProbe = ascended as unknown as VfxProbe;

    normal.paladinDawnfall(1, 6);
    ascended.paladinDawnfall(1, 10);
    normal.update(0.34);
    ascended.update(0.34);
    expect(maxHorizontalSpeed(normalProbe)).toBeCloseTo((6 - 0.25) / 0.24, 4);
    expect(maxHorizontalSpeed(ascendedProbe)).toBeCloseTo((10 - 0.25) / 0.24, 4);

    normal.update(0.18);
    ascended.update(0.18);
    expect(maxDistanceFrom(normalProbe, 1, 2)).toBeGreaterThan(4);
    expect(maxDistanceFrom(ascendedProbe, 1, 2)).toBeGreaterThan(7);
  });

  it('maps both Solar Invocation modes into the shared low-cost particle pool', () => {
    const target = new THREE.Vector3(6, 0.55, 1);
    const scene = new THREE.Scene();
    const vfx = new Vfx(scene, (id, heightFrac) =>
      id === 1 ? new THREE.Vector3(0, heightFrac, 0) : target.clone().setY(heightFrac),
    );
    const probe = vfx as unknown as VfxProbe;

    vfx.paladinHolyShock(1, 2, 'heal');
    expect(activeParticles(probe)).toBeGreaterThan(5);
    vfx.update(0.12);
    expect(maxDistanceFrom(probe, 0, 0)).toBeGreaterThan(5);

    vfx.clear();
    vfx.paladinHolyShock(1, 2, 'damage');
    vfx.update(0.12);
    expect(activeIndices(probe).some((index) => probe.spriteAttr[index] === 13)).toBe(true);
    expect(activeIndices(probe).some((index) => probe.spriteAttr[index] === 5)).toBe(true);
  });
});
