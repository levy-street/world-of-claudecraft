// The Warrior kit's textures (nine baked sheets, one 4096px, three contact
// sheets, three material maps, the fragment GLB) decode to well over 150 MB of
// RGBA. They are loaded ON DEMAND, once per page, when the active kit is
// requested (a local Warrior at entry, or the first remote Warrior the painter
// sees), declined outright on constrained-memory devices (the kit stays cold
// and the generic presentation runs), and the WebP sheets keep a mip chain so
// a distant contact does not sample a 2048px sheet texel by texel. Nothing
// here may ride the deferred preload lane again.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/assets/loader', async () => {
  const THREE = await import('three');
  return {
    loadTexture: vi.fn(async () => new THREE.Texture()),
    loadKtx2Texture: vi.fn(async () => new THREE.Texture()),
    loadGltf: vi.fn(async () => {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry());
      return {
        scene: {
          updateMatrixWorld(): void {},
          getObjectByName: (name: string) => Object.assign(mesh, { name }),
        },
      };
    }),
    releaseGltf: vi.fn(),
  };
});

import {
  activeKitPrewarmEntry,
  cancelActiveAbilityKit,
  ensureActiveAbilityKit,
  resumeActiveAbilityKit,
} from '../src/render/ability_vfx/active_kit_prewarm';
import { BakedImpactLayers } from '../src/render/ability_vfx/baked_impact_layers';
import {
  contactAssetInternalsForTest,
  contactTexture,
  ensureContactSheets,
} from '../src/render/ability_vfx/contact_assets';
import type { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import {
  AbilityVfx,
  type AbilityVfxDeps,
  type AbilityVfxEntityState,
} from '../src/render/ability_vfx/painter';
import {
  bakedTexture,
  ensureWarriorKitAssets,
  productionAssetInternalsForTest,
  warriorBloodTexture,
  warriorKitAssetsState,
  warriorPressureTexture,
  warriorSteelTexture,
} from '../src/render/ability_vfx/production_assets';
import * as loader from '../src/render/assets/loader';

const loadTexture = vi.mocked(loader.loadTexture);
const loadKtx2Texture = vi.mocked(loader.loadKtx2Texture);

beforeEach(() => {
  productionAssetInternalsForTest.reset();
  contactAssetInternalsForTest.reset();
  loadTexture.mockClear();
  loadKtx2Texture.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe('ensureWarriorKitAssets', () => {
  it('declines on a constrained-memory device without touching a loader', async () => {
    await expect(ensureWarriorKitAssets(true)).resolves.toBe(false);
    expect(warriorKitAssetsState()).toBe('declined');
    expect(loadTexture).not.toHaveBeenCalled();
    expect(loadKtx2Texture).not.toHaveBeenCalled();
    expect(bakedTexture('smoke')).toBeNull();
    expect(warriorSteelTexture()).toBeNull();
    expect(contactTexture('contact_cut')).toBeNull();
  });

  it('loads every sheet, map and contact sheet exactly once, joining a second request', async () => {
    const first = ensureWarriorKitAssets(false);
    expect(warriorKitAssetsState()).toBe('loading');
    expect(ensureWarriorKitAssets(false)).toBe(first);
    await expect(first).resolves.toBe(true);
    expect(warriorKitAssetsState()).toBe('ready');
    // eight WebP baked sheets plus pressure, blood, steel and rock
    expect(loadTexture).toHaveBeenCalledTimes(12);
    // the KTX2 crush sheet plus the three contact sheets
    expect(loadKtx2Texture).toHaveBeenCalledTimes(4);
    for (const kind of [
      'smoke',
      'shout_dust',
      'warrior_power',
      'warrior_fervor',
      'harvest_impact',
      'warrior_bite',
      'warrior_shear',
      'warrior_crush',
      'shockwave',
    ] as const) {
      expect(bakedTexture(kind), kind).not.toBeNull();
    }
    expect(contactTexture('contact_cut')).not.toBeNull();
    expect(contactTexture('contact_crush')).not.toBeNull();
    expect(contactTexture('contact_pierce')).not.toBeNull();
    await ensureWarriorKitAssets(false);
    expect(loadTexture).toHaveBeenCalledTimes(12);
  });

  it('keeps a mip chain on the WebP sheets and leaves the KTX2 and data maps alone', async () => {
    await ensureWarriorKitAssets(false);
    const smoke = bakedTexture('smoke');
    expect(smoke?.generateMipmaps).toBe(true);
    expect(smoke?.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(smoke?.magFilter).toBe(THREE.LinearFilter);
    const crush = bakedTexture('warrior_crush');
    expect(crush?.generateMipmaps).toBe(false);
    expect(crush?.minFilter).toBe(THREE.LinearFilter);
    expect(warriorBloodTexture()?.generateMipmaps).toBe(true);
    expect(warriorSteelTexture()?.generateMipmaps).toBe(true);
    expect(warriorPressureTexture()?.generateMipmaps).toBe(false);
    expect(warriorPressureTexture()?.colorSpace).toBe(THREE.NoColorSpace);
  });

  it('retries after a failed load instead of caching the failure', async () => {
    loadKtx2Texture.mockRejectedValueOnce(new Error('offline'));
    await expect(ensureWarriorKitAssets(false)).rejects.toThrow('offline');
    expect(warriorKitAssetsState()).toBe('failed');
    contactAssetInternalsForTest.reset();
    await expect(ensureWarriorKitAssets(false)).resolves.toBe(true);
  });

  it('loads the contact sheets once even when requested on their own first', async () => {
    const first = ensureContactSheets();
    expect(ensureContactSheets()).toBe(first);
    await first;
    expect(loadKtx2Texture).toHaveBeenCalledTimes(3);
    await ensureWarriorKitAssets(false);
    expect(loadKtx2Texture).toHaveBeenCalledTimes(4);
  });
});

describe('the eager preload is gone for good', () => {
  it.each(['production_assets', 'contact_assets'])(
    '%s registers nothing on the deferred preload lane',
    (name) => {
      const source = readFileSync(
        new URL(`../src/render/ability_vfx/${name}.ts`, import.meta.url),
        'utf8',
      );
      expect(source).not.toContain('registerDeferredPreload');
      expect(source).not.toContain('assets/preload');
    },
  );

  it('the renderer resumes the LOCAL class at entry and hands the kit its demand loader', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(source).toContain(
      'resumeActiveAbilityKit(this.scene, options.resumeAfterFirstPaint, this.sim.cfg.playerClass);',
    );
    expect(source).toContain('assets: () => ensureWarriorKitAssets(GFX.constrainedMemory),');
    expect(source).not.toContain('abilityVfxBootTextureDependencies');
  });
});

describe('the active kit waits for its assets', () => {
  function host(assets: () => Promise<boolean>) {
    const texture = vi.fn();
    const scene = {};
    activeKitPrewarmEntry(scene, 'warrior', {
      queue: { run: async (fn: () => unknown) => fn() },
      geometry: () => [],
      texture,
      assets,
    } as never);
    return { scene, texture };
  }

  it('runs no unit when the device declined the assets', async () => {
    const assets = vi.fn(async () => false);
    const h = host(assets);
    await ensureActiveAbilityKit(h.scene);
    expect(assets).toHaveBeenCalledTimes(1);
    expect(h.texture).not.toHaveBeenCalled();
  });

  it('asks for the assets before the first unit and only once per preparation', async () => {
    let resolved = false;
    const assets = vi.fn(
      () =>
        new Promise<boolean>((resolve) =>
          setTimeout(() => {
            resolved = true;
            resolve(false);
          }, 0),
        ),
    );
    const h = host(assets);
    const task = ensureActiveAbilityKit(h.scene);
    expect(assets).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(false);
    await task;
    expect(resolved).toBe(true);
    await ensureActiveAbilityKit(h.scene);
    expect(assets).toHaveBeenCalledTimes(2);
    expect(h.texture).not.toHaveBeenCalled();
  });
});

// The production shape the tests above never had: the kit's textures are NOT
// injected, the host's assets() is the real demand loader and resolves late,
// and the geometry host enumerates the real baked pool, whose units need the
// resident Red Harvest sheet. The recipe used to be built before the load was
// requested, so it threw and the kit never loaded for any Warrior.
describe('the active kit loads its own assets before its recipe', () => {
  function lateKit(localClass: string) {
    const scene = new THREE.Scene();
    const pool = new BakedImpactLayers(scene);
    const program = { isReady: () => true, getUniforms: vi.fn(), getAttributes: vi.fn() };
    const gpu = {
      properties: { get: () => ({ programs: new Map([['flat', program]]) }) },
      compile: vi.fn(async () => {}),
      draw: vi.fn(),
    };
    let arrive!: () => void;
    const arrived = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    const assets = vi.fn(async () => {
      await arrived;
      return ensureWarriorKitAssets(false);
    });
    const texture = vi.fn();
    const entry = activeKitPrewarmEntry(scene, localClass, {
      queue: { run: async (fn: () => unknown) => fn() },
      geometry: (kinds: readonly string[]) =>
        kinds.includes('harvest_cut') ? pool.units(gpu) : [],
      texture,
      assets,
    } as never);
    const close = () => {
      cancelActiveAbilityKit(scene);
      pool.dispose();
    };
    return { scene, gpu, assets, arrive, texture, entry, close };
  }
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };

  it('reports cold progress without throwing, then waits for the load before the first unit', async () => {
    const k = lateKit('warrior');
    try {
      // The boot manifest reads progress() while the sheets are still cold:
      // the fifteen uploads are planned, the pool's units are not enumerable yet.
      expect(k.entry.progress()).toEqual({ done: 0, planned: 15, trimmed: true });
      const task = ensureActiveAbilityKit(k.scene);
      expect(k.assets).toHaveBeenCalledTimes(1);
      await flush();
      expect(k.texture).not.toHaveBeenCalled();
      expect(k.gpu.compile).not.toHaveBeenCalled();
      k.arrive();
      await task;
      expect(warriorKitAssetsState()).toBe('ready');
      expect(k.texture).toHaveBeenCalledTimes(15);
      expect(k.texture).toHaveBeenCalledWith(bakedTexture('harvest_impact'));
      // One compile and one upload draw per baked pool slot.
      expect(k.gpu.compile).toHaveBeenCalledTimes(10);
      expect(k.gpu.draw).toHaveBeenCalledTimes(10);
      expect(k.entry.progress()).toEqual({ done: 45, planned: 45, trimmed: false });
    } finally {
      k.close();
    }
  });

  it.each(['warrior', 'mage'])(
    'loads the Warrior kit through the resume path for a %s local player',
    async (localClass) => {
      const k = lateKit(localClass);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        resumeActiveAbilityKit(k.scene, undefined, 'warrior');
        await flush();
        expect(k.assets).toHaveBeenCalledTimes(1);
        expect(k.texture).not.toHaveBeenCalled();
        k.arrive();
        await flush();
        await ensureActiveAbilityKit(k.scene, 'warrior');
        expect(warn).not.toHaveBeenCalled();
        expect(warriorKitAssetsState()).toBe('ready');
        expect(k.texture).toHaveBeenCalledTimes(15);
        expect(k.gpu.draw).toHaveBeenCalledTimes(10);
      } finally {
        k.close();
      }
    },
  );
});

describe('the painter requests a class kit on first sighting', () => {
  function autoMock<T extends object>(seed: Partial<T> = {}): T {
    return new Proxy(seed as T, {
      get(target, key) {
        if (!(key in target)) (target as Record<PropertyKey, unknown>)[key] = vi.fn();
        return Reflect.get(target, key);
      },
    });
  }
  function entity(id: number, templateId: string, kind = 'player'): AbilityVfxEntityState {
    return {
      id,
      kind,
      templateId,
      castingAbility: null,
      castRemaining: 0,
      castTotal: 0,
      auras: [],
      hp: 100,
      dead: false,
    } as unknown as AbilityVfxEntityState;
  }

  it('asks once for the warrior kit and never for another class or a mob', () => {
    const requestClassKit = vi.fn();
    const painter = new AbilityVfx(
      {
        fx: autoMock<AbilityVfxFx>({ groundYAt: () => 0 } as Partial<AbilityVfxFx>),
        vfx: autoMock<AbilityVfxDeps['vfx']>(),
        anchor: () => ({ x: 0, y: 0, z: 0 }),
        spawnAoeRing: vi.fn(),
        triggerAttack: vi.fn(),
        localPlayerId: () => 1,
        requestClassKit,
      } as unknown as AbilityVfxDeps,
      () => 0,
    );
    painter.syncEntity(entity(2, 'mage'), false);
    painter.syncEntity(entity(3, 'warrior', 'mob'), false);
    expect(requestClassKit).not.toHaveBeenCalled();
    painter.syncEntity(entity(4, 'warrior'), false);
    painter.syncEntity(entity(4, 'warrior'), false);
    painter.syncEntity(entity(5, 'warrior'), false);
    expect(requestClassKit).toHaveBeenCalledExactlyOnceWith('warrior');
  });
});
