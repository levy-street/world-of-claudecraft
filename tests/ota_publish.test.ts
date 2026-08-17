import { describe, expect, it } from 'vitest';
import {
  awsEndpointArgs,
  buildManifestEntries,
  bundleFileName,
  manifestFileName,
  parseOtaArgs,
  planOtaPublish,
} from '../scripts/ota/publish_bundle.mjs';

const BASE = {
  version: '0.33.0',
  bucket: 'wocc-ota',
  prefix: 'ota',
  publicBaseUrl: 'https://updates.example.com',
  checksum: 'ab12cd34',
};

describe('planOtaPublish', () => {
  it('derives immutable versioned keys and the manifest the endpoint validates', () => {
    const plan = planOtaPublish({ ...BASE, minNative: '0.32.0', builtAt: '2026-07-30T00:00:00Z' });
    expect(plan.bundleKey).toBe('ota/bundles/wocc-web-0.33.0.zip');
    expect(plan.manifestKey).toBe('ota/latest.json');
    expect(plan.bundleUrl).toBe('https://updates.example.com/ota/bundles/wocc-web-0.33.0.zip');
    expect(plan.manifestUrl).toBe('https://updates.example.com/ota/latest.json');
    expect(plan.manifest).toEqual({
      version: '0.33.0',
      url: 'https://updates.example.com/ota/bundles/wocc-web-0.33.0.zip',
      checksum: 'ab12cd34',
      minNativeVersion: '0.32.0',
      builtAt: '2026-07-30T00:00:00Z',
    });
  });

  it('normalizes base-url and prefix slashes, and allows an empty prefix', () => {
    const plan = planOtaPublish({
      ...BASE,
      publicBaseUrl: 'https://u.example.com/',
      prefix: '/p/',
    });
    expect(plan.bundleUrl).toBe('https://u.example.com/p/bundles/wocc-web-0.33.0.zip');
    const bare = planOtaPublish({ ...BASE, prefix: '' });
    expect(bare.bundleKey).toBe('bundles/wocc-web-0.33.0.zip');
    expect(bare.manifestKey).toBe('latest.json');
  });

  it('omits the optional manifest fields when absent', () => {
    const plan = planOtaPublish({ ...BASE, checksum: undefined });
    expect(plan.manifest).toEqual({
      version: '0.33.0',
      url: 'https://updates.example.com/ota/bundles/wocc-web-0.33.0.zip',
    });
  });

  it('refuses what the server-side manifest validation would reject', () => {
    expect(() => planOtaPublish({ ...BASE, version: 'latest' })).toThrow(/MAJOR\.MINOR\.PATCH/);
    expect(() => planOtaPublish({ ...BASE, bucket: '' })).toThrow(/OTA_S3_BUCKET/);
    expect(() => planOtaPublish({ ...BASE, publicBaseUrl: 'http://updates.example.com' })).toThrow(
      /https/,
    );
    expect(() => planOtaPublish({ ...BASE, minNative: 'builtin' })).toThrow(/MAJOR\.MINOR\.PATCH/);
  });

  it('derives the per-version delta artifacts and advertises them only when asked', () => {
    const plan = planOtaPublish({ ...BASE, withFileManifest: true });
    expect(plan.fileManifestKey).toBe('ota/manifests/wocc-web-0.33.0.manifest.json');
    expect(plan.filesKeyPrefix).toBe('ota/files/');
    expect(plan.fileManifestUrl).toBe(
      'https://updates.example.com/ota/manifests/wocc-web-0.33.0.manifest.json',
    );
    expect(plan.manifest.fileManifestUrl).toBe(plan.fileManifestUrl);
    // Without the flag (a rollback target published before the delta channel
    // existed), latest.json must NOT advertise a document that is not there.
    expect(planOtaPublish({ ...BASE }).manifest.fileManifestUrl).toBeUndefined();
  });
});

describe('buildManifestEntries', () => {
  const HASH_A = 'a'.repeat(64);
  const HASH_B = 'b'.repeat(64);
  const FILES = [
    { path: 'index.html', sha256: HASH_B },
    { path: 'assets/index-abc.js', sha256: HASH_A.toUpperCase() },
  ];

  it('builds sorted, content-addressed entries in the plugin wire shape', () => {
    expect(
      buildManifestEntries({ files: FILES, publicBaseUrl: 'https://u.example.com/', prefix: '' }),
    ).toEqual([
      {
        file_name: 'assets/index-abc.js',
        file_hash: HASH_A,
        download_url: `https://u.example.com/files/${HASH_A}`,
      },
      {
        file_name: 'index.html',
        file_hash: HASH_B,
        download_url: `https://u.example.com/files/${HASH_B}`,
      },
    ]);
    expect(
      buildManifestEntries({
        files: [FILES[0]],
        publicBaseUrl: BASE.publicBaseUrl,
        prefix: 'ota',
      })[0].download_url,
    ).toBe(`https://updates.example.com/ota/files/${HASH_B}`);
  });

  it('refuses what the endpoint entry validation would reject', () => {
    const one = (path: string, sha256 = HASH_A) =>
      buildManifestEntries({ files: [{ path, sha256 }], publicBaseUrl: BASE.publicBaseUrl });
    expect(() => one('../escape.js')).toThrow(/unsafe manifest path/);
    expect(() => one('/abs.js')).toThrow(/unsafe manifest path/);
    expect(() => one('a\\b.js')).toThrow(/unsafe manifest path/);
    expect(() => one('')).toThrow(/unsafe manifest path/);
    expect(() => one('ok.js', 'beef')).toThrow(/sha256/);
    expect(() => buildManifestEntries({ files: [], publicBaseUrl: BASE.publicBaseUrl })).toThrow(
      /at least one file/,
    );
    expect(() =>
      buildManifestEntries({ files: FILES, publicBaseUrl: 'http://u.example.com' }),
    ).toThrow(/https/);
  });
});

describe('parseOtaArgs', () => {
  it('parses the full flag set', () => {
    expect(
      parseOtaArgs(['--version', '0.33.0', '--min-native', '0.32.0', '--skip-build', '--dry-run']),
    ).toEqual({
      version: '0.33.0',
      minNative: '0.32.0',
      rollback: null,
      skipBuild: true,
      dryRun: true,
      force: false,
    });
    expect(parseOtaArgs(['--rollback', '0.31.0']).rollback).toBe('0.31.0');
    expect(parseOtaArgs(['--force']).force).toBe(true);
  });

  it('rejects malformed and contradictory invocations', () => {
    expect(() => parseOtaArgs(['--version'])).toThrow(/MAJOR\.MINOR\.PATCH/);
    expect(() => parseOtaArgs(['--version', 'v1'])).toThrow(/MAJOR\.MINOR\.PATCH/);
    expect(() => parseOtaArgs(['--nope'])).toThrow(/unknown flag/);
    expect(() => parseOtaArgs(['--rollback', '0.1.0', '--version', '0.2.0'])).toThrow(
      /mutually exclusive/,
    );
  });
});

describe('bundleFileName', () => {
  it('names artifacts by version', () => {
    expect(bundleFileName('0.33.0')).toBe('wocc-web-0.33.0.zip');
    expect(manifestFileName('0.33.0')).toBe('wocc-web-0.33.0.manifest.json');
  });
});

describe('awsEndpointArgs', () => {
  // Publishing targets the Cloudflare R2 bucket that already serves desktop
  // updates, so every aws call needs --endpoint-url. Without the override the
  // CLI would silently talk to AWS S3 and the publish would land nowhere useful.
  it('emits the override that points the AWS CLI at an S3-compatible store', () => {
    expect(awsEndpointArgs('https://acct.r2.cloudflarestorage.com')).toEqual([
      '--endpoint-url',
      'https://acct.r2.cloudflarestorage.com',
    ]);
  });

  it('emits nothing for real AWS S3, where the CLI resolves its own endpoint', () => {
    expect(awsEndpointArgs(undefined)).toEqual([]);
    expect(awsEndpointArgs(null)).toEqual([]);
    expect(awsEndpointArgs('')).toEqual([]);
    expect(awsEndpointArgs('   ')).toEqual([]);
  });

  it('refuses a non-https endpoint, matching the manifest transport rule', () => {
    expect(() => awsEndpointArgs('http://acct.r2.cloudflarestorage.com')).toThrow(
      /OTA_S3_ENDPOINT_URL must be an https/,
    );
    expect(() => awsEndpointArgs('acct.r2.cloudflarestorage.com')).toThrow(/https/);
  });
});
