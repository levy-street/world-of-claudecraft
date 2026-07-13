// bakeStaticPose builds the per-key far-LOD / shadow-proxy geometry by merging
// every visible mesh of a posed model clone. The shipped character GLBs are
// meshopt-quantized, and assembleModel's rig merge (rig_merge.ts) rebakes the
// mergeable skinned parts to float32 while non-skinned accessories keep their
// quantized attributes. Merging that mix used to fail inside THREE's
// mergeGeometries ("BufferAttribute.array must be of consistent array types"),
// flooding the console on world entry and silently dropping the far LOD and
// shadow proxy (idleGeo: null) for every affected rig.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { bakeStaticPose, meshChainVisible } from '../src/render/characters/static_pose';

function meshWithUv(uv: THREE.BufferAttribute, x = 0): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
  );
  geo.setAttribute('uv', uv);
  geo.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2]), 1));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  mesh.position.x = x;
  return mesh;
}

function floatUv(): THREE.BufferAttribute {
  return new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2);
}

/** Quantized-GLB style uv: normalized Uint16, as meshopt/KHR_mesh_quantization ships. */
function quantizedUv(): THREE.BufferAttribute {
  return new THREE.BufferAttribute(new Uint16Array([0, 0, 65535, 0, 0, 65535]), 2, true);
}

function bakeRoot(...meshes: THREE.Mesh[]): {
  geo: THREE.BufferGeometry | null;
  mats: THREE.Material[];
} {
  const root = new THREE.Group();
  for (const m of meshes) root.add(m);
  root.updateMatrixWorld(true);
  return bakeStaticPose(root, new THREE.Matrix4());
}

function mustGeo(geo: THREE.BufferGeometry | null): THREE.BufferGeometry {
  expect(geo).not.toBeNull();
  return geo as THREE.BufferGeometry;
}

describe('bakeStaticPose', () => {
  it('merges a float32-uv part with a quantized-uv part (the rig + accessory mix)', () => {
    const { geo, mats } = bakeRoot(meshWithUv(floatUv()), meshWithUv(quantizedUv(), 2));
    expect(mats).toHaveLength(2);
    const uv = mustGeo(geo).getAttribute('uv') as THREE.BufferAttribute;
    expect(uv.count).toBe(6);
    expect(uv.array).toBeInstanceOf(Float32Array);
    expect(uv.normalized).toBe(false);
  });

  it('denormalizes quantized uvs into plain [0,1] floats', () => {
    const { geo } = bakeRoot(meshWithUv(quantizedUv()));
    const uv = mustGeo(geo).getAttribute('uv') as THREE.BufferAttribute;
    expect(uv.array).toBeInstanceOf(Float32Array);
    expect(uv.getX(1)).toBeCloseTo(1, 5);
    expect(uv.getY(2)).toBeCloseTo(1, 5);
    expect(uv.getX(0)).toBe(0);
  });

  it('keeps merged far-LOD groups aligned with the per-mesh material list', () => {
    const { geo, mats } = bakeRoot(meshWithUv(floatUv()), meshWithUv(quantizedUv(), 2));
    const groups = mustGeo(geo).groups;
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.materialIndex)).toEqual([0, 1]);
    expect(mats).toHaveLength(2);
  });

  it('drops uvs entirely when one part has none (presence must agree)', () => {
    const bare = meshWithUv(floatUv(), 4);
    bare.geometry.deleteAttribute('uv');
    const { geo } = bakeRoot(meshWithUv(quantizedUv()), bare);
    expect(mustGeo(geo).getAttribute('uv')).toBeUndefined();
  });

  it('bakes world transforms into positions', () => {
    const { geo } = bakeRoot(meshWithUv(floatUv(), 2));
    const pos = mustGeo(geo).getAttribute('position') as THREE.BufferAttribute;
    expect(pos.getX(0)).toBeCloseTo(2, 6);
  });

  it('returns null for a root with no meshes', () => {
    expect(bakeRoot().geo).toBeNull();
  });
});

describe('meshChainVisible', () => {
  it('is false when any ancestor up to the root is hidden', () => {
    const root = new THREE.Group();
    const mid = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    root.add(mid);
    mid.add(mesh);
    expect(meshChainVisible(mesh, root)).toBe(true);
    mid.visible = false;
    expect(meshChainVisible(mesh, root)).toBe(false);
  });
});
