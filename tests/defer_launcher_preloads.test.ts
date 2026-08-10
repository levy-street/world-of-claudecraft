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
  beginBackgroundPreloads,
  beginDeferredPreloads,
  preloadInternalsForTest,
  registerDeferredPreload,
  registerPreload,
} from '../src/render/assets/preload';
import { tsFilesUnder } from './helpers/ts_files_under';

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

// The background lane: a SECOND priority a 'background'-tagged deferred thunk can
// take. Unlike the critical lane above, assetsReady() must never observe it (that
// is the entire point: boot no longer blocks on content most sessions never load),
// and it only starts once main.ts opens it after the first frame is on screen.
describe('background preload lane', () => {
  it('does not start a background fetch until the background lane opens', () => {
    let started = 0;
    registerDeferredPreload(() => {
      started++;
      return Promise.resolve();
    }, 'background');
    registerDeferredPreload(() => {
      started++;
      return Promise.resolve();
    }, 'background');
    expect(started).toBe(0);
    expect(preloadInternalsForTest.pendingBackground()).toBe(2);
    expect(preloadInternalsForTest.backgroundTasks()).toHaveLength(0);

    expect(beginBackgroundPreloads()).toBe(2);
    expect(started).toBe(2);
    expect(preloadInternalsForTest.backgroundTasks()).toHaveLength(2);
    expect(preloadInternalsForTest.pendingBackground()).toBe(0);
  });

  it('is idempotent, so a second call starts nothing again', () => {
    registerDeferredPreload(() => Promise.resolve(), 'background');
    expect(beginBackgroundPreloads()).toBe(1);
    expect(beginBackgroundPreloads()).toBe(0);
    expect(preloadInternalsForTest.backgroundTasks()).toHaveLength(1);
  });

  it('starts a late background registration immediately once its lane is open', () => {
    beginBackgroundPreloads();
    let started = false;
    registerDeferredPreload(() => {
      started = true;
      return Promise.resolve();
    }, 'background');
    expect(started).toBe(true);
    expect(preloadInternalsForTest.backgroundTasks()).toHaveLength(1);
  });

  it('never lands a background task in the critical tasks list assetsReady() awaits', () => {
    registerDeferredPreload(() => Promise.resolve(), 'background');
    beginBackgroundPreloads();
    expect(preloadInternalsForTest.tasks()).toHaveLength(0);
    expect(preloadInternalsForTest.backgroundTasks()).toHaveLength(1);
  });

  it('lets assetsReady() resolve without ever waiting on a background task, even one that never settles', async () => {
    // A background task that NEVER resolves. If assetsReady() awaited it (a
    // regression back to one flat lane), this test would hang until Vitest's
    // timeout; it settling is the decisive proof the boot gate genuinely
    // excludes 'background' work rather than merely reordering it.
    registerDeferredPreload(() => new Promise(() => {}), 'background');
    registerPreload(Promise.resolve());
    beginBackgroundPreloads();
    await expect(assetsReady()).resolves.toBeUndefined();
  });

  it('surfaces a synchronously-throwing background thunk without an unhandled rejection', () => {
    registerDeferredPreload(() => {
      throw new Error('background exporter blew up');
    }, 'background');
    expect(() => beginBackgroundPreloads()).not.toThrow();
    expect(preloadInternalsForTest.backgroundTasks()).toHaveLength(1);
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

  // The locale/deed chunk fetch and the deferred world-asset preloads are
  // independent boot-time network/decode phases (one remote, one bundled
  // local). Opening the deferred lane before awaiting the locale fetch lets
  // both run concurrently instead of paying their durations back to back;
  // opening it after would silently reintroduce the serialization.
  it('opens the deferred preload lane BEFORE awaiting the locale fetch', () => {
    const beginAt = mainSource.indexOf('beginDeferredPreloads()');
    const localeAwaitAt = mainSource.indexOf('await Promise.all([ensureLocaleLoaded(');
    expect(beginAt).toBeGreaterThan(-1);
    expect(localeAwaitAt).toBeGreaterThan(beginAt);
  });

  // The background lane must open strictly later than everything above: it is
  // only safe once the boot gate has already resolved and a real frame has
  // painted, or a 'background' thunk could still stall world entry.
  it('opens the background lane only once the first frame is on screen', () => {
    const beginCriticalAt = mainSource.indexOf('beginDeferredPreloads()');
    const awaitAssetsAt = mainSource.indexOf('await assetsReady(');
    const firstPaintAt = mainSource.indexOf("checkpoint('first-paint')");
    const beginBackgroundAt = mainSource.indexOf('beginBackgroundPreloads()');
    expect(beginCriticalAt).toBeGreaterThan(-1);
    expect(awaitAssetsAt).toBeGreaterThan(-1);
    expect(firstPaintAt).toBeGreaterThan(-1);
    expect(beginBackgroundAt).toBeGreaterThan(-1);
    expect(beginBackgroundAt).toBeGreaterThan(beginCriticalAt);
    expect(beginBackgroundAt).toBeGreaterThan(awaitAssetsAt);
    expect(beginBackgroundAt).toBeGreaterThan(firstPaintAt);
  });
});

describe('background-tier retag: only a build path that tolerates late assets', () => {
  it('tags Thornhollow Fields art background: buildBattleground streams its own pieces in on demand', () => {
    const src = readFileSync(new URL('../src/render/battleground.ts', import.meta.url), 'utf8');
    expect(src).toMatch(
      /registerDeferredPreload\(\(\) => ensureBattlegroundAssets\(\),\s*'background'\)/,
    );
  });

  // dungeon.ts's kit/bits GLBs and vale_cup_stadium.ts's kit pieces are both read
  // SYNCHRONOUSLY from the module-local cache by a build step that still runs
  // BEFORE the first frame: dungeon's interior-shader prewarm entry in
  // renderer.ts re-awaits ensureDungeonAssets() itself (so tagging it
  // 'background' would buy nothing, since that await forces the fetch back
  // before first frame anyway, just serialized after other boot work instead
  // of overlapped with it), and vale_cup_stadium's buildValeCupStadium() runs
  // unconditionally in the Renderer constructor and throws "vale cup kit piece
  // not preloaded" the instant its cache is still empty. Both must stay on the
  // default critical lane.
  it('keeps dungeon.ts and vale_cup_stadium.ts on the critical lane', () => {
    for (const file of ['../src/render/dungeon.ts', '../src/render/vale_cup_stadium.ts']) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(src, file).not.toMatch(/registerDeferredPreload\([^;]*'background'/);
    }
  });
});

describe('editor viewport wiring', () => {
  // The editor is its own build entry composing the real Sim + Renderer; it
  // never runs startGame, so it must open the deferred lane itself or every
  // world-content thunk stays parked and the Renderer ctor throws "asset not
  // preloaded". Any future host that awaits assetsReady() then builds a
  // Renderer needs the same call; this pin is the template.
  it('opens the lane BEFORE the assetsReady that gates its Renderer', () => {
    const viewportSource = readFileSync(
      new URL('../src/editor/3d/viewport.ts', import.meta.url),
      'utf8',
    );
    const beginAt = viewportSource.indexOf('beginDeferredPreloads()');
    const awaitAt = viewportSource.indexOf('await assetsReady()');
    const rendererAt = viewportSource.indexOf('new Renderer(');
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

  it('leaves only the sanctioned eager registrants', () => {
    const files = tsFilesUnder(new URL('../src/render', import.meta.url).pathname);
    // Vacuity floor: an empty or misrooted walk must not pass as "no offenders".
    expect(files.length).toBeGreaterThan(100);
    const offenders: string[] = [];
    for (const { file, full } of files) {
      const repoRel = `src/render/${file}`;
      if (repoRel.endsWith('assets/preload.ts') || EAGER_ALLOWED.has(repoRel)) continue;
      // Strip comments first: this guard polices CODE, not prose that happens to
      // name the eager function while explaining the lanes.
      const code = readFileSync(full, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');
      // Match the call, not the identifier inside registerDeferredPreload.
      if (/(?<!Deferred)\bregisterPreload\s*\(/.test(code)) offenders.push(repoRel);
    }
    expect(offenders).toEqual([]);
  });
});

describe('every assetsReady host opens the lane', () => {
  // The general rule behind the two ordering pins above: ANY source that awaits
  // assetsReady() and then constructs the Renderer is a host, and a host that
  // does not open the deferred lane first builds over parked world-content
  // thunks and throws "asset not preloaded" (the editor viewport did exactly
  // this when the lane landed; the gate stayed green because nothing swept the
  // call sites).
  it('finds no Renderer host awaiting assetsReady without beginDeferredPreloads', () => {
    const files = tsFilesUnder(new URL('../src', import.meta.url).pathname);
    expect(files.length).toBeGreaterThan(400);
    const offenders: string[] = [];
    let hosts = 0;
    for (const { file, full } of files) {
      const code = readFileSync(full, 'utf8');
      const awaitAt = code.indexOf('await assetsReady(');
      if (awaitAt < 0 || !code.includes('new Renderer(')) continue;
      hosts++;
      const beginAt = code.indexOf('beginDeferredPreloads()');
      if (beginAt < 0 || beginAt > awaitAt) offenders.push(`src/${file}`);
    }
    expect(offenders).toEqual([]);
    // Both known hosts (startGame in main.ts, the editor viewport) must be
    // seen, or the sweep has quietly stopped matching the pattern it polices.
    expect(hosts).toBeGreaterThanOrEqual(2);
  });
});
