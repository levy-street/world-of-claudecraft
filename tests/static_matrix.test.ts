import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { freezeStaticMatrices, freezeStaticSubtreeMatrices } from '../src/render/static_matrix';

describe('static matrix traversal', () => {
  it('keeps transform-animated descendants live under a locally frozen root', () => {
    const scene = new THREE.Scene();
    scene.updateMatrix();
    scene.matrixAutoUpdate = false;
    const root = new THREE.Group();
    const moving = new THREE.Object3D();
    moving.position.x = 2;
    root.add(moving);
    scene.add(root);

    freezeStaticMatrices(root);
    moving.matrixAutoUpdate = true;
    moving.position.x = 7;
    scene.updateMatrixWorld();

    expect(moving.matrixWorld.elements[12]).toBe(7);
  });

  it('preserves final world matrices while skipping a fully static subtree', () => {
    const scene = new THREE.Scene();
    scene.updateMatrix();
    scene.matrixAutoUpdate = false;
    const root = new THREE.Group();
    root.position.x = 3;
    const child = new THREE.Object3D();
    child.position.x = 4;
    root.add(child);
    scene.add(root);

    freezeStaticSubtreeMatrices(root);
    expect(root.matrixWorldAutoUpdate).toBe(false);
    expect(child.matrixWorld.elements[12]).toBe(7);

    root.position.x = 30;
    child.position.x = 40;
    scene.updateMatrixWorld();
    expect(child.matrixWorld.elements[12]).toBe(7);
  });
});
