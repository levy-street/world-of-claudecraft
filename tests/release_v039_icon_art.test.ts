import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ABILITIES, ITEMS } from '../src/sim/data';
import { ActionBarController } from '../src/ui/hud/action_bar/action_bar_controller';
import { abilityImageUrl, itemImageUrl } from '../src/ui/icons';

interface AcceptedAsset {
  kind: 'ability' | 'aura';
  id: string;
  runtimeUrl: string;
  sourcePath: string;
  sourceBytes: number;
  sourceSha256: string;
  acceptedBytes: number;
  acceptedSha256: string;
  references: string[];
  prompt: string;
}

interface MappingAsset {
  id: string;
  runtimeUrl: string;
  sourcePath: string;
  sourceSha256: string;
  acceptedBytes: number;
  acceptedSha256: string;
  references: string[];
}

const repoRoot = process.cwd();
const recordPath = path.join(
  repoRoot,
  'docs/achievements/release-v039-icon-art-first-pass-2026-08-16/accepted-art.json',
);
const ACCEPTED_ART_SHA256 = '3d8cb36726050e3a708720b650744005f4ce23d3ac49c0323761441beb50eb51';
const SECOND_PASS_RECORD =
  'docs/achievements/release-v039-icon-art-second-pass-2026-08-16/accepted-art.json';
const SECOND_PASS_RECORD_SHA256 =
  'e14c211fae42369b661a1808415f98bf17ee65f35a516a987071380efac8c72b';
const EVIDENCE = {
  'icon-art-before-after-desktop.png': {
    sha256: '61d19fb321f2b30eb3749e0966f26efea0fa4df53edae4b253cfd70edb82cd7a',
  },
  'icon-art-before-after-mobile.png': {
    sha256: '9ae2dc510d304a3c3667fb611884055ef2b6cb3617f6806ed1e4f4c8dae69a8d',
  },
} as const;

const inventoryController = new ActionBarController({
  storage: {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  },
  playerClass: 'warrior',
  playerName: 'IconArtInventory',
  playerLevel: () => 1,
  talentSpec: () => null,
  knownAbilityIds: () => [],
  hasAura: () => false,
  isInSportMatch: () => false,
  showAttackButton: () => true,
});

function shippingImageExists(runtimeUrl: string | null): boolean {
  if (!runtimeUrl?.startsWith('/')) return false;
  return existsSync(path.join(repoRoot, 'public', runtimeUrl.slice(1)));
}

describe('release v0.39 icon-art first-pass lineage', () => {
  it('pins every accepted painting to its prompt, references, and shipping bytes', () => {
    const recordBytes = readFileSync(recordPath);
    expect(createHash('sha256').update(recordBytes).digest('hex')).toBe(ACCEPTED_ART_SHA256);
    const record = JSON.parse(recordBytes.toString('utf8')) as {
      schemaVersion: number;
      batch: {
        id: string;
        acceptedDate: string;
        baseRelease: string;
        baseCommit: string;
        rasterGenerator: string;
        owner: string;
        license: string;
      };
      scope: {
        rasterPaintings: number;
        petActionCommands: number;
        exactRuntimeAuras: number;
      };
      generationContract: {
        oneCallPerDistinctAsset: boolean;
        freshDistinctCompositions: boolean;
        sourceRetention: string;
        processing: string;
        review: string;
      };
      assets: AcceptedAsset[];
    };
    const expectedIds = [
      'cheater_mark',
      'pet_aggressive',
      'pet_attack',
      'pet_defensive',
      'pet_feed',
      'pet_growl',
      'pet_mend',
      'pet_passive',
      'pet_water_jet',
    ];

    expect(record).toMatchObject({
      schemaVersion: 1,
      batch: {
        id: 'release-v039-icon-art-first-pass-2026-08-16',
        acceptedDate: '2026-08-16',
        baseRelease: 'release/v0.39.0',
        baseCommit: 'd2d1a8ad5c11',
        rasterGenerator: 'OpenAI built-in image generation',
        owner: 'World of ClaudeCraft',
        license: 'World of ClaudeCraft project-generated art, project asset, rights reserved',
      },
      scope: {
        rasterPaintings: 9,
        petActionCommands: 8,
        exactRuntimeAuras: 1,
      },
      generationContract: {
        oneCallPerDistinctAsset: true,
        freshDistinctCompositions: true,
        sourceRetention:
          'Accepted 1254px masters remain under the gitignored tmp/imagegen tree in this worktree.',
        processing:
          'Each square sRGB master was scaled to exact 128px and encoded as opaque WebP at quality 82 by scripts/convert_skill_icons_webp.mjs with its 15 KiB gate.',
        review:
          'Every source and shipping icon was inspected as a family at 128px and at its relevant 13px to 48px runtime sizes.',
      },
    });
    expect(record.assets.map(({ id }) => id).sort()).toEqual(expectedIds);

    const shippingHashes = new Set<string>();
    for (const asset of record.assets) {
      expect(asset.prompt, asset.id).toMatch(/^Use case: stylized-concept\n/);
      expect(asset.prompt, asset.id).toMatch(/\btext\b/i);
      expect(asset.prompt, asset.id).toMatch(/\bwatermark\b/i);
      expect(asset.sourcePath, asset.id).toMatch(/^tmp\/imagegen\//);
      expect(asset.sourceBytes, asset.id).toBeGreaterThan(0);
      expect(asset.sourceSha256, asset.id).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.references.length, asset.id).toBeGreaterThanOrEqual(3);
      for (const reference of asset.references) {
        expect(existsSync(path.join(repoRoot, reference)), `${asset.id}: ${reference}`).toBe(true);
      }

      const file = path.join(repoRoot, 'public', asset.runtimeUrl.slice(1));
      const bytes = readFileSync(file);
      const hash = createHash('sha256').update(bytes).digest('hex');
      expect(bytes.length, asset.id).toBe(asset.acceptedBytes);
      expect(hash, asset.id).toBe(asset.acceptedSha256);
      shippingHashes.add(hash);
    }
    expect(shippingHashes.size).toBe(expectedIds.length);
  });

  it('retains desktop and mobile visual-review evidence', () => {
    const screenshotDir = path.join(
      repoRoot,
      'docs/screenshots/release-v039-icon-art-first-pass-2026-08-16',
    );
    const hashes = new Set<string>();
    for (const [file, expected] of Object.entries(EVIDENCE)) {
      const bytes = readFileSync(path.join(screenshotDir, file));
      expect(bytes.subarray(1, 4).toString('ascii'), file).toBe('PNG');
      expect(bytes.length, file).toBeGreaterThan(100_000);
      const hash = createHash('sha256').update(bytes).digest('hex');
      expect(hash, file).toBe(expected.sha256);
      hashes.add(hash);
    }
    expect(hashes.size).toBe(2);
  });

  it('keeps public mapping provenance identical to the sealed acceptance record', () => {
    const record = JSON.parse(readFileSync(recordPath, 'utf8')) as { assets: AcceptedAsset[] };
    const petMapping = JSON.parse(
      readFileSync(path.join(repoRoot, 'public/ui/skills/pet/mapping.json'), 'utf8'),
    ) as {
      abilities: Array<{
        abilityId: string;
        output: string;
        sourceFile: string;
        sourceSha256: string;
        acceptedBytes: number;
        acceptedSha256: string;
        references: Array<{ path: string }>;
      }>;
    };
    const auraMapping = JSON.parse(
      readFileSync(path.join(repoRoot, 'public/ui/auras/mapping.json'), 'utf8'),
    ) as {
      assets: Array<{
        auraId: string;
        output: string;
        sourceFile: string;
        sourceSha256: string;
        acceptedBytes: number;
        acceptedSha256: string;
        references: Array<{ path: string }>;
      }>;
    };
    const mapped: MappingAsset[] = [
      ...petMapping.abilities.map((entry) => ({
        id: entry.abilityId,
        runtimeUrl: `/ui/skills/pet/${entry.output}`,
        sourcePath: entry.sourceFile,
        sourceSha256: entry.sourceSha256,
        acceptedBytes: entry.acceptedBytes,
        acceptedSha256: entry.acceptedSha256,
        references: entry.references.map(({ path: referencePath }) => referencePath),
      })),
      ...auraMapping.assets
        .filter(({ auraId }) => auraId === 'cheater_mark')
        .map((entry) => ({
          id: entry.auraId,
          runtimeUrl: `/ui/auras/${entry.output}`,
          sourcePath: entry.sourceFile,
          sourceSha256: entry.sourceSha256,
          acceptedBytes: entry.acceptedBytes,
          acceptedSha256: entry.acceptedSha256,
          references: entry.references.map(({ path: referencePath }) => referencePath),
        })),
    ];
    const acceptedById = new Map(record.assets.map((asset) => [asset.id, asset]));

    expect(mapped.map(({ id }) => id).sort()).toEqual(record.assets.map(({ id }) => id).sort());
    for (const mapping of mapped) {
      const accepted = acceptedById.get(mapping.id);
      expect(accepted, `${mapping.id} accepted record`).toBeDefined();
      expect(mapping, mapping.id).toEqual({
        id: accepted?.id,
        runtimeUrl: accepted?.runtimeUrl,
        sourcePath: accepted?.sourcePath,
        sourceSha256: accepted?.sourceSha256,
        acceptedBytes: accepted?.acceptedBytes,
        acceptedSha256: accepted?.acceptedSha256,
        references: accepted?.references,
      });
    }
  });
});

describe('release v0.39 icon-art second-pass lineage', () => {
  it('seals every cohort and new-family shipping catalog behind one immutable record', () => {
    const aggregateBytes = readFileSync(path.join(repoRoot, SECOND_PASS_RECORD));
    expect(createHash('sha256').update(aggregateBytes).digest('hex')).toBe(
      SECOND_PASS_RECORD_SHA256,
    );
    const aggregate = JSON.parse(aggregateBytes.toString('utf8')) as {
      schemaVersion: number;
      batch: {
        id: string;
        baseRelease: string;
        baseCommit: string;
        rasterGenerator: string;
      };
      scope: {
        acceptedPaintings: number;
        newPaintedIdentities: number;
        legacySkillReplacements: number;
        families: Record<string, number>;
      };
      generation: {
        builtInImagegenCalls: number;
        acceptedPaintings: number;
        acceptedFirstOutputs: number;
        rejectedOutputs: number;
        retriedAssets: string[];
      };
      acceptedRecords: Array<{
        family: string;
        acceptedCount: number;
        path: string;
        sha256: string;
      }>;
      shippingCatalogs: Array<{
        family: string;
        assetCount: number;
        secondPassAssetCount: number;
        path: string;
        sha256: string;
      }>;
      runtimeClosure: {
        abilities: { live: number; painted: number };
        hotbarItems: { live: number; painted: number };
        fixedActions: { painted: number };
        mobAuraRouting: { paintedFamilies: number; exactRuntimeIds: number };
        fiesta: { augments: number; powerups: number; painted: number };
        rollableDelveAffixes: { live: number; painted: number };
        remainingExactLiveSemanticRasterGaps: number;
      };
    };

    expect(aggregate).toMatchObject({
      schemaVersion: 1,
      batch: {
        id: 'release-v039-icon-art-second-pass-2026-08-16',
        baseRelease: 'release/v0.39.0',
        baseCommit: 'd2d1a8ad5c11',
        rasterGenerator: 'OpenAI built-in image generation',
      },
      scope: {
        acceptedPaintings: 223,
        newPaintedIdentities: 165,
        legacySkillReplacements: 58,
        families: {
          runtimeAuras: 128,
          delveAffixes: 6,
          fiesta: 24,
          currency: 6,
          reliquary: 1,
          legacySkills: 58,
        },
      },
      generation: {
        builtInImagegenCalls: 224,
        acceptedPaintings: 223,
        acceptedFirstOutputs: 222,
        rejectedOutputs: 1,
        retriedAssets: ['dismiss_pet'],
      },
      runtimeClosure: {
        abilities: { live: 410, painted: 410 },
        hotbarItems: { live: 73, painted: 73 },
        fixedActions: { painted: 11 },
        mobAuraRouting: { paintedFamilies: 44, exactRuntimeIds: 89 },
        fiesta: { augments: 20, powerups: 4, painted: 24 },
        rollableDelveAffixes: { live: 6, painted: 6 },
        remainingExactLiveSemanticRasterGaps: 0,
      },
    });

    expect(aggregate.acceptedRecords).toHaveLength(9);
    const recordHashes = new Set<string>();
    for (const record of aggregate.acceptedRecords) {
      const bytes = readFileSync(path.join(repoRoot, record.path));
      expect(createHash('sha256').update(bytes).digest('hex'), record.family).toBe(record.sha256);
      expect(record.acceptedCount, record.family).toBeGreaterThan(0);
      recordHashes.add(record.sha256);
    }
    expect(recordHashes.size).toBe(aggregate.acceptedRecords.length);
    expect(
      aggregate.acceptedRecords
        .filter(({ family }) => family.includes('legacy-'))
        .reduce((sum, { acceptedCount }) => sum + acceptedCount, 0),
    ).toBe(58);
    expect(
      aggregate.acceptedRecords
        .filter(({ family }) => !family.includes('legacy-'))
        .reduce((sum, { acceptedCount }) => sum + acceptedCount, 0),
    ).toBe(140);

    expect(aggregate.shippingCatalogs.map(({ family }) => family).sort()).toEqual([
      'auras',
      'currency',
      'delve-affixes',
      'fiesta',
      'reliquary',
    ]);
    const secondPassHashes = new Set<string>();
    for (const catalog of aggregate.shippingCatalogs) {
      const bytes = readFileSync(path.join(repoRoot, catalog.path));
      expect(createHash('sha256').update(bytes).digest('hex'), catalog.family).toBe(catalog.sha256);
      const mapping = JSON.parse(bytes.toString('utf8')) as {
        acceptedArtManifest?: string;
        assets: Array<{ auraId?: string; acceptedSha256: string }>;
      };
      expect(mapping.assets, catalog.family).toHaveLength(catalog.assetCount);
      if (catalog.family !== 'auras') {
        expect(mapping.acceptedArtManifest, catalog.family).toBe(SECOND_PASS_RECORD);
      }
      const assets =
        catalog.family === 'auras'
          ? mapping.assets.filter(({ auraId }) => auraId !== 'cheater_mark')
          : mapping.assets;
      expect(assets, catalog.family).toHaveLength(catalog.secondPassAssetCount);
      for (const asset of assets) {
        expect(asset.acceptedSha256, catalog.family).toMatch(/^[0-9a-f]{64}$/);
        expect(secondPassHashes.has(asset.acceptedSha256), asset.acceptedSha256).toBe(false);
        secondPassHashes.add(asset.acceptedSha256);
      }
    }
    expect(secondPassHashes.size).toBe(aggregate.scope.newPaintedIdentities);
  });

  it('derives the sealed ability and hotbar-item totals from live production inventories', () => {
    const aggregate = JSON.parse(readFileSync(path.join(repoRoot, SECOND_PASS_RECORD), 'utf8')) as {
      runtimeClosure: {
        abilities: { live: number; painted: number };
        hotbarItems: { live: number; painted: number };
      };
    };
    const liveAbilityIds = Object.keys(ABILITIES);
    const paintedAbilityIds = new Set(
      liveAbilityIds.filter((id) => shippingImageExists(abilityImageUrl(id))),
    );
    const liveHotbarItemIds = Object.keys(ITEMS).filter((id) =>
      inventoryController.isHotbarItemId(id),
    );
    const paintedHotbarItemIds = new Set(
      liveHotbarItemIds.filter((id) => shippingImageExists(itemImageUrl(id))),
    );

    expect(new Set(liveAbilityIds).size, 'live ability ids remain unique').toBe(
      liveAbilityIds.length,
    );
    expect(liveAbilityIds, 'live production ability inventory').toHaveLength(410);
    expect(
      liveAbilityIds.filter((id) => !paintedAbilityIds.has(id)),
      'every live ability resolves through production to committed painted art',
    ).toEqual([]);
    expect(aggregate.runtimeClosure.abilities).toEqual({
      live: liveAbilityIds.length,
      painted: paintedAbilityIds.size,
    });

    expect(new Set(liveHotbarItemIds).size, 'live hotbar item ids remain unique').toBe(
      liveHotbarItemIds.length,
    );
    expect(liveHotbarItemIds, 'production isHotbarItemId inventory').toHaveLength(73);
    expect(
      liveHotbarItemIds.filter((id) => !paintedHotbarItemIds.has(id)),
      'every production-eligible hotbar item resolves to committed painted art',
    ).toEqual([]);
    expect(aggregate.runtimeClosure.hotbarItems).toEqual({
      live: liveHotbarItemIds.length,
      painted: paintedHotbarItemIds.size,
    });
  });
});
