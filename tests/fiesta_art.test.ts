import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { AUGMENTS, POWERUPS } from '../src/sim/content/augments';
import { resolveHudAuraIconId } from '../src/ui/aura_icon_runtime';
import {
  FIESTA_AUGMENT_IMAGE_IDS,
  FIESTA_POWERUP_IMAGE_IDS,
  fiestaAugmentImageUrl,
  fiestaPowerupImageUrl,
} from '../src/ui/hud/fiesta/fiesta_art';
import { auraImageUrl } from '../src/ui/icons';
import { observeFiestaPowerupAuras } from './helpers/fiesta_powerup_aura_observer';

interface FiestaMappingAsset {
  id: string;
  name: string;
  kind: 'augment' | 'powerup';
  tier: string;
  mechanic: string;
  output: string;
  url: string;
  sourceFile: string;
  source: string;
  owner: string;
  license: string;
  promptLines: string[];
  references: Array<{ path: string; role: string }>;
  sourceSha256: string;
  sourceBytes: number;
  sourceWidth: number;
  sourceHeight: number;
  sourceColorSpace: string;
  sourceMode: string;
  sourceOpaque: boolean;
  acceptedSha256: string;
  acceptedBytes: number;
  acceptedWidth: number;
  acceptedHeight: number;
  acceptedColorSpace: string;
  acceptedMode: string;
  acceptedOpaque: boolean;
  decision: string;
  reviewNotes: string;
}

interface FiestaMapping {
  schemaVersion: number;
  family: string;
  license: string;
  iconSize: number;
  runtimeDir: string;
  acceptedArtManifest: string;
  sourceProvenance: string;
  generation: {
    source: string;
    policy: string;
    requestedAssets: number;
    builtInImagegenCalls: number;
    acceptedFirstOutputs: number;
    rejectedOutputs: number;
    regeneratedAssets: number;
    reviewedAt: number[];
    reviewedInGrayscaleAt: number[];
  };
  assets: FiestaMappingAsset[];
}

const fiestaDir = path.join(process.cwd(), 'public/ui/fiesta');
const mapping = JSON.parse(
  readFileSync(path.join(fiestaDir, 'mapping.json'), 'utf8'),
) as FiestaMapping;

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

describe('Fiesta painted art', () => {
  it('keeps simulation registries, art registries, files, and mapping in exact parity', () => {
    const augmentIds = AUGMENTS.map(({ id }) => id).sort();
    const powerupIds = POWERUPS.map(({ id }) => id).sort();
    const expectedIds = [...augmentIds, ...powerupIds].sort();
    const mappedIds = mapping.assets.map(({ id }) => id).sort();

    expect([...FIESTA_AUGMENT_IMAGE_IDS].sort()).toEqual(augmentIds);
    expect([...FIESTA_POWERUP_IMAGE_IDS].sort()).toEqual(powerupIds);
    expect(mappedIds).toEqual(expectedIds);
    expect(new Set(mappedIds).size).toBe(expectedIds.length);
    expect(readdirSync(fiestaDir).sort()).toEqual(['augments', 'mapping.json', 'powerups']);

    for (const [kind, ids] of [
      ['augments', augmentIds],
      ['powerups', powerupIds],
    ] as const) {
      const entries = readdirSync(path.join(fiestaDir, kind)).sort();
      expect(entries).toEqual(ids.map((id) => `${id}.webp`));
    }
  });

  it('records exact generation ownership, prompts, reference roles, and source hashes', () => {
    expect(mapping).toMatchObject({
      schemaVersion: 1,
      family: 'fiesta',
      license: 'World of ClaudeCraft project-generated art, project asset, rights reserved',
      iconSize: 128,
      runtimeDir: 'public/ui/fiesta',
      acceptedArtManifest:
        'docs/achievements/release-v039-icon-art-second-pass-2026-08-16/accepted-art.json',
      sourceProvenance: 'tmp/imagegen/v039-second-pass/fiesta/provenance.json',
      generation: {
        source: 'OpenAI built-in image generation',
        policy: 'one built-in imagegen call per distinct asset',
        requestedAssets: 24,
        builtInImagegenCalls: 24,
        acceptedFirstOutputs: 24,
        rejectedOutputs: 0,
        regeneratedAssets: 0,
        reviewedAt: [128, 48, 32, 16],
        reviewedInGrayscaleAt: [128, 48, 32, 16],
      },
    });

    const sourceHashes = new Set<string>();
    for (const asset of mapping.assets) {
      expect(asset.source, asset.id).toBe('OpenAI built-in image generation');
      expect(asset.owner, asset.id).toBe('World of ClaudeCraft');
      expect(asset.license, asset.id).toBe(
        'World of ClaudeCraft project-generated art, project asset, rights reserved',
      );
      expect(asset.sourceFile, asset.id).toBe(
        `tmp/imagegen/v039-second-pass/fiesta/raw/${asset.id}.png`,
      );
      expect(asset.sourceSha256, asset.id).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.sourceBytes, asset.id).toBeGreaterThan(0);
      expect(asset.sourceWidth, asset.id).toBe(1254);
      expect(asset.sourceHeight, asset.id).toBe(1254);
      expect(asset.sourceColorSpace, asset.id).toBe('sRGB');
      expect(asset.sourceMode, asset.id).toBe('RGB');
      expect(asset.sourceOpaque, asset.id).toBe(true);
      expect(asset.promptLines.length, asset.id).toBeGreaterThanOrEqual(10);
      expect(asset.promptLines[0], asset.id).toBe('Use case: stylized-concept');
      expect(asset.promptLines.join('\n'), asset.id).not.toMatch(/\n$/);
      expect(asset.references.length, asset.id).toBeGreaterThanOrEqual(2);
      for (const reference of asset.references) {
        expect(reference.path, asset.id).toMatch(/^public\/ui\/.+\.webp$/);
        expect(reference.role.trim().length, asset.id).toBeGreaterThan(0);
        expect(existsSync(path.join(process.cwd(), reference.path)), reference.path).toBe(true);
      }

      const sourcePath = path.join(process.cwd(), asset.sourceFile);
      if (existsSync(sourcePath)) {
        const sourceBytes = readFileSync(sourcePath);
        expect(sourceBytes.length, asset.id).toBe(asset.sourceBytes);
        expect(sha256(sourceBytes), asset.id).toBe(asset.sourceSha256);
      }
      sourceHashes.add(asset.sourceSha256);
    }
    expect(sourceHashes.size).toBe(mapping.assets.length);
  });

  it('ships unique 128px opaque sRGB WebPs within the exact byte and hash contract', async () => {
    const acceptedHashes = new Set<string>();
    for (const asset of mapping.assets) {
      const expectedFolder = asset.kind === 'augment' ? 'augments' : 'powerups';
      const expectedOutput = `${expectedFolder}/${asset.id}.webp`;
      const expectedUrl = `/ui/fiesta/${expectedOutput}`;

      expect(asset.output, asset.id).toBe(expectedOutput);
      expect(asset.url, asset.id).toBe(expectedUrl);
      expect(asset.acceptedSha256, asset.id).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.acceptedWidth, asset.id).toBe(128);
      expect(asset.acceptedHeight, asset.id).toBe(128);
      expect(asset.acceptedColorSpace, asset.id).toBe('sRGB');
      expect(asset.acceptedMode, asset.id).toBe('RGB');
      expect(asset.acceptedOpaque, asset.id).toBe(true);
      expect(asset.decision, asset.id).toBe('accepted');
      expect(asset.reviewNotes.trim().length, asset.id).toBeGreaterThan(0);

      const bytes = readFileSync(path.join(fiestaDir, asset.output));
      const metadata = await sharp(bytes).metadata();
      expect(bytes.length, asset.id).toBe(asset.acceptedBytes);
      expect(bytes.length, asset.id).toBeLessThanOrEqual(15 * 1024);
      expect(sha256(bytes), asset.id).toBe(asset.acceptedSha256);
      expect(metadata, asset.id).toMatchObject({
        format: 'webp',
        width: 128,
        height: 128,
        space: 'srgb',
        channels: 3,
        hasAlpha: false,
      });
      acceptedHashes.add(asset.acceptedSha256);
    }
    expect(acceptedHashes.size).toBe(mapping.assets.length);
  });

  it('returns exact runtime URLs for every registered augment and powerup', () => {
    for (const id of FIESTA_AUGMENT_IMAGE_IDS) {
      expect(fiestaAugmentImageUrl(id), id).toBe(`/ui/fiesta/augments/${id}.webp`);
    }
    for (const id of FIESTA_POWERUP_IMAGE_IDS) {
      expect(fiestaPowerupImageUrl(id), id).toBe(`/ui/fiesta/powerups/${id}.webp`);
    }
    expect(fiestaAugmentImageUrl('missing')).toBeNull();
    expect(fiestaPowerupImageUrl('missing')).toBeNull();
  });

  it('resolves every aura emitted by each live powerup to that powerup painting', () => {
    const observations = observeFiestaPowerupAuras();
    const resolvedUrls = new Set<string>();
    const observedIds = new Set<string>();

    expect(observations.map(({ definition }) => definition.id).sort()).toEqual(
      POWERUPS.map(({ id }) => id).sort(),
    );
    for (const { definition, buffs, auras } of observations) {
      expect(auras, definition.id).toHaveLength(buffs.length);
      expect(
        auras.map(({ kind }) => kind),
        `${definition.id} emitted kinds`,
      ).toEqual(buffs.map(({ kind }) => kind));

      const expectedUrl = fiestaPowerupImageUrl(definition.id);
      expect(expectedUrl, definition.id).not.toBeNull();
      for (const aura of auras) {
        const iconId = resolveHudAuraIconId(aura);
        expect(iconId, aura.id).toBe(definition.id);
        expect(auraImageUrl(iconId), aura.id).toBe(expectedUrl);
        expect(observedIds.has(aura.id), `${aura.id} emitted once`).toBe(false);
        observedIds.add(aura.id);
        resolvedUrls.add(auraImageUrl(iconId) as string);
      }
    }
    expect(observedIds.size).toBe(POWERUPS.reduce((count, def) => count + def.buffs.length, 0));
    expect([...resolvedUrls].sort()).toEqual(
      [...FIESTA_POWERUP_IMAGE_IDS].map((id) => `/ui/fiesta/powerups/${id}.webp`).sort(),
    );
  });
});
