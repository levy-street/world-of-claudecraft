import * as THREE from 'three';

export interface SkinGpuLayoutStats {
  skeletons: number;
  paletteMatricesBefore: number;
  paletteMatricesAfter: number;
  jointBytesBefore: number;
  jointBytesAfter: number;
}

export interface BoneTextureLayoutStats {
  skeletons: number;
  texelsBefore: number;
  texelsAfter: number;
}

type SkinIndexAttribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

function attributeBytes(attribute: SkinIndexAttribute): number {
  return attribute.count * attribute.itemSize * attribute.array.BYTES_PER_ELEMENT;
}

function referencedBones(
  meshes: THREE.SkinnedMesh[],
  boneCount: number,
): { ordered: number[]; remap: Int32Array } | null {
  const referenced = new Set<number>();
  for (const mesh of meshes) {
    const skinIndex = mesh.geometry.getAttribute('skinIndex') as SkinIndexAttribute | undefined;
    if (skinIndex?.itemSize !== 4 || skinIndex.normalized) return null;
    for (let vertex = 0; vertex < skinIndex.count; vertex++) {
      for (let component = 0; component < skinIndex.itemSize; component++) {
        const index = skinIndex.getComponent(vertex, component);
        if (!Number.isInteger(index) || index < 0 || index >= boneCount) return null;
        referenced.add(index);
      }
    }
  }
  if (referenced.size === 0) return null;

  const ordered = [...referenced].sort((a, b) => a - b);
  const remap = new Int32Array(boneCount);
  remap.fill(-1);
  for (let i = 0; i < ordered.length; i++) remap[ordered[i]] = i;
  return { ordered, remap };
}

function remappedSkinIndex(
  source: SkinIndexAttribute,
  remap: Int32Array,
  paletteSize: number,
): THREE.BufferAttribute {
  const count = source.count * source.itemSize;
  const array = paletteSize <= 0x100 ? new Uint8Array(count) : new Uint16Array(count);
  for (let vertex = 0; vertex < source.count; vertex++) {
    for (let component = 0; component < source.itemSize; component++) {
      const oldIndex = source.getComponent(vertex, component);
      array[vertex * source.itemSize + component] = remap[oldIndex];
    }
  }
  return new THREE.BufferAttribute(array, source.itemSize);
}

/**
 * Remove palette matrices that no skinIndex slot fetches and narrow the joint
 * attribute to its smallest exact integer representation.
 *
 * Zero-weight slots still count as references. Three's shader fetches all four
 * matrices before multiplying by the weights, so preserving those references
 * keeps the shader's inputs and arithmetic exactly unchanged.
 */
export function optimizeSkinGpuLayout(root: THREE.Object3D): SkinGpuLayoutStats {
  const stats: SkinGpuLayoutStats = {
    skeletons: 0,
    paletteMatricesBefore: 0,
    paletteMatricesAfter: 0,
    jointBytesBefore: 0,
    jointBytesAfter: 0,
  };
  const meshesBySkeleton = new Map<THREE.Skeleton, THREE.SkinnedMesh[]>();
  root.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.skeleton) return;
    const meshes = meshesBySkeleton.get(mesh.skeleton);
    if (meshes) meshes.push(mesh);
    else meshesBySkeleton.set(mesh.skeleton, [mesh]);
  });

  for (const [skeleton, meshes] of meshesBySkeleton) {
    stats.skeletons++;
    stats.paletteMatricesBefore += skeleton.bones.length;

    // This optimization runs on the per-URL source clone before rendering.
    // Refuse a late mutation rather than replace an already allocated GPU
    // texture or break WebGLObjects' frame-local skeleton update cache.
    if (skeleton.boneTexture !== null) {
      stats.paletteMatricesAfter += skeleton.bones.length;
      continue;
    }

    const references = referencedBones(meshes, skeleton.bones.length);
    if (!references || references.ordered.length > 0x10000) {
      stats.paletteMatricesAfter += skeleton.bones.length;
      continue;
    }

    const compactPalette = references.ordered.length < skeleton.bones.length;
    const optimizedGeometry = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
    const countedGeometry = new Set<THREE.BufferGeometry>();
    for (const mesh of meshes) {
      const sourceGeometry = mesh.geometry;
      const sourceIndex = sourceGeometry.getAttribute('skinIndex') as SkinIndexAttribute;
      const sourceBytes = attributeBytes(sourceIndex);
      const targetBytes =
        sourceIndex.count *
        sourceIndex.itemSize *
        (references.ordered.length <= 0x100
          ? Uint8Array.BYTES_PER_ELEMENT
          : Uint16Array.BYTES_PER_ELEMENT);
      if (!countedGeometry.has(sourceGeometry)) {
        countedGeometry.add(sourceGeometry);
        stats.jointBytesBefore += sourceBytes;
        stats.jointBytesAfter += targetBytes;
      }

      const narrowIndex = targetBytes < sourceBytes;
      if (!compactPalette && !narrowIndex) continue;
      let geometry = optimizedGeometry.get(sourceGeometry);
      if (!geometry) {
        geometry = sourceGeometry.clone();
        geometry.setAttribute(
          'skinIndex',
          remappedSkinIndex(sourceIndex, references.remap, references.ordered.length),
        );
        optimizedGeometry.set(sourceGeometry, geometry);
      }
      mesh.geometry = geometry;
    }

    if (compactPalette) {
      const compactSkeleton = new THREE.Skeleton(
        references.ordered.map((index) => skeleton.bones[index]),
        references.ordered.map((index) => skeleton.boneInverses[index]),
      );
      for (const mesh of meshes) mesh.skeleton = compactSkeleton;
    }
    stats.paletteMatricesAfter += references.ordered.length;
  }
  return stats;
}

function stockBoneTextureSize(boneCount: number): number {
  let size = Math.sqrt(boneCount * 4);
  size = Math.ceil(size / 4) * 4;
  size = Math.max(size, 4);
  return size;
}

/**
 * Keep Three's RGBA32F palette width and crop its unused bottom rows. Keeping
 * the stock width avoids pathological row-pitch padding on tiled GPUs, while
 * Three r165's textureSize()-driven skinning chunk accepts the shorter height.
 */
export function configureTightBoneTextures(root: THREE.Object3D): BoneTextureLayoutStats {
  const stats: BoneTextureLayoutStats = {
    skeletons: 0,
    texelsBefore: 0,
    texelsAfter: 0,
  };
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh && mesh.skeleton) skeletons.add(mesh.skeleton);
  });

  for (const skeleton of skeletons) {
    stats.skeletons++;
    const existing = skeleton.boneTexture;
    if (existing !== null) {
      const texels = existing.image.width * existing.image.height;
      stats.texelsBefore += texels;
      stats.texelsAfter += texels;
      continue;
    }
    const boneCount = skeleton.bones.length;
    if (boneCount === 0) continue;
    const width = stockBoneTextureSize(boneCount);
    const height = Math.ceil((boneCount * 4) / width);
    stats.texelsBefore += width * width;
    stats.texelsAfter += width * height;
    const boneMatrices = new Float32Array(width * height * 4);
    boneMatrices.set(skeleton.boneMatrices);
    const texture = new THREE.DataTexture(
      boneMatrices,
      width,
      height,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    texture.needsUpdate = true;
    skeleton.boneMatrices = boneMatrices;
    skeleton.boneTexture = texture;
  }
  return stats;
}
