import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  RuneOfPowerVisual,
  RunesOfPowerVisuals,
} from '../src/render/rune_of_power_visual';
import {
  MageGroundFx,
  handleMageGroundSpellfxEvent,
} from '../src/render/mage_ground_fx';

const row = {
  id: 'rune:opaque',
  sourceId: 1,
  disposition: 'eligible' as const,
  x: 0,
  z: 0,
  radius: 8,
  duration: 15,
  remaining: 10,
};
const emptyWorld = {
  activeIgnivarMeteors: [],
  activeVarkhulAnvilMeteors: [],
  activeVarkhulForgestormWarnings: [],
};
describe('persistent Rune inscription', () => {
  it('quarantines failed overflow cleanup instead of recycling a terminal visual', () => {
    const scene = new THREE.Scene(),
      fx = new RunesOfPowerVisuals(scene, () => 0);
    const rows = Array.from({ length: 33 }, (_, i) => ({
      ...row,
      id: `old${i}`,
      x: i * 20,
    }));
    fx.sync(rows);
    const failed = scene.children[32];
    const mesh = failed.children[1] as THREE.InstancedMesh;
    const dispose = vi.spyOn(mesh, 'dispose').mockImplementationOnce(() => {
      throw new Error('overflow');
    });
    expect(() => fx.sync([])).toThrow();
    fx.sync(rows.map((r) => ({ ...r, id: `new:${r.id}`, z: 20 })));
    expect(scene.children).toHaveLength(33);
    expect(scene.children).not.toContain(failed);
    fx.dispose();
    expect(dispose).toHaveBeenCalledTimes(2);
  });
  it('keeps both endpoints of every boundary stroke at the real radius on sloped ground', () => {
    const visual = new RuneOfPowerVisual(),
      matrix = new THREE.Matrix4();
    const left = new THREE.Vector3(),
      right = new THREE.Vector3();
    for (const disposition of [
      'eligible',
      'opponent',
      'inactive',
      'unknown',
    ] as const) {
      visual.sync({ ...row, disposition }, (x, z) => x * 0.03 + z * 0.02);
      for (let i = 0; i < 72; i++) {
        visual.strokes.getMatrixAt(i, matrix);
        left.set(-0.5, 0, 0).applyMatrix4(matrix);
        right.set(0.5, 0, 0).applyMatrix4(matrix);
        for (const p of [left, right]) {
          expect(Math.hypot(p.x, p.z)).toBeCloseTo(8, 5);
          expect(p.y).toBeCloseTo(p.x * 0.03 + p.z * 0.02 + 0.075, 5);
        }
      }
    }
    const version = visual.strokes.instanceMatrix.version;
    visual.sync({ ...row, disposition: 'unknown' }, () => 0);
    expect(visual.strokes.instanceMatrix.version).toBe(version);
    visual.dispose();
  });

  it('restores a recycled inscription clock even when the new row has identical timer values', () => {
    const scene = new THREE.Scene(),
      fx = new RunesOfPowerVisuals(scene, () => 0);
    fx.sync([row]);
    const group = scene.children[0];
    const crystals = group.children[2] as THREE.InstancedMesh;
    const initial = Array.from(crystals.instanceMatrix.array);
    fx.update(3);
    fx.sync([]);
    fx.sync([{ ...row, id: 'new' }]);
    expect(scene.children[0]).toBe(group);
    expect(Array.from(crystals.instanceMatrix.array)).toEqual(initial);
    fx.update(0.1, true);
    const frozen = Array.from(crystals.instanceMatrix.array);
    fx.update(2, true);
    expect(Array.from(crystals.instanceMatrix.array)).toEqual(frozen);
    fx.dispose();
    fx.sync([row]);
    expect(scene.children).toHaveLength(0);
  });

  it('deduplicates both event orders, clears omitted fields and preserves anonymous boss warnings', () => {
    const scene = new THREE.Scene(),
      fx = new MageGroundFx(
        scene,
        () => 0,
        () => {},
      );
    const event = {
      type: 'spellfxAt' as const,
      fx: 'runeCircle' as const,
      ability: 'rune_of_power',
      sourceId: 1,
      persistentId: row.id,
      x: 0,
      z: 0,
      radius: 8,
      duration: 15,
      school: 'arcane',
    };
    handleMageGroundSpellfxEvent(fx, event);
    expect(scene.children).toHaveLength(0);
    fx.syncWorldMeteorWarnings({ ...emptyWorld, activeRunesOfPower: [row] });
    handleMageGroundSpellfxEvent(fx, event);
    expect(scene.children).toHaveLength(1);
    fx.spawnRune({ x: 15, z: 0, radius: 3, duration: 5, school: 'fire' });
    fx.syncWorldMeteorWarnings(emptyWorld);
    expect(scene.children).toHaveLength(1);
    fx.clear();
    expect(scene.children).toHaveLength(0);
    fx.dispose();
  });

  it('retries failed terminal cleanup while disabling all late updates', () => {
    const scene = new THREE.Scene(),
      fx = new MageGroundFx(
        scene,
        () => 0,
        () => {},
      );
    fx.syncWorldMeteorWarnings({ ...emptyWorld, activeRunesOfPower: [row] });
    const strokes = scene.children[0].children[1] as THREE.InstancedMesh;
    const failing = vi.spyOn(strokes, 'dispose').mockImplementationOnce(() => {
      throw new Error('injected');
    });
    const version = strokes.instanceMatrix.version;
    expect(() => fx.dispose()).toThrow();
    expect(scene.children).toHaveLength(0);
    fx.syncWorldMeteorWarnings({ ...emptyWorld, activeRunesOfPower: [row] });
    fx.update(1);
    expect(strokes.instanceMatrix.version).toBe(version);
    expect(() => fx.dispose()).not.toThrow();
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('keeps full single-spell detail and every boundary while prioritizing overlapping interiors', () => {
    const scene = new THREE.Scene(),
      fx = new RunesOfPowerVisuals(scene, () => 0);
    const viewer = { id: 1, pos: { x: 0, z: 0 } };
    const other = { ...row, id: 'other', sourceId: 2, x: 2 };
    fx.sync([row, other], viewer);
    const primary = scene.children[0].children[1] as THREE.InstancedMesh;
    const secondary = scene.children[1].children[1] as THREE.InstancedMesh;
    const a = new THREE.Color(),
      b = new THREE.Color();
    primary.getColorAt(0, a);
    secondary.getColorAt(0, b);
    expect(a.equals(b)).toBe(true);
    primary.getColorAt(75, a);
    secondary.getColorAt(75, b);
    expect(b.r).toBeCloseTo(a.r * 0.015, 6);
    fx.sync([other], viewer);
    secondary.getColorAt(75, b);
    expect(b.r).toBeCloseTo(a.r, 6);
    fx.dispose();
  });
});
