import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { WebGLGeometries } from 'three/src/renderers/webgl/WebGLGeometries.js';
import { describe, expect, it, vi } from 'vitest';
import { SCENERY_DETAIL_BANDS } from '../src/render/gfx';
import { GHOST_HIDE_ATTRIBUTE } from '../src/render/instanced_dither_fade';
import { SceneryDetailSession } from '../src/render/scenery_detail';
import { inSceneryRegion, sceneryDetailLevel } from '../src/render/scenery_detail_core';
import {
  buildSceneryDetailIndex,
  scenerySimplifierReady,
} from '../src/render/scenery_detail_indices';

const queue = { run: async <T>(work: () => T | Promise<T>): Promise<T> => work() };

function fixture(xs = [0, 100, 200, 350, 600]) {
  const geometry = new THREE.SphereGeometry(3, 48, 24);
  const material = new THREE.MeshStandardMaterial({ roughness: 0.7 });
  material.name = 'Leaves_Pine';
  material.onBeforeCompile = vi.fn();
  material.customProgramCacheKey = () => 'existing-wind-and-surface';
  const mesh = new THREE.InstancedMesh(geometry, material, xs.length);
  xs.forEach((x, i) => {
    mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, 5, 700));
    mesh.setColorAt(i, new THREE.Color(i / xs.length, 0.5, 0.75));
  });
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  const root = new THREE.Group();
  root.add(mesh);
  return { mesh, geometry, material, root };
}

describe('scenery detail production policy', () => {
  it.each(['low', 'medium', 'high', 'ultra', 'insane'] as const)(
    'partitions the actual %s batches without losing placements or changing materials',
    async (tier) => {
      const f = fixture([30, 90, 180, 360, 600]);
      const session = new SceneryDetailSession(queue, SCENERY_DETAIL_BANDS[tier]);
      session.prepare(f.mesh);
      await session.settled();
      session.update(0, 700);
      const children = f.mesh.children as THREE.InstancedMesh[];
      expect(children.reduce((count, child) => count + child.count, 0)).toBe(5);
      for (const child of children) {
        expect(child.material).toBe(f.material);
        for (let i = 0; i < child.count; i++) {
          const x = child.instanceMatrix.array[i * 16 + 12];
          const expected = sceneryDetailLevel(x, 0, SCENERY_DETAIL_BANDS[tier]);
          // Adjacent budgets may converge to identical geometry and share a draw.
          expect(Number(child.name.split(':')[1])).toBeLessThanOrEqual(expected);
          if (expected === 0) expect(child.geometry.index).toBe(f.geometry.index);
        }
      }
      session.dispose();
    },
  );

  it('synchronizes after the real foliage ghost writer in both renderer frame paths', () => {
    const renderer = readFileSync('src/render/renderer.ts', 'utf8');
    const paths = renderer.split('this.foliage.update(').slice(1);
    expect(paths).toHaveLength(2);
    for (const path of paths) {
      const sync = path.indexOf('updateSceneryDetail(');
      expect(sync).toBeGreaterThan(0);
      expect(sync).toBeLessThan(path.indexOf('this.fish.update('));
    }
    expect(readFileSync('src/render/zone_feature_sweep.ts', 'utf8')).not.toContain(
      'updateSceneryDetail(',
    );
  });

  it('releases rendered reduced GPU indices while retaining all borrowed source buffers', async () => {
    const f = fixture([100, 200]);
    const session = new SceneryDetailSession(queue, SCENERY_DETAIL_BANDS.low);
    session.prepare(f.mesh);
    await session.settled();
    session.update(0, 700);
    const removed = new Set<THREE.BufferAttribute>();
    const geometries = (
      WebGLGeometries as unknown as (...args: unknown[]) => {
        get(object: THREE.Object3D, geometry: THREE.BufferGeometry): THREE.BufferGeometry;
      }
    )(
      {},
      { remove: (attribute: THREE.BufferAttribute) => removed.add(attribute) },
      { memory: { geometries: 0 } },
      { releaseStatesOfGeometry: () => undefined },
    );
    const indices: THREE.BufferAttribute[] = [];
    for (const child of f.mesh.children as THREE.InstancedMesh[]) {
      if (!child.count) continue;
      geometries.get(child, child.geometry);
      indices.push(child.geometry.index!);
    }
    session.dispose();
    for (const index of indices) expect(removed.has(index)).toBe(true);
    expect(removed.has(f.geometry.index!)).toBe(false);
    expect(removed.has(f.geometry.attributes.position as THREE.BufferAttribute)).toBe(false);
  });
  it('implements the five preset bands and always preserves nearby detail', () => {
    const expected = {
      low: [0, 3, 4, 5, 5],
      medium: [0, 2, 3, 4, 5],
      high: [0, 0, 2, 3, 4],
      ultra: [0, 0, 1, 2, 3],
      insane: [0, 0, 0, 1, 2],
    };
    for (const tier of Object.keys(expected) as (keyof typeof expected)[]) {
      expect(
        [30, 90, 180, 360, 600].map((d) => sceneryDetailLevel(d, 0, SCENERY_DETAIL_BANDS[tier])),
      ).toEqual(expected[tier]);
      for (let prior = 0; prior <= 5; prior++)
        expect(sceneryDetailLevel(60, prior, SCENERY_DETAIL_BANDS[tier])).toBe(0);
    }
    const low = SCENERY_DETAIL_BANDS.low;
    expect(sceneryDetailLevel(62, 0, low)).toBe(0);
    expect(sceneryDetailLevel(64, 0, low)).toBe(3);
    expect(sceneryDetailLevel(62, 3, low)).toBe(3);
    expect(sceneryDetailLevel(60, 3, low)).toBe(0);
    expect(sceneryDetailLevel(NaN, 5, low)).toBe(0);
  });

  it('selects regions from the placement, including explicit borders', () => {
    const palm = { xMin: -540, xMax: -180, zMin: 700, zMax: 1260 };
    expect(inSceneryRegion(-352, 806, palm)).toBe(true);
    expect(inSceneryRegion(-180, 806, palm)).toBe(false);
    expect(inSceneryRegion(-352, 1260, palm)).toBe(false);
  });

  it('partitions a wide batch without losing, duplicating or recoloring any placement', async () => {
    const f = fixture();
    const original = Array.from(f.mesh.instanceMatrix.array);
    const colors = Array.from(f.mesh.instanceColor!.array);
    const session = new SceneryDetailSession(queue, SCENERY_DETAIL_BANDS.low);
    session.prepare(f.mesh);
    await session.settled();
    session.update(0, 700);
    expect(f.mesh.count).toBe(0);
    const children = f.mesh.children as THREE.InstancedMesh[];
    expect(children.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(5);
    expect(children[0].count).toBe(1);
    const seen = [];
    for (const child of children) {
      expect(child.material).toBe(f.material);
      expect(child.receiveShadow).toBe(true);
      expect(child.castShadow).toBe(false);
      expect(child.geometry.attributes.position).toBe(f.geometry.attributes.position);
      expect(child.geometry.attributes.uv).toBe(f.geometry.attributes.uv);
      for (let i = 0; i < child.count; i++) {
        const matrix = Array.from(child.instanceMatrix.array.slice(i * 16, i * 16 + 16));
        const index = [0, 100, 200, 350, 600].indexOf(matrix[12]);
        expect(matrix).toEqual(original.slice(index * 16, index * 16 + 16));
        expect(Array.from(child.instanceColor!.array.slice(i * 3, i * 3 + 3))).toEqual(
          colors.slice(index * 3, index * 3 + 3),
        );
        seen.push(index);
      }
    }
    expect(seen.sort()).toEqual([0, 1, 2, 3, 4]);
    expect(f.material.customProgramCacheKey()).toBe('existing-wind-and-surface');
    session.update(600, 700);
    expect(children[0].instanceMatrix.array[12]).toBe(600);
    session.dispose();
    expect(f.mesh.count).toBe(5);
    expect(f.mesh.children).toHaveLength(0);
    expect(Array.from(f.mesh.instanceMatrix.array)).toEqual(original);
  });

  it('copies both dither fades and zero-scale ghost swaps using original instance identities', async () => {
    const f = fixture([0, 100]);
    const hide = new THREE.InstancedBufferAttribute(new Float32Array([0, 0.7]), 1);
    f.geometry.setAttribute('aGhostHide', hide);
    const session = new SceneryDetailSession(queue, SCENERY_DETAIL_BANDS.low);
    session.prepare(f.mesh);
    await session.settled();
    session.update(0, 700);
    const far = f.mesh.children[1] as THREE.InstancedMesh;
    expect(far.geometry.getAttribute('aGhostHide').getX(0)).toBeCloseTo(0.7);
    hide.setX(1, 0.2);
    hide.needsUpdate = true;
    f.mesh.setMatrixAt(1, new THREE.Matrix4().makeScale(0, 0, 0));
    f.mesh.instanceMatrix.needsUpdate = true;
    session.update(0, 700);
    expect(far.geometry.getAttribute('aGhostHide').getX(0)).toBeCloseTo(0.2);
    expect(far.instanceMatrix.array[0]).toBe(0);
    session.dispose();
  });

  it('does not reupload matrices when the camera moves within the same detail band', async () => {
    const f = fixture([0, 100]);
    const session = new SceneryDetailSession(queue, SCENERY_DETAIL_BANDS.low);
    session.prepare(f.mesh);
    await session.settled();
    session.update(0, 700);
    const children = f.mesh.children as THREE.InstancedMesh[];
    const versions = children.map((mesh) => mesh.instanceMatrix.version);
    session.update(1, 700);
    expect(children.map((mesh) => mesh.instanceMatrix.version)).toEqual(versions);
    session.dispose();
  });

  it('copies live ghost changes without recalculating stationary placement distances', async () => {
    const f = fixture([0, 100]);
    const hide = new THREE.InstancedBufferAttribute(new Float32Array([0, 0]), 1);
    f.geometry.setAttribute('aGhostHide', hide);
    const session = new SceneryDetailSession(queue, SCENERY_DETAIL_BANDS.medium);
    session.prepare(f.mesh);
    await session.settled();
    session.update(0, 700);
    hide.setX(1, 0.6);
    hide.needsUpdate = true;
    const distance = vi.spyOn(Math, 'hypot');
    try {
      session.update(0, 700);
      expect(distance).not.toHaveBeenCalled();
      const far = (f.mesh.children as THREE.InstancedMesh[]).find(
        (mesh) => mesh.count > 0 && mesh.instanceMatrix.array[12] === 100,
      )!;
      expect(far.geometry.getAttribute('aGhostHide').getX(0)).toBeCloseTo(0.6);
    } finally {
      distance.mockRestore();
      session.dispose();
    }
  });

  it('follows an existing camera-fade material replacement without waiting for camera movement', async () => {
    const f = fixture([100]);
    const session = new SceneryDetailSession(queue, SCENERY_DETAIL_BANDS.low);
    session.prepare(f.mesh);
    await session.settled();
    session.update(0, 700);
    const faded = f.material.clone();
    faded.transparent = true;
    faded.opacity = 0.25;
    f.mesh.material = faded;
    session.update(0, 700);
    for (const child of f.mesh.children as THREE.Mesh[]) expect(child.material).toBe(faded);
    session.dispose();
  });

  it('does not split an extra draw when a small model already fits its target budget', async () => {
    const f = fixture([0, 90]);
    f.mesh.geometry = new THREE.SphereGeometry(3, 8, 4);
    const session = new SceneryDetailSession(queue, SCENERY_DETAIL_BANDS.low);
    session.prepare(f.mesh);
    await session.settled();
    session.update(0, 700);
    const draws = (f.mesh.children as THREE.InstancedMesh[]).filter((child) => child.visible);
    expect(draws).toHaveLength(1);
    expect(draws[0].count).toBe(2);
    expect(draws[0].geometry.index).toBe(f.mesh.geometry.index);
    session.dispose();
  });

  it('keeps the full source while preparation is pending and cancels work on teardown', async () => {
    const f = fixture([100]);
    const work: (() => unknown)[] = [];
    const held = {
      run: <T>(fn: () => T | Promise<T>) =>
        new Promise<T>((resolve) => {
          work.push(() => resolve(fn()));
        }),
    };
    const session = new SceneryDetailSession(held, SCENERY_DETAIL_BANDS.low);
    session.prepare(f.mesh);
    await scenerySimplifierReady;
    session.update(0, 700);
    expect((f.mesh.children[0] as THREE.InstancedMesh).count).toBe(1);
    expect((f.mesh.children[0] as THREE.InstancedMesh).geometry.index).toBe(f.geometry.index);
    session.dispose();
    for (const fn of work) fn();
    await session.settled();
    expect(f.mesh.count).toBe(1);
    expect(session.snapshot().indexBytes).toBe(0);
  });

  it('shares reduced indices across batches and disposes only owned resources once', async () => {
    const f = fixture([100]);
    const other = new THREE.InstancedMesh(f.geometry, f.material, 1);
    other.setMatrixAt(0, new THREE.Matrix4().makeTranslation(200, 0, 700));
    const geometryDispose = vi.fn(),
      materialDispose = vi.fn();
    f.geometry.addEventListener('dispose', geometryDispose);
    f.material.addEventListener('dispose', materialDispose);
    const session = new SceneryDetailSession(queue, SCENERY_DETAIL_BANDS.low);
    session.prepare(f.mesh);
    session.prepare(other);
    await session.settled();
    session.update(0, 700);
    expect(session.snapshot().models).toBe(1);
    const a = f.mesh.children[1] as THREE.InstancedMesh;
    const b = other.children[1] as THREE.InstancedMesh;
    expect(a.geometry.index).toBe(b.geometry.index);
    const dispose = vi.fn();
    a.geometry.addEventListener('dispose', dispose);
    session.dispose();
    session.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();
  });

  it('applies distance bands across region borders', async () => {
    const f = fixture([0, 100, 600]);
    const session = new SceneryDetailSession(queue, SCENERY_DETAIL_BANDS.low);
    session.prepare(f.mesh);
    await session.settled();
    session.update(-100, 700);
    expect(session.snapshot().levels[0]).toBe(0);
    session.dispose();
  });

  it('gives only Palmreach placements the stronger tree budget in a mixed batch', async () => {
    const f = fixture([-270, -90]);
    const session = new SceneryDetailSession(queue, SCENERY_DETAIL_BANDS.low);
    session.prepare(f.mesh);
    await session.settled();
    session.update(-180, 700);
    const draws = (f.mesh.children as THREE.InstancedMesh[]).filter((m) => m.visible);
    expect(draws).toHaveLength(2);
    const palm = draws.find((m) => m.instanceMatrix.array[12] === -270)!;
    const ordinary = draws.find((m) => m.instanceMatrix.array[12] === -90)!;
    expect(palm.geometry.index!.count).toBeLessThan(ordinary.geometry.index!.count);
    expect(palm.material).toBe(ordinary.material);
    session.update(-180, 700);
    expect(draws.reduce((n, m) => n + m.count, 0)).toBe(2);
    session.dispose();
  });

  it('keeps full landmark geometry at its footprint and restores it after leaving the far band', async () => {
    const source = new THREE.SphereGeometry(40, 32, 16);
    const mesh = new THREE.Mesh(source, new THREE.MeshStandardMaterial());
    mesh.position.set(200, 0, 700);
    const session = new SceneryDetailSession(queue, SCENERY_DETAIL_BANDS.low);
    session.prepare(mesh);
    await session.settled();
    session.update(0, 700);
    const color = mesh.children[0] as THREE.Mesh;
    expect(color.visible).toBe(true);
    expect(color.geometry.index!.count).toBeLessThan(source.index!.count);
    expect(mesh.geometry.attributes.position).toBe(source.attributes.position);
    expect(mesh.geometry.drawRange.count).toBe(0);
    session.update(150, 700);
    expect(mesh.geometry).toBe(source);
    expect(color.visible).toBe(false);
    session.dispose();
  });

  it('preserves far prop count, bounds and existing shadow callbacks', async () => {
    const f = fixture([100]);
    f.mesh.name = 'far-bake:cell:material';
    f.mesh.computeBoundingBox();
    f.mesh.computeBoundingSphere();
    const box = f.mesh.boundingBox!.clone();
    f.mesh.count = 0;
    f.mesh.onBeforeShadow = () => {
      f.mesh.count = 1;
    };
    f.mesh.onAfterShadow = () => {
      f.mesh.count = 0;
    };
    const session = new SceneryDetailSession(queue, SCENERY_DETAIL_BANDS.low);
    session.prepareRoot(f.root);
    await session.settled();
    session.update(0, 700);
    expect(f.mesh.count).toBe(0);
    expect(f.mesh.children).toHaveLength(0);
    expect(f.mesh.boundingBox).toEqual(box);
    const args = [null, f.mesh, null, null, f.mesh.geometry, null, null] as unknown as Parameters<
      typeof f.mesh.onBeforeShadow
    >;
    f.mesh.onBeforeShadow(...args);
    expect(f.mesh.count).toBe(1);
    f.mesh.onAfterShadow(...args);
    expect(f.mesh.count).toBe(0);
    f.mesh.count = 1;
    session.update(1, 700);
    expect(f.mesh.count).toBe(1);
    session.dispose();
    expect(f.mesh.count).toBe(1);
  });

  it('excludes moving transport hierarchies and empty dynamic batches', async () => {
    const f = fixture([100]);
    f.root.userData.decorative = false;
    const session = new SceneryDetailSession(queue, SCENERY_DETAIL_BANDS.low);
    session.prepareRoot(f.root);
    const empty = fixture([200]);
    empty.mesh.count = 0;
    session.prepareRoot(empty.root);
    await session.settled();
    expect(session.snapshot().entries).toBe(0);
    session.dispose();
  });

  it('reduces indices without changing source vertices, normals, UVs or indices', async () => {
    await scenerySimplifierReady;
    const geometry = new THREE.SphereGeometry(3, 32, 16);
    const original = geometry.clone();
    const index = buildSceneryDetailIndex(geometry, 4, false);
    expect(index.count).toBeGreaterThan(0);
    expect(index.count).toBeLessThan(geometry.index!.count);
    expect(Math.max(...index.array)).toBeLessThan(geometry.attributes.position.count);
    expect(geometry.index!.array).toEqual(original.index!.array);
    for (const name of ['position', 'normal', 'uv'])
      expect(geometry.attributes[name].array).toEqual(original.attributes[name].array);
  });

  it('skips per-placement distance math inside safe movement margins and scopes GPU upload ranges to active instances', async () => {
    const f = fixture([20, 180, 320]);
    f.geometry.setAttribute(
      GHOST_HIDE_ATTRIBUTE,
      new THREE.InstancedBufferAttribute(new Float32Array(3), 1),
    );
    const session = new SceneryDetailSession(queue, SCENERY_DETAIL_BANDS.low);
    session.prepareRoot(f.root);
    await session.settled();
    session.update(0, 700);
    const activeChildren = (f.mesh.children as THREE.InstancedMesh[]).filter((c) => c.count > 0);
    expect(activeChildren.length).toBeGreaterThan(0);
    for (const child of activeChildren) {
      expect(child.instanceMatrix.updateRanges).toEqual([{ start: 0, count: child.count * 16 }]);
      expect(child.instanceColor!.updateRanges).toEqual([{ start: 0, count: child.count * 3 }]);
      const hide = child.geometry.getAttribute(GHOST_HIDE_ATTRIBUTE) as THREE.BufferAttribute;
      expect(hide.updateRanges).toEqual([{ start: 0, count: child.count }]);
    }

    const spy = vi.spyOn(Math, 'hypot');
    // Small 1-yard step well inside every placement's margin (nearest boundary is 60 yd vs 20 yd = 40 yd margin)
    session.update(1, 700);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    session.dispose();
  });
});
