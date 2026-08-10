import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { auditIconAssets, validateAcceptedArtManifest } from '../scripts/lib/icon_asset_audit.mjs';
import { ITEM_ART_AUDIT_RENDERER_FINGERPRINT } from '../scripts/lib/item_art_audit.mjs';
import { ITEMS } from '../src/sim/data';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = 'docs/achievements/item-art-consistency-2026-08-09';
const manifestPath = path.join(repoRoot, evidenceDir, 'accepted-art.json');
const BATCH_ID = 'item-art-consistency-2026-08-09';
const LICENSE = 'World of ClaudeCraft project-generated art, project asset, rights reserved';

type ReportPin = {
  chunk: string;
  path: string;
  acceptedSha256: string;
  acceptedBytes: number;
  itemIds: string[];
};

type ReplacementAsset = {
  kind: 'item';
  id: string;
  batch: string;
  runtimeUrl: string;
  acceptedSha256: string;
  acceptedBytes: number;
  generationReport: string;
};

type SupersessionRecord = {
  itemId: string;
  historicalAcceptedArt?: {
    path: string;
    assetKey: string;
  };
  previous: {
    shipping: {
      commit: string;
      sha256: string;
      bytes: number;
    };
    provenanceClass: string;
    owner: Record<string, unknown>;
  };
  replacementReason: string;
  replacement: {
    batchId: string;
    acceptedSha256: string;
    acceptedBytes: number;
    generationReport: string;
  };
};

type ItemArtConsistencyManifest = {
  schemaVersion: 1;
  batch: {
    id: string;
    acceptedDate: string;
    rasterGenerator: string;
    owner: string;
    license: string;
    styleContractId: string;
  };
  scope: {
    itemPaintings: number;
    formerCraftPixIdentityReferences: number;
    formerMountRenderIdentityReferences: number;
    formerGeneratedPaintings: number;
    generationReports: number;
  };
  supersessionAuditAdditions: Array<{
    id: string;
    preTaskShipping: SupersessionRecord['previous']['shipping'];
    oldProvenanceClass: string;
    oldProvenanceOwner: Record<string, unknown>;
  }>;
  contracts: {
    item: {
      width: number;
      height: number;
      maxBytes: number;
      alpha: 'opaque';
    };
  };
  styleContract: {
    id: string;
    document: string;
  };
  sourceEvidence: Array<{
    path: string;
    acceptedSha256: string;
    acceptedBytes: number;
  }>;
  generationReports: ReportPin[];
  targetSets: {
    items: string[];
    formerCraftPixIdentityReferences: string[];
    formerMountRenderIdentityReferences: string[];
    formerGeneratedPaintings: string[];
  };
  assets: ReplacementAsset[];
  supersedes: SupersessionRecord[];
};

type ItemMapping = {
  license?: string;
  note: string;
  entries: Array<{ itemId: string; license?: string }>;
  generatedBatches: Array<{
    batchId?: string;
    source: string;
    owner?: string;
    license: string;
    styleReference: string;
    styleContract?: { id: string; document: string };
    commonPrompt: string;
    provenanceRecord?: string;
    provenanceRecords?: string[];
    itemIds: string[];
  }>;
};

type FinalAuditShippingPin = {
  id: string;
  path: string;
  sha256: string;
  bytes: number;
};

type FinalAuditVerdict = {
  schemaVersion: 1;
  generatedAt: string;
  auditScope: {
    baselineCommit: string;
    branch: string;
    shippingDirectory: string;
    itemArtFilesReviewed: number;
    liveItemDefinitions: number;
    generatedHeroicDefinitions: number;
    heroicDefinitionsWithOwnWebp: number;
    heroicWeaponArtAliases: number;
    modifiedItemArtCount: number;
    modifiedItemArtPaths: string[];
    groups: Record<string, number>;
  };
  reviewContract: {
    everyShippingFileReviewedInModes: string[];
  };
  machineChecks: {
    passed: boolean;
    requiredDimensions: number[];
    requiredFormat: string;
    requiredColorspace: string;
    requiredOpaque: boolean;
    maximumBytes: number;
    invalidIds: string[];
    duplicateHashGroups: unknown[];
  };
  visualVerdict: {
    status: string;
    passCount: number;
    passIds: string[];
    watchCount: number;
    watch: unknown[];
    rejectCount: number;
    reject: unknown[];
    summary: string;
  };
  nonVisualContentWatch: Array<{
    id: string;
    severity: string;
    reason: string;
    recommendation: string;
  }>;
  resolvedDuringAudit: Array<{
    ids: string[];
    finalDisposition: string;
    finalShipping: FinalAuditShippingPin[];
  }>;
  evidence: {
    catalog: { path: string; sha256: string; bytes: number };
    rendererFingerprint: string;
    sheetCount: number;
    sheetModeCounts: Record<string, number>;
    sheetSetSha256: string;
    sheets: Array<{
      path: string;
      sha256: string;
      bytes: number;
      width: number;
      height: number;
      format: string;
    }>;
    shippingCatalogSha256: string;
  };
};

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const sorted = (values: Iterable<string>): string[] => [...values].sort();

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8')) as T;
}

function manifest(): ItemArtConsistencyManifest {
  expect(existsSync(manifestPath), 'item-art consistency accepted-art manifest').toBe(true);
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as ItemArtConsistencyManifest;
}

function duplicateValues(values: string[]): string[] {
  return sorted(new Set(values.filter((value, index) => values.indexOf(value) !== index)));
}

function requireSameIds(label: string, left: string[], right: string[]): void {
  const leftSorted = sorted(left);
  const rightSorted = sorted(right);
  if (JSON.stringify(leftSorted) !== JSON.stringify(rightSorted)) {
    throw new Error(`${label} must name the same item IDs`);
  }
}

function validateSupersessionGraph(value: ItemArtConsistencyManifest): void {
  const targetIds = value.targetSets.items;
  const assetIds = value.assets.map(({ id }) => id);
  const supersededIds = value.supersedes.map(({ itemId }) => itemId);
  const reportIds = value.generationReports.flatMap(({ itemIds }) => itemIds);

  for (const [label, ids] of [
    ['targetSets.items', targetIds],
    ['assets', assetIds],
    ['supersedes', supersededIds],
    ['generationReports.itemIds', reportIds],
  ] as const) {
    const duplicates = duplicateValues(ids);
    if (duplicates.length > 0)
      throw new Error(`${label} has duplicate IDs: ${duplicates.join(', ')}`);
  }
  const assetById = new Map(value.assets.map((asset) => [asset.id, asset]));
  for (const record of value.supersedes) {
    if (!assetById.has(record.itemId)) {
      throw new Error(`dangling supersession record ${record.itemId}`);
    }
  }
  requireSameIds('assets and targetSets.items', assetIds, targetIds);
  requireSameIds('supersedes and targetSets.items', supersededIds, targetIds);
  requireSameIds('generation reports and targetSets.items', reportIds, targetIds);

  for (const record of value.supersedes) {
    const asset = assetById.get(record.itemId);
    if (!asset) throw new Error(`dangling supersession record ${record.itemId}`);
    if (record.replacement.batchId !== value.batch.id) {
      throw new Error(`${record.itemId} replacement batch does not match the manifest batch`);
    }
    if (
      record.replacement.acceptedSha256 !== asset.acceptedSha256 ||
      record.replacement.acceptedBytes !== asset.acceptedBytes ||
      record.replacement.generationReport !== asset.generationReport
    ) {
      throw new Error(`${record.itemId} replacement pins do not match its accepted asset`);
    }
    if (record.previous.shipping.sha256 === record.replacement.acceptedSha256) {
      throw new Error(`${record.itemId} did not replace its previous shipping bytes`);
    }
    if (!record.replacementReason.trim()) {
      throw new Error(`${record.itemId} needs a replacement reason`);
    }
  }
}

function reportShipping(record: Record<string, unknown>): Record<string, unknown> {
  const shippingRecord = record.shipping;
  const shipping =
    shippingRecord && typeof shippingRecord === 'object' && !Array.isArray(shippingRecord)
      ? ((shippingRecord as Record<string, unknown>).public ?? shippingRecord)
      : record.final;
  if (!shipping || typeof shipping !== 'object' || Array.isArray(shipping)) {
    throw new Error(`report record ${String(record.id)} has no shipping or final record`);
  }
  return shipping as Record<string, unknown>;
}

describe('item-art consistency accepted-art provenance', () => {
  it('pins the exact scope, style contract, and byte-identical generation reports', () => {
    const value = manifest();
    expect(() => validateAcceptedArtManifest(value)).not.toThrow();
    expect(value.batch).toEqual({
      id: BATCH_ID,
      acceptedDate: '2026-08-09',
      rasterGenerator: 'OpenAI built-in image generation',
      owner: 'World of ClaudeCraft',
      license: LICENSE,
      styleContractId: 'woc-item-icon-v1',
    });
    expect(value.scope).toEqual({
      itemPaintings: 274,
      formerCraftPixIdentityReferences: 255,
      formerMountRenderIdentityReferences: 9,
      formerGeneratedPaintings: 10,
      generationReports: 9,
    });
    expect(value.contracts).toEqual({
      item: { width: 128, height: 128, maxBytes: 15_360, alpha: 'opaque' },
    });
    expect(value.styleContract).toEqual({
      id: 'woc-item-icon-v1',
      document: 'docs/design/item-icon-art-style.md',
    });
    expect(value.targetSets.items).toHaveLength(274);
    expect(value.targetSets.formerCraftPixIdentityReferences).toHaveLength(255);
    expect(value.targetSets.formerMountRenderIdentityReferences).toHaveLength(9);
    expect(value.targetSets.formerGeneratedPaintings).toHaveLength(10);
    expect(value.targetSets.items).toEqual(sorted(new Set(value.targetSets.items)));
    expect(value.assets.map(({ id }) => id)).toEqual(value.targetSets.items);
    expect(value.supersedes.map(({ itemId }) => itemId)).toEqual(value.targetSets.items);
    expect(
      sorted([
        ...value.targetSets.formerCraftPixIdentityReferences,
        ...value.targetSets.formerMountRenderIdentityReferences,
        ...value.targetSets.formerGeneratedPaintings,
      ]),
    ).toEqual(value.targetSets.items);

    expect(value.sourceEvidence).toEqual([
      {
        path: `${evidenceDir}/supersession-audit.json`,
        acceptedSha256: '1277db8f1d4257c412b40c3db1e9f096d0b6544e6019b2dfbe7b56f775faf094',
        acceptedBytes: 294_428,
      },
      {
        path: `${evidenceDir}/final-item-art-audit-verdict.json`,
        acceptedSha256: '9e2fbd243f2a40f9cdf6c6bd49fc16634ebc4cb2498880ff2e8063adff627b9f',
        acceptedBytes: 106_998,
      },
    ]);
    for (const evidence of [...value.sourceEvidence, ...value.generationReports]) {
      const bytes = readFileSync(path.join(repoRoot, evidence.path));
      expect(bytes.length, `${evidence.path} bytes`).toBe(evidence.acceptedBytes);
      expect(sha256(bytes), `${evidence.path} sha256`).toBe(evidence.acceptedSha256);
    }

    expect(
      value.generationReports.map(
        ({ chunk, path: reportPath, acceptedSha256, acceptedBytes, itemIds }) => ({
          chunk,
          path: reportPath,
          acceptedSha256,
          acceptedBytes,
          itemCount: itemIds.length,
        }),
      ),
    ).toEqual([
      {
        chunk: 'A',
        path: `${evidenceDir}/chunk-a-generation-report.json`,
        acceptedSha256: '2133e446fd170e6e6382c3ddddef24795ae69b20df8ebec9dd973cdf3d6c8ded',
        acceptedBytes: 587_553,
        itemCount: 45,
      },
      {
        chunk: 'B',
        path: `${evidenceDir}/chunk-b-generation-report.json`,
        acceptedSha256: '1ea2f46ece8ef41809302cf159556cdee08ce62ecb05aff7420ff70a6b0447f3',
        acceptedBytes: 738_345,
        itemCount: 45,
      },
      {
        chunk: 'C',
        path: `${evidenceDir}/chunk-c-generation-report.json`,
        acceptedSha256: '0f45e6a5ff56de805f3b535056682a5f64c4d03c941d79bf152d996e3c5f597e',
        acceptedBytes: 427_443,
        itemCount: 45,
      },
      {
        chunk: 'D',
        path: `${evidenceDir}/chunk-d-generation-report.json`,
        acceptedSha256: '2fc4c64159c83830910c92143f22c384d7b878bc31388a5c036fb09aeb0856bb',
        acceptedBytes: 609_056,
        itemCount: 44,
      },
      {
        chunk: 'E',
        path: `${evidenceDir}/chunk-e-generation-report.json`,
        acceptedSha256: '45abd0d3e40f743b1327d9ecc9b07656c9f107175a15e44d6c652f050d5aaed3',
        acceptedBytes: 695_492,
        itemCount: 44,
      },
      {
        chunk: 'F-main',
        path: `${evidenceDir}/chunk-f-main-generation-report.json`,
        acceptedSha256: '76b3fa86d05ba4a2dbf448e4639daa88eea646cef5bbf90bd4e11a59bca1d9e6',
        acceptedBytes: 583_735,
        itemCount: 34,
      },
      {
        chunk: 'F-tail',
        path: `${evidenceDir}/chunk-f-tail-generation-report.json`,
        acceptedSha256: '9b99a60216133745bb81675dd1941d63354cdcffb558edf6d9319bc61e647975',
        acceptedBytes: 135_422,
        itemCount: 10,
      },
      {
        chunk: 'G',
        path: `${evidenceDir}/chunk-g-generation-report.json`,
        acceptedSha256: '74276c1c09f025d58955831eb1a98368e9aa33b8f7ccbfcc8214dee5dbe842e9',
        acceptedBytes: 29_063,
        itemCount: 5,
      },
      {
        chunk: 'H',
        path: `${evidenceDir}/chunk-h-generation-report.json`,
        acceptedSha256: '5dd78c610532b28780091238c9bd1ad3df4e4cc31261dba38fd36b204144617e',
        acceptedBytes: 13_777,
        itemCount: 2,
      },
    ]);
    const assetById = new Map(value.assets.map((asset) => [asset.id, asset]));
    for (const reportPin of value.generationReports) {
      const report = readJson<{ records: Array<Record<string, unknown>> }>(reportPin.path);
      const reportIds = report.records.map(({ id }) => String(id));
      expect(reportIds, `${reportPin.chunk} report ids`).toEqual(reportPin.itemIds);
      for (const record of report.records) {
        const id = String(record.id);
        const shipping = reportShipping(record);
        const asset = assetById.get(id);
        expect(asset, `${reportPin.chunk}:${id} accepted asset`).toBeDefined();
        expect(asset?.generationReport).toBe(reportPin.path);
        expect(shipping.path, `${reportPin.chunk}:${id} shipping path`).toBe(
          `public/ui/items/${id}.webp`,
        );
        expect(shipping.sha256, `${reportPin.chunk}:${id} shipping hash`).toBe(
          asset?.acceptedSha256,
        );
        expect(shipping.bytes, `${reportPin.chunk}:${id} shipping bytes`).toBe(
          asset?.acceptedBytes,
        );
      }
    }
  });

  it('pins the final 817-item visual audit, Heroic accounting, and evidence digests', () => {
    const verdictPath = `${evidenceDir}/final-item-art-audit-verdict.json`;
    const readme = readFileSync(path.join(repoRoot, evidenceDir, 'README.md'), 'utf8');
    expect(readme).toContain('`final-item-art-audit-verdict.json`');
    expect(readme).toContain('node scripts/item_art_audit.mjs\n');
    expect(readme).toContain('node scripts/item_art_audit.mjs --refresh-verdict');
    const verdictBytes = readFileSync(path.join(repoRoot, verdictPath));
    expect(verdictBytes.length).toBe(106_998);
    expect(sha256(verdictBytes)).toBe(
      '9e2fbd243f2a40f9cdf6c6bd49fc16634ebc4cb2498880ff2e8063adff627b9f',
    );
    const verdict = JSON.parse(verdictBytes.toString('utf8')) as FinalAuditVerdict;

    expect(verdict.schemaVersion).toBe(1);
    expect(verdict.auditScope).toMatchObject({
      baselineCommit: 'aee195551b5aef628eb7a72192117d7e3079818e',
      branch: 'feature/placeholder-art-completion-v036',
      shippingDirectory: 'public/ui/items',
      itemArtFilesReviewed: 817,
      liveItemDefinitions: 831,
      generatedHeroicDefinitions: 63,
      heroicDefinitionsWithOwnWebp: 48,
      heroicWeaponArtAliases: 15,
      modifiedItemArtCount: 274,
    });
    expect(verdict.auditScope.modifiedItemArtPaths).toEqual(
      manifest().targetSets.items.map((id) => `public/ui/items/${id}.webp`),
    );
    expect(Object.values(verdict.auditScope.groups).reduce((sum, count) => sum + count, 0)).toBe(
      817,
    );
    expect(Object.keys(verdict.auditScope.groups)).toHaveLength(22);
    const shippingIds = new Set(
      readdirSync(path.join(repoRoot, 'public/ui/items'))
        .filter((name) => name.endsWith('.webp'))
        .map((name) => name.slice(0, -'.webp'.length)),
    );
    const generatedHeroics = Object.entries(ITEMS).filter(
      ([, item]) => 'heroicOf' in item && typeof item.heroicOf === 'string',
    );
    const heroicWithOwnWebp = generatedHeroics.filter(([id]) => shippingIds.has(id));
    const heroicArtAliases = generatedHeroics.filter(([id]) => !shippingIds.has(id));
    expect(generatedHeroics).toHaveLength(verdict.auditScope.generatedHeroicDefinitions);
    expect(heroicWithOwnWebp).toHaveLength(verdict.auditScope.heroicDefinitionsWithOwnWebp);
    expect(heroicArtAliases).toHaveLength(verdict.auditScope.heroicWeaponArtAliases);
    expect(heroicArtAliases.every(([, item]) => item.kind === 'weapon')).toBe(true);
    expect(verdict.reviewContract.everyShippingFileReviewedInModes).toEqual([
      '128-color',
      '40-color',
      '28-color',
      '22-color',
      '28-grayscale',
      '64-circle',
      'small-multiview',
      'identity-display-name-and-id',
    ]);
    expect(verdict.machineChecks).toEqual({
      passed: true,
      requiredDimensions: [128, 128],
      requiredFormat: 'webp',
      requiredColorspace: 'srgb',
      requiredOpaque: true,
      maximumBytes: 15_360,
      invalidIds: [],
      duplicateHashGroups: [],
    });

    const mapping = readJson<ItemMapping>('public/ui/items/mapping.json');
    const currentIds = sorted([
      ...mapping.entries.map(({ itemId }) => itemId),
      ...mapping.generatedBatches.flatMap(({ itemIds }) => itemIds),
    ]);
    expect(verdict.visualVerdict).toMatchObject({
      status: 'pass',
      passCount: 817,
      watchCount: 0,
      watch: [],
      rejectCount: 0,
      reject: [],
      summary:
        'All 817 shipping item-art files pass the visual contract after the documented retries.',
    });
    expect(verdict.visualVerdict.passIds).toEqual(currentIds);
    expect(verdict.nonVisualContentWatch).toEqual([
      {
        id: 'skullsmasher_warbelt',
        severity: 'non-blocking',
        reason:
          "The art correctly depicts the runtime chest slot, but the player-facing name is Skullsmasher's Warbelt.",
        recommendation:
          'Resolve the content name/slot decision separately; do not repaint the chest icon as a belt while the item remains slot=chest.',
      },
    ]);

    const resolvedShipping = verdict.resolvedDuringAudit.flatMap(
      ({ finalDisposition, finalShipping }) => {
        expect(finalDisposition).toBe('pass');
        return finalShipping;
      },
    );
    expect(sorted(resolvedShipping.map(({ id }) => id))).toEqual([
      'acolytes_circlet',
      'captains_crest',
      'crypt_keystone',
      'cult_cipher',
      'hollow_vigil_staff',
      'priests_sigil',
      'starfall_shard',
      'tough_jerky',
      'trail_hardtack',
      'weathered_ledger_page',
    ]);
    for (const pin of resolvedShipping) {
      const bytes = readFileSync(path.join(repoRoot, pin.path));
      expect(bytes.length, `${pin.id} resolved audit bytes`).toBe(pin.bytes);
      expect(sha256(bytes), `${pin.id} resolved audit hash`).toBe(pin.sha256);
    }

    expect(verdict.evidence.catalog).toEqual({
      path: 'tmp/imagegen/item-art-consistency/final-audit/catalog.json',
      sha256: '5a4e46556d459f83462570b66a56e1ec11b015dbd5c7594ffe4112bbda51cfbb',
      bytes: 448_700,
    });
    expect(verdict.evidence.rendererFingerprint).toBe(
      'fd92c41a206cd55b05a1de94c4789f6eb6ca4200d063f4bbd284c21ae03b6082',
    );
    expect(verdict.evidence.rendererFingerprint).toBe(ITEM_ART_AUDIT_RENDERER_FINGERPRINT);
    expect(verdict.evidence.sheetCount).toBe(208);
    expect(verdict.evidence.sheetModeCounts).toEqual({
      '128-color': 26,
      '40-color': 26,
      '28-color': 26,
      '22-color': 26,
      '28-grayscale': 26,
      '64-circle': 26,
      'small-multiview': 26,
      identity: 26,
    });
    expect(verdict.evidence.sheets).toHaveLength(208);
    expect(new Set(verdict.evidence.sheets.map(({ path: sheetPath }) => sheetPath)).size).toBe(208);
    const modesByPage = new Map<string, string[]>();
    for (const sheet of verdict.evidence.sheets) {
      const match = sheet.path.match(
        /\/([^/]+--p\d{2})--(128-color|40-color|28-color|22-color|28-grayscale|64-circle|small-multiview|identity)\.png$/,
      );
      expect(match, `canonical audit sheet path: ${sheet.path}`).not.toBeNull();
      const page = match?.[1] ?? '';
      const modes = modesByPage.get(page) ?? [];
      modes.push(match?.[2] ?? '');
      modesByPage.set(page, modes);
    }
    expect(modesByPage.size).toBe(26);
    for (const modes of modesByPage.values()) {
      expect(modes).toEqual([
        '128-color',
        '40-color',
        '28-color',
        '22-color',
        '28-grayscale',
        '64-circle',
        'small-multiview',
        'identity',
      ]);
    }
    const sheetSetDigest = createHash('sha256');
    for (const sheet of verdict.evidence.sheets) {
      expect(sheet.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(sheet.bytes).toBeGreaterThan(0);
      expect(sheet.width).toBeGreaterThan(0);
      expect(sheet.height).toBeGreaterThan(0);
      expect(sheet.format).toBe('png');
      sheetSetDigest.update(`${sheet.path}\0${sheet.sha256}\0${sheet.bytes}\n`);
    }
    expect(verdict.evidence.sheetSetSha256).toBe(
      '506d52c032c1e702bba35e313463bb46e55a3ce7e6e3944d12d618df17b89385',
    );
    expect(sheetSetDigest.digest('hex')).toBe(verdict.evidence.sheetSetSha256);

    const shippingCatalogDigest = createHash('sha256');
    for (const id of verdict.visualVerdict.passIds) {
      const bytes = readFileSync(path.join(repoRoot, `public/ui/items/${id}.webp`));
      shippingCatalogDigest.update(`${id}\0${sha256(bytes)}\0${bytes.length}\n`);
    }
    expect(verdict.evidence.shippingCatalogSha256).toBe(
      '2c96473916c10df2118b02bba0edc914acefb61a16e16f46c4467ee924876c1a',
    );
    expect(shippingCatalogDigest.digest('hex')).toBe(verdict.evidence.shippingCatalogSha256);
  });

  it('keeps an exact, non-dangling supersession graph and one current mapping owner', () => {
    const value = manifest();
    expect(() => validateSupersessionGraph(value)).not.toThrow();

    const audit = readJson<{
      validation: Record<string, unknown>;
      records: Array<{
        id: string;
        preTaskShipping: SupersessionRecord['previous']['shipping'];
        oldProvenanceClass: string;
        oldProvenanceOwner: Record<string, unknown>;
      }>;
    }>(`${evidenceDir}/supersession-audit.json`);
    expect(audit.validation).toMatchObject({
      expectedRecordCount: 272,
      actualRecordCount: 272,
      uniqueIdCount: 272,
      duplicateRequestedIds: [],
      allHaveExactlyOneOldOwner: true,
    });
    expect(value.supersessionAuditAdditions).toEqual([
      {
        id: 'starfall_shard',
        preTaskShipping: {
          commit: 'aee195551b5aef628eb7a72192117d7e3079818e',
          sha256: 'd1e9b23645e032f7f27ce022f8db10905044d2cc343305289e30c578c27dbbb2',
          bytes: 1158,
        },
        oldProvenanceClass: 'priorGeneratedBatch',
        oldProvenanceOwner: {
          ownerType: 'generatedBatch',
          batchIndex: 8,
          batchId: 'missing-painted-icons-zone-quest-items-and-curios-2026-08-01',
          itemIndex: 38,
          source: 'OpenAI built-in image generation',
          owner: 'World of ClaudeCraft',
          license: LICENSE,
          provenanceRecord: null,
        },
      },
      {
        id: 'hollow_vigil_staff',
        preTaskShipping: {
          commit: 'aee195551b5aef628eb7a72192117d7e3079818e',
          sha256: '7cda767b28a8ad5727d1aec5d53ca16fd6b12b4f9fcc82ad43e041c1cb513c64',
          bytes: 1166,
        },
        oldProvenanceClass: 'priorGeneratedBatch',
        oldProvenanceOwner: {
          ownerType: 'generatedBatch',
          batchIndex: 13,
          batchId: 'placeholder-art-completion-weapons-2026-08-09',
          itemIndex: 57,
          source: 'OpenAI built-in image generation',
          owner: 'World of ClaudeCraft',
          license: LICENSE,
          provenanceRecord: 'docs/achievements/placeholder-art-completion-2026-08-09/',
        },
      },
    ]);
    const auditById = new Map(
      [...audit.records, ...value.supersessionAuditAdditions].map((record) => [record.id, record]),
    );
    const idsForClass = (provenanceClass: string): string[] =>
      sorted(
        [...auditById.values()]
          .filter(({ oldProvenanceClass }) => oldProvenanceClass === provenanceClass)
          .map(({ id }) => id),
      );
    expect(value.targetSets.formerCraftPixIdentityReferences).toEqual(
      idsForClass('craftPixOrdinaryInheritedDefault'),
    );
    expect(value.targetSets.formerMountRenderIdentityReferences).toEqual(
      idsForClass('mountRenderOrdinaryOverride'),
    );
    expect(value.targetSets.formerGeneratedPaintings).toEqual(idsForClass('priorGeneratedBatch'));
    for (const supersession of value.supersedes) {
      const prior = auditById.get(supersession.itemId);
      expect(prior, `${supersession.itemId} pre-task audit record`).toBeDefined();
      expect(supersession.previous, `${supersession.itemId} exact old owner and pin`).toEqual({
        shipping: prior?.preTaskShipping,
        provenanceClass: prior?.oldProvenanceClass,
        owner: prior?.oldProvenanceOwner,
      });
      if (supersession.previous.provenanceClass === 'priorGeneratedBatch') {
        expect(
          supersession.historicalAcceptedArt,
          `${supersession.itemId} historical accepted-art link`,
        ).toBeDefined();
      } else {
        expect(
          supersession.historicalAcceptedArt,
          `${supersession.itemId} must not invent a generated-art manifest`,
        ).toBeUndefined();
      }
    }
    expect(
      value.supersedes.filter(({ historicalAcceptedArt }) => historicalAcceptedArt),
    ).toHaveLength(10);

    const mapping = readJson<ItemMapping>('public/ui/items/mapping.json');
    expect(
      mapping.license,
      'no ordinary item inherits the retired CraftPix default',
    ).toBeUndefined();
    expect(mapping.entries).toHaveLength(39);
    expect(mapping.entries.every(({ license }) => Boolean(license))).toBe(true);
    expect(mapping.generatedBatches).toHaveLength(15);
    const batch = mapping.generatedBatches.find(({ batchId }) => batchId === BATCH_ID);
    expect(batch).toBeDefined();
    expect(batch).toMatchObject({
      source: 'OpenAI built-in image generation',
      owner: 'World of ClaudeCraft',
      license: LICENSE,
      styleContract: {
        id: 'woc-item-icon-v1',
        document: 'docs/design/item-icon-art-style.md',
      },
      provenanceRecord: `${evidenceDir}/`,
    });
    expect(batch?.itemIds).toEqual(value.targetSets.items);
    const oldGeneratedIds = mapping.generatedBatches
      .filter(({ batchId }) => batchId !== BATCH_ID)
      .flatMap(({ itemIds }) => itemIds);
    expect(oldGeneratedIds).toHaveLength(504);
    const allCurrentOwnerIds = [
      ...mapping.entries.map(({ itemId }) => itemId),
      ...mapping.generatedBatches.flatMap(({ itemIds }) => itemIds),
    ];
    expect(allCurrentOwnerIds).toHaveLength(817);
    expect(new Set(allCurrentOwnerIds).size).toBe(817);
    expect(batch?.provenanceRecords).toEqual([
      `${evidenceDir}/accepted-art.json`,
      `${evidenceDir}/supersession-audit.json`,
      ...value.generationReports.map(({ path: reportPath }) => reportPath),
    ]);

    const targetIds = new Set(value.targetSets.items);
    expect(mapping.entries.filter(({ itemId }) => targetIds.has(itemId))).toEqual([]);
    for (const id of targetIds) {
      const owners = [
        ...mapping.entries.filter(({ itemId }) => itemId === id),
        ...mapping.generatedBatches.filter(({ itemIds }) => itemIds.includes(id)),
      ];
      expect(owners, `${id} current mapping owner`).toEqual([batch]);
    }

    const liveHashes = new Set(
      readdirSync(path.join(repoRoot, 'public/ui/items'))
        .filter((name) => name.endsWith('.webp'))
        .map((name) => sha256(readFileSync(path.join(repoRoot, 'public/ui/items', name)))),
    );
    for (const record of value.supersedes) {
      const asset = value.assets.find(({ id }) => id === record.itemId);
      const bytes = readFileSync(path.join(repoRoot, `public/ui/items/${record.itemId}.webp`));
      expect(bytes.length, `${record.itemId} live bytes`).toBe(asset?.acceptedBytes);
      expect(sha256(bytes), `${record.itemId} live hash`).toBe(asset?.acceptedSha256);
      expect(
        liveHashes.has(record.previous.shipping.sha256),
        `${record.itemId} retired bytes`,
      ).toBe(false);
    }
  });

  it('rejects duplicate, missing, and dangling accepted-art records', () => {
    const duplicateAsset = structuredClone(manifest());
    duplicateAsset.assets.push(duplicateAsset.assets[0]);
    expect(() => validateSupersessionGraph(duplicateAsset)).toThrow('assets has duplicate IDs');

    const duplicateSupersession = structuredClone(manifest());
    duplicateSupersession.supersedes.push(duplicateSupersession.supersedes[0]);
    expect(() => validateSupersessionGraph(duplicateSupersession)).toThrow(
      'supersedes has duplicate IDs',
    );
    const duplicateTarget = structuredClone(manifest());
    duplicateTarget.targetSets.items.push(duplicateTarget.targetSets.items[0]);
    expect(() => validateSupersessionGraph(duplicateTarget)).toThrow(
      'targetSets.items has duplicate IDs',
    );
    const duplicateReport = structuredClone(manifest());
    duplicateReport.generationReports[0].itemIds.push(
      duplicateReport.generationReports[0].itemIds[0],
    );
    expect(() => validateSupersessionGraph(duplicateReport)).toThrow(
      'generationReports.itemIds has duplicate IDs',
    );

    const missingSupersession = structuredClone(manifest());
    missingSupersession.supersedes.pop();
    expect(() => validateSupersessionGraph(missingSupersession)).toThrow(
      'supersedes and targetSets.items must name the same item IDs',
    );
    const extraAsset = structuredClone(manifest());
    extraAsset.assets.push({ ...extraAsset.assets[0], id: 'not_a_replacement_target' });
    expect(() => validateSupersessionGraph(extraAsset)).toThrow(
      'assets and targetSets.items must name the same item IDs',
    );
    const missingReportItem = structuredClone(manifest());
    missingReportItem.generationReports[0].itemIds.pop();
    expect(() => validateSupersessionGraph(missingReportItem)).toThrow(
      'generation reports and targetSets.items must name the same item IDs',
    );

    const danglingSupersession = structuredClone(manifest());
    danglingSupersession.supersedes[0].itemId = 'not_a_replacement_target';
    expect(() => validateSupersessionGraph(danglingSupersession)).toThrow(
      'dangling supersession record not_a_replacement_target',
    );
    const mismatchedBatch = structuredClone(manifest());
    mismatchedBatch.supersedes[0].replacement.batchId = 'wrong-batch';
    expect(() => validateSupersessionGraph(mismatchedBatch)).toThrow(
      'replacement batch does not match the manifest batch',
    );
    const mismatchedPin = structuredClone(manifest());
    mismatchedPin.supersedes[0].replacement.acceptedBytes += 1;
    expect(() => validateSupersessionGraph(mismatchedPin)).toThrow(
      'replacement pins do not match its accepted asset',
    );
    const mismatchedSha = structuredClone(manifest());
    mismatchedSha.supersedes[0].replacement.acceptedSha256 = '0'.repeat(64);
    expect(() => validateSupersessionGraph(mismatchedSha)).toThrow(
      'replacement pins do not match its accepted asset',
    );
    const mismatchedReport = structuredClone(manifest());
    mismatchedReport.supersedes[0].replacement.generationReport = 'wrong-report.json';
    expect(() => validateSupersessionGraph(mismatchedReport)).toThrow(
      'replacement pins do not match its accepted asset',
    );
    const unchangedBytes = structuredClone(manifest());
    unchangedBytes.supersedes[0].previous.shipping.sha256 =
      unchangedBytes.supersedes[0].replacement.acceptedSha256;
    expect(() => validateSupersessionGraph(unchangedBytes)).toThrow(
      'did not replace its previous shipping bytes',
    );
    const blankReason = structuredClone(manifest());
    blankReason.supersedes[0].replacementReason = '   ';
    expect(() => validateSupersessionGraph(blankReason)).toThrow('needs a replacement reason');
  });

  it('passes the real icon asset audit for every replacement painting', async () => {
    const value = manifest();
    const report = await auditIconAssets({ manifest: value, repoRoot });
    expect(report.summary).toMatchObject({
      ok: true,
      assetCount: 274,
      issueCount: 0,
      exactDuplicateGroupCount: 0,
    });
    expect(report.exactDuplicates).toEqual([]);
    expect(report.assets.every((asset) => asset.issues.length === 0)).toBe(true);
  }, 30_000);

  it('keeps the full 817-icon catalog owned, decodable, opaque, budgeted, and unique', async () => {
    const mapping = readJson<ItemMapping>('public/ui/items/mapping.json');
    const ownerIds = [
      ...mapping.entries.map(({ itemId }) => itemId),
      ...mapping.generatedBatches.flatMap(({ itemIds }) => itemIds),
    ];
    const fileIds = readdirSync(path.join(repoRoot, 'public/ui/items'))
      .filter((name) => name.endsWith('.webp'))
      .map((name) => name.slice(0, -'.webp'.length));
    const ids = sorted(new Set([...ownerIds, ...fileIds]));
    const ownerCountById = new Map<string, number>();
    for (const id of ownerIds) ownerCountById.set(id, (ownerCountById.get(id) ?? 0) + 1);

    const violations: string[] = [];
    if (ownerIds.length !== 817) violations.push(`mapping owner count: ${ownerIds.length} != 817`);
    if (fileIds.length !== 817) violations.push(`shipping WebP count: ${fileIds.length} != 817`);
    for (const id of ids) {
      const ownerCount = ownerCountById.get(id) ?? 0;
      if (ownerCount !== 1) violations.push(`${id}: current owner count ${ownerCount} != 1`);
    }

    const fileIdSet = new Set(fileIds);
    const hashOwners = new Map<string, string[]>();
    const concurrency = 24;
    for (let offset = 0; offset < ids.length; offset += concurrency) {
      await Promise.all(
        ids.slice(offset, offset + concurrency).map(async (id) => {
          if (!fileIdSet.has(id)) {
            violations.push(`${id}: mapped icon has no shipping WebP`);
            return;
          }
          const file = path.join(repoRoot, `public/ui/items/${id}.webp`);
          const bytes = readFileSync(file);
          if (
            bytes.length < 12 ||
            bytes.toString('ascii', 0, 4) !== 'RIFF' ||
            bytes.toString('ascii', 8, 12) !== 'WEBP'
          ) {
            violations.push(`${id}: shipping file is not a WebP container`);
          }
          if (bytes.length > 15_360) {
            violations.push(`${id}: ${bytes.length} bytes exceeds 15360`);
          }
          const hash = sha256(bytes);
          hashOwners.set(hash, [...(hashOwners.get(hash) ?? []), id]);
          try {
            const decoded = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
            if (decoded.info.width !== 128 || decoded.info.height !== 128) {
              violations.push(
                `${id}: decoded ${decoded.info.width}x${decoded.info.height}, expected 128x128`,
              );
            }
            if (decoded.info.channels !== 3 && decoded.info.channels !== 4) {
              violations.push(
                `${id}: decoded channel count ${decoded.info.channels}, expected 3/4`,
              );
            }
            if (decoded.info.channels === 4) {
              let nonOpaqueAlphaBytes = 0;
              for (let index = 3; index < decoded.data.length; index += 4) {
                if (decoded.data[index] !== 255) nonOpaqueAlphaBytes += 1;
              }
              if (nonOpaqueAlphaBytes > 0) {
                violations.push(`${id}: ${nonOpaqueAlphaBytes} non-opaque alpha bytes`);
              }
            }
          } catch (error) {
            violations.push(
              `${id}: decode failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }),
      );
    }
    for (const [hash, hashIds] of hashOwners) {
      if (hashIds.length > 1) violations.push(`${hash}: duplicate bytes for ${hashIds.join(', ')}`);
    }

    expect(violations, `full item catalog violations:\n${violations.join('\n')}`).toEqual([]);
  }, 60_000);

  it('credits generated replacements without erasing reference or mount-model lineage', () => {
    const credits = readFileSync(path.join(repoRoot, 'CREDITS.md'), 'utf8');
    expect(credits).toContain('Historical CraftPix item identity references');
    expect(credits).toContain('Item-art consistency replacement paintings');
    expect(credits).toContain('255 licensed CraftPix');
    expect(credits).toContain('nine project-owned mount renders');
    expect(credits).toContain('ten prior project-generated paintings');
    expect(credits).toContain('[item-art consistency lineage]');
    expect(credits).toContain('Rideable mount models');
    expect(credits).toContain('thunderstrut_gobbler');
    expect(credits).toContain('drakemaw_raptor');
    expect(credits).toContain('Terrorspark Groundshaker rideable mount model');
    expect(credits).not.toContain('CraftPix class ability and curated item icons');
    expect(credits).not.toContain('| Curated item icons (`public/ui/items/*.webp`');
  });
});
