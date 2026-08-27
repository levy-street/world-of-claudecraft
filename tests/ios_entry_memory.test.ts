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
    // Reflow-proof: the boot block must await all THREE locale-chunk loaders
    // together (the catalog chunk, the deed chunk, the Reliquary page-name
    // chunk). Matching on names and structure rather than on a pasted
    // indentation literal, so a biome reformat does not read as a dropped
    // loader, while dropping one really does fail.
    const localeAwaitAt = mainSource.search(
      /await Promise\.all\(\[\s*ensureLocaleLoaded\(getLanguage\(\)\),\s*\.\.\.CONTENT_LOCALE_CHANNEL_ENSURERS\.map\(\s*\(ensure\)\s*=>\s*ensure\(getLanguage\(\)\),?\s*\),?\s*\]\);/,
    );
    const assetsAwaitAt = mainSource.indexOf('await assetsReady(');
    const sceneRestampAt = mainSource.indexOf("entryDiagnostics.checkpoint('scene-build-start'");
    expect(startAt).toBeGreaterThan(-1);
    expect(awaitCheckpointAt).toBeGreaterThan(startAt);
    expect(localeAwaitAt, 'the three-loader await block form drifted').toBeGreaterThan(-1);
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

describe('optional preview warmups', () => {
  it('keeps the old blocking pre-reveal preview prewarm calls deleted', () => {
    // The paced startPostEntryPreviewPrewarm lane (pinned below) owns preview
    // warmup now; the old curtain-holding awaits must never return.
    expect(mainSource).not.toContain('hud.prewarmCharacterPreview()');
    expect(mainSource).not.toContain('hud.prewarmArmoryPreview()');
  });

  it('lets the far vista settle after first paint instead of holding the curtain', () => {
    const firstPaintAt = mainSource.indexOf("checkpoint('first-paint')");
    const farVistaAt = mainSource.indexOf(
      'settleFarVista: () => renderer.farVistaReady(),',
      firstPaintAt,
    );
    expect(firstPaintAt).toBeGreaterThan(-1);
    expect(farVistaAt).toBeGreaterThan(firstPaintAt);
    expect(mainSource).not.toContain('await renderer.farVistaReady()');
    expect(mainSource).not.toContain("loadSpanAsync('far-vista-wait'");
  });
});

describe('tight-memory residency diet', () => {
  it('skips the secondary-context preview prewarm schedule on the tight profile', () => {
    const startAt = mainSource.indexOf('if (!GFX.tightMemory) hud.startPostEntryPreviewPrewarm();');
    expect(startAt).toBeGreaterThan(-1);
    // The schedule runs BEHIND the live frame (post-reveal), so the secondary
    // preview contexts never add to the curtained entry allocation spike; the
    // tight profile skips them entirely and keeps the lazy first-open path.
    const revealAt = mainSource.indexOf('const revealWorld = (): void => {');
    expect(revealAt).toBeGreaterThan(-1);
    expect(startAt).toBeGreaterThan(revealAt);
  });

  it('keeps the curtain-side paperdoll shell build inside the tight-memory gate', () => {
    const callAt = mainSource.indexOf('hud.prewarmCharPreviewShell()');
    expect(callAt).toBeGreaterThan(-1);
    // Anchor on the NEAREST preceding gate, not the first one in the file: a
    // plain indexOf-ordering check (gate index before call index) would still
    // pass if some unrelated earlier "!GFX.tightMemory" text existed anywhere
    // above the call.
    const gateAt = mainSource.lastIndexOf('if (!GFX.tightMemory) {', callAt);
    expect(gateAt).toBeGreaterThan(-1);
    // The gate's own closing brace must not appear between the gate and the
    // call: that would mean the block already ended and the call runs
    // unconditionally, even though the ordering check above would still hold.
    const between = mainSource.slice(gateAt, callAt);
    expect(between).not.toMatch(/\n {2}\}/);
    expect(between).toContain("loadSpan('char-preview-shell', () =>");
  });
});

describe('deferred cosmetic skin atlases', () => {
  it('keeps the alternate-atlas sweep out of every boot gate', () => {
    expect(assetsSource).toContain('const eagerSkinAtlases = false;');
    // The character-preview gate must not re-await atlases the boot deferred.
    expect(assetsSource).toContain('const missingSkins = eagerSkinAtlases');
  });

  it('heals a deferred atlas at visual construction, not only on live swaps', () => {
    expect(visualSource).toContain('const pendingAtlas = ensureSkinTexture(this.key, skinIndex);');
  });

  it('never caches a portrait rendered while its atlas is still in flight', () => {
    // The pending guard lives in trackSkinAtlasPending, shared by the sync
    // capture path (returns null, fallback crest) AND the paced async prewarm
    // (early-outs before building anything).
    expect(portraitSource).toContain('const atlasPending = ensureSkinTexture(visualKey, skin);');
    expect(portraitSource).toContain('if (!atlasPending) return false;');
    expect(portraitSource).toContain('if (trackSkinAtlasPending(visualKey, skin)) return null;');
    expect(portraitSource).toContain('atlasPending: () => trackSkinAtlasPending(visualKey, skin),');
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

describe('post-entry mob-body streaming', () => {
  // The heaviest character content (creatures + the skeleton family, embedded
  // 1024-class atlases) is carved out of the boot gate on every host and streamed
  // after first paint through the fail-soft view-create seam (#2079). This avoids
  // the measured desktop boot burst too: 47 creature GLBs were fetched together.
  it('streams mobs on every host with bounded concurrency and leaves skins on demand', () => {
    expect(assetsSource).toContain(
      "const STREAMED_URL_PREFIXES = ['models/creatures/', 'models/chars/enemies/'];",
    );
    // Weapon SKINS stream (cosmetic, degradable); the BASE item weapons do not,
    // so the player's own hands are never empty at spawn and the degrade path
    // below always has a resident fallback.
    expect(assetsSource).toContain('const streamedSkinUrls = new Set(weaponSkinModelUrls());');
    // The preview gate sweeps the GATE set, so the launcher never awaits or
    // re-fetches streamed content.
    expect(assetsSource).toContain(
      'const preloadUrls = allPreloadUrls.filter((url) => !streamedUrlSet.has(url));',
    );
    expect(assetsSource).toContain(
      'streamedSkinUrls.has(url) || STREAMED_URL_PREFIXES.some((prefix) => url.includes(prefix))',
    );
    expect(assetsSource).toContain('let streamedUrls = streamedCharacterUrlsFor();');
    expect(assetsSource).toContain(
      'let postEntryStreamUrls = postEntryStreamUrlsFor(streamedUrls);',
    );
    expect(assetsSource).toContain('const dummyUrl = VISUALS.mob_training_dummy?.url;');
    expect(assetsSource).toContain('STREAMED_URL_PREFIXES.some((prefix) => url.includes(prefix))');
    expect(assetsSource).toContain('const POST_ENTRY_CHARACTER_STREAM_CONCURRENCY = 2;');
    expect(assetsSource).toContain('void runBoundedLane(');
    expect(assetsSource).toContain('POST_ENTRY_CHARACTER_STREAM_CONCURRENCY');
    expect(assetsSource).toContain('preloadTrainingDummyAssets');
    expect(assetsSource).toContain('return postEntryStreamUrls.length;');
    expect(assetsSource).not.toContain('for (const url of streamedUrls) {');
  });

  it('degrades a not-yet-resident skin to the base weapon instead of throwing', () => {
    // All three attach resolvers route their skin url through residentOrEnsure,
    // which kicks the fetch and returns null so the resident fallback applies.
    // swapAttachDef reads the skin url first and uses it only when resident,
    // then falls back to the item model. Two statements rather than one `??`
    // because a DISPLAYED ranged skin also relocates the bone on that arm (a
    // bow moves to the left handslot on the mech), which the fallback must not.
    expect(assetsSource).toContain(
      'const skinUrl = residentOrEnsure(weaponSkinModelUrl(weaponSkinId));',
    );
    expect(assetsSource).toContain('const url = itemWeaponModelUrl(weaponItemId);');
    expect(assetsSource).toContain(
      'const resident = residentOrEnsure(url) ?? itemOffhandModelUrl(offhandItemId);',
    );
    expect(assetsSource).toContain(
      'const url = residentOrEnsure(weaponSkinModelUrl(weaponSkinId));',
    );
    // The launcher ensures the roster's own skins on demand (the mech pattern).
    expect(mainSource).toContain('ensureCharacterUrl(weaponSkinModelUrl(c.weaponSkinId ?? null));');
  });

  it('degrades a not-yet-resident skin in the Armory display-model path', () => {
    // weaponSkinDisplayModel feeds the store preview. The catalog is no longer
    // warmed ahead of time (docs/design/armory-preview-warming.md), so this now
    // guards the CLICK path: a non-resident streamed skin returns null, which
    // the rig treats as unavailable, instead of letting resolvedGltf escape an
    // ArmoryInspect click handler. Note the weapon rig retries on the reselect
    // once the GLB lands; the character rig cache does not, which is a separate
    // pre-existing defect recorded in the handoff notes.
    expect(assetsSource).toContain('if (residentOrEnsure(url) === null) return null;');
    // Only the WEAPON preview recovers on reselect (same-skin no-op is guarded
    // on the rig existing). The character rig cache has no such retry, so a card
    // opened before its GLB lands keeps a rig wearing the base weapon: a
    // separate pre-existing defect, recorded in the handoff notes.
    const previewSource = readFileSync(
      new URL('../src/render/armory_preview.ts', import.meta.url),
      'utf8',
    );
    expect(previewSource).toContain(
      'if (disposed || (next === skinId && (next === null || activeWeaponRig !== null))) return;',
    );
  });

  it('re-arms a failed streamed body fetch from the visual-build miss path', () => {
    // A streamed body whose one-shot stream fetch failed must not stay
    // invisible for the session: resolvedGltf kicks the fetch again before its
    // fail-soft throw, and the view-create retry gate re-attempts the build.
    // Gated to streamed urls so a non-streamed miss stays a loud preload bug.
    expect(assetsSource).toContain('if (streamedUrlSet.has(url)) ensureCharacterUrl(url);');
  });

  it('starts the stream at first paint, not inside the entry gate', () => {
    const firstPaintAt = mainSource.indexOf("checkpoint('first-paint')");
    const kickAt = mainSource.indexOf('kickCharacterPreloadStream({', firstPaintAt);
    const streamAt = mainSource.indexOf(
      'startCharacterPreloads: startStreamedCharacterPreloads,',
      kickAt,
    );
    // The review fix: the kick rides the first-paint frame itself, AHEAD of
    // the GPU settle cover and the curtain fade. The old post-fade placement
    // widened the iOS creature pop-in window by settle plus fade, and the
    // allocation spike the stream was deferred past has cleared by first paint.
    const settleCoverAt = mainSource.indexOf("loadPhaseStart('settle-cover')", firstPaintAt);
    const assetsAwaitAt = mainSource.indexOf('await assetsReady(');
    expect(firstPaintAt).toBeGreaterThan(-1);
    expect(kickAt).toBeGreaterThan(firstPaintAt);
    expect(streamAt).toBeGreaterThan(kickAt);
    expect(settleCoverAt).toBeGreaterThan(streamAt);
    expect(streamAt).toBeGreaterThan(assetsAwaitAt);
  });

  it('extracts props and foliage as they land on every iOS WebKit host', () => {
    const propsSource = read('../src/render/props.ts');
    const foliageSource = read('../src/render/foliage.ts');
    expect(propsSource).toContain('if (GFX.iosMemoryProfile) propAsset(key);');
    // Foliage additionally gates extraction on live-tier membership (see
    // tests/foliage_preload_boot.test.ts): the FETCH stays unconditional (the
    // pine_2.glb crash fix), but eagerly baking a HIGH-only variant the current
    // tier guess will never place would cost exactly the iOS memory this profile
    // protects, for nothing.
    expect(foliageSource).toContain(
      'if (GFX.iosMemoryProfile && Object.values(foliageModelUrlsFor(GFX)).flat().includes(url)) {',
    );
    expect(foliageSource).toContain('extractParts(url);');
  });
});
