import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ShamanHeld } from '../src/render/ability_vfx/shaman_held';
import type { WeaponAnchorSampler } from '../src/render/weapon_trail_anchor';
import { ABILITIES } from '../src/sim/content/classes';

const IMBUES = ['rockbiter_weapon', 'flametongue_weapon', 'galeheart_weapon', 'lifespring_weapon'];
function fixture() {
  const held = new ShamanHeld();
  const paths: { points: number[][]; color: number; width: number }[] = [];
  const motes: number[][] = [];
  const arrays = new Set<THREE.Vector3[]>();
  const matrices = [
    new THREE.Matrix4().makeTranslation(3, 4, 5),
    new THREE.Matrix4().makeTranslation(-3, 4, 5),
  ];
  const present = [true, true];
  const samplers: WeaponAnchorSampler[] = matrices.map((matrix, hand) =>
    Object.assign(
      (out: THREE.Vector3) => {
        out.set(0, 0.5, 0).applyMatrix4(matrix);
        return present[hand];
      },
      {
        frame: (out: THREE.Matrix4) => {
          out.copy(matrix);
          return present[hand];
        },
      },
    ),
  );
  let lookups = 0;
  const host = {
    anchorOf: (_id: number, _fraction: number, out: THREE.Vector3) => out.set(0, 0, 0),
  };
  const ribbons = {
    appendHeld(points: THREE.Vector3[], n: number, width: number, color: number) {
      arrays.add(points);
      paths.push({ points: points.slice(0, n).map((p) => p.toArray()), color, width });
    },
  };
  const overlay = {
    push(x: number, y: number, z: number, color: number, size: number) {
      motes.push([x, y, z, color, size]);
    },
  };
  const equipment = (_id: number, hand: 0 | 1) => {
    lookups++;
    return present[hand] ? samplers[hand] : null;
  };
  const sync = (id: string, remaining = 1800, frame = 1) =>
    held.sync(frame, { id: 7, hp: 100, auras: [{ id, remaining }] }, 7);
  const draw = (time = 2, quality = 1, reduced = false, frame = 1) => {
    paths.length = 0;
    motes.length = 0;
    held.draw(frame, time, reduced, quality, host, ribbons, overlay, equipment);
  };
  return {
    held,
    paths,
    motes,
    arrays,
    matrices,
    present,
    samplers,
    sync,
    draw,
    lookups: () => lookups,
  };
}

describe('persistent Shaman weapon enchantments', () => {
  it('keeps a broad red ember bed on both weapon faces after the ignition ends', () => {
    const h = fixture();
    h.present[1] = false;
    // A wide axe/hammer head must retain fire coverage, not three hairline sparks.
    h.samplers[0].surface = (frame, extents) => {
      frame.copy(h.matrices[0]);
      extents.set(0.24, 0.5, 0.06);
      return true;
    };
    for (const quality of [0, 0.25, 0.5, 0.75, 1]) {
      for (const time of [2, 5, 30, 900, 1799]) {
        h.sync('flametongue_weapon', 1800 - time);
        h.draw(time, quality);
        const beds = h.paths.filter((p) => {
          const color = new THREE.Color(p.color);
          return color.r > color.g * 4 && p.width >= 0.24;
        });
        expect(beds).toHaveLength(2);
        expect(beds.some((p) => p.points.every(([, , z]) => z > 5.06))).toBe(true);
        expect(beds.some((p) => p.points.every(([, , z]) => z < 4.94))).toBe(true);
        for (const bed of beds) {
          const along = bed.points.map(([, y]) => y);
          expect(Math.max(...along) - Math.min(...along)).toBeGreaterThan(0.75);
        }
        expect(h.paths.length).toBeLessThanOrEqual(4);
        expect(h.motes.length).toBeLessThanOrEqual(2);
      }
    }
  });

  it.each(IMBUES)('keeps %s visibly attached to both equipped weapons at every quality', (id) => {
    const h = fixture();
    h.sync(id);
    for (const quality of [0, 0.25, 0.5, 0.75, 1]) {
      h.draw(2, quality);
      expect(h.paths.some((p) => p.points.every(([x]) => x > 2))).toBe(true);
      expect(h.paths.some((p) => p.points.every(([x]) => x < -2))).toBe(true);
      for (const path of h.paths)
        for (const [x, y, z] of path.points) {
          expect(Math.abs(Math.abs(x) - 3)).toBeLessThan(0.4);
          expect(y).toBeGreaterThan(3.25);
          expect(y).toBeLessThan(4.85);
          expect(Math.abs(z - 5)).toBeLessThan(0.4);
        }
    }
  });

  it('gives water, fire, earth and wind different shapes, not just different colors', () => {
    const h = fixture();
    const silhouettes = new Set<string>();
    for (const id of IMBUES) {
      h.sync(id);
      h.draw();
      silhouettes.add(JSON.stringify(h.paths.map((p) => p.points)));
    }
    expect(silhouettes.size).toBe(4);
  });

  it.each(IMBUES)(
    'follows the full live %s duration and removes it on expiry or replacement',
    (id) => {
      const h = fixture();
      const effect = ABILITIES[id].effects.find((entry) => entry.type === 'imbue');
      if (effect?.type !== 'imbue') throw new Error(`Missing live imbue: ${id}`);
      for (const remaining of [effect.duration, effect.duration / 2, 1, 0.01]) {
        h.sync(id, remaining);
        h.draw(1800 - remaining);
        expect(h.paths.length).toBeGreaterThan(0);
      }
      h.sync(id, 0);
      h.draw(1800);
      expect(h.paths).toHaveLength(0);
      expect(h.motes).toHaveLength(0);
      h.sync(id);
      h.draw();
      h.sync('not_an_imbue');
      h.draw();
      expect(h.paths).toHaveLength(0);
    },
  );

  it('moves water along the weapon while reduced motion retains the frozen full identity', () => {
    const h = fixture();
    h.sync('lifespring_weapon');
    h.draw(2);
    const moving = JSON.stringify([h.paths, h.motes]);
    h.draw(2.25);
    expect(JSON.stringify([h.paths, h.motes])).not.toBe(moving);
    h.draw(2, 0, true);
    const still = JSON.stringify([h.paths, h.motes]);
    expect(h.paths.length).toBeGreaterThan(0);
    h.draw(25, 0, true);
    expect(JSON.stringify([h.paths, h.motes])).toBe(still);
  });

  it('drops removed equipment, follows its replacement and never draws an absent off hand', () => {
    const h = fixture();
    h.sync('lifespring_weapon');
    h.draw(2);
    h.present[1] = false;
    h.draw(2.1);
    expect(h.paths.every((p) => p.points.every(([x]) => x > 2))).toBe(true);
    h.present[0] = false;
    h.draw(2.2);
    expect(h.paths).toHaveLength(0);
    expect(h.motes).toHaveLength(0);
    h.matrices[0].makeTranslation(8, 4, 5);
    h.present[0] = true;
    h.draw(3);
    expect(h.paths.length).toBeGreaterThan(0);
    expect(h.paths.every((p) => p.points.every(([x]) => x > 7))).toBe(true);
  });

  it('uses the moving equipment axes when a swing rotates the weapon', () => {
    const h = fixture();
    h.present[1] = false;
    h.sync('lifespring_weapon');
    h.draw(2, 0, true);
    const before = h.paths[0].points;
    h.matrices[0].makeRotationZ(Math.PI / 2).setPosition(3, 4, 5);
    h.draw(2, 0, true);
    const after = h.paths[0].points;
    for (let n = 0; n < before.length; n++) {
      expect(after[n][0] - 3).toBeCloseTo(-(before[n][1] - 4), 6);
      expect(after[n][1] - 4).toBeCloseTo(before[n][0] - 3, 6);
      expect(after[n][2]).toBeCloseTo(before[n][2], 6);
    }
  });

  it('retains fixed geometry scratch and bounded submissions across sustained enchantment drawing', () => {
    const h = fixture();
    h.sync('lifespring_weapon');
    for (let n = 0; n < 300; n++) {
      h.draw(n / 60);
      expect(h.paths.length).toBeLessThanOrEqual(8);
      expect(h.motes.length).toBeLessThanOrEqual(4);
      expect(h.paths.reduce((count, p) => count + p.points.length * 2, 0)).toBeLessThanOrEqual(144);
    }
    expect(h.arrays.size).toBe(1);
    expect(h.lookups()).toBe(2);
  });
});
