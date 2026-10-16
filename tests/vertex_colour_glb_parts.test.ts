import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { activateGfxProfile, GFX, getActiveGfxProfile } from '../src/render/gfx';
import {
  addToBucket,
  mergeVertexColourBuckets,
  vertexColourMaterialConverter,
  vertexColourMeshGeometry,
  vertexColourScaleOf,
} from '../src/render/vertex_colour_glb_parts';

// The shared converter of the Blender-built, vertex-coloured props (src/render/
// vertex_colour_glb_parts.ts): a texture-free GLB material converts to the surface family's
// plain vertex-coloured material exactly as before, and a painted one (the Mirefen tavern's
// painted town maps) keeps its map, its normal map (at the loader's normal scale) where the
// tier draws standard materials, and its geometry's UVs, so the vertex colour is the tint over
// the paint, multiplied back above the headroom its extras name.

const originalProfile = getActiveGfxProfile();

function withStandard(standard: boolean): void {
  activateGfxProfile({ ...originalProfile, settings: { ...GFX, standardMaterials: standard } });
}

afterEach(() => activateGfxProfile(originalProfile));

/** The headroom factor a painted material's extras name (three's loader: `userData`). */
const SCALE = 2.4876;

/** A GLB material as three's loader hands it over: a painted one carries its maps, its extras
 *  and the normal scale the loader flips for a mesh without tangents. */
function source(name: string, painted: boolean): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.86, metalness: 0 });
  mat.name = name;
  if (painted) {
    mat.map = new THREE.Texture();
    mat.map.name = `${name}_color`;
    mat.normalMap = new THREE.Texture();
    mat.normalMap.name = `${name}_normal`;
    mat.normalScale.set(1, -1);
    mat.userData = { vertexColourScale: SCALE };
  }
  return mat;
}

function mesh(material: THREE.Material, withUv: boolean): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const n = geometry.getAttribute('position').count;
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 4).fill(0.5), 4));
  if (!withUv) geometry.deleteAttribute('uv');
  return new THREE.Mesh(geometry, material);
}

describe('vertex-coloured GLB parts', () => {
  it('converts a texture-free material to the plain vertex-coloured family, as before', () => {
    withStandard(true);
    const converter = vertexColourMaterialConverter();
    const wood = converter.convert(source('HarborWood', false)) as THREE.MeshStandardMaterial;
    expect(wood).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(wood.vertexColors).toBe(true);
    expect(wood.map).toBeNull();
    expect(wood.normalMap).toBeNull();
    expect(wood.color.getHex()).toBe(0xffffff);
    expect(wood.color.r).toBe(1);
    expect(converter.convert(source('HarborWood', false))).toBe(wood);
    // a scale in an untextured material's extras is never applied: that surfaceMat entry is
    // shared with every other prop of the same finish
    const scaled = source('HarborStone', false);
    scaled.userData = { vertexColourScale: SCALE };
    expect(vertexColourScaleOf(scaled)).toBe(SCALE);
    expect((converter.convert(scaled) as THREE.MeshStandardMaterial).color.r).toBe(1);
    expect(wood.color.r).toBe(1);
    // its geometry carries no UVs, even when the GLB had some
    const geo = vertexColourMeshGeometry(
      mesh(source('HarborWood', false), true),
      new THREE.Matrix4(),
    );
    expect(geo.getAttribute('uv')).toBeUndefined();
    expect(geo.getAttribute('color')).toBeDefined();
  });

  it('keeps a painted material maps, and its geometry its UVs', () => {
    withStandard(true);
    const converter = vertexColourMaterialConverter();
    const src = source('TavernPlaster', true);
    const painted = converter.convert(src) as THREE.MeshStandardMaterial;
    // the very GLB-cache textures, never copies (the KTX2 mip release follows them)
    expect(painted.map).toBe(src.map);
    expect(painted.normalMap).toBe(src.normalMap);
    expect(painted.vertexColors).toBe(true);
    // the vertex colours multiplied back above their headroom: the colour IS the extras' factor
    expect(painted.color.toArray()).toEqual([SCALE, SCALE, SCALE]);
    // the loader's normal scale (y flipped for a mesh without tangents), not the default
    expect(painted.normalScale.toArray()).toEqual([1, -1]);
    // another painted source of the same name with other maps (another texture tier's file)
    // converts anew
    const other = converter.convert(source('TavernPlaster', true)) as THREE.MeshStandardMaterial;
    expect(other).not.toBe(painted);
    // a painted material with no factor in its extras draws its vertex colours as they are
    const bare = source('TavernRoof', true);
    bare.userData = {};
    expect(vertexColourScaleOf(bare)).toBe(1);
    expect((converter.convert(bare) as THREE.MeshStandardMaterial).color.r).toBe(1);
    for (const junk of [0, -2, Number.NaN, '2', null]) {
      expect(
        vertexColourScaleOf(
          Object.assign(source('X', true), { userData: { vertexColourScale: junk } }),
        ),
      ).toBe(1);
    }
    const geo = vertexColourMeshGeometry(
      mesh(src, true),
      new THREE.Matrix4().makeTranslation(2, 0, 0),
    );
    expect(geo.getAttribute('uv')?.itemSize).toBe(2);
    expect(geo.getAttribute('uv')?.array).toBeInstanceOf(Float32Array);
    // two painted geometries under one material merge with their UVs
    const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
    addToBucket(buckets, painted, geo);
    addToBucket(buckets, painted, vertexColourMeshGeometry(mesh(src, true), new THREE.Matrix4()));
    const [part] = mergeVertexColourBuckets(buckets);
    expect(part.geometry.getAttribute('uv')?.count).toBe(geo.getAttribute('position').count * 2);
  });

  it('draws no normal map where the tier draws lambert materials', () => {
    withStandard(false);
    const converter = vertexColourMaterialConverter();
    const src = source('TavernStone', true);
    const painted = converter.convert(src) as THREE.MeshLambertMaterial;
    expect(painted).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(painted.map).toBe(src.map);
    expect((painted as unknown as { normalMap?: unknown }).normalMap ?? null).toBeNull();
    // the headroom is undone on every tier
    expect(painted.color.toArray()).toEqual([SCALE, SCALE, SCALE]);
  });
});
