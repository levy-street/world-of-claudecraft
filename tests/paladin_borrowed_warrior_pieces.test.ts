// The Paladin landings borrow four pieces of the Warrior kit: the shout dust
// and smoke baked layers, the stone chip fragments and Valkyr's Calling's
// leap_rupture slabs. On the branch they drew only when a Warrior had been
// requested on the same renderer: the sheets, the fragment model and the crest
// maps load with the whole Warrior kit (ensureWarriorKitAssets), only its
// recipe prepared them, and every piece also waited on the Warrior kit's cast
// family gate, which no Paladin cast asks for (each refusal counted as a
// requirement miss). In a scene with no Warrior they never drew at all.
//
// Now the Paladin kit recipe loads ONLY those pieces (no other Warrior sheet,
// map or contact sheet), prepares them with its own paced units after its
// stand-ins, and a Paladin landing draws a borrowed piece once ITS OWN
// preparation ran, without consulting the Warrior gate. A Warrior cast still
// waits for its gate exactly as before.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/assets/loader', async () => {
  const THREE = await import('three');
  return {
    loadTexture: vi.fn(async () => new THREE.Texture()),
    loadBitmapTexture: vi.fn(async () => new THREE.Texture()),
    loadKtx2Texture: vi.fn(async () => new THREE.Texture()),
    loadGltf: vi.fn(async () => ({
      scene: {
        updateMatrixWorld(): void {},
        getObjectByName: (name: string) =>
          Object.assign(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2)), { name }),
      },
    })),
    releaseGltf: vi.fn(),
  };
});
vi.mock('../src/render/assets/preload', () => ({
  registerPreload: vi.fn(),
  registerDeferredPreload: vi.fn(),
}));

import {
  ACTIVE_KIT_RETRY_DELAYS_MS,
  activeKitPrewarmEntry,
  cancelActiveAbilityKit,
  ensureActiveAbilityKit,
  resumeActiveAbilityKit,
} from '../src/render/ability_vfx/active_kit_prewarm';
import { contactAssetInternalsForTest } from '../src/render/ability_vfx/contact_assets';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { setPaladinSpecIconsForTest } from '../src/render/ability_vfx/paladin_spec_icons';
import {
  BAKED_URLS,
  bakedTexture,
  ensureWarriorKitAssets,
  FRAGMENT_URL,
  fragmentGeometry,
  PALADIN_BORROWED_PIECES,
  productionAssetInternalsForTest,
  warriorBloodTexture,
  warriorKitAssetsState,
  warriorPressureTexture,
  warriorRockTexture,
  warriorSteelTexture,
} from '../src/render/ability_vfx/production_assets';
import * as loader from '../src/render/assets/loader';
import { CAST_VFX_ENGINE, CAST_VFX_KIT } from '../src/render/cast_vfx_family';
import { runContextRestoreResets } from '../src/render/context_restore_registry';
import type { PrewarmResumeUnit } from '../src/render/prewarm_resume';
import { createVfxAnchor } from '../src/render/vfx_anchor';
import { installCastVfxCanvasStub } from './helpers/cast_vfx_headless';

const loadBitmapTexture = vi.mocked(loader.loadBitmapTexture);
const loadKtx2Texture = vi.mocked(loader.loadKtx2Texture);
const loadGltf = vi.mocked(loader.loadGltf);
const ROCK_URL = '/textures/terrain/Rock051_Color.jpg';

/** The unit ids only the borrowed preparation runs in a Paladin recipe. */
const BORROWED_UNIT =
  /^(upload-big:active-(smoke|shout-dust|warrior-rock)|baked-|fragment-[a-z]+:stone_chip|crest-bind-rock|crest-compile:leap_rupture|touch:crest:leap_rupture|crest-upload:leap_rupture)/;

beforeEach(() => {
  productionAssetInternalsForTest.reset();
  contactAssetInternalsForTest.reset();
  loadBitmapTexture.mockClear();
  loadKtx2Texture.mockClear();
  loadGltf.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  setPaladinSpecIconsForTest(null);
});

const bitmapUrls = () => loadBitmapTexture.mock.calls.map((call) => call[0]).sort();

describe('the Warrior kit loader, split by piece', () => {
  it('loads only what the Paladin landings borrow', async () => {
    await expect(ensureWarriorKitAssets(false, PALADIN_BORROWED_PIECES)).resolves.toBe(true);
    expect(bitmapUrls()).toEqual([BAKED_URLS.shout_dust, BAKED_URLS.smoke, ROCK_URL].sort());
    expect(loadKtx2Texture).not.toHaveBeenCalled();
    expect(loadGltf).toHaveBeenCalledExactlyOnceWith(FRAGMENT_URL);
    expect(bakedTexture('shout_dust')).not.toBeNull();
    expect(bakedTexture('smoke')).not.toBeNull();
    expect(warriorRockTexture()).not.toBeNull();
    expect(fragmentGeometry('stone_chip')).not.toBeNull();
    for (const kind of ['warrior_power', 'harvest_impact', 'warrior_crush'] as const)
      expect(bakedTexture(kind), kind).toBeNull();
    expect(warriorPressureTexture()).toBeNull();
    expect(warriorBloodTexture()).toBeNull();
    expect(warriorSteelTexture()).toBeNull();
    // The whole kit was never asked for.
    expect(warriorKitAssetsState()).toBe('idle');
  });

  it('declines on a constrained-memory device without touching a loader', async () => {
    await expect(ensureWarriorKitAssets(true, PALADIN_BORROWED_PIECES)).resolves.toBe(false);
    expect(loadBitmapTexture).not.toHaveBeenCalled();
    expect(loadGltf).not.toHaveBeenCalled();
    expect(bakedTexture('shout_dust')).toBeNull();
  });

  it('never pays a piece twice, whichever kit asks first', async () => {
    await ensureWarriorKitAssets(false, PALADIN_BORROWED_PIECES);
    await ensureWarriorKitAssets(false);
    // Eleven image sheets in the whole kit, the three borrowed ones once.
    expect(loadBitmapTexture).toHaveBeenCalledTimes(11);
    expect(loadGltf).toHaveBeenCalledTimes(1);
    await ensureWarriorKitAssets(false, PALADIN_BORROWED_PIECES);
    expect(loadBitmapTexture).toHaveBeenCalledTimes(11);
  });

  it('decodes a released borrowed sheet again for a rebuilt renderer', async () => {
    loadBitmapTexture.mockImplementation(
      async () => new THREE.Texture({ width: 4, height: 4, close: vi.fn() } as never),
    );
    await ensureWarriorKitAssets(false, PALADIN_BORROWED_PIECES);
    const dust = bakedTexture('shout_dust') as THREE.Texture;
    dust.onUpdate?.(dust);
    expect(dust.source.dataReady).toBe(false);
    await ensureWarriorKitAssets(false, PALADIN_BORROWED_PIECES);
    expect(dust.source.dataReady).toBe(true);
    expect(loadBitmapTexture).toHaveBeenCalledTimes(4);
    loadBitmapTexture.mockImplementation(async () => new THREE.Texture());
  });

  it('retries only the piece that failed', async () => {
    loadGltf.mockRejectedValueOnce(new Error('offline'));
    await expect(ensureWarriorKitAssets(false, PALADIN_BORROWED_PIECES)).rejects.toThrow('offline');
    await expect(ensureWarriorKitAssets(false, PALADIN_BORROWED_PIECES)).resolves.toBe(true);
    expect(loadBitmapTexture).toHaveBeenCalledTimes(3);
    expect(loadGltf).toHaveBeenCalledTimes(2);
  });
});

/** A real engine behind the real active-kit recipe, on a fake GPU host. */
function rig(localClass: string, options: { constrained?: boolean } = {}) {
  installCastVfxCanvasStub();
  const scene = new THREE.Scene();
  const resident = new Set<THREE.Texture>();
  const fx = new AbilityVfxFx(
    scene,
    new THREE.PerspectiveCamera(),
    createVfxAnchor(() => false),
    () => 0,
    undefined,
    undefined,
    undefined,
    (texture) => resident.has(texture),
  );
  // The Warrior gate never opens: no Warrior was ever requested here.
  const asked: number[] = [];
  fx.setCastVfxSpawnGate((bit) => {
    asked.push(bit);
    return bit === CAST_VFX_ENGINE;
  });
  const program = { isReady: () => true, getUniforms: vi.fn(), getAttributes: vi.fn() };
  const gpu = {
    properties: { get: () => ({ programs: new Map([['flat', program]]) }) },
    compile: vi.fn(async () => {}),
    draw: vi.fn(),
  };
  const ran: string[] = [];
  const failing = new Set<string>();
  const queue = {
    run: vi.fn(async (work: PrewarmResumeUnit['run'], _priority?: number, id?: string) => {
      if (failing.delete(String(id))) throw new Error(`unit ${id} failed`);
      await work();
      ran.push(String(id));
    }),
  };
  const atlas = new THREE.Texture();
  const assets = vi.fn((pieces?: readonly string[]) =>
    ensureWarriorKitAssets(options.constrained === true, pieces as never),
  );
  const entry = activeKitPrewarmEntry(scene, localClass, {
    queue: queue as never,
    assets: assets as never,
    paladinAssets: async () => {
      setPaladinSpecIconsForTest(atlas, false);
      return true;
    },
    geometry: (kinds, kit) => fx.authoredPrewarmUnits(gpu, kinds, kit),
    texture: (texture) => void resident.add(texture),
  });
  const pools = fx as unknown as {
    baked: { slots: { active: boolean }[] };
    fragments: { batches: Map<string, { ends: Float64Array }> };
  };
  const landing = {
    /** Sundering Gavel's impact: three dust layers and a burst of chips. */
    gavel: () =>
      (fx as unknown as Record<string, (...a: unknown[]) => void>).sunderingGavelImpact(
        0,
        0,
        0,
        'full',
      ),
    dust: () => pools.baked.slots.filter((slot) => slot.active).length,
    chips: () =>
      [...(pools.fragments.batches.get('stone_chip')?.ends ?? [])].filter((e) => e > 0).length,
    slab: () =>
      (fx as unknown as Record<string, (...a: unknown[]) => boolean>).paladinCrestAt(
        0,
        0,
        0,
        0.7,
        1,
        0x746b60,
        0xd9c7a2,
        'leap_rupture',
        0,
        0.9,
      ),
  };
  const close = () => {
    cancelActiveAbilityKit(scene);
    fx.dispose();
  };
  return { scene, fx, asked, gpu, ran, failing, queue, assets, entry, landing, close };
}

/** Lets a whole recipe drain under fake timers: every unit is a few
 *  microtask hops, and the real recipe runs a few hundred units. */
const settle = async () => {
  for (let i = 0; i < 5000; i++) await Promise.resolve();
};

describe('a Paladin-only scene', () => {
  it('prepares the borrowed pieces in its own recipe, after the stand-ins, and its landings draw them', async () => {
    const r = rig('paladin');
    try {
      await ensureActiveAbilityKit(r.scene);
      // Only the borrowed pieces were asked for: never the whole Warrior kit.
      expect(r.assets).toHaveBeenCalledExactlyOnceWith(PALADIN_BORROWED_PIECES);
      expect(warriorKitAssetsState()).toBe('idle');
      const borrowed = r.ran.filter((id) => BORROWED_UNIT.test(id));
      expect(borrowed).toEqual(expect.arrayContaining(['upload-big:active-shout-dust']));
      expect(borrowed).toEqual(expect.arrayContaining(['crest-upload:leap_rupture']));
      expect(borrowed).toEqual(expect.arrayContaining(['fragment-upload:stone_chip']));
      // After every stand-in unit, before every Paladin pool unit.
      const firstBorrowed = r.ran.findIndex((id) => BORROWED_UNIT.test(id));
      const lastStandIn = r.ran.map((id) => id.includes('paladin-stand-in')).lastIndexOf(true);
      const firstPool = r.ran.findIndex(
        (id) =>
          !id.includes('paladin-stand-in') &&
          !BORROWED_UNIT.test(id) &&
          !id.startsWith('upload-big:paladin'),
      );
      expect(lastStandIn).toBeGreaterThanOrEqual(0);
      expect(firstBorrowed).toBeGreaterThan(lastStandIn);
      expect(firstPool).toBeGreaterThan(
        r.ran.map((id) => BORROWED_UNIT.test(id)).lastIndexOf(true),
      );
      // Nothing else of the Warrior kit was prepared.
      expect(r.ran.some((id) => id === 'crest-bind-kit')).toBe(false);
      expect(r.ran.some((id) => /:(ice_shard|metal_splinter|blood_cut)$/.test(id))).toBe(false);
      // The landings draw them with the Warrior gate shut, asking it nothing.
      r.asked.length = 0;
      r.landing.gavel();
      expect(r.landing.dust()).toBe(3);
      expect(r.landing.chips()).toBeGreaterThan(0);
      expect(r.landing.slab()).toBe(true);
      expect(r.asked).not.toContain(CAST_VFX_KIT);
    } finally {
      r.close();
    }
  });

  it('a Warrior cast still waits for its own gate', async () => {
    const r = rig('paladin');
    try {
      await ensureActiveAbilityKit(r.scene);
      r.asked.length = 0;
      expect(r.fx.bakedAt('shout_dust', 0, 0, 0, 1, 0xffffff, 0xffffff, 1, 0, 0)).toBe(false);
      expect(r.fx.crestAt(0, 0, 0, 1, 1, 0xffffff, 0xffffff, 'leap_rupture')).toBe(false);
      expect(r.asked).toContain(CAST_VFX_KIT);
    } finally {
      r.close();
    }
  });

  it('draws none of them before its own preparation ran', () => {
    const r = rig('paladin');
    try {
      r.landing.gavel();
      expect(r.landing.dust()).toBe(0);
      expect(r.landing.chips()).toBe(0);
      expect(r.landing.slab()).toBe(false);
      expect(r.asked).not.toContain(CAST_VFX_KIT);
    } finally {
      r.close();
    }
  });

  it('keeps the decline on a constrained-memory device: no load, no borrowed unit, no backoff', async () => {
    const r = rig('paladin', { constrained: true });
    try {
      await ensureActiveAbilityKit(r.scene);
      expect(loadBitmapTexture).not.toHaveBeenCalled();
      expect(loadGltf).not.toHaveBeenCalled();
      expect(r.ran.filter((id) => BORROWED_UNIT.test(id))).toEqual([]);
      // The stand-ins and the Paladin pools are prepared all the same.
      expect(r.ran.some((id) => id.includes('paladin-stand-in'))).toBe(true);
      expect(r.ran).toContain('upload-big:paladin-spec-icons');
      r.landing.gavel();
      expect(r.landing.dust()).toBe(0);
      expect(r.landing.chips()).toBe(0);
      expect(r.landing.slab()).toBe(false);
    } finally {
      r.close();
    }
  });
});

describe('a renderer that sights both kits', () => {
  it('never pays a borrowed piece twice when the Warrior kit came first', async () => {
    const r = rig('mage');
    try {
      await ensureActiveAbilityKit(r.scene, 'warrior');
      const warrior = r.ran.length;
      await ensureActiveAbilityKit(r.scene, 'paladin');
      const paladin = r.ran.slice(warrior);
      expect(paladin.filter((id) => BORROWED_UNIT.test(id))).toEqual([]);
      r.landing.gavel();
      expect(r.landing.dust()).toBe(3);
      expect(r.landing.slab()).toBe(true);
    } finally {
      r.close();
    }
  });

  it('never pays a borrowed piece twice when the Paladin kit came first', async () => {
    const r = rig('mage');
    try {
      await ensureActiveAbilityKit(r.scene, 'paladin');
      const paid = r.ran.filter((id) => BORROWED_UNIT.test(id));
      expect(paid.length).toBeGreaterThan(0);
      const paladin = r.ran.length;
      await ensureActiveAbilityKit(r.scene, 'warrior');
      const warrior = r.ran.slice(paladin);
      for (const id of paid) expect(warrior, id).not.toContain(id);
      // The Warrior recipe still binds and prepares the rest of its kit.
      expect(warrior).toContain('crest-bind-kit');
      expect(warrior).toContain('crest-upload:blood_cut');
    } finally {
      r.close();
    }
  });
});

describe('retries', () => {
  it('a borrowed load that fails leaves the Paladin kit prepared and asks again for the pieces alone', async () => {
    vi.useFakeTimers();
    const r = rig('mage');
    try {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      loadGltf.mockRejectedValueOnce(new Error('offline'));
      resumeActiveAbilityKit(r.scene, undefined, 'paladin');
      await settle();
      expect(r.ran.filter((id) => BORROWED_UNIT.test(id))).toEqual([]);
      expect(r.ran).toContain('upload-big:paladin-spec-icons');
      expect(vi.getTimerCount()).toBe(1);
      const before = r.ran.length;
      await vi.advanceTimersByTimeAsync(ACTIVE_KIT_RETRY_DELAYS_MS[0]);
      await settle();
      const retry = r.ran.slice(before);
      expect(retry.length).toBeGreaterThan(0);
      expect(retry.every((id) => BORROWED_UNIT.test(id))).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      r.close();
    }
  });

  it('a Paladin in backoff for its borrowed pieces never holds back a Warrior sighting', async () => {
    vi.useFakeTimers();
    const r = rig('mage');
    try {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      r.failing.add('crest-upload:leap_rupture');
      resumeActiveAbilityKit(r.scene, undefined, 'paladin');
      await settle();
      expect(vi.getTimerCount()).toBe(1);
      resumeActiveAbilityKit(r.scene, undefined, 'warrior');
      await settle();
      expect(r.ran).toContain('crest-bind-kit');
      // The Warrior recipe prepared leap_rupture with its kit: the Paladin
      // retry finds it done and pays nothing for it.
      const before = r.ran.length;
      await vi.advanceTimersByTimeAsync(ACTIVE_KIT_RETRY_DELAYS_MS[0]);
      await settle();
      expect(r.ran.slice(before)).not.toContain('crest-upload:leap_rupture');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      r.close();
    }
  });
});

describe('a WebGL context restore', () => {
  it('takes the borrowed pieces back and prepares them again', async () => {
    const r = rig('paladin');
    try {
      await ensureActiveAbilityKit(r.scene);
      expect(r.landing.slab()).toBe(true);
      const before = r.ran.length;
      runContextRestoreResets();
      expect(r.landing.slab()).toBe(false);
      await vi.waitFor(() => expect(r.ran.slice(before)).toContain('crest-upload:leap_rupture'));
      await vi.waitFor(() => expect(r.ran.slice(before)).toContain('fragment-upload:stone_chip'));
      await vi.waitFor(() =>
        expect(r.ran.slice(before)).toContain('upload-big:paladin-spec-icons'),
      );
      expect(r.ran.slice(before)).toContain('upload-big:active-shout-dust');
      expect(r.landing.slab()).toBe(true);
    } finally {
      r.close();
    }
  });
});
