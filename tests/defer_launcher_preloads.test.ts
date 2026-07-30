// World assets must not fetch just because the LAUNCHER loaded.
//
// Every world module used to fetch at module import, so reaching the home screen
// decoded the whole asset set. The files are local to the app bundle, so nothing
// paced them, and the decode spike (GLB de-interleaving amplifies memory) crossed
// WKWebView's per-process ceiling: a 12 GB iPhone 17 Pro was killed 1.6 s into the
// launcher and reloaded every ~1.9 s forever. The entry crash guard could not even
// see it, because the probe only arms inside startGame.
//
// The deferred lane holds those fetches until world entry. The safety property is
// ORDER: beginDeferredPreloads() must run before the assetsReady() that gates the
// Renderer, or placement could outrun a load and re-open the v0.16.0 farmCrate P0.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  assetsReady,
  beginDeferredPreloads,
  preloadInternalsForTest,
  registerDeferredPreload,
  registerPreload,
} from '../src/render/assets/preload';

const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

beforeEach(() => {
  preloadInternalsForTest.reset();
});

describe('deferred preload lane', () => {
  it('does not start a deferred fetch until the lane opens', () => {
    let started = 0;
    registerDeferredPreload(() => {
      started++;
      return Promise.resolve();
    });
    registerDeferredPreload(() => {
      started++;
      return Promise.resolve();
    });
    expect(started).toBe(0);
    expect(preloadInternalsForTest.pendingDeferred()).toBe(2);
    // Nothing is awaitable yet either: the tasks list is still empty.
    expect(preloadInternalsForTest.tasks()).toHaveLength(0);

    expect(beginDeferredPreloads()).toBe(2);
    expect(started).toBe(2);
    expect(preloadInternalsForTest.tasks()).toHaveLength(2);
    expect(preloadInternalsForTest.pendingDeferred()).toBe(0);
  });

  it('keeps eager registrations running immediately', async () => {
    let eagerRan = false;
    registerPreload(
      Promise.resolve().then(() => {
        eagerRan = true;
      }),
    );
    registerDeferredPreload(() => Promise.reject(new Error('must not run')));
    await assetsReady();
    expect(eagerRan).toBe(true);
    // assetsReady must NOT open the lane by itself: portrait.ts calls it at module
    // import, which would defeat the whole deferral.
    expect(preloadInternalsForTest.begun()).toBe(false);
    expect(preloadInternalsForTest.pendingDeferred()).toBe(1);
  });

  it('is idempotent, so a second call starts nothing again', () => {
    registerDeferredPreload(() => Promise.resolve());
    expect(beginDeferredPreloads()).toBe(1);
    expect(beginDeferredPreloads()).toBe(0);
    expect(preloadInternalsForTest.tasks()).toHaveLength(1);
  });

  it('starts a late registration immediately once the lane is open', () => {
    beginDeferredPreloads();
    let started = false;
    registerDeferredPreload(() => {
      started = true;
      return Promise.resolve();
    });
    // A module imported mid-session must not strand its assets behind a lifted gate.
    expect(started).toBe(true);
    expect(preloadInternalsForTest.tasks()).toHaveLength(1);
  });

  it('surfaces a thunk that throws synchronously through assetsReady', async () => {
    registerDeferredPreload(() => {
      throw new Error('exporter blew up');
    });
    beginDeferredPreloads();
    await expect(assetsReady()).rejects.toThrow('exporter blew up');
  });

  it('awaits deferred work opened before it, so placement cannot outrun a load', async () => {
    let resolved = false;
    registerDeferredPreload(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            resolved = true;
            resolve();
          }, 5);
        }),
    );
    beginDeferredPreloads();
    await assetsReady();
    expect(resolved).toBe(true);
  });
});

describe('startGame wiring', () => {
  it('opens the lane BEFORE the assetsReady that gates the Renderer', () => {
    const beginAt = mainSource.indexOf('beginDeferredPreloads()');
    const awaitAt = mainSource.indexOf('await assetsReady(');
    const rendererAt = mainSource.indexOf('new Renderer(world, canvas, nameplates)');
    expect(beginAt).toBeGreaterThan(-1);
    expect(awaitAt).toBeGreaterThan(beginAt);
    expect(rendererAt).toBeGreaterThan(awaitAt);
  });
});

describe('no world module fetches at import', () => {
  // The launcher only draws the character-creation preview, so characters/assets.ts
  // is the one sanctioned eager registrant. Anything else registering eagerly is
  // fetching on the home screen again, which is the whole defect.
  const EAGER_ALLOWED = new Set([
    'src/render/characters/assets.ts',
    // Runs while the world is built, not at import: the promise is already in flight.
    'src/render/placed_assets.ts',
  ]);

  it('leaves only the sanctioned eager registrants', async () => {
    const { globSync } = await import('node:fs');
    const files = globSync('src/render/**/*.ts');
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith('assets/preload.ts') || EAGER_ALLOWED.has(file)) continue;
      // Strip comments first: this guard polices CODE, not prose that happens to
      // name the eager function while explaining the lanes.
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');
      // Match the call, not the identifier inside registerDeferredPreload.
      if (/(?<!Deferred)\bregisterPreload\s*\(/.test(code)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
