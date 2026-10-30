import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tintedFarMaterials, tintedMaterial } from '../src/render/characters/assets';
import {
  envSheenGlsl,
  envSheenProgramKey,
  WOC_ENV_SHEEN,
} from '../src/render/characters/env_sheen_core';
import type { VisualDef } from '../src/render/characters/manifest';
import {
  applyWocArmorPaint,
  hasWocArmorPaint,
  isWocArmorMaterial,
  markWocArmorPaintScene,
  setWocArmorPaintSettingsForTest,
  WOC_ARMOR_PAINT_TAG,
  wocArmorPaintSettings,
} from '../src/render/characters/woc_armor_paint';
import {
  WOC_ARMOR_PAINT_BEGIN,
  WOC_ARMOR_PAINT_DEFAULTS,
  WOC_ARMOR_PAINT_OFF,
  wocArmorPaintBlockOf,
  wocArmorPaintProgramKey,
} from '../src/render/characters/woc_armor_paint_core';
import { type GfxSettings, type GfxTier, gfxInternalsForTest } from '../src/render/gfx';
import { cloneMaterialWithHooks } from '../src/render/material_clone_hooks';
import {
  armorFile,
  armorStoreHarness,
  releaseArmorStoreHarness,
} from './helpers/woc_armor_store_harness';

// The painted WOC armour through the REAL tinted-material factory (assets.ts
// buildTintedClone): which materials take it (an armour pack's own, tagged as the file lands,
// on every tier and mount), what it does to them (metalness 0.4 on Standard, with the env
// sheen's metal share as the sky cap, and the paint-over hook on Standard, Physical and
// Lambert alike), that the clone path keeps
// its program, and that the treatment is the same block on every graphics tier (art bible
// section 6). The GLSL itself is tests/woc_armor_paint_core.test.ts.

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: vi.fn(() => new Promise(() => undefined)),
  loadKtx2Texture: vi.fn(() => new Promise(() => undefined)),
  loadTexture: vi.fn(() => new Promise(() => undefined)),
  releaseGltf: vi.fn(),
}));
vi.mock('../src/render/assets/preload', () => ({
  registerPreload: vi.fn(),
  registerDeferredPreload: vi.fn((start: () => unknown) => start()),
}));

let restoreGfx: (() => void) | null = null;
function onTier(overrides: Partial<GfxSettings>): void {
  restoreGfx?.();
  restoreGfx = gfxInternalsForTest.overrideSettings(overrides);
}

afterEach(() => {
  restoreGfx?.();
  restoreGfx = null;
  setWocArmorPaintSettingsForTest(WOC_ARMOR_PAINT_DEFAULTS);
});

/** A full armour file's material as GLTFLoader builds it: metallicFactor 1 over an ORM pack,
 *  a normal map, KHR_materials_specular making it physical on some files. */
function armourSource(physical = false): THREE.MeshStandardMaterial {
  const orm = new THREE.Texture();
  const material = new (physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial)({
    name: physical ? 'full atlas 1' : 'full atlas 0',
    map: new THREE.Texture(),
    normalMap: new THREE.Texture(),
    metalnessMap: orm,
    roughnessMap: orm,
    aoMap: orm,
    metalness: 1,
    roughness: 1,
    side: THREE.DoubleSide,
  });
  material.userData[WOC_ARMOR_PAINT_TAG] = true;
  return material;
}

/** A WOC body's own material (the base file's suit): never armour. */
function bodySource(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    name: 'Original Character | Body Clothing',
    map: new THREE.Texture(),
    metalness: 1,
    metalnessMap: new THREE.Texture(),
    side: THREE.DoubleSide,
  });
}

/** The rig derivation a WOC body's armour mesh gets (visual.ts adoptWocArmor ->
 *  applyMaterials): untinted, body role, authored atlas, the WOC sheen. */
function derive(source: THREE.Material, mount: 'rig' | 'far' = 'rig'): THREE.Material {
  return tintedMaterial(
    source,
    null,
    0,
    null,
    null,
    'body',
    null,
    mount,
    '',
    0,
    undefined,
    false,
    true,
    WOC_ENV_SHEEN,
  );
}

/** Run a material's hook chain over the three program its class compiles from. */
function compiled(material: THREE.Material): string {
  const lambert = (material as THREE.MeshLambertMaterial).isMeshLambertMaterial;
  const physical = (material as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial;
  const lib = lambert
    ? THREE.ShaderLib.lambert
    : physical
      ? THREE.ShaderLib.physical
      : THREE.ShaderLib.standard;
  const shader = {
    uniforms: {},
    vertexShader: lib.vertexShader,
    fragmentShader: lib.fragmentShader,
  };
  material.onBeforeCompile(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    null as unknown as THREE.WebGLRenderer,
  );
  return shader.fragmentShader;
}

describe('which materials are armour', () => {
  it('tags every material of an armour parse, idempotently, and nothing else', () => {
    const scene = new THREE.Group();
    const single = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const multi = new THREE.Mesh(new THREE.BoxGeometry(), [
      new THREE.MeshStandardMaterial(),
      new THREE.MeshPhysicalMaterial(),
    ]);
    scene.add(single);
    single.add(multi);
    const elsewhere = new THREE.MeshStandardMaterial();
    markWocArmorPaintScene(scene);
    markWocArmorPaintScene(scene);
    expect(isWocArmorMaterial(single.material as THREE.Material)).toBe(true);
    for (const m of multi.material as THREE.Material[]) expect(isWocArmorMaterial(m)).toBe(true);
    expect(isWocArmorMaterial(elsewhere)).toBe(false);
  });

  it('is tagged by the armour store as a file lands (any set, so later sets take it too)', async () => {
    const parses: THREE.Object3D[] = [];
    const h = await armorStoreHarness('medium', 'now', (tier, set) => {
      const parse = armorFile(tier, set);
      parses.push(parse.scene);
      return parse;
    });
    try {
      for (const set of ['test', 'membership_plate']) {
        h.packs.ensureWocArmorPack(h.core.wocArmorPackUrl('male', set, 'medium'));
        await h.land('medium', set);
      }
      expect(parses).toHaveLength(2);
      for (const scene of parses) {
        const materials = new Set<THREE.Material>();
        scene.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) materials.add((o as THREE.Mesh).material as THREE.Material);
        });
        expect(materials.size).toBeGreaterThan(0);
        for (const m of materials) expect(m.userData[WOC_ARMOR_PAINT_TAG], m.name).toBe(true);
      }
    } finally {
      releaseArmorStoreHarness();
    }
  });
});

describe('the armour derivation on a Standard tier', () => {
  it('draws metal at 40 percent under the env sheen sky cap, with the paint hook last', () => {
    onTier({ standardMaterials: true });
    for (const physical of [false, true]) {
      const source = armourSource(physical);
      const mat = derive(source) as THREE.MeshStandardMaterial;
      expect(mat).not.toBe(source);
      expect(mat.metalness, `physical ${physical}`).toBe(0.4);
      // no envMapIntensity cap: three never reads it under scene.environment, so the sky cap
      // is the env sheen's metal share, in the shader (asserted on the compiled text below)
      expect(mat.envMapIntensity).toBe(1);
      // the existing body band still holds the scalar (the shader floors the texels)
      expect(mat.roughness).toBeCloseTo(0.9, 5);
      expect(hasWocArmorPaint(mat)).toBe(true);
      expect(mat.customProgramCacheKey()).toContain(
        wocArmorPaintProgramKey(WOC_ARMOR_PAINT_DEFAULTS),
      );
      // the env sheen and the rim are still there, under it
      expect(mat.customProgramCacheKey()).toContain(envSheenProgramKey(WOC_ENV_SHEEN));
      expect(mat.customProgramCacheKey()).toContain('pbr-rim-reuse');
      const out = compiled(mat);
      expect(out).toContain(WOC_ARMOR_PAINT_BEGIN);
      expect(out).toContain(envSheenGlsl(WOC_ENV_SHEEN));
      // the source GLB material is never written to
      expect(source.metalness).toBe(1);
      expect(source.envMapIntensity).toBe(1);
      expect(hasWocArmorPaint(source)).toBe(false);
    }
  });

  it('leaves every non-armour body material exactly as it was', () => {
    onTier({ standardMaterials: true });
    const body = derive(bodySource()) as THREE.MeshStandardMaterial;
    expect(body.metalness).toBe(1);
    expect(body.envMapIntensity).toBe(1);
    expect(hasWocArmorPaint(body)).toBe(false);
    expect(isWocArmorMaterial(body)).toBe(false);
    expect(body.customProgramCacheKey()).not.toContain('woc-armor-paint');
    expect(compiled(body)).not.toContain(WOC_ARMOR_PAINT_BEGIN);
  });

  it('paints the far mount too, on its own clone object (the far bake derives from the file)', () => {
    onTier({ standardMaterials: true });
    const source = armourSource();
    const rig = derive(source);
    const def = { envSheen: WOC_ENV_SHEEN, authoredAtlas: true } as unknown as VisualDef;
    const [far] = tintedFarMaterials(def, 0xffffff, [source], [false]);
    expect(far).not.toBe(rig);
    expect(hasWocArmorPaint(far)).toBe(true);
    expect((far as THREE.MeshStandardMaterial).metalness).toBe(0.4);
  });

  it('keys one program for every armour material of the session, whatever the set', () => {
    onTier({ standardMaterials: true });
    const a = derive(armourSource());
    const b = derive(armourSource());
    expect(a).not.toBe(b);
    expect(b.customProgramCacheKey()).toBe(a.customProgramCacheKey());
    expect(compiled(b)).toBe(compiled(a));
    // the hook is pure: a second (dry) compile of the same material is the same program
    expect(compiled(a)).toBe(compiled(a));
  });
});

describe('the armour derivation on the Lambert tiers (Low, iOS)', () => {
  it('carries the same paint hook on the Lambert rebuild, tag and all', () => {
    onTier({ standardMaterials: false });
    const source = armourSource();
    const lambert = derive(source);
    expect((lambert as THREE.MeshLambertMaterial).isMeshLambertMaterial).toBe(true);
    expect(isWocArmorMaterial(lambert)).toBe(true);
    expect(hasWocArmorPaint(lambert)).toBe(true);
    expect(compiled(lambert)).toContain(WOC_ARMOR_PAINT_BEGIN);
    // ...and the suit next to it stays the plain Lambert
    const body = derive(bodySource());
    expect(hasWocArmorPaint(body)).toBe(false);
    expect(compiled(body)).not.toContain(WOC_ARMOR_PAINT_BEGIN);
  });
});

describe('the actor treatment is identical across tiers (art bible section 6)', () => {
  it('compiles the very same paint block on every preset, desktop and iOS', () => {
    const tiers: GfxTier[] = ['low', 'medium', 'high', 'ultra', 'insane'];
    const blocks = new Map<string, string>();
    for (const tier of tiers) {
      for (const platform of ['other', 'ios'] as const) {
        onTier(gfxInternalsForTest.settingsFor(tier, { platform }));
        const mat = derive(armourSource());
        expect(hasWocArmorPaint(mat), `${tier} ${platform}`).toBe(true);
        blocks.set(`${tier}/${platform}`, wocArmorPaintBlockOf(compiled(mat)));
      }
    }
    // both material classes are in the sweep (Lambert below medium and on iOS)
    expect(gfxInternalsForTest.settingsFor('low').standardMaterials).toBe(false);
    expect(gfxInternalsForTest.settingsFor('high').standardMaterials).toBe(true);
    const first = [...blocks.values()][0];
    expect(first.length).toBeGreaterThan(0);
    for (const [where, block] of blocks) expect(block, where).toBe(first);
    // read off one settings value that takes no tier input
    expect(wocArmorPaintSettings()).toEqual(WOC_ARMOR_PAINT_DEFAULTS);
  });
});

describe('the program-preserving clone (material_clone_hooks.ts)', () => {
  it('gives an effect clone the layer back with the exact program key', () => {
    for (const standard of [true, false]) {
      onTier({ standardMaterials: standard });
      const painted = derive(armourSource());
      const clone = cloneMaterialWithHooks(painted);
      expect(clone).not.toBe(painted);
      expect(hasWocArmorPaint(clone), `standard ${standard}`).toBe(true);
      expect(clone.customProgramCacheKey()).toBe(painted.customProgramCacheKey());
      expect(compiled(clone)).toBe(compiled(painted));
      // the capped factors ride the clone (copy), and are not capped twice
      if (standard) expect((clone as THREE.MeshStandardMaterial).metalness).toBe(0.4);
    }
  });

  it('never grants the layer to a clone of a material that did not carry it', () => {
    onTier({ standardMaterials: true });
    // the raw GLB material is tagged, but only a derivation carries the hook
    const raw = armourSource();
    const clone = cloneMaterialWithHooks(raw);
    expect(isWocArmorMaterial(clone)).toBe(true);
    expect(hasWocArmorPaint(clone)).toBe(false);
    expect(compiled(clone)).not.toContain(WOC_ARMOR_PAINT_BEGIN);
  });
});

describe('the off switches', () => {
  it('draws the stock armour under armorpaint=off: no cap, no hook, the untagged program', () => {
    onTier({ standardMaterials: true });
    setWocArmorPaintSettingsForTest(null);
    const stock = derive(armourSource()) as THREE.MeshStandardMaterial;
    expect(stock.metalness).toBe(1);
    expect(stock.envMapIntensity).toBe(1);
    expect(hasWocArmorPaint(stock)).toBe(false);
    const untagged = armourSource();
    delete untagged.userData[WOC_ARMOR_PAINT_TAG];
    expect(stock.customProgramCacheKey()).toBe(derive(untagged).customProgramCacheKey());
    expect(compiled(stock)).toBe(compiled(derive(untagged)));
  });

  it('adds no layer with every paint knob at zero (the program is the stock one)', () => {
    onTier({ standardMaterials: true });
    setWocArmorPaintSettingsForTest(WOC_ARMOR_PAINT_OFF);
    const mat = derive(armourSource());
    expect(hasWocArmorPaint(mat)).toBe(false);
    const untagged = armourSource();
    delete untagged.userData[WOC_ARMOR_PAINT_TAG];
    expect(compiled(mat)).toBe(compiled(derive(untagged)));
    expect(mat.customProgramCacheKey()).toBe(derive(untagged).customProgramCacheKey());
  });

  it('is a no-op for a source that is not armour, whatever it is handed', () => {
    const target = new THREE.MeshStandardMaterial({ metalness: 1 });
    applyWocArmorPaint(target, new THREE.MeshStandardMaterial());
    expect(target.metalness).toBe(1);
    expect(hasWocArmorPaint(target)).toBe(false);
    expect(isWocArmorMaterial(target)).toBe(false);
  });
});
