import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { abilityImageUrl } from '../src/ui/icons';

const ACCEPTED_PATH = path.resolve(
  'docs/achievements/release-art-audit-v036-2026-08-10/warlock-pet-action-art.accepted.json',
);
const EXPECTED_IDS = ['emberkin_felbolt', 'gloomshade_abyssal_chain'] as const;

interface AcceptedAsset {
  id: string;
  shipping: {
    path: string;
    bytes: number;
    sha256: string;
    width: number;
    height: number;
    format: string;
    colorspace: string;
    opaque: boolean;
    deterministicReencodeMatch: boolean;
  };
}

interface AcceptedManifest {
  schemaVersion: number;
  batch: string;
  mapping: { path: string; bytes: number; sha256: string };
  processing: { width?: number; quality: number };
  visualReview: { accepted: boolean; attemptsPerAsset: number; retries: number };
  assets: AcceptedAsset[];
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

describe('Warlock pet signature action art', () => {
  const accepted = JSON.parse(readFileSync(ACCEPTED_PATH, 'utf8')) as AcceptedManifest;

  it('pins the exact accepted batch and detailed mapping records', () => {
    expect(accepted.schemaVersion).toBe(1);
    expect(accepted.batch).toBe('warlock-pet-action-art-2026-08-10');
    expect(accepted.visualReview).toEqual(
      expect.objectContaining({ accepted: true, attemptsPerAsset: 1, retries: 0 }),
    );
    expect(accepted.assets.map(({ id }) => id)).toEqual(EXPECTED_IDS);

    const mappingBytes = readFileSync(path.resolve(accepted.mapping.path));
    expect(mappingBytes.length).toBe(accepted.mapping.bytes);
    expect(sha256(mappingBytes)).toBe(accepted.mapping.sha256);
    const mapping = JSON.parse(mappingBytes.toString('utf8')) as {
      abilities: Array<{
        abilityId: string;
        generatedResultPath?: string;
        generationPrompt?: string;
        references?: unknown[];
        owner?: string;
        license?: string;
      }>;
    };
    for (const id of EXPECTED_IDS) {
      const record = mapping.abilities.find(({ abilityId }) => abilityId === id);
      expect(record, id).toMatchObject({
        abilityId: id,
        owner: 'World of ClaudeCraft',
        license: 'World of ClaudeCraft project-generated art, project asset, rights reserved',
      });
      expect(record?.generatedResultPath, `${id} generated result`).toMatch(/\/exec-[^/]+\.png$/);
      expect(record?.generationPrompt?.length, `${id} exact prompt`).toBeGreaterThan(500);
      expect(record?.references, `${id} ordered references`).toHaveLength(4);
    }
  });

  it('ships unique opaque 128px WebPs through the runtime ability route', async () => {
    const hashes = new Set<string>();
    for (const asset of accepted.assets) {
      const bytes = readFileSync(path.resolve(asset.shipping.path));
      const metadata = await sharp(bytes).metadata();
      const stats = await sharp(bytes).stats();
      expect(bytes.length, asset.id).toBe(asset.shipping.bytes);
      expect(sha256(bytes), asset.id).toBe(asset.shipping.sha256);
      expect(metadata, asset.id).toMatchObject({
        format: 'webp',
        width: 128,
        height: 128,
        space: 'srgb',
      });
      expect(stats.isOpaque, asset.id).toBe(true);
      expect(asset.shipping.deterministicReencodeMatch, asset.id).toBe(true);
      expect(abilityImageUrl(asset.id), asset.id).toBe(`/ui/skills/warlock/${asset.id}.webp`);
      hashes.add(asset.shipping.sha256);
    }
    expect(hashes.size).toBe(EXPECTED_IDS.length);
  });
});
