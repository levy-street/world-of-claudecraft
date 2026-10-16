// WOC player bodies are never in the boot preload (src/render/characters/woc_armor_core.ts):
// the launcher fetches a fit on demand and world entry loads both (woc_entry_preload.ts). So a
// test that builds a WOC player visual right after charactersReady() lands their base and
// animation library first, as either of those would.
// Pass the SAME assets module instance the harness imported (after its vi.doMock calls).

import { VISUALS } from '../../src/render/characters/manifest';
import type { WocCharacterManifest } from '../../src/render/characters/woc_character_manifest';

interface StreamedAssets {
  visualAssetsResident(key: string): boolean;
}

interface StreamedKits {
  wocKitResident(manifest: WocCharacterManifest): boolean;
}

interface StreamedHeads {
  ensureWocHeadForAppearance(fit: 'male' | 'female', app: null): boolean;
}

interface FailableHeads {
  failWocHeadFileForTest(url: string): void;
}

/** For a harness whose stubbed loader carries no head library: mark both head types' core
 *  files as failed before any body is built. A WOC body draws nothing while it waits for its
 *  head (a base file ends at the neck) and only a failed head file ends that wait, so this is
 *  what lets a stub body, which can never hang a head, draw at all. Pass the SAME
 *  woc_head_packs module instance the harness imported (after its vi.doMock calls). */
export function failWocHeads(heads: FailableHeads): void {
  for (const type of ['a', 'b']) {
    heads.failWocHeadFileForTest(`models/chars/players/woc/head_type_${type}_core.glb`);
  }
}

/** Every WOC player visual key (both fits of every class). */
export function wocVisualKeys(): string[] {
  return Object.entries(VISUALS)
    .filter(([, def]) => def.wocCharacter)
    .map(([key]) => key);
}

/** Fetch (through the harness's loader) and wait for these visual keys' body files; every WOC
 *  key when none are named. */
export async function landWocBodies(
  assets: StreamedAssets,
  keys: readonly string[] = wocVisualKeys(),
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!keys.every((key) => assets.visualAssetsResident(key))) {
    if (Date.now() > deadline) throw new Error(`WOC bodies never landed: ${keys.join(', ')}`);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** The real-browser form (tests/browser): land each key's body, clip library, its default
 *  kit's armor files at the live tier AND its default head look's files, over the real
 *  network, before a test builds the visual directly (a CharacterVisual built early throws;
 *  one built before its kit lands draws the bare suit until the file attaches; one built
 *  before its head lands draws nothing until it does, and goes live on the look it is handed,
 *  `setWocHeadLook`, or on its first update). */
export async function landWocFiles(
  assets: StreamedAssets,
  dressing: StreamedKits,
  heads: StreamedHeads,
  keys: readonly string[] = wocVisualKeys(),
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const landed = (key: string) => {
    const manifest = VISUALS[key]?.wocCharacter;
    // evaluate all three: each call kicks its own fetch
    const body = assets.visualAssetsResident(key);
    const kit = manifest ? dressing.wocKitResident(manifest) : true;
    const head = manifest ? heads.ensureWocHeadForAppearance(manifest.fit, null) : true;
    return body && kit && head;
  };
  while (!keys.map(landed).every(Boolean)) {
    if (Date.now() > deadline) throw new Error(`WOC files never landed: ${keys.join(', ')}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
