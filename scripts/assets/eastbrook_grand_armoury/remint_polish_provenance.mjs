// Scoped Eastbrook polish provenance re-mint for RUNTIME-INPUT changes: when a
// file whose sha256 feeds the composite polish provenance changes (for
// example src/render/renderer.ts, one of its runtimeRender inputs), the
// committed evidence seals and two pinned test literals go stale. This
// recomputes the provenance from the current tree with the capture contract's
// own derivation, sweeps it through the four committed after seals (top-level
// and per-record blocks), and prints the two literals to pin:
//
//   node scripts/assets/eastbrook_grand_armoury/remint_polish_provenance.mjs
//
// Then update, if they moved:
//   - tests/eastbrook_polish_capture_contract.test.ts: the pinned composite
//     fingerprint literal
//   - tests/eastbrook_polish_artifact_integrity.test.ts: the second-order
//     performance evidence digest literal (recomputed LAST, from the swept
//     files, matching the test's own name\0bytes\0 stream)
//
// GLB pipeline inputs (scripts/assets sources, package-lock.json) are NOT
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

console.log('composite fingerprint (pin in eastbrook_polish_capture_contract.test.ts):');
console.log(`  ${current.fingerprint}`);
console.log(
  'second-order performance digest (pin in eastbrook_polish_artifact_integrity.test.ts):',
);
console.log(`  ${secondOrder.digest('hex')}`);
