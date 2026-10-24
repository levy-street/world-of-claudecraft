import { MeshoptSimplifier } from 'meshoptimizer';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  isPalmBudgetTree,
  sceneryQualityIndices,
} from '../scripts/lib/scenery_quality_indices.mjs';

describe('shape-preserving scenery reduction', () => {
  it('uses the placement and tree family to constrain Palmreach reductions', () => {
    const zone = { xMin: -540, xMax: -180, zMin: 700, zMax: 1260 };
    const owner = new THREE.Group();
    owner.name = 'jungle-features';
    const source = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial());
    const item = { x: -300, z: 800, owner };
    source.material.name = 'Leaves_NormalTree';
    expect(isPalmBudgetTree(item, source, zone)).toBe(true);
    expect(isPalmBudgetTree({ ...item, x: 30 }, source, zone)).toBe(false);
    expect(isPalmBudgetTree({ ...item, x: -180 }, source, zone)).toBe(false);
    expect(isPalmBudgetTree({ ...item, z: 1260 }, source, zone)).toBe(false);
    source.material.name = 'Rocks';
    expect(isPalmBudgetTree(item, source, zone)).toBe(false);
    source.material.name = 'Atlas';
    expect(isPalmBudgetTree(item, source, zone)).toBe(true);
    owner.name = 'garden-features';
    expect(isPalmBudgetTree(item, source, zone)).toBe(false);
  });
  it('keeps small authored parts intact and never mutates source data', async () => {
    await MeshoptSimplifier.ready;
    const g = new THREE.BoxGeometry(3, 12, 3);
    const before = g.index!.array.slice();
    const positions = g.attributes.position.array.slice();
    const indices = sceneryQualityIndices(g);
    expect(indices).toEqual(Uint32Array.from(before));
    expect(g.index!.array).toEqual(before);
    expect(g.attributes.position.array).toEqual(positions);
    expect(indices).not.toBe(g.index!.array);
  });
  it('refuses a destructive budget when the error bound needs more triangles', async () => {
    await MeshoptSimplifier.ready;
    const g = new THREE.SphereGeometry(8, 32, 24);
    const indices = sceneryQualityIndices(g, 12);
    expect(indices.length).toBeGreaterThan(36);
    expect(indices.length).toBeLessThan(g.index!.count);
    expect(sceneryQualityIndices(g, 128, true).length).toBeLessThan(
      sceneryQualityIndices(g).length,
    );
    const indexed = g.clone();
    indexed.setIndex(Array.from(indices));
    const low = indexed.toNonIndexed();
    low.computeBoundingBox();
    g.computeBoundingBox();
    expect(low.boundingBox!.min.distanceTo(g.boundingBox!.min)).toBeLessThan(0.3);
    expect(low.boundingBox!.max.distanceTo(g.boundingBox!.max)).toBeLessThan(0.3);
    expect([...indices].every((i) => i >= 0 && i < g.attributes.position.count)).toBe(true);
  });
  it('permits a coarser fallback only for the aggressive policy', async () => {
    await MeshoptSimplifier.ready;
    const g = new THREE.SphereGeometry(8, 32, 24);
    const before = g.index!.array.slice();
    const strict = sceneryQualityIndices(g, 12);
    const coarse = sceneryQualityIndices(g, 12, true);
    expect(coarse.length).toBeGreaterThan(0);
    expect(coarse.length).toBeLessThan(strict.length);
    expect(coarse.length).toBeLessThanOrEqual(36);
    expect([...coarse].every((i) => i < g.attributes.position.count)).toBe(true);
    expect(g.index!.array).toEqual(before);
  });
});
