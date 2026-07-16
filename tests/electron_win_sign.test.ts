import { describe, expect, it } from 'vitest';
import {
  azureSignToolArgs,
  KEY_VAULT_SIGN_ENV_VARS,
  resolveTimestampUrl,
} from '../scripts/electron-win-sign.mjs';

const env = {
  AZURE_KEY_VAULT_URL: 'https://example.vault.azure.net',
  AZURE_TENANT_ID: 'tenant-id',
  AZURE_CLIENT_ID: 'client-id',
  AZURE_CLIENT_SECRET: 'client-secret',
  AZURE_KEY_VAULT_CERTIFICATE: 'woc-code-signing',
};

describe('resolveTimestampUrl', () => {
  it('honors an http(s) URL', () => {
    expect(resolveTimestampUrl('https://timestamp.acs.microsoft.com')).toBe(
      'https://timestamp.acs.microsoft.com',
    );
    expect(resolveTimestampUrl('http://timestamp.digicert.com')).toBe(
      'http://timestamp.digicert.com',
    );
  });

  it('falls back to DigiCert on junk, empty, or unset values', () => {
    // "advanced" is the literal junk value observed in the operator's CI
    // secret; the fallback keeps the build timestamped instead of failing.
    expect(resolveTimestampUrl('advanced')).toBe('http://timestamp.digicert.com');
    expect(resolveTimestampUrl('')).toBe('http://timestamp.digicert.com');
    expect(resolveTimestampUrl(undefined)).toBe('http://timestamp.digicert.com');
  });
});

describe('azureSignToolArgs', () => {
  it('pins the exact AzureSignTool invocation', () => {
    expect(
      azureSignToolArgs(
        { ...env, CODE_SIGN_TIMESTAMP_URL: 'http://timestamp.digicert.com' },
        'release/woc-setup.exe',
      ),
    ).toEqual([
      'sign',
      '-kvu',
      'https://example.vault.azure.net',
      '-kvt',
      'tenant-id',
      '-kvi',
      'client-id',
      '-kvs',
      'client-secret',
      '-kvc',
      'woc-code-signing',
      '-tr',
      'http://timestamp.digicert.com',
      '-td',
      'sha256',
      '-fd',
      'sha256',
      'release/woc-setup.exe',
    ]);
  });

  it('defaults junk or missing digest overrides to sha256 and honors real ones', () => {
    const junk = azureSignToolArgs(
      { ...env, CODE_SIGN_FILE_DIGEST: 'advanced', CODE_SIGN_TIMESTAMP_DIGEST: '' },
      'a.exe',
    );
    expect(junk[junk.indexOf('-fd') + 1]).toBe('sha256');
    expect(junk[junk.indexOf('-td') + 1]).toBe('sha256');
    const real = azureSignToolArgs(
      { ...env, CODE_SIGN_FILE_DIGEST: 'sha384', CODE_SIGN_TIMESTAMP_DIGEST: 'sha512' },
      'a.exe',
    );
    expect(real[real.indexOf('-fd') + 1]).toBe('sha384');
    expect(real[real.indexOf('-td') + 1]).toBe('sha512');
  });
});

describe('KEY_VAULT_SIGN_ENV_VARS', () => {
  it('pins the credential set the CI job and the config resolver require', () => {
    expect(KEY_VAULT_SIGN_ENV_VARS).toEqual([
      'AZURE_KEY_VAULT_URL',
      'AZURE_TENANT_ID',
      'AZURE_CLIENT_ID',
      'AZURE_CLIENT_SECRET',
      'AZURE_KEY_VAULT_CERTIFICATE',
    ]);
  });
});
