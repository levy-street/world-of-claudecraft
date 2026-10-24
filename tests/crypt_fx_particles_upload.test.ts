// The shared GPU particle pool (src/render/hollow_crypt/crypt_fx_particles.ts)
// uploads only the slots written since its last upload: a busy effect (the
// Drowned Temple finale births motes every frame for twenty seconds) sends a
// few particles a frame, never its whole buffer.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ParticlePool } from '../src/render/hollow_crypt/crypt_fx_particles';

const spec = {
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 1,
  vz: 0,
  life: 2,
  size0: 1,
  size1: 0.5,
  r: 1,
  g: 1,
  b: 1,
  a: 1,
};

function attrs(pool: ParticlePool): THREE.InstancedBufferAttribute[] {
  const geo = pool.mesh.geometry as THREE.InstancedBufferGeometry;
  return ['aPos0', 'aVel', 'aAcc', 'aLife', 'aShape', 'aColor'].map(
    (n) => geo.getAttribute(n) as THREE.InstancedBufferAttribute,
  );
}

describe('ParticlePool uploads', () => {
  it('uploads only the run of slots born since the last frame', () => {
    const pool = new ParticlePool(100, new THREE.ShaderMaterial(), 0);
    for (let k = 0; k < 3; k++) pool.emit(0, spec);
    pool.update(0);
    for (const a of attrs(pool)) {
      expect(a.updateRanges).toEqual([{ start: 0, count: 3 * a.itemSize }]);
    }
    // The next frame's births start where the last ones ended.
    for (let k = 0; k < 2; k++) pool.emit(0.1, spec);
    pool.update(0.1);
    for (const a of attrs(pool)) {
      expect(a.updateRanges).toEqual([{ start: 3 * a.itemSize, count: 2 * a.itemSize }]);
    }
    // A frame with no births uploads nothing new.
    const versions = attrs(pool).map((a) => a.version);
    pool.update(0.2);
    expect(attrs(pool).map((a) => a.version)).toEqual(versions);
  });

  it('splits a run that wraps round the ring, and sends everything when it laps', () => {
    const pool = new ParticlePool(10, new THREE.ShaderMaterial(), 0);
    for (let k = 0; k < 8; k++) pool.emit(0, spec);
    pool.update(0);
    for (let k = 0; k < 4; k++) pool.emit(0.1, spec);
    pool.update(0.1);
    for (const a of attrs(pool)) {
      expect(a.updateRanges).toEqual([
        { start: 8 * a.itemSize, count: 2 * a.itemSize },
        { start: 0, count: 2 * a.itemSize },
      ]);
    }
    for (let k = 0; k < 25; k++) pool.emit(0.2, spec);
    pool.update(0.2);
    for (const a of attrs(pool)) expect(a.updateRanges).toEqual([]);
    expect(pool.mesh.visible).toBe(true);
  });
});
