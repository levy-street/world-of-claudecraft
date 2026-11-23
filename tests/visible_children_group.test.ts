// render/visible_children_group.ts: the per-frame matrix walk skips hidden
// children (parked VFX slots, distance-hidden fire groups), and a child that
// is revealed later composes fresh on its first visible walk.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VisibleChildrenGroup } from '../src/render/visible_children_group';

const x = (o: THREE.Object3D) => o.matrixWorld.elements[12];

describe('VisibleChildrenGroup', () => {
  it('leaves a hidden child untouched and composes it once revealed', () => {
    const scene = new THREE.Scene();
    const pool = new VisibleChildrenGroup();
    scene.add(pool);
    const slot = new THREE.Group();
    slot.visible = false;
    slot.position.x = 7;
    const leaf = new THREE.Mesh();
    leaf.position.x = 1;
    slot.add(leaf);
    pool.add(slot);

    scene.updateMatrixWorld();
    expect(x(slot)).toBe(0); // skipped: nothing draws it, nothing reads it
    expect(x(leaf)).toBe(0);

    slot.visible = true;
    scene.updateMatrixWorld();
    expect(x(slot)).toBe(7);
    expect(x(leaf)).toBe(8);
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
