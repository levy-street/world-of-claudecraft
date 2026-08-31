import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getBounds, NodeIO, Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import {
  buildVarkhulGrandForge,
  buildVarkhulGrandForgeFromSource,
  resetVarkhulGrandForgeCaches,
  varkhulGrandForgeInternalsForTest,
} from '../src/render/varkhul_grand_forge';

const ASSET_PATH = path.join(__dirname, '../public/models/props/varkhul_grand_forge.glb');
const EXPECTED_ASSET_SHA256 = 'd3ffe6d575328a96efb6c39cf86e9d244b1a8f97977244c247e999cfe4ef4f95';

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
    expect(varkhulGrandForgeInternalsForTest.targetHeight).toBe(8.5);
    expect(bounds.max.y - bounds.min.y).toBeCloseTo(8.5);
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

  it('ships the approved front-facing forge within the static-prop budget', async () => {
    await MeshoptDecoder.ready;
    const bytes = readFileSync(ASSET_PATH);
    const sha256 = createHash('sha256').update(bytes).digest('hex');

    expect(sha256).toBe(EXPECTED_ASSET_SHA256);
    expect(bytes.byteLength).toBeLessThanOrEqual(350 * 1024);
    expect(MEDIA_ASSETS['models/props/varkhul_grand_forge.glb']).toBe(
      `/media/models/props/varkhul_grand_forge.${sha256.slice(0, 12)}.glb`,
    );

    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const root = (await io.readBinary(bytes)).getRoot();

    expect(
      root
        .listExtensionsRequired()
        .map((extension) => extension.extensionName)
        .sort(),
    ).toEqual(['EXT_meshopt_compression', 'KHR_mesh_quantization', 'KHR_texture_basisu']);
    expect(
      root.listTextures().map((texture) => ({
        mime: texture.getMimeType(),
        size: texture.getSize(),
      })),
    ).toEqual([
      { mime: 'image/ktx2', size: [512, 512] },
      { mime: 'image/ktx2', size: [512, 512] },
      { mime: 'image/ktx2', size: [512, 512] },
    ]);
    expect(root.listAnimations()).toHaveLength(0);
    expect(root.listSkins()).toHaveLength(0);

    const primitives = root.listMeshes().flatMap((mesh) => mesh.listPrimitives());
    expect(primitives).toHaveLength(1);
    expect(primitives[0].getMode()).toBe(Primitive.Mode.TRIANGLES);
    expect(primitives[0].listSemantics().sort()).toEqual(['NORMAL', 'POSITION', 'TEXCOORD_0']);
    expect((primitives[0].getIndices()?.getCount() ?? 0) / 3).toBeLessThanOrEqual(6_000);

    const bounds = getBounds(root.listScenes()[0]);
    expect(bounds.min[1]).toBeCloseTo(0, 3);
    expect(bounds.max[1] - bounds.min[1]).toBeCloseTo(4.8, 3);
    expect(bounds.max[0] - bounds.min[0]).toBeCloseTo(5.69, 2);
    expect(bounds.max[2] - bounds.min[2]).toBeCloseTo(5.07, 2);
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
