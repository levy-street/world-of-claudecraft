import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { getBounds, NodeIO, Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  EASTBROOK_TOWN_SOURCE_FILES,
  eastbrookTownSourceFingerprint,
} from '../scripts/assets/eastbrook_town/source_fingerprint.mjs';
import {
  buildEastbrookSurfaceAtlas,
  EASTBROOK_SURFACE_ATLAS_SOURCE_FILES,
  eastbrookSurfaceAtlasFingerprint,
} from '../scripts/assets/eastbrook_town/surface_atlas.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';

const REPO_ROOT = path.join(__dirname, '..');
const PROPS_ROOT = path.join(REPO_ROOT, 'public/models/props');
const EVIDENCE_ROOT = path.join(REPO_ROOT, 'docs/screenshots/eastbrook-vale-rebuild/assets');
const MATERIALS_ROOT = path.join(REPO_ROOT, 'docs/screenshots/eastbrook-vale-rebuild/materials');
const SOURCE_FINGERPRINT = '9262e650d1f9b1ece4fad225477a327f047b2aa4ac00a0f94250986fb8b3015e';
const SURFACE_ATLAS_SOURCE_SHA256 =
  'abec3036f8887e9c94972dab52aea664f18a74696db6b6d24cc48a4cfbe22b7d';
const SURFACE_ATLAS_SHIPPING_SHA256 =
  'd66f2fab603aa83e6c73c6fc4bdde2d545a6d8c1a0d4a58d42a3fb227e5a3f9b';
const SURFACE_ATLAS_PREVIEW_SHA256 =
  'ea6ba64e200f305f079cc858a4daf5d28dc8c240acd83895729237c521d26576';
const SURFACE_ATLAS_FINGERPRINT =
  '6427821b76f9f45878dd6c1616be49264d5cd66a7c4ed61606c23b31df21d224';
const TURNAROUND_VIEWS = [
  'front',
  'right',
  'back',
  'left',
  'front-3q',
  'rear-3q',
  'hero',
  'grazing',
] as const;
const AUDIT_VIEWS = ['neutral', 'dusk', 'player-scale', 'collider-overlay'] as const;

interface SocketContract {
  id: string;
  name: string;
  purpose: string;
}

interface AssetContract {
  id: string;
  runtimeId: string;
  file: string;
  rootName: string;
  dimensions: readonly [number, number, number];
  bytes: number;
  sha256: string;
  triangles: number;
  primitiveTriangles: readonly [number, number];
  triangleCeiling: number;
  byteCeiling: number;
  serviceCues: readonly string[];
  sockets: readonly SocketContract[];
}

const ASSETS: readonly AssetContract[] = [
  {
    id: 'bank',
    runtimeId: 'eastbrook-bank',
    file: 'eastbrook_bank.glb',
    rootName: 'EastbrookBank',
    dimensions: [7, 7.8, 5.5],
    bytes: 40_000,
    sha256: '2523aa26b93c27b246579030ee564e5fa4ea6d1fa036ad6f4fc033565e70aea7',
    triangles: 2324,
    primitiveTriangles: [2128, 196],
    triangleCeiling: 6000,
    byteCeiling: 350 * 1024,
    serviceCues: ['arched-entry', 'teller-window', 'vault-chest', 'bank-banner'],
    sockets: [
      { id: 'front-entry', name: 'Socket_FrontEntry', purpose: 'front entrance alignment' },
      { id: 'teller', name: 'Socket_TellerWindow', purpose: 'bank service cue' },
    ],
  },
  {
    id: 'smithy',
    runtimeId: 'eastbrook-smithy',
    file: 'eastbrook_smithy.glb',
    rootName: 'EastbrookSmithy',
    dimensions: [7, 7.5, 5.5],
    bytes: 40_352,
    sha256: '578250be84860f153145611e3f7df70d303b7ebfc9e2ee3e4c0aa4bb0c05a65e',
    triangles: 2410,
    primitiveTriangles: [2282, 128],
    triangleCeiling: 6000,
    byteCeiling: 350 * 1024,
    serviceCues: ['open-forge', 'chimney', 'anvil', 'tool-rack', 'log-rack'],
    sockets: [
      { id: 'front-entry', name: 'Socket_FrontEntry', purpose: 'front entrance alignment' },
      { id: 'forge', name: 'Socket_Forge', purpose: 'smithing service cue' },
    ],
  },
  {
    id: 'inn',
    runtimeId: 'eastbrook-inn',
    file: 'eastbrook_inn.glb',
    rootName: 'EastbrookInn',
    dimensions: [7.5, 8.5, 6],
    bytes: 67_768,
    sha256: '769b15a77972265a4b768b17faa4be011a72cdcf8e0efbd09ac7fa62abe68ddd',
    triangles: 4348,
    primitiveTriangles: [4004, 344],
    triangleCeiling: 6000,
    byteCeiling: 350 * 1024,
    serviceCues: ['deep-portico', 'upper-dormer', 'chimney-hood', 'provision-table'],
    sockets: [
      { id: 'front-entry', name: 'Socket_FrontEntry', purpose: 'front entrance alignment' },
      { id: 'provisions', name: 'Socket_Provisions', purpose: 'inn service cue' },
    ],
  },
  {
    id: 'chapel',
    runtimeId: 'eastbrook-chapel',
    file: 'eastbrook_chapel.glb',
    rootName: 'EastbrookChapel',
    dimensions: [5.5, 7, 6],
    bytes: 66_132,
    sha256: '7ac644f55f7dd8d3e22a330b7501643a8e2154edce569961772987d866b427f2',
    triangles: 4120,
    primitiveTriangles: [3800, 320],
    triangleCeiling: 6000,
    byteCeiling: 350 * 1024,
    serviceCues: ['pointed-entry', 'lancet-windows', 'flower-boxes', 'crystal-finial'],
    sockets: [
      { id: 'front-entry', name: 'Socket_FrontEntry', purpose: 'front entrance alignment' },
      { id: 'altar-axis', name: 'Socket_AltarAxis', purpose: 'chapel interior axis cue' },
    ],
  },
  {
    id: 'weaving_workshop',
    runtimeId: 'eastbrook-weaving-workshop',
    file: 'eastbrook_weaving_workshop.glb',
    rootName: 'EastbrookWeavingWorkshop',
    dimensions: [5.5, 5.8, 4.5],
    bytes: 40_392,
    sha256: '4369633e650ac83bd2c3419ff53c8095b163a709c46f0b3e9514b03367cbc270',
    triangles: 2412,
    primitiveTriangles: [2272, 140],
    triangleCeiling: 6000,
    byteCeiling: 350 * 1024,
    serviceCues: ['open-loom-bay', 'threaded-loom', 'fabric-rolls', 'dye-barrel'],
    sockets: [
      { id: 'front-entry', name: 'Socket_FrontEntry', purpose: 'front entrance alignment' },
      { id: 'loom', name: 'Socket_Loom', purpose: 'weaving service cue' },
    ],
  },
  {
    id: 'toolworks',
    runtimeId: 'eastbrook-toolworks',
    file: 'eastbrook_toolworks.glb',
    rootName: 'EastbrookToolworks',
    dimensions: [5.5, 5.8, 4.5],
    bytes: 39_920,
    sha256: 'a437cde7b39bfcbd111fce105f9357b073e65359b1dc0259b567817534346d2d',
    triangles: 2320,
    primitiveTriangles: [2180, 140],
    triangleCeiling: 6000,
    byteCeiling: 350 * 1024,
    serviceCues: ['covered-tool-display', 'workbench', 'crate', 'barrel'],
    sockets: [
      { id: 'front-entry', name: 'Socket_FrontEntry', purpose: 'front entrance alignment' },
      { id: 'tool-display', name: 'Socket_ToolDisplay', purpose: 'tool service cue' },
    ],
  },
  {
    id: 'civic_well_beacon',
    runtimeId: 'eastbrook-civic-well-beacon',
    file: 'eastbrook_civic_well_beacon.glb',
    rootName: 'EastbrookCivicWellBeacon',
    dimensions: [3.2, 3.1, 3.2],
    bytes: 13_216,
    sha256: '32449160a9e1d0b89687e7d5a2a45feb3b8d293972e29e829cc4b329bd922add',
    triangles: 464,
    primitiveTriangles: [456, 8],
    triangleCeiling: 3000,
    byteCeiling: 180 * 1024,
    serviceCues: ['masonry-well', 'water-basin', 'crystal-beacon'],
    sockets: [
      { id: 'center', name: 'Socket_CivicCenter', purpose: 'civic center alignment' },
      { id: 'beacon', name: 'Socket_Beacon', purpose: 'beacon effect anchor' },
    ],
  },
  {
    id: 'market_stall',
    runtimeId: 'eastbrook-market-stall',
    file: 'eastbrook_market_stall.glb',
    rootName: 'EastbrookMarketStall',
    dimensions: [2.8, 2.7, 2.2],
    bytes: 27_072,
    sha256: '29da7ea6a7613e171d82feb1e5be0d481b3da38d0908a67ae84c7d9725c44af1',
    triangles: 1314,
    primitiveTriangles: [1294, 20],
    triangleCeiling: 3000,
    byteCeiling: 180 * 1024,
    serviceCues: ['striped-canopy', 'counter-goods', 'crate', 'barrel', 'lanterns'],
    sockets: [
      { id: 'vendor', name: 'Socket_Vendor', purpose: 'vendor alignment' },
      { id: 'counter', name: 'Socket_Counter', purpose: 'market service cue' },
    ],
  },
  {
    id: 'wall_wing',
    runtimeId: 'eastbrook-wall-wing',
    file: 'eastbrook_wall_wing.glb',
    rootName: 'EastbrookWallWing',
    dimensions: [6.5, 2.7, 0.65],
    bytes: 8352,
    sha256: 'eb9266aac9075abe32b4b9537c38e035d69335cb254d5324141f7fafebdf10ea',
    triangles: 206,
    primitiveTriangles: [196, 10],
    triangleCeiling: 206,
    byteCeiling: 180 * 1024,
    serviceCues: ['masonry-courses', 'rail-caps', 'watch-lantern', 'banded-gate-leaf'],
    sockets: [
      { id: 'left-join', name: 'Socket_LeftJoin', purpose: 'wall chaining anchor' },
      { id: 'right-gate', name: 'Socket_RightGate', purpose: 'gate-side chaining anchor' },
    ],
  },
];

function expectApproxArray(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  for (const [index, value] of expected.entries()) {
    expect(
      Math.abs(actual[index] - value),
      `component ${index}: ${actual[index]} vs ${value}`,
    ).toBe(0);
  }
}

function expectQuantizedArray(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  for (const [index, value] of expected.entries()) {
    expect(
      Math.abs(actual[index] - value),
      `component ${index}: ${actual[index]} vs ${value}`,
    ).toBeLessThanOrEqual(2e-3);
  }
}

const SURFACE_ATLAS_SEMANTICS = [
  'dark-stone-blocks',
  'light-stone-blocks',
  'warm-plaster',
  'vertical-dark-timber',
  'cobalt-roof-shingles',
  'dark-forged-metal',
  'warm-gold-metal',
  'horizontal-warm-timber',
  'blue-cream-canvas',
  'red-cream-canvas',
  'dark-brown-leather',
  'irregular-dark-stone',
  'cyan-crystal',
  'cobalt-painted-planks',
  'light-gray-stone',
  'medium-gray-stone',
] as const;

describe('Eastbrook shared surface atlas', () => {
  it('derives a fresh high-key grayscale multiplier independently from all 16 source cells', {
    timeout: 30000,
  }, async () => {
    const sourcePath = path.join(MATERIALS_ROOT, 'eastbrook-surface-atlas-source.png');
    const shippingPath = path.join(REPO_ROOT, 'public/textures/eastbrook_surface_atlas.webp');
    const previewPath = path.join(MATERIALS_ROOT, 'eastbrook-surface-atlas-comparison.png');
    const specPath = path.join(REPO_ROOT, 'scripts/assets/specs/eastbrook_town_surface_atlas.json');

    expect(EASTBROOK_SURFACE_ATLAS_SOURCE_FILES).toEqual([
      'docs/screenshots/eastbrook-vale-rebuild/materials/eastbrook-surface-atlas-source.png',
      'scripts/assets/eastbrook_town/surface_atlas.mjs',
      'scripts/assets/eastbrook_town/build_surface_atlas.mjs',
      'scripts/assets/specs/eastbrook_town_surface_atlas.json',
      'package-lock.json',
    ]);
    for (const atlasOnlyPath of EASTBROOK_SURFACE_ATLAS_SOURCE_FILES.slice(0, 4)) {
      expect(EASTBROOK_TOWN_SOURCE_FILES).not.toContain(atlasOnlyPath);
    }
    expect(EASTBROOK_TOWN_SOURCE_FILES).toContain('package-lock.json');
    expect(eastbrookTownSourceFingerprint(REPO_ROOT)).toBe(SOURCE_FINGERPRINT);

    const spec = JSON.parse(readFileSync(specPath, 'utf8')) as {
      schemaVersion: number;
      source: { path: string; sha256: string; width: number; height: number; format: string };
      shipping: {
        path: string;
        url: string;
        sha256: string;
        width: number;
        height: number;
        format: string;
        byteCeiling: number;
      };
      preview: { path: string; sha256: string; width: number; height: number; format: string };
      usage: {
        role: string;
        colorSpace: string;
        paletteAuthority: string;
        channelRange: [number, number];
        embeddedInGlbs: boolean;
      };
      processing: {
        grid: {
          columns: number;
          rows: number;
          sourceInsetPixels: number;
          partition: string;
        };
        outputCellPixels: number;
        luminance: { red: number; green: number; blue: number; divisor: number };
        normalization: {
          lowPercentile: number;
          highPercentile: number;
          outputMin: number;
          outputMax: number;
        };
        resizeKernel: string;
        webp: { lossless: boolean; effort: number };
      };
      semantics: Array<{
        index: number;
        id: string;
        row: number;
        column: number;
        centerUvTopLeft: [number, number];
        centerUvBottomLeft: [number, number];
      }>;
    };
    expect(spec.schemaVersion).toBe(1);
    expect(spec.source).toEqual({
      path: 'docs/screenshots/eastbrook-vale-rebuild/materials/eastbrook-surface-atlas-source.png',
      sha256: SURFACE_ATLAS_SOURCE_SHA256,
      width: 1254,
      height: 1254,
      format: 'png',
    });
    expect(spec.shipping).toMatchObject({
      path: 'public/textures/eastbrook_surface_atlas.webp',
      url: '/textures/eastbrook_surface_atlas.webp',
      width: 512,
      height: 512,
      format: 'webp',
      byteCeiling: 256 * 1024,
      sha256: SURFACE_ATLAS_SHIPPING_SHA256,
    });
    expect(spec.preview).toEqual({
      path: 'docs/screenshots/eastbrook-vale-rebuild/materials/eastbrook-surface-atlas-comparison.png',
      sha256: SURFACE_ATLAS_PREVIEW_SHA256,
      width: 1072,
      height: 544,
      format: 'png',
    });
    expect(spec.usage).toEqual({
      role: 'high-key-grayscale-detail-multiplier',
      colorSpace: 'none',
      paletteAuthority: 'vertex-color',
      channelRange: [192, 255],
      embeddedInGlbs: false,
    });
    expect(spec.processing).toEqual({
      grid: {
        columns: 4,
        rows: 4,
        sourceInsetPixels: 2,
        partition: 'rounded-equal-quarters',
      },
      outputCellPixels: 128,
      luminance: { red: 54, green: 183, blue: 19, divisor: 256 },
      normalization: {
        lowPercentile: 0.02,
        highPercentile: 0.98,
        outputMin: 192,
        outputMax: 255,
      },
      resizeKernel: 'lanczos3',
      webp: { lossless: true, effort: 6 },
    });
    expect(spec.semantics.map((cell) => cell.id)).toEqual(SURFACE_ATLAS_SEMANTICS);
    for (const [index, cell] of spec.semantics.entries()) {
      const row = Math.floor(index / 4);
      const column = index % 4;
      expect(cell).toEqual({
        index,
        id: SURFACE_ATLAS_SEMANTICS[index],
        row,
        column,
        centerUvTopLeft: [(column + 0.5) / 4, (row + 0.5) / 4],
        centerUvBottomLeft: [(column + 0.5) / 4, 1 - (row + 0.5) / 4],
      });
    }

    const sourceBytes = readFileSync(sourcePath);
    expect(createHash('sha256').update(sourceBytes).digest('hex')).toBe(spec.source.sha256);
    const sourceMetadata = await sharp(sourceBytes).metadata();
    expect(sourceMetadata).toMatchObject({ width: 1254, height: 1254, format: 'png' });

    const shippingBytes = readFileSync(shippingPath);
    expect(shippingBytes.length).toBe(141_666);
    expect(createHash('sha256').update(shippingBytes).digest('hex')).toBe(spec.shipping.sha256);
    expect(shippingBytes.length).toBeLessThanOrEqual(spec.shipping.byteCeiling);
    expect(await sharp(shippingBytes).metadata()).toMatchObject({
      width: 512,
      height: 512,
      format: 'webp',
      hasAlpha: false,
    });
    const { data: shippingPixels } = await sharp(shippingBytes)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let channelMismatchCount = 0;
    const cellRanges = Array.from({ length: 16 }, () => ({ min: 255, max: 0 }));
    for (let offset = 0; offset < shippingPixels.length; offset += 3) {
      const pixel = offset / 3;
      const x = pixel % 512;
      const y = Math.floor(pixel / 512);
      const cell = Math.floor(y / 128) * 4 + Math.floor(x / 128);
      const value = shippingPixels[offset];
      cellRanges[cell].min = Math.min(cellRanges[cell].min, value);
      cellRanges[cell].max = Math.max(cellRanges[cell].max, value);
      if (shippingPixels[offset + 1] !== value || shippingPixels[offset + 2] !== value) {
        channelMismatchCount += 1;
      }
    }
    expect(channelMismatchCount).toBe(0);
    expect(cellRanges).toEqual(Array.from({ length: 16 }, () => ({ min: 192, max: 255 })));

    const rebuilt = await buildEastbrookSurfaceAtlas(sourceBytes);
    expect(rebuilt.atlas).toEqual(shippingBytes);
    expect(rebuilt.preview).toEqual(readFileSync(previewPath));
    expect(createHash('sha256').update(rebuilt.preview).digest('hex')).toBe(spec.preview.sha256);
    expect(await sharp(rebuilt.preview).metadata()).toMatchObject({
      width: spec.preview.width,
      height: spec.preview.height,
      format: 'png',
    });
    expect(eastbrookSurfaceAtlasFingerprint(REPO_ROOT)).toBe(SURFACE_ATLAS_FINGERPRINT);

    const manifestKey = spec.shipping.url.replace(/^\//, '');
    expect(MEDIA_ASSETS[manifestKey]).toBe(
      `/media/textures/eastbrook_surface_atlas.${spec.shipping.sha256.slice(0, 12)}.webp`,
    );
  });
});

describe('Eastbrook town shipping GLBs', () => {
  it('pins all nine generated media-manifest mappings to their optimized hashes', () => {
    const actual = Object.fromEntries(
      ASSETS.map((asset) => {
        const key = `models/props/${asset.file}`;
        return [key, MEDIA_ASSETS[key]];
      }),
    );
    const expected = Object.fromEntries(
      ASSETS.map((asset) => {
        const stem = asset.file.replace(/\.glb$/, '');
        return [
          `models/props/${asset.file}`,
          `/media/models/props/${stem}.${asset.sha256.slice(0, 12)}.glb`,
        ];
      }),
    );
    expect(actual).toEqual(expected);
    expect(Object.keys(actual)).toHaveLength(9);
  });

  it('pins the deterministic source inventory and optimizer specification', () => {
    expect(EASTBROOK_TOWN_SOURCE_FILES).toEqual([
      'scripts/assets/eastbrook_town/shared.js',
      'scripts/assets/eastbrook_town/buildings_commerce.js',
      'scripts/assets/eastbrook_town/buildings_craft.js',
      'scripts/assets/eastbrook_town/furniture.js',
      'scripts/assets/eastbrook_town/model.js',
      'scripts/assets/eastbrook_town/export_entry.js',
      'scripts/assets/eastbrook_town/export_eastbrook_town.mjs',
      'scripts/assets/eastbrook_town/source_fingerprint.mjs',
      'scripts/assets/specs/eastbrook_town.json',
      'scripts/assets/build_assets.mjs',
      'package-lock.json',
    ]);
    expect(eastbrookTownSourceFingerprint(REPO_ROOT)).toBe(SOURCE_FINGERPRINT);
    expect(eastbrookTownSourceFingerprint(REPO_ROOT)).toBe(
      eastbrookTownSourceFingerprint(REPO_ROOT),
    );

    const spec = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'scripts/assets/specs/eastbrook_town.json'), 'utf8'),
    );
    expect(spec).toEqual({
      items: ASSETS.map((asset) => ({
        src: `tmp/asset_src/eastbrook_town/${asset.id}-final.glb`,
        out: `models/props/${asset.file}`,
        type: 'static',
        keepExtras: true,
      })),
    });

    const exporterSource = readFileSync(
      path.join(REPO_ROOT, 'scripts/assets/eastbrook_town/export_eastbrook_town.mjs'),
      'utf8',
    );
    expect(exporterSource).toContain("process.argv.includes('--verify-staged')");
    expect(exporterSource).toContain('deterministic optimized rebuild:');
    expect(exporterSource).toContain("'front-3q'");
    expect(exporterSource).toContain("'rear-3q'");
    expect(exporterSource).toContain("'collider-overlay'");
    expect(exporterSource).toContain('--preview-only --asset wall_wing');
  });

  it('pins structure, dimensions, metadata, budgets, and exact optimized bytes', {
    timeout: 30000,
  }, async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    let totalBytes = 0;
    let totalTriangles = 0;

    for (const asset of ASSETS) {
      const assetPath = path.join(PROPS_ROOT, asset.file);
      expect(existsSync(assetPath), `${asset.file} is missing`).toBe(true);
      const bytes = readFileSync(assetPath);
      expect(bytes.toString('utf8', 0, 4)).toBe('glTF');
      expect(bytes.readUInt32LE(4)).toBe(2);
      expect(bytes.length).toBe(asset.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
      expect(bytes.length).toBeLessThanOrEqual(asset.byteCeiling);

      const document = await io.readBinary(bytes);
      const root = document.getRoot();
      expect(
        root
          .listExtensionsUsed()
          .map((extension) => extension.extensionName)
          .sort(),
      ).toEqual([
        'EXT_meshopt_compression',
        'KHR_materials_emissive_strength',
        'KHR_mesh_quantization',
      ]);
      expect(
        root
          .listExtensionsRequired()
          .map((extension) => extension.extensionName)
          .sort(),
      ).toEqual(['EXT_meshopt_compression', 'KHR_mesh_quantization']);
      expect(root.listTextures()).toHaveLength(0);
      expect(root.listAnimations()).toHaveLength(0);
      expect(root.listSkins()).toHaveLength(0);
      expect(root.listCameras()).toHaveLength(0);
      expect(root.listScenes()).toHaveLength(1);
      expect(root.listNodes()).toHaveLength(5);
      expect(root.listMeshes()).toHaveLength(2);
      expect(root.listMaterials()).toHaveLength(2);

      for (const [accessorIndex, accessor] of root.listAccessors().entries()) {
        const array = accessor.getArray();
        expect(array, `${asset.id} accessor ${accessorIndex} has no storage`).not.toBeNull();
        expect(accessor.getCount()).toBeGreaterThan(0);
        expect(array?.length).toBe(accessor.getCount() * accessor.getElementSize());
        if (array) {
          for (const value of array) {
            expect(Number.isFinite(value), `${asset.id} accessor contains ${value}`).toBe(true);
          }
        }
      }

      const scene = root.listScenes()[0];
      expect(scene.listChildren().map((node) => node.getName())).toEqual([asset.rootName]);
      const modelRoot = scene.listChildren()[0];
      expectApproxArray(modelRoot.getTranslation(), [0, 0, 0]);
      expectApproxArray(modelRoot.getRotation(), [0, 0, 0, 1]);
      expectApproxArray(modelRoot.getScale(), [1, 1, 1]);

      const bounds = getBounds(scene);
      const [width, height, depth] = asset.dimensions;
      expectQuantizedArray(bounds.min, [-width / 2, 0, -depth / 2]);
      expectQuantizedArray(bounds.max, [width / 2, height, depth / 2]);

      const meshContracts = root.listMeshes().map((mesh) => {
        expect(mesh.listPrimitives()).toHaveLength(1);
        const primitive = mesh.listPrimitives()[0];
        expect(primitive.getMode()).toBe(Primitive.Mode.TRIANGLES);
        expect(primitive.listSemantics().sort()).toEqual(['COLOR_0', 'NORMAL', 'POSITION']);
        const position = primitive.getAttribute('POSITION');
        const normal = primitive.getAttribute('NORMAL');
        const color = primitive.getAttribute('COLOR_0');
        if (!position || !normal || !color) throw new Error(`${asset.id} lost a vertex attribute`);
        expect(position.getType()).toBe('VEC3');
        expect(normal.getType()).toBe('VEC3');
        expect(color.getType()).toBe('VEC3');
        expect(normal.getCount()).toBe(position.getCount());
        expect(color.getCount()).toBe(position.getCount());
        const triangles = (primitive.getIndices()?.getCount() ?? position.getCount()) / 3;
        return [primitive.getMaterial()?.getName(), triangles] as const;
      });
      expect(meshContracts).toEqual([
        ['TownOpaque', asset.primitiveTriangles[0]],
        ['TownEmissive', asset.primitiveTriangles[1]],
      ]);
      const triangles = meshContracts.reduce((sum, [, count]) => sum + count, 0);
      expect(triangles).toBe(asset.triangles);
      expect(triangles).toBeLessThanOrEqual(asset.triangleCeiling);

      const materials = root.listMaterials();
      expect(materials.map((material) => material.getName())).toEqual([
        'TownOpaque',
        'TownEmissive',
      ]);
      expect(
        materials.filter((material) => material.getEmissiveFactor().some((v) => v > 0)),
      ).toHaveLength(1);

      const runtime = (
        modelRoot.getExtras() as {
          sculptRuntime?: {
            schemaVersion: number;
            assetId: string;
            coordinateFrame: Record<string, string>;
            nativeBounds: Record<string, number>;
            serviceCues: string[];
            interaction: { mode: string; interactive: boolean };
            collider: { shippingCollisionMesh: boolean };
            destruction: { breakable: boolean; detachableParts: unknown[] };
            sockets: Record<
              string,
              { nodeName: string; position: number[]; purpose: string; interactive: boolean }
            >;
          };
        }
      ).sculptRuntime;
      expect(runtime).toBeDefined();
      expect(runtime).toMatchObject({
        schemaVersion: 1,
        assetId: asset.runtimeId,
        coordinateFrame: { front: '+Z', up: '+Y', right: '+X', units: 'world-yards' },
        nativeBounds: { width, height, depth },
        serviceCues: asset.serviceCues,
        interaction: { mode: 'static-town-asset', interactive: false },
        collider: { shippingCollisionMesh: false },
        destruction: { breakable: false, detachableParts: [] },
      });

      for (const socket of asset.sockets) {
        const node = root.listNodes().find((candidate) => candidate.getName() === socket.name);
        expect(node, `${asset.id} lost ${socket.name}`).toBeDefined();
        if (!node || !runtime) continue;
        expect(node.getMesh()).toBeNull();
        expect(node.listChildren()).toHaveLength(0);
        expectApproxArray(node.getRotation(), [0, 0, 0, 1]);
        expectApproxArray(node.getScale(), [1, 1, 1]);
        expect(node.getTranslation().every(Number.isFinite)).toBe(true);
        expect(node.getExtras()).toEqual({
          sculptSocket: { id: socket.id, purpose: socket.purpose, interactive: false },
        });
        expect(runtime.sockets[socket.id]).toMatchObject({
          nodeName: socket.name,
          purpose: socket.purpose,
          interactive: false,
        });
        expectQuantizedArray(runtime.sockets[socket.id].position, node.getTranslation());
      }
      expect(Object.keys(runtime?.sockets ?? {}).sort()).toEqual(
        asset.sockets.map((socket) => socket.id).sort(),
      );
      expect(root.getExtras()).toEqual({ sourceFingerprint: SOURCE_FINGERPRINT });
      expect(root.getAsset().extras).toEqual({ sourceFingerprint: SOURCE_FINGERPRINT });

      totalBytes += bytes.length;
      totalTriangles += triangles;
    }

    expect(totalBytes).toBe(343_204);
    expect(totalBytes).toBeLessThanOrEqual(Math.floor(1.25 * 1024 * 1024));
    expect(totalTriangles).toBe(19_918);
    expect(totalTriangles).toBeLessThanOrEqual(30_000);
  });

  it('counts repeated geometry against the whole-town runtime triangle target', () => {
    const triangleCount = (id: string) => {
      const asset = ASSETS.find((candidate) => candidate.id === id);
      if (!asset) throw new Error(`missing triangle contract for ${id}`);
      return asset.triangles;
    };
    const buildingTriangles = [
      'bank',
      'smithy',
      'inn',
      'chapel',
      'weaving_workshop',
      'toolworks',
    ].reduce((sum, id) => sum + triangleCount(id), 0);
    const fixedNonWallTriangles =
      buildingTriangles +
      triangleCount('civic_well_beacon') +
      2 * triangleCount('market_stall') +
      4 * 208 +
      3 * 348;
    const wallTriangles = 26 * triangleCount('wall_wing');
    const optionalFoundationSkirtTriangles = 6 * 12;
    const wholeTownTriangles =
      fixedNonWallTriangles + wallTriangles + optionalFoundationSkirtTriangles;

    expect(buildingTriangles).toBe(17_934);
    expect(fixedNonWallTriangles).toBe(22_902);
    expect(optionalFoundationSkirtTriangles).toBe(72);
    expect(wholeTownTriangles).toBe(28_330);
    expect(wholeTownTriangles).toBeLessThanOrEqual(30_000);
  });

  it('pins every evidence surface and the visual identity acceptance gate', () => {
    const acceptance = JSON.parse(
      readFileSync(path.join(EVIDENCE_ROOT, 'visual-acceptance.json'), 'utf8'),
    ) as {
      schemaVersion: number;
      policy: {
        authority: string;
        globalThreshold: number;
        criticalFeatureThreshold: number;
        decisionRule: string;
      };
      turnaroundViews: string[];
      auditViews: string[];
      surfaceAtlas: {
        decision: string;
        sourceImage: string;
        comparisonImage: string;
        shippingAsset: string;
        sourceDimensions: number[];
        sourceSha256: string;
        shippingDimensions: number[];
        shippingSha256: string;
        shippingBytes: number;
        atlasFingerprint: string;
        grid: Record<string, unknown>;
        usageContract: Record<string, unknown>;
        review: {
          layerScores: Record<string, number>;
          criticalFeatures: Array<{
            id: string;
            score: number;
            threshold: number;
            visible: boolean;
          }>;
        };
      };
      assets: Array<{
        id: string;
        decision: string;
        globalScore: number;
        comparisonImage: string;
        auditImage: string;
        layerScores: Record<string, number>;
        criticalFeatures: Array<{
          id: string;
          score: number;
          threshold: number;
          visible: boolean;
        }>;
      }>;
    };
    expect(acceptance.schemaVersion).toBe(1);
    expect(acceptance.policy).toEqual({
      authority: 'agent-vision-review',
      globalThreshold: 0.7,
      criticalFeatureThreshold: 0.7,
      decisionRule: 'global-and-every-critical-feature',
    });
    expect(acceptance.turnaroundViews).toEqual(TURNAROUND_VIEWS);
    expect(acceptance.auditViews).toEqual(AUDIT_VIEWS);
    expect(acceptance.surfaceAtlas).toMatchObject({
      decision: 'accept',
      sourceImage: '../materials/eastbrook-surface-atlas-source.png',
      comparisonImage: '../materials/eastbrook-surface-atlas-comparison.png',
      shippingAsset: '/textures/eastbrook_surface_atlas.webp',
      sourceDimensions: [1254, 1254],
      sourceSha256: SURFACE_ATLAS_SOURCE_SHA256,
      shippingDimensions: [512, 512],
      shippingSha256: SURFACE_ATLAS_SHIPPING_SHA256,
      shippingBytes: 141_666,
      atlasFingerprint: SURFACE_ATLAS_FINGERPRINT,
      grid: {
        columns: 4,
        rows: 4,
        cellDimensions: [128, 128],
        coordinateOrigin: 'top-left-image',
      },
      usageContract: {
        role: 'high-key-grayscale-detail-multiplier',
        colorSpace: 'none',
        channelRange: [192, 255],
        paletteAuthority: 'vertex-color',
        glbTextures: 0,
      },
    });
    for (const score of Object.values(acceptance.surfaceAtlas.review.layerScores)) {
      expect(score).toBeGreaterThanOrEqual(acceptance.policy.globalThreshold);
    }
    expect(acceptance.surfaceAtlas.review.criticalFeatures).toHaveLength(3);
    for (const feature of acceptance.surfaceAtlas.review.criticalFeatures) {
      expect(feature.visible, feature.id).toBe(true);
      expect(feature.threshold).toBe(acceptance.policy.criticalFeatureThreshold);
      expect(feature.score, feature.id).toBeGreaterThanOrEqual(feature.threshold);
    }
    expect(acceptance.assets.map((asset) => asset.id)).toEqual(ASSETS.map((asset) => asset.id));

    for (const asset of ASSETS) {
      const review = acceptance.assets.find((candidate) => candidate.id === asset.id);
      expect(review, `${asset.id} has no visual review`).toBeDefined();
      if (!review) continue;
      expect(review.decision).toBe('accept');
      expect(review.globalScore).toBeGreaterThanOrEqual(acceptance.policy.globalThreshold);
      expect(Object.keys(review.layerScores).sort()).toEqual([
        'color-material',
        'geometry-depth',
        'service-readability',
        'silhouette-proportion',
      ]);
      for (const score of Object.values(review.layerScores)) {
        expect(score).toBeGreaterThanOrEqual(acceptance.policy.globalThreshold);
      }
      expect(review.criticalFeatures.length).toBeGreaterThanOrEqual(3);
      for (const feature of review.criticalFeatures) {
        expect(feature.visible).toBe(true);
        expect(feature.threshold).toBe(acceptance.policy.criticalFeatureThreshold);
        expect(feature.score, `${asset.id}:${feature.id}`).toBeGreaterThanOrEqual(
          feature.threshold,
        );
      }
      expect(review.comparisonImage).toBe(`${asset.id}-comparison.png`);
      expect(review.auditImage).toBe(`${asset.id}-optimized-audit-contact.png`);
      for (const suffix of [
        'procedural-contact.png',
        'raw-contact.png',
        'optimized-contact.png',
        'optimized-audit-contact.png',
        'comparison.png',
      ]) {
        const evidencePath = path.join(EVIDENCE_ROOT, `${asset.id}-${suffix}`);
        expect(existsSync(evidencePath), `${asset.id}-${suffix} is missing`).toBe(true);
        expect(statSync(evidencePath).size).toBeGreaterThan(1024);
      }
    }
  });
});
