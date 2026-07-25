#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { buildEastbrookSurfaceAtlas, eastbrookSurfaceAtlasFingerprint } from './surface_atlas.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const SPEC_PATH = path.join(ROOT, 'scripts/assets/specs/eastbrook_town_surface_atlas.json');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseMode(args) {
  const modes = args.filter((arg) => arg === '--check' || arg === '--write');
  const unknown = args.filter((arg) => arg !== '--check' && arg !== '--write');
  if (unknown.length > 0 || modes.length > 1) {
    throw new Error('usage: node build_surface_atlas.mjs [--check|--write]');
  }
  return modes[0] ?? '--check';
}

async function expectImageContract(bytes, contract, allowUnpinned = false) {
  const metadata = await sharp(bytes).metadata();
  if (
    metadata.format !== contract.format ||
    metadata.width !== contract.width ||
    metadata.height !== contract.height
  ) {
    throw new Error(
      `${contract.path} expected ${contract.width}x${contract.height} ${contract.format}, got ` +
        `${metadata.width ?? '?'}x${metadata.height ?? '?'} ${metadata.format ?? 'unknown'}`,
    );
  }
  const actualSha = sha256(bytes);
  if (contract.sha256 === 'PENDING' && allowUnpinned) {
    console.warn(`[eastbrook-atlas] ${contract.path} requires SHA-256 pin ${actualSha}`);
  } else if (actualSha !== contract.sha256) {
    throw new Error(`${contract.path} SHA-256 ${actualSha}; expected ${contract.sha256}`);
  }
  if (contract.byteCeiling && bytes.length > contract.byteCeiling) {
    throw new Error(`${contract.path} is ${bytes.length} bytes; ceiling ${contract.byteCeiling}`);
  }
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8'));
  const sourcePath = path.join(ROOT, spec.source.path);
  const shippingPath = path.join(ROOT, spec.shipping.path);
  const previewPath = path.join(ROOT, spec.preview.path);
  const sourceBytes = readFileSync(sourcePath);
  await expectImageContract(sourceBytes, spec.source);

  const built = await buildEastbrookSurfaceAtlas(sourceBytes);
  await expectImageContract(built.atlas, spec.shipping, mode === '--write');
  await expectImageContract(built.preview, spec.preview, mode === '--write');

  if (mode === '--write') {
    mkdirSync(path.dirname(shippingPath), { recursive: true });
    mkdirSync(path.dirname(previewPath), { recursive: true });
    writeFileSync(shippingPath, built.atlas);
    writeFileSync(previewPath, built.preview);
  } else {
    for (const [assetPath, expected] of [
      [shippingPath, built.atlas],
      [previewPath, built.preview],
    ]) {
      if (!existsSync(assetPath)) throw new Error(`${path.relative(ROOT, assetPath)} is missing`);
      const current = readFileSync(assetPath);
      if (!current.equals(expected)) {
        throw new Error(`${path.relative(ROOT, assetPath)} is stale; run with --write`);
      }
    }
  }

  const atlasFingerprint = eastbrookSurfaceAtlasFingerprint(ROOT);
  console.log(
    `[eastbrook-atlas] ${mode.slice(2)} passed: ${spec.shipping.width}x${spec.shipping.height}, ` +
      `${built.atlas.length} bytes, sha256 ${spec.shipping.sha256}`,
  );
  console.log(`[eastbrook-atlas] source fingerprint: ${atlasFingerprint}`);
  console.log(
    `[eastbrook-atlas] source cell luminance percentiles: ` +
      built.cellStats
        .map((cell) => `${cell.index}:${cell.sourceLowLuminance}-${cell.sourceHighLuminance}`)
        .join(', '),
  );
}

main().catch((error) => {
  console.error('[eastbrook-atlas] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
