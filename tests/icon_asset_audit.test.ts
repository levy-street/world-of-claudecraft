import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import {
  auditIconAssets,
  groupManifestAssets,
  ICON_AUDIT_LIMITS,
  runIconAssetAudit,
  validateAcceptedArtManifest,
} from '../scripts/lib/icon_asset_audit.mjs';

const REPO_ROOT = path.join(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'scripts/icon_asset_audit.mjs');

type Kind = 'ability' | 'item' | 'deed';

interface FixtureAsset {
  kind: Kind;
  id: string;
  runtimeUrl: string;
  class?: string;
  family?: string;
  zone?: string;
  batch?: string;
  acceptedSha256?: string;
  acceptedBytes?: number;
  source?: { path: string };
  expected?: {
    width?: number;
    height?: number;
    maxBytes?: number;
    alpha?: 'opaque' | 'transparent-subject' | 'has-alpha' | 'any';
    geometry?: {
      alphaThreshold?: number;
      minPadding?: number;
      maxCenterOffset?: number;
      coverageMin?: number;
      coverageMax?: number;
      alphaBounds?: [number, number, number, number];
      visiblePixels?: number;
    };
  };
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixtureRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'wocc-icon-audit-'));
  roots.push(root);
  return root;
}

function publicPath(root: string, runtimeUrl: string): string {
  const file = path.join(root, 'public', runtimeUrl.slice(1));
  mkdirSync(path.dirname(file), { recursive: true });
  return file;
}

async function writeOpaqueIcon(file: string, color: string): Promise<void> {
  await sharp({
    create: { width: 128, height: 128, channels: 4, background: color },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="128" height="128"><circle cx="64" cy="64" r="35" fill="#f2c14e"/></svg>',
        ),
      },
    ])
    .webp({ lossless: true })
    .toFile(file);
}

const VIGNETTE_BACKGROUND = `<defs>
  <radialGradient id="bg"><stop offset="0" stop-color="#30394c"/><stop offset="1" stop-color="#090d15"/></radialGradient>
</defs><rect width="128" height="128" fill="url(#bg)"/>`;

async function writeVignetteIcon(file: string, subject: string): Promise<void> {
  await sharp(Buffer.from(`<svg width="128" height="128">${VIGNETTE_BACKGROUND}${subject}</svg>`))
    .webp({ lossless: true })
    .toFile(file);
}

async function writeDeedIcon(
  file: string,
  inset = 20,
  color: [number, number, number] = [183, 139, 61],
): Promise<void> {
  const pixels = Buffer.alloc(128 * 128 * 4);
  for (let y = inset; y < 128 - inset; y++) {
    for (let x = inset; x < 128 - inset; x++) {
      const offset = (y * 128 + x) * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = 255;
    }
  }
  await sharp(pixels, { raw: { width: 128, height: 128, channels: 4 } })
    .webp({ lossless: true })
    .toFile(file);
}

async function writeOffCenterDeedIcon(file: string): Promise<void> {
  const pixels = Buffer.alloc(128 * 128 * 4);
  for (let y = 20; y < 108; y++) {
    for (let x = 12; x < 100; x++) {
      const offset = (y * 128 + x) * 4;
      pixels[offset] = 73;
      pixels[offset + 1] = 151;
      pixels[offset + 2] = 207;
      pixels[offset + 3] = 255;
    }
  }
  await sharp(pixels, { raw: { width: 128, height: 128, channels: 4 } })
    .webp({ lossless: true })
    .toFile(file);
}

async function writeBoundedDeedIcon(
  file: string,
  bounds: readonly [number, number, number, number],
): Promise<void> {
  const [minX, minY, maxX, maxY] = bounds;
  const pixels = Buffer.alloc(128 * 128 * 4);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const offset = (y * 128 + x) * 4;
      pixels[offset] = 73;
      pixels[offset + 1] = 151;
      pixels[offset + 2] = 207;
      pixels[offset + 3] = 255;
    }
  }
  await sharp(pixels, { raw: { width: 128, height: 128, channels: 4 } })
    .webp({ lossless: true })
    .toFile(file);
}

async function writeThresholdSensitiveDeedIcon(file: string): Promise<void> {
  const pixels = Buffer.alloc(128 * 128 * 4);
  for (let y = 20; y <= 107; y++) {
    for (let x = 20; x <= 107; x++) {
      const offset = (y * 128 + x) * 4;
      pixels[offset] = 183;
      pixels[offset + 1] = 139;
      pixels[offset + 2] = 61;
      pixels[offset + 3] = 8;
    }
  }
  for (let y = 21; y <= 106; y++) {
    for (let x = 21; x <= 106; x++) {
      const offset = (y * 128 + x) * 4;
      pixels[offset] = 183;
      pixels[offset + 1] = 139;
      pixels[offset + 2] = 61;
      pixels[offset + 3] = 255;
    }
  }
  await sharp(pixels, { raw: { width: 128, height: 128, channels: 4 } })
    .webp({ lossless: true })
    .toFile(file);
}

async function writeAcceptedDeedSource(
  file: string,
  inset: number,
  color: [number, number, number],
): Promise<void> {
  mkdirSync(path.dirname(file), { recursive: true });
  const pixels = Buffer.alloc(512 * 512 * 4);
  for (let y = inset; y < 512 - inset; y++) {
    for (let x = inset; x < 512 - inset; x++) {
      const offset = (y * 512 + x) * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = 255;
    }
  }
  await sharp(pixels, { raw: { width: 512, height: 512, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toFile(file);
}

function fileSha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function pinAsset(root: string, asset: FixtureAsset): FixtureAsset {
  const bytes = readFileSync(publicPath(root, asset.runtimeUrl));
  return {
    ...asset,
    acceptedBytes: bytes.length,
    acceptedSha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function manifest(assets: FixtureAsset[]) {
  return {
    schemaVersion: 1,
    batch: { id: 'fixture-wave' },
    contracts: {
      ability: { width: 128, height: 128, maxBytes: 15 * 1024, alpha: 'opaque' },
      item: { width: 128, height: 128, maxBytes: 15 * 1024, alpha: 'opaque' },
      deed: {
        width: 128,
        height: 128,
        maxBytes: 15 * 1024,
        alpha: 'transparent-subject',
        geometry: {
          alphaThreshold: 8,
          minPadding: 7,
          maxCenterOffset: 2,
          coverageMin: 0.2,
          coverageMax: 0.7,
        },
      },
    },
    assets,
  };
}

type FixtureManifest = ReturnType<typeof manifest>;

function fixtureAsset(value: FixtureManifest, id: string): FixtureAsset {
  const asset = value.assets.find((candidate) => candidate.id === id);
  if (!asset) throw new Error(`missing fixture asset ${id}`);
  return asset;
}

function expectedAcceptance(asset: FixtureAsset): NonNullable<FixtureAsset['expected']> {
  asset.expected ??= {};
  return asset.expected;
}

function expectedGeometry(
  asset: FixtureAsset,
): NonNullable<NonNullable<FixtureAsset['expected']>['geometry']> {
  const expected = expectedAcceptance(asset);
  expected.geometry ??= {};
  return expected.geometry;
}

async function buildFixture(root: string, includeDuplicate = true) {
  const deedSourcePath = 'tmp/imagegen/accepted/deeds/fixture_deed.png';
  const fire: FixtureAsset = {
    kind: 'ability',
    id: 'arcane_fire',
    class: 'mage',
    runtimeUrl: '/ui/skills/mage/arcane_fire.webp',
  };
  const ember: FixtureAsset = {
    kind: 'ability',
    id: 'arcane_ember',
    class: 'mage',
    runtimeUrl: '/ui/skills/mage/arcane_ember.webp',
  };
  const item: FixtureAsset = {
    kind: 'item',
    id: 'farshore_relic',
    zone: 'farshore',
    family: 'salvage',
    runtimeUrl: '/ui/items/farshore_relic.webp',
  };
  const deed: FixtureAsset = {
    kind: 'deed',
    id: 'fixture_deed',
    batch: 'deed-wave',
    runtimeUrl: '/ui/deeds/fixture_deed.webp',
    source: { path: deedSourcePath },
  };

  await writeOpaqueIcon(publicPath(root, fire.runtimeUrl), '#702020');
  await writeOpaqueIcon(publicPath(root, ember.runtimeUrl), '#722020');
  if (includeDuplicate) {
    copyFileSync(publicPath(root, fire.runtimeUrl), publicPath(root, item.runtimeUrl));
  } else {
    await writeOpaqueIcon(publicPath(root, item.runtimeUrl), '#204870');
  }
  await writeDeedIcon(publicPath(root, deed.runtimeUrl));
  await writeAcceptedDeedSource(path.join(root, deedSourcePath), 72, [218, 51, 74]);

  return manifest([fire, ember, item, deed].map((asset) => pinAsset(root, asset)));
}

interface AuditContractMutation {
  name: string;
  targetId: string;
  mutate: (value: FixtureManifest, root: string) => void | Promise<void>;
  issue: RegExp;
}

const DEED_PADDING_EDGE_MUTATIONS: AuditContractMutation[] = [
  ['left', [19, 20, 107, 107], [19, 20, 20, 20]],
  ['top', [20, 19, 107, 107], [20, 19, 20, 20]],
  ['right', [20, 20, 108, 107], [20, 20, 19, 20]],
  ['bottom', [20, 20, 107, 108], [20, 20, 20, 19]],
].map(([edge, bounds, padding]) => ({
  name: `deed minimum padding on ${edge} edge`,
  targetId: 'fixture_deed',
  async mutate(value, root) {
    const asset = fixtureAsset(value, 'fixture_deed');
    await writeBoundedDeedIcon(
      publicPath(root, asset.runtimeUrl),
      bounds as [number, number, number, number],
    );
    Object.assign(asset, pinAsset(root, asset));
    expectedGeometry(asset).minPadding = 20;
  },
  issue: new RegExp(
    `^alpha padding \\[${(padding as number[]).join(',')}\\] is below minPadding 20$`,
  ),
}));

const DEED_ALPHA_BOUND_MUTATIONS: AuditContractMutation[] = [
  ['left', [19, 20, 107, 107]],
  ['top', [20, 19, 107, 107]],
  ['right', [20, 20, 108, 107]],
  ['bottom', [20, 20, 107, 108]],
].map(([edge, bounds]) => ({
  name: `deed exact ${edge} alpha bound`,
  targetId: 'fixture_deed',
  mutate(value) {
    expectedGeometry(fixtureAsset(value, 'fixture_deed')).alphaBounds = bounds as [
      number,
      number,
      number,
      number,
    ];
  },
  issue: new RegExp(
    `^alpha bounds \\[20,20,107,107\\] do not match \\[${(bounds as number[]).join(',')}\\]$`,
  ),
}));

const AUDIT_CONTRACT_MUTATIONS: AuditContractMutation[] = [
  {
    name: 'accepted byte identity',
    targetId: 'arcane_fire',
    mutate(value) {
      const asset = fixtureAsset(value, 'arcane_fire');
      asset.acceptedBytes = (asset.acceptedBytes ?? 0) + 1;
    },
    issue: /^acceptedBytes \d+ do not match actual \d+$/,
  },
  {
    name: 'accepted SHA identity',
    targetId: 'arcane_fire',
    mutate(value) {
      fixtureAsset(value, 'arcane_fire').acceptedSha256 = '0'.repeat(64);
    },
    issue: /^acceptedSha256 0{64} does not match actual [0-9a-f]{64}$/,
  },
  {
    name: 'expected width',
    targetId: 'arcane_fire',
    mutate(value) {
      expectedAcceptance(fixtureAsset(value, 'arcane_fire')).width = 127;
    },
    issue: /^dimensions 128x128 do not match 127x128$/,
  },
  {
    name: 'expected height',
    targetId: 'arcane_fire',
    mutate(value) {
      expectedAcceptance(fixtureAsset(value, 'arcane_fire')).height = 127;
    },
    issue: /^dimensions 128x128 do not match 128x127$/,
  },
  {
    name: 'expected maximum weight',
    targetId: 'farshore_relic',
    mutate(value) {
      expectedAcceptance(fixtureAsset(value, 'farshore_relic')).maxBytes = 1;
    },
    issue: /^file weight \d+ exceeds maxBytes 1$/,
  },
  {
    name: 'opaque ability alpha mode',
    targetId: 'arcane_fire',
    mutate(value) {
      expectedAcceptance(fixtureAsset(value, 'arcane_fire')).alpha = 'transparent-subject';
    },
    issue: /^alpha mode opaque does not match transparent-subject$/,
  },
  {
    name: 'transparent deed alpha mode',
    targetId: 'fixture_deed',
    mutate(value) {
      expectedAcceptance(fixtureAsset(value, 'fixture_deed')).alpha = 'opaque';
    },
    issue: /^alpha mode transparent-subject does not match opaque$/,
  },
  {
    name: 'deed alpha measurement threshold',
    targetId: 'fixture_deed',
    async mutate(value, root) {
      const asset = fixtureAsset(value, 'fixture_deed');
      await writeThresholdSensitiveDeedIcon(publicPath(root, asset.runtimeUrl));
      Object.assign(asset, pinAsset(root, asset));
      Object.assign(expectedGeometry(asset), {
        alphaThreshold: 9,
        alphaBounds: [20, 20, 107, 107],
      });
    },
    issue: /^alpha bounds \[21,21,106,106\] do not match \[20,20,107,107\]$/,
  },
  ...DEED_PADDING_EDGE_MUTATIONS,
  {
    name: 'deed minimum coverage',
    targetId: 'fixture_deed',
    mutate(value) {
      expectedGeometry(fixtureAsset(value, 'fixture_deed')).coverageMin = 0.48;
    },
    issue: /^alpha coverage 0\.472656 is below 0\.48$/,
  },
  {
    name: 'deed maximum coverage',
    targetId: 'fixture_deed',
    mutate(value) {
      expectedGeometry(fixtureAsset(value, 'fixture_deed')).coverageMax = 0.47;
    },
    issue: /^alpha coverage 0\.472656 exceeds 0\.47$/,
  },
  ...DEED_ALPHA_BOUND_MUTATIONS,
  {
    name: 'deed exact visible pixel count',
    targetId: 'fixture_deed',
    mutate(value) {
      expectedGeometry(fixtureAsset(value, 'fixture_deed')).visiblePixels = 7745;
    },
    issue: /^alpha visiblePixels 7744 do not match 7745$/,
  },
  {
    name: 'deed horizontal visual centering',
    targetId: 'fixture_deed',
    async mutate(value, root) {
      const asset = fixtureAsset(value, 'fixture_deed');
      await writeOffCenterDeedIcon(publicPath(root, asset.runtimeUrl));
      Object.assign(asset, pinAsset(root, asset));
    },
    issue: /^alpha centerOffset \[-8,0\] exceeds 2$/,
  },
  {
    name: 'deed vertical visual centering',
    targetId: 'fixture_deed',
    async mutate(value, root) {
      const asset = fixtureAsset(value, 'fixture_deed');
      await writeBoundedDeedIcon(publicPath(root, asset.runtimeUrl), [20, 12, 107, 99]);
      Object.assign(asset, pinAsset(root, asset));
    },
    issue: /^alpha centerOffset \[0,-8\] exceeds 2$/,
  },
];

describe('icon accepted-art manifest', () => {
  it('validates exact pins and groups using class, item zone/family, and deed batch metadata', () => {
    const hash = 'a'.repeat(64);
    const value = manifest([
      {
        kind: 'ability',
        id: 'a',
        class: 'mage',
        runtimeUrl: '/ui/skills/mage/a.webp',
        acceptedSha256: hash,
        acceptedBytes: 100,
      },
      {
        kind: 'item',
        id: 'b',
        runtimeUrl: '/ui/items/b.webp',
        acceptedSha256: 'b'.repeat(64),
        acceptedBytes: 101,
        zone: 'farshore',
        family: 'salvage',
      },
      {
        kind: 'deed',
        id: 'c',
        runtimeUrl: '/ui/deeds/c.webp',
        acceptedSha256: 'c'.repeat(64),
        acceptedBytes: 102,
        batch: 'deed-wave',
      },
    ]);

    expect(validateAcceptedArtManifest(value)).toBe(value);
    expect(
      groupManifestAssets(value).map((group) => [group.kind, group.group, group.assets.length]),
    ).toEqual([
      ['ability', 'mage', 1],
      ['item', 'farshore / salvage', 1],
      ['deed', 'deed-wave', 1],
    ]);

    expect(() =>
      validateAcceptedArtManifest({ ...value, assets: [...value.assets, value.assets[0]] }),
    ).toThrow('duplicate accepted-art asset key ability:a');
    expect(ICON_AUDIT_LIMITS.maxAssets).toBe(500);
    expect(() =>
      validateAcceptedArtManifest({
        ...value,
        assets: Array.from({ length: 501 }, () => value.assets[0]),
      }),
    ).toThrow('maximum is 500');
  });
});

describe('icon asset audit', () => {
  it('measures exact identity, alpha geometry, duplicate bytes, and near-duplicate candidates', async () => {
    const root = fixtureRoot();
    const value = await buildFixture(root);
    const report = await auditIconAssets({ manifest: value, repoRoot: root });

    expect(report.summary).toMatchObject({ assetCount: 4, issueCount: 0, ok: false });
    expect(report.exactDuplicates).toEqual([
      {
        sha256: value.assets[0].acceptedSha256,
        assetKeys: ['ability:arcane_fire', 'item:farshore_relic'],
      },
    ]);
    expect(report.perceptualCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          left: 'ability:arcane_ember',
          right: 'ability:arcane_fire',
        }),
      ]),
    );

    const opaque = report.assets.find((asset) => asset.id === 'arcane_fire');
    expect(opaque).toMatchObject({
      width: 128,
      height: 128,
      format: 'webp',
      colourspace: 'srgb',
      alphaMode: 'opaque',
      issues: [],
    });
    expect(opaque?.alpha).toMatchObject({ min: 255, max: 255, coverage: 1 });

    const deed = report.assets.find((asset) => asset.id === 'fixture_deed');
    expect(deed).toMatchObject({ alphaMode: 'transparent-subject', issues: [] });
    expect(deed?.alpha?.min).toBe(0);
    expect(deed?.alpha?.max).toBe(255);
    expect(deed?.alpha?.bounds).toEqual([20, 20, 107, 107]);
  });

  it.each(AUDIT_CONTRACT_MUTATIONS)(
    'rejects independently corrupted $name',
    async ({ targetId, mutate, issue }) => {
      const root = fixtureRoot();
      const value = await buildFixture(root, false);
      await mutate(value, root);

      const report = await auditIconAssets({ manifest: value, repoRoot: root });
      const recordsWithIssues = report.assets.filter((asset) => asset.issues.length > 0);

      expect(report.summary).toMatchObject({
        ok: false,
        issueCount: 1,
        exactDuplicateGroupCount: 0,
      });
      expect(recordsWithIssues.map((asset) => asset.id)).toEqual([targetId]);
      expect(recordsWithIssues[0].issues).toEqual([expect.stringMatching(issue)]);
    },
  );

  it('keeps minor visual variants while suppressing structurally different shared vignettes', async () => {
    const root = fixtureRoot();
    const assets: FixtureAsset[] = [
      'variant_base',
      'variant_recolor',
      'variant_brightness',
      'variant_crop',
      'variant_trace',
      'different_subject',
    ].map((id) => ({
      kind: 'ability',
      id,
      class: 'mage',
      runtimeUrl: `/ui/skills/mage/${id}.webp`,
    }));
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    expect(ICON_AUDIT_LIMITS).toMatchObject({
      perceptualStructureSize: 24,
      perceptualCropFractions: [0, 0.03, 0.06],
      perceptualLuminanceWeight: 0.55,
      perceptualEdgeWeight: 0.45,
      perceptualMinStructuralSimilarity: 0.8,
    });

    const subject = (primary: string, secondary: string, accent: string) => `<g>
      <path d="M25 87 C31 66 37 48 53 34 C64 43 71 57 73 76 C62 88 43 94 25 87 Z"
        fill="${primary}" stroke="${accent}" stroke-width="3"/>
      <path d="M45 75 L57 45 L68 75 L58 69 Z" fill="${secondary}"/>
      <circle cx="43" cy="58" r="7" fill="${accent}"/>
      <path d="M69 48 L96 37 M72 56 L101 55 M70 65 L94 76" stroke="${accent}"
        stroke-width="4" stroke-linecap="round"/>
    </g>`;
    const baseFile = publicPath(root, byId.get('variant_base')?.runtimeUrl ?? '');
    await writeVignetteIcon(baseFile, subject('#d38b35', '#446cc7', '#f6d772'));
    await writeVignetteIcon(
      publicPath(root, byId.get('variant_recolor')?.runtimeUrl ?? ''),
      subject('#36bed1', '#ba4fc7', '#dbf5f4'),
    );
    await sharp(baseFile)
      .modulate({ brightness: 0.65 })
      .webp({ lossless: true })
      .toFile(publicPath(root, byId.get('variant_brightness')?.runtimeUrl ?? ''));
    await sharp(baseFile)
      .extract({ left: 7, top: 7, width: 114, height: 114 })
      .resize(128, 128)
      .webp({ lossless: true })
      .toFile(publicPath(root, byId.get('variant_crop')?.runtimeUrl ?? ''));
    const traced = await sharp(baseFile)
      .extract({ left: 7, top: 7, width: 114, height: 114 })
      .resize(128, 128)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let offset = 0; offset < traced.data.length; offset++) {
      traced.data[offset] = Math.round(traced.data[offset] / 85) * 85;
    }
    await sharp(traced.data, { raw: traced.info })
      .median(3)
      .webp({ lossless: true })
      .toFile(publicPath(root, byId.get('variant_trace')?.runtimeUrl ?? ''));
    await writeVignetteIcon(
      publicPath(root, byId.get('different_subject')?.runtimeUrl ?? ''),
      `<circle cx="64" cy="64" r="31" fill="#262c3d" stroke="#e9bd55" stroke-width="8"/>
      <path d="M64 39 L71 55 L89 55 L75 67 L80 85 L64 75 L48 85 L53 67 L39 55 L57 55 Z"
        fill="#e9bd55"/>`,
    );

    const value = manifest(assets.map((asset) => pinAsset(root, asset)));
    const report = await auditIconAssets({ manifest: value, repoRoot: root });
    const repeated = await auditIconAssets({ manifest: value, repoRoot: root });
    expect(repeated.perceptualCandidates).toEqual(report.perceptualCandidates);
    const candidatePairs = new Map(
      report.perceptualCandidates.map((candidate) => [
        [candidate.left, candidate.right].sort().join('|'),
        candidate,
      ]),
    );

    for (const variant of ['recolor', 'brightness', 'crop', 'trace']) {
      const key = [`ability:variant_base`, `ability:variant_${variant}`].sort().join('|');
      const candidate = candidatePairs.get(key);
      expect(candidate?.structuralSimilarity, variant).toBeGreaterThanOrEqual(0.8);
      expect(candidate).toMatchObject({
        luminanceSimilarity: expect.any(Number),
        edgeSimilarity: expect.any(Number),
        cropFraction: expect.any(Number),
        cropDirection: expect.stringMatching(/^(none|left-cropped|right-cropped)$/),
      });
    }
    expect(
      report.perceptualCandidates.filter((candidate) =>
        [candidate.left, candidate.right].includes('ability:different_subject'),
      ),
    ).toEqual([]);
  });

  it('rejects a PNG payload renamed with a WebP extension and a non-sRGB WebP profile', async () => {
    const root = fixtureRoot();
    const value = await buildFixture(root, false);
    const renamedPng = value.assets[0];
    await sharp({
      create: { width: 128, height: 128, channels: 4, background: '#314f71' },
    })
      .png()
      .toFile(publicPath(root, renamedPng.runtimeUrl));
    value.assets[0] = pinAsset(root, renamedPng);

    const p3Webp = value.assets[1];
    await sharp({
      create: { width: 128, height: 128, channels: 4, background: '#6a3838' },
    })
      .withIccProfile('p3')
      .webp({ lossless: true })
      .toFile(publicPath(root, p3Webp.runtimeUrl));
    value.assets[1] = pinAsset(root, p3Webp);

    const report = await auditIconAssets({ manifest: value, repoRoot: root });
    const pngRecord = report.assets.find((asset) => asset.id === renamedPng.id);
    const p3Record = report.assets.find((asset) => asset.id === p3Webp.id);

    expect(pngRecord).toMatchObject({
      format: 'png',
      colourspace: 'srgb',
      issues: ['shipping format png does not match required WebP'],
    });
    expect(p3Record?.issues).toEqual([
      expect.stringMatching(/^embedded ICC profile .+ does not match required sRGB$/),
    ]);
    expect(report.summary).toMatchObject({ ok: false, issueCount: 2 });
  });

  it('renders deed 512 sheets from the accepted source while smaller sheets stay shipping-backed', async () => {
    const root = fixtureRoot();
    const outputDir = path.join(root, 'audit');
    const manifestPath = path.join(root, 'accepted.json');
    const value = await buildFixture(root, false);
    value.assets = value.assets.filter((asset) => asset.kind === 'deed');
    writeFileSync(manifestPath, `${JSON.stringify(value, null, 2)}\n`);

    const first = await runIconAssetAudit({ manifestPath, outputDir, repoRoot: root });
    const firstHashes = Object.fromEntries(
      first.contactSheets.map((sheet) => [
        sheet.path,
        fileSha256(path.join(outputDir, sheet.path)),
      ]),
    );
    const deed = value.assets[0];
    await writeAcceptedDeedSource(path.join(root, deed.source?.path ?? ''), 148, [39, 166, 112]);

    const second = await runIconAssetAudit({ manifestPath, outputDir, repoRoot: root });
    const secondHashes = Object.fromEntries(
      second.contactSheets.map((sheet) => [
        sheet.path,
        fileSha256(path.join(outputDir, sheet.path)),
      ]),
    );
    const sourceBacked = second.contactSheets.filter((sheet) => sheet.size === 512);
    const shippingBacked = second.contactSheets.filter((sheet) => sheet.size < 512);

    expect(sourceBacked).toHaveLength(2);
    expect(
      sourceBacked.every((sheet) => firstHashes[sheet.path] !== secondHashes[sheet.path]),
    ).toBe(true);
    expect(
      shippingBacked.every((sheet) => firstHashes[sheet.path] === secondHashes[sheet.path]),
    ).toBe(true);

    await writeDeedIcon(publicPath(root, deed.runtimeUrl), 32, [79, 111, 206]);
    value.assets[0] = pinAsset(root, deed);
    writeFileSync(manifestPath, `${JSON.stringify(value, null, 2)}\n`);
    const third = await runIconAssetAudit({ manifestPath, outputDir, repoRoot: root });
    const thirdHashes = Object.fromEntries(
      third.contactSheets.map((sheet) => [
        sheet.path,
        fileSha256(path.join(outputDir, sheet.path)),
      ]),
    );

    expect(
      sourceBacked.every((sheet) => secondHashes[sheet.path] === thirdHashes[sheet.path]),
    ).toBe(true);
    expect(
      shippingBacked.every((sheet) => secondHashes[sheet.path] !== thirdHashes[sheet.path]),
    ).toBe(true);
  }, 30_000);

  it('rejects deed source paths that escape the repository root', async () => {
    const root = fixtureRoot();
    const outputDir = path.join(root, 'audit');
    const manifestPath = path.join(root, 'accepted.json');
    const value = await buildFixture(root, false);
    value.assets = value.assets.filter((asset) => asset.kind === 'deed');
    value.assets[0].source = { path: '../outside.png' };
    writeFileSync(manifestPath, `${JSON.stringify(value, null, 2)}\n`);

    await expect(runIconAssetAudit({ manifestPath, outputDir, repoRoot: root })).rejects.toThrow(
      'source.path escapes repository root: ../outside.png',
    );

    const externalRoot = fixtureRoot();
    const externalSource = path.join(externalRoot, 'outside.png');
    const linkedSource = 'tmp/imagegen/accepted/deeds/linked.png';
    await writeAcceptedDeedSource(externalSource, 96, [116, 73, 184]);
    symlinkSync(externalSource, path.join(root, linkedSource), 'file');
    value.assets[0].source = { path: linkedSource };
    writeFileSync(manifestPath, `${JSON.stringify(value, null, 2)}\n`);

    await expect(runIconAssetAudit({ manifestPath, outputDir, repoRoot: root })).rejects.toThrow(
      `source.path escapes repository root through a symbolic link: ${linkedSource}`,
    );
  });

  it('writes deterministically named labeled sheets for every requested review size', async () => {
    const root = fixtureRoot();
    const outputDir = path.join(root, 'audit');
    const manifestPath = path.join(root, 'accepted.json');
    const value = await buildFixture(root, false);
    writeFileSync(manifestPath, `${JSON.stringify(value, null, 2)}\n`);

    const report = await runIconAssetAudit({ manifestPath, outputDir, repoRoot: root });
    const paths = report.contactSheets.map((sheet) => sheet.path);

    expect(report.summary.ok).toBe(true);
    expect(paths).toEqual([
      'contact-sheets/ability-mage-128-p01.png',
      'contact-sheets/ability-mage-48-p01.png',
      'contact-sheets/ability-mage-32-p01.png',
      'contact-sheets/item-farshore-salvage-128-p01.png',
      'contact-sheets/item-farshore-salvage-28-p01.png',
      'contact-sheets/deed-deed-wave-512-p01.png',
      'contact-sheets/deed-deed-wave-512-grayscale-p01.png',
      'contact-sheets/deed-deed-wave-128-p01.png',
      'contact-sheets/deed-deed-wave-128-grayscale-p01.png',
      'contact-sheets/deed-deed-wave-40-p01.png',
      'contact-sheets/deed-deed-wave-40-grayscale-p01.png',
      'contact-sheets/deed-deed-wave-24-p01.png',
      'contact-sheets/deed-deed-wave-24-grayscale-p01.png',
    ]);
    expect(paths.every((relative) => existsSync(path.join(outputDir, relative)))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(outputDir, 'icon-asset-audit.json'), 'utf8'))).toEqual(
      report,
    );

    const metadata = await sharp(path.join(outputDir, paths[0])).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBeGreaterThan(128);
    expect(metadata.height).toBeGreaterThan(128);

    const firstHashes = paths.map((relative) =>
      createHash('sha256')
        .update(readFileSync(path.join(outputDir, relative)))
        .digest('hex'),
    );
    const repeated = await runIconAssetAudit({ manifestPath, outputDir, repoRoot: root });
    expect(repeated).toEqual(report);
    expect(
      paths.map((relative) =>
        createHash('sha256')
          .update(readFileSync(path.join(outputDir, relative)))
          .digest('hex'),
      ),
    ).toEqual(firstHashes);
  }, 30_000);

  it('pins the complete accepted-art audit using the checked-in manifest and shipping assets', async () => {
    const root = fixtureRoot();
    const outputDir = path.join(root, 'shipping-audit');
    const manifestPath = path.join(root, 'shipping-only-accepted-art.json');
    const checkedInManifestPath = path.join(
      REPO_ROOT,
      'docs/achievements/missing-painted-icons-accepted-art.json',
    );
    const value = JSON.parse(readFileSync(checkedInManifestPath, 'utf8')) as {
      assets: Array<{
        kind: Kind;
        id: string;
        runtimeUrl: string;
        source?: Record<string, unknown>;
      }>;
      [key: string]: unknown;
    };
    validateAcceptedArtManifest(value);

    // The 512px human-review sheets normally use ignored generation sources. This CI fixture
    // changes only those review paths to the committed shipping WebPs, keeping every accepted
    // identity and contract pin from the checked-in manifest intact.
    const deedShippingSources: string[] = [];
    for (const asset of value.assets) {
      if (asset.kind !== 'deed') continue;
      const shippingSource = `public${asset.runtimeUrl}`;
      expect(existsSync(path.join(REPO_ROOT, shippingSource))).toBe(true);
      asset.source = { ...(asset.source ?? {}), path: shippingSource };
      deedShippingSources.push(shippingSource);
    }
    expect(deedShippingSources).toHaveLength(3);
    expect(deedShippingSources.every((source) => !source.startsWith('tmp/'))).toBe(true);
    writeFileSync(manifestPath, `${JSON.stringify(value, null, 2)}\n`);

    const report = await runIconAssetAudit({
      manifestPath,
      outputDir,
      repoRoot: REPO_ROOT,
    });

    expect(report.summary).toEqual({
      ok: true,
      assetCount: 194,
      issueCount: 0,
      exactDuplicateGroupCount: 0,
      perceptualCandidateCount: 1,
      contactSheetCount: 95,
    });
    expect(report.assets.every((asset) => asset.issues.length === 0)).toBe(true);
    expect(report.exactDuplicates).toEqual([]);
    expect(report.perceptualCandidates.map(({ left, right }) => [left, right])).toEqual([
      ['item:sunken_idol_mantle', 'item:wreck_wardens_mantle'],
    ]);
    expect(report.contactSheets).toHaveLength(95);
    expect(
      report.contactSheets.every((sheet) => existsSync(path.join(outputDir, sheet.path))),
    ).toBe(true);
  }, 120_000);

  it('removes stale contact sheets on rerun and with sheets disabled without deleting peer evidence', async () => {
    const root = fixtureRoot();
    const outputDir = path.join(root, 'audit');
    const sheetRoot = path.join(outputDir, 'contact-sheets');
    const manifestPath = path.join(root, 'accepted.json');
    const peerEvidence = path.join(outputDir, 'keep.txt');
    const value = await buildFixture(root, false);
    value.assets = value.assets.filter((asset) => asset.kind === 'deed');
    writeFileSync(manifestPath, `${JSON.stringify(value, null, 2)}\n`);
    mkdirSync(sheetRoot, { recursive: true });
    writeFileSync(path.join(sheetRoot, 'stale.png'), 'stale');
    writeFileSync(peerEvidence, 'keep');

    await runIconAssetAudit({ manifestPath, outputDir, repoRoot: root });
    expect(existsSync(path.join(sheetRoot, 'stale.png'))).toBe(false);
    expect(readFileSync(peerEvidence, 'utf8')).toBe('keep');

    writeFileSync(path.join(sheetRoot, 'stale-again.png'), 'stale');
    const report = await runIconAssetAudit({
      manifestPath,
      outputDir,
      repoRoot: root,
      sheets: false,
    });
    expect(report.contactSheets).toEqual([]);
    expect(existsSync(sheetRoot)).toBe(false);
    expect(readFileSync(peerEvidence, 'utf8')).toBe('keep');
    expect(existsSync(path.join(outputDir, 'icon-asset-audit.json'))).toBe(true);
  }, 30_000);

  it('exposes the positional manifest/output CLI and returns a failing status for audit errors', async () => {
    const root = fixtureRoot();
    const outputDir = path.join(root, 'cli-audit');
    const manifestPath = path.join(root, 'accepted.json');
    const value = await buildFixture(root, false);
    value.assets[0].acceptedBytes = (value.assets[0].acceptedBytes ?? 0) + 1;
    writeFileSync(manifestPath, `${JSON.stringify(value, null, 2)}\n`);

    const result = spawnSync(
      process.execPath,
      [CLI, manifestPath, outputDir, '--root', root, '--no-sheets'],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 20_000 },
    );

    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout).toContain('4 asset(s), 1 issue(s)');
    expect(readFileSync(path.join(outputDir, 'icon-asset-audit.json'), 'utf8')).toContain(
      'acceptedBytes',
    );
  });
});
