#!/usr/bin/env node
// Publish a self-hosted OTA web bundle for the native mobile shells
// (docs/ota-updates.md). The flow the Capgo capacitor-updater consumes:
//
//   1. Build the native web assets (npm run build:native, the same dist/ the
//      store shells embed), zip them, and sha256 the zip.
//   2. Upload the zip to s3://$OTA_S3_BUCKET/<prefix>/bundles/wocc-web-<v>.zip
//      as an immutable versioned artifact (existing versions are never
//      overwritten without --force).
//   3. Upload <prefix>/latest.json, the manifest the game server's
//      POST /api/ota/updates endpoint reads (server/ota_updates.ts): the
//      newest version, its public zip URL, the checksum, and optionally the
//      oldest native shell version the bundle still supports.
//
// Rollback is re-pointing latest.json at an already-uploaded older version:
//   node scripts/ota/publish_bundle.mjs --rollback 0.32.0
//
// Requirements: the AWS CLI on PATH with credentials for the bucket, and the
// system zip binary. Env (documented in .env.example): OTA_S3_BUCKET,
// OTA_PUBLIC_BASE_URL, optional OTA_S3_PREFIX (default 'ota'),
// OTA_MIN_NATIVE_VERSION, and OTA_S3_ENDPOINT_URL.
//
// The store is S3-COMPATIBLE, not necessarily S3: this project publishes to the
// Cloudflare R2 bucket that already serves desktop updates, so every aws call
// takes --endpoint-url from OTA_S3_ENDPOINT_URL when set (the same way the
// woc-deploy desktop upload targets R2). Unset means real AWS S3, where the CLI
// derives the endpoint from the region.
//
// Pure planning/validation lives in the exported functions and is unit-tested
// (tests/ota_publish.test.ts); the file I/O and aws/zip calls at the bottom
// only run when invoked as a CLI.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

/** The versioned, immutable artifact name for one published web bundle. */
export function bundleFileName(version) {
  return `wocc-web-${version}.zip`;
}

/**
 * The endpoint override every aws invocation needs to reach an S3-compatible
 * store that is not AWS S3 (Cloudflare R2 here). Empty for real S3, where the
 * CLI resolves the endpoint itself. https only: this pushes the document that
 * decides which JS every phone runs, so it never travels over a MITM-able
 * transport, the same rule the server applies to the manifest URL.
 */
export function awsEndpointArgs(endpointUrl) {
  const url = String(endpointUrl ?? '').trim();
  if (!url) return [];
  if (!url.startsWith('https://')) {
    throw new Error('ota publish: OTA_S3_ENDPOINT_URL must be an https:// origin');
  }
  return ['--endpoint-url', url];
}

/** Parse the CLI flags; throws with a usage-style message on anything malformed. */
export function parseOtaArgs(argv) {
  const args = {
    version: null,
    minNative: null,
    rollback: null,
    skipBuild: false,
    dryRun: false,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--skip-build') args.skipBuild = true;
    else if (flag === '--dry-run') args.dryRun = true;
    else if (flag === '--force') args.force = true;
    else if (flag === '--version' || flag === '--min-native' || flag === '--rollback') {
      const value = argv[++i];
      if (!value || !SEMVER_RE.test(value)) {
        throw new Error(`ota publish: ${flag} needs a MAJOR.MINOR.PATCH value`);
      }
      if (flag === '--version') args.version = value;
      else if (flag === '--min-native') args.minNative = value;
      else args.rollback = value;
    } else {
      throw new Error(`ota publish: unknown flag ${flag}`);
    }
  }
  if (args.rollback && args.version) {
    throw new Error('ota publish: --rollback and --version are mutually exclusive');
  }
  return args;
}

/**
 * Derive the S3 keys, public URLs, and manifest body for one publish. Pure;
 * throws on anything the server-side manifest validation would reject
 * (non-semver versions, a non-https public base), so a bad publish fails here
 * instead of shipping a manifest the endpoint ignores.
 */
export function planOtaPublish({
  version,
  bucket,
  prefix,
  publicBaseUrl,
  checksum,
  minNative,
  builtAt,
}) {
  if (!SEMVER_RE.test(String(version ?? ''))) {
    throw new Error(`ota publish: version must be MAJOR.MINOR.PATCH, got ${version}`);
  }
  if (!bucket) throw new Error('ota publish: OTA_S3_BUCKET is required');
  const base = String(publicBaseUrl ?? '').replace(/\/+$/, '');
  if (!base.startsWith('https://')) {
    throw new Error('ota publish: OTA_PUBLIC_BASE_URL must be an https:// origin');
  }
  if (minNative != null && !SEMVER_RE.test(minNative)) {
    throw new Error(`ota publish: min native version must be MAJOR.MINOR.PATCH, got ${minNative}`);
  }
  const cleanPrefix = String(prefix ?? 'ota').replace(/^\/+|\/+$/g, '');
  const keyPrefix = cleanPrefix ? `${cleanPrefix}/` : '';
  const bundleKey = `${keyPrefix}bundles/${bundleFileName(version)}`;
  const manifestKey = `${keyPrefix}latest.json`;
  const manifest = { version, url: `${base}/${bundleKey}` };
  if (checksum) manifest.checksum = checksum;
  if (minNative) manifest.minNativeVersion = minNative;
  if (builtAt) manifest.builtAt = builtAt;
  return {
    bucket,
    bundleKey,
    manifestKey,
    bundleUrl: manifest.url,
    manifestUrl: `${base}/${manifestKey}`,
    manifest,
  };
}

// ---------------------------------------------------------------------------
// CLI below: file I/O plus aws/zip subprocess calls, no logic worth testing.
// ---------------------------------------------------------------------------

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = resolve(root, 'dist-ota');

function run(cmd, cmdArgs, opts = {}) {
  const res = spawnSync(cmd, cmdArgs, { stdio: 'inherit', ...opts });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`ota publish: ${cmd} ${cmdArgs.join(' ')} exited ${res.status}`);
  }
}

function s3ObjectExists(bucket, key, endpointArgs) {
  const res = spawnSync(
    'aws',
    ['s3api', 'head-object', '--bucket', bucket, '--key', key, ...endpointArgs],
    { stdio: 'ignore' },
  );
  if (res.error) throw res.error;
  return res.status === 0;
}

function sha256Of(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function uploadFile(localPath, bucket, key, contentType, cacheControl, endpointArgs, dryRun) {
  const dest = `s3://${bucket}/${key}`;
  const cmdArgs = [
    's3',
    'cp',
    localPath,
    dest,
    '--content-type',
    contentType,
    '--cache-control',
    cacheControl,
    ...endpointArgs,
  ];
  if (dryRun) {
    // Quote the values that contain spaces (the cache-control list) so the
    // printed line is the command an operator can actually paste to reproduce.
    const shown = cmdArgs.map((a) => (a.includes(' ') ? `'${a}'` : a)).join(' ');
    console.log(`[dry-run] aws ${shown}`);
    return;
  }
  run('aws', cmdArgs);
}

function main() {
  const args = parseOtaArgs(process.argv.slice(2));
  const bucket = process.env.OTA_S3_BUCKET;
  const publicBaseUrl = process.env.OTA_PUBLIC_BASE_URL;
  const prefix = process.env.OTA_S3_PREFIX ?? 'ota';
  const minNative = args.minNative ?? process.env.OTA_MIN_NATIVE_VERSION ?? null;
  const endpointArgs = awsEndpointArgs(process.env.OTA_S3_ENDPOINT_URL);
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const version = args.rollback ?? args.version ?? pkg.version;

  mkdirSync(outDir, { recursive: true });
  const zipPath = resolve(outDir, bundleFileName(version));

  let checksum;
  if (args.rollback) {
    // Rollback: the zip must already be published; download it to re-derive
    // the checksum the re-pointed manifest advertises.
    const probe = planOtaPublish({ version, bucket, prefix, publicBaseUrl, minNative });
    if (!s3ObjectExists(bucket, probe.bundleKey, endpointArgs)) {
      throw new Error(`ota publish: rollback target ${probe.bundleKey} does not exist`);
    }
    rmSync(zipPath, { force: true });
    run('aws', ['s3', 'cp', `s3://${bucket}/${probe.bundleKey}`, zipPath, ...endpointArgs]);
    checksum = sha256Of(zipPath);
  } else {
    if (!args.skipBuild) {
      // The OTA bundle must be byte-compatible with what the store shells
      // embed: the NATIVE build (VITE_NATIVE_APP=1), never the plain web one.
      run('npm', ['run', 'build:native'], { cwd: root });
    }
    if (!existsSync(resolve(root, 'dist', 'index.html'))) {
      throw new Error('ota publish: dist/index.html missing; run npm run build:native first');
    }
    rmSync(zipPath, { force: true });
    run('zip', ['-qr', zipPath, '.'], { cwd: resolve(root, 'dist') });
    checksum = sha256Of(zipPath);
  }

  const plan = planOtaPublish({
    version,
    bucket,
    prefix,
    publicBaseUrl,
    checksum,
    minNative,
    builtAt: new Date().toISOString(),
  });

  if (!args.rollback) {
    if (s3ObjectExists(bucket, plan.bundleKey, endpointArgs) && !args.force) {
      throw new Error(
        `ota publish: ${plan.bundleKey} already exists; bump the version or pass --force`,
      );
    }
    uploadFile(
      zipPath,
      bucket,
      plan.bundleKey,
      'application/zip',
      'public, max-age=31536000, immutable',
      endpointArgs,
      args.dryRun,
    );
  }

  const manifestPath = resolve(outDir, 'latest.json');
  writeFileSync(manifestPath, `${JSON.stringify(plan.manifest, null, 2)}\n`);
  uploadFile(
    manifestPath,
    bucket,
    plan.manifestKey,
    'application/json',
    'no-cache',
    endpointArgs,
    args.dryRun,
  );

  console.log(`\nota publish: ${args.rollback ? 'rolled back to' : 'published'} ${version}`);
  console.log(`  bundle:   ${plan.bundleUrl}`);
  console.log(`  manifest: ${plan.manifestUrl}`);
  console.log(`  checksum: ${checksum}`);
  console.log('\nVerify the live manifest:');
  console.log(`  curl -s ${plan.manifestUrl}`);
  console.log('\nThe game server must have OTA_MANIFEST_URL set to the manifest URL above.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
