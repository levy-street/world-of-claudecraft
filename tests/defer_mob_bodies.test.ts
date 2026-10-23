import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { stripComments } from './helpers/strip_comments';
import { tsFilesUnder } from './helpers/ts_files_under';

// The home page used to download every creature and enemy body (about 78 MB on a
// cold desktop visit) because characters/assets.ts registered them eagerly at
// import. They are world content: the launcher's preview only builds player
// bodies and weapons. Desktop still needs them before the Renderer exists (a
// mob's view and click target only exist once its GLB is resident), so they move
// to the deferred lane rather than the iOS post-entry stream.

const isMobBody = (url: string) =>
  url.includes('models/creatures/') || url.includes('models/chars/enemies/');

afterEach(() => {
  vi.doUnmock('../src/render/assets/loader');
  vi.doUnmock('../src/render/gfx');
  vi.resetModules();
});

async function importWithLoaderSpy(opts: { ios?: boolean; hold?: (url: string) => boolean } = {}) {
  vi.resetModules();
  if (opts.ios) {
    vi.doMock('../src/render/gfx', async (importOriginal) => {
      const real = await importOriginal<typeof import('../src/render/gfx')>();
      return { ...real, GFX: { ...real.GFX, iosMemoryProfile: true } };
    });
  }
  const stub = () => ({ scene: new THREE.Group(), animations: [] as never[] });
  // A held url stays pending until release() runs, so a test can prove a gate waits.
  const held: (() => void)[] = [];
  const loadGltf = vi.fn((url: string) =>
    opts.hold?.(url)
      ? new Promise((resolve) => held.push(() => resolve(stub())))
      : Promise.resolve(stub()),
  );
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf,
    loadHdr: vi.fn(() => new Promise(() => undefined)),
    loadTexture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    loadKtx2Texture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    releaseGltf: vi.fn(),
  }));
  const preload = await import('../src/render/assets/preload');
  const assets = await import('../src/render/characters/assets');
  const { characterPreloadUrls, VISUALS } = await import('../src/render/characters/manifest');
  const mobUrls = characterPreloadUrls(false).filter(isMobBody);
  const fetched = () => loadGltf.mock.calls.map((call) => String((call as unknown[])[0]));
  const release = () => {
    for (const resolve of held.splice(0)) resolve();
  };
  return { preload, assets, VISUALS, mobUrls, fetched, release };
}

describe('mob bodies stay off the home page', () => {
  it('fetches no creature or enemy body at import', async () => {
    const { mobUrls, fetched } = await importWithLoaderSpy();
    // Vacuity floors: the set is real, and the launcher set still loads eagerly.
    expect(mobUrls.length).toBeGreaterThan(50);
    expect(fetched().length).toBeGreaterThan(0);
    expect(fetched().filter(isMobBody)).toEqual([]);
  });

  it('lets the character preview gate resolve without them', async () => {
    const { assets, fetched } = await importWithLoaderSpy();
    await assets.launcherCharactersReady();
    expect(fetched().filter(isMobBody)).toEqual([]);
  });

  it('builds every player body the launcher can show from the launcher set alone', async () => {
    // The launcher draws player_* keys only (preview, roster, portraits). If one
    // ever references a mob body, resolvedGltf would throw "not preloaded" on the
    // home page, so building each one here must never hit that error.
    const { assets, VISUALS } = await importWithLoaderSpy();
    await assets.launcherCharactersReady();
    const keys = Object.keys(VISUALS).filter(
      (key) => key.startsWith('player_') && !VISUALS[key]?.lazyPreload,
    );
    expect(keys.length).toBeGreaterThan(5);
    const unresolved: string[] = [];
    for (const key of keys) {
      try {
        assets.prepareVisual(key);
      } catch (error) {
        if (/not preloaded/.test(String(error))) unresolved.push(`${key}: ${String(error)}`);
      }
    }
    expect(unresolved).toEqual([]);
  });

  it('keeps charactersReady() covering them, for direct mob-body builders', async () => {
    const { assets, mobUrls, fetched } = await importWithLoaderSpy();
    await assets.charactersReady();
    expect(new Set(fetched().filter(isMobBody))).toEqual(new Set(mobUrls));
  });

  it('holds assetsReady() until every one is resident, once the lane opens', async () => {
    const { preload, mobUrls, fetched, release } = await importWithLoaderSpy({ hold: isMobBody });
    preload.beginDeferredPreloads();
    let ready = false;
    const gate = preload.assetsReady().then(() => {
      ready = true;
    });
    await vi.waitFor(() => expect(new Set(fetched().filter(isMobBody))).toEqual(new Set(mobUrls)));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ready).toBe(false);
    release();
    await gate;
    expect(ready).toBe(true);
  });

  it('warms them early once, and the lane reuses those loads', async () => {
    const { preload, assets, mobUrls, fetched } = await importWithLoaderSpy();
    expect(assets.warmWorldCharacterBodies()).toBe(mobUrls.length);
    expect(assets.warmWorldCharacterBodies()).toBe(0);
    await vi.waitFor(() => expect(fetched().filter(isMobBody)).toHaveLength(mobUrls.length));
    preload.beginDeferredPreloads();
    await preload.assetsReady();
    // One fetch per body: the deferred thunks found the warmed loads resident.
    expect(fetched().filter(isMobBody)).toHaveLength(mobUrls.length);
  });

  it('never warms them on iOS, which streams them after entry instead', async () => {
    // WKWebView's per-process ceiling is why iOS streams mob bodies post-entry:
    // warming them on a play screen would put that decode spike on the launcher.
    const { assets, fetched } = await importWithLoaderSpy({ ios: true });
    expect(assets.warmWorldCharacterBodies()).toBe(0);
    await assets.launcherCharactersReady();
    expect(fetched().filter(isMobBody)).toEqual([]);
    expect(assets.startStreamedCharacterPreloads()).toBeGreaterThan(50);
  });

  it('warms them when a play screen opens, and gates the preview on the launcher set', () => {
    const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(mainSource).toContain('if (isPlayPanel) warmWorldCharacterBodies();');
    expect(mainSource).toContain('  launcherCharactersReady()\n    .then(() => {');
  });

  it('calls the full charactersReady() only from in-world builders', () => {
    // charactersReady() fetches every gate body, so a launcher-reachable caller
    // would put the mob bodies back on the home page.
    const allowed = ['src/render/cannon_encounter_visual.ts', 'src/render/characters/assets.ts'];
    const files = tsFilesUnder(fileURLToPath(new URL('../src', import.meta.url)));
    expect(files.length).toBeGreaterThan(400);
    const callers = files
      .filter(({ full }) =>
        /(?<![\w$])charactersReady\s*\(/.test(stripComments(readFileSync(full, 'utf8'))),
      )
      .map(({ file }) => `src/${file}`)
      .sort();
    expect(callers).toEqual(allowed);
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
  });
});
