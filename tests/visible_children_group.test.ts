// render/visible_children_group.ts: the per-frame matrix walk skips hidden
// children (parked VFX slots, distance-hidden fire groups, culled props; the
// props root walks each child once first), and a child that is revealed later
// composes fresh on its first visible walk.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HiddenSubtreeGroup, VisibleChildrenGroup } from '../src/render/visible_children_group';

const x = (o: THREE.Object3D) => o.matrixWorld.elements[12];

describe('VisibleChildrenGroup', () => {
  it('leaves a hidden child untouched and composes it once revealed', () => {
    // The default (the parked pools): a slot hidden from birth is never walked.
    const scene = new THREE.Scene();
    scene.matrixAutoUpdate = false; // the renderer's scene (renderer.ts): no forced walk
    const pool = new VisibleChildrenGroup();
    scene.add(pool);
    const slot = new THREE.Group();
    slot.visible = false;
    slot.position.x = 7;
    pool.add(slot);
    scene.updateMatrixWorld();
    expect(x(slot)).toBe(0); // skipped: nothing draws it, nothing reads it
    slot.visible = true;
    scene.updateMatrixWorld();
    expect(x(slot)).toBe(7);
  });

  it('walkHiddenOnce: walks a child attached hidden once, then leaves it until revealed', () => {
    const scene = new THREE.Scene();
    scene.matrixAutoUpdate = false; // the renderer's scene (renderer.ts): no forced walk
    const pool = new VisibleChildrenGroup({ walkHiddenOnce: true });
    scene.add(pool);
    const slot = new THREE.Group();
    slot.visible = false;
    slot.position.x = 7;
    const leaf = new THREE.Mesh();
    leaf.position.x = 1;
    slot.add(leaf);
    pool.add(slot);

    // Its first walk composes it although it is hidden (a far prop the cull
    // hid before the first render): no reader ever finds an identity matrix.
    scene.updateMatrixWorld();
    expect(x(slot)).toBe(7);
    expect(x(leaf)).toBe(8);

    // From then on a hidden child is skipped: moved while hidden, still stale.
    slot.position.x = 9;
    scene.updateMatrixWorld();
    expect(x(slot)).toBe(7);
    expect(x(leaf)).toBe(8);

    slot.visible = true;
    scene.updateMatrixWorld();
    expect(x(slot)).toBe(9);
    expect(x(leaf)).toBe(10);
  });

  it('walkHiddenOnce: walks a hidden child added after the first frame once too', () => {
    const scene = new THREE.Scene();
    scene.matrixAutoUpdate = false;
    const pool = new VisibleChildrenGroup({ walkHiddenOnce: true });
    scene.add(pool);
    scene.updateMatrixWorld();
    const late = new THREE.Group();
    late.visible = false;
    late.position.x = 3;
    pool.add(late); // a lazily built group attached already culled
    scene.updateMatrixWorld();
    expect(x(late)).toBe(3);
  });

  it('marks a hidden child dirty when the group itself moved, so a later reveal re-multiplies', () => {
    const scene = new THREE.Scene();
    const pool = new VisibleChildrenGroup();
    scene.add(pool);
    const frozen = new THREE.Mesh();
    frozen.position.x = 2;
    frozen.updateMatrix();
    frozen.matrixAutoUpdate = false; // static_matrix.ts idiom
    pool.add(frozen);
    scene.updateMatrixWorld();
    expect(x(frozen)).toBe(2);

    frozen.visible = false;
    pool.position.x = 10;
    scene.updateMatrixWorld(); // the pool moved while its child was hidden
    expect(frozen.matrixWorldNeedsUpdate).toBe(true);

    frozen.visible = true;
    scene.updateMatrixWorld();
    expect(x(frozen)).toBe(12);
  });

  it('behaves like a plain Group for visible children', () => {
    const scene = new THREE.Scene();
    const pool = new VisibleChildrenGroup();
    pool.position.x = 3;
    scene.add(pool);
    const child = new THREE.Group();
    child.position.x = 4;
    pool.add(child);
    scene.updateMatrixWorld();
    expect(x(child)).toBe(7);
    child.position.x = 5;
    scene.updateMatrixWorld();
    expect(x(child)).toBe(8);
  });
});

describe('HiddenSubtreeGroup', () => {
  const grid = () => {
    // The renderer's scene is an identity root (renderer.ts sets
    // matrixAutoUpdate false), so its walk does not force every child.
    const scene = new THREE.Scene();
    scene.matrixAutoUpdate = false;
    const group = new HiddenSubtreeGroup();
    group.position.x = 10;
    const rig = new THREE.Group();
    rig.position.x = 2;
    const bone = new THREE.Mesh();
    bone.position.x = 1;
    rig.add(bone);
    group.add(rig);
    scene.add(group);
    return { scene, group, rig, bone };
  };

  it('skips its whole subtree while hidden and composes it fresh once shown', () => {
    const { scene, group, rig, bone } = grid();
    group.visible = false;
    scene.updateMatrixWorld();
    expect(x(group)).toBe(0);
    expect(x(rig)).toBe(0);
    expect(x(bone)).toBe(0);
    group.visible = true;
    scene.updateMatrixWorld();
    expect(x(group)).toBe(10);
    expect(x(rig)).toBe(12);
    expect(x(bone)).toBe(13);
  });

  it('re-multiplies a frozen child against a parent moved while hidden', () => {
    const { scene, group, rig, bone } = grid();
    scene.updateMatrixWorld();
    rig.matrixAutoUpdate = false;
    bone.matrixAutoUpdate = false;
    group.visible = false;
    group.position.x = 20;
    scene.updateMatrixWorld();
    expect(x(bone)).toBe(13);
    group.visible = true;
    scene.updateMatrixWorld();
    expect(x(rig)).toBe(22);
    expect(x(bone)).toBe(23);
  });

  it('honors a forced walk while hidden', () => {
    const { group, bone } = grid();
    group.visible = false;
    group.updateMatrixWorld(true);
    expect(x(bone)).toBe(13);
  });
});

describe('the props root skips its culled children', () => {
  it('buildProps roots the props view in a walkHiddenOnce VisibleChildrenGroup', () => {
    // Most props are distance-culled at any moment, and the stock walk visited
    // every node under them every frame. A plain Group here undoes that.
    const src = readFileSync(new URL('../src/render/props.ts', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('export function buildProps('));
    const root = body.match(/\n {2}const group = new (\w+)\(([^)]*)\);/);
    expect(root?.[1]).toBe('VisibleChildrenGroup');
    // Props are attached already culled, and their matrices are read while hidden
    // (the far-cell bake forces its own walk, but nothing else promises to).
    expect(root?.[2]).toBe('{ walkHiddenOnce: true }');
  });
});
