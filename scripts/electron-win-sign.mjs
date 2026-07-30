// Custom electron-builder Windows sign hook for the Azure KEY VAULT
// certificate setup (AzureSignTool), as opposed to the Azure Trusted Signing
// account/profile shape the WIN_SIGN_* / win.azureSignOptions route covers.
// Wired as win.signtoolOptions.sign by scripts/electron-builder-config.mjs
// (keyVaultSignConfigFromEnv); electron-builder invokes the default export
// once per signable file (the NSIS installer, the app exe that rides inside
// the per-arch zips, uninstaller stubs, ...) and per signingHashAlgorithms
// entry, with { path, hash, isNest, ... }. The config pins ['sha256'] so each
// file gets exactly one signing pass.
//
// Credentials come from env at sign time (never from the derived config file):
// AZURE_KEY_VAULT_URL + AZURE_TENANT_ID + AZURE_CLIENT_ID + AZURE_CLIENT_SECRET
// + AZURE_KEY_VAULT_CERTIFICATE (the certificate name inside the vault).
// Requires the AzureSignTool dotnet global tool on PATH.

import { spawnSync } from 'node:child_process';

export const KEY_VAULT_SIGN_ENV_VARS = [
  'AZURE_KEY_VAULT_URL',
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_ID',
  'AZURE_CLIENT_SECRET',
  'AZURE_KEY_VAULT_CERTIFICATE',
];

const DEFAULT_TIMESTAMP_URL = 'http://timestamp.digicert.com';
const DEFAULT_DIGEST = 'sha256';

// Only a value that is actually a URL is trusted; anything else (unset, empty,
// or a junk string in the CI secret) falls back to DigiCert's public RFC 3161
// server. Timestamp servers are commonly plain http; that is fine, the
// timestamp token itself is signed.
export function resolveTimestampUrl(value) {
  return typeof value === 'string' && /^https?:\/\//.test(value) ? value : DEFAULT_TIMESTAMP_URL;
}

// Pure argv construction so the test suite can pin the exact AzureSignTool
// invocation without spawning anything. Digest overrides accept the sha
// family only; anything else falls back to sha256 rather than handing
// AzureSignTool a junk algorithm name.
export function azureSignToolArgs(env, filePath) {
  const digest = (value) => (/^sha(256|384|512)$/.test(value ?? '') ? value : DEFAULT_DIGEST);
  return [
    'sign',
    '-kvu',
    env.AZURE_KEY_VAULT_URL,
    '-kvt',
    env.AZURE_TENANT_ID,
    '-kvi',
    env.AZURE_CLIENT_ID,
    '-kvs',
    env.AZURE_CLIENT_SECRET,
    '-kvc',
    env.AZURE_KEY_VAULT_CERTIFICATE,
    '-tr',
    resolveTimestampUrl(env.CODE_SIGN_TIMESTAMP_URL),
    '-td',
    digest(env.CODE_SIGN_TIMESTAMP_DIGEST),
    '-fd',
    digest(env.CODE_SIGN_FILE_DIGEST),
    filePath,
  ];
}

export default async function sign(configuration) {
  // The config pins signingHashAlgorithms to ['sha256']; guard anyway so a
  // future dual-signing config cannot silently append a sha1 pass AzureSignTool
  // would treat as a fresh (overwriting) signature.
  if (configuration.hash && configuration.hash !== 'sha256') {
    throw new Error(
      `the Key Vault sign hook only supports sha256, got a ${configuration.hash} pass; ` +
        'keep win.signtoolOptions.signingHashAlgorithms pinned to ["sha256"]',
    );
  }
  const missing = KEY_VAULT_SIGN_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Key Vault signing env vars are missing: ${missing.join(', ')}`);
  }
  // No shell: the client secret must never pass through cmd.exe quoting. The
  // dotnet global tool shim resolves as azuresigntool.exe from PATH.
  const result = spawnSync('azuresigntool', azureSignToolArgs(process.env, configuration.path), {
    stdio: 'inherit',
  });
  if (result.error) {
    throw new Error(
      `failed to run azuresigntool (is the AzureSignTool dotnet global tool installed ` +
        `and on PATH?): ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(`azuresigntool exited with status ${result.status} for ${configuration.path}`);
  }
}
