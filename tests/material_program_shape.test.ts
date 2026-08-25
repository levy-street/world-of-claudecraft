import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  applyMaterials,
  resetCharacterProfileCaches,
  tintedFarMaterials,
} from '../src/render/characters/assets';
import type { VisualDef } from '../src/render/characters/manifest';
import {
  meshProgramShape,
  meshProgramShapeKey,
  programShapeKey,
} from '../src/render/characters/material_program_shape_core';
import {
  attachSharedDepthMaterials,
  needsOwnDepthMaterial,
  shadowDepthMaterialInternalsForTest,
  sharedDepthMaterial,
} from '../src/render/characters/shadow_depth_materials';
import { gfxInternalsForTest } from '../src/render/gfx';

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: vi.fn(() => new Promise(() => undefined)),
  loadKtx2Texture: vi.fn(() => new Promise(() => undefined)),
  loadTexture: vi.fn(() => new Promise(() => undefined)),
}));

vi.mock('../src/render/assets/preload', () => ({
  registerPreload: vi.fn(),
  registerDeferredPreload: vi.fn((start: () => unknown) => start()),
}));

const NONE = {
  skinned: false,
  instanced: false,
  instanceColor: false,
  morphTexture: false,
  morphPosition: false,
  morphNormal: false,
  morphColor: false,
  morphCount: 0,
  vertexTangents: false,
  vertexAlphas: false,
};

/** A geometry carrying `count` morph position targets (plus, optionally, the
 *  normal/color lists three checks independently). */
function morphGeometry(
  count: number,
  extra: { normals?: number; colors?: number } = {},
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  const attrs = () =>
    Array.from({ length: count }, () => new THREE.BufferAttribute(new Float32Array(9), 3));
  if (count > 0) geo.morphAttributes.position = attrs();
  if (extra.normals !== undefined) {
    geo.morphAttributes.normal = Array.from(
      { length: extra.normals },
      () => new THREE.BufferAttribute(new Float32Array(9), 3),
    );
  }
  if (extra.colors !== undefined) {
    geo.morphAttributes.color = Array.from(
      { length: extra.colors },
      () => new THREE.BufferAttribute(new Float32Array(9), 3),
    );
  }
  return geo;
}

function skinnedMesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.SkinnedMesh {
  const mesh = new THREE.SkinnedMesh(geo, mat);
  // A SkinnedMesh with no skeleton never draws here; the shape only reads
  // isSkinnedMesh, and binding one would need a bone tree per case.
  return mesh;
}

describe('program shape keys', () => {
  it('separates skinned, instanced, instance textures, morph presence, morph count and vertex attributes', () => {
    const keys = [
      programShapeKey(NONE),
      programShapeKey({ ...NONE, skinned: true }),
      programShapeKey({ ...NONE, instanced: true }),
      programShapeKey({ ...NONE, morphPosition: true, morphCount: 4 }),
      programShapeKey({ ...NONE, morphPosition: true, morphCount: 6 }),
      programShapeKey({ ...NONE, morphNormal: true, morphCount: 4 }),
      programShapeKey({ ...NONE, morphColor: true, morphCount: 4 }),
      programShapeKey({ ...NONE, morphPosition: true, morphNormal: true, morphCount: 4 }),
      programShapeKey({ ...NONE, instanced: true, instanceColor: true }),
      programShapeKey({ ...NONE, instanced: true, morphTexture: true }),
      programShapeKey({ ...NONE, vertexTangents: true }),
      programShapeKey({ ...NONE, vertexAlphas: true }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives equal shapes equal keys', () => {
    const a = { ...NONE, skinned: true, morphPosition: true, morphCount: 6 };
    const b = { ...NONE, skinned: true, morphPosition: true, morphCount: 6 };
    expect(programShapeKey(a)).toBe(programShapeKey(b));
  });

  it('reads a real SkinnedMesh the way three does', () => {
    const mat = new THREE.MeshStandardMaterial();
    const four = skinnedMesh(morphGeometry(4), mat);
    const six = skinnedMesh(morphGeometry(6), mat);
    const plain = new THREE.Mesh(morphGeometry(0), mat);

    expect(meshProgramShape(four)).toEqual({
      ...NONE,
      skinned: true,
      morphPosition: true,
      morphCount: 4,
    });
    expect(meshProgramShape(six).morphCount).toBe(6);
    expect(meshProgramShape(plain)).toEqual(NONE);
    expect(meshProgramShapeKey(four)).not.toBe(meshProgramShapeKey(six));
    expect(meshProgramShapeKey(four)).not.toBe(meshProgramShapeKey(plain));
    expect(meshProgramShapeKey(four)).toBe(meshProgramShapeKey(skinnedMesh(morphGeometry(4), mat)));
  });

  it('counts from three own attribute precedence and flags presence independently', () => {
    // three: morphAttribute = position ?? normal ?? color, count = its length.
    const positionsWin = skinnedMesh(
      morphGeometry(2, { normals: 5 }),
      new THREE.MeshStandardMaterial(),
    );
    expect(meshProgramShape(positionsWin)).toEqual({
      ...NONE,
      skinned: true,
      morphPosition: true,
      morphNormal: true,
      morphCount: 2,
    });
    const normalsOnly = skinnedMesh(
      morphGeometry(0, { normals: 5 }),
      new THREE.MeshStandardMaterial(),
    );
    expect(meshProgramShape(normalsOnly)).toEqual({
      ...NONE,
      skinned: true,
      morphNormal: true,
      morphCount: 5,
    });
    const colorsOnly = skinnedMesh(
      morphGeometry(0, { colors: 3 }),
      new THREE.MeshStandardMaterial(),
    );
    expect(meshProgramShape(colorsOnly)).toEqual({
      ...NONE,
      skinned: true,
      morphColor: true,
      morphCount: 3,
    });
  });
});

describe('applyMaterials splits shared materials by program shape', () => {
  const def = { tint: 0x336699, tintStrength: 0.4 } as VisualDef;

  function withStandardTier<T>(run: () => T): T {
    const restore = gfxInternalsForTest.overrideSettings({ standardMaterials: true });
    try {
      return run();
    } finally {
      restore();
    }
  }

  it('mounts different materials on two SkinnedMeshes with different morph counts', () => {
    withStandardTier(() => {
      const source = new THREE.MeshStandardMaterial({ color: 0xffffff });
      const four = skinnedMesh(morphGeometry(4), source);
      const six = skinnedMesh(morphGeometry(6), source);
      const root = new THREE.Group();
      root.add(four, six);

      applyMaterials(root, def, 0xffffff);

      expect(four.material).not.toBe(source);
      expect(six.material).not.toBe(source);
      expect(four.material).not.toBe(six.material);
    });
  });

  it('shares one material between meshes of the same shape and stays stable on re-apply', () => {
    withStandardTier(() => {
      const source = new THREE.MeshStandardMaterial({ color: 0xffffff });
      const a = skinnedMesh(morphGeometry(6), source);
      const b = skinnedMesh(morphGeometry(6), source);
      const root = new THREE.Group();
      root.add(a, b);

      applyMaterials(root, def, 0xffffff);
      expect(a.material).toBe(b.material);

      const mounted = a.material;
      applyMaterials(root, def, 0xffffff);
      expect(a.material).toBe(mounted);
      expect(b.material).toBe(mounted);
    });
  });

  it('gives a SkinnedMesh and a plain Mesh sharing a source different materials', () => {
    withStandardTier(() => {
      const source = new THREE.MeshStandardMaterial({ color: 0xffffff });
      const skinned = skinnedMesh(morphGeometry(0), source);
      const plain = new THREE.Mesh(morphGeometry(0), source);
      const root = new THREE.Group();
      root.add(skinned, plain);

      applyMaterials(root, def, 0xffffff);

      expect(skinned.material).not.toBe(plain.material);
    });
  });
});

describe('shared shadow depth materials', () => {
  const def = { tint: 0x336699, tintStrength: 0.4 } as VisualDef;

  function sweep(root: THREE.Object3D): void {
    const restore = gfxInternalsForTest.overrideSettings({ standardMaterials: true });
    try {
      applyMaterials(root, def, 0xffffff);
    } finally {
      restore();
    }
  }

  it('shares one depth material per shape, splits on shape, and never sets a distance material', () => {
    shadowDepthMaterialInternalsForTest.clear();
    const source = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const a = skinnedMesh(morphGeometry(6), source);
    const b = skinnedMesh(morphGeometry(6), source);
    const other = skinnedMesh(morphGeometry(4), source);
    const root = new THREE.Group();
    root.add(a, b, other);

    sweep(root);

    expect(a.customDepthMaterial).toBeDefined();
    expect(a.customDepthMaterial).toBe(b.customDepthMaterial);
    expect(other.customDepthMaterial).not.toBe(a.customDepthMaterial);
    // The sun is the only shadow caster: three's distance arm is never drawn,
    // so this module models no distance material at all.
    expect(a.customDistanceMaterial).toBeUndefined();
    expect(b.customDistanceMaterial).toBeUndefined();
    expect(other.customDistanceMaterial).toBeUndefined();
    expect(shadowDepthMaterialInternalsForTest).not.toHaveProperty('distanceMaterials');

    // Re-running the sweep re-assigns the same instances: no allocation.
    const before = shadowDepthMaterialInternalsForTest.depthMaterials.size;
    const depth = a.customDepthMaterial;
    sweep(root);
    expect(a.customDepthMaterial).toBe(depth);
    expect(shadowDepthMaterialInternalsForTest.depthMaterials.size).toBe(before);
  });

  it('constructs the depth material with three defaults', () => {
    shadowDepthMaterialInternalsForTest.clear();
    const source = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const mesh = skinnedMesh(morphGeometry(6), source);
    const root = new THREE.Group();
    root.add(mesh);
    sweep(root);

    const depth = mesh.customDepthMaterial as THREE.MeshDepthMaterial;
    // depthPacking is in three's program cache key: overriding it would link a
    // variant the shadow pass never draws (prewarm_depth_material.ts header).
    expect(depth.depthPacking).toBe(THREE.BasicDepthPacking);
    expect(depth.map).toBeNull();
    expect(depth.alphaMap).toBeNull();
    expect(depth.alphaTest).toBe(0);
    expect(depth.displacementMap).toBeNull();
    // The reference three builds itself: `new MeshDepthMaterial()`.
    const reference = new THREE.MeshDepthMaterial();
    expect(depth.side).toBe(reference.side);
    expect(depth.wireframe).toBe(reference.wireframe);
  });

  it('leaves an alpha-tested caster on three own per-material clone path', () => {
    shadowDepthMaterialInternalsForTest.clear();
    const source = new THREE.MeshStandardMaterial({ color: 0xffffff });
    source.map = new THREE.Texture();
    source.alphaTest = 0.5;
    const mesh = skinnedMesh(morphGeometry(6), source);
    const root = new THREE.Group();
    root.add(mesh);

    sweep(root);

    expect(mesh.customDepthMaterial).toBeUndefined();
    expect(shadowDepthMaterialInternalsForTest.depthMaterials.size).toBe(0);
  });

  it('leaves a plain (non-skinned) mesh alone', () => {
    shadowDepthMaterialInternalsForTest.clear();
    const source = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const mesh = new THREE.Mesh(morphGeometry(0), source);
    const root = new THREE.Group();
    root.add(mesh);

    sweep(root);

    expect(mesh.customDepthMaterial).toBeUndefined();
    expect(shadowDepthMaterialInternalsForTest.depthMaterials.size).toBe(0);
  });
});

function tinyDataTexture(): THREE.DataTexture {
  return new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
}

describe('needsOwnDepthMaterial per dimension', () => {
  it('returns true for each alpha-affecting dimension on its own', () => {
    const alphaToCoverage = new THREE.MeshStandardMaterial();
    alphaToCoverage.alphaToCoverage = true;
    expect(needsOwnDepthMaterial(alphaToCoverage)).toBe(true);

    const alphaMapTested = new THREE.MeshStandardMaterial();
    alphaMapTested.alphaMap = tinyDataTexture();
    alphaMapTested.alphaTest = 0.5;
    expect(needsOwnDepthMaterial(alphaMapTested)).toBe(true);

    const mapTested = new THREE.MeshStandardMaterial();
    mapTested.map = tinyDataTexture();
    mapTested.alphaTest = 0.5;
    expect(needsOwnDepthMaterial(mapTested)).toBe(true);

    const displaced = new THREE.MeshStandardMaterial();
    displaced.displacementMap = tinyDataTexture();
    displaced.displacementScale = 1;
    expect(needsOwnDepthMaterial(displaced)).toBe(true);

    const clipped = new THREE.MeshStandardMaterial();
    clipped.clipShadows = true;
    clipped.clippingPlanes = [new THREE.Plane()];
    expect(needsOwnDepthMaterial(clipped)).toBe(true);
  });

  it('returns true for a bare alphaTest with no map or alphaMap', () => {
    // getDepthMaterial writes the caster's alphaTest onto whatever material it
    // returns every draw, and three's alphaTest setter bumps material.version
    // on a 0 <-> >0 transition.
    const bare = new THREE.MeshStandardMaterial();
    bare.alphaTest = 0.5;
    expect(bare.map).toBeNull();
    expect(bare.alphaMap).toBeNull();
    expect(needsOwnDepthMaterial(bare)).toBe(true);
  });

  it('declines sharing for a skinned caster whose material is alpha-tested without a map', () => {
    shadowDepthMaterialInternalsForTest.clear();
    const source = new THREE.MeshStandardMaterial({ color: 0xffffff });
    source.alphaTest = 0.5;
    const mesh = skinnedMesh(morphGeometry(6), source);
    attachSharedDepthMaterials(mesh, source);
    expect(mesh.customDepthMaterial).toBeUndefined();
    expect(shadowDepthMaterialInternalsForTest.depthMaterials.size).toBe(0);
  });

  it('returns false when the other half of each pair is cleared', () => {
    const mapUntested = new THREE.MeshStandardMaterial();
    mapUntested.map = tinyDataTexture();
    mapUntested.alphaTest = 0;
    expect(needsOwnDepthMaterial(mapUntested)).toBe(false);

    const displacedZero = new THREE.MeshStandardMaterial();
    displacedZero.displacementMap = tinyDataTexture();
    displacedZero.displacementScale = 0;
    expect(needsOwnDepthMaterial(displacedZero)).toBe(false);

    const clipShadowsNoPlanes = new THREE.MeshStandardMaterial();
    clipShadowsNoPlanes.clipShadows = true;
    clipShadowsNoPlanes.clippingPlanes = [];
    expect(needsOwnDepthMaterial(clipShadowsNoPlanes)).toBe(false);

    const alphaMapUntested = new THREE.MeshStandardMaterial();
    alphaMapUntested.alphaMap = tinyDataTexture();
    alphaMapUntested.alphaTest = 0;
    expect(needsOwnDepthMaterial(alphaMapUntested)).toBe(false);
  });
});

describe('attachSharedDepthMaterials resets on a shape that stops being shareable', () => {
  const def = { tint: 0x336699, tintStrength: 0.4 } as VisualDef;

  function sweep(root: THREE.Object3D): void {
    const restore = gfxInternalsForTest.overrideSettings({ standardMaterials: true });
    try {
      applyMaterials(root, def, 0xffffff);
    } finally {
      restore();
    }
  }

  it('clears customDepthMaterial once the mounted material becomes alpha-tested', () => {
    shadowDepthMaterialInternalsForTest.clear();
    const source = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const mesh = skinnedMesh(morphGeometry(6), source);
    const root = new THREE.Group();
    root.add(mesh);

    sweep(root);
    expect(mesh.customDepthMaterial).toBeDefined();

    const mounted = mesh.material as THREE.MeshStandardMaterial;
    mounted.map = tinyDataTexture();
    mounted.alphaTest = 0.5;
    attachSharedDepthMaterials(mesh, mounted);

    expect(mesh.customDepthMaterial).toBeUndefined();
  });

  it('re-evaluates at the effect mount, not only at applyMaterials', async () => {
    // applyMaterials is not the last word on what a caster draws:
    // CharacterVisual.commitVisualMaterials reassigns mesh.material afterwards
    // for ghost, stealth, ascended and rune-tint states, and the weapon-skin
    // isolation sweep clones again. If the shared depth material were chosen
    // only from the PRE-effect material, a caster mounting an alpha-tested
    // overlay would keep a shared depth material that three then rewrites
    // alphaTest onto every draw, bumping its version and recreating the very
    // per-draw rebuild this module removes, on a material shared by every
    // caster of that shape.
    const { CharacterVisual } = await import('../src/render/characters/visual');
    shadowDepthMaterialInternalsForTest.clear();
    const source = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const mesh = skinnedMesh(morphGeometry(6), source);
    const root = new THREE.Group();
    root.add(mesh);

    sweep(root);
    const shared = mesh.customDepthMaterial;
    expect(shared).toBeDefined();

    // The state an effect leaves behind: an alpha-tested overlay mounted over
    // the same mesh, which is what commitVisualMaterials assigns.
    const overlay = new THREE.MeshStandardMaterial({ color: 0xffffff });
    overlay.map = tinyDataTexture();
    overlay.alphaTest = 0.5;
    const host = {
      originalMaterials: new Map<THREE.Mesh, THREE.Material>([[mesh, source]]),
      farMesh: null,
      farMaterials: null,
      effectMaterial: () => overlay,
    };
    (
      CharacterVisual.prototype as unknown as {
        commitVisualMaterials: (this: unknown) => void;
      }
    ).commitVisualMaterials.call(host);

    expect(mesh.material).toBe(overlay);
    expect(mesh.customDepthMaterial).toBeUndefined();
  });

  it('re-attaches a shared depth material when the effect mount is alpha-free', () => {
    // The other direction: an ordinary effect (a tint clone) must NOT cost the
    // caster its shared depth material, or every ghosted or dyed rig would
    // silently fall back onto three's one flipping global.
    shadowDepthMaterialInternalsForTest.clear();
    const source = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const mesh = skinnedMesh(morphGeometry(6), source);
    const root = new THREE.Group();
    root.add(mesh);

    sweep(root);
    const shared = mesh.customDepthMaterial;
    expect(shared).toBeDefined();

    // Cleared FIRST, or the assertion below would hold with the function body
    // emptied: sweep() already left the shared material mounted, so re-reading
    // it would prove nothing about the re-attach.
    mesh.customDepthMaterial = undefined;
    const tinted = new THREE.MeshStandardMaterial({ color: 0x223344 });
    mesh.material = tinted;
    attachSharedDepthMaterials(mesh, tinted);

    // Back, and the SAME cached instance: the shape key is object-side, so an
    // ordinary effect clone must not mint a second material for one shape.
    expect(mesh.customDepthMaterial).toBe(shared);
  });
});

describe('instanced meshes', () => {
  it('reads a real InstancedMesh as instanced with a key distinct from a plain Mesh', () => {
    const geo = morphGeometry(0);
    const mat = new THREE.MeshStandardMaterial();
    const instanced = new THREE.InstancedMesh(geo, mat, 2);
    const plain = new THREE.Mesh(geo, mat);

    expect(meshProgramShape(instanced).instanced).toBe(true);
    expect(meshProgramShapeKey(instanced)).not.toBe(meshProgramShapeKey(plain));
  });

  it('separates an InstancedMesh carrying an instanceColor from one without', () => {
    const mat = new THREE.MeshStandardMaterial();
    const plainInstanced = new THREE.InstancedMesh(morphGeometry(0), mat, 2);
    const colored = new THREE.InstancedMesh(morphGeometry(0), mat, 2);
    colored.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(6), 3);

    expect(meshProgramShape(plainInstanced).instanceColor).toBe(false);
    expect(meshProgramShape(colored).instanceColor).toBe(true);
    expect(meshProgramShapeKey(colored)).not.toBe(meshProgramShapeKey(plainInstanced));
  });

  it('ignores an instanceColor on a non-instanced mesh, the way three does', () => {
    const mat = new THREE.MeshStandardMaterial();
    const plain = new THREE.Mesh(morphGeometry(0), mat) as THREE.Mesh & {
      instanceColor?: unknown;
    };
    plain.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(6), 3);
    expect(meshProgramShape(plain).instanceColor).toBe(false);
  });

  it('separates an InstancedMesh carrying a morphTexture from one without', () => {
    const mat = new THREE.MeshStandardMaterial();
    const plainInstanced = new THREE.InstancedMesh(morphGeometry(0), mat, 2);
    const morphed = new THREE.InstancedMesh(morphGeometry(0), mat, 2);
    morphed.morphTexture = new THREE.DataTexture(new Float32Array(4), 1, 1);

    expect(meshProgramShape(morphed).morphTexture).toBe(true);
    expect(meshProgramShapeKey(morphed)).not.toBe(meshProgramShapeKey(plainInstanced));
  });
});

describe('geometry vertex attributes', () => {
  it('separates a geometry with a tangent attribute from one without', () => {
    const mat = new THREE.MeshStandardMaterial();
    const bare = morphGeometry(0);
    const tangented = morphGeometry(0);
    tangented.setAttribute('tangent', new THREE.BufferAttribute(new Float32Array(12), 4));

    expect(meshProgramShape(skinnedMesh(tangented, mat)).vertexTangents).toBe(true);
    expect(meshProgramShape(skinnedMesh(bare, mat)).vertexTangents).toBe(false);
    expect(meshProgramShapeKey(skinnedMesh(tangented, mat))).not.toBe(
      meshProgramShapeKey(skinnedMesh(bare, mat)),
    );
  });

  it('separates an itemSize-4 color attribute from itemSize 3 and from none', () => {
    const mat = new THREE.MeshStandardMaterial();
    const none = morphGeometry(0);
    const rgb = morphGeometry(0);
    rgb.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9), 3));
    const rgba = morphGeometry(0);
    rgba.setAttribute('color', new THREE.BufferAttribute(new Float32Array(12), 4));

    expect(meshProgramShape(skinnedMesh(rgba, mat)).vertexAlphas).toBe(true);
    expect(meshProgramShape(skinnedMesh(rgb, mat)).vertexAlphas).toBe(false);
    expect(meshProgramShape(skinnedMesh(none, mat)).vertexAlphas).toBe(false);
    const keys = [
      meshProgramShapeKey(skinnedMesh(rgba, mat)),
      meshProgramShapeKey(skinnedMesh(rgb, mat)),
    ];
    expect(new Set(keys).size).toBe(2);
    expect(meshProgramShapeKey(skinnedMesh(rgb, mat))).toBe(
      meshProgramShapeKey(skinnedMesh(none, mat)),
    );
  });
});

describe('applyMaterials with array materials', () => {
  const def = { tint: 0x336699, tintStrength: 0.4 } as VisualDef;

  function withStandardTier<T>(run: () => T): T {
    const restore = gfxInternalsForTest.overrideSettings({ standardMaterials: true });
    try {
      return run();
    } finally {
      restore();
    }
  }

  it('mounts different array entries for different morph counts and shares them when equal', () => {
    withStandardTier(() => {
      const a1 = new THREE.MeshStandardMaterial({ color: 0xffffff });
      const a2 = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
      const four = new THREE.SkinnedMesh(morphGeometry(4), [a1, a2]);
      const six = new THREE.SkinnedMesh(morphGeometry(6), [a1, a2]);
      const rootDiff = new THREE.Group();
      rootDiff.add(four, six);

      applyMaterials(rootDiff, def, 0xffffff);
      const fourMats = four.material as THREE.Material[];
      const sixMats = six.material as THREE.Material[];
      expect(fourMats[0]).not.toBe(sixMats[0]);
      expect(fourMats[1]).not.toBe(sixMats[1]);

      const b1 = new THREE.MeshStandardMaterial({ color: 0xffffff });
      const b2 = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
      const p = new THREE.SkinnedMesh(morphGeometry(6), [b1, b2]);
      const q = new THREE.SkinnedMesh(morphGeometry(6), [b1, b2]);
      const rootSame = new THREE.Group();
      rootSame.add(p, q);

      applyMaterials(rootSame, def, 0xffffff);
      const pMats = p.material as THREE.Material[];
      const qMats = q.material as THREE.Material[];
      expect(pMats[0]).toBe(qMats[0]);
      expect(pMats[1]).toBe(qMats[1]);
    });
  });

  it('declines depth-material sharing when any array entry needs its own, but shares an all-clean array', () => {
    shadowDepthMaterialInternalsForTest.clear();
    const clean = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const alpha = new THREE.MeshStandardMaterial({ color: 0xffffff });
    alpha.map = tinyDataTexture();
    alpha.alphaTest = 0.5;
    const mixed = new THREE.SkinnedMesh(morphGeometry(6), [clean, alpha]);
    attachSharedDepthMaterials(mixed, mixed.material as THREE.Material[]);
    expect(mixed.customDepthMaterial).toBeUndefined();
    expect(shadowDepthMaterialInternalsForTest.depthMaterials.size).toBe(0);

    const clean2 = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const clean3 = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const allClean = new THREE.SkinnedMesh(morphGeometry(6), [clean2, clean3]);
    attachSharedDepthMaterials(allClean, allClean.material as THREE.Material[]);
    expect(allClean.customDepthMaterial).toBeDefined();
  });
});

describe('programShapeKey literal pin', () => {
  // Format: one fixed slot per flag in declaration order, `s i C M p n c t a`,
  // each set flag's letter or `-`, then the morph count.
  it('pins the exact key format for a shaped and an unshaped example', () => {
    expect(programShapeKey({ ...NONE, skinned: true, morphPosition: true, morphCount: 6 })).toBe(
      's---p----6',
    );
    expect(programShapeKey(NONE)).toBe('---------0');
    expect(
      programShapeKey({
        ...NONE,
        skinned: true,
        instanced: true,
        instanceColor: true,
        morphTexture: true,
        morphPosition: true,
        morphNormal: true,
        morphColor: true,
        morphCount: 4,
        vertexTangents: true,
        vertexAlphas: true,
      }),
    ).toBe('siCMpncta4');
  });
});

describe('tintedFarMaterials caching', () => {
  const def = { tint: 0x336699, tintStrength: 0.4 } as VisualDef;

  it('keeps a single shape-free entry distinct from applyMaterials own shaped mount', () => {
    const restore = gfxInternalsForTest.overrideSettings({ standardMaterials: true });
    try {
      const source = new THREE.MeshStandardMaterial({ color: 0xffffff });
      const first = tintedFarMaterials(def, 0xffffff, [source], [true]);
      const second = tintedFarMaterials(def, 0xffffff, [source], [true]);
      expect(first[0]).toBe(second[0]);

      const mesh = skinnedMesh(morphGeometry(4), source);
      const root = new THREE.Group();
      root.add(mesh);
      applyMaterials(root, def, 0xffffff);

      expect(mesh.material).not.toBe(first[0]);
    } finally {
      restore();
    }
  });
});

describe('the shared depth materials answer to the graphics-profile reset', () => {
  it('resetCharacterProfileCaches drops and disposes them', () => {
    shadowDepthMaterialInternalsForTest.clear();
    const mat = sharedDepthMaterial('skinned|morph:6');
    let disposed = false;
    mat.addEventListener('dispose', () => {
      disposed = true;
    });
    expect(shadowDepthMaterialInternalsForTest.depthMaterials.size).toBe(1);

    resetCharacterProfileCaches();

    // Without this hook the map keeps a retired profile's materials, and their
    // programs, for the rest of the session (the tinted cache has one).
    expect(shadowDepthMaterialInternalsForTest.depthMaterials.size).toBe(0);
    expect(disposed).toBe(true);
    // A caster mounted after the rebuild gets a fresh material, not the
    // disposed one.
    expect(sharedDepthMaterial('skinned|morph:6')).not.toBe(mat);
  });
});
