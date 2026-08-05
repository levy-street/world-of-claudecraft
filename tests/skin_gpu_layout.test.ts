import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  configureTightBoneTextures,
  optimizeSkinGpuLayout,
} from '../src/render/characters/skin_gpu_layout';

function makeBones(count: number): THREE.Bone[] {
  const bones: THREE.Bone[] = [];
  for (let i = 0; i < count; i++) {
    const bone = new THREE.Bone();
    bone.name = `bone_${i}`;
    bone.position.set(0.1 * i, 0.2 + 0.3 * i, -0.05 * i);
    bone.rotation.set(0.03 * i, -0.07 * i, 0.11 * i);
    if (i > 0) bones[i - 1].add(bone);
    bones.push(bone);
  }
  bones[0].updateMatrixWorld(true);
  return bones;
}

function makeGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0.2, 0.6, -0.1, -0.4, 0.9, 0.3, 0.5, -0.2, 0.7], 3),
  );
  geometry.setAttribute(
    'skinIndex',
    new THREE.Uint16BufferAttribute([0, 2, 3, 0, 2, 0, 3, 2, 2, 0, 3, 2], 4),
  );
  geometry.setAttribute(
    'skinWeight',
    new THREE.Float32BufferAttribute([0.7, 0.3, 0, 0, 0.4, 0.6, 0, 0, 0.5, 0.5, 0, 0], 4),
  );
  return geometry;
}

function makeRig(): {
  root: THREE.Object3D;
  mesh: THREE.SkinnedMesh;
  skeleton: THREE.Skeleton;
} {
  const bones = makeBones(4);
  const skeleton = new THREE.Skeleton(bones);
  const mesh = new THREE.SkinnedMesh(makeGeometry(), new THREE.MeshBasicMaterial());
  const root = new THREE.Object3D();
  root.add(bones[0], mesh);
  root.updateMatrixWorld(true);
  mesh.bind(skeleton);
  bones[1].rotation.x += 0.2;
  bones[2].rotation.y -= 0.35;
  bones[3].position.z += 0.4;
  root.updateMatrixWorld(true);
  return { root, mesh, skeleton };
}

function skinnedPositions(mesh: THREE.SkinnedMesh): number[] {
  const positions = mesh.geometry.getAttribute('position');
  const point = new THREE.Vector3();
  const out: number[] = [];
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i);
    mesh.applyBoneTransform(i, point);
    out.push(point.x, point.y, point.z);
  }
  return out;
}

describe('skinned character GPU layout', () => {
  it('keeps the layout and texture optimizations wired into live character assembly', () => {
    const assets = readFileSync(
      new URL('../src/render/characters/assets.ts', import.meta.url),
      'utf8',
    );
    const visual = readFileSync(
      new URL('../src/render/characters/visual.ts', import.meta.url),
      'utf8',
    );

    expect(assets).toMatch(
      /mergeSkinnedParts\(root, animatedNodeNames\(clips\)\);\s+optimizeSkinGpuLayout\(root\);/,
    );
    expect(visual.match(/configureTightBoneTextures\((?:this\.model|payload)\)/g)).toHaveLength(3);
  });

  it('compacts the palette and joint attribute without changing skinned positions', () => {
    const { root, mesh, skeleton } = makeRig();
    const geometryBefore = mesh.geometry;
    const before = skinnedPositions(mesh);

    const stats = optimizeSkinGpuLayout(root);

    expect(skinnedPositions(mesh)).toEqual(before);
    expect(mesh.geometry).not.toBe(geometryBefore);
    expect(mesh.geometry.getAttribute('skinIndex').array).toBeInstanceOf(Uint8Array);
    expect(mesh.geometry.getAttribute('skinWeight').array).toBeInstanceOf(Float32Array);
    expect(mesh.skeleton).not.toBe(skeleton);
    expect(mesh.skeleton.bones.map((bone) => bone.name)).toEqual(['bone_0', 'bone_2', 'bone_3']);
    expect(Array.from(mesh.geometry.getAttribute('skinIndex').array)).toEqual([
      0, 1, 2, 0, 1, 0, 2, 1, 1, 0, 2, 1,
    ]);
    expect(stats).toEqual({
      skeletons: 1,
      paletteMatricesBefore: 4,
      paletteMatricesAfter: 3,
      jointBytesBefore: 24,
      jointBytesAfter: 12,
    });
  });

  it('keeps bones referenced only by zero-weight slots for exact shader inputs', () => {
    const { root, mesh } = makeRig();

    optimizeSkinGpuLayout(root);

    expect(mesh.skeleton.bones.map((bone) => bone.name)).toContain('bone_3');
  });

  it('preserves one shared skeleton across all meshes that already share it', () => {
    const { root, mesh, skeleton } = makeRig();
    const second = new THREE.SkinnedMesh(makeGeometry(), new THREE.MeshBasicMaterial());
    second.bind(skeleton, mesh.bindMatrix);
    root.add(second);

    optimizeSkinGpuLayout(root);

    expect(second.skeleton).toBe(mesh.skeleton);
    expect(mesh.skeleton.bones).toHaveLength(3);
  });

  it('crops RGBA32F padding rows without changing palette bytes', () => {
    const { root, mesh } = makeRig();
    optimizeSkinGpuLayout(root);
    mesh.skeleton.update();
    const paletteBefore = Array.from(mesh.skeleton.boneMatrices);

    const stats = configureTightBoneTextures(root);
    const texture = mesh.skeleton.boneTexture;

    expect(texture).not.toBeNull();
    expect(texture?.format).toBe(THREE.RGBAFormat);
    expect(texture?.type).toBe(THREE.FloatType);
    expect(texture?.image.width).toBe(4);
    expect(texture?.image.height).toBe(3);
    expect(texture?.image.data).toBe(mesh.skeleton.boneMatrices);
    expect(Array.from(texture?.image.data ?? [])).toEqual(paletteBefore);
    expect(stats).toEqual({
      skeletons: 1,
      texelsBefore: 16,
      texelsAfter: 12,
    });

    const sameTexture = texture;
    configureTightBoneTextures(root);
    expect(mesh.skeleton.boneTexture).toBe(sameTexture);
  });

  it('keeps Three stock row width while removing five padded KayKit rows', () => {
    const bones = makeBones(21);
    const skeleton = new THREE.Skeleton(bones);
    const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    const root = new THREE.Object3D();
    root.add(bones[0], mesh);
    mesh.bind(skeleton);

    const stats = configureTightBoneTextures(root);

    expect(skeleton.boneTexture?.image.width).toBe(12);
    expect(skeleton.boneTexture?.image.height).toBe(7);
    expect(stats).toEqual({
      skeletons: 1,
      texelsBefore: 144,
      texelsAfter: 84,
    });
  });
});
