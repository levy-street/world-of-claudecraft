import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { itemWeaponModelUrl } from '../src/render/characters/manifest';
import { DEED_ORDER } from '../src/sim/content/deeds';
import { ABILITIES, ITEMS } from '../src/sim/data';
import { DEED_IMAGE_IDS } from '../src/ui/deed_image_ids';
import {
  ABILITY_IMAGE_IDS,
  abilityImageUrl,
  DEED_ART_PENDING,
  ITEM_ART_PENDING,
  iconDataUrl,
  itemImageUrl,
  weaponIconUrl,
} from '../src/ui/icons';
import { ITEM_WEAPON_VARIANTS } from '../src/ui/weapon_variants';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(
  repoRoot,
  'docs/achievements/missing-painted-icons-accepted-art.json',
);
const itemConsistencyManifestPath = path.join(
  repoRoot,
  'docs/achievements/item-art-consistency-2026-08-09/accepted-art.json',
);

interface ReferenceRecord {
  path: string;
  role: string;
  provenance: string;
  license: string;
}

interface RasterAsset {
  kind: 'ability' | 'item' | 'deed';
  id: string;
  class?: string;
  zone?: string;
  family?: string;
  batch?: string;
  runtimeUrl: string;
  acceptedSha256: string;
  acceptedBytes: number;
  master: {
    path: string;
    bytes: number;
    sha256: string;
    width: number;
    height: number;
    format: string;
    colourspace: string;
  };
  source: {
    path: string;
    bytes: number;
    sha256: string;
    width: number;
    height: number;
    format: string;
    colourspace: string;
    alpha: string;
    geometry?: {
      alphaThreshold: number;
      bounds: [number, number, number, number];
      visiblePixels: number;
      coverage: number;
      centerOffset: [number, number];
    };
  };
  canonicalDisplayName: string;
  canonicalGameplayMeaningOrAcquisition: string;
  intendedVisualSubject: string;
  generation: {
    source: string;
    owner: string;
    license: string;
    prompt: string;
    references: ReferenceRecord[];
  };
  expected: {
    width: number;
    height: number;
    maxBytes: number;
    alpha: 'opaque' | 'transparent-subject';
    geometry?: {
      alphaThreshold: number;
      minPadding: number;
      maxCenterOffset: number;
      coverageMin: number;
      coverageMax: number;
      alphaBounds: [number, number, number, number];
      visiblePixels: number;
    };
  };
}

interface HeroicResolverTarget {
  id: string;
  baseId: string;
  variant: string;
  bagIconUrl: string;
  portraitPath: string;
  heldModelPath: string;
}

interface AcceptedArtManifest {
  schemaVersion: number;
  scope: {
    targetRows: number;
    rasterPaintings: number;
    abilities: number;
    items: number;
    deeds: number;
    heroicWeaponResolvers: number;
    originalInventoryRows: number;
    supplementalCurrentHeadRows: number;
  };
  contracts: Record<string, unknown>;
  targetSets: {
    abilities: string[];
    items: string[];
    deeds: string[];
    heroicWeaponResolvers: HeroicResolverTarget[];
  };
  assets: RasterAsset[];
}

interface ItemConsistencyManifest {
  assets: Array<{
    kind: 'item';
    id: string;
    acceptedSha256: string;
    acceptedBytes: number;
    generationReport: string;
  }>;
  supersedes: Array<{
    itemId: string;
    historicalAcceptedArt?: { path: string; assetKey: string };
    previous: {
      shipping: { sha256: string; bytes: number };
      owner: { batchId?: string };
    };
    replacement: {
      batchId: string;
      acceptedSha256: string;
      acceptedBytes: number;
      generationReport: string;
    };
  }>;
}

interface AbilityMappingEntry {
  abilityId: string;
  sourcePack: string;
  sourceFile: string;
  output: string;
  source?: string;
  owner?: string;
  license?: string;
  references?: ReferenceRecord[];
  generationPrompt?: string;
}

function manifest(): AcceptedArtManifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as AcceptedArtManifest;
}

function itemConsistencyManifest(): ItemConsistencyManifest {
  return JSON.parse(readFileSync(itemConsistencyManifestPath, 'utf8')) as ItemConsistencyManifest;
}

function resolvedShippingPin(asset: RasterAsset): {
  acceptedSha256: string;
  acceptedBytes: number;
} {
  if (asset.kind !== 'item') return asset;
  const replacementManifest = itemConsistencyManifest();
  const supersession = replacementManifest.supersedes.find(({ itemId }) => itemId === asset.id);
  if (!supersession) return asset;

  expect(supersession.historicalAcceptedArt, `${asset.id} historical manifest link`).toEqual({
    path: 'docs/achievements/missing-painted-icons-accepted-art.json',
    assetKey: `item:${asset.id}`,
  });
  expect(supersession.previous.shipping, `${asset.id} immutable historical pin`).toMatchObject({
    sha256: asset.acceptedSha256,
    bytes: asset.acceptedBytes,
  });
  expect(asset.batch, `${asset.id} historical accepted-art batch`).toBeTruthy();
  expect(supersession.previous.owner.batchId, `${asset.id} historical owner`).toBe(asset.batch);
  const replacement = replacementManifest.assets.find(({ id }) => id === asset.id);
  expect(replacement, `${asset.id} replacement asset`).toBeDefined();
  expect(supersession.replacement, `${asset.id} current replacement pin`).toEqual({
    batchId: 'item-art-consistency-2026-08-09',
    acceptedSha256: replacement?.acceptedSha256,
    acceptedBytes: replacement?.acceptedBytes,
    generationReport: replacement?.generationReport,
  });
  return supersession.replacement;
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function publicFile(runtimeUrl: string): string {
  return path.join(repoRoot, 'public', runtimeUrl.replace(/^\//, ''));
}

function expectedAssetLocations(asset: RasterAsset): {
  runtimeUrl: string;
  shippingPath: string;
} {
  let runtimeUrl: string;
  if (asset.kind === 'ability') {
    const ability = ABILITIES[asset.id];
    if (!ability) throw new Error(`manifest ability ${asset.id} is not canonical`);
    runtimeUrl = `/ui/skills/${ability.class}/${asset.id}.webp`;
  } else if (asset.kind === 'item') {
    runtimeUrl = `/ui/items/${asset.id}.webp`;
  } else {
    runtimeUrl = `/ui/deeds/${asset.id}.webp`;
  }
  return { runtimeUrl, shippingPath: `public${runtimeUrl}` };
}

const GENERATED_ABILITY_SOURCE_PACK = 'woc_openai_missing_painted_icons_2026_08_01';
const ALLOWED_REFERENCE_ROLES = [
  'composition reference',
  'frame reference',
  'style reference',
  'subject reference',
] as const;

const PRESERVED_IMAGE_BACKED_MODIFIER_IDS = [
  'anger_management',
  'attack',
  'battle_rhythm',
  'blink_while_casting',
  'bloodbath',
  'colossal_might',
  'combat_mastery',
  'crushing_charge',
  'double_blink',
  'double_charge',
  'elemental_convergence',
  'lingering_dread',
  'overflowing_power',
  'pursuit',
  'second_wind',
  'snap_polymorph',
  'temporal_rift',
  'twin_frost_nova',
  'warded',
] as const;

describe('missing painted icon accepted-art manifest', () => {
  it('pins the complete expanded current-head inventory and every target exactly once', () => {
    expect(existsSync(manifestPath), 'the reviewed-art identity manifest must be committed').toBe(
      true,
    );
    const accepted = manifest();
    expect(accepted.schemaVersion).toBe(1);
    expect(accepted.scope).toEqual({
      targetRows: 209,
      rasterPaintings: 194,
      abilities: 90,
      items: 101,
      deeds: 3,
      heroicWeaponResolvers: 15,
      originalInventoryRows: 197,
      supplementalCurrentHeadRows: 12,
    });
    expect(accepted.assets).toHaveLength(194);
    expect(accepted.assets.filter((asset) => asset.kind === 'ability')).toHaveLength(90);
    expect(accepted.assets.filter((asset) => asset.kind === 'item')).toHaveLength(101);
    expect(accepted.assets.filter((asset) => asset.kind === 'deed')).toHaveLength(3);

    for (const [kind, ids] of Object.entries({
      ability: accepted.targetSets.abilities,
      item: accepted.targetSets.items,
      deed: accepted.targetSets.deeds,
    })) {
      expect(ids).toEqual(sorted(new Set(ids)));
      expect(
        accepted.assets.filter((asset) => asset.kind === kind).map((asset) => asset.id),
      ).toEqual(ids);
    }
    expect(accepted.targetSets.heroicWeaponResolvers).toHaveLength(15);
    expect(accepted.targetSets.heroicWeaponResolvers.map(({ id }) => id)).toEqual(
      sorted(new Set(accepted.targetSets.heroicWeaponResolvers.map(({ id }) => id))),
    );
  });

  it('pins decodable shipping identity, dimensions, alpha, weight and unique art', async () => {
    const accepted = manifest();
    const shippingHashes = new Set<string>();
    const sourceHashes = new Set<string>();
    const masterHashes = new Set<string>();
    const referenceRoles = new Set<string>();
    for (const asset of accepted.assets) {
      expect(asset.acceptedSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.source.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.master.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(shippingHashes.has(asset.acceptedSha256), `${asset.id} shipping hash`).toBe(false);
      expect(sourceHashes.has(asset.source.sha256), `${asset.id} 512px source hash`).toBe(false);
      expect(masterHashes.has(asset.master.sha256), `${asset.id} master hash`).toBe(false);
      shippingHashes.add(asset.acceptedSha256);
      sourceHashes.add(asset.source.sha256);
      masterHashes.add(asset.master.sha256);

      expect(asset.master.path).toMatch(
        /^tmp\/imagegen\/missing-painted-icons\/masters\/(abilities|items|deeds)\//,
      );
      expect(asset.master.width).toBe(asset.master.height);
      expect(asset.master.width).toBeGreaterThanOrEqual(1024);
      expect(asset.master.format).toBe('png');
      expect(asset.master.colourspace).toBe('srgb');
      expect(asset.source.path).toMatch(
        /^tmp\/imagegen\/missing-painted-icons\/accepted\/(abilities|items|deeds)\//,
      );
      expect(asset.source).toMatchObject({ width: 512, height: 512, format: 'png' });
      expect(asset.source.colourspace).toBe('srgb');
      expect(asset.generation).toMatchObject({
        source: 'OpenAI built-in image generation',
        owner: 'World of ClaudeCraft',
      });
      expect(asset.generation.license).toContain('project asset');
      expect(asset.generation.prompt).toBeTruthy();
      expect(asset.generation.references.length).toBeGreaterThanOrEqual(2);
      expect(asset.generation.references.length).toBeLessThanOrEqual(4);
      for (const reference of asset.generation.references) {
        expect(reference.path).toBeTruthy();
        expect(ALLOWED_REFERENCE_ROLES, `${asset.id} reference role`).toContain(reference.role);
        referenceRoles.add(reference.role);
        expect(path.isAbsolute(reference.path), `${asset.id} reference path must be relative`).toBe(
          false,
        );
        expect(reference.path, `${asset.id} reference path must remain in the repo`).toMatch(
          /^(docs|public)\//,
        );
        expect(
          existsSync(path.join(repoRoot, reference.path)),
          `${asset.id} reference ${reference.path} must exist`,
        ).toBe(true);
        expect(reference.provenance).toBeTruthy();
        expect(reference.license).toBeTruthy();
      }

      const expectedLocation = expectedAssetLocations(asset);
      expect(asset.runtimeUrl, `${asset.id} runtime URL`).toBe(expectedLocation.runtimeUrl);
      expect(
        `public${asset.runtimeUrl}`,
        `${asset.id} runtime URL to shipping path relationship`,
      ).toBe(expectedLocation.shippingPath);
      if (asset.kind === 'ability') {
        expect(asset.class, `${asset.id} manifest class`).toBe(ABILITIES[asset.id].class);
      }
      const file = path.join(repoRoot, expectedLocation.shippingPath);
      expect(file).toBe(publicFile(asset.runtimeUrl));
      const bytes = readFileSync(file);
      const currentPin = resolvedShippingPin(asset);
      expect(bytes.length, `${asset.id} accepted byte pin`).toBe(currentPin.acceptedBytes);
      expect(bytes.length, `${asset.id} weight ceiling`).toBeLessThanOrEqual(15 * 1024);
      expect(createHash('sha256').update(bytes).digest('hex'), `${asset.id} hash pin`).toBe(
        currentPin.acceptedSha256,
      );
      const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect(decoded.info.width, `${asset.id} width`).toBe(128);
      expect(decoded.info.height, `${asset.id} height`).toBe(128);
      const alpha = decoded.data.filter((_, index) => index % decoded.info.channels === 3);
      if (asset.kind === 'deed') {
        expect(asset.source.geometry?.alphaThreshold, `${asset.id} source alpha threshold`).toBe(8);
        const sourceBounds = asset.source.geometry?.bounds;
        expect(sourceBounds, `${asset.id} source alpha bounds`).toBeDefined();
        if (sourceBounds) {
          expect(sourceBounds[0], `${asset.id} source left bound`).toBeGreaterThanOrEqual(56);
          expect(sourceBounds[0], `${asset.id} source left bound`).toBeLessThanOrEqual(60);
          expect(sourceBounds[1], `${asset.id} source top bound`).toBeGreaterThanOrEqual(56);
          expect(sourceBounds[1], `${asset.id} source top bound`).toBeLessThanOrEqual(57);
          expect(sourceBounds[2], `${asset.id} source right bound`).toBeGreaterThanOrEqual(452);
          expect(sourceBounds[2], `${asset.id} source right bound`).toBeLessThanOrEqual(455);
          expect(sourceBounds[3], `${asset.id} source bottom bound`).toBeGreaterThanOrEqual(454);
          expect(sourceBounds[3], `${asset.id} source bottom bound`).toBeLessThanOrEqual(455);
        }
        expect(
          asset.source.geometry?.coverage,
          `${asset.id} source visible coverage`,
        ).toBeGreaterThan(0.4);
        expect(asset.source.geometry?.coverage, `${asset.id} source visible coverage`).toBeLessThan(
          0.45,
        );
        const sourceCenterOffset = asset.source.geometry?.centerOffset;
        expect(sourceCenterOffset, `${asset.id} source center`).toBeDefined();
        if (sourceCenterOffset) {
          expect(
            Math.abs(sourceCenterOffset[0]),
            `${asset.id} source horizontal center`,
          ).toBeLessThanOrEqual(0.5);
          expect(
            Math.abs(sourceCenterOffset[1]),
            `${asset.id} source vertical center`,
          ).toBeLessThanOrEqual(0.5);
        }
        expect(
          alpha.some((value) => value === 0),
          `${asset.id} transparent exterior`,
        ).toBe(true);
        expect(
          alpha.some((value) => value === 255),
          `${asset.id} opaque medal`,
        ).toBe(true);
      } else {
        expect(
          alpha.every((value) => value === 255),
          `${asset.id} opaque background`,
        ).toBe(true);
      }
    }
    expect(shippingHashes.size).toBe(194);
    expect(sourceHashes.size).toBe(194);
    expect(masterHashes.size).toBe(194);
    expect(sorted(referenceRoles)).toEqual([...ALLOWED_REFERENCE_ROLES]);
  });
});

describe('missing painted ability integration', () => {
  it('makes every live ability image-backed while preserving all 19 modifier/talent ids', () => {
    const accepted = manifest();
    expect(accepted.targetSets.abilities).toHaveLength(90);
    expect(Object.keys(ABILITIES).filter((id) => !ABILITY_IMAGE_IDS.has(id))).toEqual([]);
    expect(sorted([...ABILITY_IMAGE_IDS].filter((id) => !Object.hasOwn(ABILITIES, id)))).toEqual([
      ...PRESERVED_IMAGE_BACKED_MODIFIER_IDS,
    ]);
    for (const id of accepted.targetSets.abilities) {
      const ability = ABILITIES[id];
      expect(ability, `${id} must remain a live ability`).toBeDefined();
      expect(ABILITY_IMAGE_IDS.has(id), `${id} registry wiring`).toBe(true);
      const url = `/ui/skills/${ability.class}/${id}.webp`;
      expect(abilityImageUrl(id), `${id} ability URL`).toBe(url);
      expect(iconDataUrl('ability', id), `${id} action-bar/spellbook URL`).toBe(url);
      expect(iconDataUrl('aura', id), `${id} buff/debuff reuse URL`).toBe(url);
    }
  });

  it('gives every generated ability an explicit non-CraftPix provenance owner', () => {
    const accepted = manifest();
    const assetById = new Map(
      accepted.assets.filter((asset) => asset.kind === 'ability').map((asset) => [asset.id, asset]),
    );
    const mapped: string[] = [];
    const allEntries: Array<{ className: string; entry: AbilityMappingEntry }> = [];
    for (const className of [
      'druid',
      'hunter',
      'mage',
      'paladin',
      'priest',
      'rogue',
      'shaman',
      'warlock',
      'warrior',
    ]) {
      const mapping = JSON.parse(
        readFileSync(path.join(repoRoot, `public/ui/skills/${className}/mapping.json`), 'utf8'),
      ) as {
        licenseScope?: string;
        abilities: AbilityMappingEntry[];
      };
      expect(mapping.licenseScope).toContain('explicitly override');
      allEntries.push(...mapping.abilities.map((entry) => ({ className, entry })));
      const generated = mapping.abilities.filter(
        (entry) => entry.sourcePack === GENERATED_ABILITY_SOURCE_PACK,
      );
      for (const entry of generated) {
        mapped.push(entry.abilityId);
        const asset = assetById.get(entry.abilityId);
        expect(asset, `${entry.abilityId} manifest owner`).toBeDefined();
        expect(entry.source).toBe('OpenAI built-in image generation');
        expect(entry.owner).toBe('World of ClaudeCraft');
        expect(entry.license).toContain('project asset');
        expect(entry.license).not.toContain('CraftPix');
        expect(entry.sourceFile).toBe(asset?.source.path);
        expect(entry.output).toBe(`${entry.abilityId}.webp`);
        expect(entry.references).toEqual(asset?.generation.references);
        expect(entry.generationPrompt).toBe(asset?.generation.prompt);
      }
    }
    expect(sorted(mapped)).toEqual(accepted.targetSets.abilities);

    const targets = new Set(accepted.targetSets.abilities);
    for (const id of accepted.targetSets.abilities) {
      const owners = allEntries.filter(({ entry }) => entry.abilityId === id);
      expect(owners, `${id} must have exactly one mapping owner`).toHaveLength(1);
      expect(owners[0].entry.sourcePack, `${id} mapping owner`).toBe(GENERATED_ABILITY_SOURCE_PACK);
      expect(owners[0].className, `${id} mapping class`).toBe(ABILITIES[id].class);
    }
    expect(
      allEntries
        .filter(
          ({ entry }) =>
            targets.has(entry.abilityId) && entry.sourcePack !== GENERATED_ABILITY_SOURCE_PACK,
        )
        .map(({ entry }) => entry.abilityId),
      'generated abilities must not also appear as ordinary CraftPix entries',
    ).toEqual([]);
  });
});

describe('missing painted item integration', () => {
  it('empties ITEM_ART_PENDING and serves all 101 targets as painted item art', () => {
    const accepted = manifest();
    expect(accepted.targetSets.items).toHaveLength(101);
    // This wave's own debt must be fully discharged. Scoped to the wave's target
    // set rather than asserting the list is globally empty: a later change may
    // legitimately enumerate NEW art debt (the hunter quivers do), and that must
    // not read as this wave regressing. tests/item_icons.test.ts guard A3 owns
    // the global count.
    expect(accepted.targetSets.items.filter((id) => ITEM_ART_PENDING.has(id))).toEqual([]);
    for (const id of accepted.targetSets.items) {
      expect(ITEMS[id], `${id} must remain a live item`).toBeDefined();
      expect(ITEMS[id].kind, `${id} must not enter the weapon icon lane`).not.toBe('weapon');
      expect(itemImageUrl(id), `${id} painted URL`).toBe(`/ui/items/${id}.webp`);
      expect(iconDataUrl('item', id), `${id} bag/tooltip/reward/vendor URL`).toBe(
        `/ui/items/${id}.webp`,
      );
    }
  });

  it('owns every target exactly once in truthful generated item batches', () => {
    const accepted = manifest();
    const assetById = new Map(
      accepted.assets.filter((asset) => asset.kind === 'item').map((asset) => [asset.id, asset]),
    );
    const mapping = JSON.parse(
      readFileSync(path.join(repoRoot, 'public/ui/items/mapping.json'), 'utf8'),
    ) as {
      entries: Array<{ itemId: string }>;
      generatedBatches: Array<{
        batchId?: string;
        source: string;
        owner?: string;
        license: string;
        styleReference: string;
        styleReferencesByItem?: Record<string, ReferenceRecord[]>;
        commonPrompt: string;
        itemDirections?: Record<string, { generationPrompt: string }>;
        itemIds: string[];
        provenanceRecord?: string;
      }>;
    };
    const targets = new Set(accepted.targetSets.items);
    expect(mapping.entries.filter((entry) => targets.has(entry.itemId))).toEqual([]);
    for (const id of accepted.targetSets.items) {
      const owners = mapping.generatedBatches.filter((batch) => batch.itemIds.includes(id));
      expect(owners, `${id} generated provenance owner`).toHaveLength(1);
      const owner = owners[0];
      const asset = assetById.get(id);
      expect(owner.source).toBe('OpenAI built-in image generation');
      expect(owner.owner).toBe('World of ClaudeCraft');
      expect(owner.license).toContain('project asset');
      expect(owner.styleReference).toBeTruthy();
      expect(owner.commonPrompt).toBeTruthy();
      expect(owner.itemIds).toEqual(sorted(new Set(owner.itemIds)));
      const supersession = itemConsistencyManifest().supersedes.find(({ itemId }) => itemId === id);
      if (supersession) {
        expect(owner.batchId).toBe('item-art-consistency-2026-08-09');
        expect(owner.provenanceRecord).toBe('docs/achievements/item-art-consistency-2026-08-09/');
        expect(supersession.previous.shipping).toMatchObject({
          sha256: asset?.acceptedSha256,
          bytes: asset?.acceptedBytes,
        });
      } else {
        expect(owner.styleReferencesByItem?.[id]).toEqual(asset?.generation.references);
        expect(owner.itemDirections?.[id]?.generationPrompt).toBe(asset?.generation.prompt);
      }
    }
  });
});

describe('missing painted deed and Heroic weapon integration', () => {
  it('leaves only the pinned art-pending deeds without painted art, and records generated crest ownership', () => {
    const accepted = manifest();
    expect(accepted.targetSets.deeds).toEqual([
      'dgn_wildheart_basin',
      'dgn_wildheart_basin_heroic',
      'pvp_card_duel_first_win',
    ]);
    // Later releases appended more deeds after this historical wave. The completion wave now
    // paints those too, so the shared pending set is empty; a future unenumerated artless deed
    // still fails this exhaustive comparison.
    expect(DEED_ORDER).toHaveLength(262);
    expect(DEED_ORDER.filter((id) => !DEED_IMAGE_IDS.has(id))).toEqual([...DEED_ART_PENDING]);
    const credits = readFileSync(path.join(repoRoot, 'CREDITS.md'), 'utf8');
    const provenance = readFileSync(
      path.join(repoRoot, 'docs/achievements/missing-painted-icons-provenance.md'),
      'utf8',
    );
    const creditRows = credits.split('\n');
    const commissionedRow = creditRows.find((line) =>
      line.startsWith('| Book of Deeds achievement icons'),
    );
    const generatedRow = creditRows.find((line) =>
      line.startsWith('| Generated Book of Deeds additions'),
    );
    expect(commissionedRow).toContain('excluding the project-generated additions credited below');
    expect(generatedRow).toContain('World of ClaudeCraft');
    expect(generatedRow).toContain('OpenAI built-in image generation');
    for (const id of accepted.targetSets.deeds) {
      expect(credits, `${id} credits`).toContain(id);
      expect(generatedRow, `${id} generated credit owner`).toContain(`\`${id}\``);
      expect(
        creditRows.filter((line) => line.includes(`\`${id}\``)),
        `${id} must occur in exactly one credit row`,
      ).toHaveLength(1);
      expect(provenance, `${id} full deed lineage`).toContain(id);
      expect(iconDataUrl('crest', `deed_${id}`), `${id} Book/wiki URL`).toBe(
        `/ui/deeds/${id}.webp`,
      );
    }
    // The phase 20 bottom-map chronicle crests ride the professions-tuning
    // provenance doc rather than this wave's manifest; pin their credit and
    // lineage rows the same way (the review round: the "fourteen" count
    // alone would stay green with all six ids deleted from the row).
    const PHASE20_DEED_ART_IDS = [
      'chr_willowfen_gatherer',
      'chr_willowfen_first_cast',
      'chr_galecrest_gatherer',
      'chr_galecrest_first_cast',
      'chr_farshore_gatherer',
      'chr_farshore_first_cast',
    ];
    const tuningProvenance = readFileSync(
      path.join(repoRoot, 'docs/achievements/professions-tuning-art-provenance.md'),
      'utf8',
    );
    for (const id of PHASE20_DEED_ART_IDS) {
      expect(generatedRow, `${id} generated credit owner`).toContain(`\`${id}\``);
      expect(
        creditRows.filter((line) => line.includes(`\`${id}\``)),
        `${id} must occur in exactly one credit row`,
      ).toHaveLength(1);
      expect(tuningProvenance, `${id} prompt/lineage record`).toContain(`\`${id}\``);
    }
  });

  it('keeps the historical Heroic resolver record while serving its base painting today', () => {
    const accepted = manifest();
    const live = Object.values(ITEMS)
      .filter((item) => item.kind === 'weapon' && item.heroicOf)
      .map((item) => item.id)
      .sort();
    expect(accepted.targetSets.heroicWeaponResolvers.map(({ id }) => id)).toEqual(live);
    for (const target of accepted.targetSets.heroicWeaponResolvers) {
      const heroic = ITEMS[target.id];
      const base = ITEMS[target.baseId];
      expect(heroic?.kind, `${target.id} must remain a canonical weapon`).toBe('weapon');
      expect(heroic?.heroicOf, `${target.id} canonical heroicOf`).toBe(target.baseId);
      expect(base?.kind, `${target.id} base ${target.baseId} must remain a weapon`).toBe('weapon');
      expect(Object.hasOwn(ITEM_WEAPON_VARIANTS, target.id), target.id).toBe(false);
      expect(Object.hasOwn(ITEM_WEAPON_VARIANTS, target.baseId), target.baseId).toBe(true);
      expect(ITEM_WEAPON_VARIANTS[target.baseId]).toBe(target.variant);
      expect(target.bagIconUrl).toBe(`/ui/weapons/${target.variant}.jpg`);
      expect(target.portraitPath).toBe(`public/ui/weapons/${target.variant}.jpg`);
      expect(target.heldModelPath).toBe(`public/models/weapons/${target.variant}.glb`);
      expect(existsSync(path.join(repoRoot, target.portraitPath))).toBe(true);
      expect(existsSync(path.join(repoRoot, target.heldModelPath))).toBe(true);
      // The accepted-art manifest is immutable historical evidence of the old JPG lane. The
      // current runtime intentionally supersedes only its bag/portrait URL with base-id art;
      // the held model and legacy preview remain available to rendering/tooling.
      expect(weaponIconUrl(target.id)).toBe(`/ui/items/${target.baseId}.webp`);
      expect(iconDataUrl('item', target.id)).toBe(`/ui/items/${target.baseId}.webp`);
      expect(itemWeaponModelUrl(target.id)).toBe(`models/weapons/${target.variant}.glb`);
      expect(iconDataUrl('item', target.id)).toBe(iconDataUrl('item', target.baseId));
    }
  });
});
