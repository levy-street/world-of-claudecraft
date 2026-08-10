import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
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
