import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { validateAcceptedArtManifest } from '../scripts/lib/icon_asset_audit.mjs';
import { ITEM_ART_AUDIT_RENDERER_FINGERPRINT } from '../scripts/lib/item_art_audit.mjs';
import { ITEMS } from '../src/sim/data';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = 'docs/achievements/item-art-consistency-2026-08-09';
const manifestPath = path.join(repoRoot, evidenceDir, 'accepted-art.json');
const BATCH_ID = 'item-art-consistency-2026-08-09';
const CURRENT_EVIDENCE_DIR = 'docs/achievements/masterwrought-art-completion-2026-09-02';
const CURRENT_VERDICT_PATH = `${CURRENT_EVIDENCE_DIR}/final-item-art-audit-verdict.json`;
const CURRENT_BATCH_ID = 'masterwrought-art-completion-2026-09-02';
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
    incrementalReviews: Array<{
      reviewedAt: string;
      branch: string;
      reviewer: string;
      addedIds?: string[];
      replacedIds?: string[];
      provenance: string[];
      note: string;
    }>;
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
        // Re-minted by the farming absorb's --refresh-verdict run: only the
        // catalog sha and the lib self-hash moved, so the byte count held.
        path: `${evidenceDir}/final-item-art-audit-verdict.json`,
        // Release v0.41.0 sync: the verdict was hand-merged (ours' review chain
        // plus the release's three Proving Shore clauses and its tutorial-island
        // review entry, counts and passIds set from the merged catalog at 913
        // files, the Masterwrought 84 plus the release's six) and re-minted by
        // item_art_audit.mjs --refresh-verdict; this seal follows those bytes.
        // Merged again at the v0.41.0 release-batch sync (base d3f8bae369):
        // the release's seven painted bank bags join the chain (920 files);
        // the verdict was hand-merged the same way, re-minted by
        // item_art_audit.mjs --refresh-verdict over the merged tree, and this
        // seal follows those bytes.
        // Merged a third time at the v0.41.0 Crucible sync (base e19d832b47):
        // the release's four Crucible clauses (nine painted raid weapons, two
        // Varkhul legendary renders, the 192-piece set wave, the Core of the
        // Last Flame reagent) join the chain (1124 files, 1139 art-subject
        // defs); the verdict was hand-merged the same way (counts, census and
        // passIds as the union of both arms), re-minted by item_art_audit.mjs
        // --refresh-verdict over the merged tree, and this seal follows those
        // bytes.
        // RE-MINTED at the v0.42.0 sync on 2026-08-31 (ours 2ab5c2f7d0, theirs
        // 22e909839f, base e6b8edb375): the release adds one more painted piece
        // (reins_rickshaw_mount, the Bonebound Rickshaw reins), so the merged
        // verdict carries 1125 files / 1140 art-subject defs and one extra
        // clause, and its bytes moved with it. Parent values for the record:
        // ours 3c4b6316 / 133_849 bytes, the release 551f582e / 120_959 bytes,
        // so neither parent's pair describes the merged tree. What was
        // re-derived it against: public/ui/items/mapping.json was hand-merged
        // first (ours plus the release's single appended reins_rickshaw_mount
        // owner, 1125 owners, a bijection with the 1125 committed .webp files),
        // then the verdict was hand-merged the same way (counts, census, groups
        // and passIds taken straight off the merged catalog, the union of both
        // arms) and re-minted by `node scripts/item_art_audit.mjs
        // --refresh-verdict` over the merged tree; this seal is that run's
        // printed verdict sha and byte count. The v0.42.0 release union adds
        // the Lanternback Troll and Chimeglass Tortoise reins, re-renders the
        // 12-mount contact-sheet family, and advances this exact seal again.
        acceptedSha256: '1aa9f0111afd13c37f624e9b5d8f76580082f12e17fdd5bd06c1e3f9dc8f8bc9',
        acceptedBytes: 136_469,
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

  it('pins the sealed historical visual audit and its internal evidence digests', () => {
    const verdictPath = `${evidenceDir}/final-item-art-audit-verdict.json`;
    const readme = readFileSync(path.join(repoRoot, evidenceDir, 'README.md'), 'utf8');
    expect(readme).toContain('`final-item-art-audit-verdict.json`');
    expect(readme).toContain('node scripts/item_art_audit.mjs\n');
    expect(readme).toContain('node scripts/item_art_audit.mjs --refresh-verdict');
    const verdictBytes = readFileSync(path.join(repoRoot, verdictPath));
    // The same pair as the sourceEvidence seal above, and re-minted with it at
    // the v0.42.0 sync on 2026-08-31: these are the hand-merged, re-minted
    // verdict bytes, printed by the `--refresh-verdict` run over the merged
    // tree. The release union adds both reviewed mount-reins records.
    expect(verdictBytes.length).toBe(136_469);
    expect(sha256(verdictBytes)).toBe(
      '1aa9f0111afd13c37f624e9b5d8f76580082f12e17fdd5bd06c1e3f9dc8f8bc9',
    );
    const verdict = JSON.parse(verdictBytes.toString('utf8')) as FinalAuditVerdict;

    expect(verdict.schemaVersion).toBe(1);
    expect(verdict.generatedAt).toBe('2026-08-10T04:33:00.640Z');
    expect(verdict.auditScope).toMatchObject({
      baselineCommit: 'aee195551b5aef628eb7a72192117d7e3079818e',
      branch: 'feature/placeholder-art-completion-v036',
      shippingDirectory: 'public/ui/items',
      // 907 / 922 on the Masterwrought branch, 829 / 844 on release v0.41.0;
      // 913 / 928 at the merge (the release's six art-shipping ids join both
      // terms), measured as the committed .webp count under public/ui/items
      // and as live ITEMS minus ITEM_ART_PENDING. 920 / 935 at the v0.41.0
      // release-batch sync: the release's seven painted bank bags join both
      // terms. 1124 / 1139 at the v0.41.0 Crucible sync: the release's own
      // arm reached 1040 / 1055 (its 204 post-base Crucible ids: nine painted
      // raid weapons, two Varkhul legendary renders, the 192-piece set wave
      // and the Core of the Last Flame reagent), and those 204 join both
      // terms; the debt term stays this branch's 81.
      // 1125 / 1140 at the v0.42.0 sync: the release's own arm reached
      // 1041 / 1056 with one post-base id, the Bonebound Rickshaw reins
      // (reins_rickshaw_mount), which ships committed art, so it joins both
      // terms; the debt term stays this branch's 81. Re-counted on the merged
      // tree as 1125 committed .webp files under public/ui/items. The final
      // release union adds two reviewed mount icons and definitions.
      itemArtFilesReviewed: 1128,
      liveItemDefinitions: 1143,
      generatedHeroicDefinitions: 64,
      heroicDefinitionsWithOwnWebp: 48,
      heroicWeaponArtAliases: 16,
      modifiedItemArtCount: 274,
    });
    expect(verdict.auditScope.modifiedItemArtPaths).toEqual(
      manifest().targetSets.items.map((id) => `public/ui/items/${id}.webp`),
    );
    expect(Object.values(verdict.auditScope.groups).reduce((sum, count) => sum + count, 0)).toBe(
      1128,
    );
    // 23 -> 24 at Masterwrought phase 10: the three apex flasks are a new item
    // kind, and the audit groups by kind, so they form their own census group
    // (and their own contact-sheet page, below).
    // 24 -> 25 at Masterwrought phase 11: the 28 apex recipe patterns are the
    // first kind:'recipe' items, forming their own census group and page.
    expect(Object.keys(verdict.auditScope.groups)).toHaveLength(25);
    expect(verdict.auditScope.incrementalReviews.slice(-2)).toEqual([
      {
        reviewedAt: '2026-08-15',
        branch: 'feature/troll-mount',
        reviewer: 'owner',
        addedIds: ['reins_lanternback_troll'],
        provenance: ['public/ui/items/mapping.json'],
        note: 'The Lanternback Troll mount reins icon. The owner supplied the painted 624x624 master and directed its use for this item; it was downscaled to the 128px opaque woc-item-icon-v1 shipping format with no other change, and owner-reviewed pass on 2026-08-15. The 2026-08-09 campaign review of the prior 817 files and the 2026-08-10 review of the five class-overhaul integration additions both stand unchanged.',
      },
      {
        reviewedAt: '2026-08-15',
        branch: 'feature/turtle-mount',
        reviewer: 'owner',
        addedIds: ['reins_chimeglass_tortoise'],
        provenance: ['public/ui/items/mapping.json'],
        note: "The Chimeglass Tortoise mount reins icon. Rendered from the shipped mount model (public/models/mounts/chimeglass_tortoise.glb) as a three-quarter head study, background keyed and flattened to the 128px opaque woc-item-icon-v1 shipping format, and owner-reviewed pass on 2026-08-15. Re-rendered on 2026-08-16 alongside the mount's lens-glow pass, which restyled the glowing lens pair the icon frames: same three-quarter head study, same shipping format, 3062 to 3784 bytes, owner-reviewed pass again on 2026-08-16. The 2026-08-09 campaign review of the prior 817 files, the 2026-08-10 review of the five class-overhaul integration additions, and the 2026-08-15 Lanternback Troll review all stand unchanged. Joined the 2026-08-09 record at the release/v0.42.0 sync of PR #3439 (which carries the troll of PR #3399), on top of the release side's 2026-08-12 through 2026-08-30 additions.",
      },
    ]);
    expect(
      verdict.auditScope.heroicDefinitionsWithOwnWebp + verdict.auditScope.heroicWeaponArtAliases,
    ).toBe(verdict.auditScope.generatedHeroicDefinitions);
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

    expect(verdict.visualVerdict).toMatchObject({
      status: 'pass',
      passCount: 1128,
      watchCount: 0,
      watch: [],
      rejectCount: 0,
      reject: [],
      // The v0.41.0 Crucible sync splices the release's four Crucible clauses
      // in after the shared Passing Stone clause; the release's relocated
      // bank-storage clause is the base's mid-summary clause (kept there, once).
      // The v0.42.0 sync splices the release's one new clause (the Bonebound
      // Rickshaw reins, reviewed 2026-08-21) in date order, after the
      // pearl-detour clause and before the Passing Stone one. The release's
      // own string had also grown a duplicated second "All 830 shipping
      // item-art files pass..." recital of the whole chain; that is a stale
      // restatement contradicting its own leading count, so it does not
      // survive the merge, only its rickshaw clause does. The merged verdict
      // JSON carries exactly this string: it is what the hand-merge of
      // 2026-08-31 wrote into visualVerdict.summary before the
      // `--refresh-verdict` re-mint (see the sourceEvidence seal above).
      summary:
        'All 1128 shipping item-art files pass the visual contract: 817 reviewed in the 2026-08-09 campaign (documented retries included), plus the five class-overhaul integration additions owner-reviewed and passed on 2026-08-10, plus the seven bank-storage placeholder bag icons first accepted as opaque placeholder encodings on 2026-08-12 and superseded by distinct painted woc-item-icon-v1 replacements, implementation-agent reviewed and passed on 2026-08-26, plus the Dawnhold posy addition (project-authored vector illustration) owner-reviewed and passed on 2026-08-12, plus the three Masterwrought material placeholders (wyrmfall_core, sundered_essence, makers_ember) flattened onto the opaque house ground and reviewed at the feature/masterwrought v0.36.0 sync on 2026-08-10, plus the nine Masterwrought jewelcrafting placeholders (hammered_copper_band, polished_copper_loop, coiled_copper_torc, riveted_iron_signet, etched_iron_loop, iron_link_choker, weighted_thorium_band, gleaming_thorium_loop, burnished_thorium_amulet) authored as original SVG rasters on the opaque house ground and reviewed at the feature/masterwrought Phase 05 jewelcrafting admission on 2026-08-10, plus the six Masterwrought inscription placeholders (silverleaf_primer, goldleaf_folio, sunpetal_grimoire, silverleaf_scroll, goldleaf_scroll, sunpetal_scroll) authored as original SVG rasters on the opaque house ground and reviewed at the feature/masterwrought Phase 06 inscription admission on 2026-08-11, plus the ten Masterwrought skill-75 intermediate placeholders (duskforged_billet, forgefold_plating, wyrmhide_cording, sunspun_bolt, prismglass_setting, precision_chassis, quickening_catalyst, seasoned_stock, lucent_reagent, sablewax_vellum) authored as original SVG rasters on the opaque house ground and reviewed at the feature/masterwrought Phase 07 intermediates admission on 2026-08-11, plus the ten Masterwrought apex armor placeholders (spiritweld_girdle, forgefold_legguards, wardspeaker_sabatons, briarstep_jerkin, fenbloom_breeches, barksong_handguards, sunspun_vestments, sunspun_leggings, sunspun_handwraps, sunspun_haversack) authored as original SVG rasters on the opaque house ground and reviewed at the feature/masterwrought Phase 08 apex armor admission on 2026-08-12, plus the ten Masterwrought apex weapon, jewelry, and tool placeholders (duskforged_warblade, duskforged_bulwark, ridgebreaker, wyrmfall_pendant, warhewn_signet, prismglass_loop, makers_charm, gyrelens_array, masters_field_forge, voidbound_grimoire) authored as original SVG rasters on the opaque house ground and reviewed at the feature/masterwrought Phase 09 apex weapons, jewelry, and tools admission on 2026-08-13, plus the eight Masterwrought apex consumable and station placeholders (ironhusk_flask, warboar_flask, runewater_flask, stonepot_stew, warspice_skewers, sageleaf_chowder, grand_cauldron, laden_hearth) authored as original SVG rasters on the opaque house ground and reviewed at the feature/masterwrought Phase 10 apex consumables admission on 2026-08-14, plus the 28 Masterwrought apex recipe pattern placeholders (pattern_barksong_handguards, pattern_briarstep_jerkin, pattern_duskforged_bulwark, pattern_duskforged_warblade, pattern_fenbloom_breeches, pattern_forgefold_legguards, pattern_grand_cauldron, pattern_gyrelens_array, pattern_ironhusk_flask, pattern_laden_hearth, pattern_makers_charm, pattern_masters_field_forge, pattern_prismglass_loop, pattern_ridgebreaker, pattern_runewater_flask, pattern_sageleaf_chowder, pattern_spiritweld_girdle, pattern_stonepot_stew, pattern_sunspun_handwraps, pattern_sunspun_haversack, pattern_sunspun_leggings, pattern_sunspun_vestments, pattern_voidbound_grimoire, pattern_warboar_flask, pattern_wardspeaker_sabatons, pattern_warhewn_signet, pattern_warspice_skewers, pattern_wyrmfall_pendant) authored as original SVG rasters on the opaque house ground and reviewed at the feature/masterwrought Phase 11 apex patterns admission on 2026-08-16, plus the two Proving Shore prop renders (rendered from their own shipped world models) owner-reviewed and passed on 2026-08-17, plus the three pearl-detour icons (generated via the OpenAI proving-shore-mother-of-pearl-2026-08-20 batch) owner-reviewed and passed on 2026-08-20, plus the Bonebound Rickshaw reins icon (generated under woc-item-icon-v1 from a user-directed prompt, its own provenance recorded against its mapping.json owner) owner-reviewed against the regenerated mount contact sheet and passed on 2026-08-21, plus the Proving Shore Passing Stone render (rendered from its own shipped world model by the same deterministic pipeline as the 2026-08-17 pair) added on 2026-08-22, machine-checked and awaiting owner visual review, plus the nine Crucible raid weapon icons (generated via the OpenAI crucible-raid-weapons-2026-08-28 batch) added on 2026-08-28, machine-checked and awaiting owner visual review, plus the two Ignivar legendary drop renders (varkhul_forgebreaker and varkhul_emberward, rendered from their own shipped held-weapon models by the deterministic weapon-still pipeline) added on 2026-08-28, machine-checked and awaiting owner visual review, plus the 192 Crucible set-piece, sigil, and off-set icons (generated via the OpenAI crucible-set-icons-2026-08-29 batch) added on 2026-08-29, machine-checked and awaiting owner visual review, plus the Core of the Last Flame reagent icon (staged early from the crucible-raid-professions-2026-08-28 batch) added on 2026-08-30, machine-checked and awaiting owner visual review. The Lanternback Troll mount reins icon (owner-supplied painted master) and the Chimeglass Tortoise mount reins icon (rendered from its shipped mount model) were owner-reviewed and passed, joining this record at the release/v0.42.0 sync of PR #3439. The Cluckwork Mech Bird store-mount icon (project Blender render under the same contract) was added for owner review on 2026-08-17.',
    });
    expect(verdict.visualVerdict.passIds).toHaveLength(verdict.visualVerdict.passCount);
    expect(new Set(verdict.visualVerdict.passIds).size).toBe(verdict.visualVerdict.passCount);
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
      expect(pin.path, pin.id).toBe(`public/ui/items/${pin.id}.webp`);
      expect(pin.bytes, pin.id).toBeGreaterThan(0);
      expect(pin.sha256, pin.id).toMatch(/^[0-9a-f]{64}$/);
    }

    // Re-minted with the farming branch's ITEM_ART_PENDING exemption: the catalog sha follows the
    // audit lib's self-hash fingerprint; the reviewed 907-file evidence, the
    // catalog byte count, and the shipping catalog sha are untouched.
    expect(verdict.evidence.catalog).toEqual({
      path: 'tmp/imagegen/item-art-consistency/final-audit/catalog.json',
      // Measured by the --refresh-verdict re-mint over the merged tree at the
      // v0.41.0 release-batch sync (the release did not touch the audit lib,
      // so the lib fingerprint below is the Masterwrought arm's).
      // Measured again at the v0.41.0 Crucible sync: the release DID grow the
      // audit lib this time (its own art-pending sweep, folded into this
      // branch's pendingArtIds option), so the lib self-hash moved with the
      // merge and the catalog carries both arms' records (1124 files).
      // v0.42.0 sync: the release left the audit lib alone again, and the
      // catalog grows by exactly the one reins_rickshaw_mount record plus the
      // mount group's count digit (9 to 10), the 536-byte delta measured on
      // the release's own arm (567_150 to 567_686), so the bytes are
      // 613_422 + 536 = 613_958.
      // RE-MINTED at the v0.42.0 sync on 2026-08-31: the sha below is the
      // `node scripts/item_art_audit.mjs --refresh-verdict` run's printed
      // catalogSha256 over the merged tree (mapping.json hand-merged to its
      // 1125-owner union first). Parent values for the record: ours
      // e0c30df5 over 1124 files, the release de2dae43 over 1041; the merged
      // catalog is a third content and neither describes it. The predicted
      // byte count above held exactly, which is the arithmetic's own check.
      // The same sha is pinned in tests/item_art_audit_builder.test.ts.
      sha256: 'b9b2bd53e544c0b2c06e01b5c650e9bf6528af3f246081c63d5069f81d7a20db',
      bytes: 615_571,
    });
    expect(verdict.evidence.rendererFingerprint).toBe(
      '41f5404c4d6d9643c8f03b9d88a8546e44564cc03a1baabdd4a72cb9258a2da7',
    );
    expect(verdict.evidence.rendererFingerprint).toBe(ITEM_ART_AUDIT_RENDERER_FINGERPRINT);
    // 232 sheets over 29 pages on the Masterwrought arm, 216 over 27 on the
    // release's; the merged census keeps this branch's 25 groups and the
    // release's 204 ids split one more page: 240 sheets over 30 pages,
    // measured by the merged build.
    expect(verdict.evidence.sheetCount).toBe(240);
    expect(verdict.evidence.sheetModeCounts).toEqual({
      '128-color': 30,
      '40-color': 30,
      '28-color': 30,
      '22-color': 30,
      '28-grayscale': 30,
      '64-circle': 30,
      'small-multiview': 30,
      identity: 30,
    });
    expect(verdict.evidence.sheets).toHaveLength(240);
    expect(new Set(verdict.evidence.sheets.map(({ path: sheetPath }) => sheetPath)).size).toBe(240);
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
    expect(modesByPage.size).toBe(30);
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
    // Re-rendered by the farming absorb's --refresh-verdict run (Phase 11d):
    // the 232 contact sheets reproduced byte-for-byte, so the set digest held;
    // the per-sheet consistency arm below keeps it honest either way.
    expect(verdict.evidence.sheetSetSha256).toBe(
      // Re-rendered by the --refresh-verdict re-mint over the merged tree at
      // the v0.41.0 release-batch sync: the seven repainted bags move their
      // sheets, so the set digest follows the fresh 232-sheet render.
      // Re-rendered again at the v0.41.0 Crucible sync: the release's 204
      // ids join their kinds' pages, so the set digest follows that render.
      // RE-RENDERED at the v0.42.0 sync on 2026-08-31: the release's one reins
      // id joins the 'mount' group (9 to 10), which repaints that group's eight
      // sheets, so the set digest moved. Parent values for the record: ours
      // 01746685 over the 1124-file render, the release 7139cd73 over its
      // 216-sheet one; the merged render is a third content and neither
      // describes it. The digest below is the `node scripts/item_art_audit.mjs
      // --refresh-verdict` run's printed sheetSetSha256, over all 240 sheets
      // actually re-rendered from the merged catalog. The page and mode counts
      // below are unchanged, as predicted: the mount group stays inside its
      // single 80-id page, so the render is still 240 sheets over 30 pages.
      // No capture or asset was retaken; these are the audit's own generated
      // contact sheets, not committed art.
      'ebb4b18ac8ef01b6d8599ac3818e1199841c8707dd4982a0b4acecbf50a0d8bb',
    );
    expect(sheetSetDigest.digest('hex')).toBe(verdict.evidence.sheetSetSha256);

    expect(verdict.evidence.shippingCatalogSha256).toBe(
      // Measured over the merged tree at the v0.42.0 sync: the 1125 committed
      // .webp files, digested id by id in sorted order (both arms' art in).
      'bca3e47acbe550a0ecc987c73ccf88c632f647d9983c4a29aee0f65475775265',
    );
  });

  it('binds the current Masterwrought verdict to the complete live item-art catalog', () => {
    expect(existsSync(path.join(repoRoot, CURRENT_VERDICT_PATH)), 'current item-art verdict').toBe(
      true,
    );
    const verdict = readJson<FinalAuditVerdict>(CURRENT_VERDICT_PATH);
    const mapping = readJson<ItemMapping>('public/ui/items/mapping.json');
    const currentIds = sorted([
      ...mapping.entries.map(({ itemId }) => itemId),
      ...mapping.generatedBatches.flatMap(({ itemIds }) => itemIds),
    ]);
    const shippingIds = sorted(
      readdirSync(path.join(repoRoot, 'public/ui/items'))
        .filter((name) => name.endsWith('.webp'))
        .map((name) => name.slice(0, -'.webp'.length)),
    );

    expect(verdict.schemaVersion).toBe(1);
    expect(verdict.auditScope).toMatchObject({
      shippingDirectory: 'public/ui/items',
      itemArtFilesReviewed: 1254,
      liveItemDefinitions: 1269,
      generatedHeroicDefinitions: 64,
      heroicDefinitionsWithOwnWebp: 48,
      heroicWeaponArtAliases: 16,
    });
    expect(Object.keys(ITEMS)).toHaveLength(1269);
    expect(Object.values(verdict.auditScope.groups).reduce((sum, count) => sum + count, 0)).toBe(
      1254,
    );
    expect(Object.keys(verdict.auditScope.groups)).toHaveLength(25);
    expect(currentIds).toHaveLength(1254);
    expect(new Set(currentIds).size).toBe(1254);
    expect(shippingIds).toEqual(currentIds);

    const generatedHeroics = Object.entries(ITEMS).filter(
      ([, item]) => 'heroicOf' in item && typeof item.heroicOf === 'string',
    );
    const currentIdSet = new Set(currentIds);
    const heroicWithOwnWebp = generatedHeroics.filter(([id]) => currentIdSet.has(id));
    const heroicArtAliases = generatedHeroics.filter(([id]) => !currentIdSet.has(id));
    expect(generatedHeroics).toHaveLength(64);
    expect(heroicWithOwnWebp).toHaveLength(48);
    expect(heroicArtAliases).toHaveLength(16);
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
    const completionQa = readJson<{
      result: { watchNoteCount: number };
      watchNotes: unknown[];
    }>(`${CURRENT_EVIDENCE_DIR}/generation-reports/all-items-qa.json`);
    expect(verdict.visualVerdict).toMatchObject({
      status: 'pass',
      passCount: 1254,
      watchCount: completionQa.result.watchNoteCount,
      watch: completionQa.watchNotes,
      rejectCount: 0,
      reject: [],
    });
    expect(verdict.visualVerdict.passIds).toEqual(currentIds);

    expect(verdict.evidence.catalog).toEqual({
      path: 'tmp/imagegen/item-art-consistency/final-audit/catalog.json',
      sha256: 'febda89453efdcf50432cf3cab6ba638435b301eea6c429e9e0046b8a829e25e',
      bytes: 657_748,
    });
    expect(verdict.evidence.rendererFingerprint).toBe(ITEM_ART_AUDIT_RENDERER_FINGERPRINT);
    expect(verdict.evidence.sheetCount).toBe(248);
    expect(verdict.evidence.sheetModeCounts).toEqual({
      '128-color': 31,
      '40-color': 31,
      '28-color': 31,
      '22-color': 31,
      '28-grayscale': 31,
      '64-circle': 31,
      'small-multiview': 31,
      identity: 31,
    });
    expect(verdict.evidence.sheets).toHaveLength(248);
    const sheetSetDigest = createHash('sha256');
    for (const sheet of verdict.evidence.sheets) {
      expect(sheet.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(sheet.bytes).toBeGreaterThan(0);
      expect(sheet.format).toBe('png');
      sheetSetDigest.update(`${sheet.path}\0${sheet.sha256}\0${sheet.bytes}\n`);
    }
    expect(sheetSetDigest.digest('hex')).toBe(verdict.evidence.sheetSetSha256);

    const shippingCatalogDigest = createHash('sha256');
    for (const id of currentIds) {
      const bytes = readFileSync(path.join(repoRoot, `public/ui/items/${id}.webp`));
      shippingCatalogDigest.update(`${id}\0${sha256(bytes)}\0${bytes.length}\n`);
    }
    expect(verdict.evidence.shippingCatalogSha256).toBe(
      'bdec0afdcd3349a34b74bca9b0e01aee5b3ab2b3a82568bd9019fe0b0bb0b38c',
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
    // The completion wave consolidates 68 interim per-entry/SVG owners into
    // one generated batch. The surviving ordinary-art cohort stays explicit.
    expect(mapping.entries).toHaveLength(43);
    expect(mapping.entries.every(({ license }) => Boolean(license))).toBe(true);
    expect(mapping.generatedBatches).toHaveLength(26);
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
    const completionBatch = mapping.generatedBatches.find(
      ({ batchId }) => batchId === CURRENT_BATCH_ID,
    );
    expect(completionBatch).toMatchObject({
      source: 'OpenAI built-in image generation',
      owner: 'World of ClaudeCraft',
      license: LICENSE,
      styleContract: {
        id: 'woc-item-icon-v1',
        document: 'docs/design/item-icon-art-style.md',
      },
      provenanceRecord: `${CURRENT_EVIDENCE_DIR}/`,
    });
    expect(completionBatch?.itemIds).toHaveLength(165);
    expect(completionBatch?.itemIds).toEqual(sorted(completionBatch?.itemIds ?? []));
    const mechBirdBatch = mapping.generatedBatches.find(
      ({ batchId }) => batchId === 'mech-bird-mount-icon-2026-08-17',
    );
    expect(mechBirdBatch).toMatchObject({
      source:
        'Project Blender render of the shipped mount model (Cycles) with painted-treatment post (median brushwork pass, warm and cool grade, vignette multiply)',
      owner: 'World of ClaudeCraft',
      license: LICENSE,
      styleContract: {
        id: 'woc-item-icon-v1',
        document: 'docs/design/item-icon-art-style.md',
      },
      itemIds: ['reins_mech_bird'],
    });

    const priorGeneratedIds = mapping.generatedBatches
      .filter(({ batchId }) => batchId !== BATCH_ID && batchId !== CURRENT_BATCH_ID)
      .flatMap(({ itemIds }) => itemIds);
    expect(priorGeneratedIds).toHaveLength(727);
    const allCurrentOwnerIds = [
      ...mapping.entries.map(({ itemId }) => itemId),
      ...mapping.generatedBatches.flatMap(({ itemIds }) => itemIds),
    ];
    expect(allCurrentOwnerIds).toHaveLength(1254);
    expect(new Set(allCurrentOwnerIds).size).toBe(1254);
    expect({
      entries: mapping.entries.length,
      priorGenerated: priorGeneratedIds.length,
      historicalAudit: batch?.itemIds.length,
      masterwroughtCompletion: completionBatch?.itemIds.length,
    }).toEqual({
      entries: 43,
      priorGenerated: 727,
      historicalAudit: 274,
      masterwroughtCompletion: 165,
    });
    const historicalVerdict = readJson<FinalAuditVerdict>(
      `${evidenceDir}/final-item-art-audit-verdict.json`,
    );
    const completionIdSet = new Set(completionBatch?.itemIds ?? []);
    const supersededHistoricalIds = historicalVerdict.visualVerdict.passIds.filter((id) =>
      completionIdSet.has(id),
    );
    expect(historicalVerdict.visualVerdict.passIds).toHaveLength(1128);
    expect(supersededHistoricalIds).toHaveLength(84);
    expect(
      sorted([
        ...historicalVerdict.visualVerdict.passIds.filter((id) => !completionIdSet.has(id)),
        ...(completionBatch?.itemIds ?? []),
      ]),
      'historical carry-forward plus the completion wave is the current catalog',
    ).toEqual(sorted(allCurrentOwnerIds));
    expect(batch?.provenanceRecords).toEqual([
      `${evidenceDir}/accepted-art.json`,
      `${evidenceDir}/supersession-audit.json`,
      ...value.generationReports.map(({ path: reportPath }) => reportPath),
    ]);
    expect(completionBatch?.provenanceRecords).toEqual([
      `${CURRENT_EVIDENCE_DIR}/accepted-art.json`,
      `${CURRENT_EVIDENCE_DIR}/generation-reports/crops.json`,
      `${CURRENT_EVIDENCE_DIR}/generation-reports/farming.json`,
      `${CURRENT_EVIDENCE_DIR}/generation-reports/profession-new.json`,
      `${CURRENT_EVIDENCE_DIR}/generation-reports/placeholder-material-gear.json`,
      `${CURRENT_EVIDENCE_DIR}/generation-reports/placeholder-apex.json`,
      `${CURRENT_EVIDENCE_DIR}/generation-reports/placeholder-patterns.json`,
      `${CURRENT_EVIDENCE_DIR}/generation-reports/all-items-qa.json`,
      CURRENT_VERDICT_PATH,
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
    for (const id of completionBatch?.itemIds ?? []) {
      const owners = [
        ...mapping.entries.filter(({ itemId }) => itemId === id),
        ...mapping.generatedBatches.filter(({ itemIds }) => itemIds.includes(id)),
      ];
      expect(owners, `${id} current mapping owner`).toEqual([completionBatch]);
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

  it('keeps the full shipping icon catalog owned, decodable, opaque, budgeted, and unique', async () => {
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
    if (ownerIds.length !== 1254)
      violations.push(`mapping owner count: ${ownerIds.length} != 1254`);
    if (fileIds.length !== 1254) violations.push(`shipping WebP count: ${fileIds.length} != 1254`);
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
    expect(credits).toContain('Dreadspark Groundshaker rideable mount model');
    expect(credits).not.toContain('CraftPix class ability and curated item icons');
    expect(credits).not.toContain('| Curated item icons (`public/ui/items/*.webp`');
  });
});
