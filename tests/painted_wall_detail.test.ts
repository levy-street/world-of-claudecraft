// The re-baked painted walls' runtime layer, three.js half (src/render/painted_wall_detail.ts,
// applied by placedBuildingMaterial in src/render/eastbrook_placed_building.ts). Pinned here:
//  - the gate on real materials: only `painted_walls@<re-baked model>` on a mesh carrying
//    uv1 takes it; a look's walls, an old file, the roofs, props and interiors keep their
//    exact program (a no-op, never an error);
//  - one program per variant: every building's walls share the key, and a hook-preserving
//    clone (the camera fade's twin, the boot ghost prewarm's twin) keys and patches the same;
//  - the stone mask never reaches opacity on a TRANSPARENT draw, Standard and Lambert alike;
//  - the dithered ghost chains on top; the detail normal is one shared uniform the gate's
//    upload lane can find.
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildEastbrookPlacedBuilding,
  placedBuildingMaterial,
} from '../src/render/eastbrook_placed_building';
import { type GfxSettings, gfxInternalsForTest } from '../src/render/gfx';
import { cloneMaterialWithHooks } from '../src/render/material_clone_hooks';
import { setDitherFadeEnabledForTest } from '../src/render/occluder_dither_fade';
import { applyOccluderFade } from '../src/render/occluder_fade';
import { buildOccluderFadeTwin } from '../src/render/occluder_fade_gate';
import { buildGhostVariantPrewarmGroup } from '../src/render/occluder_ghost_prewarm';
import {
  paintedWallDetailInternalsForTest,
  paintedWallDetailTexture,
  paintedWallDetailVariantOf,
  preparePaintedWallDetailProfileAssets,
  setPaintedWallDetailTextureForTest,
} from '../src/render/painted_wall_detail';
import {
  PAINTED_WALL_DETAIL_MARKER,
  PAINTED_WALL_DETAIL_STRENGTH,
  PAINTED_WALL_DETAIL_URL,
  paintedWallDetailProgramKey,
} from '../src/render/painted_wall_detail_core';
import { collectPrewarmTextures } from '../src/render/texture_prewarm';
import { EASTBROOK_LAYOUT } from '../src/sim/eastbrook_layout';

const loader = vi.hoisted(() => ({ loadKtx2Texture: vi.fn() }));
vi.mock('../src/render/assets/loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/render/assets/loader')>()),
  loadKtx2Texture: loader.loadKtx2Texture,
}));

let restoreGfx: (() => void) | null = null;
const detailNormal = new THREE.Texture();

function setStandardMaterials(value: boolean): void {
  restoreGfx?.();
  restoreGfx = gfxInternalsForTest.overrideSettings({ standardMaterials: value });
}

beforeEach(() => {
  setStandardMaterials(true);
  setDitherFadeEnabledForTest(false);
  setPaintedWallDetailTextureForTest(detailNormal);
});

afterEach(() => {
  restoreGfx?.();
  restoreGfx = null;
  setDitherFadeEnabledForTest(null);
  setPaintedWallDetailTextureForTest(null);
});

const LOOK = { town: 'eastbrook' as const, buildingId: 'eastbrook_bank' };

/** A painted material as GLTFLoader hands it over (a tangent-less normal map: (1, -1)). */
function painted(name: string): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: new THREE.Texture(),
    normalMap: new THREE.Texture(),
    emissiveMap: new THREE.Texture(),
    side: THREE.DoubleSide,
  });
  material.normalScale.set(1, -1);
  material.name = name;
  return material;
}

/** A wall's geometry; `rebaked` adds the walls' tile coordinates (TEXCOORD_1 -> uv1). */
function wallGeometry(rebaked: boolean): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(6, 5, 4);
  if (rebaked) geometry.setAttribute('uv1', geometry.getAttribute('uv').clone());
  return geometry;
}

type Lib = 'standard' | 'lambert';

/** What three hands a material's onBeforeCompile, patched by it. */
function compile(material: THREE.Material, lib: Lib): THREE.WebGLProgramParametersWithUniforms {
  const shader = {
    uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib[lib].uniforms),
    vertexShader: THREE.ShaderLib[lib].vertexShader,
    fragmentShader: THREE.ShaderLib[lib].fragmentShader,
  } as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

/** The fragment right after map_fragment restores the material's own opacity. */
function restoresOpacity(fragment: string): boolean {
  const at = fragment.indexOf('#include <map_fragment>');
  const tail = fragment.slice(at);
  const restore = tail.indexOf('diffuseColor.a = opacity;');
  return at >= 0 && restore > 0 && restore < tail.indexOf('#include <color_fragment>');
}

describe('the one shared detail normal', () => {
  const standard = { standardMaterials: true } as GfxSettings;
  const lambert = { standardMaterials: false } as GfxSettings;

  beforeEach(() => {
    setPaintedWallDetailTextureForTest(null);
    loader.loadKtx2Texture.mockReset();
  });

  it('loads once through the KTX2 loader, for a Standard profile only, as a clone', async () => {
    const shipped = new THREE.Texture();
    loader.loadKtx2Texture.mockResolvedValue(shipped);
    // the Lambert tiers never sample it, so never fetch it
    await preparePaintedWallDetailProfileAssets(lambert);
    expect(loader.loadKtx2Texture).not.toHaveBeenCalled();
    expect(paintedWallDetailTexture()).toBeNull();
    await Promise.all([
      preparePaintedWallDetailProfileAssets(standard),
      preparePaintedWallDetailProfileAssets(standard),
    ]);
    expect(loader.loadKtx2Texture).toHaveBeenCalledTimes(1);
    expect(loader.loadKtx2Texture).toHaveBeenCalledWith(PAINTED_WALL_DETAIL_URL, { repeat: true });
    // a clone of the loader's cached instance (never written), sharing its mips
    const resident = paintedWallDetailTexture();
    expect(resident).not.toBe(shipped);
    expect(resident?.source).toBe(shipped.source);
    // resident: a later profile switch asks for nothing
    await preparePaintedWallDetailProfileAssets(standard);
    expect(loader.loadKtx2Texture).toHaveBeenCalledTimes(1);
    // and every walls program reads it from the one shared uniform
    const walls = placedBuildingMaterial(painted('painted_walls@bank'), LOOK, wallGeometry(true));
    expect(compile(walls, 'standard').uniforms.uPaintedWallDetailMap.value).toBe(resident);
  });

  it('retries a failed load on the next ask instead of replaying the failure', async () => {
    loader.loadKtx2Texture.mockRejectedValueOnce(new Error('ktx2 texture load failed'));
    await expect(preparePaintedWallDetailProfileAssets(standard)).rejects.toThrow('ktx2');
    expect(paintedWallDetailTexture()).toBeNull();
    // a wall built meanwhile keeps the mask guard, never a relief with no texture
    const walls = placedBuildingMaterial(painted('painted_walls@bank'), LOOK, wallGeometry(true));
    expect(paintedWallDetailVariantOf(walls)).toBe('mask');
    loader.loadKtx2Texture.mockResolvedValueOnce(new THREE.Texture());
    await preparePaintedWallDetailProfileAssets(standard);
    expect(loader.loadKtx2Texture).toHaveBeenCalledTimes(2);
    expect(paintedWallDetailTexture()).not.toBeNull();
  });
});

describe('which placed-building materials take the walls layer', () => {
  it('patches a re-baked wall on the Standard tiers with the relief', () => {
    const source = painted('painted_walls@bank');
    const walls = placedBuildingMaterial(source, LOOK, wallGeometry(true));
    expect(paintedWallDetailVariantOf(walls)).toBe('detail');
    expect(walls.customProgramCacheKey()).toContain(paintedWallDetailProgramKey('detail'));
    const shader = compile(walls, 'standard');
    expect(shader.vertexShader).toContain('vUv1 = uv1;');
    expect(shader.fragmentShader).toContain(`${PAINTED_WALL_DETAIL_MARKER} relief`);
    expect(restoresOpacity(shader.fragmentShader)).toBe(true);
    // the uniforms are the ONE shared set, by reference, carrying the shared texture
    const shared = paintedWallDetailInternalsForTest.uniforms;
    expect(shader.uniforms.uPaintedWallDetailMap).toBe(shared.uPaintedWallDetailMap);
    expect(shader.uniforms.uPaintedWallDetailStrength).toBe(shared.uPaintedWallDetailStrength);
    expect(shader.uniforms.uPaintedWallDetailFade).toBe(shared.uPaintedWallDetailFade);
    expect(shared.uPaintedWallDetailMap.value).toBe(detailNormal);
    expect(shared.uPaintedWallDetailStrength.value).toBe(PAINTED_WALL_DETAIL_STRENGTH);
    // the loader's material is never written
    expect(paintedWallDetailVariantOf(source)).toBeNull();
    expect(source.customProgramCacheKey()).toBe(
      new THREE.MeshStandardMaterial().customProgramCacheKey(),
    );
    // and the atlas keeps its own lifted relief and glTF sign, untouched by the layer
    expect((walls as THREE.MeshStandardMaterial).normalScale.toArray()).toEqual([1.8, -1.8]);
  });

  it('keys every building walls on one program, and a second pass never stacks', () => {
    const bank = placedBuildingMaterial(painted('painted_walls@bank'), LOOK, wallGeometry(true));
    const smithy = placedBuildingMaterial(
      painted('painted_walls@smithy'),
      { town: 'eastbrook', buildingId: 'eastbrook_smithy' },
      wallGeometry(true),
    );
    expect(smithy.customProgramCacheKey()).toBe(bank.customProgramCacheKey());
    expect(compile(smithy, 'standard').fragmentShader).toBe(
      compile(bank, 'standard').fragmentShader,
    );
    const again = placedBuildingMaterial(bank, LOOK, wallGeometry(true));
    expect(again.customProgramCacheKey()).toBe(bank.customProgramCacheKey());
    expect(
      compile(again, 'standard').fragmentShader.split(`${PAINTED_WALL_DETAIL_MARKER} relief`),
    ).toHaveLength(2);
  });

  it('is a no-op without uv1: the look and old-file walls keep their exact program', () => {
    const source = painted('painted_walls@bank');
    const look = placedBuildingMaterial(source, LOOK, wallGeometry(false));
    expect(paintedWallDetailVariantOf(look)).toBeNull();
    expect(look.customProgramCacheKey()).toBe(
      cloneMaterialWithHooks(source).customProgramCacheKey(),
    );
    const shader = compile(look, 'standard');
    expect(shader.vertexShader).toBe(THREE.ShaderLib.standard.vertexShader);
    expect(shader.fragmentShader).toBe(THREE.ShaderLib.standard.fragmentShader);
    // a call site that names no geometry (an older caller) is the same no-op
    expect(paintedWallDetailVariantOf(placedBuildingMaterial(source, LOOK))).toBeNull();
  });

  it('leaves the roofs, props, interiors and the walls of a model never re-baked alone', () => {
    for (const name of [
      'painted_roof@bank',
      'painted_props@bank',
      'painted_props_gold@bank',
      'painted_interior@bank',
      'painted_walls@house_a',
      'town_atlas',
    ]) {
      const material = placedBuildingMaterial(painted(name), LOOK, wallGeometry(true));
      expect(paintedWallDetailVariantOf(material), name).toBeNull();
      expect(compile(material, 'standard').fragmentShader, name).toBe(
        THREE.ShaderLib.standard.fragmentShader,
      );
    }
  });

  it('keeps only the mask guard while the detail normal is not resident', () => {
    setPaintedWallDetailTextureForTest(null);
    const walls = placedBuildingMaterial(painted('painted_walls@bank'), LOOK, wallGeometry(true));
    expect(paintedWallDetailVariantOf(walls)).toBe('mask');
    const shader = compile(walls, 'standard');
    expect(shader.vertexShader).toBe(THREE.ShaderLib.standard.vertexShader);
    expect(shader.fragmentShader).not.toContain('uPaintedWallDetailMap');
    expect(restoresOpacity(shader.fragmentShader)).toBe(true);
  });

  it('gives the Lambert tiers the mask guard and no normal map', () => {
    setStandardMaterials(false);
    const walls = placedBuildingMaterial(painted('painted_walls@tavern'), LOOK, wallGeometry(true));
    expect(walls).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect((walls as THREE.MeshLambertMaterial).normalMap).toBeNull();
    expect(paintedWallDetailVariantOf(walls)).toBe('mask');
    expect(walls.customProgramCacheKey()).toContain(paintedWallDetailProgramKey('mask'));
    const shader = compile(walls, 'lambert');
    expect(shader.vertexShader).toBe(THREE.ShaderLib.lambert.vertexShader);
    expect(restoresOpacity(shader.fragmentShader)).toBe(true);
    // a Lambert look's walls stay stock
    const look = placedBuildingMaterial(painted('painted_walls@tavern'), LOOK, wallGeometry(false));
    expect(compile(look, 'lambert').fragmentShader).toBe(THREE.ShaderLib.lambert.fragmentShader);
  });
});

describe('the camera fade draws the re-baked walls whole', () => {
  it('links the twin on the live program and keeps the mask out of its opacity (Standard)', () => {
    const geometry = wallGeometry(true);
    const live = placedBuildingMaterial(painted('painted_walls@bank'), LOOK, geometry);
    const twin = buildOccluderFadeTwin(
      { material: live, geometry, instanced: false, instanceColor: false },
      'test',
    ).material as THREE.Material;
    expect(twin.transparent).toBe(true);
    expect(paintedWallDetailVariantOf(twin)).toBe('detail');
    expect(twin.customProgramCacheKey()).toBe(live.customProgramCacheKey());
    const shader = compile(twin, 'standard');
    expect(shader.fragmentShader).toBe(compile(live, 'standard').fragmentShader);
    expect(restoresOpacity(shader.fragmentShader)).toBe(true);
    // the plain hook-preserving clone too
    expect(cloneMaterialWithHooks(live).customProgramCacheKey()).toBe(live.customProgramCacheKey());
  });

  it('does the same for the Lambert twin', () => {
    setStandardMaterials(false);
    const geometry = wallGeometry(true);
    const live = placedBuildingMaterial(painted('painted_walls@hall'), LOOK, geometry);
    const twin = buildOccluderFadeTwin(
      { material: live, geometry, instanced: false, instanceColor: false },
      'test',
    ).material as THREE.Material;
    expect(twin).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(twin.transparent).toBe(true);
    expect(paintedWallDetailVariantOf(twin)).toBe('mask');
    expect(twin.customProgramCacheKey()).toBe(live.customProgramCacheKey());
    expect(restoresOpacity(compile(twin, 'lambert').fragmentShader)).toBe(true);
  });

  it('keeps the guard on the live flip to transparent, and only the opacity value moves', () => {
    const source = new THREE.Group();
    source.add(new THREE.Mesh(wallGeometry(true), painted('painted_walls@shop_a')));
    const built = buildEastbrookPlacedBuilding(EASTBROOK_LAYOUT.buildings[0], source, () => 0);
    const walls = built.mats.find((record) => paintedWallDetailVariantOf(record.mat) !== null);
    if (!walls) throw new Error('the walls fade record carries the layer');
    const key = walls.mat.customProgramCacheKey();
    applyOccluderFade(built.mats, 0.35);
    expect(walls.mat.transparent).toBe(true);
    expect(walls.mat.customProgramCacheKey()).toBe(key);
    expect(restoresOpacity(compile(walls.mat, 'standard').fragmentShader)).toBe(true);
    applyOccluderFade(built.mats, 1);
    expect(walls.mat.transparent).toBe(false);
  });

  it('chains the dithered ghost on top, one program carrying both', () => {
    setDitherFadeEnabledForTest(true);
    const source = new THREE.Group();
    source.add(new THREE.Mesh(wallGeometry(true), painted('painted_walls@house_b')));
    const built = buildEastbrookPlacedBuilding(EASTBROOK_LAYOUT.buildings[0], source, () => 0);
    const walls = built.mats[0].mat;
    expect(paintedWallDetailVariantOf(walls)).toBe('detail');
    expect(walls.customProgramCacheKey()).toContain(paintedWallDetailProgramKey('detail'));
    expect(walls.customProgramCacheKey()).toContain('ghost-dither-fade');
    const shader = compile(walls, 'standard');
    expect(shader.fragmentShader).toContain(`${PAINTED_WALL_DETAIL_MARKER} relief`);
    expect(shader.fragmentShader).toContain('uGhostFade');
    expect(restoresOpacity(shader.fragmentShader)).toBe(true);
  });
});

describe('a re-baked building as the town stands it', () => {
  /** The shipped shape: walls on three level meshes sharing one material, a roof, and the
   *  furniture under an interior group (the roof given uv1 too, to prove the NAME gates). */
  function rebakedModel(model: string): THREE.Group {
    const source = new THREE.Group();
    const walls = painted(`painted_walls@${model}`);
    for (const level of ['L0', 'H1', 'H2']) {
      const mesh = new THREE.Mesh(wallGeometry(true), walls);
      mesh.name = `${model}_${level}`;
      source.add(mesh);
    }
    const roof = new THREE.Mesh(wallGeometry(true), painted(`painted_roof@${model}`));
    roof.name = `${model}_roof`;
    source.add(roof);
    const interior = new THREE.Group();
    interior.name = 'G_INT_furniture';
    const table = new THREE.Mesh(wallGeometry(false), painted(`painted_props@${model}`));
    table.name = 'table';
    interior.add(table);
    source.add(interior);
    return source;
  }

  it('patches exactly its walls, and the reveal root carries the program and the texture', () => {
    const built = buildEastbrookPlacedBuilding(
      EASTBROOK_LAYOUT.buildings[0],
      rebakedModel('bank'),
      () => 0,
    );
    const variants = new Map<string, string | null>();
    built.group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        variants.set(object.name, paintedWallDetailVariantOf(object.material as THREE.Material));
      }
    });
    expect(Object.fromEntries(variants)).toEqual({
      bank_L0: 'detail',
      bank_H1: 'detail',
      bank_H2: 'detail',
      bank_roof: null,
      table: null,
    });
    // the building group is a reveal root of the town key (eastbrook_town_renderer.test.ts):
    // the gate's upload lane enumerates the shared detail normal under it
    const textures = new Set<THREE.Texture>();
    collectPrewarmTextures(built.group, textures);
    expect(textures.has(detailNormal)).toBe(true);
  });

  it('stages its fade twin, in the boot ghost prewarm, on the program the flip draws', () => {
    const built = buildEastbrookPlacedBuilding(
      EASTBROOK_LAYOUT.buildings[0],
      rebakedModel('tavern'),
      () => 0,
    );
    const liveWalls = built.mats.find((record) => paintedWallDetailVariantOf(record.mat));
    if (!liveWalls) throw new Error('the walls record');
    const prewarm = buildGhostVariantPrewarmGroup(built.group);
    const twins = prewarm.children.map((child) => (child as THREE.Mesh).material as THREE.Material);
    const wallTwins = twins.filter((twin) => paintedWallDetailVariantOf(twin) === 'detail');
    // the three wall meshes share one program: one twin
    expect(wallTwins).toHaveLength(1);
    expect(wallTwins[0].transparent).toBe(true);
    expect(wallTwins[0].customProgramCacheKey()).toBe(liveWalls.mat.customProgramCacheKey());
    // and the roof's twin is a stock program
    expect(
      twins.filter((twin) => paintedWallDetailVariantOf(twin) === null).length,
    ).toBeGreaterThan(0);
  });
});
