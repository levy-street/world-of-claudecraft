import { describe, expect, it } from 'vitest';
import {
  azureSignOptionsFromEnv,
  desktopBuilderConfig,
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

describe('desktopBuilderConfig', () => {
  it('stamps the website channel into extraMetadata and keeps the publish feed', () => {
    const config = desktopBuilderConfig({ base, distribution: 'website' });
    expect(config.extraMetadata.wocDesktop).toEqual({ distribution: 'website' });
    expect(config.publish).toEqual(base.publish);
    expect(config.appId).toBe(base.appId);
    expect(config.mac.hardenedRuntime).toBe(true);
  });

  it('never mutates the base config object', () => {
    const before = JSON.stringify(base);
    desktopBuilderConfig({ base, distribution: 'steam' });
    desktopBuilderConfig({ base, distribution: 'website', mode: 'pack' });
    expect(JSON.stringify(base)).toBe(before);
  });

  it('steam: nulls publish, stamps steam, targets dir layouts in release-steam', () => {
    const config = desktopBuilderConfig({ base, distribution: 'steam' });
    expect(config.extraMetadata.wocDesktop).toEqual({ distribution: 'steam' });
    expect(config.publish).toBeNull();
    expect(config.directories.output).toBe('release-steam');
    expect(config.mac.target).toEqual([{ target: 'dir', arch: ['universal'] }]);
    expect(config.win.target).toEqual([{ target: 'dir', arch: ['x64'] }]);
    expect(config.linux.target).toEqual([{ target: 'dir', arch: ['x64'] }]);
    // Non-target mac keys survive the override.
    expect(config.mac.hardenedRuntime).toBe(true);
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
    const steamPack = desktopBuilderConfig({ base, distribution: 'steam', mode: 'pack' });
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
