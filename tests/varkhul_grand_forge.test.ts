import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildVarkhulGrandForge,
  buildVarkhulGrandForgeFromSource,
  resetVarkhulGrandForgeCaches,
  varkhulGrandForgeInternalsForTest,
} from '../src/render/varkhul_grand_forge';

describe('Varkhul Grand Forge render adapter', () => {
  it('normalizes, grounds, and marks the generated landmark without mutating its source', () => {
    const source = new THREE.Group();
    const sourceMesh = new THREE.Mesh(
      new THREE.BoxGeometry(4, 5, 3),
      new THREE.MeshStandardMaterial({ color: 0x332211 }),
    );
    sourceMesh.position.y = 3.5;
    source.add(sourceMesh);

    const forge = buildVarkhulGrandForgeFromSource(source);
    const bounds = new THREE.Box3().setFromObject(forge);
    const builtMesh = forge.children[0].children[0] as THREE.Mesh;

    expect(forge.name).toBe('varkhulGrandForge');
    expect(forge.userData.landmark).toBe('varkhul_grand_forge');
    expect(forge.userData.actionable).toBe(true);
    expect(forge.userData.collision).toBe('none');
    expect(bounds.min.y).toBeCloseTo(0, 5);
    expect(bounds.max.y - bounds.min.y).toBeCloseTo(varkhulGrandForgeInternalsForTest.targetHeight);
    expect(builtMesh.castShadow).toBe(true);
    expect(builtMesh.receiveShadow).toBe(true);
    expect(sourceMesh.castShadow).toBe(false);
    expect(sourceMesh.receiveShadow).toBe(false);
  });

  it('pins the shipping GLB path under the prop catalog', () => {
    expect(varkhulGrandForgeInternalsForTest.assetUrl).toBe(
      '/models/props/varkhul_grand_forge.glb',
    );
  });

  it('omits only the model geometry when the optional GLB is unavailable', () => {
    resetVarkhulGrandForgeCaches();

    const forge = buildVarkhulGrandForge(3, 7);

    expect(forge.name).toBe('varkhulGrandForge');
    expect(forge.children).toHaveLength(0);
    expect(forge.position).toMatchObject({ x: 3, z: 7 });
    expect(forge.userData).toMatchObject({
      landmark: 'varkhul_grand_forge',
      actionable: true,
      collision: 'none',
      assetAvailable: false,
    });
  });
});
