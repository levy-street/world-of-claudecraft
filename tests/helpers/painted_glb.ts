// Parsing and checking the shipped PAINTED models (the Eastbrook ferry's siblings: the
// harbours, the wharf and the route marker, whose wood, fittings and stone wear KTX2 maps
// laid by scripts/assets/eastbrook_ferry/paintlib.py) in Node tests.
import { readFileSync } from 'node:fs';
import type { Document } from '@gltf-transform/core';
import { MeshoptDecoder } from 'meshoptimizer';
import type * as THREE from 'three';
import { CompressedTexture, RGBA_S3TC_DXT1_Format } from 'three';
import { type GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { expect } from 'vitest';

/**
 * A stand-in for three's KTX2 loader (Node has no transcoder): every painted map a model
 * carries (KHR_texture_basisu) arrives as a small compressed texture, named by the loader
 * after its image, so a painter's handling of the maps is the real one.
 */
const stubKtx2Loader = {
  load(_url: string, onLoad: (texture: THREE.Texture) => void): void {
    const level = { data: new Uint8Array(8), width: 4, height: 4 };
    onLoad(new CompressedTexture([level], 4, 4, RGBA_S3TC_DXT1_Format));
  },
};

/** A shipped GLB as three's GLTFLoader parses it, its KTX2 maps stubbed. */
export async function parsePaintedGlb(file: string): Promise<GLTF> {
  await MeshoptDecoder.ready;
  const bytes = readFileSync(file);
  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  // the loader reads an embedded image through `self.URL` (a browser global; Node has URL)
  const scope = globalThis as { self?: unknown };
  const hadSelf = 'self' in scope;
  if (!hadSelf) scope.self = globalThis;
  const loader = new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .setKTX2Loader(stubKtx2Loader as unknown as Parameters<GLTFLoader['setKTX2Loader']>[0]);
  try {
    return await new Promise<GLTF>((resolve, reject) => loader.parse(ab, '', resolve, reject));
  } finally {
    if (!hadSelf) delete scope.self;
  }
}

/** What a painted model's build spec says of its maps (its build.mjs asset record). */
export interface PaintedAssetSpec {
  maps: Readonly<Record<string, string>>;
  maxMapSize: number;
  mapSizes: Readonly<Record<string, number>>;
  inputs: readonly string[];
}

/**
 * The shipped document wears exactly the maps its build spec names: one KTX2 base-colour
 * map on each painted material and no other texture, every map square, a power of two and
 * no larger than its limit, a texture coordinate on every painted primitive and none on
 * the rest, the vertex colour still the only tint, and the maps and the painted layer in
 * the source fingerprint. `maxMapBytes` bounds each map's weight.
 */
export function expectPaintedMaps(
  doc: Document,
  asset: PaintedAssetSpec,
  maxMapBytes: number,
): void {
  const root = doc.getRoot();
  const worn = [...new Set(Object.values(asset.maps))].sort();
  expect(
    root
      .listTextures()
      .map((t) => t.getName())
      .sort(),
  ).toEqual(worn);
  for (const texture of root.listTextures()) {
    const name = texture.getName();
    expect(texture.getMimeType(), name).toBe('image/ktx2');
    const size = texture.getSize();
    if (!size) throw new Error(`${name} has no readable size`);
    expect(size[0], name).toBe(size[1]);
    expect([256, 512, 1024], name).toContain(size[0]);
    expect(size[0], name).toBeLessThanOrEqual(asset.mapSizes[name] ?? asset.maxMapSize);
    expect(texture.getImage()?.byteLength ?? Infinity, name).toBeLessThan(maxMapBytes);
  }
  for (const material of root.listMaterials()) {
    const name = material.getName();
    expect(material.getBaseColorTexture()?.getName() ?? null, name).toBe(asset.maps[name] ?? null);
    expect(material.getNormalTexture(), name).toBeNull();
    expect(material.getMetallicRoughnessTexture(), name).toBeNull();
    expect(material.getOcclusionTexture(), name).toBeNull();
    expect(material.getEmissiveTexture(), name).toBeNull();
    // the vertex colour is the tint: the material itself stays white
    expect(material.getBaseColorFactor(), name).toEqual([1, 1, 1, 1]);
  }
  let painted = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() ?? '';
      const wantsUv = name in asset.maps;
      expect(prim.getAttribute('TEXCOORD_0') !== null, `${mesh.getName()}/${name}`).toBe(wantsUv);
      expect(prim.getAttribute('COLOR_0'), `${mesh.getName()}/${name}`).not.toBeNull();
      if (wantsUv) painted++;
    }
  }
  expect(painted).toBeGreaterThan(0);
  // KTX2 is required, so a loader without a transcoder fails at parse, never draws black
  expect(root.listExtensionsRequired().map((e) => e.extensionName)).toContain('KHR_texture_basisu');
  // the painted layer and every map it wears are part of what the fingerprint covers
  expect(asset.inputs).toContain('scripts/assets/eastbrook_ferry/paintlib.py');
  expect(asset.inputs).toContain('scripts/assets/eastbrook_ferry/shiplib.py');
  for (const map of worn) {
    expect(asset.inputs, map).toContain(`scripts/assets/eastbrook_ferry/tex/${map}.png`);
  }
}

/**
 * Every mesh under `root` (a built view) that draws a map draws it properly: the map sRGB,
 * a texture coordinate on every vertex, the model's own maps under the vertex-colour tint.
 * Returns the distinct maps drawn.
 */
export function expectPaintedMeshes(root: THREE.Object3D, srgb: string): Set<THREE.Texture> {
  const maps = new Set<THREE.Texture>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const m = material as THREE.MeshStandardMaterial;
      const uv = mesh.geometry.getAttribute('uv');
      if (!m.map) continue;
      maps.add(m.map);
      expect(m.map.colorSpace, mesh.name).toBe(srgb);
      expect(uv, mesh.name).toBeDefined();
      expect(uv.count, mesh.name).toBe(mesh.geometry.getAttribute('position').count);
      // a model's own map (KTX2, so compressed) is tinted by the vertex colour; a canvas a
      // painter draws itself (a route marker's destination plate) is not
      if ((m.map as THREE.CompressedTexture).isCompressedTexture) {
        expect(m.vertexColors, mesh.name).toBe(true);
      }
    }
  });
  return maps;
}
