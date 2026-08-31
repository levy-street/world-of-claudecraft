// Publish the reviewed Store-charter and Materials Vault screenshot runs into
// their checked-in canonical evidence directories. The capture rigs stay the
// source of truth; this small publisher validates their expected outputs,
// copies only the named keepers, and records hashes plus the dirty/clean source
// state so a pre-commit capture never masquerades as a clean revision render.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BROWSER_PATH } from './browser_path.mjs';

const ROOT = process.cwd();
// biome-ignore lint/suspicious/noUndeclaredEnvVars: One-off screenshot publisher, not a Turbo task.
const vaultSource = process.env.VAULT_SHOTS_DIR ?? 'pr-shots-bank-vault';
const storeDir = 'docs/screenshots/bank-storage-charters';
const vaultDir = 'docs/screenshots/bank-vault-tab';
const fineDir = 'docs/screenshots/vault-fine-mark';

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const repoPath = (file) => path.relative(ROOT, file).replaceAll(path.sep, '/');
const absolute = (file) => path.resolve(ROOT, file);

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function requireFile(file) {
  const resolved = absolute(file);
  if (!fs.statSync(resolved, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`required evidence file is missing: ${repoPath(resolved)}`);
  }
  return resolved;
}

function writeJson(file, value) {
  fs.writeFileSync(absolute(file), `${JSON.stringify(value, null, 2)}\n`);
}

const provenance = {
  capturedAt: new Date().toISOString(),
  sourceRevision: git(['rev-parse', 'HEAD']),
  sourceTreeState: git(['status', '--short', '--untracked-files=no']) ? 'dirty' : 'clean',
  browser: execFileSync(BROWSER_PATH, ['--version'], { encoding: 'utf8' }).trim(),
  graphicsPreset: 'low',
  note: 'sourceRevision is the pre-commit HEAD. sourceTreeState records whether the accepted frames came from working-tree changes; the evidence commit and per-frame hashes bind the final files.',
};

const storeFrames = [
  ['after-store-confirm-desktop.png', 'desktop', 'classic', 'confirmation'],
  ['after-store-result-desktop.png', 'desktop', 'classic', 'stale result'],
  ['after-store-confirm-mobile-landscape.png', '844x390 touch', 'classic', 'confirmation'],
  ['after-store-result-mobile-landscape.png', '844x390 touch', 'classic', 'stale result'],
  ['after-store-confirm-forced-colors.png', 'desktop', 'forced colors', 'confirmation'],
  ['after-store-result-forced-colors.png', 'desktop', 'forced colors', 'stale result'],
].map(([file, viewport, theme, surface]) => {
  const resolved = requireFile(path.join(storeDir, file));
  return { file, sha256: sha256(resolved), viewport, theme, surface };
});

writeJson(path.join(storeDir, 'manifest.json'), {
  schemaVersion: 1,
  ...provenance,
  harness: 'scripts/charter_store_shot.mjs',
  command:
    'BROWSER_PATH=<chromium> GAME_URL=http://127.0.0.1:5173 SHOTS_DIR=docs/screenshots/bank-storage-charters CHARTER_SHOT_SET=prompts node scripts/charter_store_shot.mjs',
  assertions:
    'The harness verifies prompt focus/modal semantics and stale nonmodal status semantics before each capture.',
  frames: storeFrames,
});

const vaultRunManifestFile = requireFile(path.join(vaultSource, 'manifest.json'));
const vaultRun = JSON.parse(fs.readFileSync(vaultRunManifestFile, 'utf8'));
if (vaultRun.mode !== 'change-aware') throw new Error(`unexpected vault mode: ${vaultRun.mode}`);
const criticalVaultErrors = (vaultRun.errors ?? []).filter(
  (entry) => typeof entry !== 'string' || !entry.startsWith('CONSOLE('),
);
if (criticalVaultErrors.length) {
  throw new Error(`vault capture reported critical errors:\n${criticalVaultErrors.join('\n')}`);
}

const vaultMappings = [
  ['01-bank-vault-locked.png', vaultDir, 'after-vault-locked-desktop.png', 'locked desktop'],
  [
    '02-bank-vault-locked-mobile.png',
    vaultDir,
    'after-vault-locked-mobile.png',
    'locked 844x390 touch',
  ],
  ['03-bank-vault-desktop.png', vaultDir, 'after-vault-desktop.png', 'signed desktop'],
  ['04-bank-vault-mobile.png', vaultDir, 'after-vault-mobile.png', 'signed 844x390 touch'],
  ['03-bank-vault-desktop.png', fineDir, 'before-desktop.png', 'base and signed desktop'],
  ['04-bank-vault-mobile.png', fineDir, 'before-mobile.png', 'base and signed 844x390 touch'],
  ['07-bank-vault-fine.png', fineDir, 'after-desktop.png', 'fine and signed desktop'],
  ['08-bank-vault-fine-mobile.png', fineDir, 'after-mobile.png', 'fine 844x390 touch'],
];

const published = vaultMappings.map(([source, directory, file, content]) => {
  if (!(vaultRun.captured ?? []).includes(source)) {
    throw new Error(`vault manifest does not list required frame: ${source}`);
  }
  const from = requireFile(path.join(vaultSource, source));
  const to = absolute(path.join(directory, file));
  fs.copyFileSync(from, to);
  return { directory, file, source, sha256: sha256(to), theme: 'classic', content };
});

writeJson(path.join(vaultDir, 'capture-manifest.json'), {
  ...vaultRun,
  provenance,
  command:
    'BROWSER_PATH=<chromium> GAME_URL=http://127.0.0.1:5173 DIFF_FILE=/tmp/bank-vault.diff SHOTS_DIR=pr-shots-bank-vault NAV_TIMEOUT_MS=180000 ENTRY_SELECTOR_TIMEOUT_MS=180000 node scripts/pr_screenshots.mjs',
  note: 'Only CONSOLE notes were present: expected offline 502 responses and nonessential world-model preload misses. Target, shot, geometry, and page errors were absent.',
});

for (const [directory, purpose] of [
  [vaultDir, 'locked and signed-row Vault evidence'],
  [fineDir, 'base-versus-fine Vault comparison evidence'],
]) {
  writeJson(path.join(directory, 'manifest.json'), {
    schemaVersion: 1,
    ...provenance,
    harness: 'scripts/pr_screenshots.mjs target bank-vault',
    captureManifest:
      directory === vaultDir ? 'capture-manifest.json' : '../bank-vault-tab/capture-manifest.json',
    purpose,
    frames: published
      .filter((entry) => entry.directory === directory)
      .map(({ directory: _directory, ...entry }) => entry),
  });
}

console.log(`published ${storeFrames.length} Store frames and ${published.length} Vault frames`);
