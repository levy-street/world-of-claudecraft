// The Warrior kit's programs are prepared at boot, for every class, by the
// cast warm-up's walk over the kit family (castVfxProgramUnits). The kit's
// sheets and fragment geometry land much later, at the first Warrior seen.
// These pins prove, on three's own program keys (tests/helpers/
// three_program_keys.ts), that the boot walk prepares exactly the programs
// the kit draws once everything bound: the same keys before and after the
// kit recipe, on every tier and on both colour targets (the canvas a direct
// tier draws to, and the offscreen target of the composer tiers and of the
// Low upload twins). And that a phone, which declines the kit, prepares none.

import * as THREE from 'three';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/assets/loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/render/assets/loader')>()),
  loadTexture: vi.fn(async () => ({ image: null })),
  releaseTexture: vi.fn(),
}));
vi.mock('../src/render/assets/preload', () => ({
  registerPreload: vi.fn(),
  registerDeferredPreload: vi.fn(),
}));

import type { GraphicsSettingsSnapshot } from '../src/game/graphics_rebuild_core';
import { ACTIVE_WARRIOR_CRESTS } from '../src/render/ability_vfx/active_kit_prewarm';
import * as contact from '../src/render/ability_vfx/contact_assets';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { collectAbilityVfxCompileTargets } from '../src/render/ability_vfx/prewarm';
import * as assets from '../src/render/ability_vfx/production_assets';
import type { SolidImpactFragments } from '../src/render/ability_vfx/solid_impact_fragments';
import type { WarriorFuryStates } from '../src/render/ability_vfx/warrior_fury_states';
import type { WarriorGuardPlates } from '../src/render/ability_vfx/warrior_guard_plates';
import { warriorKitSlotMap } from '../src/render/ability_vfx/warrior_kit_surface';
import type { WarriorPowerForms } from '../src/render/ability_vfx/warrior_power_forms';
import type { WarriorSpiritHammers } from '../src/render/ability_vfx/warrior_spirit_hammers';
import { inCastVfxEngine, inCastVfxKit } from '../src/render/cast_vfx_family';
import {
  castVfxProgramUnits,
  createSceneCastVfxReadiness,
  warriorKitDeclinedByDevice,
} from '../src/render/cast_vfx_prewarm';
import type { CompileArmHost } from '../src/render/compile_arms';
import {
  activateGfxProfile,
  type GfxCapabilities,
  type GfxTier,
  resolveGfxProfile,
} from '../src/render/gfx';
import { createVfxAnchor } from '../src/render/vfx_anchor';
import { installCastVfxCanvasStub } from './helpers/cast_vfx_headless';
import { activateTier, gfxProfileRestorer } from './helpers/gfx_tier';
import { drawsUnder, threeProgramKeys } from './helpers/three_program_keys';

afterAll(gfxProfileRestorer());
afterEach(() => {
  vi.restoreAllMocks();
  assets.productionAssetInternalsForTest.reset();
});

const TIERS: readonly GfxTier[] = ['low', 'medium', 'high', 'ultra'];
const offscreen = new THREE.WebGLRenderTarget(8, 8);
const TARGETS = [
  ['canvas', null],
  ['offscreen', offscreen],
] as const;

/** The kit pools AbilityVfxFx builds, which it keeps private. */
interface KitPools {
  guards: WarriorGuardPlates;
  spiritHammers: WarriorSpiritHammers;
  furyStates: WarriorFuryStates;
  powerForms: WarriorPowerForms;
  fragments: SolidImpactFragments;
}

function kitScene() {
  installCastVfxCanvasStub();
  const scene = new THREE.Scene();
  const fx = new AbilityVfxFx(
    scene,
    new THREE.PerspectiveCamera(),
    createVfxAnchor(() => false),
    () => 0,
  );
  return { scene, fx, pools: fx as unknown as KitPools };
}

/** The objects the kit draws with: every kit-tagged drawable, the fragment
 *  batches the kit recipe builds included, never a hidden prewarm carrier. */
function kitDrawables(scene: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  scene.traverse((object) => {
    if (inCastVfxKit(object) && (object as THREE.Mesh).material) out.push(object as THREE.Mesh);
  });
  return out;
}

const keyOf = (mesh: THREE.Mesh, target: THREE.WebGLRenderTarget | null) =>
  threeProgramKeys(mesh.material as THREE.Material, mesh, target);

/** The keys the boot walk links: the kit family's compile targets. */
function bootKeys(scene: THREE.Object3D, target: THREE.WebGLRenderTarget | null): Set<string> {
  const keys = new Set<string>();
  for (const { object } of collectAbilityVfxCompileTargets(scene)) {
    if (!inCastVfxKit(object)) continue;
    for (const draw of drawsUnder(object)) {
      keys.add(threeProgramKeys(draw.material, draw.object, target));
    }
  }
  return keys;
}

/** The kit's demand load landing: every sheet, map and fragment geometry. */
function landKitAssets() {
  const sheet = () => {
    const texture = new THREE.Texture();
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };
  const maps = {
    blood: sheet(),
    steel: sheet(),
    rock: sheet(),
    pressure: sheet(),
  };
  vi.spyOn(assets, 'warriorBloodTexture').mockReturnValue(maps.blood);
  vi.spyOn(assets, 'warriorSteelTexture').mockReturnValue(maps.steel);
  vi.spyOn(assets, 'warriorRockTexture').mockReturnValue(maps.rock);
  vi.spyOn(assets, 'warriorPressureTexture').mockReturnValue(maps.pressure);
  vi.spyOn(assets, 'bakedTexture').mockReturnValue(sheet());
  vi.spyOn(contact, 'contactTexture').mockReturnValue(sheet());
  vi.spyOn(assets, 'fragmentGeometry').mockImplementation(
    () => new THREE.IcosahedronGeometry(1, 0),
  );
  return maps;
}

/** The kit recipe's geometry units, run in order over a host whose compile
 *  resolves at once and whose one program answers ready. */
async function runKitRecipe(fx: AbilityVfxFx): Promise<string[]> {
  const program = { isReady: () => true, getUniforms: () => ({}), getAttributes: () => ({}) };
  const host = {
    properties: { get: () => ({ programs: new Map([['flat', program]]) }) },
    compile: async () => {},
    draw: () => {},
  };
  const ran: string[] = [];
  for (const unit of fx.authoredPrewarmUnits(host, ACTIVE_WARRIOR_CRESTS)) {
    await unit.run();
    ran.push(unit.id);
  }
  return ran;
}

for (const tier of TIERS) {
  describe(`the Warrior kit's boot programs on ${tier}`, () => {
    beforeEach(() => activateTier(tier));

    for (const [label, target] of TARGETS) {
      it(`prepares at boot exactly the programs the kit draws (${label})`, async () => {
        const { scene, fx, pools } = kitScene();
        const boot = bootKeys(scene, target);
        const before = new Map(kitDrawables(scene).map((mesh) => [mesh, keyOf(mesh, target)]));
        const versions = new Map(
          [...before.keys()].map((mesh) => [mesh, (mesh.material as THREE.Material).version]),
        );
        const maps = landKitAssets();
        const ran = await runKitRecipe(fx);
        expect(ran.filter((id) => id.endsWith(':bind') || id === 'guard-bind-steel')).toHaveLength(
          8,
        );
        expect(ran.filter((id) => id.startsWith('fragment-build:'))).toHaveLength(3);
        // The sheets really bound: the drawn state below is the live one.
        expect(pools.guards.mesh.material.map).toBe(maps.steel);
        expect(pools.furyStates.meshes.map((mesh) => mesh.material.map)).toEqual([
          maps.blood,
          maps.blood,
          maps.steel,
        ]);
        expect(pools.powerForms.meshes.map((mesh) => mesh.material.map)).toEqual([
          maps.rock,
          maps.blood,
          maps.rock,
          maps.rock,
        ]);

        const after = kitDrawables(scene);
        // The recipe built the three fragment batches the boot walk never saw.
        expect(after.length).toBe(before.size + 3);
        const drawn = new Set(after.map((mesh) => keyOf(mesh, target)));
        expect(drawn).toEqual(boot);
        // The bind swapped textures only: no drawable's key or material
        // version moved, so no program is relinked at load.
        for (const [mesh, key] of before) {
          expect(keyOf(mesh, target), mesh.name).toBe(key);
          expect((mesh.material as THREE.Material).version, mesh.name).toBe(versions.get(mesh));
        }
        fx.dispose();
      });
    }

    it("draws the Storm Bolt hammer with the guard plates' program", () => {
      const { fx, pools } = kitScene();
      for (const [, target] of TARGETS) {
        expect(keyOf(pools.spiritHammers.mesh, target)).toBe(keyOf(pools.guards.mesh, target));
      }
      expect(pools.spiritHammers.mesh.material.map).toBe(warriorKitSlotMap());
      fx.dispose();
    });

    it('holds a map slot on every mapped kit surface from construction', () => {
      const { fx, pools } = kitScene();
      const surfaces = [
        pools.guards.mesh,
        pools.spiritHammers.mesh,
        ...pools.furyStates.meshes,
        ...pools.powerForms.meshes,
      ];
      for (const mesh of surfaces) expect(mesh.material.map, mesh.name).toBe(warriorKitSlotMap());
      fx.dispose();
    });
  });
}

const phoneCapabilities: GfxCapabilities = Object.freeze({
  deviceMemory: 4,
  hardwareConcurrency: 8,
  maxTouchPoints: 5,
  coarsePointer: true,
  narrowViewport: true,
  gpuRenderer: 'ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)',
  nativeApp: false,
  tightMemory: false,
  platform: 'android',
  softwareRendering: false,
});

const preferences: GraphicsSettingsSnapshot = {
  graphicsPreset: 2,
  terrainDetail: 1,
  foliageDensity: 1,
  surfaceDetail: 1,
  effectsQuality: 1,
  shadowQuality: 1,
  antiAliasing: 1,
  bloomQuality: 1,
  ambientOcclusion: 1,
  viewDistance: 1,
  waterQuality: 1,
  characterDetail: 1,
  dynamicLights: 1,
  particleEffects: 1,
  ghostFade: 1,
};
const activatePhone = () => {
  activateGfxProfile(resolveGfxProfile(phoneCapabilities, preferences, ''));
  expect(warriorKitDeclinedByDevice()).toBe(true);
};

describe('a phone, which declines the kit', () => {
  const webgl = { properties: { get: () => ({ currentProgram: null }) } };
  const compileUnits = (scene: THREE.Object3D) =>
    castVfxProgramUnits(scene, null, {} as CompileArmHost, webgl, async () => {});

  it('declines by the device answer the renderer hands the kit load', () => {
    activatePhone();
    activateTier('low');
    expect(warriorKitDeclinedByDevice()).toBe(false);
  });

  it('links no kit program at boot, and keeps every engine one', () => {
    activateTier('low');
    const { scene, fx } = kitScene();
    const desktop = compileUnits(scene).flatMap((unit) => (unit.roots ?? []) as THREE.Object3D[]);
    expect(desktop.some(inCastVfxKit)).toBe(true);
    activatePhone();
    const phone = compileUnits(scene).flatMap((unit) => (unit.roots ?? []) as THREE.Object3D[]);
    expect(phone.length).toBeGreaterThan(0);
    expect(phone.filter(inCastVfxKit)).toEqual([]);
    expect(phone.filter(inCastVfxEngine)).toEqual(desktop.filter(inCastVfxEngine));
    expect(phone).toEqual(desktop.filter((root) => !inCastVfxKit(root)));
    fx.dispose();
  });

  it('stands the kit family down from the first read, before any Warrior is seen', () => {
    activatePhone();
    const { scene, fx } = kitScene();
    expect(assets.warriorKitAssetsState()).toBe('idle');
    const kit = createSceneCastVfxReadiness(scene, webgl, () => 0)
      .snapshot()
      .families.find((family) => family.id === 'kit');
    expect(kit).toMatchObject({ declined: true, pending: null });
    activateTier('low');
    const desktop = createSceneCastVfxReadiness(scene, webgl, () => 0)
      .snapshot()
      .families.find((family) => family.id === 'kit');
    expect(desktop).toMatchObject({ declined: false });
    expect(desktop?.pending).toBeGreaterThan(0);
    fx.dispose();
  });
});
