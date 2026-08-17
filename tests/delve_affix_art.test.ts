import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { DELVE_IMPLEMENTED_AFFIXES } from '../src/sim/delves/runs';
import { DELVE_AFFIX_IMAGE_IDS, delveAffixImageUrl } from '../src/ui/hud/delve/delve_affix_art';
import { auraImageUrl } from '../src/ui/icons';

const ACCEPTED_DELVE_AFFIX_ART_SHA256 =
  'b89b9937aff53fc43e60750c9b658f465c09bc61f65b2f458d854cd4e707a6cf';

describe('delve affix art', () => {
  const artDir = path.join(process.cwd(), 'public/ui/delve-affixes');
  const expectedIds = [
    'bad_air',
    'belligerent_dead',
    'candleblind',
    'high_water',
    'lively_choir',
    'restless_graves',
  ];

  it('owns one painted identity for every implemented affix', () => {
    expect([...DELVE_IMPLEMENTED_AFFIXES].sort()).toEqual(expectedIds);
    expect([...DELVE_AFFIX_IMAGE_IDS].sort()).toEqual(expectedIds);
  });

  it('returns stable raw-public URLs and leaves future inert affixes on fallback art', () => {
    expect(delveAffixImageUrl('high_water')).toBe('/ui/delve-affixes/high_water.webp');
    expect(auraImageUrl('bad_air')).toBe('/ui/delve-affixes/bad_air.webp');
    expect(delveAffixImageUrl('grave_tax')).toBeNull();
  });

  it('keeps registry, mapping, and opaque shipping files in exact parity', async () => {
    const mapping = JSON.parse(readFileSync(path.join(artDir, 'mapping.json'), 'utf8')) as {
      schemaVersion: number;
      family: string;
      iconSize: number;
      runtimeDir: string;
      acceptedArtManifest: string;
      acceptedCohortManifest: string;
      acceptedCohortSha256: string;
      assets: Array<{
        id: string;
        output: string;
        sourceFile: string;
        source: string;
        owner: string;
        license: string;
        sourceSha256: string;
        acceptedSha256: string;
        acceptedBytes: number;
      }>;
    };
    const ids = [...DELVE_AFFIX_IMAGE_IDS].sort();
    const files = readdirSync(artDir)
      .filter((name) => name.endsWith('.webp'))
      .sort();

    expect(files).toEqual(ids.map((id) => `${id}.webp`));
    expect(mapping.assets.map(({ id }) => id).sort()).toEqual(ids);
    expect(mapping).toMatchObject({
      schemaVersion: 1,
      family: 'delve-affixes',
      iconSize: 128,
      runtimeDir: 'public/ui/delve-affixes',
      acceptedArtManifest:
        'docs/achievements/release-v039-icon-art-second-pass-2026-08-16/accepted-art.json',
      acceptedCohortManifest:
        'docs/achievements/release-v039-icon-art-second-pass-2026-08-16/accepted-delve-affix-art.json',
      acceptedCohortSha256: ACCEPTED_DELVE_AFFIX_ART_SHA256,
    });

    const hashes = new Set<string>();
    for (const asset of mapping.assets) {
      expect(asset.output).toBe(`${asset.id}.webp`);
      expect(asset.source).toBe('OpenAI built-in image generation');
      expect(asset.owner).toBe('World of ClaudeCraft');
      expect(asset.license).toContain('project asset');
      expect(asset.sourceSha256).toMatch(/^[0-9a-f]{64}$/);

      const bytes = readFileSync(path.join(artDir, asset.output));
      const hash = createHash('sha256').update(bytes).digest('hex');
      const metadata = await sharp(bytes).metadata();
      expect(bytes.length).toBe(asset.acceptedBytes);
      expect(bytes.length).toBeLessThanOrEqual(15 * 1024);
      expect(hash).toBe(asset.acceptedSha256);
      expect(metadata).toMatchObject({
        format: 'webp',
        width: 128,
        height: 128,
        space: 'srgb',
        hasAlpha: false,
      });
      hashes.add(hash);
    }
    expect(hashes.size).toBe(ids.length);

    const acceptedRecordBytes = readFileSync(
      path.join(process.cwd(), mapping.acceptedCohortManifest),
    );
    expect(createHash('sha256').update(acceptedRecordBytes).digest('hex')).toBe(
      ACCEPTED_DELVE_AFFIX_ART_SHA256,
    );
    expect(mapping.acceptedCohortSha256).toBe(ACCEPTED_DELVE_AFFIX_ART_SHA256);

    const acceptedRecord = JSON.parse(acceptedRecordBytes.toString('utf8')) as {
      schemaVersion: number;
      batch: string;
      generator: {
        tool: string;
        invocation: string;
        callsPerAsset: number;
        variantsPerCall: number;
        referenceImagesPassedToGenerator: boolean;
      };
      result: {
        requested: number;
        generated: number;
        accepted: number;
        rejected: number;
        retried: number;
        builtInCalls: number;
      };
      visualReferences: Array<{ path: string; role: string; sha256: string }>;
      processing: {
        command: string;
        shippingRequirements: { width: number; height: number; maximumBytes: number };
      };
      review: { runtimeContactSheets: Array<{ size: number; sha256: string }> };
      assets: Array<{
        id: string;
        family: string;
        mechanicSources: string[];
        prompt: string;
        references: Array<{ path: string; role: string }>;
        generation: {
          builtInCallCount: number;
          variantsReturned: number;
          generatorOutputFilename: string;
          source: { path: string; sha256: string };
        };
        accepted: {
          output: string;
          sha256: string;
          bytes: number;
          decision: string;
          review: { sizesPx: number[] };
        };
        rejects: unknown[];
        retries: number;
      }>;
    };
    expect(acceptedRecord).toMatchObject({
      schemaVersion: 1,
      batch: 'release-v0.39.0-second-pass-delve-affixes',
      generator: {
        tool: 'OpenAI built-in image generation',
        invocation: 'image_gen__imagegen',
        callsPerAsset: 1,
        variantsPerCall: 1,
        referenceImagesPassedToGenerator: false,
      },
      result: {
        requested: ids.length,
        generated: ids.length,
        accepted: ids.length,
        rejected: 0,
        retried: 0,
        builtInCalls: ids.length,
      },
      processing: {
        command: 'cwebp -q 80 -m 6 -sharp_yuv -resize 128 128 INPUT.png -o OUTPUT.webp',
        shippingRequirements: { width: 128, height: 128, maximumBytes: 15 * 1024 },
      },
    });
    expect(acceptedRecord.review.runtimeContactSheets.map(({ size }) => size)).toEqual([
      48, 32, 16,
    ]);
    expect(acceptedRecord.assets.map(({ id }) => id).sort()).toEqual(ids);
    for (const reference of acceptedRecord.visualReferences) {
      expect(reference.path).toMatch(/^public\/ui\//);
      expect(reference.role.length).toBeGreaterThan(20);
      expect(reference.sha256).toMatch(/^[0-9a-f]{64}$/);
    }

    for (const asset of mapping.assets) {
      const accepted = acceptedRecord.assets.find(({ id }) => id === asset.id);
      expect(accepted, asset.id).toBeDefined();
      expect(accepted?.family, asset.id).toMatch(/^(collapsed_reliquary_affixes|drowned_litany)$/);
      expect(accepted?.mechanicSources, asset.id).toContain('src/sim/content/delves/affixes.ts');
      expect(accepted?.prompt.split('\n')[0], asset.id).toBe('Use case: stylized-concept');
      expect(accepted?.prompt.split('\n').length, asset.id).toBeGreaterThanOrEqual(8);
      expect(accepted?.references.length, asset.id).toBe(4);
      for (const reference of accepted?.references ?? []) {
        expect(reference).toMatchObject({ path: expect.any(String), role: expect.any(String) });
      }
      expect(accepted?.generation).toMatchObject({
        builtInCallCount: 1,
        variantsReturned: 1,
        generatorOutputFilename: expect.stringMatching(/^exec-[0-9a-f-]+\.png$/),
        source: { path: asset.sourceFile, sha256: asset.sourceSha256 },
      });
      expect(accepted?.accepted).toMatchObject({
        output: `public/ui/delve-affixes/${asset.output}`,
        sha256: asset.acceptedSha256,
        bytes: asset.acceptedBytes,
        decision: expect.stringContaining('accepted:'),
        review: { sizesPx: [128, 48, 32, 16] },
      });
      expect(accepted?.rejects).toEqual([]);
      expect(accepted?.retries).toBe(0);
    }
  });
});
