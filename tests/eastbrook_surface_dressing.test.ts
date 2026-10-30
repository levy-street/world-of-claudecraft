// Build-time dressing of Eastbrook's procedural surfaces
// (src/render/eastbrook_surface_dressing.ts): the merged stall/bench/fence
// batch and the Weekly Vault. Pinned here:
//  - the grime band and the seeded value: bounded, deterministic, only ever a
//    scalar on the vertex colour (the paint's hue survives);
//  - a placement keeps the town's attribute contract, tiles its atlas cell at
//    WORLD scale after its placement scale, keeps its base on the ground, and
//    its emissive part moves with it while keeping its own UVs and colours;
//  - the Weekly Vault wears the atlas once it has loaded: the map on every
//    tier, the baked normal and roughness on the Standard tiers at the town's
//    scale, Lambert on Low, and plain vertex colour while the atlas is missing.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

const textures = vi.hoisted(() => ({
  atlas: undefined as unknown,
  normal: undefined as unknown,
  rough: undefined as unknown,
}));
vi.mock('../src/render/eastbrook_surface_atlas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/render/eastbrook_surface_atlas')>()),
  eastbrookSurfaceAtlasTexture: () => textures.atlas,
  eastbrookSurfaceNormalTexture: () => textures.normal,
  eastbrookSurfaceRoughnessTexture: () => textures.rough,
}));

const { EASTBROOK_SURFACE_CELLS, EASTBROOK_SURFACE_NORMAL_SCALE } = await import(
  '../src/render/eastbrook_surface_atlas'
);
const { dressEastbrookPlacement, EASTBROOK_PROP_GRIME, surfaceGrimeFactor, surfaceValueFactor } =
  await import('../src/render/eastbrook_surface_dressing');
const { EASTBROOK_SURFACE_REPEAT_YARDS, eastbrookAtlasCellRect } = await import(
  '../src/render/eastbrook_surface_tiling_core'
);
const { buildEastbrookWeeklyVault } = await import('../src/render/eastbrook_weekly_vault');
const { gfxInternalsForTest } = await import('../src/render/gfx');

let restoreGfx: (() => void) | null = null;

function setStandardMaterials(value: boolean): void {
  restoreGfx?.();
  restoreGfx = gfxInternalsForTest.overrideSettings({ standardMaterials: value });
}

afterEach(() => {
  restoreGfx?.();
  restoreGfx = null;
  textures.atlas = undefined;
  textures.normal = undefined;
  textures.rough = undefined;
});

const CANVAS = EASTBROOK_SURFACE_CELLS.blueCreamCanvas;

/** A stand-in template as the town extracts one: base on y 0, centred, every
 *  vertex's UV in one atlas cell, a vertex colour. Indexed, like the town's. */
function template(cell: number, rgb: [number, number, number]): THREE.BufferGeometry {
  const box = new THREE.BoxGeometry(2.8, 2.7, 2.2).translate(0, 1.35, 0).toNonIndexed();
  box.deleteAttribute('uv');
  const count = box.getAttribute('position').count;
  const rect = eastbrookAtlasCellRect(cell);
  const uv = new Float32Array(count * 2);
  const color = new Float32Array(count * 3);
  for (let index = 0; index < count; index++) {
    uv[index * 2] = rect.u0 + rect.size * 0.5;
    uv[index * 2 + 1] = rect.v0 + rect.size * 0.5;
    color.set(rgb, index * 3);
  }
  box.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  box.setAttribute('color', new THREE.BufferAttribute(color, 3));
  return box;
}

function placement(): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(-20, 3, -95),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 2.48, 0, 'YZX')),
    new THREE.Vector3(1.25, 1, 1),
  );
}

describe('grime and value', () => {
  it('darkens the footing by the band strength and nothing above the band', () => {
    expect(surfaceGrimeFactor(EASTBROOK_PROP_GRIME, 0)).toBeCloseTo(
      1 - EASTBROOK_PROP_GRIME.strength,
      12,
    );
    expect(surfaceGrimeFactor(EASTBROOK_PROP_GRIME, EASTBROOK_PROP_GRIME.height)).toBe(1);
    expect(surfaceGrimeFactor(EASTBROOK_PROP_GRIME, 5)).toBe(1);
    let previous = 0;
    for (let h = 0; h <= EASTBROOK_PROP_GRIME.height; h += 0.05) {
      const factor = surfaceGrimeFactor(EASTBROOK_PROP_GRIME, h);
      expect(factor).toBeGreaterThanOrEqual(previous);
      previous = factor;
    }
  });

  it('shifts each key by a bounded, deterministic value', () => {
    for (let index = 0; index < 100; index++) {
      const value = surfaceValueFactor(`stall_${index}`, 0.04);
      expect(value).toBeGreaterThanOrEqual(0.96);
      expect(value).toBeLessThanOrEqual(1.04);
      expect(surfaceValueFactor(`stall_${index}`, 0.04)).toBe(value);
    }
  });
});

describe('a dressed placement', () => {
  const rgb: [number, number, number] = [0.6, 0.4, 0.2];

  it('keeps the town contract, tiles at world scale and keeps its base on the ground', () => {
    const matrix = placement();
    const source = template(CANVAS, rgb);
    const dressed = dressEastbrookPlacement(source, matrix, {
      key: 'eastbrook_market_stall_world_market',
      kind: 'stall',
      size: new THREE.Vector3(2.8, 2.7, 2.2),
      surface: true,
    });
    expect(Object.keys(dressed.attributes).sort()).toEqual(['color', 'normal', 'position', 'uv']);
    expect(dressed.getIndex()).not.toBeNull();
    const position = dressed.getAttribute('position');
    const uv = dressed.getAttribute('uv');
    const color = dressed.getAttribute('color');
    const rect = eastbrookAtlasCellRect(CANVAS);
    let baseVertices = 0;
    for (let index = 0; index < position.count; index++) {
      expect(uv.getX(index)).toBeGreaterThanOrEqual(rect.u0 - 1e-6);
      expect(uv.getX(index)).toBeLessThanOrEqual(rect.u0 + rect.size + 1e-6);
      expect(uv.getY(index)).toBeGreaterThanOrEqual(rect.v0 - 1e-6);
      expect(uv.getY(index)).toBeLessThanOrEqual(rect.v0 + rect.size + 1e-6);
      // the paint's hue survives: only a scalar (value times grime)
      const scale = color.getX(index) / rgb[0];
      expect(color.getY(index)).toBeCloseTo(rgb[1] * scale, 5);
      expect(color.getZ(index)).toBeCloseTo(rgb[2] * scale, 5);
      if (Math.abs(position.getY(index) - 3) < 1e-5) {
        baseVertices++;
        // grime at the base: the band's full strength times the value shift
        expect(scale).toBeLessThan(1 - EASTBROOK_PROP_GRIME.strength * 0.9);
      }
    }
    expect(baseVertices).toBeGreaterThan(0);
    // The canvas repeats every 1.2 yd: the 3.5-yard placed width (2.8 x 1.25)
    // is clipped into more than two repeats, where the old mapping drew one.
    expect(EASTBROOK_SURFACE_REPEAT_YARDS[CANVAS][0]).toBe(1.2);
    expect(dressed.getIndex()?.count ?? 0).toBeGreaterThan(12 * 3 * 2);
  });

  it('moves its emissive part with it while that part keeps its own UVs and colours', () => {
    const matrix = placement();
    const shared = {
      key: 'eastbrook_market_stall_world_market',
      kind: 'stall' as const,
      size: new THREE.Vector3(2.8, 2.7, 2.2),
    };
    const opaque = dressEastbrookPlacement(template(CANVAS, rgb), matrix, {
      ...shared,
      surface: true,
    });
    const glow = template(EASTBROOK_SURFACE_CELLS.cyanCrystal, [1, 0.7, 0.3]);
    const emissive = dressEastbrookPlacement(glow, matrix, { ...shared, surface: false });
    const glowUv = glow.getAttribute('uv');
    const uv = emissive.getAttribute('uv');
    const color = emissive.getAttribute('color');
    for (let index = 0; index < uv.count; index++) {
      expect(uv.getX(index)).toBeCloseTo(glowUv.getX(0), 6);
      expect(color.getX(index)).toBeCloseTo(1, 6);
    }
    // a corner both parts share lands in the same displaced place
    const corner = (geometry: THREE.BufferGeometry) => {
      const position = geometry.getAttribute('position');
      let best = new THREE.Vector3();
      let bestY = Number.NEGATIVE_INFINITY;
      for (let index = 0; index < position.count; index++) {
        const point = new THREE.Vector3().fromBufferAttribute(position, index);
        const score = point.y * 1000 + point.x;
        if (score > bestY) {
          bestY = score;
          best = point;
        }
      }
      return best;
    };
    expect(corner(emissive).distanceTo(corner(opaque))).toBeLessThan(1e-4);
  });
});

describe('the Weekly Vault surfaces', () => {
  function vaultMaterials(): THREE.Material[] {
    const { group } = buildEastbrookWeeklyVault(() => 0);
    const materials: THREE.Material[] = [];
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) materials.push(object.material as THREE.Material);
    });
    return materials;
  }

  it('wears the atlas with its baked relief on the Standard tiers', () => {
    setStandardMaterials(true);
    textures.atlas = new THREE.Texture();
    textures.normal = new THREE.Texture();
    textures.rough = new THREE.Texture();
    const materials = vaultMaterials();
    expect(materials).toHaveLength(8);
    for (const material of materials) {
      const standard = material as THREE.MeshStandardMaterial;
      expect(standard.isMeshStandardMaterial).toBe(true);
      expect(standard.map).toBe(textures.atlas);
      expect(standard.normalMap).toBe(textures.normal);
      expect(standard.roughnessMap).toBe(textures.rough);
      expect(standard.normalScale.toArray()).toEqual([
        EASTBROOK_SURFACE_NORMAL_SCALE,
        EASTBROOK_SURFACE_NORMAL_SCALE,
      ]);
      expect(standard.vertexColors).toBe(true);
    }
    // one clone per part (the camera fade ghosts the hall's own materials)
    expect(new Set(materials).size).toBe(8);
    // brass and steel keep their metal; the stone does not take it
    expect(materials.some((m) => (m as THREE.MeshStandardMaterial).metalness >= 0.6)).toBe(true);
    expect(materials.some((m) => (m as THREE.MeshStandardMaterial).metalness === 0)).toBe(true);
  });

  it('keeps the atlas map on Lambert, and draws plain while the atlas is missing', () => {
    setStandardMaterials(false);
    textures.atlas = new THREE.Texture();
    for (const material of vaultMaterials()) {
      expect(material).toBeInstanceOf(THREE.MeshLambertMaterial);
      expect((material as THREE.MeshLambertMaterial).map).toBe(textures.atlas);
      expect((material as THREE.MeshLambertMaterial).vertexColors).toBe(true);
    }
    textures.atlas = undefined;
    setStandardMaterials(true);
    for (const material of vaultMaterials()) {
      expect((material as THREE.MeshStandardMaterial).map).toBeNull();
      expect((material as THREE.MeshStandardMaterial).normalMap).toBeNull();
    }
  });
});
