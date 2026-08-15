#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { buildFenbridgeSupportMaps, fenbridgeSupportMapFingerprint } from './support_maps.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const SPEC_PATH = path.join(import.meta.dirname, 'support_maps.json');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseMode(args) {
  if (args.length > 1 || (args[0] && args[0] !== '--check' && args[0] !== '--write')) {
    throw new Error('usage: node build_support_maps.mjs [--check|--write]');
  }
  return args[0] ?? '--check';
}

async function assertMap(bytes, contract, allowPending) {
  const metadata = await sharp(bytes).metadata();
  if (
    metadata.format !== 'webp' ||
    metadata.width !== contract.width ||
    metadata.height !== contract.height
  ) {
    throw new Error(
      `${contract.path} expected ${contract.width}x${contract.height} webp; got ` +
        `${metadata.width ?? '?'}x${metadata.height ?? '?'} ${metadata.format ?? 'unknown'}`,
    );
  }
  const actualSha = sha256(bytes);
  if (contract.sha256 === 'PENDING' && allowPending) {
    console.warn(`[fenbridge-support] pin ${contract.path} sha256 ${actualSha}`);
  } else if (actualSha !== contract.sha256) {
    throw new Error(`${contract.path} sha256 ${actualSha}; expected ${contract.sha256}`);
  }
  if (bytes.length > contract.byteCeiling) {
    throw new Error(`${contract.path} ${bytes.length} bytes; ceiling ${contract.byteCeiling}`);
  }
  return actualSha;
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8'));
  const built = await buildFenbridgeSupportMaps();
  const entries = [
    ['base', built.base],
    ['normal', built.normal],
    ['roughness', built.roughness],
  ];
  const actualHashes = {};
  let totalBytes = 0;
  for (const [key, bytes] of entries) {
    actualHashes[key] = await assertMap(bytes, spec[key], mode === '--write');
    totalBytes += bytes.length;
  }
  if (totalBytes > spec.totalByteCeiling) {
    throw new Error(`support maps ${totalBytes} bytes; ceiling ${spec.totalByteCeiling}`);
  }

  for (const [key, bytes] of entries) {
    const outputPath = path.join(ROOT, spec[key].path);
    if (mode === '--write') {
      mkdirSync(path.dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, bytes);
    } else {
      if (!existsSync(outputPath)) throw new Error(`${spec[key].path} is missing`);
      if (!readFileSync(outputPath).equals(bytes)) {
        throw new Error(`${spec[key].path} is stale; run --write`);
      }
    }
  }

  console.log(
    `[fenbridge-support] ${mode.slice(2)} passed: ` +
      entries.map(([key, bytes]) => `${key}=${bytes.length}`).join(', ') +
      `, total=${totalBytes}`,
  );
  console.log(`[fenbridge-support] sha256 ${JSON.stringify(actualHashes)}`);
  console.log(`[fenbridge-support] source fingerprint ${fenbridgeSupportMapFingerprint(ROOT)}`);
}

main().catch((error) => {
  console.error('[fenbridge-support] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
