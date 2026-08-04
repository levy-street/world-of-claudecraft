import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { getBounds, NodeIO, Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyFenbridgeEvidenceSurface } from '../scripts/assets/fenbridge_town/evidence_surface.js';
import {
  FENBRIDGE_TOWN_ASSET_IDS,
  FENBRIDGE_TOWN_CONTRACTS,
  FENBRIDGE_TOWN_WAVE_CEILINGS,
} from '../scripts/assets/fenbridge_town/model.js';
import {
  addPitchedRoof,
  createFenbridgeBuckets,
  FENBRIDGE_PALETTE,
} from '../scripts/assets/fenbridge_town/shared.js';
import {
  FENBRIDGE_TOWN_SOURCE_FILES,
  fenbridgeTownSourceFingerprint,
} from '../scripts/assets/fenbridge_town/source_fingerprint.mjs';
import {
  buildFenbridgeSupportMaps,
  FENBRIDGE_SUPPORT_MAP_GRID,
  FENBRIDGE_SUPPORT_MAP_SIZE,
  fenbridgeSupportMapFingerprint,
} from '../scripts/assets/fenbridge_town/support_maps.mjs';
import { FENBRIDGE_SURFACE_WORLD_SPAN } from '../src/render/fenbridge_surface_atlas';
import { FENBRIDGE_LAYOUT, localToWorld } from '../src/sim/fenbridge_layout';

const REPO_ROOT = path.join(__dirname, '..');
const EVIDENCE_ROOT = path.join(REPO_ROOT, 'docs/screenshots/fenbridge-rebuild/assets');
const INTAKE_ROOT = path.join(REPO_ROOT, 'docs/design/fenbridge-rebuild/img2threejs');
const EXPECTED_SOURCE_FINGERPRINT =
  '80f4c21427673eb2fa85ee8bfd14cd52f1d2ce5f5c4e133906aa384c916f196c';
const EXPECTED_SUPPORT_FINGERPRINT =
  '7d2ae0d5099baf1803cda499de82d7d08c23349d7d9c439837a4a33ee87eaad4';
const FOUNDATION_TRIANGLES = 84;
const RENDERER_HARD_CEILING = 88_000;

interface ExpectedArtifact {
  bytes: number;
  sha256: string;
  triangles: number;
  primitiveTriangles: readonly number[];
}

const EXPECTED_ARTIFACTS: Readonly<Record<string, ExpectedArtifact>> = {
  warden_gatehouse: {
    bytes: 142_328,
    sha256: 'f8020aeb03f9c397dffc5b8c8940bd3d13bb5535f893599e7603182cd5a0e19c',
    triangles: 8_794,
    primitiveTriangles: [8_723, 71],
  },
  crooked_reed_inn: {
    bytes: 149_080,
    sha256: '66968f0fefcd56bb44e85d6a1a14574bc5908155b636fac3475653d0cc647327',
    triangles: 8_949,
    primitiveTriangles: [8_807, 142],
  },
  lantern_chapel: {
    bytes: 107_736,
    sha256: '993893850841462c416faa07cafd028b5a460f8fe293b76cd5737a797f265396',
    triangles: 6_691,
    primitiveTriangles: [6_506, 185],
  },
  moonwort_apothecary: {
    bytes: 104_468,
    sha256: '9ec8d452a7467446d0f49749d90edd9368cb00490f782193420c7447b985bb37',
    triangles: 6_086,
    primitiveTriangles: [6_017, 69],
  },
  gilded_strongbox: {
    bytes: 69_908,
    sha256: '7c621a8dd2329e954ccb1d4620e0a63be43d09b641a61cbdbdcc6cd243f54e2b',
    triangles: 4_133,
    primitiveTriangles: [4_033, 100],
  },
  hesk_tannery: {
    bytes: 198_888,
    sha256: 'bf059b5ad92c1136dc972ef23fa572167ab53f4bfa2165bf8e1736d7c62578c1',
    triangles: 12_740,
    primitiveTriangles: [12_581, 159],
  },
  scout_lodge: {
    bytes: 110_868,
    sha256: '03ea4700275c76d44ce20ccf96dda912cf6869c5ced4e391d40bac1f48d4b5c2',
    triangles: 6_527,
    primitiveTriangles: [6_451, 76],
  },
  mirelight_cistern: {
    bytes: 48_940,
    sha256: '14ea081b4fd6927d7670066fc78131c143a534dabc1f42472336318391fe9425',
    triangles: 2_388,
    primitiveTriangles: [2_328, 60],
  },
  provision_stall: {
    bytes: 26_332,
    sha256: '4dd1b1fbca430ee621d9cef87a713057f2265ab101e9070cf50ba724d9acc962',
    triangles: 1_304,
    primitiveTriangles: [1_280, 24],
  },
  palisade_wing: {
    bytes: 16_792,
    sha256: 'b90bcf34df69d2ebc7a483e5be7291bf05de153ca5d2bc2c463319cc401714d4',
    triangles: 829,
    primitiveTriangles: [829],
  },
  gate_arch: {
    bytes: 24_648,
    sha256: 'd95ef6f59c1368a42ddbba89ac14f57c3fd701310439e8dd0f2a137359b61249',
    triangles: 1_240,
    primitiveTriangles: [1_216, 24],
  },
  boardwalk: {
    bytes: 9_264,
    sha256: '0e1238051ea7de8682d465a8272518ade30758c52b7ac69827b0f75ebb1b97ea',
    triangles: 376,
    primitiveTriangles: [376],
  },
  muster_board: {
    bytes: 17_636,
    sha256: 'a515ad1d5eeca8eb983ee1210f50faa72d1c66c1df6817e58dfdc209924b7278',
    triangles: 768,
    primitiveTriangles: [744, 24],
  },
  muster_order: {
    bytes: 6_888,
    sha256: 'bfa52be5e0cac936a6c5d08137bde40ca0739a64354f64e3fcf8e067cf8a5b01',
    triangles: 204,
    primitiveTriangles: [204],
  },
};
const EXPECTED_TOTALS = {
  bytes: 1_033_776,
  uniqueTriangles: 61_029,
  // boardwalk placementCount 12 (was 10): +2 * 376 tris
  placementWeightedTriangles: 81_524,
} as const;

const SUPPORT_MAPS = {
  base: {
    file: 'public/textures/fenbridge_surface_atlas.webp',
    bytes: 87_780,
    sha256: '527a4afd4116ff8ee2d70a5a6af8db1e93ed17f388f48cb77c199d51b5bbb5c9',
  },
  normal: {
    file: 'public/textures/fenbridge_surface_normal.webp',
    bytes: 90_220,
    sha256: 'd68714b1925f792840fd1b6dd90d682c5bc2e7a474177105e3a9bb12a017cef9',
  },
  roughness: {
    file: 'public/textures/fenbridge_surface_roughness.webp',
    bytes: 17_080,
    sha256: 'ea442943770ba8b7fc06783654ef34f6f2a7aee7d1e272a6d26800b31d410b4a',
  },
} as const;

const REQUIRED_EVIDENCE_SUFFIXES = [
  'procedural-contact.png',
  'raw-contact.png',
  'optimized-contact.png',
  'optimized-audit-contact.png',
  'comparison.png',
] as const;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function outputPath(assetId: string): string {
  const contract = FENBRIDGE_TOWN_CONTRACTS[assetId];
  return path.join(REPO_ROOT, 'public', contract.outputDirectory, contract.outputName);
}

function expectApproxArray(
  actual: readonly number[],
  expected: readonly number[],
  tolerance = 0.002,
): void {
  expect(actual).toHaveLength(expected.length);
  for (let index = 0; index < expected.length; index++) {
    expect(Math.abs(actual[index] - expected[index])).toBeLessThanOrEqual(tolerance);
  }
}

function linkedDetailKeys(spec: Record<string, unknown>): Set<string> {
  const keys = new Set<string>();
  for (const component of (spec.componentTree ?? []) as Array<Record<string, unknown>>) {
    const componentId = component.id;
    if (typeof componentId === 'string') keys.add(componentId);
    for (const feature of (component.localFeatures ?? []) as Array<string | { id?: string }>) {
      const featureId = typeof feature === 'string' ? feature : feature.id;
      if (featureId) {
        keys.add(featureId);
        if (typeof componentId === 'string') keys.add(`${componentId}/${featureId}`);
      }
    }
  }
  for (const material of (spec.materials ?? []) as Array<Record<string, unknown>>) {
    const materialId = material.id;
    if (typeof materialId === 'string') keys.add(materialId);
    for (const override of (material.localOverrides ?? []) as Array<{ id?: string }>) {
      if (override.id) {
        keys.add(override.id);
        if (typeof materialId === 'string') keys.add(`${materialId}/${override.id}`);
      }
    }
  }
  return keys;
}

describe('Fenbridge shipping asset family', () => {
  it('keeps every native asset inside the fixed twelve-yard atlas projection span', () => {
    for (const [assetId, contract] of Object.entries(FENBRIDGE_TOWN_CONTRACTS)) {
      expect(contract.dimensions.width, `${assetId} width`).toBeLessThanOrEqual(
        FENBRIDGE_SURFACE_WORLD_SPAN,
      );
      expect(contract.dimensions.height, `${assetId} height`).toBeLessThanOrEqual(
        FENBRIDGE_SURFACE_WORLD_SPAN,
      );
      expect(contract.dimensions.depth, `${assetId} depth`).toBeLessThanOrEqual(
        FENBRIDGE_SURFACE_WORLD_SPAN,
      );
    }
  });

  it('binds the external support maps to evidence geometry without changing topology', () => {
    const root = new THREE.Group();
    const geometry = new THREE.BoxGeometry(2, 3, 4).toNonIndexed();
    const color = new THREE.Color(0x176269);
    const colors = new Float32Array(geometry.getAttribute('position').count * 3);
    for (let index = 0; index < geometry.getAttribute('position').count; index++) {
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true });
    material.name = 'FenbridgeOpaque';
    root.add(new THREE.Mesh(geometry, material));
    const textures = {
      base: new THREE.Texture(),
      normal: new THREE.Texture(),
      roughness: new THREE.Texture(),
    };

    const beforeTriangles = geometry.getAttribute('position').count / 3;
    expect(applyFenbridgeEvidenceSurface(root, textures)).toMatchObject({
      meshCount: 1,
      textureBindings: 1,
      pbrBindings: 1,
      uvBounds: {
        minimum: [expect.any(Number), expect.any(Number)],
        maximum: [expect.any(Number), expect.any(Number)],
        span: [expect.any(Number), expect.any(Number)],
      },
    });
    const mesh = root.children[0] as THREE.Mesh;
    const mapped = mesh.geometry;
    const mappedMaterial = mesh.material as THREE.MeshStandardMaterial;
    expect(mapped.getAttribute('position').count / 3).toBe(beforeTriangles);
    expect(mappedMaterial.map).toBe(textures.base);
    expect(mappedMaterial.normalMap).toBe(textures.normal);
    expect(mappedMaterial.roughnessMap).toBe(textures.roughness);
    expect(mappedMaterial.metalnessMap).toBe(textures.roughness);
    expect(mappedMaterial.roughness).toBe(1);
    expect(mappedMaterial.metalness).toBe(1);
    expect(mappedMaterial.vertexColors).toBe(false);
    const uv = mapped.getAttribute('uv');
    for (let index = 0; index < uv.count; index++) {
      expect(uv.getX(index)).toBeGreaterThan(0);
      expect(uv.getX(index)).toBeLessThan(0.25);
      expect(uv.getY(index)).toBeGreaterThan(0.5);
      expect(uv.getY(index)).toBeLessThan(0.75);
    }
  });

  it('closes z-axis pitched roofs with outward slope, gable, and underside faces', () => {
    const buckets = createFenbridgeBuckets();
    addPitchedRoof(buckets, 'roof', 6, 4, 2, 4, FENBRIDGE_PALETTE.roof, {
      ridgeAxis: 'z',
    });
    const positions = buckets.roof[0].getAttribute('position');
    expect(positions.count).toBe(24);

    const normals: number[][] = [];
    for (let offset = 0; offset < positions.count; offset += 3) {
      const a = [positions.getX(offset), positions.getY(offset), positions.getZ(offset)];
      const b = [
        positions.getX(offset + 1),
        positions.getY(offset + 1),
        positions.getZ(offset + 1),
      ];
      const c = [
        positions.getX(offset + 2),
        positions.getY(offset + 2),
        positions.getZ(offset + 2),
      ];
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cross = [
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      ];
      const length = Math.hypot(...cross);
      normals.push(cross.map((value) => value / length));
    }

    expect(normals.filter(([x, y, z]) => x < -0.2 && y > 0.2 && Math.abs(z) < 0.01)).toHaveLength(
      2,
    );
    expect(normals.filter(([x, y, z]) => x > 0.2 && y > 0.2 && Math.abs(z) < 0.01)).toHaveLength(2);
    expect(normals.filter(([, y, z]) => Math.abs(y) < 0.01 && z < -0.99)).toHaveLength(1);
    expect(normals.filter(([, y, z]) => Math.abs(y) < 0.01 && z > 0.99)).toHaveLength(1);
    expect(
      normals.filter(([x, y, z]) => Math.abs(x) < 0.01 && y < -0.99 && Math.abs(z) < 0.01),
    ).toHaveLength(2);
  });

  it('pins the 14 contracts, optimizer spec, repeated placement counts, and renderer ceiling', () => {
    expect(FENBRIDGE_TOWN_ASSET_IDS).toEqual([
      'warden_gatehouse',
      'crooked_reed_inn',
      'lantern_chapel',
      'moonwort_apothecary',
      'gilded_strongbox',
      'hesk_tannery',
      'scout_lodge',
      'mirelight_cistern',
      'provision_stall',
      'palisade_wing',
      'gate_arch',
      'boardwalk',
      'muster_board',
      'muster_order',
    ]);
    expect(FENBRIDGE_TOWN_WAVE_CEILINGS).toEqual({
      uniqueTriangles: 72_000,
      placementWeightedTriangles: 88_000,
      glbBytes: Math.floor(3.5 * 1024 * 1024),
      supportTextureBytes: 448 * 1024,
      totalMediaBytes: Math.floor(4.0 * 1024 * 1024),
    });
    const masterPlan = readFileSync(
      path.join(REPO_ROOT, 'docs/design/fenbridge-rebuild/master-plan.md'),
      'utf8',
    );
    expect(masterPlan).toContain('`72,000` triangles');
    expect(masterPlan).toContain('`88,000` triangles');
    expect(
      Object.fromEntries(
        FENBRIDGE_TOWN_ASSET_IDS.map((id) => [id, FENBRIDGE_TOWN_CONTRACTS[id].placementCount]),
      ),
    ).toEqual({
      warden_gatehouse: 1,
      crooked_reed_inn: 1,
      lantern_chapel: 1,
      moonwort_apothecary: 1,
      gilded_strongbox: 1,
      hesk_tannery: 1,
      scout_lodge: 1,
      mirelight_cistern: 1,
      provision_stall: 1,
      palisade_wing: 16,
      gate_arch: 4,
      boardwalk: 12,
      muster_board: 1,
      muster_order: 2,
    });
    for (const assetId of FENBRIDGE_TOWN_ASSET_IDS) {
      const contract = FENBRIDGE_TOWN_CONTRACTS[assetId];
      expect(contract.sockets, `${assetId} socket contract`).toHaveLength(2);
      expect(contract.placementCount).toBeLessThanOrEqual(contract.placementCeiling);
    }

    const optimizerSpec = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'scripts/assets/specs/fenbridge_town.json'), 'utf8'),
    );
    expect(optimizerSpec).toEqual({
      items: FENBRIDGE_TOWN_ASSET_IDS.map((assetId) => {
        const contract = FENBRIDGE_TOWN_CONTRACTS[assetId];
        return {
          src: `tmp/asset_src/fenbridge_town/${assetId}-final.glb`,
          out: `${contract.outputDirectory}/${contract.outputName}`,
          type: 'static',
          keepExtras: true,
        };
      }),
    });
    expect(FENBRIDGE_TOWN_CONTRACTS.muster_order.outputDirectory).toBe('models/quest');
    expect(
      FENBRIDGE_TOWN_ASSET_IDS.filter(
        (assetId) => FENBRIDGE_TOWN_CONTRACTS[assetId].outputDirectory === 'models/props',
      ),
    ).toHaveLength(13);
  });

  it('pins portable source intake, authoring records, package inputs, and fingerprints', () => {
    expect(new Set(FENBRIDGE_TOWN_SOURCE_FILES).size).toBe(FENBRIDGE_TOWN_SOURCE_FILES.length);
    expect(FENBRIDGE_TOWN_SOURCE_FILES).toContain('package.json');
    expect(FENBRIDGE_TOWN_SOURCE_FILES).toContain('pnpm-lock.yaml');
    expect(FENBRIDGE_TOWN_SOURCE_FILES).toContain(
      'scripts/assets/fenbridge_town/author_intake_records.mjs',
    );
    for (const sourceFile of FENBRIDGE_TOWN_SOURCE_FILES) {
      expect(path.isAbsolute(sourceFile), `${sourceFile} must be portable`).toBe(false);
      expect(existsSync(path.join(REPO_ROOT, sourceFile)), `${sourceFile} is missing`).toBe(true);
    }
    expect(fenbridgeTownSourceFingerprint(REPO_ROOT)).toBe(EXPECTED_SOURCE_FINGERPRINT);
    expect(fenbridgeTownSourceFingerprint(REPO_ROOT)).toBe(
      fenbridgeTownSourceFingerprint(REPO_ROOT),
    );

    const authorCheck = spawnSync(
      process.execPath,
      ['scripts/assets/fenbridge_town/author_intake_records.mjs', '--check'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    expect(authorCheck.status, authorCheck.stderr).toBe(0);

    for (const assetId of FENBRIDGE_TOWN_ASSET_IDS) {
      const slug = assetId.replaceAll('_', '-');
      const directory = path.join(INTAKE_ROOT, slug);
      const preSpecText = readFileSync(path.join(directory, 'pre-spec-assessment.json'), 'utf8');
      const detailText = readFileSync(path.join(directory, 'zones/detail-inventory.json'), 'utf8');
      const sculptText = readFileSync(path.join(directory, 'sculpt-spec.json'), 'utf8');
      expect(`${preSpecText}${detailText}${sculptText}`).not.toContain('/Users/');

      const sculpt = JSON.parse(sculptText) as Record<string, unknown>;
      const assessment = sculpt.preSpecAssessment as {
        objectClass: {
          primaryType: string;
          primaryDomain: string;
          formLanguage: string[];
          structureKind: string[];
          materialFamilies: string[];
        };
        detailInventory: {
          targetMinDetails: number;
          details: Array<{ id: string; mapsTo: { ref: string } }>;
        };
      };
      expect(assessment.objectClass.primaryType).not.toBe('unassessed');
      expect(assessment.objectClass.primaryDomain).toBe('object');
      expect(assessment.objectClass.formLanguage.length).toBeGreaterThan(0);
      expect(assessment.objectClass.structureKind.length).toBeGreaterThan(0);
      expect(assessment.objectClass.materialFamilies.length).toBeGreaterThan(0);
      expect(assessment.detailInventory.details.length).toBeGreaterThanOrEqual(
        assessment.detailInventory.targetMinDetails,
      );
      const linkKeys = linkedDetailKeys(sculpt);
      for (const detail of assessment.detailInventory.details) {
        expect(linkKeys.has(detail.mapsTo.ref), `${assetId}:${detail.id} is prose-only`).toBe(true);
      }
      expect((sculpt.componentTree as unknown[]).length).toBeGreaterThanOrEqual(5);
      expect((sculpt.materials as unknown[]).length).toBeGreaterThanOrEqual(2);
      expect((sculpt.featureReviewTargets as unknown[]).length).toBeGreaterThanOrEqual(3);
      expect(sculpt.lightingFromPhoto).toEqual(expect.arrayContaining([expect.any(String)]));
    }
  });

  it('rebuilds and pins the three shared 512px support maps under 448 KiB', async () => {
    expect(FENBRIDGE_SUPPORT_MAP_SIZE).toBe(512);
    expect(FENBRIDGE_SUPPORT_MAP_GRID).toBe(4);
    expect(fenbridgeSupportMapFingerprint(REPO_ROOT)).toBe(EXPECTED_SUPPORT_FINGERPRINT);
    const rebuilt = await buildFenbridgeSupportMaps();
    let totalBytes = 0;
    for (const [key, expected] of Object.entries(SUPPORT_MAPS)) {
      const shipped = readFileSync(path.join(REPO_ROOT, expected.file));
      const rebuiltBytes = rebuilt[key as keyof typeof rebuilt];
      expect(shipped.equals(rebuiltBytes), `${key} support map rebuild`).toBe(true);
      expect(shipped.length).toBe(expected.bytes);
      expect(sha256(shipped)).toBe(expected.sha256);
      const metadata = await sharp(shipped).metadata();
      expect([metadata.width, metadata.height, metadata.format]).toEqual([512, 512, 'webp']);
      totalBytes += shipped.length;
    }
    expect(totalBytes).toBe(195_080);
    expect(totalBytes).toBeLessThanOrEqual(FENBRIDGE_TOWN_WAVE_CEILINGS.supportTextureBytes);
  });

  it('encodes decisive albedo, normal, and roughness breakup in weathered material cells', async () => {
    const rebuilt = await buildFenbridgeSupportMaps();
    const decoded = await Promise.all(
      [rebuilt.base, rebuilt.normal, rebuilt.roughness].map((bytes) =>
        sharp(bytes).raw().toBuffer({ resolveWithObject: true }),
      ),
    );
    const cellChannelRange = (
      image: (typeof decoded)[number],
      cell: number,
      channel: number,
    ): number => {
      const cellSize = FENBRIDGE_SUPPORT_MAP_SIZE / FENBRIDGE_SUPPORT_MAP_GRID;
      const left = (cell % FENBRIDGE_SUPPORT_MAP_GRID) * cellSize + 4;
      const top = Math.floor(cell / FENBRIDGE_SUPPORT_MAP_GRID) * cellSize + 4;
      let minimum = 255;
      let maximum = 0;
      for (let y = top; y < top + cellSize - 8; y++) {
        for (let x = left; x < left + cellSize - 8; x++) {
          const value = image.data[(y * image.info.width + x) * image.info.channels + channel];
          minimum = Math.min(minimum, value);
          maximum = Math.max(maximum, value);
        }
      }
      return maximum - minimum;
    };
    const cellMaximumChroma = (image: (typeof decoded)[number], cell: number): number => {
      const cellSize = FENBRIDGE_SUPPORT_MAP_SIZE / FENBRIDGE_SUPPORT_MAP_GRID;
      const left = (cell % FENBRIDGE_SUPPORT_MAP_GRID) * cellSize + 4;
      const top = Math.floor(cell / FENBRIDGE_SUPPORT_MAP_GRID) * cellSize + 4;
      let maximum = 0;
      for (let y = top; y < top + cellSize - 8; y++) {
        for (let x = left; x < left + cellSize - 8; x++) {
          const offset = (y * image.info.width + x) * image.info.channels;
          const red = image.data[offset];
          const green = image.data[offset + 1];
          const blue = image.data[offset + 2];
          maximum = Math.max(maximum, red - green, green - red, red - blue, blue - red);
        }
      }
      return maximum;
    };
    const cellChannelMean = (
      image: (typeof decoded)[number],
      cell: number,
      channel: number,
    ): number => {
      const cellSize = FENBRIDGE_SUPPORT_MAP_SIZE / FENBRIDGE_SUPPORT_MAP_GRID;
      const left = (cell % FENBRIDGE_SUPPORT_MAP_GRID) * cellSize + 4;
      const top = Math.floor(cell / FENBRIDGE_SUPPORT_MAP_GRID) * cellSize + 4;
      let total = 0;
      let count = 0;
      for (let y = top; y < top + cellSize - 8; y++) {
        for (let x = left; x < left + cellSize - 8; x++) {
          total += image.data[(y * image.info.width + x) * image.info.channels + channel];
          count++;
        }
      }
      return total / count;
    };

    // 0 moss stone, 2/3/14 timber, 4 shingles, 5/6 metals, 11 packed mud.
    for (const cell of [0, 2, 3, 4, 5, 6, 11, 14]) {
      expect(cellChannelRange(decoded[0], cell, 0), `base cell ${cell}`).toBeGreaterThanOrEqual(20);
      expect(cellChannelRange(decoded[1], cell, 0), `normal cell ${cell}`).toBeGreaterThanOrEqual(
        30,
      );
      expect(
        cellChannelRange(decoded[2], cell, 0),
        `roughness cell ${cell}`,
      ).toBeGreaterThanOrEqual(18);
    }
    // Base-map channel separation carries organic moss/lichen and oxidation
    // tints that scalar vertex colors cannot express on their own.
    for (const cell of [0, 4, 5, 6]) {
      expect(
        cellMaximumChroma(decoded[0], cell),
        `base chroma cell ${cell}`,
      ).toBeGreaterThanOrEqual(20);
    }
    // The roughness file doubles as a packed material response map: green is
    // roughness and blue is metalness, keeping this a three-resource family.
    expect(cellChannelMean(decoded[2], 6, 2)).toBeGreaterThanOrEqual(128);
    expect(cellChannelMean(decoded[2], 3, 2)).toBeLessThanOrEqual(8);
  });

  it('pins exact optimized GLB bytes, topology, metadata, sockets, and runtime budgets', {
    timeout: 45_000,
  }, async () => {
    expect(Object.keys(EXPECTED_ARTIFACTS)).toEqual([...FENBRIDGE_TOWN_ASSET_IDS]);
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    let totalBytes = 0;
    let uniqueTriangles = 0;
    let placementWeightedTriangles = 0;

    for (const assetId of FENBRIDGE_TOWN_ASSET_IDS) {
      const contract = FENBRIDGE_TOWN_CONTRACTS[assetId];
      const expected = EXPECTED_ARTIFACTS[assetId];
      const filePath = outputPath(assetId);
      expect(existsSync(filePath), `${assetId} is missing`).toBe(true);
      const bytes = readFileSync(filePath);
      expect(bytes.toString('utf8', 0, 4)).toBe('glTF');
      expect(bytes.readUInt32LE(4)).toBe(2);
      expect(bytes.length).toBe(expected.bytes);
      expect(sha256(bytes)).toBe(expected.sha256);
      expect(bytes.length).toBeLessThanOrEqual(contract.byteCeiling);

      const document = await io.readBinary(bytes);
      const root = document.getRoot();
      const scene = root.listScenes()[0];
      const usedExtensions = root
        .listExtensionsUsed()
        .map((extension) => extension.extensionName)
        .sort();
      expect(usedExtensions).toEqual(
        expect.arrayContaining(['EXT_meshopt_compression', 'KHR_mesh_quantization']),
      );
      expect(usedExtensions).not.toContain('KHR_draco_mesh_compression');
      expect(usedExtensions).not.toContain('KHR_lights_punctual');
      expect(
        root
          .listExtensionsRequired()
          .map((extension) => extension.extensionName)
          .sort(),
      ).toEqual(['EXT_meshopt_compression', 'KHR_mesh_quantization']);
      expect(root.listScenes()).toHaveLength(1);
      expect(scene.listChildren().map((node) => node.getName())).toEqual([contract.rootName]);
      expect(root.listTextures()).toHaveLength(0);
      expect(root.listAnimations()).toHaveLength(0);
      expect(root.listSkins()).toHaveLength(0);
      expect(root.listCameras()).toHaveLength(0);
      expect(root.listMeshes().length).toBeGreaterThanOrEqual(1);
      expect(root.listMeshes().length).toBeLessThanOrEqual(2);
      expect(root.listMaterials()).toHaveLength(root.listMeshes().length);

      const primitiveTriangles = root.listMeshes().map((mesh) => {
        expect(mesh.listPrimitives()).toHaveLength(1);
        const primitive = mesh.listPrimitives()[0];
        expect(primitive.getMode()).toBe(Primitive.Mode.TRIANGLES);
        expect(primitive.listSemantics().sort()).toEqual(['COLOR_0', 'NORMAL', 'POSITION']);
        const position = primitive.getAttribute('POSITION');
        const normal = primitive.getAttribute('NORMAL');
        const color = primitive.getAttribute('COLOR_0');
        if (!position || !normal || !color) throw new Error(`${assetId} lost vertex data`);
        expect(normal.getCount()).toBe(position.getCount());
        expect(color.getCount()).toBe(position.getCount());
        expect(color.getType()).toBe('VEC3');
        for (const accessor of [position, normal, color, primitive.getIndices()]) {
          if (!accessor) continue;
          const array = accessor.getArray();
          expect(array).not.toBeNull();
          for (const value of array ?? []) expect(Number.isFinite(value)).toBe(true);
        }
        return (primitive.getIndices()?.getCount() ?? position.getCount()) / 3;
      });
      expect(primitiveTriangles).toEqual(expected.primitiveTriangles);
      const triangles = primitiveTriangles.reduce((sum, count) => sum + count, 0);
      expect(triangles).toBe(expected.triangles);
      expect(triangles).toBeLessThanOrEqual(contract.triangleCeiling);
      expect(root.listMaterials().map((material) => material.getName())).toEqual(
        expected.primitiveTriangles.length === 2
          ? ['FenbridgeOpaque', 'FenbridgeEmissive']
          : ['FenbridgeOpaque'],
      );

      const bounds = getBounds(scene);
      expectApproxArray(bounds.min, [
        -contract.dimensions.width / 2,
        0,
        -contract.dimensions.depth / 2,
      ]);
      expectApproxArray(bounds.max, [
        contract.dimensions.width / 2,
        contract.dimensions.height,
        contract.dimensions.depth / 2,
      ]);
      const modelRoot = scene.listChildren()[0];
      expectApproxArray(modelRoot.getTranslation(), [0, 0, 0]);
      expectApproxArray(modelRoot.getRotation(), [0, 0, 0, 1]);
      expectApproxArray(modelRoot.getScale(), [1, 1, 1]);
      const runtime = (
        modelRoot.getExtras() as {
          sculptRuntime: {
            schemaVersion: number;
            assetId: string;
            coordinateFrame: Record<string, string>;
            nativeBounds: Record<string, number>;
            serviceCues: string[];
            supportTextures: Record<string, string>;
            interaction: { interactive: boolean };
            collider: { shippingCollisionMesh: boolean };
            destruction: { breakable: boolean; detachableParts: unknown[] };
            sockets: Record<string, { nodeName: string; position: number[] }>;
          };
        }
      ).sculptRuntime;
      expect(runtime).toMatchObject({
        schemaVersion: 1,
        assetId: contract.id,
        coordinateFrame: { front: '+Z', up: '+Y', right: '+X', units: 'world-yards' },
        nativeBounds: contract.dimensions,
        serviceCues: contract.serviceCues,
        supportTextures: {
          base: '/textures/fenbridge_surface_atlas.webp',
          normal: '/textures/fenbridge_surface_normal.webp',
          roughness: '/textures/fenbridge_surface_roughness.webp',
        },
        interaction: { interactive: false },
        collider: { shippingCollisionMesh: false },
        destruction: { breakable: false, detachableParts: [] },
      });
      for (const socket of contract.sockets) {
        const node = root.listNodes().find((candidate) => candidate.getName() === socket.name);
        expect(node, `${assetId}:${socket.name}`).toBeDefined();
        if (!node) continue;
        expect(node.getMesh()).toBeNull();
        expect(node.listChildren()).toHaveLength(0);
        expectApproxArray(node.getTranslation(), socket.position, 0.000_01);
        expect(node.getExtras()).toEqual({
          sculptSocket: { id: socket.id, purpose: socket.purpose, interactive: false },
        });
        expectApproxArray(runtime.sockets[socket.id].position, socket.position, 0.000_01);
      }
      expect(Object.keys(runtime.sockets).sort()).toEqual(
        contract.sockets.map((socket) => socket.id).sort(),
      );
      expect(root.getExtras()).toEqual({ sourceFingerprint: EXPECTED_SOURCE_FINGERPRINT });
      expect(root.getAsset().extras).toEqual({ sourceFingerprint: EXPECTED_SOURCE_FINGERPRINT });

      totalBytes += bytes.length;
      uniqueTriangles += triangles;
      placementWeightedTriangles += triangles * contract.placementCount;
    }

    expect({ totalBytes, uniqueTriangles, placementWeightedTriangles }).toEqual({
      totalBytes: EXPECTED_TOTALS.bytes,
      uniqueTriangles: EXPECTED_TOTALS.uniqueTriangles,
      placementWeightedTriangles: EXPECTED_TOTALS.placementWeightedTriangles,
    });
    expect(totalBytes).toBeLessThanOrEqual(FENBRIDGE_TOWN_WAVE_CEILINGS.glbBytes);
    expect(uniqueTriangles).toBeLessThanOrEqual(FENBRIDGE_TOWN_WAVE_CEILINGS.uniqueTriangles);
    expect(placementWeightedTriangles).toBeLessThanOrEqual(
      FENBRIDGE_TOWN_WAVE_CEILINGS.placementWeightedTriangles,
    );
    expect(placementWeightedTriangles + FOUNDATION_TRIANGLES).toBeLessThanOrEqual(
      RENDERER_HARD_CEILING,
    );
    const supportBytes = Object.values(SUPPORT_MAPS).reduce(
      (sum, supportMap) => sum + supportMap.bytes,
      0,
    );
    expect(totalBytes + supportBytes).toBeLessThanOrEqual(
      FENBRIDGE_TOWN_WAVE_CEILINGS.totalMediaBytes,
    );
  });

  it('matches every building front socket and the split bank entrance/teller contract exactly', () => {
    for (const building of FENBRIDGE_LAYOUT.buildings) {
      const contract = Object.values(FENBRIDGE_TOWN_CONTRACTS).find(
        (candidate) => candidate.id === building.id,
      );
      expect(contract, building.id).toBeDefined();
      const entrance = contract?.sockets.find((socket) => socket.id === 'front-entry');
      expect(entrance, `${building.id}:front-entry`).toBeDefined();
      expect(building.nativeDimensions).toEqual(contract?.dimensions);
      expect(building.sockets.entrance.localPosition).toEqual({
        x: entrance?.position[0],
        z: entrance?.position[2],
      });
    }

    const bankBuilding = FENBRIDGE_LAYOUT.buildings.find(
      (building) => building.id === 'fenbridge_gilded_strongbox',
    );
    if (!bankBuilding) throw new Error('Fenbridge bank building is missing');
    expect(FENBRIDGE_LAYOUT.services.bank.entrance.localPosition).toEqual({ x: 1.75, z: 3.25 });
    expect(FENBRIDGE_LAYOUT.services.bank.teller.localPosition).toEqual({ x: -1.25, z: 3.25 });
    expect(FENBRIDGE_LAYOUT.services.bank.entrance.position).not.toEqual(
      FENBRIDGE_LAYOUT.services.bank.teller.position,
    );
    expect(FENBRIDGE_LAYOUT.services.bank.teller.standingPoint).toEqual(
      localToWorld(bankBuilding.position, bankBuilding.rotation, -1.25, 4.75),
    );
    const bankContract = FENBRIDGE_TOWN_CONTRACTS.gilded_strongbox;
    expect(bankContract.sockets.find((socket) => socket.id === 'front-entry')?.position).toEqual([
      1.75, 0, 3.25,
    ]);
    expect(bankContract.sockets.find((socket) => socket.id === 'teller-window')?.position).toEqual([
      -1.25, 1.45, 3.25,
    ]);
  });

  it('requires complete render evidence and agent-reviewed >= 0.70 visual acceptance', async () => {
    for (const assetId of FENBRIDGE_TOWN_ASSET_IDS) {
      for (const suffix of REQUIRED_EVIDENCE_SUFFIXES) {
        const evidencePath = path.join(EVIDENCE_ROOT, `${assetId}-${suffix}`);
        expect(existsSync(evidencePath), `${assetId}-${suffix}`).toBe(true);
        expect(statSync(evidencePath).size).toBeGreaterThan(1024);
        const metadata = await sharp(evidencePath).metadata();
        expect(metadata.width).toBeGreaterThanOrEqual(1_400);
        expect(metadata.height).toBeGreaterThanOrEqual(600);
      }
      const reviewPath = path.join(EVIDENCE_ROOT, `${assetId}-ai-review.json`);
      const review = JSON.parse(readFileSync(reviewPath, 'utf8')) as {
        sourceFingerprint: string;
        minimumOverallScore: number;
        requiredViews: string[];
        features: Array<{
          id: string;
          minimumScore: number;
          mustPass: boolean;
          visible: boolean;
          score: number;
          notes: string;
        }>;
        overall: { score: number; decision: string; reviewer: string; notes: string };
      };
      expect(review.sourceFingerprint).toBe(EXPECTED_SOURCE_FINGERPRINT);
      expect(review.minimumOverallScore).toBe(0.7);
      expect(review.requiredViews).toEqual([
        'front',
        'right',
        'rear',
        'left',
        'hero',
        'player-scale',
        'collider-overlay',
      ]);
      expect(review.overall.decision).toBe('accept');
      expect(review.overall.reviewer).toBe('codex-agent-vision');
      expect(review.overall.score).toBeGreaterThanOrEqual(review.minimumOverallScore);
      expect(review.features.length).toBeGreaterThanOrEqual(3);
      for (const feature of review.features) {
        expect(feature.minimumScore).toBeGreaterThanOrEqual(0.7);
        expect(feature.visible, `${assetId}:${feature.id}`).toBe(true);
        expect(feature.score, `${assetId}:${feature.id}`).toBeGreaterThanOrEqual(
          feature.minimumScore,
        );
        expect(feature.notes.length).toBeGreaterThan(0);
      }
      expect(review.overall.notes.length).toBeGreaterThan(0);
    }
  });

  it('keeps the deterministic double-build, staged verification, KTX2, and evidence gates', () => {
    const exporter = readFileSync(
      path.join(REPO_ROOT, 'scripts/assets/fenbridge_town/export_fenbridge_town.mjs'),
      'utf8',
    );
    expect(exporter).toContain("process.argv.includes('--verify-staged')");
    expect(exporter).toContain('deterministic raw rebuild:');
    expect(exporter).toContain('deterministic optimized rebuild:');
    expect(exporter).toContain('Fenbridge KTX2 final pass');
    expect(exporter).toContain("'player-scale'");
    expect(exporter).toContain("'collider-overlay'");
    expect(exporter).toContain('AI-review scaffold:');
    expect(exporter).toContain('weightedOptimizedTriangles');
  });
});
