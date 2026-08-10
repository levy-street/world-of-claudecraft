// Re-record the polish-v2 composite provenance across the committed capture metadata.
//
// The provenance is a sha256 over the town's authoring and runtime inputs, and one of those
// inputs is the WHOLE of src/render/renderer.ts. Any change to the renderer therefore
// invalidates the recorded fingerprint even when no town input moved, which is what happens
// every time a class overhaul adds its presentation hooks. The pin's job is to force a human
// to look; this script is what re-records the answer once they have.
//
// Usage: node scripts/assets/eastbrook_grand_armoury/rerecord_polish_provenance.mjs [--check]
//
// Before running it, confirm which inputs actually moved:
//   git diff --stat <base> HEAD -- src/sim/eastbrook_layout.ts src/render/eastbrook_civic_beacon.ts \
//     src/render/eastbrook_town.ts src/render/mailbox.ts src/render/noticeboard.ts \
//     src/render/renderer.ts src/render/prewarm_policy.ts public/models/props/mailbox_pillar.glb \
//     public/models/props/eastbrook_noticeboard.glb
// If anything other than renderer.ts moved, or the renderer delta touches town rendering,
// the captures themselves are stale and must be re-shot instead.

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eastbrookMailboxSourceFingerprint } from '../eastbrook_mailbox/source_fingerprint.mjs';
import { eastbrookNoticeboardSourceFingerprint } from '../eastbrook_noticeboard/source_fingerprint.mjs';
import { eastbrookTownSourceFingerprint } from '../eastbrook_town/source_fingerprint.mjs';
import {
  deriveEastbrookPolishCompositeProvenance,
  EASTBROOK_POLISH_PROVENANCE_INPUTS,
} from './capture_contract.mjs';

const REPO_ROOT = new URL('../../../', import.meta.url);
const METADATA_DIRS = [
  'docs/screenshots/eastbrook-vale-rebuild/polish/metadata',
  'docs/screenshots/eastbrook-vale-rebuild/polish/performance',
  'docs/screenshots/eastbrook-vale-rebuild/metadata',
  'docs/screenshots/eastbrook-vale-rebuild/performance',
];

const fileSha256 = async (relativePath) =>
  createHash('sha256')
    .update(await readFile(new URL(relativePath, REPO_ROOT)))
    .digest('hex');

async function derive() {
  const inputs = EASTBROOK_POLISH_PROVENANCE_INPUTS;
  return deriveEastbrookPolishCompositeProvenance({
    townAssetSourceFingerprint: eastbrookTownSourceFingerprint(),
    authoritativeLayoutSha256: await fileSha256(inputs.authoritativeLayout),
    civicShaderSha256: await fileSha256(inputs.civicShader),
    townRuntimeSha256: await fileSha256(inputs.townRuntime),
    mailboxRuntimeSha256: await fileSha256(inputs.mailboxRuntime),
    noticeboardRuntimeSha256: await fileSha256(inputs.noticeboardRuntime),
    rendererIntegrationSha256: await fileSha256(inputs.rendererIntegration),
    viewPriorityPolicySha256: await fileSha256(inputs.viewPriorityPolicy),
    mailboxSourceFingerprint: eastbrookMailboxSourceFingerprint(),
    mailboxGlbSha256: await fileSha256(inputs.mailboxGlb),
    noticeboardSourceFingerprint: eastbrookNoticeboardSourceFingerprint(),
    noticeboardGlbSha256: await fileSha256(inputs.noticeboardGlb),
  });
}

// Collect every composite-sha256 polishProvenance block in the tree, at any depth.
function collectBlocks(node, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectBlocks(item, out);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'polishProvenance' && value?.mode === 'composite-sha256') out.push(value);
    else collectBlocks(value, out);
  }
  return out;
}

// Every sha the block records, flattened to a list of hex strings.
function recordedHashes(block, out = []) {
  if (!block || typeof block !== 'object') return out;
  for (const [key, value] of Object.entries(block)) {
    if (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) out.push([key, value]);
    else if (value && typeof value === 'object') recordedHashes(value, out);
  }
  return out;
}

// Substitute stale hashes TEXTUALLY so the committed formatting survives byte for byte: a
// structural rewrite reflows every block and buries a two-field change in a 2800-line diff.
function substitutions(block, provenance) {
  const stale = new Map();
  const before = recordedHashes(block);
  const after = recordedHashes(provenance);
  for (const [index, [key, value]] of before.entries()) {
    const replacement = after[index];
    if (!replacement || replacement[0] !== key) {
      throw new Error(`provenance shape drifted at ${key}; re-shoot rather than re-record`);
    }
    if (replacement[1] !== value) stale.set(value, replacement[1]);
  }
  return stale;
}

const checkOnly = process.argv.includes('--check');
const provenance = await derive();
console.log(`derived polish-v2 fingerprint: ${provenance.fingerprint}`);

let touchedFiles = 0;
let changedBlocks = 0;
for (const dir of METADATA_DIRS) {
  const absolute = fileURLToPath(new URL(dir, REPO_ROOT));
  let entries;
  try {
    entries = await readdir(absolute);
  } catch {
    continue;
  }
  for (const entry of entries.filter((name) => name.endsWith('.json'))) {
    const path = join(absolute, entry);
    const original = await readFile(path, 'utf8');
    const stale = new Map();
    for (const block of collectBlocks(JSON.parse(original))) {
      for (const [from, to] of substitutions(block, provenance)) stale.set(from, to);
    }
    if (stale.size === 0) continue;
    let next = original;
    let replacements = 0;
    for (const [from, to] of stale) {
      const occurrences = next.split(from).length - 1;
      replacements += occurrences;
      next = next.split(from).join(to);
    }
    changedBlocks += replacements;
    touchedFiles += 1;
    console.log(`  ${dir}/${entry}: ${stale.size} stale hash(es), ${replacements} occurrence(s)`);
    if (!checkOnly) await writeFile(path, next, 'utf8');
  }
}

console.log(
  checkOnly
    ? `${changedBlocks} stale occurrence(s) across ${touchedFiles} file(s); re-run without --check to record`
    : `re-recorded ${changedBlocks} occurrence(s) across ${touchedFiles} file(s)`,
);

// Two literals live in the tests rather than in the metadata, so print both: editing the
// performance evidence moves the byte-for-byte digest that pins those same files.
const performanceRoot = new URL(
  'docs/screenshots/eastbrook-vale-rebuild/polish/performance/',
  REPO_ROOT,
);
const acceptedEvidence = [
  'after-desktop-ultra-town.json',
  'after-mobile-low-town.json',
  'before-desktop-ultra-town.json',
  'before-mobile-low-town.json',
].sort();
const evidenceDigest = createHash('sha256');
for (const fileName of acceptedEvidence) {
  evidenceDigest.update(fileName);
  evidenceDigest.update('\0');
  evidenceDigest.update(await readFile(new URL(fileName, performanceRoot)));
  evidenceDigest.update('\0');
}
console.log('\nUpdate these two pinned literals:');
console.log(
  `  tests/eastbrook_polish_capture_contract.test.ts  fingerprint: '${provenance.fingerprint}'`,
);
console.log(
  `  tests/eastbrook_polish_artifact_integrity.test.ts  accepted evidence: '${evidenceDigest.digest('hex')}'`,
);
