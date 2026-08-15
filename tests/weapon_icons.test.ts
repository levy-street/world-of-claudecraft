import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { WEAPON_IMAGE_IDS, weaponIconUrl } from '../src/ui/icons';
import { ITEM_WEAPON_VARIANTS } from '../src/ui/weapon_variants';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const itemsDir = path.join(repoRoot, 'public/ui/items');
const weaponProvenanceRecord = 'docs/achievements/placeholder-art-completion-2026-08-09/';
const itemConsistencyProvenanceRecord = 'docs/achievements/item-art-consistency-2026-08-09/';
const weaponGenerationRecordFiles = [
  'weapons-a-generation-record.json',
  'weapons-b-generation-record.json',
  'weapons-c-generation-record.md',
  'weapons-d-generation-record.json',
] as const;
const itemMapping = JSON.parse(readFileSync(path.join(itemsDir, 'mapping.json'), 'utf8')) as {
  entries: Array<{ itemId: string }>;
  generatedBatches?: Array<{
    batchId?: string;
    source: string;
    owner?: string;
    license: string;
    provenanceRecord?: string;
    itemIds: string[];
  }>;
};

describe('painted weapon inventory icons', () => {
  const baseWeapons = Object.values(ITEMS)
    .filter((item) => item.kind === 'weapon' && item.heroicOf === undefined)
    .map((item) => item.id)
    .sort();

  it('covers every authored base weapon exactly once', () => {
    // 123 with the class-overhaul integration daggers (rimefang, marrowpoint,
    // duskwhisper, boneglass_shiv), painted in integration-dagger-icons-2026-08-10.
    expect(baseWeapons).toHaveLength(123);
    expect([...WEAPON_IMAGE_IDS].sort()).toEqual(baseWeapons);
    expect(Object.keys(ITEM_WEAPON_VARIANTS).sort()).toEqual(baseWeapons);
    for (const id of baseWeapons) {
      expect(weaponIconUrl(id), id).toBe(`/ui/items/${id}.webp`);
      expect(existsSync(path.join(itemsDir, `${id}.webp`)), `${id}.webp`).toBe(true);
    }
  });

  it('keeps Heroic copies on their canonical base painting', () => {
    const heroics = Object.values(ITEMS).filter(
      (item) => item.kind === 'weapon' && item.heroicOf !== undefined,
    );
    // 16 with heroic_duskwhisper (aliases the duskwhisper base painting).
    expect(heroics).toHaveLength(16);
    for (const heroic of heroics) {
      expect(WEAPON_IMAGE_IDS.has(heroic.id), heroic.id).toBe(false);
      expect(weaponIconUrl(heroic.id), heroic.id).toBe(
        `/ui/items/${heroic.heroicOf as string}.webp`,
      );
    }
  });

  it('keeps the historical registry while every weapon has one current generated-art owner', () => {
    const expected = Object.keys(ITEM_WEAPON_VARIANTS).sort();
    const batches = itemMapping.generatedBatches ?? [];
    const weaponBatches = batches.filter((batch) =>
      batch.itemIds.some((id) => Object.hasOwn(ITEM_WEAPON_VARIANTS, id)),
    );
    expect(weaponBatches).toHaveLength(3);
    const historicalBatch = weaponBatches.find(
      ({ batchId }) => batchId === 'placeholder-art-completion-weapons-2026-08-09',
    );
    const replacementBatch = weaponBatches.find(
      ({ batchId }) => batchId === 'item-art-consistency-2026-08-09',
    );
    expect(historicalBatch).toBeDefined();
    expect(replacementBatch).toBeDefined();

    const replacementManifest = JSON.parse(
      readFileSync(
        path.join(repoRoot, itemConsistencyProvenanceRecord, 'accepted-art.json'),
        'utf8',
      ),
    ) as {
      supersedes: Array<{
        itemId: string;
        historicalAcceptedArt?: { path: string; assetKey: string };
      }>;
    };
    const replacementWeaponIds = replacementManifest.supersedes
      .filter(
        ({ itemId, historicalAcceptedArt }) =>
          Object.hasOwn(ITEM_WEAPON_VARIANTS, itemId) &&
          historicalAcceptedArt?.path === `${weaponProvenanceRecord}accepted-art.json`,
      )
      .map(({ itemId }) => itemId)
      .sort();
    expect(replacementWeaponIds).toEqual([
      'craghorn_staff',
      'drovers_staff',
      'hollow_vigil_staff',
      'widowfang_dirk',
    ]);
    // The class-overhaul integration adds four daggers in their own batch
    // (integration-dagger-icons-2026-08-10); the historical campaign batch
    // owns every weapon that predates both it and the replacements.
    const integrationBatch = weaponBatches.find(
      ({ batchId }) => batchId === 'integration-dagger-icons-2026-08-10',
    );
    expect(integrationBatch).toBeDefined();
    const integrationWeaponIds = (integrationBatch?.itemIds ?? [])
      .filter((id) => Object.hasOwn(ITEM_WEAPON_VARIANTS, id))
      .sort();
    expect(integrationWeaponIds).toEqual([
      'boneglass_shiv',
      'duskwhisper',
      'marrowpoint',
      'rimefang',
    ]);
    expect(historicalBatch?.itemIds).toEqual(
      expected.filter(
        (id) => !replacementWeaponIds.includes(id) && !integrationWeaponIds.includes(id),
      ),
    );
    expect(
      replacementBatch?.itemIds.filter((id) => Object.hasOwn(ITEM_WEAPON_VARIANTS, id)).sort(),
    ).toEqual(replacementWeaponIds);
    expect(
      weaponBatches
        .flatMap(({ itemIds }) => itemIds.filter((id) => Object.hasOwn(ITEM_WEAPON_VARIANTS, id)))
        .sort(),
    ).toEqual(expected);

    for (const batch of [historicalBatch, replacementBatch]) {
      expect(batch?.source).toBe('OpenAI built-in image generation');
      expect(batch?.owner).toBe('World of ClaudeCraft');
      expect(batch?.license).toContain('project asset');
    }
    expect(historicalBatch?.provenanceRecord).toBe(weaponProvenanceRecord);
    expect(replacementBatch?.provenanceRecord).toBe(itemConsistencyProvenanceRecord);

    const provenanceDir = path.join(repoRoot, weaponProvenanceRecord);
    const readJsonRecord = (filename: string): unknown =>
      JSON.parse(readFileSync(path.join(provenanceDir, filename), 'utf8'));
    const chunkA = readJsonRecord(weaponGenerationRecordFiles[0]) as {
      assets: Array<{ id: string }>;
    };
    const chunkB = readJsonRecord(weaponGenerationRecordFiles[1]) as {
      assets: Array<{ id: string }>;
    };
    const chunkCSource = readFileSync(
      path.join(provenanceDir, weaponGenerationRecordFiles[2]),
      'utf8',
    );
    const chunkC = [...chunkCSource.matchAll(/^\|\s*`([a-z0-9_]+)`\s*\|\s*`[a-f0-9]{64}`/gm)].map(
      (match) => match[1],
    );
    const chunkD = readJsonRecord(weaponGenerationRecordFiles[3]) as {
      finalAssets: Array<{ id: string }>;
    };
    // The chunk records are the frozen weapon campaign's generation reports:
    // they slice the pre-integration weapon roster, without the four
    // integration daggers that postdate the campaign.
    const campaignExpected = expected.filter((id) => !integrationWeaponIds.includes(id));
    expect(chunkA.assets.map(({ id }) => id)).toEqual(campaignExpected.slice(0, 40));
    expect(chunkB.assets.map(({ id }) => id)).toEqual(campaignExpected.slice(40, 80));
    expect(chunkC).toEqual(campaignExpected.slice(80, 100));
    expect(chunkD.finalAssets.map(({ id }) => id)).toEqual(campaignExpected.slice(100));

    const provenanceReadme = readFileSync(path.join(provenanceDir, 'README.md'), 'utf8');
    for (const filename of weaponGenerationRecordFiles) {
      expect(provenanceReadme, `${filename} lineage`).toContain(`\`${filename}\``);
    }

    for (const id of expected) {
      const owners = [
        ...itemMapping.entries.filter((entry) => entry.itemId === id),
        ...batches.filter((batch) => batch.itemIds.includes(id)),
      ];
      expect(owners, `${id} provenance owner`).toHaveLength(1);
    }
  });

  it('ships 119 distinct opaque 128px paintings within budget', async () => {
    const hashes = new Set<string>();
    for (const id of baseWeapons) {
      const violations: string[] = [];
      const bytes = readFileSync(path.join(itemsDir, `${id}.webp`));
      if (bytes.length > 15 * 1024) {
        violations.push(`byte budget: ${bytes.length} > ${15 * 1024}`);
      }
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (hashes.has(hash)) {
        violations.push(`duplicates an earlier weapon (${hash})`);
      }
      hashes.add(hash);

      const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (decoded.info.width !== 128 || decoded.info.height !== 128) {
        violations.push(
          `dimensions: ${decoded.info.width}x${decoded.info.height} instead of 128x128`,
        );
      }
      let nonOpaqueAlphaBytes = 0;
      let firstNonOpaqueOffset: number | undefined;
      for (let offset = 3; offset < decoded.data.length; offset += decoded.info.channels) {
        if (decoded.data[offset] !== 255) {
          nonOpaqueAlphaBytes += 1;
          firstNonOpaqueOffset ??= offset;
        }
      }
      if (nonOpaqueAlphaBytes > 0) {
        violations.push(
          `opacity: ${nonOpaqueAlphaBytes} alpha bytes are not 255 (first at byte ${firstNonOpaqueOffset})`,
        );
      }
      expect(violations, `${id} shipping contract`).toEqual([]);
    }
  });
});
