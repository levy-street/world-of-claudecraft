// The Fire and Fly cannon tower's lifecycle: a teardown at any point of its
// load and its gate leaves nothing drawn and nothing owned behind, the model's
// shared geometry and texture stay the loader's, and a failed load is not final.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TURRET_HEAD_HOP,
  TURRET_TOWER_MODEL,
  turretHeadHop,
} from '../src/render/turret_tower_core';
import { TurretTowerVisual } from '../src/render/turret_tower_visual';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The GLB's head and barrel under one textured material, as the loader's cache hands it out. */
function towerModel(map: THREE.Texture | null = null) {
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshStandardMaterial({ map });
  material.name = 'hexagons_medieval';
  const scene = new THREE.Group();
  const head = new THREE.Group();
  head.name = TURRET_TOWER_MODEL.headNode;
  const barrel = new THREE.Mesh(geometry, material);
  barrel.name = TURRET_TOWER_MODEL.barrelNode;
  head.add(barrel, new THREE.Mesh(geometry, material));
  scene.add(head, new THREE.Mesh(geometry, material));
  return { scene, geometry, material };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errors.mockRestore();
});

describe('the cannon tower lifecycle', () => {
  it('builds nothing and asks no gate when its model lands after the teardown', async () => {
    const load = deferred<THREE.Object3D>();
    const gate = vi.fn(() => Promise.resolve());
    const onReady = vi.fn();
    const tower = new TurretTowerVisual(gate, () => load.promise);
    tower.prepare(new THREE.Scene(), onReady);
    tower.dispose();
    load.resolve(towerModel().scene);
    await flush();
    expect(gate).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
    expect(tower.group.children).toHaveLength(0);
    expect(tower.group.parent).toBeNull();
    expect(tower.barrelNode).toBeNull();
  });

  it('asks for no retry when its load fails after the teardown', async () => {
    const load = deferred<THREE.Object3D>();
    const onUnavailable = vi.fn();
    const tower = new TurretTowerVisual(undefined, () => load.promise);
    tower.prepare(new THREE.Scene(), undefined, onUnavailable);
    tower.dispose();
    load.reject(new Error('offline'));
    await flush();
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it('leaves the scene and stays hidden when torn down while its gate is pending', async () => {
    const gated = deferred<void>();
    const gate = vi.fn(() => gated.promise);
    const parent = new THREE.Scene();
    const tower = new TurretTowerVisual(gate, async () => towerModel().scene);
    tower.prepare(parent);
    await flush();
    expect(gate).toHaveBeenCalledWith(tower.group);
    expect(tower.group.parent).toBe(parent);
    expect(tower.group.visible).toBe(false);
    tower.dispose();
    expect(tower.group.parent).toBeNull();
    gated.resolve();
    await flush();
    expect(tower.group.visible).toBe(false);
    expect(tower.group.parent).toBeNull();
  });

  it('releases its own material once over two teardowns, never the shared geometry, texture or source material', async () => {
    const map = new THREE.Texture();
    const model = towerModel(map);
    const geometryDispose = vi.spyOn(model.geometry, 'dispose');
    const mapDispose = vi.spyOn(map, 'dispose');
    const sourceDispose = vi.spyOn(model.material, 'dispose');
    const tower = new TurretTowerVisual(undefined, async () => model.scene);
    tower.prepare(new THREE.Scene());
    await flush();
    const owned = new Set<THREE.Material>();
    tower.group.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) owned.add(mesh.material as THREE.Material);
    });
    expect(owned.size).toBe(1);
    const [material] = owned;
    expect(material).not.toBe(model.material);
    expect((material as THREE.MeshStandardMaterial).map).toBe(map);
    const ownedDispose = vi.spyOn(material, 'dispose');
    tower.dispose();
    tower.dispose();
    expect(ownedDispose).toHaveBeenCalledTimes(1);
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(mapDispose).not.toHaveBeenCalled();
    expect(sourceDispose).not.toHaveBeenCalled();
  });

  it('throws nothing on a failed load and leaves the tower unprepared, so a later try builds it', async () => {
    const gate = vi.fn(() => Promise.resolve());
    const source = vi
      .fn<() => Promise<THREE.Object3D>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(async () => towerModel().scene);
    const onUnavailable = vi.fn();
    const parent = new THREE.Scene();
    const tower = new TurretTowerVisual(gate, source);
    expect(() => tower.prepare(parent, undefined, onUnavailable)).not.toThrow();
    expect(tower.prepared).toBe(true);
    await flush();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(tower.prepared).toBe(false);
    expect(tower.group.parent).toBeNull();
    expect(gate).not.toHaveBeenCalled();
    const onReady = vi.fn();
    tower.prepare(parent, onReady);
    await flush();
    expect(source).toHaveBeenCalledTimes(2);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(tower.barrelNode?.name).toBe(TURRET_TOWER_MODEL.barrelNode);
    expect(tower.group.parent).toBe(parent);
    tower.dispose();
  });

  it('stays failed, with nothing attached, on a model that lost its head or its barrel', async () => {
    const gate = vi.fn(() => Promise.resolve());
    const source = vi.fn(async () => new THREE.Group());
    const onUnavailable = vi.fn();
    const parent = new THREE.Scene();
    const tower = new TurretTowerVisual(gate, source);
    tower.prepare(parent, undefined, onUnavailable);
    await flush();
    expect(gate).not.toHaveBeenCalled();
    expect(onUnavailable).not.toHaveBeenCalled();
    expect(tower.group.parent).toBeNull();
    expect(tower.prepared).toBe(true);
    tower.prepare(parent);
    await flush();
    expect(source).toHaveBeenCalledTimes(1);
    tower.dispose();
  });
});

describe('the cannon tower slam', () => {
  it('hops the head alone on its mount, in yards whatever the model scale, then sets it back', async () => {
    const tower = new TurretTowerVisual(undefined, async () => towerModel().scene);
    tower.prepare(new THREE.Scene());
    await flush();
    const head = tower.group.getObjectByName(TURRET_TOWER_MODEL.headNode);
    if (!head) throw new Error('head expected');
    const body = tower.group.children[0].children.find((c) => c !== head);
    if (!body) throw new Error('body expected');
    tower.place(3, 10, 4);
    const rest = head.getWorldPosition(new THREE.Vector3());
    const bodyAt = body.getWorldPosition(new THREE.Vector3());
    const groupAt = tower.group.position.clone();
    tower.slam(2);
    tower.hop(2 + TURRET_HEAD_HOP.riseTime);
    tower.group.updateMatrixWorld(true);
    const up = head.getWorldPosition(new THREE.Vector3());
    expect(up.y - rest.y).toBeCloseTo(TURRET_HEAD_HOP.rise, 9);
    expect(up.x).toBeCloseTo(rest.x, 9);
    expect(up.z).toBeCloseTo(rest.z, 9);
    // The tower body, and the gunner standing on it, never move.
    expect(body.getWorldPosition(new THREE.Vector3())).toEqual(bodyAt);
    expect(tower.group.position).toEqual(groupAt);
    tower.hop(2 + 0.1);
    tower.group.updateMatrixWorld(true);
    expect(head.getWorldPosition(new THREE.Vector3()).y - rest.y).toBeCloseTo(
      turretHeadHop(0.1),
      9,
    );
    tower.hop(5);
    tower.group.updateMatrixWorld(true);
    expect(head.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(rest.y, 9);
    // A new seat sets it back on its mount mid-hop.
    tower.slam(6);
    tower.hop(6 + TURRET_HEAD_HOP.riseTime);
    tower.reset(0);
    tower.hop(6 + TURRET_HEAD_HOP.riseTime);
    tower.group.updateMatrixWorld(true);
    expect(head.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(rest.y, 9);
    tower.dispose();
  });
});
