import { describe, expect, it } from 'vitest';
import {
  awsEndpointArgs,
  bundleFileName,
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
