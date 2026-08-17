import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cohortPath =
  'docs/achievements/release-v039-icon-art-second-pass-2026-08-16/legacy-warrior-warlock-mage.json';
const cohortSha256 = '475d4cd186299792b2508ffe8b120eb0902638a8632390945ea7aa8d3c079f13';
const sourcePack = 'woc_openai_release_v039_icon_art_second_pass_2026_08_16';
const baseCommit = 'd2d1a8ad5c11';

const expectedIds = {
  warrior: [
    'battle_shout',
    'charge',
    'defensive_stance',
    'demoralizing_shout',
    'hamstring',
    'heroic_strike',
    'intimidating_shout',
    'mortal_strike',
    'overpower',
    'red_harvest',
    'shield_slam',
    'slam',
    'sunder_armor',
    'taunt',
    'thunder_clap',
  ],
  warlock: ['summon_felguard', 'summon_felhunter', 'summon_succubus'],
  mage: ['conjure_food', 'conjure_water', 'polymorph'],
} as const;

interface ReferenceRecord {
  path: string;
  role: string;
}

interface CohortAsset {
  class: keyof typeof expectedIds;
  abilityId: string;
  oldShipping: {
    sha256: string;
    bytes: number;
    width: number;
    height: number;
    colorSpace: string;
    opaque: boolean;
  };
  oldMapping: {
    path: string;
    sourcePack: string;
    sourceFile: string;
    ownerOrLicense: string;
    inheritedClassLicense: string;
  };
  generation: {
    mode: string;
    builtInCallCount: number;
    prompt: string;
    references: ReferenceRecord[];
    sourceFile: string;
    sourceSha256: string;
    sourceBytes: number;
    width: number;
    height: number;
    colorSpace: string;
    opaque: boolean;
  };
  accepted: {
    output: string;
    sha256: string;
    bytes: number;
    width: number;
    height: number;
    colorSpace: string;
    opaque: boolean;
    decision: string;
    review: {
      semantic: string;
      crop: string;
      style: string;
      sizesPx: number[];
      grayscale: string;
      circularCrop: string;
    };
  };
  rejects: unknown[];
  retries: number;
}

interface Cohort {
  schemaVersion: number;
  batch: string;
  result: {
    requested: number;
    generated: number;
    accepted: number;
    rejected: number;
    retried: number;
  };
  assets: CohortAsset[];
}

interface MappingEntry {
  abilityId: string;
  sourcePack: string;
  sourceFile: string;
  output: string;
  source: string;
  owner: string;
  license: string;
  provenanceRecord: string;
  intendedVisualSubject: string;
  references: ReferenceRecord[];
  generationPrompt: string;
  sourceSha256: string;
  sourceBytes: number;
  sourceWidth: number;
  sourceHeight: number;
  acceptedSha256: string;
  acceptedBytes: number;
  acceptedWidth: number;
  acceptedHeight: number;
  acceptedColorSpace: string;
  acceptedOpaque: boolean;
  review: {
    sizesPx: number[];
    grayscale: string;
    circularCrop: string;
    semantic: string;
    crop: string;
    style: string;
  };
  supersedes: {
    sourcePack: string;
    sourceFile: string;
    ownerOrLicense: string;
    inheritedClassLicense: string;
    output: string;
    shippingSha256: string;
    shippingBytes: number;
    width: number;
    height: number;
    colorSpace: string;
    opaque: boolean;
    reason: string;
  };
}

interface SkillMapping {
  licenseScope: string;
  abilities: MappingEntry[];
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const readJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8')) as T;

function baseCommitIsAvailable(): boolean {
  return (
    spawnSync('git', ['cat-file', '-e', `${baseCommit}^{commit}`], {
      cwd: repoRoot,
      stdio: 'ignore',
    }).status === 0
  );
}

function baseCommitBlob(relativePath: string): Buffer {
  return execFileSync('git', ['show', `${baseCommit}:${relativePath}`], {
    cwd: repoRoot,
    encoding: 'buffer',
    maxBuffer: 32 * 1024 * 1024,
  });
}

describe('release v0.39 legacy Warrior, Warlock, and Mage skill repaints', () => {
  it('preserves one exact project-owned lineage record for every replaced icon', () => {
    expect(sha256(readFileSync(path.join(repoRoot, cohortPath)))).toBe(cohortSha256);
    const cohort = readJson<Cohort>(cohortPath);
    const expectedKeys = Object.entries(expectedIds)
      .flatMap(([className, ids]) => ids.map((id) => `${className}/${id}`))
      .sort();
    const actualKeys = cohort.assets.map((asset) => `${asset.class}/${asset.abilityId}`).sort();

    expect(cohort.schemaVersion).toBe(1);
    expect(cohort.batch).toBe('release-v039-second-pass-legacy-warrior-warlock-mage-2026-08-16');
    expect(cohort.result).toEqual({
      requested: 21,
      generated: 21,
      accepted: 21,
      rejected: 0,
      retried: 0,
    });
    expect(actualKeys).toEqual(expectedKeys);
    expect(new Set(actualKeys).size).toBe(actualKeys.length);

    for (const asset of cohort.assets) {
      const mappingPath = `public/ui/skills/${asset.class}/mapping.json`;
      const mapping = readJson<SkillMapping>(mappingPath);
      const owners = mapping.abilities.filter(({ abilityId }) => abilityId === asset.abilityId);
      const batchEntries = mapping.abilities.filter((entry) => entry.sourcePack === sourcePack);
      const entry = owners[0];

      expect(owners, `${asset.class}/${asset.abilityId} has one current owner`).toHaveLength(1);
      expect(batchEntries.map(({ abilityId }) => abilityId).sort()).toEqual(
        [...expectedIds[asset.class]].sort(),
      );
      expect(mapping.licenseScope).toContain(sourcePack);
      expect(asset.oldMapping.path).toBe(mappingPath);
      expect(asset.generation.mode).toBe('OpenAI built-in image generation');
      expect(asset.generation.builtInCallCount).toBe(1);
      expect(asset.generation.references.length).toBeGreaterThanOrEqual(2);
      expect(asset.generation.references.length).toBeLessThanOrEqual(4);
      expect(
        asset.generation.references.every(({ path: referencePath, role }) => {
          return existsSync(path.join(repoRoot, referencePath)) && role.length > 0;
        }),
      ).toBe(true);
      expect(asset.generation.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.generation.sourceBytes).toBeGreaterThan(0);
      expect(asset.generation).toMatchObject({
        width: 1254,
        height: 1254,
        colorSpace: 'sRGB',
        opaque: true,
      });
      expect(asset.rejects).toEqual([]);
      expect(asset.retries).toBe(0);

      expect(entry).toBeDefined();
      expect(entry).toMatchObject({
        abilityId: asset.abilityId,
        sourcePack,
        sourceFile: asset.generation.sourceFile,
        output: `${asset.abilityId}.webp`,
        source: 'OpenAI built-in image generation',
        owner: 'World of ClaudeCraft',
        license: 'World of ClaudeCraft project-generated art, project asset, rights reserved',
        provenanceRecord: cohortPath,
        sourceSha256: asset.generation.sourceSha256,
        sourceBytes: asset.generation.sourceBytes,
        sourceWidth: asset.generation.width,
        sourceHeight: asset.generation.height,
        acceptedSha256: asset.accepted.sha256,
        acceptedBytes: asset.accepted.bytes,
        acceptedWidth: asset.accepted.width,
        acceptedHeight: asset.accepted.height,
        acceptedColorSpace: asset.accepted.colorSpace,
        acceptedOpaque: asset.accepted.opaque,
      });
      expect(entry.references).toEqual(asset.generation.references);
      expect(entry.generationPrompt).toBe(asset.generation.prompt);
      expect(entry.generationPrompt).toContain(`Subject: ${entry.intendedVisualSubject}`);
      expect(entry.review).toEqual({
        sizesPx: asset.accepted.review.sizesPx,
        grayscale: asset.accepted.review.grayscale,
        circularCrop: asset.accepted.review.circularCrop,
        semantic: asset.accepted.review.semantic,
        crop: asset.accepted.review.crop,
        style: asset.accepted.review.style,
      });
      expect(entry.supersedes).toEqual({
        sourcePack: asset.oldMapping.sourcePack,
        sourceFile: asset.oldMapping.sourceFile,
        ownerOrLicense: asset.oldMapping.ownerOrLicense,
        inheritedClassLicense: asset.oldMapping.inheritedClassLicense,
        output: `${asset.abilityId}.webp`,
        shippingSha256: asset.oldShipping.sha256,
        shippingBytes: asset.oldShipping.bytes,
        width: asset.oldShipping.width,
        height: asset.oldShipping.height,
        colorSpace: asset.oldShipping.colorSpace,
        opaque: asset.oldShipping.opaque,
        reason:
          'Release v0.39 second-pass audit replaced a high-confidence legacy flat/cartoon outlier with mechanic-accurate premium painted art.',
      });
      expect(entry.acceptedSha256).not.toBe(entry.supersedes.shippingSha256);
    }
  });

  it('pins every accepted opaque 128px shipping image and the live toad subject', async () => {
    const cohort = readJson<Cohort>(cohortPath);
    const acceptedHashes = new Set<string>();

    for (const asset of cohort.assets) {
      const file = path.join(repoRoot, asset.accepted.output);
      const bytes = readFileSync(file);
      const metadata = await sharp(bytes).metadata();

      expect(bytes.length, `${asset.class}/${asset.abilityId} bytes`).toBe(asset.accepted.bytes);
      expect(bytes.length, `${asset.class}/${asset.abilityId} byte ceiling`).toBeLessThanOrEqual(
        15 * 1024,
      );
      expect(sha256(bytes), `${asset.class}/${asset.abilityId} SHA-256`).toBe(
        asset.accepted.sha256,
      );
      expect(metadata, `${asset.class}/${asset.abilityId} image contract`).toMatchObject({
        format: 'webp',
        width: 128,
        height: 128,
        space: 'srgb',
        hasAlpha: false,
      });
      expect(asset.accepted.review).toMatchObject({
        semantic: 'accepted',
        crop: 'accepted',
        style: 'accepted',
        sizesPx: [128, 48, 32, 16],
        grayscale: 'accepted',
        circularCrop: 'accepted',
      });
      expect(acceptedHashes.has(asset.accepted.sha256), `${asset.abilityId} unique art`).toBe(
        false,
      );
      acceptedHashes.add(asset.accepted.sha256);
    }

    expect(acceptedHashes.size).toBe(21);
    const polymorph = cohort.assets.find(({ abilityId }) => abilityId === 'polymorph');
    expect(polymorph?.generation.prompt).toMatch(/unmistakable squat green TOAD/i);
    expect(polymorph?.generation.prompt).toMatch(/not a monkey/i);
  });

  it('matches every superseded byte count and hash to the exact base-commit blob', () => {
    // Full-history release worktrees verify the former images against Git itself. Shallow CI
    // checkouts may not carry the recorded commit, so the sealed cohort digest remains the
    // always-on pin there, matching the other legacy repaint cohort tests.
    if (!baseCommitIsAvailable()) return;

    const cohort = readJson<Cohort>(cohortPath);
    for (const asset of cohort.assets) {
      const bytes = baseCommitBlob(asset.accepted.output);
      const identity = `${asset.class}/${asset.abilityId}`;

      expect(bytes.length, `${identity} base-commit bytes`).toBe(asset.oldShipping.bytes);
      expect(sha256(bytes), `${identity} base-commit SHA-256`).toBe(asset.oldShipping.sha256);
    }
  });
});
