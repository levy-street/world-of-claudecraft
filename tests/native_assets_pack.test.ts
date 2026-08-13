// Source pins for the Android Play Asset Delivery install-time pack that
// keeps the Play base module under Google Play's 500 MB compressed-download
// cap (docs/mobile-store-release.md, "Keeping the Play build under the size
// cap"). There is no Android build in CI, so these pins are what keeps the
// gradle wiring from being silently dropped: losing any one of them ships
// either an oversized base module (Play rejects the upload) or an APK with no
// media/audio at all (a broken app).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8').replace(/\r\n/g, '\n');

describe('Play asset pack wiring pins', () => {
  it('the asset pack module exists, install-time, under the pinned name', () => {
    const pack = read('android/woc_media_pack/build.gradle');
    expect(pack).toContain("apply plugin: 'com.android.asset-pack'");
    expect(pack).toContain('packName = "woc_media_pack"');
    expect(pack).toContain('deliveryType = "install-time"');
  });

  it('settings.gradle builds the pack and the app declares it', () => {
    expect(read('android/settings.gradle')).toContain("include ':woc_media_pack'");
    expect(read('android/app/build.gradle')).toContain('assetPacks = [":woc_media_pack"]');
  });

  it('the relocation task covers exactly the heavy directories, both directions', () => {
    const gradle = read('android/app/build.gradle');
    expect(gradle).toContain("def heavyAssetDirs = ['media', 'audio']");
    expect(gradle).toContain("tasks.register('relocateHeavyWebAssets')");
    // Split on bundle builds, restore on everything else: the direction test
    // is the startParameter scan, and preBuild is what makes it unskippable.
    expect(gradle).toContain("it.toLowerCase().contains('bundle')");
    expect(gradle).toContain("preBuild.dependsOn tasks.named('relocateHeavyWebAssets')");
    // Fail LOUDLY when an expected directory is in neither location (a stale
    // or partial sync), rather than building a quietly broken artifact.
    expect(gradle).toContain('missing from both the base assets and the pack');
  });

  it('the restore direction treats the base as authoritative (no stale-pack clobber)', () => {
    // After a fresh `cap sync` the base holds the current assets and any pack
    // copy is stale; a non-bundle build must DISCARD the stale pack copy, never
    // move it over the fresh base. The guard is `if (base.exists()) delete(pack)`.
    const gradle = read('android/app/build.gradle');
    expect(gradle).toMatch(/if \(base\.exists\(\)\)\s*\{\s*project\.delete\(pack\)/);
  });

  it('the relocated assets are gitignored like the cap-synced ones', () => {
    expect(read('android/.gitignore')).toContain('woc_media_pack/src/main/assets');
  });
});
