import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '..');
const evidenceRelativeDir = 'docs/screenshots/item-art-consistency-2026-08-09';
const evidenceDir = join(repoRoot, evidenceRelativeDir);
const manifestPath = join(evidenceDir, 'manifest.json');
const manifestBytes = 7791;
const manifestSha256 = 'c534277a17448428d371fb74aabcd52ef7424100d6c286e30a17be5c9799938e';
const states = ['before', 'after'] as const;
const devices = ['desktop', 'mobile-landscape'] as const;
const surfaces = [
  'inventory',
  'bank',
  'merchant',
  'equipment',
  'tooltip',
  'mail',
  'action-slot',
] as const;

interface EvidenceRecord {
  path: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
}

interface EvidenceManifest {
  schemaVersion: number;
  batchId: string;
  captureScript: {
    path: string;
    sha256: string;
    bytes: number;
  };
  contract: {
    states: string[];
    devices: string[];
    surfaces: string[];
    fileCount: number;
  };
  files: EvidenceRecord[];
}

function expectedPaths(): string[] {
  return states.flatMap((state) =>
    devices.flatMap((device) =>
      surfaces.map((surface) => `${evidenceRelativeDir}/${state}-${device}-${surface}.png`),
    ),
  );
}

function readManifest(): EvidenceManifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as EvidenceManifest;
}

describe('item-art before/after screenshot evidence', () => {
  it('pins the exact two-state, two-device, seven-surface matrix', () => {
    const manifestSource = readFileSync(manifestPath);
    const manifest = readManifest();
    const expected = expectedPaths();

    expect(manifestSource.length, 'manifest byte count').toBe(manifestBytes);
    expect(createHash('sha256').update(manifestSource).digest('hex'), 'manifest SHA-256').toBe(
      manifestSha256,
    );
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.batchId).toBe('item-art-consistency-2026-08-09');
    expect(manifest.captureScript).toEqual({
      path: 'scripts/item_art_consistency_shots.mjs',
      sha256: '5dc69b21f370ec7cbd10670c475e010394a573cba7d2167a76c3340479ea1476',
      bytes: 26744,
    });
    const captureScriptSource = readFileSync(join(repoRoot, manifest.captureScript.path));
    expect(captureScriptSource.length, 'capture script byte count').toBe(
      manifest.captureScript.bytes,
    );
    expect(
      createHash('sha256').update(captureScriptSource).digest('hex'),
      'capture script SHA-256',
    ).toBe(manifest.captureScript.sha256);
    expect(manifest.contract).toEqual({
      states: [...states],
      devices: [...devices],
      surfaces: [...surfaces],
      fileCount: 28,
    });
    expect(manifest.files.map((record) => record.path)).toEqual(expected);
    expect(new Set(manifest.files.map((record) => record.path)).size).toBe(28);

    const pngsOnDisk = readdirSync(evidenceDir)
      .filter((name) => name.endsWith('.png'))
      .map((name) => `${evidenceRelativeDir}/${name}`)
      .sort();
    expect(pngsOnDisk).toEqual([...expected].sort());
  });

  it('matches every pinned SHA-256, byte count, and PNG dimension', () => {
    const manifest = readManifest();
    const evidenceByConsumer = new Map<string, { width: number; height: number; sha256: string }>();

    for (const record of manifest.files) {
      const imagePath = join(repoRoot, record.path);
      const bytes = readFileSync(imagePath);
      const name = record.path.slice(evidenceRelativeDir.length + 1);

      expect(statSync(imagePath).size, `${name} stat bytes`).toBe(record.bytes);
      expect(bytes.length, `${name} buffer bytes`).toBe(record.bytes);
      expect(createHash('sha256').update(bytes).digest('hex'), `${name} SHA-256`).toBe(
        record.sha256,
      );
      expect(bytes.subarray(0, 8).toString('hex'), `${name} PNG signature`).toBe(
        '89504e470d0a1a0a',
      );
      expect(bytes.readUInt32BE(8), `${name} IHDR length`).toBe(13);
      expect(bytes.subarray(12, 16).toString('ascii'), `${name} IHDR type`).toBe('IHDR');
      expect(bytes.readUInt32BE(16), `${name} width`).toBe(record.width);
      expect(bytes.readUInt32BE(20), `${name} height`).toBe(record.height);
      expect(record.width, `${name} positive width`).toBeGreaterThan(0);
      expect(record.height, `${name} positive height`).toBeGreaterThan(0);

      const parsed = /^(before|after)-(desktop|mobile-landscape)-(.+)\.png$/.exec(name);
      expect(parsed, `${name} contract filename`).not.toBeNull();
      if (!parsed) continue;
      const [, state, device, surface] = parsed;
      const consumer = `${device}/${surface}`;
      if (state === 'before') {
        evidenceByConsumer.set(consumer, {
          width: record.width,
          height: record.height,
          sha256: record.sha256,
        });
      } else {
        const before = evidenceByConsumer.get(consumer);
        expect(
          { width: record.width, height: record.height },
          `${consumer} before/after dimension parity`,
        ).toEqual(before && { width: before.width, height: before.height });
        expect(record.sha256, `${consumer} before/after bytes must differ`).not.toBe(
          before?.sha256,
        );
      }
    }

    expect(evidenceByConsumer.size).toBe(devices.length * surfaces.length);
  });
});
