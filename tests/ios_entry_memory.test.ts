// The 4 GB-class iOS entry-memory diet (the iPhone 13 Play-press crash).
//
// A WebContent process kill during world entry has no JS-observable event, so
// most of these contracts are source pins in the entry_crash_guard.test.ts
// idiom: they assert the load-bearing lines exist in the order the recovery
// story depends on, and fail loudly when a refactor moves one.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENTRY_CHECKPOINTS } from '../src/game/entry_crash_guard';
import { primeNativeDeviceMemoryHint } from '../src/net/native_device_info';
import {
  assetsReady,
  preloadInternalsForTest,
  registerPreload,
} from '../src/render/assets/preload';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const mainSource = read('../src/main.ts');
const assetsSource = read('../src/render/characters/assets.ts');
const visualSource = read('../src/render/characters/visual.ts');
const portraitSource = read('../src/render/characters/portrait.ts');
const portraitChipSource = read('../src/ui/portrait_chip.ts');
const vfxSource = read('../src/render/vfx.ts');

describe('entry probe covers the await window', () => {
  it('registers the assets-await checkpoint id', () => {
    expect(ENTRY_CHECKPOINTS).toContain('assets-await');
  });

  it('arms the probe before the locale and asset awaits and re-stamps the build', () => {
    const startAt = mainSource.indexOf("entryDiagnostics.start(settings.get('graphicsPreset'));");
    const awaitCheckpointAt = mainSource.indexOf("entryDiagnostics.checkpoint('assets-await'");
    const localeAwaitAt = mainSource.indexOf(
      'await Promise.all([ensureLocaleLoaded(getLanguage()), ensureDeedLocalesLoaded(getLanguage())]);',
    );
    const assetsAwaitAt = mainSource.indexOf('await assetsReady(');
    const sceneRestampAt = mainSource.indexOf("entryDiagnostics.checkpoint('scene-build-start'");
    expect(startAt).toBeGreaterThan(-1);
    expect(awaitCheckpointAt).toBeGreaterThan(startAt);
    expect(localeAwaitAt).toBeGreaterThan(awaitCheckpointAt);
    expect(assetsAwaitAt).toBeGreaterThan(localeAwaitAt);
    expect(sceneRestampAt).toBeGreaterThan(assetsAwaitAt);
  });

  it('disarms the probe on the handled asset-failure path (not a process kill)', () => {
    const assetsAwaitAt = mainSource.indexOf('await assetsReady(');
    const stopAt = mainSource.indexOf('entryDiagnostics.stop();', assetsAwaitAt);
    const overlayAt = mainSource.indexOf("fatalOverlay(t('loading.assetsFailed'", assetsAwaitAt);
    expect(stopAt).toBeGreaterThan(assetsAwaitAt);
    expect(overlayAt).toBeGreaterThan(stopAt);
  });
});

describe('entry-crash recovery arms tight memory', () => {
  it('stamps the tight-mode marker inside the native recovery block', () => {
    const persistAt = mainSource.indexOf('persistEntryRecoveryLog(entryRecovery, entryRecoveryAt)');
    const markAt = mainSource.indexOf('markEntryTightMode(entryRecoveryAt);');
    const bannerAt = mainSource.indexOf('showEntryGuardBanner(entryRecovery.to)');
    expect(persistAt).toBeGreaterThan(-1);
    expect(markAt).toBeGreaterThan(persistAt);
    expect(bannerAt).toBeGreaterThan(markAt);
  });
});

describe('tight-memory residency diet', () => {
  it('skips the two secondary-context preview prewarms on the tight profile', () => {
    const gateAt = mainSource.indexOf('if (!GFX.tightMemory) {');
    const characterPrewarmAt = mainSource.indexOf('await hud.prewarmCharacterPreview();');
    const armoryPrewarmAt = mainSource.indexOf('await hud.prewarmArmoryPreview();');
    expect(gateAt).toBeGreaterThan(-1);
    expect(characterPrewarmAt).toBeGreaterThan(gateAt);
    expect(armoryPrewarmAt).toBeGreaterThan(characterPrewarmAt);
  });
});

describe('deferred skin atlases on the packaged iOS shell', () => {
  it('gates the boot atlas sweep on the hint-stable native profile', () => {
    expect(assetsSource).toContain(
      'const eagerSkinAtlases = !(GFX.nativeIosMemoryProfile || GFX.tightMemory);',
    );
    // The character-preview gate must not re-await atlases the boot deferred.
    expect(assetsSource).toContain('const missingSkins = eagerSkinAtlases');
  });

  it('heals a deferred atlas at visual construction, not only on live swaps', () => {
    expect(visualSource).toContain('const pendingAtlas = ensureSkinTexture(this.key, skinIndex);');
  });

  it('never caches a portrait rendered while its atlas is still in flight', () => {
    expect(portraitSource).toContain('const atlasPending = ensureSkinTexture(visualKey, skin);');
    expect(portraitSource).toContain('if (atlasPending) {');
    expect(portraitSource).toContain('return null;');
    expect(portraitChipSource).toContain('onPortraitUpdate((visualKey, skin) => {');
    expect(mainSource).toContain('refreshStartSkinPickerPortraits(');
  });
});

describe('dead sprite retention after the VFX atlas composite', () => {
  it('releases the source sprites once the atlas canvas owns their pixels', () => {
    expect(vfxSource).toContain('spriteImages[i] = null;');
    expect(vfxSource).toContain('releaseTexture(`/vfx/${SPRITE_FILES[i]}.png`, { srgb: true });');
  });

  // Releasing the sources is only safe because the composed canvas is reused: a
  // second Vfx is real (the editor viewport's reload() builds a fresh Renderer,
  // and each Renderer owns a Vfx), and recomposing with the sources gone would
  // paint all 16 cells as fallback discs - a silent, total loss of particle art
  // that no existing test would catch.
  it('composes the atlas canvas exactly once and wraps it per instance', () => {
    // The release lives in the composer, which is called only through the ??= memo.
    const composeAt = vfxSource.indexOf('function composeAtlasCanvas()');
    const releaseAt = vfxSource.indexOf('spriteImages[i] = null;');
    const buildAt = vfxSource.indexOf('function buildAtlasTexture()');
    expect(composeAt).toBeGreaterThan(-1);
    expect(releaseAt).toBeGreaterThan(composeAt);
    expect(buildAt).toBeGreaterThan(releaseAt);
    expect(vfxSource).toContain('atlasCanvas ??= composeAtlasCanvas();');
    // Each instance still gets its OWN texture object over that shared canvas,
    // so two live renderers never share one GPU upload.
    expect(vfxSource).toContain('const tex = new THREE.CanvasTexture(atlasCanvas);');
  });
});

describe('native device-memory bridge', () => {
  const pluginSource = read('../ios/App/App/NativeDeviceInfoPlugin.swift');
  const controllerSource = read('../ios/App/App/AppViewController.swift');
  const pbxproj = read('../ios/App/App.xcodeproj/project.pbxproj');

  it('exposes physical memory from the shell and registers the plugin', () => {
    expect(pluginSource).toContain('ProcessInfo.processInfo.physicalMemory');
    expect(pluginSource).toContain('"physicalMemoryBytes"');
    expect(pluginSource).toContain('public let jsName = "NativeDeviceInfo"');
    expect(pluginSource).toContain('CAPPluginMethod(name: "getMemoryInfo"');
    expect(controllerSource).toContain('registerPluginInstance(NativeDeviceInfoPlugin())');
    expect(mainSource).toContain('void primeNativeDeviceMemoryHint();');
  });

  it('compiles the plugin into the app target', () => {
    expect(pbxproj).toContain('NativeDeviceInfoPlugin.swift in Sources');
  });

  it('no-ops fail-soft outside the native shell', async () => {
    await expect(primeNativeDeviceMemoryHint()).resolves.toBeUndefined();
  });
});

describe('preload registry retains no resolution values', () => {
  // The registry is module-level and append-only by design, and two callers exist
  // in production (portrait.ts at module import, main.ts in startGame), so the
  // fix erases each task's VALUE rather than draining the array: repeat and
  // concurrent callers must keep behaving exactly as they did.
  it('never exposes a registered task resolution value', async () => {
    const texture = { marker: 'a live THREE.Texture stands in here' };
    registerPreload(Promise.resolve(texture));
    registerPreload(Promise.resolve(42));
    const seen: Array<[number, number]> = [];
    await assetsReady((done, total) => seen.push([done, total]));
    expect(seen.at(-1)).toEqual([2, 2]);
    // Awaiting the stored tasks must yield undefined, not the texture: anything
    // else means the array is still a retainer and a consumer-side release
    // (vfx.ts dropping its sprite sources) cannot actually free the pixels.
    const stored = preloadInternalsForTest.tasks();
    expect(stored).toHaveLength(2);
    await expect(Promise.all(stored)).resolves.toEqual([undefined, undefined]);
  });

  it('keeps counting progress against the full registry for a later caller', async () => {
    registerPreload(Promise.resolve('one'));
    registerPreload(Promise.resolve('two'));
    const before = preloadInternalsForTest.tasks().length;
    const first: Array<[number, number]> = [];
    await assetsReady((done, total) => first.push([done, total]));
    const second: Array<[number, number]> = [];
    await assetsReady((done, total) => second.push([done, total]));
    // Both callers see the same full denominator: nothing was drained between
    // them (portrait.ts calls this at module import, main.ts again in startGame).
    expect(first.at(-1)).toEqual([before, before]);
    expect(second.at(-1)).toEqual([before, before]);
  });

  // LAST in this describe on purpose: the registry is module-level with no reset
  // (that is the contract under test), so a rejected task registered here stays
  // and would fail every later case in the file.
  it('still reports every failure, on repeat calls too (no drain)', async () => {
    registerPreload(Promise.reject(new Error('cdn fell over')));
    await expect(assetsReady()).rejects.toThrow('asset preload failed (1)');
    // The registry is intact, so a second caller observes the same failure
    // rather than a silent success.
    await expect(assetsReady()).rejects.toThrow('asset preload failed (1)');
  });
});
