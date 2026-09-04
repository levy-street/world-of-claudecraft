import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  auditIconAssets,
  measureAlpha,
  validateAcceptedArtManifest,
} from '../scripts/lib/icon_asset_audit.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = 'docs/achievements/masterwrought-art-completion-2026-09-02';
const manifestPath = `${evidenceDir}/accepted-art.json`;
const batchId = 'masterwrought-art-completion-2026-09-02';
const screenshotDir = `docs/screenshots/${batchId}`;
const screenshotFiles = [
  '01-after-masterwrought-art-items-desktop.png',
  '02-after-masterwrought-art-items-mobile.png',
  '03-after-masterwrought-art-professions-gathering-desktop.png',
  '04-after-masterwrought-art-professions-gathering-mobile.png',
  '05-after-masterwrought-art-farm-map-desktop.png',
  '06-after-masterwrought-art-farm-map-mobile.png',
  '07-after-masterwrought-art-chrome-desktop.png',
  '08-after-masterwrought-art-chrome-mobile-controller.png',
  '09-after-masterwrought-art-well-fed-desktop.png',
  '10-after-masterwrought-art-deeds-collection-desktop.png',
  '11-after-masterwrought-art-deeds-chronicle-desktop.png',
  '12-after-masterwrought-art-deeds-progression-desktop.png',
  '13-after-masterwrought-art-reliquary-harvestmaster-desktop.png',
] as const;
const itemReportIds = [
  'crops',
  'farming',
  'profession-new',
  'placeholder-material-gear',
  'placeholder-apex',
  'placeholder-patterns',
] as const;
const allReportIds = [...itemReportIds, 'all-items-qa', 'special-ui-deeds'] as const;
const deedIds = [
  'chr_evergarden_first_harvest',
  'chr_marsh_first_harvest',
  'chr_peaks_first_harvest',
  'chr_vale_first_harvest',
  'col_deepest_cast',
  'col_farm_roster',
  'col_golden_harvest',
  'prog_farming_100',
  'prog_field_to_feast',
  'prog_first_planting',
  'prog_legendmaker',
] as const;
const supplementalKeys = [
  'aura:well_fed',
  'chrome:harvest-journal',
  'chrome:perfecting',
  'map-marker:farm-patch',
  'profession:gather_farming',
] as const;

type ScreenshotPin = {
  file: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
};

type CaptureWarningFrameGroup = {
  countPerFrame: number;
  frames: string[];
  assets?: Array<{ id: string; path: string }>;
};

type CaptureWarning = {
  category: 'http-502' | 'character-asset-not-preloaded';
  totalCount: number;
  frameGroups: CaptureWarningFrameGroup[];
};

type ScreenshotManifest = {
  schemaVersion: 1;
  mode: 'change-aware';
  files: ScreenshotPin[];
  captureWarnings: CaptureWarning[];
};

type ExactGeometry = {
  alphaThreshold: number;
  min: number;
  max: number;
  transparentPixels: number;
  translucentPixels: number;
  opaquePixels: number;
  visiblePixels: number;
  coverage: number;
  alphaBounds: [number, number, number, number] | null;
  padding: [number, number, number, number] | null;
  centerOffset: [number, number] | null;
};

type AcceptedPin = {
  width: number;
  height: number;
  format: string;
  colourspace: string;
  hasAlpha: boolean;
  alphaMode: string;
  geometry: ExactGeometry;
};

type ManifestAsset = {
  kind: 'item' | 'deed';
  id: string;
  change: string;
  generationReport: string;
  runtimeUrl: string;
  acceptedSha256: string;
  acceptedBytes: number;
  accepted: AcceptedPin;
  source: {
    path: string;
    sha256: string;
    bytes: number;
  };
};

type SupplementalAsset = {
  kind: 'profession' | 'aura' | 'map-marker' | 'chrome';
  id: string;
  runtimeUrl: string;
  acceptedSha256: string;
  acceptedBytes: number;
  accepted: AcceptedPin;
  generationReport: string;
};

type EvidencePin = {
  id: string;
  path: string;
  acceptedSha256: string;
  acceptedBytes: number;
  itemIds?: string[];
  assetIds?: string[];
};

type Supersession = {
  kind: 'item' | 'deed';
  id: string;
  previous: {
    shipping: { commit: string; sha256: string; bytes: number };
    provenanceClass: string;
    owner: Record<string, unknown>;
  };
  replacementReason: string;
  replacement: {
    batchId: string;
    runtimeUrl: string;
    acceptedSha256: string;
    acceptedBytes: number;
    generationReport: string;
  };
};

type Manifest = {
  schemaVersion: 1;
  batch: {
    id: string;
    acceptedDate: string;
    rasterGenerator: string;
    owner: string;
    license: string;
  };
  scope: Record<string, number>;
  historicalCurrentUnion: {
    historicalCount: number;
    replacedHistoricalCount: number;
    retainedHistoricalCount: number;
    currentBatchCount: number;
    currentCount: number;
    equation: string;
  };
  targetSets: {
    items: string[];
    addedItems: string[];
    replacedItems: string[];
    deeds: string[];
    supplementalUi: string[];
  };
  sourceEvidence: EvidencePin[];
  generationReports: EvidencePin[];
  assets: ManifestAsset[];
  supersedes: Supersession[];
  supplementalContracts: Record<
    SupplementalAsset['kind'],
    { width: number; height: number; maxBytes: number; alpha: string }
  >;
  supplementalAssets: SupplementalAsset[];
  contracts: Record<string, unknown>;
};

type ItemMapping = {
  entries: Array<{ itemId: string }>;
  generatedBatches: Array<{ batchId?: string; itemIds: string[] }>;
};

type SupersessionSnapshot = {
  schemaVersion: number;
  capturedAtCommit: string;
  records: Array<{
    itemId: string;
    previous: Supersession['previous'];
  }>;
};

const sorted = (values: Iterable<string>): string[] => [...values].sort();
const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

function readJson<T>(relative: string): T {
  return JSON.parse(readFileSync(path.join(repoRoot, relative), 'utf8')) as T;
}

function manifest(): Manifest {
  expect(existsSync(path.join(repoRoot, manifestPath)), 'completion manifest').toBe(true);
  return readJson<Manifest>(manifestPath);
}

function duplicateValues(values: string[]): string[] {
  return sorted(new Set(values.filter((value, index) => values.indexOf(value) !== index)));
}

function reportAssetIds(report: Record<string, unknown>): string[] {
  const records = (report.items ?? report.assets) as Array<{ id: string }> | undefined;
  return sorted((records ?? []).map(({ id }) => id));
}

// The generation reports record the AUTHORING MACHINE's absolute path for each master
// (/Users/<someone>/<their checkout>/tmp/imagegen/...), while the manifest pins the
// repo-relative form. Relativizing against this checkout's root only recovers that form when
// the test runs from the very path the art was generated on; anywhere else (CI, another
// clone, a worktree) path.relative walks up out of the repo and the comparison fails on a
// difference that is about the machine rather than the evidence. Every one of these masters
// lives under the generator's workspace root, so an absolute candidate is cut at that segment
// instead. An absolute path with no such segment still falls through to path.relative, so an
// unrecognized shape fails loudly rather than being silently accepted.
const GENERATOR_WORKSPACE_SEGMENT = 'tmp/imagegen/';
function repoRelative(candidate: string): string {
  const slashed = candidate.replaceAll(path.sep, '/');
  if (!path.isAbsolute(candidate)) return slashed;
  const at = slashed.indexOf(GENERATOR_WORKSPACE_SEGMENT);
  if (at >= 0) return slashed.slice(at);
  return path.relative(repoRoot, candidate).replaceAll(path.sep, '/');
}

function normalizedItemReportRecord(
  reportId: (typeof itemReportIds)[number],
  record: Record<string, unknown>,
): { id: string; path: string; sha256: string; bytes: number; exactPrompt: string } {
  const id = String(record.id);
  const acceptedMaster = record.acceptedMaster as Record<string, unknown> | string | undefined;
  const normalized = (() => {
    switch (reportId) {
      case 'crops':
        return {
          path: String(record.workspaceMaster),
          sha256: String(record.sourceSha256),
          bytes: Number(record.sourceBytes),
          exactPrompt: String(record.prompt),
        };
      case 'farming':
        return {
          path: String(record.acceptedMaster),
          sha256: String(record.sha256),
          bytes: Number(record.bytes),
          exactPrompt: String(record.exactPrompt),
        };
      case 'profession-new':
      case 'placeholder-patterns':
        return {
          path: String(record.acceptedMaster),
          sha256: String(record.sha256),
          bytes: Number(record.bytes),
          exactPrompt: ((record.promptLines as string[] | undefined) ?? []).join('\n'),
        };
      case 'placeholder-material-gear':
        return {
          path: String(record.acceptedMasterPath),
          sha256: String((acceptedMaster as Record<string, unknown> | undefined)?.sha256),
          bytes: Number((acceptedMaster as Record<string, unknown> | undefined)?.bytes),
          exactPrompt: String(record.exactPrompt),
        };
      case 'placeholder-apex':
        return {
          path: String(record.acceptedMaster),
          sha256: String(record.sha256),
          bytes: Number(record.bytes),
          exactPrompt: String(record.exactPrompt),
        };
    }
  })();
  return { id, ...normalized, path: repoRelative(normalized.path) };
}

function assertEvidencePin(pin: EvidencePin): void {
  const file = path.join(repoRoot, pin.path);
  expect(existsSync(file), pin.path).toBe(true);
  const bytes = readFileSync(file);
  expect(bytes.length, `${pin.path} bytes`).toBe(pin.acceptedBytes);
  expect(hash(bytes), `${pin.path} sha256`).toBe(pin.acceptedSha256);
}

function exactGeometry(alpha: ReturnType<typeof measureAlpha>): ExactGeometry {
  return {
    alphaThreshold: alpha.threshold,
    min: alpha.min,
    max: alpha.max,
    transparentPixels: alpha.transparentPixels,
    translucentPixels: alpha.translucentPixels,
    opaquePixels: alpha.opaquePixels,
    visiblePixels: alpha.visiblePixels,
    coverage: alpha.coverage,
    alphaBounds: alpha.bounds,
    padding: alpha.padding,
    centerOffset: alpha.centerOffset,
  };
}

async function assertSupplementalPin(
  asset: SupplementalAsset,
  contract: Manifest['supplementalContracts'][SupplementalAsset['kind']],
): Promise<void> {
  const file = path.join(repoRoot, 'public', asset.runtimeUrl.slice(1));
  const bytes = readFileSync(file);
  expect(bytes.length, `${asset.kind}:${asset.id} bytes`).toBe(asset.acceptedBytes);
  expect(hash(bytes), `${asset.kind}:${asset.id} sha256`).toBe(asset.acceptedSha256);
  const image = sharp(bytes, { failOn: 'warning' });
  const metadata = await image.metadata();
  expect(metadata.width, `${asset.kind}:${asset.id} width`).toBe(contract.width);
  expect(metadata.height, `${asset.kind}:${asset.id} height`).toBe(contract.height);
  expect(metadata.format, `${asset.kind}:${asset.id} format`).toBe('webp');
  expect(metadata.space, `${asset.kind}:${asset.id} colourspace`).toBe('srgb');
  expect(bytes.length, `${asset.kind}:${asset.id} weight`).toBeLessThanOrEqual(contract.maxBytes);
  const raw = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaPlane = new Uint8Array((metadata.width ?? 0) * (metadata.height ?? 0));
  for (let pixel = 0; pixel < alphaPlane.length; pixel++) {
    alphaPlane[pixel] = raw.data[pixel * raw.info.channels + raw.info.channels - 1];
  }
  const alpha = measureAlpha(alphaPlane, metadata.width ?? 0, metadata.height ?? 0, 8);
  const alphaMode =
    alpha.min === 255 && alpha.max === 255
      ? 'opaque'
      : alpha.min === 0 && alpha.max === 255
        ? 'transparent-subject'
        : 'translucent';
  expect(alphaMode, `${asset.kind}:${asset.id} alpha mode`).toBe(contract.alpha);
  expect(asset.accepted).toEqual({
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    colourspace: metadata.space,
    hasAlpha: metadata.hasAlpha,
    alphaMode,
    geometry: exactGeometry(alpha),
  });
}

describe('Masterwrought art completion evidence', () => {
  it('keeps one exact byte-sealed screenshot batch', () => {
    const manifestBytes = readFileSync(path.join(repoRoot, screenshotDir, 'manifest.json'));
    expect(manifestBytes.length).toBe(6_885);
    expect(hash(manifestBytes)).toBe(
      '760c783b5ea54aa2ae330385862fca9ceeca8b3db4f9f961aaf617bc28d5ee75',
    );
    const value = JSON.parse(manifestBytes.toString('utf8')) as ScreenshotManifest;
    expect(value.schemaVersion).toBe(1);
    expect(value.mode).toBe('change-aware');
    expect(value.files.map(({ file }) => file)).toEqual([...screenshotFiles]);
    expect(duplicateValues(value.files.map(({ file }) => file))).toEqual([]);

    const directory = path.join(repoRoot, screenshotDir);
    const entries = readdirSync(directory, { withFileTypes: true });
    expect(
      entries.every((entry) => entry.isFile()),
      'screenshot batch contains files only',
    ).toBe(true);
    expect(sorted(entries.map(({ name }) => name))).toEqual(
      sorted(['manifest.json', ...screenshotFiles]),
    );

    for (const pin of value.files) {
      const bytes = readFileSync(path.join(directory, pin.file));
      expect(bytes.subarray(0, 8).toString('hex'), `${pin.file} PNG signature`).toBe(
        '89504e470d0a1a0a',
      );
      expect(bytes.subarray(12, 16).toString('ascii'), `${pin.file} PNG header`).toBe('IHDR');
      expect(pin, pin.file).toEqual({
        file: pin.file,
        sha256: hash(bytes),
        bytes: bytes.length,
        width: bytes.readUInt32BE(16),
        height: bytes.readUInt32BE(20),
      });
    }

    const frameIds = screenshotFiles.map((file) => file.replace(/^\d+-/, '').replace(/\.png$/, ''));
    const desktopFrames = frameIds.filter((frame) => !frame.includes('-mobile'));
    const mobileFrames = frameIds.filter((frame) => frame.includes('-mobile'));
    const threeHttpFrames = [
      'after-masterwrought-art-items-desktop',
      'after-masterwrought-art-farm-map-desktop',
    ];
    const twoHttpFrames = frameIds.filter((frame) => !threeHttpFrames.includes(frame));
    const [httpWarning, characterWarning] = value.captureWarnings;

    expect(httpWarning).toMatchObject({ category: 'http-502', totalCount: 28 });
    expect(httpWarning?.frameGroups).toEqual([
      { countPerFrame: 3, frames: threeHttpFrames },
      { countPerFrame: 2, frames: twoHttpFrames },
    ]);
    expect(characterWarning).toMatchObject({
      category: 'character-asset-not-preloaded',
      totalCount: 62,
    });
    expect(
      characterWarning?.frameGroups.map(({ countPerFrame, frames }) => ({
        countPerFrame,
        frames,
      })),
    ).toEqual([
      { countPerFrame: 2, frames: desktopFrames },
      { countPerFrame: 11, frames: mobileFrames },
    ]);

    for (const warning of value.captureWarnings) {
      const warnedFrames = warning.frameGroups.flatMap(({ frames }) => frames);
      expect(duplicateValues(warnedFrames), `${warning.category} duplicate frames`).toEqual([]);
      expect(sorted(warnedFrames), `${warning.category} frame coverage`).toEqual(sorted(frameIds));
      expect(
        warning.frameGroups.reduce(
          (count, group) => count + group.countPerFrame * group.frames.length,
          0,
        ),
        `${warning.category} warning count`,
      ).toBe(warning.totalCount);
      for (const group of warning.frameGroups) {
        if (warning.category === 'http-502') {
          expect(group.assets, 'HTTP warning has no asset list').toBeUndefined();
          continue;
        }
        expect(group.assets, 'one missing-asset record per warning').toHaveLength(
          group.countPerFrame,
        );
        for (const asset of group.assets ?? []) {
          expect(asset.id, 'missing asset id').toMatch(/^[a-z0-9_]+$/);
          expect(asset.path, `${asset.id} path`).toMatch(/^models\/.+\.glb$/);
        }
      }
    }
  });

  it('byte-seals the root manifest so its target and evidence oracles cannot drift together', () => {
    const bytes = readFileSync(path.join(repoRoot, manifestPath));
    expect(bytes.length).toBe(459_411);
    expect(hash(bytes)).toBe('394deade31d5bb7866cc355d7b42405e22a5a1961ab2bd4dc568d7ee59e87233');
  });

  it('pins the exact 176-target scope and the 81 added to 84 replaced item split', () => {
    const value = manifest();
    expect(value.batch).toEqual({
      id: batchId,
      acceptedDate: '2026-09-02',
      rasterGenerator: 'OpenAI built-in image generation',
      owner: 'World of ClaudeCraft',
      license: 'World of ClaudeCraft project-generated art, project asset, rights reserved',
    });
    expect(value.scope).toEqual({
      acceptedAuditAssets: 176,
      itemPaintings: 165,
      addedItemPaintings: 81,
      replacedItemPaintings: 84,
      deedPaintings: 11,
      addedDeedPaintings: 10,
      replacedDeedPaintings: 1,
      supersessions: 85,
      supplementalUiAssets: 5,
      generationReports: 8,
      historicalItemPaintings: 1128,
      retainedHistoricalItemPaintings: 1044,
      currentItemPaintings: 1209,
    });

    expect(value.targetSets.items).toHaveLength(165);
    expect(value.targetSets.addedItems).toHaveLength(81);
    expect(value.targetSets.replacedItems).toHaveLength(84);
    expect(value.targetSets.deeds).toEqual([...deedIds]);
    expect(value.targetSets.supplementalUi).toEqual([...supplementalKeys]);
    expect(duplicateValues(value.targetSets.items)).toEqual([]);
    expect(
      duplicateValues([...value.targetSets.addedItems, ...value.targetSets.replacedItems]),
    ).toEqual([]);
    expect(sorted([...value.targetSets.addedItems, ...value.targetSets.replacedItems])).toEqual(
      value.targetSets.items,
    );

    const expectedKeys = [
      ...value.targetSets.items.map((id) => `item:${id}`),
      ...deedIds.map((id) => `deed:${id}`),
    ].sort();
    expect(value.assets.map(({ kind, id }) => `${kind}:${id}`).sort()).toEqual(expectedKeys);
    expect(duplicateValues(value.assets.map(({ kind, id }) => `${kind}:${id}`))).toEqual([]);
    expect(
      sorted(
        value.assets
          .filter(({ kind, change }) => kind === 'item' && change === 'added-painting')
          .map(({ id }) => id),
      ),
    ).toEqual(value.targetSets.addedItems);
    expect(
      sorted(
        value.assets
          .filter(({ kind, change }) => kind === 'item' && change === 'replaced-placeholder')
          .map(({ id }) => id),
      ),
    ).toEqual(value.targetSets.replacedItems);
  });

  it('seals every copied report and makes the six item reports a disjoint complete partition', () => {
    const value = manifest();
    expect(value.generationReports.map(({ id }) => id)).toEqual([...allReportIds]);
    for (const pin of [...value.generationReports, ...value.sourceEvidence]) assertEvidencePin(pin);

    const reportUnion: string[] = [];
    const manifestItemsById = new Map(
      value.assets.filter(({ kind }) => kind === 'item').map((asset) => [asset.id, asset]),
    );
    for (const id of itemReportIds) {
      const pin = value.generationReports.find((entry) => entry.id === id);
      expect(pin, id).toBeDefined();
      const report = readJson<Record<string, unknown>>(
        `${evidenceDir}/generation-reports/${id}.json`,
      );
      const ids = reportAssetIds(report);
      expect(pin?.itemIds, `${id} pinned item IDs`).toEqual(ids);
      reportUnion.push(...ids);
      const records = (report.items ?? report.assets) as Array<Record<string, unknown>>;
      for (const record of records) {
        const source = normalizedItemReportRecord(id, record);
        const asset = manifestItemsById.get(source.id);
        expect(asset, `${id}:${source.id} manifest asset`).toBeDefined();
        expect(asset?.generationReport, `${id}:${source.id} report assignment`).toBe(pin?.path);
        expect(asset?.source, `${id}:${source.id} source pin`).toMatchObject({
          path: source.path,
          sha256: source.sha256,
          bytes: source.bytes,
        });
        // The normalization is machine-independent or this whole comparison is: a path that
        // still carries an absolute root, or climbs out of the repo, means the record's shape
        // was not recognized and the pin above would only hold on the machine that wrote it.
        expect(source.path, `${id}:${source.id} normalized to a repo-relative path`).toMatch(
          /^[A-Za-z0-9_.]/,
        );
        expect(source.path, `${id}:${source.id} normalized inside the repo`).not.toContain('..');
        expect(source.exactPrompt.length, `${id}:${source.id} exact prompt`).toBeGreaterThan(500);
      }
    }
    expect(duplicateValues(reportUnion)).toEqual([]);
    expect(sorted(reportUnion)).toEqual(value.targetSets.items);

    const allItemsQa = readJson<{
      scope: { auditedMasterCount: number; batches: Array<{ auditedIds: string[] }> };
      result: { acceptedCount: number; rejectedCount: number; blockingFindings: unknown[] };
    }>(`${evidenceDir}/generation-reports/all-items-qa.json`);
    expect(allItemsQa.scope.auditedMasterCount).toBe(165);
    expect(sorted(allItemsQa.scope.batches.flatMap(({ auditedIds }) => auditedIds))).toEqual(
      value.targetSets.items,
    );
    expect(allItemsQa.result).toMatchObject({ acceptedCount: 165, rejectedCount: 0 });
    expect(allItemsQa.result.blockingFindings).toEqual([]);

    const special = readJson<{
      assets: Array<{ id: string; category: string; exactPrompt: string }>;
    }>(`${evidenceDir}/generation-reports/special-ui-deeds.json`);
    const specialPin = value.generationReports.find(({ id }) => id === 'special-ui-deeds');
    expect(specialPin?.assetIds).toEqual(special.assets.map(({ id }) => id));
    expect(
      sorted(special.assets.filter(({ category }) => category === 'deeds').map(({ id }) => id)),
    ).toEqual([...deedIds]);
    const specialIds = new Set(special.assets.map(({ id }) => id));
    for (const asset of value.assets.filter(({ kind }) => kind === 'deed')) {
      expect(asset.generationReport, `deed:${asset.id} report assignment`).toBe(specialPin?.path);
      expect(specialIds.has(asset.id), `deed:${asset.id} report membership`).toBe(true);
    }
    for (const asset of value.supplementalAssets.filter(
      ({ kind }) => kind === 'map-marker' || kind === 'chrome',
    )) {
      const reportId = asset.id === 'farm-patch' ? 'farm_patch' : asset.id;
      expect(asset.generationReport, `${asset.kind}:${asset.id} report assignment`).toBe(
        specialPin?.path,
      );
      expect(specialIds.has(reportId), `${asset.kind}:${asset.id} report membership`).toBe(true);
    }
    for (const asset of special.assets) {
      expect(asset.exactPrompt.length, `special:${asset.id} exact prompt`).toBeGreaterThan(500);
    }

    const rootSpecialPath = `${evidenceDir}/generation-reports/root-special.json`;
    const rootSpecial = readJson<{
      assets: Array<{
        id: string;
        runtimeUrl: string;
        acceptedShipping: { sha256: string; bytes: number };
        exactPrompt: string;
        references: unknown[];
      }>;
    }>(rootSpecialPath);
    for (const record of rootSpecial.assets) {
      const asset = value.supplementalAssets.find(({ id }) => id === record.id);
      expect(asset, `root-special:${record.id} manifest asset`).toBeDefined();
      expect(asset?.generationReport, `root-special:${record.id} report assignment`).toBe(
        rootSpecialPath,
      );
      expect(record).toMatchObject({
        runtimeUrl: asset?.runtimeUrl,
        acceptedShipping: {
          sha256: asset?.acceptedSha256,
          bytes: asset?.acceptedBytes,
        },
      });
      expect(record.exactPrompt.length, `root-special:${record.id} exact prompt`).toBeGreaterThan(
        500,
      );
      expect(
        record.references.length,
        `root-special:${record.id} ordered references`,
      ).toBeGreaterThan(0);
    }
  });

  it('pins all 85 predecessor records and links each one to its accepted replacement', () => {
    const value = manifest();
    const snapshot = readJson<SupersessionSnapshot>(`${evidenceDir}/supersession-before.json`);
    expect(snapshot.records).toHaveLength(84);
    expect(value.supersedes).toHaveLength(85);
    expect(duplicateValues(value.supersedes.map(({ kind, id }) => `${kind}:${id}`))).toEqual([]);

    const supersessionByKey = new Map(
      value.supersedes.map((record) => [`${record.kind}:${record.id}`, record]),
    );
    expect(sorted(snapshot.records.map(({ itemId }) => itemId))).toEqual(
      value.targetSets.replacedItems,
    );
    for (const prior of snapshot.records) {
      const record = supersessionByKey.get(`item:${prior.itemId}`);
      expect(record?.previous, prior.itemId).toEqual(prior.previous);
      const asset = value.assets.find(({ kind, id }) => kind === 'item' && id === prior.itemId);
      expect(record?.replacement, prior.itemId).toEqual({
        batchId,
        runtimeUrl: asset?.runtimeUrl,
        acceptedSha256: asset?.acceptedSha256,
        acceptedBytes: asset?.acceptedBytes,
        generationReport: asset?.generationReport,
      });
      expect(record?.replacementReason.trim().length, prior.itemId).toBeGreaterThan(0);
      expect(record?.replacement.acceptedSha256, `${prior.itemId} replacement hash`).not.toBe(
        record?.previous.shipping.sha256,
      );
    }

    const farming = supersessionByKey.get('deed:prog_farming_100');
    expect(farming?.previous.shipping).toEqual({
      commit: '103934491b9cdc72cbad99c4601919962b871fd7',
      sha256: '37e9b224a230276fddc28c82b6842238524663b984c1c4e5b12583047bf21b28',
      bytes: 5678,
    });
    const replacement = value.assets.find(
      ({ kind, id }) => kind === 'deed' && id === 'prog_farming_100',
    );
    expect(farming?.replacement).toEqual({
      batchId,
      runtimeUrl: replacement?.runtimeUrl,
      acceptedSha256: replacement?.acceptedSha256,
      acceptedBytes: replacement?.acceptedBytes,
      generationReport: replacement?.generationReport,
    });
    expect(farming?.replacement.acceptedSha256).not.toBe(farming?.previous.shipping.sha256);
  });

  it('passes the shared image audit with exact current shipping metadata and geometry', async () => {
    const value = manifest();
    expect(() => validateAcceptedArtManifest(value)).not.toThrow();
    const report = await auditIconAssets({ manifest: value, repoRoot });
    expect(report.summary).toMatchObject({
      ok: true,
      assetCount: 176,
      issueCount: 0,
      exactDuplicateGroupCount: 0,
    });
    expect(report.exactDuplicates).toEqual([]);

    const manifestByKey = new Map(
      value.assets.map((asset) => [`${asset.kind}:${asset.id}`, asset]),
    );
    for (const audited of report.assets) {
      const asset = manifestByKey.get(`${audited.kind}:${audited.id}`);
      expect(audited.issues, `${audited.kind}:${audited.id}`).toEqual([]);
      if (!audited.alpha) throw new Error(`missing alpha measurement for ${audited.id}`);
      expect(asset?.accepted, `${audited.kind}:${audited.id} exact metadata`).toEqual({
        width: audited.width,
        height: audited.height,
        format: audited.format,
        colourspace: audited.colourspace,
        hasAlpha: audited.hasAlpha,
        alphaMode: audited.alphaMode,
        geometry: exactGeometry(audited.alpha),
      });
    }
  });

  it('pins the five supplemental UI files and their registry provenance', async () => {
    const value = manifest();
    expect(value.supplementalAssets.map(({ kind, id }) => `${kind}:${id}`).sort()).toEqual([
      ...supplementalKeys,
    ]);
    for (const asset of value.supplementalAssets) {
      await assertSupplementalPin(asset, value.supplementalContracts[asset.kind]);
    }

    const professions = readJson<{
      entries: Array<{ id: string; source: string; sourceSha256: string }>;
    }>('public/ui/professions/mapping.json');
    expect(professions.entries.find(({ id }) => id === 'gather_farming')).toEqual({
      id: 'gather_farming',
      name: 'Farming',
      batch: 'batch-6',
      acceptedVersion: 'v1',
      source: 'batch-6/masters/gather_farming.png',
      sourceSha256: '82811b427c9c35994d49e2c77241a491867448dc05fe41142d7cf3d3fd0cf317',
      license: 'World of ClaudeCraft original art (project-owned, created for this game)',
    });

    const auras = readJson<{
      assets: Array<{
        auraId: string;
        acceptedSha256: string;
        acceptedBytes: number;
        sourceProvenance: string;
      }>;
    }>('public/ui/auras/mapping.json');
    expect(auras.assets.find(({ auraId }) => auraId === 'well_fed')).toMatchObject({
      acceptedSha256: '574bc0be1b4c524e2d49395a7e102b135ea8f78792a2b0cd667aa26dc223b602',
      acceptedBytes: 3468,
      sourceProvenance: `${evidenceDir}/generation-reports/root-special.json`,
    });

    const markers = readJson<{
      entries: Array<{
        id: string;
        shippingSha256: string;
        bytes: number;
        promptRef: string;
      }>;
    }>('public/ui/map-markers/mapping.json');
    expect(markers.entries.find(({ id }) => id === 'farm-patch')).toMatchObject({
      shippingSha256: 'ac433b15f4352d0b449fd85d5184e6115a1cbc02e30bca375055db176bb3bfee',
      bytes: 2634,
      promptRef: `${evidenceDir}/README.md#farm-patch`,
    });

    const chrome = readJson<{ entries: Array<{ icon: string; source?: string }> }>(
      'public/ui/chrome/mapping.json',
    );
    for (const id of ['harvest-journal', 'perfecting']) {
      const entry = chrome.entries.find(({ icon }) => icon === id);
      expect(entry?.source, id).toContain(
        `${evidenceDir}/generation-reports/special-ui-deeds.json`,
      );
    }
  });

  it('proves the historical to current 1209-item union and the mapping batch equality', () => {
    const value = manifest();
    const mapping = readJson<ItemMapping>('public/ui/items/mapping.json');
    const currentBatch = mapping.generatedBatches.find(({ batchId: id }) => id === batchId);
    expect(currentBatch?.itemIds).toEqual(value.targetSets.items);

    const currentOwnerIds = [
      ...mapping.entries.map(({ itemId }) => itemId),
      ...mapping.generatedBatches.flatMap(({ itemIds }) => itemIds),
    ];
    expect(duplicateValues(currentOwnerIds)).toEqual([]);
    expect(currentOwnerIds).toHaveLength(1209);
    const retainedHistoricalIds = currentOwnerIds.filter(
      (id) => !value.targetSets.items.includes(id),
    );
    expect(retainedHistoricalIds).toHaveLength(1044);
    expect(retainedHistoricalIds.length + value.targetSets.replacedItems.length).toBe(1128);
    expect(retainedHistoricalIds.length + value.targetSets.items.length).toBe(1209);
    expect(value.historicalCurrentUnion).toEqual({
      historicalCount: 1128,
      replacedHistoricalCount: 84,
      retainedHistoricalCount: 1044,
      currentBatchCount: 165,
      currentCount: 1209,
      equation: '1128 - 84 + 165 = 1209',
    });
  });

  it('keeps the exact farm-patch prompt and ordered references at its stable README anchor', () => {
    const readme = readFileSync(path.join(repoRoot, evidenceDir, 'README.md'), 'utf8');
    const special = readJson<{
      assets: Array<{
        id: string;
        exactPrompt: string;
        references: Array<{ path: string }>;
      }>;
    }>(`${evidenceDir}/generation-reports/special-ui-deeds.json`);
    const farmPatch = special.assets.find(({ id }) => id === 'farm_patch');
    expect(farmPatch).toBeDefined();
    expect(farmPatch?.exactPrompt.length).toBeGreaterThan(500);
    expect(readme).toContain('### farm-patch');
    expect(readme).toContain('References, in order:');
    expect(readme).toContain(`\`\`\`text\n${farmPatch?.exactPrompt}\n\`\`\``);
    for (const reference of farmPatch?.references ?? []) expect(readme).toContain(reference.path);
    expect(readme).toContain(
      `Prompt SHA-256: \`${hash(Buffer.from(farmPatch?.exactPrompt ?? '', 'utf8'))}\``,
    );
  });

  it('pins the operative credits and consolidated supersession lineage', () => {
    const credits = readFileSync(path.join(repoRoot, 'CREDITS.md'), 'utf8');
    const requiredRows = [
      [
        '| Professions 2.0 commissioned art set',
        '73a7a9e964cc7f51422ba3837bf9e40b8d40629ba48088376bd3dbddf843c4b8',
      ],
      [
        '| Masterwrought art-completion wave (181 painted assets',
        '93b63a5bd6aff180f185ced2b760b34b70271747c0cbaad92415abf10c0a2786',
      ],
      [
        '| Exact runtime aura paintings (`public/ui/auras/*.webp`)',
        '0accf6ccfced9b22e02350828672d519f1c52ccbab6436a8336bb5f29d70aa39',
      ],
      [
        '| Masterwrought farming, fishing, and promotion deed crests',
        '796fa371a23b0d54bb939abd49e17867168b75009c269684f66712c663b5a2ac',
      ],
      [
        '| HUD chrome launcher icons (`public/ui/chrome/*.webp`',
        'd93e1808bea695afe46fbae5d9f98ee0a90a704b8e3b70a2bbac431a3fa96896',
      ],
      [
        '| Map and minimap marker paintings (`public/ui/map-markers/*.webp`)',
        'c9ff4351802321cffcbdcf145ef4db9b853d9900889eb00bbc222418326c500c',
      ],
    ] as const;
    const rows = credits.split('\n');
    for (const [prefix, expectedHash] of requiredRows) {
      const matches = rows.filter((row) => row.startsWith(prefix));
      expect(matches, `${prefix} exact row`).toHaveLength(1);
      expect(hash(Buffer.from(matches[0] ?? '', 'utf8')), `${prefix} row hash`).toBe(expectedHash);
    }
  });
});
