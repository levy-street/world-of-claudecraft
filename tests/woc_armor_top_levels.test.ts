import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  assembleWocArmorTop,
  combineWocTopLevel,
  disposeWocArmorTopParse,
  wocMaterialTextures,
} from '../src/render/characters/woc_armor_top_levels';

// The high armor tier laid over the medium file (woc_armor_top_levels.ts, 2026-10-03): the top
// file's level 0 of each map over the medium texture's own levels, sampled as the medium
// texture is, on clones of the medium materials, the medium parse never written to. The
// textures here are real CompressedTextures over fake block data: no GL is involved.

interface Level {
  data: Uint8Array;
  width: number;
  height: number;
}

/** A chain from `width` x `height` down to 1 x 1, each level's data tagged with its size. */
function chain(width: number, height: number): Level[] {
  const out: Level[] = [];
  let w = width;
  let h = height;
  for (;;) {
    out.push({ data: new Uint8Array(Math.max(16, w * h)).fill(w), width: w, height: h });
    if (w === 1 && h === 1) break;
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  return out;
}

/** A texture the way KTX2Loader and GLTFLoader leave one (a sampler's settings applied). */
function compressed(
  name: string,
  levels: Level[],
  format: number = THREE.RGBA_ASTC_4x4_Format,
): THREE.CompressedTexture {
  const t = new THREE.CompressedTexture(
    levels as unknown as THREE.CompressedTextureMipmap[],
    levels[0].width,
    levels[0].height,
    format as THREE.CompressedPixelFormat,
    THREE.UnsignedByteType,
  );
  t.name = name;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.minFilter = levels.length > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

/** The medium texture: a half-size chain. */
const half = (name: string, w = 8, h = 4, format?: number) => compressed(name, chain(w, h), format);
/** The top texture: one level, twice the half's level 0. */
const top = (name: string, w = 16, h = 8, format?: number) =>
  compressed(name, chain(w, h).slice(0, 1), format);

describe('combining a top level with a medium texture', () => {
  it('lays level 0 over the medium levels, moving no data, sampled as the medium texture', () => {
    const m = half('full_color_atlas');
    m.colorSpace = THREE.SRGBColorSpace;
    m.anisotropy = 8;
    m.channel = 1;
    m.premultiplyAlpha = true;
    m.wrapS = THREE.ClampToEdgeWrapping;
    m.userData = { mimeType: 'image/ktx2' };
    const t = top('full_color_atlas');
    const halfLevels = [...m.mipmaps];
    const halfVersion = m.source.version;
    const out = combineWocTopLevel(m, t);
    expect(out).not.toBeNull();
    if (!out) return;
    // the top level is the top parse's own object, the rest are the medium texture's own
    expect(out.mipmaps[0]).toBe(t.mipmaps[0]);
    expect(out.mipmaps.slice(1)).toEqual(halfLevels);
    for (let i = 1; i < out.mipmaps.length; i++) expect(out.mipmaps[i]).toBe(halfLevels[i - 1]);
    expect(out.mipmaps.map((l) => `${l.width}x${l.height}`)).toEqual([
      '16x8',
      '8x4',
      '4x2',
      '2x1',
      '1x1',
    ]);
    expect(out.image).toEqual({ width: 16, height: 8 });
    expect(out.format).toBe(m.format);
    expect(out.type).toBe(m.type);
    // sampled as the medium texture is
    expect(out.name).toBe('full_color_atlas');
    expect(out.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(out.anisotropy).toBe(8);
    expect(out.channel).toBe(1);
    expect(out.premultiplyAlpha).toBe(true);
    expect(out.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(out.wrapT).toBe(THREE.RepeatWrapping);
    expect(out.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(out.magFilter).toBe(THREE.LinearFilter);
    expect(out.flipY).toBe(false);
    expect(out.generateMipmaps).toBe(false);
    expect(out.userData).toEqual({ mimeType: 'image/ktx2' });
    // a texture of its own: a new source (a GPU texture of its own) that uploads
    expect(out.source).not.toBe(m.source);
    expect(out.version).toBeGreaterThan(0);
    // the medium texture is untouched: its levels, its source, its version
    expect(m.mipmaps).toEqual(halfLevels);
    expect(m.mipmaps).toHaveLength(4);
    expect(m.source.version).toBe(halfVersion);
  });

  it('takes an odd size the way a GPU halves it', () => {
    const out = combineWocTopLevel(half('odd', 2, 1), top('odd', 5, 3));
    expect(out?.mipmaps.map((l) => `${l.width}x${l.height}`)).toEqual(['5x3', '2x1', '1x1']);
  });

  it('refuses a pair that does not fit', () => {
    const m = half('a');
    // no partner, or a partner of another size, format or type
    expect(combineWocTopLevel(m, undefined)).toBeNull();
    expect(combineWocTopLevel(m, top('a', 32, 16))).toBeNull();
    expect(combineWocTopLevel(m, top('a', 16, 16))).toBeNull();
    expect(combineWocTopLevel(m, top('a', 16, 8, THREE.RGBA_BPTC_Format))).toBeNull();
    const halfFloat = top('a');
    halfFloat.type = THREE.HalfFloatType;
    expect(combineWocTopLevel(m, halfFloat)).toBeNull();
    // a level 0 with no block data in it (a released or stubbed chain)
    const empty = top('a');
    empty.mipmaps[0] = { data: new Uint8Array(0), width: 16, height: 8 };
    expect(combineWocTopLevel(m, empty)).toBeNull();
    // not a plain compressed texture: an image texture, an array texture
    expect(combineWocTopLevel(new THREE.Texture(), top('a'))).toBeNull();
    const array = top('a') as THREE.CompressedTexture & { isCompressedArrayTexture?: boolean };
    array.isCompressedArrayTexture = true;
    expect(combineWocTopLevel(m, array)).toBeNull();
  });
});

/** A medium parse: two materials over one colour image (the second through a clone, as
 *  GLTFLoader makes one per sampler), one normal map, one ORM in three slots, and a glow map the
 *  top file has no level for. */
function mediumScene() {
  const color = half('full_color_atlas');
  const colorClone = color.clone();
  colorClone.wrapS = THREE.MirroredRepeatWrapping;
  const normal = half('full_normal_atlas', 4, 2);
  const orm = half('full_data_atlas', 4, 2);
  const glow = half('full_emissive_atlas', 4, 2);
  const a = new THREE.MeshStandardMaterial({
    name: 'full atlas 0',
    map: color,
    normalMap: normal,
    roughnessMap: orm,
    metalnessMap: orm,
    aoMap: orm,
  });
  const b = new THREE.MeshStandardMaterial({
    name: 'full atlas 1',
    map: colorClone,
    normalMap: normal,
    emissiveMap: glow,
  });
  const root = new THREE.Group();
  const bone = new THREE.Bone();
  bone.name = 'spine';
  root.add(bone);
  const chest = new THREE.SkinnedMesh(new THREE.BoxGeometry(), a);
  chest.name = 'Armor_Test_Chest';
  root.add(chest);
  chest.bind(new THREE.Skeleton([bone]));
  const pad = new THREE.Mesh(new THREE.BoxGeometry(), b);
  pad.name = 'Armor_Test_Pad';
  bone.add(pad);
  return { root, chest, pad, a, b, color, colorClone, normal, orm, glow };
}

/** A top parse: one degenerate mesh, one material holding each top level in its slot. */
function topScene() {
  const material = new THREE.MeshStandardMaterial({
    name: 'full atlas top',
    map: top('full_color_atlas'),
    normalMap: top('full_normal_atlas', 8, 4),
    roughnessMap: top('full_data_atlas', 8, 4),
  });
  material.metalnessMap = material.roughnessMap;
  material.aoMap = material.roughnessMap;
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.name = 'top_levels';
  root.add(mesh);
  return { root, mesh, material };
}

describe('assembling the high scene over the medium file', () => {
  it('clones each medium material onto the combined textures, one GPU texture per image', () => {
    const m = mediumScene();
    const t = topScene();
    const made = assembleWocArmorTop(m.root, t.root);
    const chest = made.scene.getObjectByName('Armor_Test_Chest') as THREE.SkinnedMesh;
    const pad = made.scene.getObjectByName('Armor_Test_Pad') as THREE.Mesh;
    // the scene is a clone over the medium geometry, its rigid part still on its bone
    expect(chest).not.toBe(m.chest);
    expect(chest.isSkinnedMesh).toBe(true);
    expect(chest.geometry).toBe(m.chest.geometry);
    expect(pad.parent?.name).toBe('spine');
    expect(pad.geometry).toBe(m.pad.geometry);
    // each mesh wears its material's one clone
    const a = chest.material as THREE.MeshStandardMaterial;
    const b = pad.material as THREE.MeshStandardMaterial;
    expect(a).not.toBe(m.a);
    expect(b).not.toBe(m.b);
    expect(a.name).toBe('full atlas 0');
    expect(new Set(made.materials)).toEqual(new Set([a, b]));
    expect(made.materials).toHaveLength(2);
    // full textures in every slot a top level fit
    expect(a.map?.image).toEqual({ width: 16, height: 8 });
    expect(a.normalMap?.image).toEqual({ width: 8, height: 4 });
    expect(a.roughnessMap?.image).toEqual({ width: 8, height: 4 });
    // the ORM in three slots is one texture, as in the medium file
    expect(a.metalnessMap).toBe(a.roughnessMap);
    expect(a.aoMap).toBe(a.roughnessMap);
    expect(b.normalMap).toBe(a.normalMap);
    // two medium textures of one image: two textures (each keeps its own sampling) over ONE
    // source, so three uploads one GPU texture for them, as it did for the medium pair
    expect(b.map).not.toBe(a.map);
    expect(b.map?.source).toBe(a.map?.source);
    expect(b.map?.wrapS).toBe(THREE.MirroredRepeatWrapping);
    expect(a.map?.wrapS).toBe(THREE.RepeatWrapping);
    expect((b.map as THREE.CompressedTexture).mipmaps[0]).toBe(
      (a.map as THREE.CompressedTexture).mipmaps[0],
    );
    expect(made.textures).toHaveLength(4);
    expect(new Set(made.textures.map((tex) => tex.source)).size).toBe(3);
    // the glow map has no top level: the clone keeps drawing the medium texture, named
    expect(b.emissiveMap).toBe(m.glow);
    expect(made.unpaired).toEqual(['full_emissive_atlas']);
  });

  it('never writes to the medium parse', () => {
    const m = mediumScene();
    const before = [m.color, m.colorClone, m.normal, m.orm, m.glow].map((tex) => ({
      tex,
      levels: [...tex.mipmaps],
      version: tex.version,
      source: tex.source.version,
    }));
    assembleWocArmorTop(m.root, topScene().root);
    expect(m.chest.material).toBe(m.a);
    expect(m.pad.material).toBe(m.b);
    expect(m.a.map).toBe(m.color);
    expect(m.a.roughnessMap).toBe(m.orm);
    expect(m.b.emissiveMap).toBe(m.glow);
    for (const { tex, levels, version, source } of before) {
      expect(tex.mipmaps).toEqual(levels);
      expect(tex.version).toBe(version);
      expect(tex.source.version).toBe(source);
    }
  });

  it('draws the medium file as it is when no top level fits', () => {
    const m = mediumScene();
    const wrong = new THREE.Group();
    wrong.add(
      new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshStandardMaterial({ map: top('full_color_atlas', 64, 32) }),
      ),
    );
    const made = assembleWocArmorTop(m.root, wrong);
    expect(made.textures).toEqual([]);
    const a = (made.scene.getObjectByName('Armor_Test_Chest') as THREE.Mesh)
      .material as THREE.MeshStandardMaterial;
    expect(a).not.toBe(m.a);
    expect(a.map).toBe(m.color);
    expect([...made.unpaired].sort()).toEqual([
      'full_color_atlas',
      'full_data_atlas',
      'full_emissive_atlas',
      'full_normal_atlas',
    ]);
  });

  it('lets the top parse go without touching the levels an assembly took', () => {
    const m = mediumScene();
    const t = topScene();
    const made = assembleWocArmorTop(m.root, t.root);
    const level0 = (made.textures[0] as THREE.CompressedTexture).mipmaps[0];
    const disposed: string[] = [];
    for (const tex of new Set(wocMaterialTextures(t.material).map(([, tex]) => tex))) {
      tex.addEventListener('dispose', () => disposed.push(tex.name));
    }
    const material = vi.spyOn(t.material, 'dispose');
    const geometry = vi.spyOn(t.mesh.geometry, 'dispose');
    disposeWocArmorTopParse(t.root);
    expect(disposed.sort()).toEqual(['full_color_atlas', 'full_data_atlas', 'full_normal_atlas']);
    expect(material).toHaveBeenCalledTimes(1);
    expect(geometry).toHaveBeenCalledTimes(1);
    // the combined texture still holds the block data it took
    expect(level0.data.length).toBeGreaterThan(0);
    expect((made.textures[0] as THREE.CompressedTexture).mipmaps[0]).toBe(level0);
  });

  it('pairs neither of two different top levels that share a name', () => {
    const m = mediumScene();
    const t = topScene();
    const twin = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ map: top('full_color_atlas') }),
    );
    t.root.add(twin);
    const made = assembleWocArmorTop(m.root, t.root);
    const a = (made.scene.getObjectByName('Armor_Test_Chest') as THREE.Mesh)
      .material as THREE.MeshStandardMaterial;
    expect(a.map).toBe(m.color);
    expect(made.unpaired).toContain('full_color_atlas');
    // the other maps still pair
    expect(a.normalMap?.image).toEqual({ width: 8, height: 4 });
  });

  it('keeps each material clone on the program its medium material links', () => {
    const m = mediumScene();
    // a material with a shader hook of its own (a file material never carries one)
    m.b.onBeforeCompile = (shader) => {
      shader.fragmentShader = `// hooked\n${shader.fragmentShader}`;
    };
    m.b.customProgramCacheKey = () => 'hooked-armor';
    const made = assembleWocArmorTop(m.root, topScene().root);
    const a = (made.scene.getObjectByName('Armor_Test_Chest') as THREE.Mesh).material;
    const b = (made.scene.getObjectByName('Armor_Test_Pad') as THREE.Mesh).material;
    expect((a as THREE.Material).customProgramCacheKey()).toBe(m.a.customProgramCacheKey());
    expect((b as THREE.Material).customProgramCacheKey()).toBe('hooked-armor');
    expect((b as THREE.Material).onBeforeCompile).toBe(m.b.onBeforeCompile);
    expect(Object.hasOwn(a as THREE.Material, 'onBeforeCompile')).toBe(false);
  });

  it('lists every texture a material draws by its slot', () => {
    const m = mediumScene();
    expect(
      wocMaterialTextures(m.a)
        .map(([slot]) => slot)
        .sort(),
    ).toEqual(['aoMap', 'map', 'metalnessMap', 'normalMap', 'roughnessMap']);
  });
});
