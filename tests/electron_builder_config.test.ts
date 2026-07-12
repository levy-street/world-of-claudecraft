import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  azureSignOptionsFromEnv,
  desktopBuilderConfig,
  isChannelFeedFile,
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
    expect(config.linux.target).toEqual([{ target: 'dir', arch: ['x64'] }]);
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
    expect(config.linux.target).toEqual(['AppImage']);
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

  it('rejects an unknown distribution loudly', () => {
    expect(() => desktopBuilderConfig({ base, distribution: 'beta' })).toThrow(
      /unknown desktop distribution/,
    );
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
