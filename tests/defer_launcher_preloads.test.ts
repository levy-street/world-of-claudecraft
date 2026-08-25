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
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  assetsReady,
  beginDeferredPreloads,
  preloadInternalsForTest,
  registerDeferredPreload,
  registerPreload,
} from '../src/render/assets/preload';
import { stripComments } from './helpers/strip_comments';
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
    // Reflow-proof: the locale await is the multi-line CONTENT_LOCALE_CHANNEL_ENSURERS
    // block (three loaders), so match on structure, not a pasted one-line literal
    // (same rule as the sibling pin in tests/ios_entry_memory.test.ts).
    const localeAwaitAt = mainSource.search(/await Promise\.all\(\[\s*ensureLocaleLoaded\(/);
    expect(beginAt).toBeGreaterThan(-1);
    expect(localeAwaitAt).toBeGreaterThan(beginAt);
  });
});

describe('Thornhollow intent-driven preload', () => {
  it('keeps Thornhollow art on its dedicated intent-driven prewarm', () => {
    const src = readFileSync(new URL('../src/render/battleground.ts', import.meta.url), 'utf8');
    expect(src).toContain('createBattlegroundAssetPrewarm(');
  });

  // dungeon.ts's kit/bits GLBs are read SYNCHRONOUSLY from the module-local
  // cache by a build step that still runs BEFORE the first frame: dungeon's
  // interior-shader prewarm entry in renderer.ts re-awaits
  // ensureDungeonAssets() itself (so tagging it 'background' would buy
  // nothing, since that await forces the fetch back before first frame
  // anyway, just serialized after other boot work instead of overlapped with
  // it). It must stay on the default critical lane.
  it('keeps dungeon.ts on the critical lane', () => {
    for (const file of ['../src/render/dungeon.ts']) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(src, file).not.toMatch(/registerDeferredPreload\([^;]*'background'/);
    }
  });

  it('starts from the resolved Thornhollow tab and commits before sending queue join', () => {
    const arena = readFileSync(new URL('../src/ui/arena_window.ts', import.meta.url), 'utf8');
    const thornhollowArm = arena.slice(
      arena.indexOf("if (this.tab === 'ravenrift')"),
      arena.indexOf('this.renderArena(', arena.indexOf("if (this.tab === 'ravenrift')")),
    );
    expect(thornhollowArm).toContain('thornhollowPrewarm?.startPreview();');

    const queueHandler = arena.slice(
      arena.indexOf('el.querySelector(\'[data-act="queue"]\')'),
      arena.indexOf('el.querySelector(\'[data-act="leave"]\')'),
    );
    expect(queueHandler.indexOf('thornhollowPrewarm?.commit();')).toBeLessThan(
      queueHandler.indexOf('this.deps.world().bgQueueJoin();'),
    );
    expect(mainSource).toContain('setThornhollowPrewarmHooks({');
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
    const files = tsFilesUnder(fileURLToPath(new URL('../src/render', import.meta.url)));
    // Vacuity floor: an empty or misrooted walk must not pass as "no offenders".
    expect(files.length).toBeGreaterThan(100);
    const offenders: string[] = [];
    for (const { file, full } of files) {
      const repoRel = `src/render/${file}`;
      if (repoRel.endsWith('assets/preload.ts') || EAGER_ALLOWED.has(repoRel)) continue;
      // Strip comments first: this guard polices CODE, not prose that happens to
      // name the eager function while explaining the lanes.
      const code = stripComments(readFileSync(full, 'utf8'));
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
    const files = tsFilesUnder(fileURLToPath(new URL('../src', import.meta.url)));
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
