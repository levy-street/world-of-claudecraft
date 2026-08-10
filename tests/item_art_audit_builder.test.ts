import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertItemArtAuditPass,
  buildItemArtAudit,
  evaluateItemArtMachineChecks,
  ITEM_ART_AUDIT_MODES,
  ITEM_ART_AUDIT_RENDERER_FINGERPRINT,
  ITEM_ART_AUDIT_REVIEW_MODES,
  paginateItemArtAuditRecords,
  renderItemArtAuditPreview,
  updateItemArtAuditVerdict,
} from '../scripts/lib/item_art_audit.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoots: string[] = [];

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

type FixtureItem = {
  name: string;
  kind: string;
  quality?: string;
  heroicOf?: string;
};

async function buildFixture(options: {
  images: Record<string, Buffer>;
  items?: Record<string, FixtureItem>;
  mapping?: {
    entries?: Array<{ itemId: string }>;
    generatedBatches?: Array<{ itemIds: string[] }>;
  };
}) {
  const root = mkdtempSync(path.join(tmpdir(), 'woc-item-art-fixture-'));
  temporaryRoots.push(root);
  const itemDirectory = 'public/ui/items';
  mkdirSync(path.join(root, itemDirectory), { recursive: true });
  for (const [id, bytes] of Object.entries(options.images)) {
    writeFileSync(path.join(root, itemDirectory, `${id}.webp`), bytes);
  }
  const ids = Object.keys(options.images);
  return buildItemArtAudit({
    repoRoot: root,
    itemDirectory,
    outputDirectory: 'tmp/item-art-audit',
    renderOutputs: false,
    items:
      options.items ??
      Object.fromEntries(ids.map((id) => [id, { name: id, kind: 'weapon', quality: 'common' }])),
    mapping: options.mapping ?? {
      entries: ids.map((itemId) => ({ itemId })),
      generatedBatches: [],
    },
  });
}

async function solidWebp(
  width = 128,
  height = 128,
  background: { r: number; g: number; b: number; alpha?: number } = {
    r: 80,
    g: 100,
    b: 120,
  },
): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: background.alpha === undefined ? 3 : 4,
      background,
    },
  })
    .webp({ quality: 82 })
    .toBuffer();
}

async function sheetPins(root: string, paths: string[]): Promise<Array<[string, string]>> {
  return Promise.all(
    paths.map(async (relativePath) => {
      const bytes = readFileSync(path.join(root, relativePath));
      const metadata = await sharp(bytes).metadata();
      expect(metadata.format).toBe('png');
      return [relativePath, sha256(bytes)];
    }),
  );
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('item-art audit builder', () => {
  it('pins the exact 80-item page membership used to render sheet contents', () => {
    const ids = Array.from(
      { length: 161 },
      (_, index) => `item_${String(index + 1).padStart(3, '0')}`,
    );
    const pages = paginateItemArtAuditRecords(ids);
    expect(pages.map((page) => page.length)).toEqual([80, 80, 1]);
    expect(pages[0]).toEqual(ids.slice(0, 80));
    expect(pages[1]).toEqual(ids.slice(80, 160));
    expect(pages[2]).toEqual(['item_161']);
  });

  it('rebuilds one deterministic sheet per catalog page and review mode, including 22-color', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'woc-item-art-audit-'));
    temporaryRoots.push(root);
    const itemDirectory = 'public/ui/items';
    const outputDirectory = 'tmp/item-art-audit';
    mkdirSync(path.join(root, itemDirectory), { recursive: true });
    const red = await sharp({
      create: {
        width: 128,
        height: 128,
        channels: 3,
        background: { r: 150, g: 24, b: 35 },
      },
    })
      .webp({ quality: 82 })
      .toBuffer();
    const blue = await sharp({
      create: {
        width: 128,
        height: 128,
        channels: 3,
        background: { r: 22, g: 62, b: 150 },
      },
    })
      .webp({ quality: 82 })
      .toBuffer();
    writeFileSync(path.join(root, itemDirectory, 'alpha_blade.webp'), red);
    writeFileSync(path.join(root, itemDirectory, 'beta_blade.webp'), blue);
    const items = {
      alpha_blade: { name: 'Alpha Blade', kind: 'weapon', quality: 'common' },
      beta_blade: { name: 'Beta Blade', kind: 'weapon', quality: 'rare' },
      heroic_alpha_blade: {
        name: 'Heroic Alpha Blade',
        kind: 'weapon',
        quality: 'epic',
        heroicOf: 'alpha_blade',
      },
    };
    const mapping = {
      entries: [{ itemId: 'alpha_blade' }, { itemId: 'beta_blade' }],
      generatedBatches: [],
    };

    await expect(
      buildItemArtAudit({
        repoRoot: root,
        itemDirectory,
        outputDirectory: 'public/audit-output',
        items,
        mapping,
      }),
    ).rejects.toThrow('outputDirectory must resolve inside the repository tmp/ directory');

    const first = await buildItemArtAudit({
      repoRoot: root,
      itemDirectory,
      outputDirectory,
      items,
      mapping,
    });
    await expect(
      buildItemArtAudit({
        repoRoot: root,
        itemDirectory,
        outputDirectory,
        items,
        mapping: { entries: [{ itemId: 'alpha_blade' }], generatedBatches: [] },
      }),
    ).rejects.toThrow('mapping.json owners and shipping item-art files must be a bijection');
    expect(ITEM_ART_AUDIT_MODES).toEqual([
      '128-color',
      '40-color',
      '28-color',
      '22-color',
      '28-grayscale',
      '64-circle',
      'small-multiview',
      'identity',
    ]);
    expect(ITEM_ART_AUDIT_REVIEW_MODES).toEqual([
      '128-color',
      '40-color',
      '28-color',
      '22-color',
      '28-grayscale',
      '64-circle',
      'small-multiview',
      'identity-display-name-and-id',
    ]);
    expect(first.catalog).toMatchObject({
      schemaVersion: 1,
      generator: { script: 'scripts/item_art_audit.mjs', contractVersion: 1 },
      catalogCount: 2,
      liveItemCount: 3,
      generatedHeroicDefinitions: 1,
      heroicDefinitionsWithOwnWebp: 0,
      heroicWeaponArtAliases: 1,
      groups: { weapon: 2 },
      sheetPaths: ITEM_ART_AUDIT_MODES.map(
        (mode) => `${outputDirectory}/sheets/weapon--p01--${mode}.png`,
      ),
    });
    expect(first.catalog.machineChecks).toMatchObject({
      passed: true,
      invalid: [],
      duplicateHashes: [],
    });
    expect(first.catalog.records[0]).toMatchObject({
      id: 'alpha_blade',
      aliases: ['heroic_alpha_blade'],
      path: `${itemDirectory}/alpha_blade.webp`,
    });
    const firstCatalogBytes = readFileSync(path.join(root, outputDirectory, 'catalog.json'));
    const firstPins = await sheetPins(root, first.catalog.sheetPaths);
    expect(firstPins).toHaveLength(8);
    expect(firstPins.find(([sheet]) => sheet.endsWith('--22-color.png'))).toBeDefined();

    const patternPath = path.join(root, 'pattern.webp');
    const pattern = Buffer.alloc(128 * 128 * 3);
    for (let offset = 0; offset < pattern.length; offset += 3) {
      const pixel = offset / 3;
      const x = pixel % 128;
      const y = Math.floor(pixel / 128);
      pattern[offset] = x * 2;
      pattern[offset + 1] = y * 2;
      pattern[offset + 2] = (x + y) % 256;
    }
    await sharp(pattern, { raw: { width: 128, height: 128, channels: 3 } })
      .webp({ quality: 100, lossless: true })
      .toFile(patternPath);
    const preview = await renderItemArtAuditPreview(patternPath, '22-color');
    expect({ width: preview.width, height: preview.height }).toEqual({ width: 110, height: 110 });
    const expectedTwentyTwoPixels = await sharp(patternPath)
      .resize(22, 22, { fit: 'fill', kernel: 'lanczos3' })
      .removeAlpha()
      .raw()
      .toBuffer();
    const recoveredTwentyTwoPixels = await sharp(preview.buffer)
      .resize(22, 22, { fit: 'fill', kernel: 'nearest' })
      .removeAlpha()
      .raw()
      .toBuffer();
    expect(recoveredTwentyTwoPixels).toEqual(expectedTwentyTwoPixels);
    const raw = await sharp(preview.buffer).raw().toBuffer();
    for (let y = 0; y < 110; y += 1) {
      for (let x = 0; x < 110; x += 1) {
        const sourceX = x - (x % 5);
        const sourceY = y - (y % 5);
        const offset = (y * 110 + x) * 3;
        const sourceOffset = (sourceY * 110 + sourceX) * 3;
        expect(raw.subarray(offset, offset + 3)).toEqual(
          raw.subarray(sourceOffset, sourceOffset + 3),
        );
      }
    }
    const horizontalSamples = new Set(
      Array.from({ length: 22 }, (_, sample) => raw[(52 * 110 + sample * 5 + 2) * 3]),
    );
    const verticalSamples = new Set(
      Array.from({ length: 22 }, (_, sample) => raw[((sample * 5 + 2) * 110 + 52) * 3 + 1]),
    );
    expect(horizontalSamples.size, '22 independent horizontal source samples').toBe(22);
    expect(verticalSamples.size, '22 independent vertical source samples').toBe(22);

    const staleSheet = path.join(root, outputDirectory, 'sheets/stale.png');
    writeFileSync(staleSheet, red);
    const second = await buildItemArtAudit({
      repoRoot: root,
      itemDirectory,
      outputDirectory,
      items,
      mapping,
    });
    expect(existsSync(staleSheet), 'a rebuild must remove stale sheet evidence').toBe(false);
    expect(readFileSync(path.join(root, outputDirectory, 'catalog.json'))).toEqual(
      firstCatalogBytes,
    );
    expect(await sheetPins(root, second.catalog.sheetPaths)).toEqual(firstPins);
  });

  it('rejects every unsupported ownership and Heroic alias shape', async () => {
    const icon = await solidWebp();
    await expect(
      buildFixture({
        images: { base_blade: icon },
        mapping: {
          entries: [{ itemId: 'base_blade' }, { itemId: 'extra_blade' }],
          generatedBatches: [],
        },
      }),
    ).rejects.toThrow('mapping.json owners and shipping item-art files must be a bijection');

    await expect(
      buildFixture({
        images: { base_blade: icon },
        mapping: {
          entries: [{ itemId: 'base_blade' }],
          generatedBatches: [{ itemIds: ['base_blade'] }],
        },
      }),
    ).rejects.toThrow('base_blade must have exactly one current provenance owner');

    await expect(
      buildFixture({
        images: { base_blade: icon },
        items: {
          base_blade: { name: 'Base Blade', kind: 'weapon' },
          missing_blade: { name: 'Missing Blade', kind: 'weapon' },
        },
      }),
    ).rejects.toThrow('Live item definitions without dedicated art: missing_blade');

    await expect(
      buildFixture({
        images: { base_blade: icon },
        items: {
          base_blade: { name: 'Base Blade', kind: 'weapon' },
          heroic_helm: { name: 'Heroic Helm', kind: 'armor', heroicOf: 'base_blade' },
        },
      }),
    ).rejects.toThrow('Only heroic weapons may intentionally alias base art');

    await expect(
      buildFixture({
        images: { other_blade: icon },
        items: {
          other_blade: { name: 'Other Blade', kind: 'weapon' },
          heroic_blade: {
            name: 'Heroic Blade',
            kind: 'weapon',
            heroicOf: 'absent_base_blade',
          },
        },
      }),
    ).rejects.toThrow('Every heroic weapon art alias must reference a shipping base-art file');
  });

  it('independently rejects every shipping machine-constraint failure and duplicate art', async () => {
    const png = await sharp({
      create: {
        width: 128,
        height: 128,
        channels: 3,
        background: { r: 80, g: 100, b: 120 },
      },
    })
      .png()
      .toBuffer();
    const cmyk = await sharp({
      create: {
        width: 128,
        height: 128,
        channels: 3,
        background: { r: 80, g: 100, b: 120 },
      },
    })
      .toColorspace('cmyk')
      .tiff()
      .toBuffer();
    const noise = Buffer.alloc(128 * 128 * 3);
    let state = 0x12345678;
    for (let index = 0; index < noise.length; index += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      noise[index] = state & 0xff;
    }
    const oversized = await sharp(noise, { raw: { width: 128, height: 128, channels: 3 } })
      .webp({ lossless: true })
      .toBuffer();
    expect(oversized.length).toBeGreaterThan(15 * 1024);

    const cases = [
      {
        label: 'width',
        bytes: await solidWebp(127, 128),
        check: (record: { width: number }) => expect(record.width).toBe(127),
      },
      {
        label: 'height',
        bytes: await solidWebp(128, 127),
        check: (record: { height: number }) => expect(record.height).toBe(127),
      },
      {
        label: 'format',
        bytes: png,
        check: (record: { format: string }) => expect(record.format).toBe('png'),
      },
      {
        label: 'colorspace',
        bytes: cmyk,
        check: (record: { colorspace: string }) => expect(record.colorspace).not.toBe('srgb'),
      },
      {
        label: 'opacity',
        bytes: await solidWebp(128, 128, { r: 80, g: 100, b: 120, alpha: 0.5 }),
        check: (record: { opaque: boolean }) => expect(record.opaque).toBe(false),
      },
      {
        label: 'byte budget',
        bytes: oversized,
        check: (record: { bytes: number }) => expect(record.bytes).toBeGreaterThan(15 * 1024),
      },
    ];

    for (const fixture of cases) {
      const build = await buildFixture({ images: { [`invalid_${fixture.label}`]: fixture.bytes } });
      expect(build.catalog.machineChecks.invalid, fixture.label).toHaveLength(1);
      fixture.check(build.catalog.machineChecks.invalid[0]);
      expect(() => assertItemArtAuditPass(build), fixture.label).toThrow(
        'Item-art machine checks failed',
      );
    }

    const duplicate = await solidWebp(128, 128, { r: 30, g: 50, b: 70 });
    const duplicateBuild = await buildFixture({
      images: { duplicate_a: duplicate, duplicate_b: duplicate },
    });
    expect(duplicateBuild.catalog.machineChecks.invalid).toEqual([]);
    expect(duplicateBuild.catalog.machineChecks.duplicateHashes).toEqual([
      { sha256: sha256(duplicate), ids: ['duplicate_a', 'duplicate_b'] },
    ]);
    expect(() => assertItemArtAuditPass(duplicateBuild)).toThrow('Item-art machine checks failed');

    const validRecord = (await buildFixture({ images: { machine_oracle: await solidWebp() } }))
      .catalog.records[0];
    const isolatedFailures = [
      { label: 'width below', record: { ...validRecord, width: 127 } },
      { label: 'width above', record: { ...validRecord, width: 129 } },
      { label: 'height below', record: { ...validRecord, height: 127 } },
      { label: 'height above', record: { ...validRecord, height: 129 } },
      { label: 'format', record: { ...validRecord, format: 'png' } },
      { label: 'colorspace', record: { ...validRecord, colorspace: 'b-w' } },
      { label: 'opacity', record: { ...validRecord, opaque: false } },
      { label: 'byte budget', record: { ...validRecord, bytes: 15 * 1024 + 1 } },
    ];
    for (const fixture of isolatedFailures) {
      const checks = evaluateItemArtMachineChecks([fixture.record]);
      expect(checks.invalid, `isolated ${fixture.label} guard`).toEqual([fixture.record]);
      expect(checks.passed, `isolated ${fixture.label} guard`).toBe(false);
    }
    const exactBoundary = evaluateItemArtMachineChecks([
      { ...validRecord, width: 128, height: 128, bytes: 15 * 1024 },
    ]);
    expect(exactBoundary.invalid).toEqual([]);
    expect(exactBoundary.passed).toBe(true);
    const duplicateChecks = evaluateItemArtMachineChecks([
      validRecord,
      { ...validRecord, id: 'machine_oracle_copy' },
    ]);
    expect(duplicateChecks.invalid).toEqual([]);
    expect(duplicateChecks.duplicateHashes).toEqual([
      { sha256: validRecord.sha256, ids: ['machine_oracle', 'machine_oracle_copy'] },
    ]);
    expect(duplicateChecks.passed).toBe(false);
  });

  it('refreshes only reproducible evidence while preserving the manual visual verdict', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'woc-item-art-verdict-'));
    temporaryRoots.push(root);
    const outputDirectory = 'tmp/item-art-audit';
    const itemDirectory = 'public/ui/items';
    mkdirSync(path.join(root, itemDirectory), { recursive: true });
    const bytes = await sharp({
      create: {
        width: 128,
        height: 128,
        channels: 3,
        background: { r: 50, g: 72, b: 98 },
      },
    })
      .webp({ quality: 82 })
      .toBuffer();
    writeFileSync(path.join(root, itemDirectory, 'audit_blade.webp'), bytes);
    const mapping = {
      entries: [{ itemId: 'audit_blade' }],
      generatedBatches: [],
    };
    const build = await buildItemArtAudit({
      repoRoot: root,
      itemDirectory,
      outputDirectory,
      items: { audit_blade: { name: 'Audit Blade', kind: 'weapon', quality: 'rare' } },
      mapping,
    });
    const visualVerdict = {
      status: 'pass',
      passCount: 1,
      passIds: ['audit_blade'],
      watchCount: 0,
      watch: [],
      rejectCount: 0,
      reject: [],
      summary: 'Manual review stays authoritative.',
    };
    const accepted = build.catalog.records[0];
    const resolvedDuringAudit = [
      {
        ids: ['audit_blade'],
        finalDisposition: 'pass',
        finalShipping: [
          {
            id: accepted.id,
            path: accepted.path,
            sha256: accepted.sha256,
            bytes: accepted.bytes,
          },
        ],
      },
    ];
    const source = {
      schemaVersion: 1,
      generatedAt: '2026-08-09T00:00:00.000Z',
      auditScope: {
        itemArtFilesReviewed: 1,
        liveItemDefinitions: 1,
        generatedHeroicDefinitions: 0,
        heroicDefinitionsWithOwnWebp: 0,
        heroicWeaponArtAliases: 0,
        groups: { weapon: 1 },
      },
      reviewContract: {
        visualCriteria: ['manual criterion'],
        everyShippingFileReviewedInModes: ['old-mode'],
      },
      machineChecks: { stale: true },
      visualVerdict,
      nonVisualContentWatch: [{ id: 'manual-note' }],
      resolvedDuringAudit,
      evidence: { stale: true, shippingCatalogSha256: build.shippingCatalogSha256 },
    };
    const refreshed = updateItemArtAuditVerdict(source, build);

    expect(refreshed.visualVerdict).toEqual(visualVerdict);
    expect(refreshed.nonVisualContentWatch).toEqual(source.nonVisualContentWatch);
    expect(refreshed.auditScope).toEqual(source.auditScope);
    expect(refreshed.resolvedDuringAudit).toEqual(resolvedDuringAudit);
    expect(refreshed.generatedAt).toBe(source.generatedAt);
    expect(refreshed.reviewContract).toEqual({
      visualCriteria: ['manual criterion'],
      everyShippingFileReviewedInModes: ITEM_ART_AUDIT_REVIEW_MODES,
    });
    expect(refreshed.machineChecks).toEqual({
      passed: true,
      requiredDimensions: [128, 128],
      requiredFormat: 'webp',
      requiredColorspace: 'srgb',
      requiredOpaque: true,
      maximumBytes: 15 * 1024,
      invalidIds: [],
      duplicateHashGroups: [],
    });
    expect(refreshed.evidence).toEqual({
      catalog: {
        path: build.catalogPath,
        sha256: build.catalogSha256,
        bytes: build.catalogBytes.length,
      },
      rendererFingerprint: ITEM_ART_AUDIT_RENDERER_FINGERPRINT,
      sheetCount: 8,
      sheetModeCounts: Object.fromEntries(ITEM_ART_AUDIT_MODES.map((mode) => [mode, 1])),
      sheets: build.sheetEvidence,
      shippingCatalogSha256: build.shippingCatalogSha256,
      sheetSetSha256: build.sheetSetSha256,
    });
    expect(() =>
      updateItemArtAuditVerdict(
        {
          ...source,
          evidence: { ...source.evidence, shippingCatalogSha256: '0'.repeat(64) },
        },
        build,
      ),
    ).toThrow('Shipping art changed after manual visual review');

    expect(() =>
      updateItemArtAuditVerdict(source, {
        ...build,
        catalog: {
          ...build.catalog,
          machineChecks: { ...build.catalog.machineChecks, passed: false },
        },
      }),
    ).toThrow('Item-art machine checks failed');
    expect(() =>
      updateItemArtAuditVerdict(source, {
        ...build,
        sheetEvidence: build.sheetEvidence.slice(1),
      }),
    ).toThrow('without every planned contact sheet');
    expect(() =>
      updateItemArtAuditVerdict(source, {
        ...build,
        sheetEvidence: [
          build.sheetEvidence[1],
          build.sheetEvidence[0],
          ...build.sheetEvidence.slice(2),
        ],
      }),
    ).toThrow('no longer matches the planned sheet set');
    expect(() =>
      updateItemArtAuditVerdict(source, {
        ...build,
        sheetSetSha256: null,
      }),
    ).toThrow('without a sheet-set digest');
    expect(() =>
      updateItemArtAuditVerdict(
        {
          ...source,
          schemaVersion: 2,
        },
        build,
      ),
    ).toThrow('schemaVersion 1');
    for (const field of [
      'itemArtFilesReviewed',
      'liveItemDefinitions',
      'generatedHeroicDefinitions',
      'heroicDefinitionsWithOwnWebp',
      'heroicWeaponArtAliases',
    ] as const) {
      expect(() =>
        updateItemArtAuditVerdict(
          {
            ...source,
            auditScope: {
              ...source.auditScope,
              [field]: source.auditScope[field] + 1,
            },
          },
          build,
        ),
      ).toThrow();
    }
    expect(() =>
      updateItemArtAuditVerdict(
        {
          ...source,
          auditScope: { ...source.auditScope, groups: { weapon: 2 } },
        },
        build,
      ),
    ).toThrow('Manual verdict groups changed');
    expect(() =>
      updateItemArtAuditVerdict(
        {
          ...source,
          visualVerdict: { ...source.visualVerdict, passCount: 0 },
        },
        build,
      ),
    ).toThrow('Manual pass count changed');
    expect(() =>
      updateItemArtAuditVerdict(
        {
          ...source,
          visualVerdict: { ...source.visualVerdict, passIds: [] },
        },
        build,
      ),
    ).toThrow('Manual pass IDs changed');
    expect(() =>
      updateItemArtAuditVerdict(
        {
          ...source,
          resolvedDuringAudit: [
            {
              ...resolvedDuringAudit[0],
              finalShipping: [
                { ...resolvedDuringAudit[0].finalShipping[0], sha256: '0'.repeat(64) },
              ],
            },
          ],
        },
        build,
      ),
    ).toThrow('Resolved audit pin changed for audit_blade');
    expect(() =>
      updateItemArtAuditVerdict(
        {
          ...source,
          resolvedDuringAudit: [
            {
              ...resolvedDuringAudit[0],
              finalShipping: [
                { ...resolvedDuringAudit[0].finalShipping[0], path: 'public/ui/items/other.webp' },
              ],
            },
          ],
        },
        build,
      ),
    ).toThrow('Resolved audit pin changed for audit_blade');
    expect(() =>
      updateItemArtAuditVerdict(
        {
          ...source,
          resolvedDuringAudit: [
            {
              ...resolvedDuringAudit[0],
              finalShipping: [
                { ...resolvedDuringAudit[0].finalShipping[0], bytes: accepted.bytes + 1 },
              ],
            },
          ],
        },
        build,
      ),
    ).toThrow('Resolved audit pin changed for audit_blade');
    expect(() =>
      updateItemArtAuditVerdict(
        {
          ...source,
          resolvedDuringAudit: [
            {
              ...resolvedDuringAudit[0],
              finalShipping: [{ ...resolvedDuringAudit[0].finalShipping[0], id: 'absent_blade' }],
            },
          ],
        },
        build,
      ),
    ).toThrow('Resolved audit item is absent from the current catalog: absent_blade');
  });

  it('exposes the fresh-checkout rebuild and explicit verdict-refresh CLI', () => {
    const help = execFileSync(process.execPath, ['scripts/item_art_audit.mjs', '--help'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(help).toContain('node scripts/item_art_audit.mjs');
    expect(help).toContain('--verify-only');
    expect(help).toContain('--refresh-verdict');
    expect(help).toContain('tmp/imagegen/item-art-consistency/final-audit');

    const verified = JSON.parse(
      execFileSync(process.execPath, ['scripts/item_art_audit.mjs', '--verify-only'], {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 30_000,
      }),
    ) as Record<string, unknown>;
    expect(verified).toMatchObject({
      catalogPath: 'tmp/imagegen/item-art-consistency/final-audit/catalog.json',
      catalogSha256: '5a4e46556d459f83462570b66a56e1ec11b015dbd5c7594ffe4112bbda51cfbb',
      catalogBytes: 448700,
      rendererFingerprint: 'fd92c41a206cd55b05a1de94c4789f6eb6ca4200d063f4bbd284c21ae03b6082',
      catalogCount: 817,
      liveItemCount: 831,
      generatedHeroicDefinitions: 63,
      heroicDefinitionsWithOwnWebp: 48,
      heroicWeaponArtAliases: 15,
      groupCount: 22,
      sheetPageCount: 26,
      sheetCount: 208,
      sheetModeCounts: Object.fromEntries(ITEM_ART_AUDIT_MODES.map((mode) => [mode, 26])),
      sheetSetSha256: null,
      shippingCatalogSha256: '2c96473916c10df2118b02bba0edc914acefb61a16e16f46c4467ee924876c1a',
      machineChecksPassed: true,
      verdict: null,
    });
  });
});
