// The far-LOD / shadow-proxy bake must survive a model whose parts carry
// DIFFERENT uv array types: rig_merge dequantizes the parts it merges to
// float32, while unmerged parts and non-skinned attachments keep their
// meshopt/KHR_mesh_quantization normalized-integer uvs. Mixing the two in one
// mergeGeometries call makes three log "BufferAttribute.array must be of
// consistent array types" and return null, silently dropping the whole proxy
// (the low-gfx screenshot-tour console errors on every character prepare).
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bakeStaticPose, meshChainVisible } from '../src/render/characters/static_pose_bake';

function triangleGeo(uv?: THREE.BufferAttribute): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
  );
  if (uv) geo.setAttribute('uv', uv);
  return geo;
}

function floatUvMesh(): THREE.Mesh {
  const uv = new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2);
  return new THREE.Mesh(triangleGeo(uv), new THREE.MeshBasicMaterial());
}

/** A part as GLTFLoader delivers it from a KHR_mesh_quantization GLB: the uv
 *  attribute is a NORMALIZED integer array, denormalized only through getters. */
function quantizedUvMesh(): THREE.Mesh {
  const uv = new THREE.BufferAttribute(new Uint16Array([0, 0, 65535, 0, 0, 65535]), 2, true);
  return new THREE.Mesh(triangleGeo(uv), new THREE.MeshBasicMaterial());
}

function bakeRoot(...meshes: THREE.Mesh[]): ReturnType<typeof bakeStaticPose> {
  const root = new THREE.Group();
  for (const m of meshes) root.add(m);
  root.updateMatrixWorld(true);
  return bakeStaticPose(root, new THREE.Matrix4());
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('bakeStaticPose uv consistency', () => {
  it('merges parts whose uvs mix float32 and quantized integer arrays', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { geo, mats } = bakeRoot(floatUvMesh(), quantizedUvMesh());

    expect(geo).not.toBeNull();
    expect(mats).toHaveLength(2);
    expect(errors).not.toHaveBeenCalled();

    // the merged uv is plain float32 with the quantized part DENORMALIZED
    const uv = geo?.getAttribute('uv') as THREE.BufferAttribute;
    expect(uv.array).toBeInstanceOf(Float32Array);
    expect(uv.normalized).toBe(false);
    expect(uv.count).toBe(6);
    // quantized vertex 1 stored 65535 in u -> exactly 1.0 after denormalize
    expect(uv.getX(4)).toBeCloseTo(1, 5);
    expect(uv.getY(5)).toBeCloseTo(1, 5);
    // float part carried through untouched
    expect(uv.getX(1)).toBe(1);
    expect(uv.getY(2)).toBe(1);
  });

  it('keeps per-part material groups aligned across the mixed merge', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { geo } = bakeRoot(floatUvMesh(), quantizedUvMesh());
    expect(geo?.groups).toHaveLength(2);
    expect(geo?.groups[0]).toMatchObject({ start: 0, count: 3, materialIndex: 0 });
    expect(geo?.groups[1]).toMatchObject({ start: 3, count: 3, materialIndex: 1 });
  });

  it('gives a lone quantized mesh one full-range group and float32 uvs', () => {
    const { geo, mats } = bakeRoot(quantizedUvMesh());
    expect(mats).toHaveLength(1);
    expect(geo).not.toBeNull();
    const baked = geo as THREE.BufferGeometry;
    expect(baked.groups).toHaveLength(1);
    expect(baked.groups[0]).toMatchObject({ start: 0, count: 3, materialIndex: 0 });
    expect((baked.getAttribute('uv') as THREE.BufferAttribute).array).toBeInstanceOf(Float32Array);
  });

  it('still drops uvs entirely when any part has none', () => {
    const bare = new THREE.Mesh(triangleGeo(), new THREE.MeshBasicMaterial());
    const { geo } = bakeRoot(quantizedUvMesh(), bare);
    expect(geo).not.toBeNull();
    expect(geo?.getAttribute('uv')).toBeUndefined();
  });

  it('skips meshes hidden anywhere along the chain', () => {
    const root = new THREE.Group();
    const holder = new THREE.Group();
    holder.visible = false;
    const hidden = floatUvMesh();
    holder.add(hidden);
    root.add(holder);
    const shown = floatUvMesh();
    root.add(shown);
    root.updateMatrixWorld(true);

    expect(meshChainVisible(hidden, root)).toBe(false);
    expect(meshChainVisible(shown, root)).toBe(true);
    const { mats } = bakeStaticPose(root, new THREE.Matrix4());
    expect(mats).toHaveLength(1);
  });
});
