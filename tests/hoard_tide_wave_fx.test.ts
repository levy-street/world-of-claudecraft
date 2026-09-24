import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createHoardTideWaveResources } from '../src/render/hoard_tide_wave_fx';
import { HOARD_TIDE_WAVE_HALF_DEPTH } from '../src/sim/rift/hoard_boss_kits';

function object(root: THREE.Object3D, name: string): THREE.Object3D {
  const result = root.getObjectByName(name);
  if (!result) throw new Error(`Missing tide object ${name}`);
  return result;
}

describe('pooled volumetric tide wave', () => {
  it('keeps identical path, calm gap and four-yard crest on low and ultra', () => {
    const resources = createHoardTideWaveResources();
    const low = resources.createView(false);
    const ultra = resources.createView(true);
    const cue = { radius: 28, total: 7, remaining: 3, waveGap: 3, waveSpan: 12, waveLead: 2 };
    low.update(cue, 0.05);
    ultra.update(cue, 0.05);
    for (const name of [
      'hoard-tide-path-0',
      'hoard-tide-path-1',
      'hoard-tide-safe-gap-0',
      'hoard-tide-safe-gap-1',
      'hoard-tide-crest-0',
      'hoard-tide-crest-1',
    ]) {
      const a = object(low.root, name);
      const b = object(ultra.root, name);
      expect(a.visible).toBe(true);
      expect(a.position.toArray()).toEqual(b.position.toArray());
      expect(a.scale.toArray()).toEqual(b.scale.toArray());
    }
    resources.body.computeBoundingBox();
    expect(resources.body.boundingBox?.max.y).toBeGreaterThan(4);
    expect(resources.body.boundingBox?.min.z).toBeCloseTo(-HOARD_TIDE_WAVE_HALF_DEPTH);
    expect(resources.body.boundingBox?.max.z).toBeCloseTo(HOARD_TIDE_WAVE_HALF_DEPTH);
    expect(object(low.root, 'hoard-tide-spray-and-crash').visible).toBe(false);
    expect(object(ultra.root, 'hoard-tide-spray-and-crash').visible).toBe(true);
    low.dispose();
    ultra.dispose();
    resources.dispose();
  });

  it('shares assets, updates existing particle storage, and releases its private buffers', () => {
    const resources = createHoardTideWaveResources();
    const first = resources.createView(true);
    const second = resources.createView(true);
    const a = object(first.root, 'hoard-tide-crest-0').children[0] as THREE.Mesh;
    const b = object(second.root, 'hoard-tide-crest-0').children[0] as THREE.Mesh;
    expect(a.geometry).toBe(b.geometry);
    expect(a.material).toBe(b.material);
    const spray = first.root.getObjectByName('hoard-tide-spray-and-crash') as THREE.InstancedMesh;
    const buffer = spray.instanceMatrix.array;
    const dispose = vi.spyOn(spray, 'dispose');
    for (let i = 0; i < 20; i++)
      first.update({ radius: 28, total: 7, remaining: 4 - i / 20 }, 0.05);
    expect(spray.instanceMatrix.array).toBe(buffer);
    expect(first.finish(0.5)).toBe(true);
    expect(object(first.root, 'hoard-tide-path-0').visible).toBe(false);
    expect(first.finish(0.51)).toBe(false);
    first.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    second.dispose();
    resources.dispose();
  });

  it('drapes the essential floor warning and crest slices onto the actual arena ground', () => {
    const resources = createHoardTideWaveResources();
    const view = resources.createView(false, (_x, z) => (z > 0 ? 0.6 : 0));
    view.update({ radius: 28, total: 7, remaining: 1, waveLead: 2 }, 0.05);
    const lane = object(view.root, 'hoard-tide-path-0') as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4();
    lane.getMatrixAt(0, matrix);
    expect(matrix.elements[13]).toBe(0);
    lane.getMatrixAt(63, matrix);
    expect(matrix.elements[13]).toBeCloseTo(0.6);
    const crest = object(view.root, 'hoard-tide-crest-0').children[0] as THREE.InstancedMesh;
    crest.getMatrixAt(0, matrix);
    expect(matrix.elements[13]).toBeCloseTo(0.6);
    view.dispose();
    resources.dispose();
  });
});
