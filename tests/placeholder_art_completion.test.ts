import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditIconAssets, validateAcceptedArtManifest } from '../scripts/lib/icon_asset_audit.mjs';
import { ALL_CLASSES } from '../src/sim/types';
import { FAMILY_CREST_ART_IDS, STATUS_CREST_ART_IDS } from '../src/ui/crest_icon_art';
import { DEED_IMAGE_IDS } from '../src/ui/deed_image_ids';
import { SPEC_ART_IDS } from '../src/ui/spec_icon_art';
import { ITEM_WEAPON_VARIANTS } from '../src/ui/weapon_variants';

const repoRoot = path.join(__dirname, '..');
const evidenceDir = 'docs/achievements/placeholder-art-completion-2026-08-09';
const manifestPath = path.join(repoRoot, evidenceDir, 'accepted-art.json');
const itemConsistencyManifestPath = path.join(
  repoRoot,
  'docs/achievements/item-art-consistency-2026-08-09/accepted-art.json',
);

const COMPLETION_DEED_IDS = [
  'chr_amberfall_first_cast',
  'chr_amberfall_gatherer',
  'chr_drakemaw_broodlord',
  'chr_evergarden_first_cast',
  'chr_evergarden_gatherer',
  'chr_frostveil_first_cast',
  'chr_frostveil_gatherer',
  'chr_maw_matriarch',
  'chr_nightbloom_first_cast',
  'chr_nightbloom_gatherer',
  'chr_palmreach_first_cast',
  'chr_palmreach_gatherer',
  'chr_wraithwood_first_cast',
  'chr_wraithwood_gatherer',
  'dgn_rift',
  'dgn_rift_s_rank',
  'prog_alchemy_rare',
  'prog_armorcrafting_rare',
  'prog_cooking_rare',
  'prog_engineering_rare',
  'prog_leatherworking_rare',
  'prog_tailoring_rare',
  'prog_weaponcrafting_rare',
  'pvp_bg_captures_100',
  'pvp_bg_first_capture',
  'pvp_bg_first_win',
  'pvp_bg_wins_25',
  'pvp_honor_field_marshal',
  'pvp_honor_knight_lieutenant',
  'pvp_honor_sergeant',
] as const;

const CLEANUP_ITEM_IDS = ['curved_tusk', 'firebottle', 'pristine_claw', 'sharp_claw'] as const;

const RERENDERED_PORTRAIT_IDS = [
  'bogtoad',
  'breach_wretch',
  'castaway_navigator',
  'cindraleth_maw_matriarch',
  'downs_bandit',
  'drowsy_croaker',
  'fen_sprite',
  'fisher_bram',
  'gravedigger_mosley',
  'grubjaw',
  'harvest_sprite',
  'hedge_gnome',
  'mere_lurker',
  'the_meredark',
  'the_wreck_warden',
  'training_dummy',
  'willow_sprite',
  'wreck_thief',
] as const;

type TargetSets = {
  deeds: string[];
  weaponItems: string[];
  itemCleanup: string[];
  generatedSpecializations: string[];
  convertedSpecializations: string[];
  preexistingSpecializations: string[];
  generatedFamilyCrests: string[];
  generatedStatusCrests: string[];
  reusedClassCrests: string[];
  rerenderedMobPortraits: string[];
};

type ManifestAsset = {
  kind: 'item' | 'deed';
  id: string;
  runtimeUrl: string;
  acceptedSha256: string;
  acceptedBytes: number;
};

type SupplementalAsset = {
  kind: 'specialization' | 'familyCrest' | 'statusCrest' | 'classCrest' | 'mobPortrait';
  id: string;
  runtimeUrl: string;
  acceptedSha256: string;
  acceptedBytes: number;
  origin: 'generated' | 'converted-existing' | 'reused-existing' | 'deterministic-rerender';
};

type CompletionManifest = {
  schemaVersion: 1;
  batch: {
    id: string;
    acceptedDate: string;
    rasterGenerator: string;
    owner: string;
    license: string;
  };
  scope: Record<string, number>;
  contracts: Record<string, unknown>;
  targetSets: TargetSets;
  promptDocuments: Record<string, string[]>;
  evidenceDocuments: Array<{
    path: string;
    acceptedSha256: string;
    acceptedBytes: number;
  }>;
  sourceManifests: Array<{
    path: string;
    acceptedSha256: string;
    acceptedBytes: number;
  }>;
  assets: ManifestAsset[];
  supplementalAssets: SupplementalAsset[];
  [key: string]: unknown;
};

type ItemConsistencyManifest = {
  assets: Array<{
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
};

const sorted = (values: Iterable<string>): string[] => [...values].sort();

function manifest(): CompletionManifest {
  expect(existsSync(manifestPath), 'completion accepted-art manifest must be committed').toBe(true);
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as CompletionManifest;
}

function itemConsistencyManifest(): ItemConsistencyManifest {
  return JSON.parse(readFileSync(itemConsistencyManifestPath, 'utf8')) as ItemConsistencyManifest;
}

function assertPinnedFile(asset: {
  runtimeUrl: string;
  acceptedSha256: string;
  acceptedBytes: number;
}): void {
  const file = path.join(repoRoot, 'public', asset.runtimeUrl.slice(1));
  expect(existsSync(file), asset.runtimeUrl).toBe(true);
  const bytes = readFileSync(file);
  expect(bytes.length, `${asset.runtimeUrl} bytes`).toBe(asset.acceptedBytes);
  expect(createHash('sha256').update(bytes).digest('hex'), `${asset.runtimeUrl} sha256`).toBe(
    asset.acceptedSha256,
  );
}

function resolvedCompletionAssetPin(asset: ManifestAsset): {
  acceptedSha256: string;
  acceptedBytes: number;
} {
  const replacementManifest = itemConsistencyManifest();
  const supersession = replacementManifest.supersedes.find(({ itemId }) => itemId === asset.id);
  if (!supersession) return asset;

  expect(supersession.historicalAcceptedArt, `${asset.id} historical manifest link`).toEqual({
    path: `${evidenceDir}/accepted-art.json`,
    assetKey: `item:${asset.id}`,
  });
  expect(supersession.previous.shipping, `${asset.id} immutable historical pin`).toMatchObject({
    sha256: asset.acceptedSha256,
    bytes: asset.acceptedBytes,
  });
  expect(supersession.previous.owner.batchId, `${asset.id} historical owner`).toBe(
    'placeholder-art-completion-weapons-2026-08-09',
  );
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

function assertHistoricalOrSupersededFile(asset: ManifestAsset): void {
  const file = path.join(repoRoot, 'public', asset.runtimeUrl.slice(1));
  expect(existsSync(file), asset.runtimeUrl).toBe(true);
  const bytes = readFileSync(file);
  const currentPin = resolvedCompletionAssetPin(asset);
  expect(bytes.length, `${asset.runtimeUrl} bytes`).toBe(currentPin.acceptedBytes);
  expect(createHash('sha256').update(bytes).digest('hex'), `${asset.runtimeUrl} sha256`).toBe(
    currentPin.acceptedSha256,
  );
}

function supplementalRuntimeUrl(asset: SupplementalAsset): string {
  switch (asset.kind) {
    case 'specialization':
      return `/ui/specs/${asset.id}.webp`;
    case 'familyCrest':
      return `/ui/crests/families/${asset.id}.webp`;
    case 'statusCrest':
      return `/ui/crests/status/${asset.id}.webp`;
    case 'classCrest':
      return `/ui/classes/${asset.id.slice('class_'.length)}.webp`;
    case 'mobPortrait':
      return `/ui/mobs/${asset.id}.webp`;
  }
}

describe('v0.36 placeholder-art completion evidence', () => {
  it('pins the accepted batch identity, exact scope, and shipping contracts', () => {
    const value = manifest();
    expect(value.batch).toEqual({
      id: 'placeholder-art-completion-2026-08-09',
      acceptedDate: '2026-08-09',
      rasterGenerator: 'OpenAI built-in image generation',
      owner: 'World of ClaudeCraft',
      license: 'World of ClaudeCraft project-generated art, project asset, rights reserved',
    });
    expect(value.scope).toEqual({
      auditedPaintings: 153,
      weaponPaintings: 119,
      deedPaintings: 30,
      cleanupItemPaintings: 4,
      generatedSpecializationPaintings: 21,
      convertedSpecializationPaintings: 3,
      preexistingSpecializationPaintings: 3,
      generatedFamilyCrests: 13,
      generatedStatusCrests: 4,
      reusedClassCrests: 9,
      deterministicPortraitRerenders: 18,
    });
    expect(value.contracts).toEqual({
      item: { width: 128, height: 128, maxBytes: 15_360, alpha: 'opaque' },
      deed: {
        width: 128,
        height: 128,
        maxBytes: 15_360,
        alpha: 'transparent-subject',
        geometry: {
          alphaThreshold: 8,
          minPadding: 7,
          maxCenterOffset: 2,
          coverageMin: 0.35,
          coverageMax: 0.6,
        },
      },
    });
  });

  it('pins the complete audited inventory against live registries', () => {
    const targets = manifest().targetSets;
    expect(targets.deeds).toEqual([...COMPLETION_DEED_IDS]);
    expect(targets.deeds.every((id) => DEED_IMAGE_IDS.has(id))).toBe(true);
    expect(targets.weaponItems).toEqual(sorted(Object.keys(ITEM_WEAPON_VARIANTS)));
    expect(targets.itemCleanup).toEqual([...CLEANUP_ITEM_IDS]);

    const generatedSpecs = sorted(
      [...SPEC_ART_IDS].filter((id) => !id.startsWith('mage/') && !id.startsWith('warrior/')),
    );
    expect(targets.generatedSpecializations).toEqual(generatedSpecs);
    expect(targets.convertedSpecializations).toEqual(['mage/arcane', 'mage/fire', 'mage/frost']);
    expect(targets.preexistingSpecializations).toEqual([
      'warrior/arms',
      'warrior/fury',
      'warrior/prot',
    ]);
    expect(
      sorted([
        ...targets.generatedSpecializations,
        ...targets.convertedSpecializations,
        ...targets.preexistingSpecializations,
      ]),
    ).toEqual(sorted(SPEC_ART_IDS));

    expect(targets.generatedFamilyCrests).toEqual(sorted(FAMILY_CREST_ART_IDS));
    expect(targets.generatedStatusCrests).toEqual(sorted(STATUS_CREST_ART_IDS));
    expect(targets.reusedClassCrests).toEqual(sorted(ALL_CLASSES.map((cls) => `class_${cls}`)));
    expect(targets.rerenderedMobPortraits).toEqual([...RERENDERED_PORTRAIT_IDS]);
  });

  it('is a valid accepted-art audit manifest with exact shipping pins', async () => {
    const value = manifest();
    expect(() => validateAcceptedArtManifest(value)).not.toThrow();

    const expected = [
      ...value.targetSets.weaponItems.map((id) => `item:${id}`),
      ...value.targetSets.itemCleanup.map((id) => `item:${id}`),
      ...value.targetSets.deeds.map((id) => `deed:${id}`),
    ].sort();
    expect(value.assets.map((asset) => `${asset.kind}:${asset.id}`).sort()).toEqual(expected);
    for (const asset of value.assets) {
      expect(asset.runtimeUrl, `${asset.kind}:${asset.id} canonical URL`).toBe(
        `/ui/${asset.kind === 'item' ? 'items' : 'deeds'}/${asset.id}.webp`,
      );
      assertHistoricalOrSupersededFile(asset);
    }

    const currentManifest = structuredClone(value);
    let resolvedSupersessions = 0;
    for (const asset of currentManifest.assets) {
      const resolved = resolvedCompletionAssetPin(asset);
      if (resolved.acceptedSha256 === asset.acceptedSha256) continue;
      resolvedSupersessions += 1;
      asset.acceptedSha256 = resolved.acceptedSha256;
      asset.acceptedBytes = resolved.acceptedBytes;
    }
    expect(resolvedSupersessions).toBe(4);
    const report = await auditIconAssets({ manifest: currentManifest, repoRoot });
    expect(report.summary).toMatchObject({
      ok: true,
      assetCount: 153,
      issueCount: 0,
      exactDuplicateGroupCount: 0,
    });
    expect(report.exactDuplicates).toEqual([]);
    expect(report.assets.every((asset) => asset.issues.length === 0)).toBe(true);
  });

  it('pins every generated, converted, reused, and deterministically rerendered companion asset', () => {
    const value = manifest();
    const expected = [...SPEC_ART_IDS].map((id) => `specialization:${id}`);
    expected.push(
      ...[...FAMILY_CREST_ART_IDS].map((id) => `familyCrest:${id}`),
      ...[...STATUS_CREST_ART_IDS].map((id) => `statusCrest:${id}`),
      ...ALL_CLASSES.map((id) => `classCrest:class_${id}`),
      ...RERENDERED_PORTRAIT_IDS.map((id) => `mobPortrait:${id}`),
    );
    expect(value.supplementalAssets.map((asset) => `${asset.kind}:${asset.id}`).sort()).toEqual(
      expected.sort(),
    );
    expect(new Set(value.supplementalAssets.map((asset) => asset.runtimeUrl)).size).toBe(
      value.supplementalAssets.length,
    );
    for (const asset of value.supplementalAssets) {
      expect(asset.runtimeUrl, `${asset.kind}:${asset.id} canonical URL`).toBe(
        supplementalRuntimeUrl(asset),
      );
      assertPinnedFile(asset);
    }

    const originByKey = new Map(
      value.supplementalAssets.map((asset) => [`${asset.kind}:${asset.id}`, asset.origin]),
    );
    for (const id of value.targetSets.generatedSpecializations) {
      expect(originByKey.get(`specialization:${id}`), id).toBe('generated');
    }
    for (const id of value.targetSets.convertedSpecializations) {
      expect(originByKey.get(`specialization:${id}`), id).toBe('converted-existing');
    }
    for (const id of value.targetSets.preexistingSpecializations) {
      expect(originByKey.get(`specialization:${id}`), id).toBe('reused-existing');
    }
    for (const id of value.targetSets.reusedClassCrests) {
      expect(originByKey.get(`classCrest:${id}`), id).toBe('reused-existing');
    }
    for (const id of value.targetSets.generatedFamilyCrests) {
      expect(originByKey.get(`familyCrest:${id}`), id).toBe('generated');
    }
    for (const id of value.targetSets.generatedStatusCrests) {
      expect(originByKey.get(`statusCrest:${id}`), id).toBe('generated');
    }
    for (const id of value.targetSets.rerenderedMobPortraits) {
      expect(originByKey.get(`mobPortrait:${id}`), id).toBe('deterministic-rerender');
    }
  });

  it('keeps every generated identity in tracked prompt or deterministic-render evidence', () => {
    const value = manifest();
    const promptPaths = sorted(new Set(Object.values(value.promptDocuments).flat()));
    expect(sorted(value.evidenceDocuments.map((document) => document.path))).toEqual(promptPaths);
    for (const document of value.evidenceDocuments) {
      const file = path.join(repoRoot, document.path);
      expect(existsSync(file), document.path).toBe(true);
      const bytes = readFileSync(file);
      expect(bytes.length, `${document.path} bytes`).toBe(document.acceptedBytes);
      expect(createHash('sha256').update(bytes).digest('hex'), `${document.path} sha256`).toBe(
        document.acceptedSha256,
      );
    }
    const evidenceFor = (key: string): string => {
      const documents = value.promptDocuments[key];
      expect(documents, `${key} prompt documents`).toBeDefined();
      expect(documents.length, `${key} prompt documents`).toBeGreaterThan(0);
      return documents
        .map((relative) => {
          expect(relative.startsWith(`${evidenceDir}/`), relative).toBe(true);
          const file = path.join(repoRoot, relative);
          expect(existsSync(file), relative).toBe(true);
          return readFileSync(file, 'utf8');
        })
        .join('\n');
    };

    for (const [key, ids] of [
      ['deeds', value.targetSets.deeds],
      ['weaponItems', value.targetSets.weaponItems],
      ['itemCleanup', value.targetSets.itemCleanup],
      ['generatedSpecializations', value.targetSets.generatedSpecializations],
      [
        'generatedCrests',
        [...value.targetSets.generatedFamilyCrests, ...value.targetSets.generatedStatusCrests],
      ],
      ['rerenderedMobPortraits', value.targetSets.rerenderedMobPortraits],
    ] as const) {
      const evidence = evidenceFor(key);
      for (const id of ids) expect(evidence, `${key}:${id}`).toContain(id);
    }
  });

  it('pins the complete mob portrait source-to-output freshness ledger', () => {
    const value = manifest();
    expect(value.sourceManifests).toHaveLength(1);
    expect(value.sourceManifests[0].path).toBe(`${evidenceDir}/mob-portrait-source-manifest.json`);
    for (const document of value.sourceManifests) {
      const file = path.join(repoRoot, document.path);
      const bytes = readFileSync(file);
      expect(bytes.length, `${document.path} bytes`).toBe(document.acceptedBytes);
      expect(createHash('sha256').update(bytes).digest('hex'), `${document.path} sha256`).toBe(
        document.acceptedSha256,
      );
    }
  });

  it('links the operative art brief and scoped media credits to the completion record', () => {
    const credits = readFileSync(path.join(repoRoot, 'CREDITS.md'), 'utf8');
    expect(credits).toContain(evidenceDir);
    expect(credits).toContain('v0.36 placeholder-art completion Book of Deeds additions');
    expect(credits).toContain(
      'Thirty original crests generated with OpenAI built-in image generation',
    );
    expect(credits).toContain('Historical v0.36 painted per-item weapon inventory wave');
    expect(credits).toContain('119 base-weapon paintings');
    expect(credits).toContain('v0.36 generated specialization emblems');
    expect(credits).toContain('Twenty-one original square emblems generated');
    expect(credits).toContain('v0.36 generated creature-family and status crests');
    expect(credits).toContain('Thirteen original family crests and four original status crests');
    expect(credits).toContain(
      'the four v0.36 replacements retain exact prompts, ordered reference roles, hashes, and processing',
    );
    expect(credits).toContain('Deterministically corrected mob target portraits');
    expect(credits).toContain('replaces eighteen stale portraits');

    const brief = readFileSync(path.join(repoRoot, 'docs/achievements/icon-brief.md'), 'utf8');
    expect(brief).toContain('every live deed now has committed painted art');
    expect(brief).toMatch(/The final 30-crested\s*>\s*completion wave/);
    expect(brief).toContain('placeholder-art-completion-2026-08-09/README.md');
    expect(brief).toContain('placeholder-art-completion-2026-08-09/accepted-art.json');
  });
});
