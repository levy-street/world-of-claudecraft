// The Warrior kit's lit surfaces take the tier's material family: MeshStandard
// where the tier draws standard materials, Lambert on Low and the iOS memory
// profile, with the base colour matched to MeshStandard's diffuse term
// (scaled by 1 - metalness), so only the specular highlight goes. The rage
// flame's hook keeps its shape on both families. Driven through the real
// pools, so the parameters pinned are the shipped ones.

import * as THREE from 'three';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/ability_vfx/production_assets', async () => ({
  warriorPressureTexture: () => null,
  warriorRockTexture: () => null,
  warriorSteelTexture: () => null,
  warriorBloodTexture: () => null,
}));

import type { GraphicsSettingsSnapshot } from '../src/game/graphics_rebuild_core';
import { abilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import { WarriorFuryStates } from '../src/render/ability_vfx/warrior_fury_states';
import { WarriorGuardPlates } from '../src/render/ability_vfx/warrior_guard_plates';
import {
  warriorKitSlotMap,
  warriorKitSurface,
} from '../src/render/ability_vfx/warrior_kit_surface';
import { WarriorPowerForms } from '../src/render/ability_vfx/warrior_power_forms';
import { WarriorSpiritHammers } from '../src/render/ability_vfx/warrior_spirit_hammers';
import { activateGfxProfile, GFX, type GfxTier, resolveGfxProfile } from '../src/render/gfx';
import { createVfxAnchor } from '../src/render/vfx_anchor';
import { installCastVfxCanvasStub } from './helpers/cast_vfx_headless';
import { activateTier, gfxProfileRestorer } from './helpers/gfx_tier';

afterAll(gfxProfileRestorer());

/** Each solid surface's MeshStandard parameters, as the release shipped them. */
const SOLIDS = [
  ['warrior-held-guard-plates', 0.4, 0.2],
  ['warrior-spirit-hammers', 0.38, 0.35],
  ['warrior-avatar-chest', 0.96, 0.025],
  ['warrior-avatar-bracers', 0.96, 0.025],
  ['warrior-avatar-shins', 0.96, 0.025],
] as const;

function builtSurfaces(): Map<string, THREE.Material> {
  const scene = new THREE.Scene();
  const guards = new WarriorGuardPlates(scene);
  const hammers = new WarriorSpiritHammers(scene);
  const power = new WarriorPowerForms(scene);
  const out = new Map<string, THREE.Material>();
  for (const mesh of [guards.mesh, hammers.mesh, ...power.meshes])
    out.set(mesh.name, mesh.material);
  return out;
}

const standardTiers: readonly GfxTier[] = ['medium', 'high', 'ultra'];

describe('the kit surface family per tier', () => {
  it('draws Lambert on Low, with the diffuse matched to the standard look', () => {
    activateTier('low');
    expect(GFX.standardMaterials).toBe(false);
    const surfaces = builtSurfaces();
    for (const [name, , metalness] of SOLIDS) {
      const material = surfaces.get(name) as THREE.MeshLambertMaterial;
      expect(material, name).toBeInstanceOf(THREE.MeshLambertMaterial);
      expect(material.name).toBe(name);
      for (const channel of ['r', 'g', 'b'] as const) {
        expect(material.color[channel], name).toBeCloseTo(1 - metalness, 6);
      }
      expect(material.emissive.getHex()).toBe(0xffffff);
      expect(material.vertexColors).toBe(true);
    }
    // The reckless crown is a rage flame: non-metal on the standard tiers, so
    // its matched diffuse stays unscaled.
    const crown = surfaces.get('warrior-reckless-crown') as THREE.MeshLambertMaterial;
    expect(crown).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(crown.color.getHex()).toBe(0xffffff);
    expect(crown.emissiveIntensity).toBe(1.6);
  });

  for (const tier of standardTiers) {
    it(`keeps MeshStandard with its roughness and metalness on ${tier}`, () => {
      activateTier(tier);
      const surfaces = builtSurfaces();
      for (const [name, roughness, metalness] of SOLIDS) {
        const material = surfaces.get(name) as THREE.MeshStandardMaterial;
        expect(material, name).toBeInstanceOf(THREE.MeshStandardMaterial);
        expect(material.name).toBe(name);
        expect(material.roughness).toBe(roughness);
        expect(material.metalness).toBe(metalness);
        expect(material.color.getHex()).toBe(0xffffff);
      }
      const crown = surfaces.get('warrior-reckless-crown') as THREE.MeshStandardMaterial;
      expect(crown).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect([crown.roughness, crown.metalness]).toEqual([1, 0]);
      installCastVfxCanvasStub();
      const fury = new WarriorFuryStates(
        new THREE.Scene(),
        createVfxAnchor(() => false),
        abilityVfxTextures(),
      );
      const [fire, ...marks] = fury.meshes.map(
        (mesh) => mesh.material as THREE.MeshStandardMaterial,
      );
      for (const material of [fire, ...marks]) {
        expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
      }
      expect([fire.roughness, fire.metalness]).toEqual([1, 0]);
      for (const material of marks) {
        expect([material.roughness, material.metalness]).toEqual([0.65, 0.12]);
        expect(material.color.getHex()).toBe(0xffffff);
      }
      fury.dispose();
    });
  }

  it('draws Lambert on the iOS memory profile at any preset', () => {
    const preferences: GraphicsSettingsSnapshot = {
      graphicsPreset: 4,
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
    activateGfxProfile(
      resolveGfxProfile(
        {
          deviceMemory: 8,
          hardwareConcurrency: 8,
          maxTouchPoints: 5,
          coarsePointer: true,
          narrowViewport: false,
          gpuRenderer: 'Apple GPU',
          nativeApp: false,
          tightMemory: false,
          platform: 'ios',
          softwareRendering: false,
        },
        preferences,
        '?gfx=ultra',
      ),
    );
    expect(GFX.standardMaterials).toBe(false);
    const surfaces = builtSurfaces();
    for (const [name, , metalness] of SOLIDS) {
      const material = surfaces.get(name) as THREE.MeshLambertMaterial;
      expect(material, name).toBeInstanceOf(THREE.MeshLambertMaterial);
      expect(material.color.r, name).toBeCloseTo(1 - metalness, 6);
    }
  });

  it('carries every non-lighting parameter over to Lambert', () => {
    activateTier('low');
    const map = new THREE.Texture();
    // three warns on every parameter the material family lacks, so a clean
    // build proves the standard-only ones were left out.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const material = warriorKitSurface('probe', {
      color: 0x808080,
      vertexColors: true,
      map,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      roughness: 0.65,
      metalness: 0.5,
      emissive: 0x123456,
      emissiveIntensity: 3.4,
    }) as THREE.MeshLambertMaterial;
    expect(material).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(material.map).toBe(map);
    expect([material.transparent, material.depthWrite, material.side]).toEqual([
      true,
      false,
      THREE.DoubleSide,
    ]);
    expect(material.emissive.getHex()).toBe(0x123456);
    expect(material.emissiveIntensity).toBe(3.4);
    const base = new THREE.Color(0x808080);
    expect(material.color.r).toBeCloseTo(base.r * 0.5, 6);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('the Fury states on Lambert', () => {
  it('match the marks to their 0.12 metalness and keep the weapon fire unscaled', () => {
    activateTier('low');
    installCastVfxCanvasStub();
    const fury = new WarriorFuryStates(
      new THREE.Scene(),
      createVfxAnchor(() => false),
      abilityVfxTextures(),
    );
    const [fire, stitches, echoes] = fury.meshes.map((mesh) => mesh.material);
    for (const material of [fire, stitches, echoes]) {
      expect(material).toBeInstanceOf(THREE.MeshLambertMaterial);
      expect([material.transparent, material.side]).toEqual([true, THREE.DoubleSide]);
    }
    expect(fire.color.getHex()).toBe(0xffffff);
    expect(fire.blending).toBe(THREE.AdditiveBlending);
    for (const material of [stitches, echoes]) expect(material.color.r).toBeCloseTo(0.88, 6);
    expect([stitches.emissiveIntensity, echoes.emissiveIntensity]).toEqual([3.4, 0.8]);
    expect(fury.meshes.map((mesh) => mesh.material.name)).toEqual([
      'warrior-mayhem-weapon-fire',
      'warrior-mending-stitches',
      'warrior-echo-charges',
    ]);
    fury.dispose();
  });
});

describe('the rage flame on Lambert', () => {
  it('compiles its hook on the Lambert shader and keeps the flame unscaled', () => {
    activateTier('low');
    const power = new WarriorPowerForms(new THREE.Scene());
    const material = power.meshes[1].material;
    expect(material).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(material.customProgramCacheKey()).toContain('warrior-rage-flame-v4');
    expect(material.customProgramCacheKey()).toContain('vertex-color-emissive-v1');
    const shader = {
      ...THREE.ShaderLib.lambert,
      uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.lambert.uniforms),
    } as Parameters<typeof material.onBeforeCompile>[0];
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain('vRagePosition=position;');
    expect(shader.fragmentShader).toContain('diffuseColor.a*=rageDensity*.87;');
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance*=.18+rageTip*.62;');
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance *= vColor.rgb');
    expect(material.blending).toBe(THREE.AdditiveBlending);
    expect(material.color.getHex()).toBe(0xffffff);
    power.dispose();
  });
});

describe('the shared slot map', () => {
  it('is one white texel on channel 0, never a video texture', () => {
    const map = warriorKitSlotMap();
    expect(warriorKitSlotMap()).toBe(map);
    expect(map.image).toMatchObject({ width: 1, height: 1 });
    expect([...(map.image as { data: Uint8Array }).data]).toEqual([255, 255, 255, 255]);
    expect(map.channel).toBe(0);
    expect((map as THREE.Texture & { isVideoTexture?: boolean }).isVideoTexture).not.toBe(true);
  });
});
