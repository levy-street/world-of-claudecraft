import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { bankerChestPreloadInternalsForTest } from '../src/render/banker_chest';
import { eastbrookGrandArmouryInternalsForTest } from '../src/render/eastbrook_grand_armoury';
import {
  EASTBROOK_SURFACE_ATLAS_COLUMNS,
  EASTBROOK_SURFACE_ATLAS_ROWS,
  EASTBROOK_SURFACE_ATLAS_SIZE,
  EASTBROOK_SURFACE_ATLAS_URL,
  EASTBROOK_SURFACE_CELLS,
  eastbrookSurfaceGeometry,
  eastbrookSurfaceMaterial,
  eastbrookTownSemanticForColor,
} from '../src/render/eastbrook_surface_atlas';
import {
  EASTBROOK_TOWN_ASSET_URLS,
  eastbrookTownInternalsForTest,
} from '../src/render/eastbrook_town';
import { gfxInternalsForTest } from '../src/render/gfx';

let restoreGfx: (() => void) | null = null;

function setStandardMaterials(value: boolean): void {
  restoreGfx?.();
  restoreGfx = gfxInternalsForTest.overrideSettings({ standardMaterials: value });
}

function sourceAsset(name = 'TownOpaque'): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true });
  material.name = name;
  const geometry = new THREE.BoxGeometry(2, 3, 4);
  const color = new THREE.Color(0x555b61);
  const colors = new Float32Array(geometry.getAttribute('position').count * 3);
  for (let index = 0; index < colors.length; index += 3) {
    colors[index] = color.r;
    colors[index + 1] = color.g;
    colors[index + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  group.add(new THREE.Mesh(geometry, material));
  return group;
}

function atlasMaps(root: THREE.Object3D, atlas: THREE.Texture): THREE.Texture[] {
  const maps: THREE.Texture[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      const map = (material as THREE.MeshStandardMaterial | THREE.MeshLambertMaterial).map;
      if (map === atlas) maps.push(map);
    }
  });
  return maps;
}

afterEach(() => {
  restoreGfx?.();
  restoreGfx = null;
});

describe('Eastbrook shared surface atlas', () => {
  it('pins the one 512px 4x4 row-major semantic resource contract', () => {
    expect(EASTBROOK_SURFACE_ATLAS_URL).toBe('/textures/eastbrook_surface_atlas.webp');
    expect(EASTBROOK_SURFACE_ATLAS_SIZE).toBe(512);
    expect([EASTBROOK_SURFACE_ATLAS_COLUMNS, EASTBROOK_SURFACE_ATLAS_ROWS]).toEqual([4, 4]);
    expect(EASTBROOK_SURFACE_CELLS).toEqual({
      darkStoneBlocks: 0,
      lightStoneBlocks: 1,
      warmPlaster: 2,
      verticalDarkTimber: 3,
      cobaltRoofShingles: 4,
      darkForgedMetal: 5,
      warmGoldMetal: 6,
      horizontalWarmTimber: 7,
      blueCreamCanvas: 8,
      redCreamCanvas: 9,
      darkBrownLeather: 10,
      irregularDarkStone: 11,
      cyanCrystal: 12,
      cobaltPaintedPlanks: 13,
      lightGrayStone: 14,
      mediumGrayStone: 15,
    });
  });

  it('clones immutable geometry and synthesizes dominant-axis UVs inside semantic cells', () => {
    const source = new THREE.BufferGeometry();
    source.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 2, 0, 0, 0, 3, 0], 3),
    );
    source.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    source.setAttribute('uv', new THREE.Float32BufferAttribute([0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 2));

    const adapted = eastbrookSurfaceGeometry(source, 'warmGoldMetal');
    const uv = adapted.getAttribute('uv');
    expect(adapted).not.toBe(source);
    expect(source.getAttribute('uv').getX(0)).toBe(0.5);
    expect(uv.count).toBe(3);
    expect(new Set([uv.getX(0), uv.getX(1), uv.getX(2)]).size).toBeGreaterThan(1);
    for (let index = 0; index < uv.count; index++) {
      expect(uv.getX(index)).toBeGreaterThan(0.5);
      expect(uv.getX(index)).toBeLessThan(0.75);
      expect(uv.getY(index)).toBeGreaterThan(0.5);
      expect(uv.getY(index)).toBeLessThan(0.75);
    }

    const roof = new THREE.Color(0x153b88);
    const cloth = new THREE.Color(0xaa4c39);
    expect(eastbrookTownSemanticForColor(roof.r, roof.g, roof.b)).toBe('cobaltRoofShingles');
    expect(eastbrookTownSemanticForColor(cloth.r, cloth.g, cloth.b)).toBe('redCreamCanvas');
  });

  it('binds the same map to town, Armoury, and chest on Low while preserving vertex colors', () => {
    setStandardMaterials(false);
    const atlas = new THREE.Texture();
    const townSources = new Map(
      EASTBROOK_TOWN_ASSET_URLS.map((url) => [url, sourceAsset()] as const),
    );
    const town = eastbrookTownInternalsForTest.buildFromSources(townSources, () => 0, true, atlas);
    const armoury = eastbrookGrandArmouryInternalsForTest.buildArmouryFromSource(
      sourceAsset('ArmouryStone'),
      atlas,
    );
    const chest = bankerChestPreloadInternalsForTest.buildChestFromSource(
      sourceAsset('Walnut'),
      atlas,
    );
    const roots = [town.group, armoury, chest];
    const maps = roots.flatMap((root) => atlasMaps(root, atlas));
    const expectedBindings = [9, 1, 1];

    expect(maps.length).toBeGreaterThan(0);
    expect(new Set(maps)).toEqual(new Set([atlas]));
    for (let rootIndex = 0; rootIndex < roots.length; rootIndex++) {
      const root = roots[rootIndex];
      expect(root.userData.eastbrookSurfaceAtlas).toEqual({
        url: EASTBROOK_SURFACE_ATLAS_URL,
        textureUuid: atlas.uuid,
        materialBindings: expectedBindings[rootIndex],
      });
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const material = object.material as THREE.MeshLambertMaterial;
        expect(material).toBeInstanceOf(THREE.MeshLambertMaterial);
        expect(material.vertexColors).toBe(true);
        if (material.map) expect(material.map).toBe(atlas);
      });
    }
  });

  it('uses the shared map with restrained authored roughness on Standard without color-map aliasing', () => {
    setStandardMaterials(true);
    const atlas = new THREE.Texture();
    const source = new THREE.MeshStandardMaterial({
      color: 0x77808d,
      vertexColors: true,
      roughness: 0.82,
      metalness: 0.04,
    });
    source.name = 'ArmouryStone';
    const converted = eastbrookSurfaceMaterial(source, atlas) as THREE.MeshStandardMaterial;
    expect(converted.map).toBe(atlas);
    expect(converted.roughness).toBe(0.82);
    expect(converted.roughnessMap).toBeNull();
    expect(converted.vertexColors).toBe(true);

    const existingMap = new THREE.Texture();
    const existingRoughnessMap = new THREE.Texture();
    const textured = new THREE.MeshStandardMaterial({
      map: existingMap,
      roughnessMap: existingRoughnessMap,
      roughness: 0.61,
    });
    textured.name = 'ArmouryStone';
    const preserved = eastbrookSurfaceMaterial(textured, atlas) as THREE.MeshStandardMaterial;
    expect(preserved.map).toBe(existingMap);
    expect(preserved.roughnessMap).toBe(existingRoughnessMap);
    expect(preserved.roughness).toBe(0.61);
  });

  it('keeps custom worlds empty and does not bind the built-in atlas into their stable town root', () => {
    const atlas = new THREE.Texture();
    const custom = eastbrookTownInternalsForTest.buildFromSources(new Map(), () => 0, false, atlas);
    expect(custom.group.children).toEqual([]);
    expect(custom.group.userData.eastbrookSurfaceAtlas).toEqual({
      url: EASTBROOK_SURFACE_ATLAS_URL,
      textureUuid: null,
      materialBindings: 0,
    });
  });
});
