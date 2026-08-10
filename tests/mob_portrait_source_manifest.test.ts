import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type DriftManifest,
  describeManifestDrift,
  formatManifestDrift,
} from '../scripts/lib/mob_portrait_manifest_diff.mjs';
import {
  assertManifestWriteAuthorized,
  changedPortraitIds,
} from '../scripts/lib/mob_portrait_manifest_guard.mjs';
import { MOBS } from '../src/sim/data';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const script = join(repoRoot, 'scripts/build_mob_portrait_source_manifest.mjs');
const manifestPath = join(
  repoRoot,
  'docs/achievements/placeholder-art-completion-2026-08-09/mob-portrait-source-manifest.json',
);

interface AssetDigest {
  url: string;
  path: string;
  bytes: number;
  sha256: string;
}

interface PortraitSourceRecord {
  id: string;
  family: string;
  visualKey: string;
  renderSpec: {
    model: AssetDigest;
    attach: Array<{ asset: AssetDigest; bone: string }>;
  };
  tint: {
    source: 'none' | 'entity' | 'fixed';
    resolved: string | null;
    strength: number | null;
  };
  sourceFingerprint: string;
  output: { path: string; bytes: number; sha256: string };
}

interface PortraitSourceManifest {
  schemaVersion: number;
  rendererFingerprint: string;
  renderer: {
    trackedFiles: Array<{ path: string; bytes: number; sha256: string }>;
    browserBundle: { entry: string; bytes: number; sha256: string };
  };
  portraitCount: number;
  portraits: PortraitSourceRecord[];
}

const digestPattern = /^[a-f0-9]{64}$/;

describe('mob portrait source manifest', () => {
  it('is byte-fresh against the live renderer, visual manifest, models, tints, and outputs', () => {
    const result = spawnSync(process.execPath, [script, '--check'], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it('covers every live mob and records each render dependency with a content hash', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PortraitSourceManifest;
    const liveIds = Object.keys(MOBS).sort();
    expect(liveIds).toHaveLength(230);
    expect(manifest.portraitCount).toBe(liveIds.length);
    expect(manifest.portraits.map((portrait) => portrait.id)).toEqual(liveIds);
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.rendererFingerprint).toMatch(digestPattern);

    expect(manifest.renderer.trackedFiles.map((file) => file.path)).toEqual([
      'scripts/render_finder_portraits.mjs',
      'scripts/lib/mob_portrait_jobs.mjs',
      'scripts/lib/mob_portrait_background.mjs',
    ]);
    for (const digest of [...manifest.renderer.trackedFiles, manifest.renderer.browserBundle]) {
      expect(digest.bytes).toBeGreaterThan(0);
      expect(digest.sha256).toMatch(digestPattern);
    }

    for (const portrait of manifest.portraits) {
      expect(portrait.family).toBe(MOBS[portrait.id].family);
      expect(portrait.renderSpec.model.path).toMatch(/^public\/models\/.+\.glb$/);
      expect(portrait.renderSpec.model.bytes).toBeGreaterThan(0);
      expect(portrait.renderSpec.model.sha256).toMatch(digestPattern);
      for (const attachment of portrait.renderSpec.attach) {
        expect(attachment.asset.path).toMatch(/^public\/models\/.+\.glb$/);
        expect(attachment.asset.bytes).toBeGreaterThan(0);
        expect(attachment.asset.sha256).toMatch(digestPattern);
      }
      expect(portrait.sourceFingerprint).toMatch(digestPattern);
      expect(portrait.output.path).toBe(`public/ui/mobs/${portrait.id}.webp`);
      expect(portrait.output.bytes).toBeGreaterThan(0);
      expect(portrait.output.sha256).toMatch(digestPattern);
    }
  });

  it('keeps the corrected wrong-model and live-tint cases explicit in the all-mob ledger', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PortraitSourceManifest;
    const portraits = Object.fromEntries(
      manifest.portraits.map((portrait) => [portrait.id, portrait]),
    );

    expect(portraits.bogtoad.visualKey).toBe('mob_murloc');
    expect(portraits.bogtoad.renderSpec.model.url).toBe('models/creatures/frog.glb');

    expect(portraits.cindraleth_maw_matriarch.visualKey).toBe('mob_dragonkin_matriarch');
    expect(portraits.cindraleth_maw_matriarch.tint).toEqual({
      source: 'entity',
      authored: 'entity',
      resolved: '#f0b040',
      strength: 0.12,
    });

    expect(portraits.grubjaw.renderSpec.model.url).toBe('models/creatures/grubjaw.glb');
    expect(portraits.grubjaw.tint.resolved).toBe('#145a32');
    expect(portraits.grubjaw.tint.strength).toBe(0.04);

    expect(portraits.the_wreck_warden.visualKey).toBe('mob_bruiser');
    expect(portraits.the_wreck_warden.renderSpec.model.url).toBe(
      'models/chars/players/barbarian.glb',
    );
    expect(portraits.the_wreck_warden.renderSpec.attach[0].asset.url).toBe(
      'models/weapons/axe_2handed.glb',
    );
    expect(portraits.the_wreck_warden.tint.resolved).toBe('#7a8a86');
  });

  it('uses one job builder and emits acceptance receipts only after a successful render', () => {
    const renderer = readFileSync(join(repoRoot, 'scripts/render_finder_portraits.mjs'), 'utf8');
    const builder = readFileSync(script, 'utf8');
    const sharedImport = "from './lib/mob_portrait_jobs.mjs'";
    expect(renderer).toContain(sharedImport);
    expect(builder).toContain(sharedImport);
    expect(renderer).not.toContain('function addJob(');
    expect(builder).not.toContain('function addJob(');
    expect(renderer.indexOf('if (failed > 0 || pageErr > 0) process.exit(1);')).toBeLessThan(
      renderer.indexOf('if (receiptPath) {'),
    );
  });

  it('rejects stale, output-only, and partial renderer-change manifest writes', () => {
    const rows = Array.from({ length: 230 }, (_, index) => ({
      id: `mob_${String(index).padStart(3, '0')}`,
      sourceFingerprint: `source-${index}`,
      output: { bytes: 100 + index, sha256: `output-${index}` },
    }));
    const previous = {
      schemaVersion: 2,
      rendererFingerprint: 'renderer-a',
      portraits: structuredClone(rows),
    };

    const staleSource = structuredClone(previous);
    staleSource.portraits[0].sourceFingerprint = 'changed-source';
    expect(changedPortraitIds(previous, staleSource)).toEqual(['mob_000']);
    expect(() =>
      assertManifestWriteAuthorized({ previous, next: staleSource, receipt: null }),
    ).toThrow(/without a renderer receipt/);

    const changedOutput = structuredClone(previous);
    changedOutput.portraits[1].output = { bytes: 999, sha256: 'changed-output' };
    expect(() =>
      assertManifestWriteAuthorized({ previous, next: changedOutput, receipt: null }),
    ).toThrow(/without a renderer receipt/);

    const changedRenderer = structuredClone(previous);
    changedRenderer.rendererFingerprint = 'renderer-b';
    const partialReceipt = {
      schemaVersion: 1,
      generatedBy: 'scripts/render_finder_portraits.mjs',
      rendererFingerprint: 'renderer-b',
      portraits: [changedRenderer.portraits[0]],
    };
    expect(changedPortraitIds(previous, changedRenderer)).toHaveLength(230);
    expect(() =>
      assertManifestWriteAuthorized({
        previous,
        next: changedRenderer,
        receipt: partialReceipt,
      }),
    ).toThrow(/missing changed row mob_001/);
  });

  it('accepts a renderer receipt only when every changed source and output matches', () => {
    const previous = {
      schemaVersion: 2,
      rendererFingerprint: 'renderer',
      portraits: [
        {
          id: 'mob',
          sourceFingerprint: 'old-source',
          output: { bytes: 100, sha256: 'old-output' },
        },
      ],
    };
    const next = {
      ...previous,
      portraits: [
        {
          id: 'mob',
          sourceFingerprint: 'new-source',
          output: { bytes: 101, sha256: 'new-output' },
        },
      ],
    };
    const receipt = {
      schemaVersion: 1,
      generatedBy: 'scripts/render_finder_portraits.mjs',
      rendererFingerprint: 'renderer',
      portraits: structuredClone(next.portraits),
    };
    expect(() => assertManifestWriteAuthorized({ previous, next, receipt })).not.toThrow();
    receipt.portraits[0].sourceFingerprint = 'stale-source';
    expect(() => assertManifestWriteAuthorized({ previous, next, receipt })).toThrow(
      /stale source fingerprint/,
    );
  });

  // The acceptance is a bundle digest, and esbuild labels bundled modules with paths
  // relative to absWorkingDir (process.cwd() unless pinned). Before both build sites pinned
  // it to the repo root, running --check from a subdirectory recomputed a DIFFERENT digest
  // and reported a false staleness, and a --write from one minted a digest no other run
  // could reproduce.
  it('derives the renderer fingerprint independently of the launch directory', () => {
    const probe = `
      import { buildPortraitRendererContract, portraitRendererFingerprint } from ${JSON.stringify(
        join(repoRoot, 'scripts/lib/mob_portrait_jobs.mjs'),
      )};
      const contract = await buildPortraitRendererContract(${JSON.stringify(repoRoot)});
      process.stdout.write(portraitRendererFingerprint(contract));
    `;
    const run = (cwd: string) =>
      spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
        cwd,
        encoding: 'utf8',
        timeout: 120_000,
      });

    const fromRepoRoot = run(repoRoot);
    const fromSubdirectory = run(join(repoRoot, 'src'));
    expect(fromRepoRoot.status, fromRepoRoot.stderr).toBe(0);
    expect(fromSubdirectory.status, fromSubdirectory.stderr).toBe(0);
    expect(fromRepoRoot.stdout).toMatch(digestPattern);
    expect(fromSubdirectory.stdout).toBe(fromRepoRoot.stdout);
    // Tie it to the shipped acceptance, so this cannot pass by both runs being equally wrong.
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PortraitSourceManifest;
    expect(fromRepoRoot.stdout).toBe(manifest.rendererFingerprint);
  }, 150_000);

  it('routes the real --write CLI through receipt authorization before touching its target', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'wocc-portrait-manifest-'));
    try {
      const canonicalBytes = readFileSync(manifestPath);
      const current = JSON.parse(canonicalBytes.toString('utf8')) as PortraitSourceManifest;
      const prior = structuredClone(current);
      prior.portraits[0].sourceFingerprint = 'stale-source-fingerprint';
      const tempManifest = join(tempDir, 'manifest.json');
      const staleBytes = `${JSON.stringify(prior, null, 2)}\n`;
      writeFileSync(tempManifest, staleBytes);

      const refused = spawnSync(process.execPath, [script, '--write', '--manifest', tempManifest], {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 30_000,
      });
      expect(refused.status, `${refused.stdout}\n${refused.stderr}`).toBe(1);
      expect(refused.stderr).toContain('without a renderer receipt');
      expect(readFileSync(tempManifest, 'utf8')).toBe(staleBytes);

      const changed = current.portraits[0];
      const receiptPath = join(tempDir, 'receipt.json');
      writeFileSync(
        receiptPath,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            generatedBy: 'scripts/render_finder_portraits.mjs',
            rendererFingerprint: current.rendererFingerprint,
            portraits: [
              {
                id: changed.id,
                sourceFingerprint: changed.sourceFingerprint,
                output: changed.output,
              },
            ],
          },
          null,
          2,
        )}\n`,
      );
      const accepted = spawnSync(
        process.execPath,
        [script, '--write', '--manifest', tempManifest, '--receipt', receiptPath],
        { cwd: repoRoot, encoding: 'utf8', timeout: 30_000 },
      );
      expect(accepted.status, `${accepted.stdout}\n${accepted.stderr}`).toBe(0);
      expect(readFileSync(tempManifest)).toEqual(canonicalBytes);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// A stale acceptance used to report only two hashes, which reads the same whether the
// portraits regressed or an unrelated source edit moved the bundle. These pin the
// classification that tells those apart, per dimension.
describe('portrait manifest drift explanation', () => {
  const baseline = (): DriftManifest => ({
    schemaVersion: 2,
    bootstrapReview: { path: 'review.md', bytes: 10, sha256: 'review-a' },
    rendererFingerprint: 'fingerprint-a',
    renderer: {
      trackedFiles: [
        { path: 'scripts/render_finder_portraits.mjs', bytes: 5, sha256: 'tracked-a' },
      ],
      browserBundle: {
        entry: 'scripts/wiki/stills_render_entry.js',
        bytes: 100,
        sha256: 'bundle-a',
      },
    },
    portraitCount: 2,
    portraits: [
      {
        id: 'alpha',
        sourceFingerprint: 'source-alpha',
        output: { bytes: 10, sha256: 'out-alpha' },
      },
      { id: 'beta', sourceFingerprint: 'source-beta', output: { bytes: 20, sha256: 'out-beta' } },
    ],
  });

  const withMovedBundle = (): DriftManifest => {
    const next = baseline();
    next.rendererFingerprint = 'fingerprint-b';
    next.renderer.browserBundle = {
      entry: 'scripts/wiki/stills_render_entry.js',
      bytes: 101,
      sha256: 'bundle-b',
    };
    return next;
  };

  const BOOKKEEPING_LINE = 'No portrait row and no shipped image byte changed';

  it('calls a bundle-only drift bookkeeping, with no row and no tracked-file change', () => {
    const drift = describeManifestDrift(baseline(), withMovedBundle());
    expect(drift.bookkeepingOnly).toBe(true);
    expect(drift.bundleChanged).toBe(true);
    expect(drift.fingerprintChanged).toBe(true);
    expect(drift.changedRows).toEqual([]);
    expect(drift.changedTrackedFiles).toEqual([]);
    expect(formatManifestDrift(drift)).toContain(BOOKKEEPING_LINE);
  });

  it('withholds the bookkeeping verdict when a shipped portrait output moved', () => {
    const next = withMovedBundle();
    next.portraits[1].output = { bytes: 21, sha256: 'out-beta-2' };
    const drift = describeManifestDrift(baseline(), next);
    expect(drift.bookkeepingOnly).toBe(false);
    expect(drift.changedRows).toEqual([{ id: 'beta', sourceChanged: false, outputChanged: true }]);
    const text = formatManifestDrift(drift);
    expect(text).toContain('beta');
    expect(text).not.toContain(BOOKKEEPING_LINE);
  });

  it('withholds the bookkeeping verdict when a portrait source fingerprint moved', () => {
    const next = withMovedBundle();
    next.portraits[0].sourceFingerprint = 'source-alpha-2';
    const drift = describeManifestDrift(baseline(), next);
    expect(drift.bookkeepingOnly).toBe(false);
    expect(drift.changedRows).toEqual([{ id: 'alpha', sourceChanged: true, outputChanged: false }]);
    expect(formatManifestDrift(drift)).not.toContain(BOOKKEEPING_LINE);
  });

  it('withholds the bookkeeping verdict when a tracked renderer file moved', () => {
    const next = withMovedBundle();
    next.renderer.trackedFiles = [
      { path: 'scripts/render_finder_portraits.mjs', bytes: 6, sha256: 'tracked-b' },
    ];
    const drift = describeManifestDrift(baseline(), next);
    expect(drift.bookkeepingOnly).toBe(false);
    expect(drift.changedTrackedFiles).toEqual(['scripts/render_finder_portraits.mjs']);
    const text = formatManifestDrift(drift);
    expect(text).toContain('scripts/render_finder_portraits.mjs');
    expect(text).not.toContain(BOOKKEEPING_LINE);
  });

  it('withholds the bookkeeping verdict on a schema or portrait-count move', () => {
    const migrated = withMovedBundle();
    migrated.schemaVersion = 3;
    expect(describeManifestDrift(baseline(), migrated).bookkeepingOnly).toBe(false);
    expect(describeManifestDrift(baseline(), migrated).schemaChanged).toBe(true);

    const grown = withMovedBundle();
    grown.portraitCount = 3;
    grown.portraits.push({
      id: 'gamma',
      sourceFingerprint: 'source-gamma',
      output: { bytes: 30, sha256: 'out-gamma' },
    });
    const drift = describeManifestDrift(baseline(), grown);
    expect(drift.bookkeepingOnly).toBe(false);
    expect(drift.portraitCountChanged).toBe(true);
    expect(drift.changedRows).toEqual([{ id: 'gamma', sourceChanged: true, outputChanged: true }]);
  });
});
