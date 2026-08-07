// Scoped Eastbrook polish provenance re-mint for RUNTIME-INPUT changes: when a
// file whose sha256 feeds the composite polish provenance changes (for
// example src/render/renderer.ts, one of its runtimeRender inputs), the
// committed evidence seals and two pinned test literals go stale. This
// recomputes the provenance from the current tree with the capture contract's
// own derivation, sweeps it through the four committed after seals (top-level
// and per-record blocks), and prints the three literals to pin:
//
//   node scripts/assets/eastbrook_grand_armoury/remint_polish_provenance.mjs
//
// Then update, if they moved:
//   - tests/eastbrook_polish_capture_contract.test.ts: the pinned composite
//     fingerprint literal (PINNED_POLISH_COMPOSITE_FINGERPRINT)
//   - tests/eastbrook_polish_artifact_integrity.test.ts: the metadata
//     authority sha256 (ACCEPTED_POLISH_V2_METADATA_SHA256, the swept
//     after-desktop-ultra.json) and the second-order performance evidence
//     digest literal (recomputed LAST, from the swept files, matching the
//     test's own name\0bytes\0 stream)
//
// A mint reads WORKING-TREE bytes by design (it must be able to seal
// uncommitted edits that land in the same commit), which is exactly how the
// 2026-08-05 craft-cast pin went stale: the mint ran, then renderer.ts moved
// again before the merge committed, so the pin matched no tree that ever
// existed (see provenance_diagnostics.mjs for the proven root cause). This
// tool therefore prints the git status of every fingerprinted input at mint
// time: commit exactly those bytes with the new pin, and RE-RUN the mint if
// any input moves again before the commit.
//
// GLB pipeline inputs (scripts/assets sources, pnpm-lock.yaml) are NOT
// covered here: those need the full deterministic export re-run described in
// the 0.30.0 re-mint commit.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(HERE, '..', '..', '..');
const rootUrl = new URL(`file://${repoRoot}/`);

const contract = await import(
  new URL('scripts/assets/eastbrook_grand_armoury/capture_contract.mjs', rootUrl)
);
const town = await import(new URL('scripts/assets/eastbrook_town/source_fingerprint.mjs', rootUrl));
const mailbox = await import(
  new URL('scripts/assets/eastbrook_mailbox/source_fingerprint.mjs', rootUrl)
);
const notice = await import(
  new URL('scripts/assets/eastbrook_noticeboard/source_fingerprint.mjs', rootUrl)
);
const diagnostics = await import(
  new URL('scripts/assets/eastbrook_grand_armoury/provenance_diagnostics.mjs', rootUrl)
);

const { deriveEastbrookPolishCompositeProvenance, EASTBROOK_POLISH_PROVENANCE_INPUTS: INPUTS } =
  contract;

const sha256 = async (rel) =>
  createHash('sha256')
    .update(await readFile(new URL(rel, rootUrl)))
    .digest('hex');

const current = deriveEastbrookPolishCompositeProvenance({
  townAssetSourceFingerprint: town.eastbrookTownSourceFingerprint(),
  authoritativeLayoutSha256: await sha256(INPUTS.authoritativeLayout),
  civicShaderSha256: await sha256(INPUTS.civicShader),
  townRuntimeSha256: await sha256(INPUTS.townRuntime),
  mailboxRuntimeSha256: await sha256(INPUTS.mailboxRuntime),
  noticeboardRuntimeSha256: await sha256(INPUTS.noticeboardRuntime),
  rendererIntegrationSha256: await sha256(INPUTS.rendererIntegration),
  viewPriorityPolicySha256: await sha256(INPUTS.viewPriorityPolicy),
  mailboxSourceFingerprint: mailbox.eastbrookMailboxSourceFingerprint(),
  mailboxGlbSha256: await sha256(INPUTS.mailboxGlb),
  noticeboardSourceFingerprint: notice.eastbrookNoticeboardSourceFingerprint(),
  noticeboardGlbSha256: await sha256(INPUTS.noticeboardGlb),
});

const POLISH_ROOT = 'docs/screenshots/eastbrook-vale-rebuild/polish';
const SEALS = [
  `${POLISH_ROOT}/metadata/after-desktop-ultra.json`,
  `${POLISH_ROOT}/metadata/after-mobile-low.json`,
  `${POLISH_ROOT}/performance/after-desktop-ultra-town.json`,
  `${POLISH_ROOT}/performance/after-mobile-low-town.json`,
];

for (const rel of SEALS) {
  const url = new URL(rel, rootUrl);
  const doc = JSON.parse(await readFile(url, 'utf8'));
  let swept = 0;
  if (doc.polishProvenance) {
    doc.polishProvenance = current;
    swept++;
  }
  for (const record of doc.records ?? []) {
    if (record.polishProvenance) {
      record.polishProvenance = current;
      swept++;
    }
  }
  if (swept === 0) throw new Error(`${rel}: no polishProvenance block found`);
  await writeFile(url, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`${rel}: swept ${swept} provenance block(s)`);
}

// Second-order performance digest, recomputed LAST from the swept bytes, in
// the exact name\0bytes\0 stream the integrity suite pins.
const accepted = [
  'after-desktop-ultra-town.json',
  'after-mobile-low-town.json',
  'before-desktop-ultra-town.json',
  'before-mobile-low-town.json',
].sort();
const secondOrder = createHash('sha256');
for (const fileName of accepted) {
  secondOrder.update(fileName);
  secondOrder.update('\0');
  secondOrder.update(await readFile(new URL(`${POLISH_ROOT}/performance/${fileName}`, rootUrl)));
  secondOrder.update('\0');
}

const metadataAuthoritySha = createHash('sha256')
  .update(await readFile(new URL(diagnostics.POLISH_SEAL_PATH, rootUrl)))
  .digest('hex');

console.log('composite fingerprint (pin in eastbrook_polish_capture_contract.test.ts,');
console.log('PINNED_POLISH_COMPOSITE_FINGERPRINT):');
console.log(`  ${current.fingerprint}`);
console.log('metadata authority sha256 (pin in eastbrook_polish_artifact_integrity.test.ts,');
console.log('ACCEPTED_POLISH_V2_METADATA_SHA256, recomputed from the swept file):');
console.log(`  ${metadataAuthoritySha}`);
console.log(
  'second-order performance digest (pin in eastbrook_polish_artifact_integrity.test.ts):',
);
console.log(`  ${secondOrder.digest('hex')}`);
console.log('do NOT touch ACCEPTED_POLISH_V2_TOWN_SOURCE_FINGERPRINT in that same test:');
console.log('it is the FROZEN identity of the tree the captures were taken against, and');
console.log('it moves only if the captures themselves are retaken.');

// The stale-mint tripwire: name every fingerprinted input that differs from
// HEAD right now. Minting over dirty inputs is legitimate ONLY when exactly
// these bytes ship in the same commit as the new pins.
const inputPaths = diagnostics.collectPolishProvenanceInputPaths({
  inputs: INPUTS,
  sourceFileLists: [
    town.EASTBROOK_TOWN_SOURCE_FILES,
    mailbox.EASTBROOK_MAILBOX_SOURCE_FILES,
    notice.EASTBROOK_NOTICEBOARD_SOURCE_FILES,
  ],
});
const dirty = diagnostics.gitDirtyStatusLines({ repoRoot, paths: inputPaths });
for (const line of diagnostics.formatMintInputStatus(dirty)) {
  console.log(line);
}
