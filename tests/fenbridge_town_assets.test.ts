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
import {
  distancePointToObb,
  FENBRIDGE_BUILDINGS_BY_ID,
  FENBRIDGE_LAYOUT,
  localToWorld,
} from '../src/sim/fenbridge_layout';

const REPO_ROOT = path.join(__dirname, '..');
const EVIDENCE_ROOT = path.join(REPO_ROOT, 'docs/screenshots/fenbridge-rebuild/assets');
const INTAKE_ROOT = path.join(REPO_ROOT, 'docs/design/fenbridge-rebuild/img2threejs');
// package.json is a fingerprint input, so the v0.45.4 version bump requires
// size-preserving reminting. Only sourceFingerprint metadata and sha256 pins
// changed; geometry and texture payloads remain byte-identical.
const EXPECTED_SOURCE_FINGERPRINT =
  '1424f6161de44490cd308deaaaeb7d6fd2c5d81befa90d73babd393ad96ae2fe';
const EXPECTED_SUPPORT_FINGERPRINT =
  'ce9c07dde16bbddf7d44b29bcddd2ac4efc5e0d993c7ea93d42a85037314d38b';

interface ExpectedArtifact {
  bytes: number;
  sha256: string;
  triangles: number;
  primitiveTriangles: readonly number[];
}

const EXPECTED_ARTIFACTS: Readonly<Record<string, ExpectedArtifact>> = {
  warden_gatehouse: {
    bytes: 141_848,
    sha256: 'e83d45d068515abd9d31f05edbb84cc8e7134f5749ccb0352a5887c682488972',
    triangles: 8_766,
    primitiveTriangles: [8_695, 71],
  },
  crooked_reed_inn: {
    bytes: 149_080,
    sha256: '7a6182c3fba847d520aabc0d4f9f88d9293aaf6a3fb0041b87ed2bcd63ae7c8a',
    triangles: 8_949,
    primitiveTriangles: [8_807, 142],
  },
  lantern_chapel: {
    bytes: 107_392,
    sha256: '1784169134315c46cf88496bd5984f828602b54f22c259a7ccdbe89fc7bba952',
    triangles: 6_671,
    primitiveTriangles: [6_486, 185],
  },
  moonwort_apothecary: {
    bytes: 104_468,
    sha256: 'bae5da35e57e33851e71c84c418eec31e647fcd2eb29f38ab4c88324173b2eb6',
    triangles: 6_086,
    primitiveTriangles: [6_017, 69],
  },
  gilded_strongbox: {
    bytes: 69_908,
    sha256: 'c0299cec60898157ec174232a71303e0355d6e8f2b5c6179ea7cf9960502c077',
    triangles: 4_133,
    primitiveTriangles: [4_033, 100],
  },
  hesk_tannery: {
    bytes: 198_908,
    sha256: 'db15103bccdf3a04e966365990450a18699a4fa7169203d6a274dc41d5ebf043',
    triangles: 12_740,
    primitiveTriangles: [12_581, 159],
  },
  scout_lodge: {
    bytes: 110_556,
    sha256: 'ebaa1927e1ac95f9d8b1745f06375ab29a27ee414e72c2b2ebe1fac4cb30d448',
    triangles: 6_507,
    primitiveTriangles: [6_431, 76],
  },
  mirelight_cistern: {
    bytes: 48_940,
    sha256: 'ab938d6ab58e81594fec315f84e3f764783f3a023eb76e881dfc63e93888f30b',
    triangles: 2_388,
    primitiveTriangles: [2_328, 60],
  },
  provision_stall: {
    bytes: 26_332,
    sha256: '1413698c9d49ef1bc9a0c69ce5b55574c8ec2d3981d7de2c57931c91b6cc5d39',
    triangles: 1_304,
    primitiveTriangles: [1_280, 24],
  },
  palisade_wing: {
    bytes: 15_680,
    sha256: 'e8a657bc4ad5f0356472787e21d3c35d3d662f5dab7b873288769cc16d3e8293',
    triangles: 766,
    primitiveTriangles: [766],
  },
  gate_arch: {
    bytes: 24_276,
    sha256: 'e783cbeb800dfac13fab31e4fb56f89592aea9b6291084fb88b0abdcf72ae7c3',
    triangles: 1_216,
    primitiveTriangles: [1_192, 24],
  },
  boardwalk: {
    bytes: 9_264,
    sha256: '2754de243be0515af81e9391a77f1fed5981c83adc8ae2199a14f45f7a90ebe8',
    triangles: 376,
    primitiveTriangles: [376],
  },
  muster_board: {
    bytes: 17_480,
    sha256: '19dbb4fa9fec2409c9877364094a88bbbe45a1b47e55fa4ac41b62c72366f392',
    triangles: 760,
    primitiveTriangles: [736, 24],
  },
  muster_order: {
    bytes: 6_888,
    sha256: '866c19e58faf0246b558ea34c3333ae8a5d987a4989b7e0c8f829504d42f1081',
    triangles: 204,
    primitiveTriangles: [204],
  },
};
const EXPECTED_TOTALS = {
  bytes: 1_031_020,
  uniqueTriangles: 60_866,
  // The wave this family was exported for (model.js placementCount): one of
  // each building and the boardwalk placementCount 12 (was 10: +2 * 376 tris).
  placementWeightedTriangles: 80_344,
  // Added for the painted town: what the built-in town still places of this
  // family (FENBRIDGE_LAYOUT). The painted Tidehold models replaced all seven
  // buildings (-53_852) and the boardwalks went 12 to 10 (-752), so the town
  // kept 25_740 of the wave. Re-pinned for the open town: the 16 palisade
  // wings (-12_256) and the 4 gate arches (-4_864) came down, so it keeps
  // 8_620: the cistern, stall, muster board, 10 boardwalks and the 2 muster
  // orders. Sibling pin: the legacy-family share of the whole-town budget in
  // tests/fenbridge_town_renderer.test.ts; move both together.
  townPlacementTriangles: 8_620,
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

/** The URL the layout names a family asset by. */
function familyAssetUrl(assetId: string): string {
  const contract = FENBRIDGE_TOWN_CONTRACTS[assetId];
  return `/${contract.outputDirectory}/${contract.outputName}`;
}

/** How many times the built-in town places each asset URL (FENBRIDGE_LAYOUT). */
function townPlacementsByUrl(): Map<string, number> {
  const placements = new Map<string, number>();
  const place = (url: string): void => {
    placements.set(url, (placements.get(url) ?? 0) + 1);
  };
  for (const building of FENBRIDGE_LAYOUT.buildings) place(building.assetId);
  place(FENBRIDGE_LAYOUT.civic.cistern.assetId);
  place(FENBRIDGE_LAYOUT.civic.provisionStall.assetId);
  place(FENBRIDGE_LAYOUT.civic.musterBoard.assetId);
  // Empty since the town opened (no wall wing, and the entrances carry no
  // arch), but still counted, so a wing laid back on the ring shows up here.
  for (const segment of FENBRIDGE_LAYOUT.wall.segments) place(segment.assetId);
  for (const boardwalk of FENBRIDGE_LAYOUT.repeated.boardwalks) place(boardwalk.assetId);
  for (const order of FENBRIDGE_LAYOUT.repeated.musterOrders) place(order.assetId);
  return placements;
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
    // Added for the painted town: what the built-in town really places of this
    // family (FENBRIDGE_LAYOUT), beside the wave it was exported for above.
    // The painted Tidehold models replaced every building and the boardwalks
    // went to 10, and the town never places more of an asset than that wave
    // budgeted (the triangle sibling is EXPECTED_TOTALS.townPlacementTriangles).
    // Re-pinned for the open town: the palisade wings and the gate arches came
    // down, so the town places none of either.
    const townPlacements = townPlacementsByUrl();
    expect(
      Object.fromEntries(
        FENBRIDGE_TOWN_ASSET_IDS.map((id) => [id, townPlacements.get(familyAssetUrl(id)) ?? 0]),
      ),
    ).toEqual({
      warden_gatehouse: 0,
      crooked_reed_inn: 0,
      lantern_chapel: 0,
      moonwort_apothecary: 0,
      gilded_strongbox: 0,
      hesk_tannery: 0,
      scout_lodge: 0,
      mirelight_cistern: 1,
      provision_stall: 1,
      palisade_wing: 0,
      gate_arch: 0,
      boardwalk: 10,
      muster_board: 1,
      muster_order: 2,
    });
    for (const assetId of FENBRIDGE_TOWN_ASSET_IDS) {
      expect(townPlacements.get(familyAssetUrl(assetId)) ?? 0, assetId).toBeLessThanOrEqual(
        FENBRIDGE_TOWN_CONTRACTS[assetId].placementCount,
      );
    }
    // Both ring models stay shipped (Studio still lists them); the town just
    // stands none of them.
    for (const assetId of ['palisade_wing', 'gate_arch'] as const) {
      expect(existsSync(outputPath(assetId)), `${assetId} still shipped`).toBe(true);
      expect(townPlacements.has(familyAssetUrl(assetId)), `${assetId} in town`).toBe(false);
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
    let townPlacementTriangles = 0;
    const townPlacements = townPlacementsByUrl();

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
      townPlacementTriangles += triangles * (townPlacements.get(familyAssetUrl(assetId)) ?? 0);
    }

    expect({
      totalBytes,
      uniqueTriangles,
      placementWeightedTriangles,
      townPlacementTriangles,
    }).toEqual({
      totalBytes: EXPECTED_TOTALS.bytes,
      uniqueTriangles: EXPECTED_TOTALS.uniqueTriangles,
      placementWeightedTriangles: EXPECTED_TOTALS.placementWeightedTriangles,
      townPlacementTriangles: EXPECTED_TOTALS.townPlacementTriangles,
    });
    expect(totalBytes).toBeLessThanOrEqual(FENBRIDGE_TOWN_WAVE_CEILINGS.glbBytes);
    expect(uniqueTriangles).toBeLessThanOrEqual(FENBRIDGE_TOWN_WAVE_CEILINGS.uniqueTriangles);
    expect(placementWeightedTriangles).toBeLessThanOrEqual(
      FENBRIDGE_TOWN_WAVE_CEILINGS.placementWeightedTriangles,
    );
    // Re-staged for the painted town: this check added the renderer's
    // 84-triangle skirt reserve to the wave and held it under the renderer's
    // 88_000 hard ceiling. The town stands none of this family's buildings
    // now and reserves no skirt (the painted models bury their own footing),
    // so the town's share of the family sits inside the exported wave, and
    // the whole town (that share plus the painted buildings) is held under the
    // hard ceiling by tests/fenbridge_town_renderer.test.ts.
    expect(townPlacementTriangles).toBeLessThanOrEqual(placementWeightedTriangles);
    const supportBytes = Object.values(SUPPORT_MAPS).reduce(
      (sum, supportMap) => sum + supportMap.bytes,
      0,
    );
    expect(totalBytes + supportBytes).toBeLessThanOrEqual(
      FENBRIDGE_TOWN_WAVE_CEILINGS.totalMediaBytes,
    );
  });

  it('keeps every shipped legacy building GLB on its own front-entry contract, none of them in town', () => {
    // Re-staged for the painted town: this test matched each layout building to
    // its GLB contract here (size, front socket, the strongbox's split
    // entrance and teller window). The town's five buildings are painted
    // Tidehold models now (makePlacedBuilding in src/sim/fenbridge_layout.ts),
    // measured off their own files in tests/fenbridge_placed_buildings.test.ts,
    // so the layout reads none of these contracts. The seven building GLBs stay
    // shipped (Studio still lists them), so their own contract is pinned here
    // on its own: one front entrance on the ground, on the +Z front face,
    // inside the front's width.
    const buildingIds = FENBRIDGE_TOWN_ASSET_IDS.filter((assetId) =>
      FENBRIDGE_TOWN_CONTRACTS[assetId].sockets.some((socket) => socket.id === 'front-entry'),
    );
    expect(buildingIds).toEqual([
      'warden_gatehouse',
      'crooked_reed_inn',
      'lantern_chapel',
      'moonwort_apothecary',
      'gilded_strongbox',
      'hesk_tannery',
      'scout_lodge',
    ]);
    const townPlacements = townPlacementsByUrl();
    for (const assetId of buildingIds) {
      const contract = FENBRIDGE_TOWN_CONTRACTS[assetId];
      const entrance = contract.sockets.find((socket) => socket.id === 'front-entry');
      if (!entrance) throw new Error(`${assetId} lost its front entrance`);
      const [x, y, z] = entrance.position;
      expect(y, `${assetId} entrance on the ground`).toBe(0);
      expect(z, `${assetId} entrance on the front face`).toBe(contract.dimensions.depth / 2);
      expect(Math.abs(x), `${assetId} entrance inside the front`).toBeLessThan(
        contract.dimensions.width / 2,
      );
      expect(existsSync(outputPath(assetId)), `${assetId} still shipped`).toBe(true);
      expect(townPlacements.get(familyAssetUrl(assetId)), `${assetId} in town`).toBeUndefined();
    }
    // The strongbox GLB keeps its SPLIT contract: the teller window at counter
    // height three yards along the same front from the door.
    const strongbox = FENBRIDGE_TOWN_CONTRACTS.gilded_strongbox;
    expect(strongbox.sockets.find((socket) => socket.id === 'front-entry')?.position).toEqual([
      1.75, 0, 3.25,
    ]);
    expect(strongbox.sockets.find((socket) => socket.id === 'teller-window')?.position).toEqual([
      -1.25, 1.45, 3.25,
    ]);
    // Every building the town stands is a painted Tidehold model instead.
    for (const building of FENBRIDGE_LAYOUT.buildings) {
      expect(building.assetId, building.id).toMatch(/\/tidehold\/(?:fenrire\/)?[a-z_]+\.glb$/);
    }
  });

  it('stands the bank entrance and teller on one doorstep socket at the painted bank door', () => {
    // Re-staged for the painted town: the strongbox GLB split its entrance and
    // its teller window three yards apart along its front. The painted bank
    // has one door and Petra keeps it, so the teller IS the entrance socket
    // under its own id: the door on the model's front (-Z) wall face, in the
    // MODEL's own axes at the bank's placed size, and the stand straight out
    // of it, 1.8 yd at authored size, grown with the building.
    const { bank } = FENBRIDGE_LAYOUT.services;
    const bankBuilding = FENBRIDGE_BUILDINGS_BY_ID[bank.buildingId];
    expect(bankBuilding.id).toBe('fenbridge_gilded_strongbox');
    expect(bankBuilding.assetId).toMatch(/\/tidehold\/(?:fenrire\/)?shop_a\.glb$/);
    expect(bank.entrance).toBe(bankBuilding.sockets.entrance);
    // the authored door (-1.6, -4.2) at the grand bank's 1.5
    const scale = bankBuilding.placement.scale;
    expect(scale).toBe(1.5);
    expect(bank.entrance.localPosition.x).toBeCloseTo(-1.6 * scale, 9);
    expect(bank.entrance.localPosition.z).toBeCloseTo(-4.2 * scale, 9);
    expect(bank.teller).toEqual({ ...bank.entrance, id: 'fenbridge_gilded_strongbox_teller' });
    expect(bank.teller.id).not.toBe(bank.entrance.id);

    const { x, z } = bank.entrance.localPosition;
    const door = localToWorld(bankBuilding.placement, bankBuilding.rotation, x, z);
    expect(bank.entrance.position.x).toBeCloseTo(door.x, 9);
    expect(bank.entrance.position.z).toBeCloseTo(door.z, 9);
    // The door is on the wall line: the wall box reads it at 0, and the stand
    // straight out of it reads the full step, which a door set back inside the
    // walls could not.
    const step = 1.8 * scale;
    expect(distancePointToObb(bank.entrance.position, bankBuilding.footprint)).toBeCloseTo(0, 9);
    const stand = localToWorld(bankBuilding.placement, bankBuilding.rotation, x, z - step);
    expect(bank.teller.standingPoint.x).toBeCloseTo(stand.x, 9);
    expect(bank.teller.standingPoint.z).toBeCloseTo(stand.z, 9);
    expect(
      Math.hypot(
        bank.teller.standingPoint.x - bank.entrance.position.x,
        bank.teller.standingPoint.z - bank.entrance.position.z,
      ),
    ).toBeCloseTo(step, 9);
    expect(distancePointToObb(bank.teller.standingPoint, bankBuilding.footprint)).toBeCloseTo(
      step,
      9,
    );
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
