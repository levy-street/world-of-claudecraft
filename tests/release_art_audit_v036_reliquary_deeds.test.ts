import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  type AcceptedArtManifest,
  auditIconAssets,
  validateAcceptedArtManifest,
} from '../scripts/lib/icon_asset_audit.mjs';
import { GUIDE_DEEDS } from '../src/guide/content.generated';
import { DEED_ORDER } from '../src/sim/content/deeds';
import { DEED_IMAGE_IDS } from '../src/ui/deed_image_ids';
import { DEED_ART_PENDING, deedImageUrl } from '../src/ui/icons';

const repoRoot = path.join(__dirname, '..');
const evidenceDir = path.join(repoRoot, 'docs/achievements/release-art-audit-v036-2026-08-10');
const acceptedPath = path.join(evidenceDir, 'reliquary-deed-art.accepted.json');
const generationPath = path.join(evidenceDir, 'reliquary-deed-art.generation.json');
const processingPath = path.join(evidenceDir, 'reliquary-deed-art.processing.json');
const batchId = 'release-art-audit-v036-reliquary-deeds-2026-08-10';

const RELIQUARY_DEED_IDS = [
  'col_reliquary_complete',
  'col_reliquary_conquerors',
  'col_reliquary_illum_gravewyrm_heroic',
  'col_reliquary_illum_nythraxis_heroic',
  'col_reliquary_illum_thunzharr',
  'col_reliquary_rank_2',
  'col_reliquary_rank_3',
  'col_reliquary_rank_4',
  'col_reliquary_rank_5',
] as const;

type ReliquaryDeedId = (typeof RELIQUARY_DEED_IDS)[number];

type AcceptedAsset = {
  kind: 'deed';
  id: ReliquaryDeedId;
  batchId: string;
  runtimeUrl: string;
  acceptedSha256: string;
  acceptedBytes: number;
  geometry: {
    alphaBounds: [number, number, number, number];
    visiblePixels: number;
  };
};

interface ReliquaryAcceptedManifest extends AcceptedArtManifest {
  batch: { id: string; acceptedDate: string };
  assets: AcceptedAsset[];
}

type ReferenceCatalogEntry = {
  id: string;
  repositoryPath: string;
  generationTimePath: string;
  bytes: number;
  sha256: string;
  dimensions: { width: number; height: number };
  format: 'WebP';
  alpha: true;
};

type GenerationAsset = {
  id: ReliquaryDeedId;
  canonicalName: string;
  generationMode: string;
  useCase: string;
  exactPrompt: string;
  orderedReferences: Array<{
    image: number;
    id: string;
    role: string;
    repositoryPath: string;
    generationTimePath: string;
  }>;
  generatedOrigin: string;
  generatedOriginEvidence: {
    copiedTo: string;
    bytes: number;
    sha256: string;
    dimensions: { width: number; height: number };
    channels: number;
    hasAlpha: boolean;
  };
  retries: unknown[];
};

type GenerationRecord = {
  schemaVersion: 1;
  batch: string;
  worktree: string;
  generationMode: string;
  generationSessionId: string;
  reconstructedFromThreadRecord: string;
  referenceCatalog: ReferenceCatalogEntry[];
  assets: GenerationAsset[];
};

type StageFile = {
  path: string;
  bytes: number;
  sha256: string;
  dimensions: string;
  channels: number;
  hasAlpha: boolean;
  alpha8?: {
    bounds: [number, number, number, number];
    padding: [number, number, number, number];
    centerOffset: [number, number];
    coverage: number;
    visiblePixels: number;
  };
};

type ProcessingRecord = {
  schemaVersion: 1;
  batch: string;
  chromaKey: { script: string; arguments: string[] };
  normalization: { alphaCropThreshold: number; fit: string };
  shipping: {
    script: string;
    fallbackUsed: boolean;
    webp: { quality: number; alphaQuality: number; smartSubsample: boolean; effort: number };
  };
  visualReview: {
    verdict: string;
    sheets: Array<{ path: string; bytes: number; sha256: string; reviewScale: string }>;
    checks: string[];
  };
  assets: Array<{
    id: ReliquaryDeedId;
    files: { raw: StageFile; keyed: StageFile; source: StageFile; shipping: StageFile };
  }>;
};

function readJson<T>(file: string): T {
  expect(existsSync(file), `${path.basename(file)} must be committed`).toBe(true);
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

describe('v0.36 release-audit Reliquary deed art', () => {
  it('pins the deed-only accepted manifest and audits the exact shipping artwork', async () => {
    const accepted = readJson<ReliquaryAcceptedManifest>(acceptedPath);
    expect(accepted.schemaVersion).toBe(1);
    expect(accepted.batch).toMatchObject({ id: batchId, acceptedDate: '2026-08-10' });
    expect(() => validateAcceptedArtManifest(accepted)).not.toThrow();
    expect(accepted.assets.map(({ id }) => id)).toEqual([...RELIQUARY_DEED_IDS]);

    const report = await auditIconAssets({ manifest: accepted, repoRoot });
    expect(report.summary).toMatchObject({
      ok: true,
      assetCount: RELIQUARY_DEED_IDS.length,
      issueCount: 0,
      exactDuplicateGroupCount: 0,
    });
    expect(report.exactDuplicates).toEqual([]);
    expect(report.assets.every(({ issues }) => issues.length === 0)).toBe(true);

    const acceptedById = new Map(accepted.assets.map((asset) => [asset.id, asset]));
    for (const measured of report.assets) {
      const pin = acceptedById.get(measured.id as ReliquaryDeedId);
      expect(pin, `${measured.id} accepted pin`).toBeDefined();
      expect(measured).toMatchObject({
        width: 128,
        height: 128,
        format: 'webp',
        colourspace: 'srgb',
        hasAlpha: true,
        alphaMode: 'transparent-subject',
        bytes: pin?.acceptedBytes,
        sha256: pin?.acceptedSha256,
      });
      expect(measured.alpha?.bounds, `${measured.id} alpha bounds`).toEqual(
        pin?.geometry.alphaBounds,
      );
      expect(measured.alpha?.visiblePixels, `${measured.id} visible pixels`).toBe(
        pin?.geometry.visiblePixels,
      );
    }
  });

  it('closes the exhaustive live deed debt ledger at 271 painted deeds', () => {
    expect([...DEED_ART_PENDING]).toEqual([]);
    expect(DEED_ORDER).toHaveLength(271);
    expect(DEED_IMAGE_IDS.size).toBe(271);
    expect(DEED_ORDER.filter((id) => !DEED_IMAGE_IDS.has(id))).toEqual([]);
    expect(sorted(DEED_IMAGE_IDS)).toEqual(sorted(DEED_ORDER));

    const guideById = new Map(GUIDE_DEEDS.map((deed) => [deed.id, deed]));
    for (const id of RELIQUARY_DEED_IDS) {
      const runtimeUrl = `/ui/deeds/${id}.webp`;
      expect(DEED_IMAGE_IDS.has(id), `${id} generated registry membership`).toBe(true);
      expect(deedImageUrl(`deed_${id}`), `${id} runtime resolver`).toBe(runtimeUrl);
      expect(guideById.get(id)?.crest, `${id} generated guide crest`).toBe(runtimeUrl);
    }
  });

  it('preserves the exact prompts, ordered references, and generated-output origins', async () => {
    const generation = readJson<GenerationRecord>(generationPath);
    expect(generation).toMatchObject({
      schemaVersion: 1,
      batch: batchId,
      worktree: '/Users/fernando/Documents/wocc-release-art-audit-v036',
      generationMode: 'OpenAI built-in image generation',
      generationSessionId: '019fe6e9-7ed7-7bc3-a44e-c7475af3a73f',
    });
    expect(path.isAbsolute(generation.reconstructedFromThreadRecord)).toBe(true);
    expect(generation.assets.map(({ id }) => id)).toEqual([...RELIQUARY_DEED_IDS]);

    const catalog = new Map(generation.referenceCatalog.map((entry) => [entry.id, entry]));
    expect(catalog.size).toBe(generation.referenceCatalog.length);
    for (const reference of generation.referenceCatalog) {
      expect(path.isAbsolute(reference.repositoryPath), reference.id).toBe(false);
      expect(path.isAbsolute(reference.generationTimePath), reference.id).toBe(true);
      expect(reference.generationTimePath).toBe(
        path.join(generation.worktree, reference.repositoryPath),
      );
      const file = path.join(repoRoot, reference.repositoryPath);
      const bytes = readFileSync(file);
      expect(bytes.length, `${reference.id} reference bytes`).toBe(reference.bytes);
      expect(sha256(bytes), `${reference.id} reference sha256`).toBe(reference.sha256);
      const metadata = await sharp(bytes).metadata();
      expect(metadata).toMatchObject({
        width: reference.dimensions.width,
        height: reference.dimensions.height,
        format: reference.format.toLowerCase(),
        hasAlpha: reference.alpha,
      });
    }

    for (const asset of generation.assets) {
      expect(asset.exactPrompt.startsWith('Use case: stylized-concept\n')).toBe(true);
      expect(asset.exactPrompt).toContain(`(${asset.id})`);
      expect(asset.exactPrompt.length, `${asset.id} exact prompt`).toBeGreaterThan(1_000);
      expect(asset.generationMode).toBe('OpenAI built-in image generation');
      expect(asset.useCase).toBe('stylized-concept');
      expect(asset.retries).toEqual([]);
      expect(asset.generatedOrigin).toMatch(
        /^\/Users\/fernando\/\.codex\/generated_images\/019fe6e9-7ed7-7bc3-a44e-c7475af3a73f\/exec-[0-9a-f-]+\.png$/,
      );
      expect(asset.generatedOriginEvidence).toMatchObject({
        copiedTo: `tmp/imagegen/release-art-audit-v036/deeds/raw/${asset.id}.png`,
        dimensions: { width: 1254, height: 1254 },
        channels: 3,
        hasAlpha: false,
      });
      expect(asset.generatedOriginEvidence.bytes).toBeGreaterThan(1_000_000);
      expect(asset.generatedOriginEvidence.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.orderedReferences.map(({ image }) => image)).toEqual([1, 2, 3, 4]);
      for (const reference of asset.orderedReferences) {
        const pin = catalog.get(reference.id);
        expect(pin, `${asset.id} Image ${reference.image} catalog pin`).toBeDefined();
        expect(reference.role, `${asset.id} Image ${reference.image} role`).toContain('reference');
        expect(reference.repositoryPath).toBe(pin?.repositoryPath);
        expect(reference.generationTimePath).toBe(pin?.generationTimePath);
      }
    }
  });

  it('pins every processing stage, exact review scale, and cross-record shipping identity', () => {
    const accepted = readJson<ReliquaryAcceptedManifest>(acceptedPath);
    const generation = readJson<GenerationRecord>(generationPath);
    const processing = readJson<ProcessingRecord>(processingPath);
    expect(processing).toMatchObject({
      schemaVersion: 1,
      batch: batchId,
      chromaKey: {
        arguments: [
          '--auto-key border',
          '--soft-matte',
          '--transparent-threshold 12',
          '--opaque-threshold 220',
          '--despill',
        ],
      },
      normalization: { alphaCropThreshold: 8 },
      shipping: {
        script: 'scripts/convert_deed_icons_webp.mjs',
        fallbackUsed: false,
        webp: { quality: 82, alphaQuality: 100, smartSubsample: true, effort: 6 },
      },
      visualReview: { verdict: 'accepted' },
    });
    expect(processing.visualReview.sheets.map(({ reviewScale }) => reviewScale)).toEqual([
      'normalized 512px sources shown at 256px',
      '128px shipping color',
      '40px shipping color',
      '24px shipping grayscale',
    ]);
    expect(
      processing.visualReview.sheets.every(({ sha256: hash }) => /^[0-9a-f]{64}$/.test(hash)),
    ).toBe(true);
    expect(processing.visualReview.checks.length).toBeGreaterThanOrEqual(7);
    expect(processing.assets.map(({ id }) => id)).toEqual([...RELIQUARY_DEED_IDS]);

    const acceptedById = new Map(accepted.assets.map((asset) => [asset.id, asset]));
    const generationById = new Map(generation.assets.map((asset) => [asset.id, asset]));
    for (const asset of processing.assets) {
      expect(Object.keys(asset.files)).toEqual(['raw', 'keyed', 'source', 'shipping']);
      expect(asset.files.raw).toMatchObject({ channels: 3, hasAlpha: false });
      expect(generationById.get(asset.id)?.generatedOriginEvidence).toEqual({
        copiedTo: asset.files.raw.path,
        bytes: asset.files.raw.bytes,
        sha256: asset.files.raw.sha256,
        dimensions: { width: 1254, height: 1254 },
        channels: asset.files.raw.channels,
        hasAlpha: asset.files.raw.hasAlpha,
      });
      expect(asset.files.keyed).toMatchObject({ channels: 4, hasAlpha: true });
      expect(asset.files.source).toMatchObject({
        dimensions: '512x512',
        channels: 4,
        hasAlpha: true,
      });
      expect(asset.files.shipping).toMatchObject({
        path: `public/ui/deeds/${asset.id}.webp`,
        dimensions: '128x128',
        channels: 4,
        hasAlpha: true,
        bytes: acceptedById.get(asset.id)?.acceptedBytes,
        sha256: acceptedById.get(asset.id)?.acceptedSha256,
      });
      expect(asset.files.shipping.alpha8).toMatchObject({
        bounds: acceptedById.get(asset.id)?.geometry.alphaBounds,
        visiblePixels: acceptedById.get(asset.id)?.geometry.visiblePixels,
      });
    }
  });

  it('credits and briefs the exact accepted Reliquary deed batch', () => {
    const credits = readFileSync(path.join(repoRoot, 'CREDITS.md'), 'utf8');
    const brief = readFileSync(path.join(repoRoot, 'docs/achievements/icon-brief.md'), 'utf8');
    const lineage = readFileSync(path.join(evidenceDir, 'reliquary-deed-art.md'), 'utf8');
    const creditRows = credits
      .split('\n')
      .filter((line) => line.startsWith('| v0.36 release-audit Reliquary Book of Deeds additions'));
    expect(creditRows).toHaveLength(1);
    expect(creditRows[0]).toContain('release-art-audit-v036-2026-08-10/reliquary-deed-art.md');
    expect(lineage).toContain('Status: accepted');

    for (const id of RELIQUARY_DEED_IDS) {
      expect(creditRows[0], `${id} credit`).toContain(`\`${id}\``);
      expect(brief, `${id} icon brief`).toContain(`\`${id}\``);
    }
  });
});
