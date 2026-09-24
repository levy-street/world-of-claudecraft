import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import { AbilityVfxRibbons, type StyledTrailOpts } from '../src/render/ability_vfx/ribbons';

const options: StyledTrailOpts = {
  speed: 4,
  style: 'comet',
  headSize: 0.4,
  coils: false,
  jagTrail: false,
  forkEvery: 0,
  tracer: false,
  delay: 0,
  aimX: 0,
  aimY: 0,
  aimZ: 0,
  groundY: null,
};
function fixture() {
  const texture = new THREE.Texture();
  const pool = new AbilityVfxRibbons(
    new THREE.Scene(),
    (id, frac, out) => (out ?? new THREE.Vector3()).set(id === 1 ? 0 : 20, frac * 2, 0),
    { ribbon: texture, noise: texture } as AbilityVfxTextures,
  );
  const slots = (
    pool as unknown as {
      trails: {
        active: boolean;
        origin: THREE.Vector3;
        head: THREE.Vector3;
        ring: THREE.Vector3[];
        sourceAnchor: unknown;
      }[];
    }
  ).trails;
  return {
    pool,
    slots,
    dispose: () => {
      pool.dispose();
      texture.dispose();
    },
  };
}
describe('opt-in projectile launch origins', () => {
  it('uses an actual hand at launch and never drags an airborne trail behind later hand motion', () => {
    const h = fixture();
    let x = 2;
    const sample = vi.fn((_id: number, out: THREE.Vector3) => {
      out.set(x, 0.8, 1);
      return true;
    });
    try {
      h.pool.spawnTrailStyled(1, 2, 0xffffff, 0.2, { ...options, sourceAnchor: sample });
      expect(h.slots[0].origin.x).toBe(2);
      x = 3;
      h.pool.update(0, new THREE.Vector3(0, 3, 10), false);
      expect(h.slots[0].origin.x).toBe(3);
      expect(h.slots[0].ring[0].x).toBe(3);
      x = 9;
      h.pool.update(0.01, new THREE.Vector3(0, 3, 10), true);
      expect(h.slots[0].origin.x).toBe(3);
      expect(sample).toHaveBeenCalledTimes(2);
      expect(h.slots[0].sourceAnchor).toBeNull();
    } finally {
      h.dispose();
    }
  });
  it('samples the hand after a delayed launch and cancels a vanished source without arrival', () => {
    const h = fixture();
    let visible = true;
    let x = 2;
    const arrived = vi.fn();
    const sample = (_id: number, out: THREE.Vector3) => {
      out.set(x, 0.7, 0);
      return visible;
    };
    try {
      h.pool.spawnTrailStyled(
        1,
        2,
        0xffffff,
        0.2,
        { ...options, delay: 0.1, sourceAnchor: sample },
        arrived,
      );
      x = 4;
      h.pool.update(0.1, new THREE.Vector3(0, 3, 10), false);
      x = 6;
      h.pool.update(0, new THREE.Vector3(0, 3, 10), false);
      expect(h.slots[0].origin.x).toBe(6);
      h.pool.clear();
      h.pool.spawnTrailStyled(
        1,
        2,
        0xffffff,
        0.2,
        { ...options, delay: 0.1, sourceAnchor: sample },
        arrived,
      );
      visible = false;
      h.pool.update(0.05, new THREE.Vector3(0, 3, 10), false);
      expect(h.slots.some((slot) => slot.active)).toBe(false);
      expect(arrived).not.toHaveBeenCalled();
    } finally {
      h.dispose();
    }
  });
  it('retains generic body sources and drops callbacks on clear without changing pool capacity', () => {
    const h = fixture();
    try {
      h.pool.spawnTrailStyled(1, 2, 0xffffff, 0.2, options);
      expect(h.slots[0].origin.toArray()).toEqual([0, 1.24, 0]);
      const capacity = h.slots.length;
      for (let i = 0; i < 40; i++)
        h.pool.spawnTrailStyled(1, 2, 0xffffff, 0.2, {
          ...options,
          sourceAnchor: (_id, out) => {
            out.set(2, 1, 0);
            return true;
          },
        });
      expect(h.slots).toHaveLength(capacity);
      h.pool.clear();
      expect(h.slots.every((slot) => !slot.active && slot.sourceAnchor === null)).toBe(true);
    } finally {
      h.dispose();
    }
  });
});
