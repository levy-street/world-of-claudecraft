#!/usr/bin/env node
// Fingerprint-only re-stamp after a lockfile leaf rename (for example
// package-lock.json -> pnpm-lock.yaml). Preserves shipping GLB sizes by
// in-place replacing the 64-hex sourceFingerprint string inside each GLB
// (document + asset extras). Does not re-encode meshopt/geometry.
//
// Usage (from repo root, after the source_fingerprint.mjs leaves point at the
// new lockfile and the lockfile exists):
//   node scripts/assets/remint_lockfile_fingerprints.mjs
//
// Then re-pin test SOURCE_FINGERPRINT / ASSET_SHA256 literals from the printed
// table, run remint_polish_provenance.mjs, and regenerate the media manifest.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eastbrookGrandArmourySourceFingerprint } from './eastbrook_grand_armoury/source_fingerprint.mjs';
import { eastbrookMailboxSourceFingerprint } from './eastbrook_mailbox/source_fingerprint.mjs';
import { eastbrookNoticeboardSourceFingerprint } from './eastbrook_noticeboard/source_fingerprint.mjs';
import { eastbrookTownSourceFingerprint } from './eastbrook_town/source_fingerprint.mjs';
import { eastbrookSurfaceAtlasFingerprint } from './eastbrook_town/surface_atlas.mjs';
import { tankSourceFingerprint } from './terrorspark_groundshaker/source_fingerprint.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const ASSETS = [
  { rel: 'public/models/props/eastbrook_bank.glb', kind: 'town' },
  { rel: 'public/models/props/eastbrook_smithy.glb', kind: 'town' },
  { rel: 'public/models/props/eastbrook_inn.glb', kind: 'town' },
  { rel: 'public/models/props/eastbrook_chapel.glb', kind: 'town' },
  { rel: 'public/models/props/eastbrook_weaving_workshop.glb', kind: 'town' },
  { rel: 'public/models/props/eastbrook_toolworks.glb', kind: 'town' },
  { rel: 'public/models/props/eastbrook_market_stall.glb', kind: 'town' },
  { rel: 'public/models/props/eastbrook_wall_wing.glb', kind: 'town' },
  { rel: 'public/models/props/eastbrook_civic_well_beacon.glb', kind: 'town' },
  { rel: 'public/models/props/eastbrook_grand_armoury.glb', kind: 'armoury' },
  { rel: 'public/models/props/eastbrook_noticeboard.glb', kind: 'notice' },
  { rel: 'public/models/props/mailbox_pillar.glb', kind: 'mailbox' },
  { rel: 'public/models/mounts/terrorspark_groundshaker.glb', kind: 'tank' },
];

function findSourceFingerprint(buf) {
  const text = buf.toString('utf8');
  const match = text.match(/"sourceFingerprint"\s*:\s*"([0-9a-f]{64})"/);
  return match?.[1] ?? null;
}

function replaceAllHex(buf, fromHex, toHex) {
  if (fromHex.length !== toHex.length) {
    throw new Error(`fingerprint length mismatch ${fromHex.length} != ${toHex.length}`);
  }
  const from = Buffer.from(fromHex, 'utf8');
  const to = Buffer.from(toHex, 'utf8');
  let hits = 0;
  let idx = 0;
  while (true) {
    const at = buf.indexOf(from, idx);
    if (at < 0) break;
    to.copy(buf, at);
    hits += 1;
    idx = at + from.length;
  }
  return hits;
}

const fps = {
  town: eastbrookTownSourceFingerprint(ROOT),
  mailbox: eastbrookMailboxSourceFingerprint(ROOT),
  notice: eastbrookNoticeboardSourceFingerprint(ROOT),
  armoury: eastbrookGrandArmourySourceFingerprint(ROOT),
  tank: tankSourceFingerprint(ROOT),
  atlas: eastbrookSurfaceAtlasFingerprint(ROOT),
};

console.log('live source fingerprints:');
for (const [k, v] of Object.entries(fps)) console.log(`  ${k.padEnd(8)} ${v}`);

const results = [];
for (const asset of ASSETS) {
  const abs = path.join(ROOT, asset.rel);
  const buf = Buffer.from(readFileSync(abs));
  const before = buf.byteLength;
  const current = findSourceFingerprint(buf);
  const target = fps[asset.kind];
  if (!target) throw new Error(`no fingerprint for kind ${asset.kind}`);
  let hits = 0;
  if (current === target) {
    hits = 0;
  } else if (current) {
    hits = replaceAllHex(buf, current, target);
    if (hits === 0) throw new Error(`${asset.rel}: current fingerprint not found as raw bytes`);
    writeFileSync(abs, buf);
  } else {
    throw new Error(`${asset.rel}: no sourceFingerprint extras found`);
  }
  const after = readFileSync(abs);
  if (after.byteLength !== before) {
    throw new Error(`${asset.rel}: size changed ${before} -> ${after.byteLength}`);
  }
  const sha = createHash('sha256').update(after).digest('hex');
  results.push({
    rel: asset.rel,
    kind: asset.kind,
    hits,
    bytes: after.byteLength,
    sha,
    fp: target,
  });
  console.log(`${asset.rel}: hits=${hits} bytes=${after.byteLength} sha256=${sha}`);
}

const outPath = path.join(ROOT, 'tmp/lockfile-fingerprint-remint.json');
writeFileSync(outPath, `${JSON.stringify({ fps, results }, null, 2)}\n`);
console.log(`wrote ${outPath}`);
console.log(
  'Next: re-pin test hashes, node scripts/assets/eastbrook_grand_armoury/remint_polish_provenance.mjs, media manifest.',
);
