import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  azureSignOptionsFromEnv,
  desktopBuilderConfig,
  isChannelFeedFile,
  keyVaultSignConfigFromEnv,
  stampChannelFeedFiles,
  stampFeedFile,
} from '../scripts/electron-builder-config.mjs';

// A miniature of package.json's "build" block: just the keys the channel
// derivation touches, plus one it must pass through untouched.
const base = {
  appId: 'com.worldofclaudecraft.desktop',
  files: ['dist/**', 'electron/**', '!node_modules/**'],
  directories: { buildResources: 'build', output: 'release' },
  publish: { provider: 'generic', url: 'https://updates.example.com/desktop' },
  mac: { hardenedRuntime: true, target: [{ target: 'dmg', arch: ['universal'] }] },
  win: { target: [{ target: 'nsis', arch: ['x64', 'arm64'] }] },
  linux: { target: [{ target: 'AppImage', arch: ['x64', 'arm64'] }] },
};

const prodOrigin = 'https://worldofclaudecraft.com';

describe('desktopBuilderConfig', () => {
  it('stamps the website channel into extraMetadata and keeps the publish feed', () => {
    const config = desktopBuilderConfig({ base, distribution: 'website', apiOrigin: prodOrigin });
    expect(config.extraMetadata.wocDesktop).toEqual({
      distribution: 'website',
      apiOrigin: prodOrigin,
    });
    expect(config.publish).toEqual({ ...base.publish, channel: 'latest' });
    expect(config.appId).toBe(base.appId);
    expect(config.mac.hardenedRuntime).toBe(true);
  });

  it('routes the production origin to the latest update channel', () => {
    const config = desktopBuilderConfig({ base, distribution: 'website', apiOrigin: prodOrigin });
    expect(config.publish?.channel).toBe('latest');
  });

  it('routes every non-production origin to the dev update channel (issue 1537)', () => {
    for (const apiOrigin of [
      'https://dev.worldofclaudecraft.com',
      'http://localhost:8787',
      undefined,
    ]) {
      const config = desktopBuilderConfig({ base, distribution: 'website', apiOrigin });
      expect(config.publish?.channel).toBe('dev');
    }
  });

  it('refuses to emit production feed files for a non-production origin', () => {
    expect(() =>
      desktopBuilderConfig({
        base,
        distribution: 'website',
        apiOrigin: 'http://localhost:8787',
        updateChannel: 'latest',
      }),
    ).toThrow(/refusing to emit production update-feed files/);
    expect(() =>
      desktopBuilderConfig({ base, distribution: 'website', updateChannel: 'latest' }),
    ).toThrow(/refusing to emit production update-feed files/);
  });

  it('allows staging a production-origin artifact on the dev track, but no other override', () => {
    const staged = desktopBuilderConfig({
      base,
      distribution: 'website',
      apiOrigin: prodOrigin,
      updateChannel: 'dev',
    });
    expect(staged.publish?.channel).toBe('dev');
    expect(() =>
      desktopBuilderConfig({
        base,
        distribution: 'website',
        apiOrigin: prodOrigin,
        updateChannel: 'beta',
      }),
    ).toThrow(/unknown desktop update channel/);
  });

  it('treats a set-but-empty WOC_UPDATE_CHANNEL as unset and derives from the origin', () => {
    const prod = desktopBuilderConfig({
      base,
      distribution: 'website',
      apiOrigin: prodOrigin,
      updateChannel: '',
    });
    expect(prod.publish?.channel).toBe('latest');
    const dev = desktopBuilderConfig({
      base,
      distribution: 'website',
      apiOrigin: 'http://localhost:8787',
      updateChannel: '',
    });
    expect(dev.publish?.channel).toBe('dev');
  });

  it('rejects an unparseable non-empty origin at build time (would strand the install)', () => {
    // A schemeless origin derives the dev channel at build time but normalizes
    // to production in the runtime guard, refusing every stamped update on its
    // own track forever; that mistake must die here.
    for (const apiOrigin of ['localhost:8787', 'worldofclaudecraft.com', 'not a url']) {
      expect(() => desktopBuilderConfig({ base, distribution: 'website', apiOrigin })).toThrow(
        /parseable http\(s\) VITE_DESKTOP_API_ORIGIN/,
      );
    }
    // Steam builds publish nothing, so the same origin does not throw there.
    expect(
      desktopBuilderConfig({
        base,
        distribution: 'steam',
        apiOrigin: 'localhost:8787',
        steamAppId: '480',
      }).publish,
    ).toBeNull();
  });

  it('never mutates the base config object', () => {
    const before = JSON.stringify(base);
    desktopBuilderConfig({ base, distribution: 'steam', steamAppId: '480' });
    desktopBuilderConfig({ base, distribution: 'website', mode: 'pack' });
    desktopBuilderConfig({
      base,
      distribution: 'epic',
      epicProductId: 'prod',
      epicDeploymentId: 'dep',
      epicClientId: 'client',
    });
    expect(JSON.stringify(base)).toBe(before);
  });

  it('steam: nulls publish, stamps steam, targets dir layouts in release-steam', () => {
    const config = desktopBuilderConfig({ base, distribution: 'steam', steamAppId: '480' });
    expect(config.extraMetadata.wocDesktop).toEqual({ distribution: 'steam', steamAppId: '480' });
    expect(config.publish).toBeNull();
    // The update-track split never touches Steam: publish stays nulled and a
    // dev origin does not trip the production-channel guard.
    const devSteam = desktopBuilderConfig({
      base,
      distribution: 'steam',
      apiOrigin: 'http://localhost:8787',
      steamAppId: '480',
    });
    expect(devSteam.publish).toBeNull();
    expect(config.directories.output).toBe('release-steam');
    expect(config.mac.target).toEqual([{ target: 'dir', arch: ['universal'] }]);
    expect(config.win.target).toEqual([{ target: 'dir', arch: ['x64'] }]);
    expect(config.linux?.target).toEqual([{ target: 'dir', arch: ['x64'] }]);
    // Non-target mac keys survive the override.
    expect(config.mac.hardenedRuntime).toBe(true);
  });

  it('steam: ships steamworks.js (files re-include + native dist asarUnpack); website does not', () => {
    const steam = desktopBuilderConfig({ base, distribution: 'steam', steamAppId: '480' });
    const steamFiles = steam.files ?? [];
    expect(steamFiles).toContain('node_modules/steamworks.js/**');
    expect(steam.asarUnpack).toContain('node_modules/steamworks.js/dist/**');
    // The re-include must come AFTER the base '!node_modules/**' exclusion so
    // electron-builder's later-pattern-wins ordering re-admits the package.
    expect(steamFiles.indexOf('node_modules/steamworks.js/**')).toBeGreaterThan(
      steamFiles.indexOf('!node_modules/**'),
    );
    // Website artifacts stay byte-identical to a pre-Steam build: no
    // steamworks entries anywhere.
    const website = desktopBuilderConfig({ base, distribution: 'website' });
    expect(website.files ?? []).not.toContain('node_modules/steamworks.js/**');
    expect(website.asarUnpack ?? []).not.toContain('node_modules/steamworks.js/dist/**');
  });

  it('steam: fails fast when the steamworks.js optional dependency is absent', () => {
    // steamworks.js is an optionalDependency, which npm skips silently on
    // install failure. A depot packaged from such a tree would ship without
    // Steam (electron/steam.cjs degrades to null), so the steam channel must
    // refuse to build. The presence probe is injected, so this stays hermetic.
    expect(() =>
      desktopBuilderConfig({
        base,
        distribution: 'steam',
        steamAppId: '480',
        steamworksInstalled: () => false,
      }),
    ).toThrow(/steamworks\.js optional dependency/);
    // Present: the steam config derives as usual, native package re-included.
    const present = desktopBuilderConfig({
      base,
      distribution: 'steam',
      steamAppId: '480',
      steamworksInstalled: () => true,
    });
    expect(present.publish).toBeNull();
    expect(present.files ?? []).toContain('node_modules/steamworks.js/**');
    // The probe never runs for other channels: a website build succeeds even
    // when the same probe reports steamworks.js absent.
    expect(() =>
      desktopBuilderConfig({ base, distribution: 'website', steamworksInstalled: () => false }),
    ).not.toThrow();
    // And an unprobed steam build (no injected check) is a pure derivation that
    // never touches the filesystem, so the config tests above stay valid.
    expect(
      desktopBuilderConfig({ base, distribution: 'steam', steamAppId: '480' }).publish,
    ).toBeNull();
  });

  it('steam: refuses a missing or non-numeric WOC_STEAM_APP_ID (no silent Spacewar depot)', () => {
    // Without the id the packaged depot would init Steam with the Spacewar dev
    // id (480) and every link ticket would verify against the wrong app; that
    // mistake must die at build time, not on players' machines.
    expect(() => desktopBuilderConfig({ base, distribution: 'steam' })).toThrow(/WOC_STEAM_APP_ID/);
    expect(() => desktopBuilderConfig({ base, distribution: 'steam', steamAppId: '' })).toThrow(
      /WOC_STEAM_APP_ID/,
    );
    expect(() => desktopBuilderConfig({ base, distribution: 'steam', steamAppId: 'abc' })).toThrow(
      /WOC_STEAM_APP_ID/,
    );
    // "0" is all-digits but not a real Steam app: the /^\d+$/ shape check
    // alone would stamp app id 0 into the depot, so the gate requires a
    // POSITIVE integer (the runtime string branch holds the same bar).
    expect(() => desktopBuilderConfig({ base, distribution: 'steam', steamAppId: '0' })).toThrow(
      /WOC_STEAM_APP_ID/,
    );
    expect(() => desktopBuilderConfig({ base, distribution: 'steam', steamAppId: '00' })).toThrow(
      /WOC_STEAM_APP_ID/,
    );
    // Pack mode gets no exemption: a local steam pack wants the same guard (a
    // deliberate Spacewar pack passes WOC_STEAM_APP_ID=480 explicitly).
    expect(() => desktopBuilderConfig({ base, distribution: 'steam', mode: 'pack' })).toThrow(
      /WOC_STEAM_APP_ID/,
    );
  });

  it('stamps a numeric steamAppId for the steam channel; website never stamps', () => {
    const stamped = desktopBuilderConfig({ base, distribution: 'steam', steamAppId: '3140820' });
    expect(stamped.extraMetadata.wocDesktop.steamAppId).toBe('3140820');
    const website = desktopBuilderConfig({
      base,
      distribution: 'website',
      steamAppId: '3140820',
    });
    expect('steamAppId' in website.extraMetadata.wocDesktop).toBe(false);
    // The website channel needs no id at all.
    expect(() => desktopBuilderConfig({ base, distribution: 'website' })).not.toThrow();
  });

  it('stamps the resolved web origins so a packaged build never reads them from runtime env', () => {
    const config = desktopBuilderConfig({
      base,
      distribution: 'website',
      apiOrigin: 'https://api.example.com',
      loginOrigin: 'https://login.example.com',
    });
    expect(config.extraMetadata.wocDesktop.apiOrigin).toBe('https://api.example.com');
    expect(config.extraMetadata.wocDesktop.loginOrigin).toBe('https://login.example.com');
    const bare = desktopBuilderConfig({ base, distribution: 'website' });
    expect('apiOrigin' in bare.extraMetadata.wocDesktop).toBe(false);
    expect('loginOrigin' in bare.extraMetadata.wocDesktop).toBe(false);
  });

  it('carries the crash submit URL only when one is set', () => {
    const withUrl = desktopBuilderConfig({
      base,
      distribution: 'website',
      crashSubmitUrl: 'https://crash.example.com/minidump',
    });
    expect(withUrl.extraMetadata.wocDesktop.crashSubmitUrl).toBe(
      'https://crash.example.com/minidump',
    );
    const without = desktopBuilderConfig({ base, distribution: 'website' });
    expect('crashSubmitUrl' in without.extraMetadata.wocDesktop).toBe(false);
  });

  it('pack mode strips the arch matrix down to host-arch target names', () => {
    const config = desktopBuilderConfig({ base, distribution: 'website', mode: 'pack' });
    expect(config.mac.target).toEqual(['dmg']);
    expect(config.win.target).toEqual(['nsis']);
    expect(config.linux?.target).toEqual(['AppImage']);
    const steamPack = desktopBuilderConfig({
      base,
      distribution: 'steam',
      mode: 'pack',
      steamAppId: '480',
    });
    expect(steamPack.mac.target).toEqual(['dir']);
  });

  it('injects azureSignOptions only when provided', () => {
    const azureSign = {
      publisherName: 'CN=Example Corp',
      endpoint: 'https://eus.codesigning.azure.net',
      codeSigningAccountName: 'example-account',
      certificateProfileName: 'example-profile',
    };
    const config = desktopBuilderConfig({ base, distribution: 'website', azureSign });
    expect(config.win.azureSignOptions).toEqual(azureSign);
    const plain = desktopBuilderConfig({ base, distribution: 'website' });
    expect(plain.win.azureSignOptions).toBeUndefined();
  });

  it('injects the Key Vault sign hook only when provided, and Trusted Signing wins', () => {
    const keyVaultSign = {
      sign: './scripts/electron-win-sign.mjs',
      signingHashAlgorithms: ['sha256'],
    };
    const config = desktopBuilderConfig({ base, distribution: 'website', keyVaultSign });
    expect(config.win.signtoolOptions).toEqual(keyVaultSign);
    expect(config.win.azureSignOptions).toBeUndefined();
    const azureSign = {
      publisherName: 'CN=Example Corp',
      endpoint: 'https://eus.codesigning.azure.net',
      codeSigningAccountName: 'example-account',
      certificateProfileName: 'example-profile',
    };
    const both = desktopBuilderConfig({ base, distribution: 'website', azureSign, keyVaultSign });
    expect(both.win.azureSignOptions).toEqual(azureSign);
    expect(both.win.signtoolOptions).toBeUndefined();
    const plain = desktopBuilderConfig({ base, distribution: 'website' });
    expect(plain.win.signtoolOptions).toBeUndefined();
  });

  it('rejects an unknown distribution loudly', () => {
    expect(() => desktopBuilderConfig({ base, distribution: 'beta' })).toThrow(
      /unknown desktop distribution/,
    );
  });

  // Epic packaging channel (Phase 2): Steam-shaped third channel. Output is
  // release-epic/, publish null, Win+Mac dir only (no linux), and the three
  // EOS public ids are required stamps. Website and steam never need them.
  const epicIds = {
    epicProductId: 'epic-product-id',
    epicDeploymentId: 'epic-deployment-id',
    epicClientId: 'epic-client-id',
  };

  it('epic: nulls publish, stamps epic, targets dir layouts in release-epic (Win+Mac only)', () => {
    const config = desktopBuilderConfig({ base, distribution: 'epic', ...epicIds });
    expect(config.extraMetadata.wocDesktop).toEqual({
      distribution: 'epic',
      epicProductId: 'epic-product-id',
      epicDeploymentId: 'epic-deployment-id',
      epicClientId: 'epic-client-id',
    });
    expect(config.publish).toBeNull();
    // The update-track split never touches Epic: publish stays nulled and a
    // dev origin does not trip the production-channel guard.
    const devEpic = desktopBuilderConfig({
      base,
      distribution: 'epic',
      apiOrigin: 'http://localhost:8787',
      ...epicIds,
    });
    expect(devEpic.publish).toBeNull();
    expect(config.directories.output).toBe('release-epic');
    expect(config.mac.target).toEqual([{ target: 'dir', arch: ['universal'] }]);
    expect(config.win.target).toEqual([{ target: 'dir', arch: ['x64'] }]);
    // D6: no linux epic target (EGS v1 is Win+Mac only). The linux block is
    // dropped entirely so electron-builder never emits a linux artifact.
    expect(config.linux).toBeUndefined();
    // Non-target mac keys survive the override.
    expect(config.mac.hardenedRuntime).toBe(true);
    // No steam stamp leaks onto the epic channel.
    expect(config.extraMetadata.wocDesktop).not.toHaveProperty('steamAppId');
  });

  it('epic: refuses a missing or blank WOC_EPIC_* id (no silent empty EOS stamp)', () => {
    // Without all three public ids the packaged Epic build cannot init EOS and
    // would degrade to null on every path; that mistake must die at build time.
    // Server secrets (client secret) are deliberately not part of this stamp.
    expect(() => desktopBuilderConfig({ base, distribution: 'epic' })).toThrow(/WOC_EPIC_/);
    expect(() =>
      desktopBuilderConfig({
        base,
        distribution: 'epic',
        epicProductId: '',
        epicDeploymentId: 'dep',
        epicClientId: 'client',
      }),
    ).toThrow(/WOC_EPIC_/);
    expect(() =>
      desktopBuilderConfig({
        base,
        distribution: 'epic',
        epicProductId: 'prod',
        epicDeploymentId: '',
        epicClientId: 'client',
      }),
    ).toThrow(/WOC_EPIC_/);
    expect(() =>
      desktopBuilderConfig({
        base,
        distribution: 'epic',
        epicProductId: 'prod',
        epicDeploymentId: 'dep',
        epicClientId: '',
      }),
    ).toThrow(/WOC_EPIC_/);
    // Whitespace-only is refused the same way as empty (set-but-blank CI cells).
    expect(() =>
      desktopBuilderConfig({
        base,
        distribution: 'epic',
        epicProductId: '   ',
        epicDeploymentId: 'dep',
        epicClientId: 'client',
      }),
    ).toThrow(/WOC_EPIC_/);
    // Pack mode gets no exemption: a local epic pack wants the same guard.
    expect(() => desktopBuilderConfig({ base, distribution: 'epic', mode: 'pack' })).toThrow(
      /WOC_EPIC_/,
    );
  });

  it('stamps epic ids for the epic channel only; website and steam never stamp them', () => {
    const stamped = desktopBuilderConfig({ base, distribution: 'epic', ...epicIds });
    expect(stamped.extraMetadata.wocDesktop.epicProductId).toBe('epic-product-id');
    expect(stamped.extraMetadata.wocDesktop.epicDeploymentId).toBe('epic-deployment-id');
    expect(stamped.extraMetadata.wocDesktop.epicClientId).toBe('epic-client-id');
    // Website and steam builds need no Epic env and must not carry epic stamps
    // even if the caller happens to pass the values (D3, D24).
    const website = desktopBuilderConfig({ base, distribution: 'website', ...epicIds });
    expect('epicProductId' in website.extraMetadata.wocDesktop).toBe(false);
    expect('epicDeploymentId' in website.extraMetadata.wocDesktop).toBe(false);
    expect('epicClientId' in website.extraMetadata.wocDesktop).toBe(false);
    expect(() => desktopBuilderConfig({ base, distribution: 'website' })).not.toThrow();
    const steam = desktopBuilderConfig({
      base,
      distribution: 'steam',
      steamAppId: '480',
      ...epicIds,
    });
    expect('epicProductId' in steam.extraMetadata.wocDesktop).toBe(false);
    expect(() =>
      desktopBuilderConfig({ base, distribution: 'steam', steamAppId: '480' }),
    ).not.toThrow();
  });

  it('epic pack mode strips arch matrix; still no linux target', () => {
    const epicPack = desktopBuilderConfig({
      base,
      distribution: 'epic',
      mode: 'pack',
      ...epicIds,
    });
    expect(epicPack.mac.target).toEqual(['dir']);
    expect(epicPack.win.target).toEqual(['dir']);
    expect(epicPack.linux).toBeUndefined();
    expect(epicPack.directories.output).toBe('release-epic');
    expect(epicPack.publish).toBeNull();
  });

  it('epic: does not re-include steamworks.js (channel isolation)', () => {
    const epic = desktopBuilderConfig({ base, distribution: 'epic', ...epicIds });
    expect(epic.files ?? []).not.toContain('node_modules/steamworks.js/**');
    expect(epic.asarUnpack ?? []).not.toContain('node_modules/steamworks.js/dist/**');
    // files/asarUnpack stay arrays so Phase 4 can append EOS native paths.
    expect(Array.isArray(epic.files)).toBe(true);
    expect(Array.isArray(epic.asarUnpack)).toBe(true);
  });
});

// The REAL package.json "build" block, as opposed to the miniature `base`
// fixture above: these pins guard the actual per-arch-installer + media-dedup
// derivation (issue 2013), not just the desktopBuilderConfig mechanics.
const realBuild = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).build;

describe('package.json build block: per-arch NSIS installer + media dedup (issue 2013)', () => {
  it('disables the universal NSIS installer so the website channel emits one exe per arch', () => {
    // electron-builder's NSIS default (buildUniversalInstaller: true) folds both
    // complete x64 and arm64 payloads into a single installer exe (roughly 450MB
    // each, so ~1GB combined). Setting this false makes app-builder-lib emit a
    // separate, single-arch installer per arch instead.
    expect(realBuild.nsis.buildUniversalInstaller).toBe(false);
    // The customUnInstall include (pinned separately by desktop_uninstall_cleanup.test.ts)
    // must survive alongside the new flag.
    expect(realBuild.nsis.include).toBe('build/installer.nsh');
  });

  it('excludes the unhashed media originals but keeps the hashed dist/media copies', () => {
    // scripts/build_media_manifest.mjs emit() copies models/textures/env/vfx into
    // dist/media under content-hashed names, and the production client only ever
    // resolves through those hashed copies (src/render/assets/loader.ts assetUrl(),
    // backed by MEDIA_ASSETS; the raw-path branch is dev-only and compiled out of
    // production builds). The unhashed originals are therefore dead weight in a
    // packaged app and must be excluded, while dist/media/** must never be.
    expect(realBuild.files).toContain('!dist/models/**');
    expect(realBuild.files).toContain('!dist/textures/**');
    expect(realBuild.files).toContain('!dist/env/**');
    expect(realBuild.files).toContain('!dist/vfx/**');
    expect(realBuild.files.some((f: string) => f.startsWith('!dist/media'))).toBe(false);
  });

  it('optionally sheds the website-only whitepaper, press/merch/links pages, CLAUDE.md, and guide stills', () => {
    expect(realBuild.files).toContain('!dist/*.pdf');
    expect(realBuild.files).toContain('!dist/press.html');
    expect(realBuild.files).toContain('!dist/merch.html');
    expect(realBuild.files).toContain('!dist/links.html');
    expect(realBuild.files).toContain('!dist/CLAUDE.md');
    expect(realBuild.files).toContain('!dist/guide-stills/**');
  });

  it('the media and website-only excludes survive channel derivation for website, steam, and epic', () => {
    // desktopBuilderConfig derives every channel from this SAME base block; steam
    // and epic must inherit the slimming, not lose it when they layer their own
    // files/target overrides on top (Steam re-includes steamworks.js by APPENDING
    // to config.files, which must not undo the excludes already present).
    const excludes = [
      '!dist/models/**',
      '!dist/textures/**',
      '!dist/env/**',
      '!dist/vfx/**',
      '!dist/*.pdf',
      '!dist/press.html',
      '!dist/merch.html',
      '!dist/links.html',
      '!dist/CLAUDE.md',
      '!dist/guide-stills/**',
    ];
    const website = desktopBuilderConfig({ base: realBuild, distribution: 'website' });
    const steam = desktopBuilderConfig({
      base: realBuild,
      distribution: 'steam',
      steamAppId: '480',
    });
    const epic = desktopBuilderConfig({
      base: realBuild,
      distribution: 'epic',
      epicProductId: 'epic-product-id',
      epicDeploymentId: 'epic-deployment-id',
      epicClientId: 'epic-client-id',
    });
    for (const config of [website, steam, epic]) {
      for (const exclude of excludes) expect(config.files).toContain(exclude);
    }
    // buildUniversalInstaller stays false for every channel: nothing in the
    // derivation touches config.nsis, so the setting is a pure passthrough.
    type WithNsis = { nsis: { buildUniversalInstaller?: boolean } };
    expect((website as unknown as WithNsis).nsis.buildUniversalInstaller).toBe(false);
    expect((steam as unknown as WithNsis).nsis.buildUniversalInstaller).toBe(false);
    expect((epic as unknown as WithNsis).nsis.buildUniversalInstaller).toBe(false);
  });
});

describe('isChannelFeedFile', () => {
  it('matches only the channel feed files electron-builder emits', () => {
    expect(isChannelFeedFile('latest-mac.yml', 'latest')).toBe(true);
    expect(isChannelFeedFile('latest.yml', 'latest')).toBe(true);
    expect(isChannelFeedFile('latest-linux.yml', 'latest')).toBe(true);
    expect(isChannelFeedFile('latest-linux-arm64.yml', 'latest')).toBe(true);
    expect(isChannelFeedFile('dev-mac.yml', 'dev')).toBe(true);
    expect(isChannelFeedFile('dev.yml', 'dev')).toBe(true);
  });

  it('never matches the other channel, non-feed ymls, or garbage', () => {
    expect(isChannelFeedFile('dev-mac.yml', 'latest')).toBe(false);
    expect(isChannelFeedFile('latest-mac.yml', 'dev')).toBe(false);
    expect(isChannelFeedFile('builder-debug.yml', 'latest')).toBe(false);
    expect(isChannelFeedFile('latest-mac.yml.bak', 'latest')).toBe(false);
    expect(isChannelFeedFile('latest-mac.json', 'latest')).toBe(false);
    expect(isChannelFeedFile('latest-mac.yml', '')).toBe(false);
    expect(isChannelFeedFile('latest-mac.yml', 'beta')).toBe(false);
    expect(isChannelFeedFile(undefined, 'latest')).toBe(false);
  });
});

describe('stampFeedFile', () => {
  const yml = 'version: 0.23.0\nfiles:\n  - url: woc.zip\npath: woc.zip\n';

  it('appends the baked origin as a yml key the updater can read back', () => {
    const stamped = stampFeedFile(yml, 'https://worldofclaudecraft.com');
    expect(stamped).toBe(
      'version: 0.23.0\nfiles:\n  - url: woc.zip\npath: woc.zip\n' +
        'wocApiOrigin: "https://worldofclaudecraft.com"\n',
    );
  });

  it('replaces an existing stamp instead of stacking (idempotent re-stamp)', () => {
    const once = stampFeedFile(yml, 'http://localhost:8787');
    const twice = stampFeedFile(once, 'https://worldofclaudecraft.com');
    expect(twice.match(/wocApiOrigin/g)).toHaveLength(1);
    expect(twice).toContain('wocApiOrigin: "https://worldofclaudecraft.com"');
    expect(twice).not.toContain('localhost');
  });

  it('requires the origin: a stamp-less production feed must not be emitted silently', () => {
    expect(() => stampFeedFile(yml, '')).toThrow(/apiOrigin/);
  });

  it('round-trips through the real electron-updater feed parser onto UpdateInfo', () => {
    // Guards the load-bearing vendor assumption: parseUpdateInfo is a raw yaml
    // load with no key whitelist, so the stamp reaches the update-available
    // handler. If a future electron-updater upgrade starts stripping unknown
    // keys, the runtime guard silently degrades to accept-everything and THIS
    // test is the only signal.
    const require = createRequire(import.meta.url);
    const { parseUpdateInfo } = require('electron-updater/out/providers/Provider.js');
    const info = parseUpdateInfo(
      stampFeedFile(yml, 'https://worldofclaudecraft.com'),
      'latest-mac.yml',
      'https://updates.example.com/desktop/latest-mac.yml',
    );
    expect(info.wocApiOrigin).toBe('https://worldofclaudecraft.com');
    expect(info.version).toBe('0.23.0');
    expect(info.path).toBe('woc.zip');
  });
});

describe('stampChannelFeedFiles (the electron-build.mjs stamping orchestration)', () => {
  const fsOps = { existsSync, readdirSync, readFileSync, writeFileSync };
  const seed = (dir: string, names: string[]) => {
    for (const name of names) writeFileSync(join(dir, name), 'version: 0.23.0\n');
  };

  it('stamps exactly the channel feed files in the output dir, nothing else', () => {
    const dir = mkdtempSync(join(tmpdir(), 'woc-feed-'));
    seed(dir, ['latest-mac.yml', 'latest.yml', 'dev-mac.yml', 'builder-debug.yml']);
    const stamped = stampChannelFeedFiles({
      outDir: dir,
      channel: 'latest',
      apiOrigin: 'https://worldofclaudecraft.com',
      fs: fsOps,
      joinPath: join,
    });
    expect([...stamped].sort()).toEqual(['latest-mac.yml', 'latest.yml']);
    expect(readFileSync(join(dir, 'latest-mac.yml'), 'utf8')).toContain(
      'wocApiOrigin: "https://worldofclaudecraft.com"',
    );
    expect(readFileSync(join(dir, 'latest.yml'), 'utf8')).toContain('wocApiOrigin');
    expect(readFileSync(join(dir, 'dev-mac.yml'), 'utf8')).not.toContain('wocApiOrigin');
    expect(readFileSync(join(dir, 'builder-debug.yml'), 'utf8')).not.toContain('wocApiOrigin');
  });

  it('is a no-op without a channel or an output dir (steam and pack builds)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'woc-feed-'));
    seed(dir, ['latest-mac.yml']);
    expect(
      stampChannelFeedFiles({
        outDir: dir,
        channel: undefined,
        apiOrigin: 'https://worldofclaudecraft.com',
        fs: fsOps,
        joinPath: join,
      }),
    ).toEqual([]);
    expect(readFileSync(join(dir, 'latest-mac.yml'), 'utf8')).not.toContain('wocApiOrigin');
    expect(
      stampChannelFeedFiles({
        outDir: join(dir, 'does-not-exist'),
        channel: 'latest',
        apiOrigin: 'https://worldofclaudecraft.com',
        fs: fsOps,
        joinPath: join,
      }),
    ).toEqual([]);
  });
});

describe('azureSignOptionsFromEnv', () => {
  const full = {
    WIN_SIGN_PUBLISHER_NAME: 'CN=Example Corp',
    WIN_SIGN_ENDPOINT: 'https://eus.codesigning.azure.net',
    WIN_SIGN_ACCOUNT_NAME: 'example-account',
    WIN_SIGN_PROFILE_NAME: 'example-profile',
  };

  it('returns the four options only when every env var is set and non-empty', () => {
    expect(azureSignOptionsFromEnv(full)).toEqual({
      publisherName: 'CN=Example Corp',
      endpoint: 'https://eus.codesigning.azure.net',
      codeSigningAccountName: 'example-account',
      certificateProfileName: 'example-profile',
    });
  });

  it('returns null on any missing or empty variable (unsigned local builds)', () => {
    expect(azureSignOptionsFromEnv({})).toBeNull();
    expect(azureSignOptionsFromEnv()).toBeNull();
    expect(azureSignOptionsFromEnv({ ...full, WIN_SIGN_ENDPOINT: '' })).toBeNull();
    const { WIN_SIGN_PROFILE_NAME, ...partial } = full;
    expect(azureSignOptionsFromEnv(partial)).toBeNull();
  });
});

describe('keyVaultSignConfigFromEnv', () => {
  const full = {
    AZURE_KEY_VAULT_URL: 'https://example.vault.azure.net',
    AZURE_TENANT_ID: 'tenant-id',
    AZURE_CLIENT_ID: 'client-id',
    AZURE_CLIENT_SECRET: 'client-secret',
    AZURE_KEY_VAULT_CERTIFICATE: 'woc-code-signing',
  };

  it('returns the sign-hook signtoolOptions only when every env var is set and non-empty', () => {
    expect(keyVaultSignConfigFromEnv(full)).toEqual({
      sign: './scripts/electron-win-sign.mjs',
      signingHashAlgorithms: ['sha256'],
    });
  });

  it('returns null on any missing or empty variable (unsigned local builds)', () => {
    expect(keyVaultSignConfigFromEnv({})).toBeNull();
    expect(keyVaultSignConfigFromEnv()).toBeNull();
    expect(keyVaultSignConfigFromEnv({ ...full, AZURE_CLIENT_SECRET: '' })).toBeNull();
    const { AZURE_KEY_VAULT_CERTIFICATE, ...partial } = full;
    expect(keyVaultSignConfigFromEnv(partial)).toBeNull();
  });
});
