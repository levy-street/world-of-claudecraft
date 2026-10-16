import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Entity } from '../src/sim/types';
import { failWocHeads } from './helpers/woc_streamed';

// Issue #2079: a character asset that was never registered as preloaded used to
// throw synchronously from resolvedGltf inside the per-frame render path
// (Renderer.sync -> createView -> new CharacterVisual), which permanently
// stalled rendering (the v0.27.0 training dummy freeze,
// docs/training-dummy-preload-freeze-postmortem.md). The factory now fails
// soft: it returns null so the caller skips that entity's view for the frame
// (the entity stays a future view candidate), and the miss logs once per
// asset, not once per frame.
function mockGltfLoad(): void {
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn(() => Promise.resolve({ scene: {}, animations: [] })),
    loadTexture: vi.fn(() => new Promise(() => undefined)),
    loadKtx2Texture: vi.fn(() => new Promise(() => undefined)),
    releaseGltf: vi.fn(),
  }));
}

// The training dummy resolves to the lazyPreload mob_training_dummy visual,
// whose GLB the eager boot sweep never fetches, so the factory hits the real
// "character asset not preloaded" path with no asset work needed.
const dummyEntity = {
  kind: 'mob',
  id: 1,
  templateId: 'training_dummy',
  color: 0xffffff,
  skin: 0,
  mainhandItemId: null,
} as unknown as Entity;

describe('createCharacterVisual fails soft on a missing preload (issue 2079)', () => {
  it('returns null instead of throwing, and logs the miss once per asset', async () => {
    vi.resetModules();
    mockGltfLoad();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { createCharacterVisual } = await import('../src/render/characters/index');

    const first = createCharacterVisual(dummyEntity);
    const second = createCharacterVisual(dummyEntity);
    expect(first).toBeNull();
    expect(second).toBeNull();

    // One log for the first miss, none for the repeat; the log names the asset
    // so a real incident is diagnosable from a single line.
    const missLogs = errSpy.mock.calls.filter((args) =>
      args.some((a) => typeof a === 'string' && a.includes('mob_training_dummy')),
    );
    expect(missLogs).toHaveLength(1);
    errSpy.mockRestore();
  });
});

// PR 4360 review, B1. A WOC player body used to be a SILENT null while its base or animation
// library streamed (no log, no retry cooldown, retried every frame), and since a fetch that
// failed never ended that wait, a dead file hid every player of that body for the session.
// Both fits' files are resident from world entry now (woc_entry_preload.ts), so a base that
// is missing anyway is a miss like any other body's: logged once, and left to the caller's
// retry cooldown (no build is a quiet wait any more, so the renderer books every null).
describe('a WOC body whose base is missing takes the same fail-soft path', () => {
  const wocPlayer = (app: Record<string, unknown> | null): Entity =>
    ({
      kind: 'player',
      id: 7,
      templateId: 'warrior',
      color: 0xffffff,
      skin: 0,
      mainhandItemId: null,
      offhandItemId: null,
      auras: [],
      modularAppearance: app,
    }) as unknown as Entity;

  const BASE = 'models/chars/players/woc/base_male.glb';

  /** A fresh module world. Nothing lands but the files `landing` names. */
  async function world(landing: readonly string[] = []) {
    vi.resetModules();
    const fetched: string[] = [];
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn((url: string) => {
        fetched.push(url);
        return landing.includes(url)
          ? Promise.resolve({ scene: new THREE.Group(), animations: [] })
          : new Promise(() => undefined);
      }),
      loadTexture: vi.fn(() => new Promise(() => undefined)),
      loadKtx2Texture: vi.fn(() => new Promise(() => undefined)),
      releaseGltf: vi.fn(),
    }));
    const index = await import('../src/render/characters/index');
    // The head is not what this body waits on: its files have failed (a failed head file
    // ends the head's own wait, woc_head_stream_core.ts wocHeadAwaited). Stamped after the
    // slow imports, so the failure cannot age out of its cooldown before the case reads it.
    failWocHeads(await import('../src/render/characters/woc_head_packs'));
    const assets = await import('../src/render/characters/assets');
    return { fetched, assets, ...index };
  }

  const missLogs = (spy: { mock: { calls: unknown[][] } }, key: string): number =>
    spy.mock.calls.filter((args) =>
      args.some((a) => typeof a === 'string' && a.includes(`(${key})`)),
    ).length;

  it('returns null with one logged miss, not a streaming wait', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { createCharacterVisual, fetched } = await world();
    const before = fetched.filter((url) => url === BASE).length;

    expect(createCharacterVisual(wocPlayer(null))).toBeNull();
    expect(createCharacterVisual(wocPlayer(null))).toBeNull();

    expect(missLogs(errSpy, 'player_warrior')).toBe(1);
    // the miss itself puts the missing base back on the wire, once (the retries ride it)
    expect(fetched.filter((url) => url === BASE).length).toBe(before + 1);
    errSpy.mockRestore();
  });

  it('is no quieter for a speculative build, or for the other body fit', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { createCharacterVisual } = await world();
    expect(createCharacterVisual(wocPlayer(null), undefined, { fetchStreamed: false })).toBeNull();
    expect(createCharacterVisual(wocPlayer({ gender: 'female' }))).toBeNull();
    expect(missLogs(errSpy, 'player_warrior')).toBe(1);
    expect(missLogs(errSpy, 'player_warrior_female')).toBe(1);
    errSpy.mockRestore();
  });

  it('is the same miss when the base is resident and only the animation library is not', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { createCharacterVisual, assets, fetched } = await world([BASE]);
    // the base lands; the library stays on the wire
    assets.ensureCharacterUrl(BASE);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(fetched).toContain(BASE);
    expect(assets.visualAssetsResident('player_warrior', false)).toBe(false);

    expect(createCharacterVisual(wocPlayer(null))).toBeNull();
    expect(missLogs(errSpy, 'player_warrior')).toBe(1);
    // and the log names the file that is missing
    const logged = errSpy.mock.calls
      .flat()
      .map((a) => (a instanceof Error ? a.message : String(a)));
    expect(logged.some((text) => text.includes('anims_male.glb'))).toBe(true);
    errSpy.mockRestore();
  });
});

describe('createCharacterVisual happy path (issue 2079)', () => {
  it('builds a visual once the asset is preloaded, with no miss log', async () => {
    vi.resetModules();
    // A minimally real GLTF: a measurable mesh plus every clip the dummy's
    // ClipMap names, so construction exercises the actual assemble/bake path.
    const stubGltf = () => {
      const scene = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
      mesh.name = 'body';
      scene.add(mesh);
      const clip = (name: string) => new THREE.AnimationClip(name, 1, []);
      return { scene, animations: ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'].map(clip) };
    };
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn(() => Promise.resolve(stubGltf())),
      loadTexture: vi.fn(() => new Promise(() => undefined)),
      loadKtx2Texture: vi.fn(() => new Promise(() => undefined)),
      releaseGltf: vi.fn(),
    }));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { preloadTrainingDummyAssets } = await import('../src/render/characters/assets');
    await preloadTrainingDummyAssets();
    const { createCharacterVisual } = await import('../src/render/characters/index');

    const visual = createCharacterVisual(dummyEntity);
    expect(visual).not.toBeNull();
    const missLogs = errSpy.mock.calls.filter((args) =>
      args.some((a) => typeof a === 'string' && a.includes('mob_training_dummy')),
    );
    expect(missLogs).toHaveLength(0);
    errSpy.mockRestore();
  });
});

describe('CharacterVisual dispose() clears every cosmetic-overlay material cache', () => {
  it('releases the ghost, soulRend, shadowform, moonkin, metamorph, and auraGlow clones', async () => {
    vi.resetModules();
    // Same minimally real GLTF stub as the happy-path build above: a
    // MeshStandardMaterial (has both `color` and `emissive`, so every
    // overlay's tint/glow write actually runs) plus every named clip.
    const stubGltf = () => {
      const scene = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
      mesh.name = 'body';
      scene.add(mesh);
      const clip = (name: string) => new THREE.AnimationClip(name, 1, []);
      return { scene, animations: ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'].map(clip) };
    };
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn(() => Promise.resolve(stubGltf())),
      loadTexture: vi.fn(() => new Promise(() => undefined)),
      loadKtx2Texture: vi.fn(() => new Promise(() => undefined)),
      releaseGltf: vi.fn(),
    }));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { preloadTrainingDummyAssets } = await import('../src/render/characters/assets');
    await preloadTrainingDummyAssets();
    const { createCharacterVisual } = await import('../src/render/characters/index');

    const visual = createCharacterVisual(dummyEntity);
    expect(visual).not.toBeNull();
    if (!visual) return;

    // Cycle each overlay on then off in turn: applyVisualMaterials() always
    // recomputes from the ORIGINAL material against the flags live at that
    // moment, so switching one off before the next turns on still lands one
    // clone in each overlay's own cache, and no earlier cache is cleared by
    // a later overlay taking priority.
    visual.setGhost(true);
    visual.setGhost(false);
    visual.setSoulRend(true);
    visual.setSoulRend(false);
    visual.setShadowform(true);
    visual.setShadowform(false);
    visual.setMoonkin(true);
    visual.setMoonkin(false);
    visual.setAuraGlow(0xffffff, 0.5);
    visual.setAuraGlow(0xffffff, 0);

    const cacheNames = [
      'ghostMaterials',
      'soulRendMaterials',
      'shadowformMaterials',
      'moonkinMaterials',
      'auraGlowMaterials',
    ] as const;
    const caches = visual as unknown as Record<string, Map<unknown, unknown>>;
    for (const name of cacheNames) {
      expect(caches[name].size, `${name} should have cached a clone`).toBeGreaterThan(0);
    }

    visual.dispose();

    for (const name of cacheNames) {
      expect(caches[name].size, `${name} should be cleared on dispose`).toBe(0);
    }

    errSpy.mockRestore();
  });
});

describe('logAssetMissOnce (issue 2079)', () => {
  it('logs a key the first time only, independently per key', async () => {
    vi.resetModules();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { logAssetMissOnce } = await import('../src/render/characters/asset_miss_log');

    expect(logAssetMissOnce('k1', 'first k1 failure:')).toBe(true);
    expect(logAssetMissOnce('k1', 'repeat k1 failure:')).toBe(false);
    expect(logAssetMissOnce('k2', 'first k2 failure:')).toBe(true);
    expect(errSpy).toHaveBeenCalledTimes(2);
    errSpy.mockRestore();
  });
});
