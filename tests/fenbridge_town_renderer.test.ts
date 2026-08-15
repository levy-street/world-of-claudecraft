import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FENBRIDGE_EXPORTER_PALETTE_SEMANTICS,
  FENBRIDGE_SURFACE_ANISOTROPY,
  FENBRIDGE_SURFACE_ATLAS_SIZE,
  FENBRIDGE_SURFACE_CELLS,
  FENBRIDGE_SURFACE_RESPONSE_CHANNELS,
  FENBRIDGE_SURFACE_WORLD_SPAN,
  fenbridgeSemanticForColor,
  fenbridgeSurfaceGeometry,
} from '../src/render/fenbridge_surface_atlas';
import {
  FENBRIDGE_CAPTURE_OVERLAY_NAME,
  FENBRIDGE_TOWN_ASSET_PLACEMENT_COUNTS,
  FENBRIDGE_TOWN_ASSET_URLS,
  FENBRIDGE_TOWN_PROP_ASSET_URLS,
  FENBRIDGE_TOWN_REQUIRED_PLACEMENT_IDS,
  FENBRIDGE_TOWN_ROOT_NAME,
  fenbridgeTownDrawStats,
  fenbridgeTownInternalsForTest,
  fenbridgeTownTriangleBudget,
  isFenbridgeRebuildBuilding,
  isFenbridgeRebuildStall,
  isFenbridgeRebuildWell,
} from '../src/render/fenbridge_town';
import {
  type FenbridgeBuildingVisibilityTarget,
  fenbridgeBuildingVisibilityPlanInto,
  fenbridgeCameraSegmentHitsBuilding,
  fenbridgeFogVisible,
  newFenbridgeBuildingVisibilityPlan,
} from '../src/render/fenbridge_town_visibility_core';
import { GFX, gfxInternalsForTest } from '../src/render/gfx';
import { questObjectPreloadInternalsForTest } from '../src/render/quest_objects';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { FENBRIDGE_LAYOUT, localToWorld } from '../src/sim/fenbridge_layout';
import { terrainHeight } from '../src/sim/world';

const ORIGINAL_GFX = {
  standardMaterials: GFX.standardMaterials,
  dynamicShadows: GFX.dynamicShadows,
  surfaceDetail: GFX.surfaceDetail,
  composer: GFX.composer,
};

// GFX is a frozen profile after the v0.34 settings rework; mutate via the
// test override seam instead of Object.assign.
function setGfx(overrides: Partial<typeof ORIGINAL_GFX>): void {
  gfxInternalsForTest.overrideSettings(overrides);
}

function sourceAsset(withEmissive = true): THREE.Group {
  const source = new THREE.Group();
  const opaqueColor = new THREE.Color(0x4e5650);
  const opaqueGeometry = new THREE.BoxGeometry(2, 3, 4).toNonIndexed();
  const opaqueColors = new Float32Array(opaqueGeometry.getAttribute('position').count * 3);
  for (let index = 0; index < opaqueGeometry.getAttribute('position').count; index++) {
    opaqueColors[index * 3] = opaqueColor.r;
    opaqueColors[index * 3 + 1] = opaqueColor.g;
    opaqueColors[index * 3 + 2] = opaqueColor.b;
  }
  opaqueGeometry.setAttribute('color', new THREE.BufferAttribute(opaqueColors, 3));
  const opaqueMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true });
  opaqueMaterial.name = 'FenbridgeOpaque';
  source.add(new THREE.Mesh(opaqueGeometry, opaqueMaterial));
  if (withEmissive) {
    const emissiveGeometry = new THREE.BoxGeometry(0.5, 0.5, 0.5).toNonIndexed();
    const glow = new THREE.Color(0x30e4d1);
    const emissiveColors = new Float32Array(emissiveGeometry.getAttribute('position').count * 3);
    for (let index = 0; index < emissiveGeometry.getAttribute('position').count; index++) {
      emissiveColors[index * 3] = glow.r;
      emissiveColors[index * 3 + 1] = glow.g;
      emissiveColors[index * 3 + 2] = glow.b;
    }
    emissiveGeometry.setAttribute('color', new THREE.BufferAttribute(emissiveColors, 3));
    const emissiveMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      vertexColors: true,
    });
    emissiveMaterial.name = 'FenbridgeEmissive';
    source.add(new THREE.Mesh(emissiveGeometry, emissiveMaterial));
  }
  return source;
}

function fixtureSources(withEmissive = true): Map<string, THREE.Object3D> {
  return new Map(FENBRIDGE_TOWN_PROP_ASSET_URLS.map((url) => [url, sourceAsset(withEmissive)]));
}

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  return meshes;
}

async function loadRuntimeGlb(assetUrl: string): Promise<THREE.Group> {
  await MeshoptDecoder.ready;
  const bytes = readFileSync(path.join(__dirname, '..', 'public', assetUrl.replace(/^\//, '')));
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return await new Promise<THREE.Group>((resolve, reject) => {
    loader.parse(arrayBuffer, '', (gltf) => resolve(gltf.scene), reject);
  });
}

afterEach(() => {
  setGfx(ORIGINAL_GFX);
  setActiveWorldContent(null);
});

const ROTATED_BUILDING: FenbridgeBuildingVisibilityTarget = {
  x: 10,
  z: -4,
  halfWidth: 2,
  halfDepth: 4,
  cosine: Math.cos(Math.PI / 2),
  sine: Math.sin(Math.PI / 2),
  topY: 8,
  cullRadius: Math.hypot(2, 4),
};

describe('Fenbridge town visibility core', () => {
  it('pins fog boundaries, rotated intersections, and caller-owned plans', () => {
    expect(fenbridgeFogVisible(10, -4, 10, -4, 100, 30)).toBe(true);
    expect(fenbridgeFogVisible(140, -4, 10, -4, 100, 30)).toBe(false);
    expect(fenbridgeCameraSegmentHitsBuilding(ROTATED_BUILDING, 4, 2, -4, 16, 2, -4)).toBe(true);
    expect(fenbridgeCameraSegmentHitsBuilding(ROTATED_BUILDING, 4, 20, -4, 16, 20, -4)).toBe(false);
    const plan = newFenbridgeBuildingVisibilityPlan();
    expect(
      fenbridgeBuildingVisibilityPlanInto(plan, ROTATED_BUILDING, false, 16, 2, -4, 4, 2, -4, 100),
    ).toBe(plan);
    expect(plan).toMatchObject({ visible: true, hidden: true, hiddenChanged: true });
  });
});

describe('Fenbridge shared surface atlas', () => {
  it('maps every exporter palette anchor to its exact 4x4 semantic cell', () => {
    const anchors = {
      mossStone: 0x4e5650,
      cleanStone: 0x74776b,
      darkTimber: 0x34271e,
      warmTimber: 0x523b29,
      tealShingles: 0x176269,
      forgedIron: 0x34383a,
      agedBrass: 0x9b762d,
      rope: 0x8d7650,
      tealCanvas: 0x276a6f,
      parchment: 0xd3be8c,
      curedHide: 0x9e7449,
      packedMud: 0x604c36,
      tealFenlight: 0x30e4d1,
      potionGlass: 0x6269a5,
      rawBoard: 0x765236,
      redWax: 0xa42632,
    } as const;
    expect(Object.keys(FENBRIDGE_SURFACE_CELLS)).toEqual(Object.keys(anchors));
    for (const [semantic, hex] of Object.entries(anchors)) {
      const color = new THREE.Color(hex);
      expect(fenbridgeSemanticForColor(color.r, color.g, color.b)).toBe(semantic);
    }
  });

  it('keeps every exporter shade variant in its authored surface family', () => {
    expect(Object.keys(FENBRIDGE_EXPORTER_PALETTE_SEMANTICS)).toHaveLength(29);
    for (const [name, [hex, semantic]] of Object.entries(FENBRIDGE_EXPORTER_PALETTE_SEMANTICS)) {
      const color = new THREE.Color(hex);
      expect(
        fenbridgeSemanticForColor(color.r, color.g, color.b),
        `${name} should use ${semantic}`,
      ).toBe(semantic);
    }
  });

  it('retains authored color fallback while synthesizing semantic atlas UVs', () => {
    const source = new THREE.BufferGeometry();
    source.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0], 3));
    source.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 3));
    const roof = new THREE.Color(0x176269);
    const glow = new THREE.Color(0xffa43a);
    source.setAttribute(
      'color',
      new THREE.Float32BufferAttribute([roof.r, roof.g, roof.b, glow.r, glow.g, glow.b], 3),
    );
    const mapped = fenbridgeSurfaceGeometry(source, (index) =>
      index === 0 ? 'tealShingles' : 'tealFenlight',
    );
    const colors = mapped.getAttribute('color');
    expect([colors.getX(0), colors.getY(0), colors.getZ(0)]).toEqual([
      expect.closeTo(roof.r, 6),
      expect.closeTo(roof.g, 6),
      expect.closeTo(roof.b, 6),
    ]);
    expect(colors.getX(1)).toBeCloseTo(glow.r, 6);
    expect(colors.getY(1)).toBeCloseTo(glow.g, 6);
    expect(colors.getZ(1)).toBeCloseTo(glow.b, 6);
  });

  it('synthesizes atlas UVs without modifying the source geometry', () => {
    const source = new THREE.BoxGeometry(2, 3, 4).toNonIndexed();
    const originalUv = source.getAttribute('uv');
    const mapped = fenbridgeSurfaceGeometry(source, 'redWax');
    expect(mapped).not.toBe(source);
    expect(source.getAttribute('uv')).toBe(originalUv);
    const uv = mapped.getAttribute('uv');
    for (let index = 0; index < uv.count; index++) {
      expect(uv.getX(index)).toBeGreaterThan(0.75);
      expect(uv.getX(index)).toBeLessThan(1);
      expect(uv.getY(index)).toBeGreaterThan(0);
      expect(uv.getY(index)).toBeLessThan(0.25);
    }
  });

  it('keeps atlas texel density fixed when unrelated geometry changes the bounds', () => {
    const geometryWithExtent = (extent: number): THREE.BufferGeometry => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          [0, 0, 0, 1, 0, 0, 0, 1, 0, extent, 0, 0, extent, 1, 0, extent - 1, 0, 0],
          3,
        ),
      );
      geometry.setAttribute(
        'normal',
        new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3),
      );
      return geometry;
    };
    const oneYardUvDelta = (extent: number): number => {
      const mapped = fenbridgeSurfaceGeometry(geometryWithExtent(extent), 'warmTimber');
      const uv = mapped.getAttribute('uv');
      return uv.getX(1) - uv.getX(0);
    };
    expect(oneYardUvDelta(2)).toBeCloseTo(oneYardUvDelta(9), 8);
    expect(oneYardUvDelta(2)).toBeCloseTo(
      (1 / FENBRIDGE_SURFACE_WORLD_SPAN) * (1 / 4 - 8 / FENBRIDGE_SURFACE_ATLAS_SIZE),
      8,
    );
  });

  it('confines even oversized faces to padded atlas cells instead of sampling neighbors', () => {
    const source = new THREE.BufferGeometry();
    source.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-100, -100, 0, 100, -100, 0, 100, 100, 0], 3),
    );
    source.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    const padding = 4 / FENBRIDGE_SURFACE_ATLAS_SIZE;
    const cellSize = 1 / 4;
    for (const [semantic, cell] of Object.entries(FENBRIDGE_SURFACE_CELLS)) {
      const uv = fenbridgeSurfaceGeometry(
        source,
        semantic as keyof typeof FENBRIDGE_SURFACE_CELLS,
      ).getAttribute('uv');
      const column = cell % 4;
      const rowFromTop = Math.floor(cell / 4);
      const minimumU = column * cellSize + padding;
      const maximumU = (column + 1) * cellSize - padding;
      const minimumV = 1 - (rowFromTop + 1) * cellSize + padding;
      const maximumV = 1 - rowFromTop * cellSize - padding;
      for (let index = 0; index < uv.count; index++) {
        expect(uv.getX(index)).toBeGreaterThanOrEqual(minimumU - 1e-7);
        expect(uv.getX(index)).toBeLessThanOrEqual(maximumU + 1e-7);
        expect(uv.getY(index)).toBeGreaterThanOrEqual(minimumV - 1e-7);
        expect(uv.getY(index)).toBeLessThanOrEqual(maximumV + 1e-7);
      }
    }
    expect(FENBRIDGE_SURFACE_ANISOTROPY).toBe(4);
    expect(FENBRIDGE_SURFACE_RESPONSE_CHANNELS).toEqual({
      roughness: 'green',
      metalness: 'blue',
    });
  });
});

describe('Fenbridge dedicated town renderer', () => {
  it('reserves at most twelve foundation triangles per building inside the 62k runtime ceiling', () => {
    const exactBoundaryCounts = Object.fromEntries(
      FENBRIDGE_TOWN_ASSET_URLS.map((assetUrl) => [assetUrl, 0]),
    );
    exactBoundaryCounts[FENBRIDGE_TOWN_ASSET_URLS[0]] = 88_000 - 7 * 12;

    const budget = fenbridgeTownTriangleBudget(exactBoundaryCounts);
    expect(budget.maximumFoundationTriangles).toBe(84);
    expect(budget.assetTriangles).toBe(87_916);
    expect(budget.maximumRuntimeTriangles).toBe(88_000);
    expect(budget.hardCeiling).toBe(88_000);
    expect(budget.withinHardCeiling).toBe(true);
    expect(budget).not.toHaveProperty('target');
    expect(budget).not.toHaveProperty('meetsTarget');

    exactBoundaryCounts[FENBRIDGE_TOWN_ASSET_URLS[0]]++;
    expect(fenbridgeTownTriangleBudget(exactBoundaryCounts).withinHardCeiling).toBe(false);
  });

  it('extracts normalized templates without mutating loader-owned geometry or transforms', () => {
    setGfx({ standardMaterials: true, surfaceDetail: false });
    const source = sourceAsset();
    const sourceMesh = source.children[0] as THREE.Mesh;
    sourceMesh.position.set(4, 3, -2);
    const beforePositions = Array.from(
      sourceMesh.geometry.getAttribute('position').array as ArrayLike<number>,
    );
    const beforeMatrix = sourceMesh.matrixWorld.elements.slice();
    const template = fenbridgeTownInternalsForTest.extractTemplate(
      source,
      FENBRIDGE_TOWN_PROP_ASSET_URLS[0],
    );
    expect(Array.from(sourceMesh.geometry.getAttribute('position').array)).toEqual(beforePositions);
    expect(sourceMesh.matrixWorld.elements).toEqual(beforeMatrix);
    expect(template.opaque?.getAttribute('position')).not.toBe(
      sourceMesh.geometry.getAttribute('position'),
    );
    expect(template.size.x).toBeGreaterThan(0);
    expect(template.size.y).toBeGreaterThan(0);
    expect(template.size.z).toBeGreaterThan(0);
  });

  it('renders the optimized shipping GLBs at the exact whole-town draw and triangle totals', {
    timeout: 30_000,
  }, async () => {
    const sources = new Map<string, THREE.Object3D>();
    const triangleCountByAsset: Record<string, number> = {};
    for (const assetUrl of FENBRIDGE_TOWN_PROP_ASSET_URLS) {
      const source = await loadRuntimeGlb(assetUrl);
      sources.set(assetUrl, source);
      triangleCountByAsset[assetUrl] = meshesOf(source).reduce(
        (sum, mesh) =>
          sum + (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3,
        0,
      );
    }
    const questSource = await loadRuntimeGlb(fenbridgeTownInternalsForTest.questAssetUrl);
    const questTriangles = meshesOf(questSource).reduce(
      (sum, mesh) =>
        sum + (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3,
      0,
    );
    const questDraws = meshesOf(questSource).reduce(
      (sum, mesh) => sum + (Array.isArray(mesh.material) ? mesh.material.length : 1),
      0,
    );
    expect({ questTriangles, questDraws }).toEqual({ questTriangles: 204, questDraws: 1 });
    triangleCountByAsset[fenbridgeTownInternalsForTest.questAssetUrl] = questTriangles;
    expect(fenbridgeTownTriangleBudget(triangleCountByAsset)).toMatchObject({
      assetTriangles: 81_524,
      maximumFoundationTriangles: 84,
      maximumRuntimeTriangles: 81_608,
      hardCeiling: 88_000,
      withinHardCeiling: true,
    });

    const ground = (x: number, z: number): number => terrainHeight(x, z, 20_061);
    setGfx({ standardMaterials: true, dynamicShadows: true, surfaceDetail: false, composer: true });
    const standard = fenbridgeTownInternalsForTest.buildFromSources(sources, ground, true);
    const standardRoot = fenbridgeTownDrawStats(standard.group);
    expect(standard.group.userData.triangleStats).toMatchObject({
      scope: 'fenbridge-town-render-root-only',
      emittedFoundationTriangles: 72,
      includesQuestObjects: false,
    });
    expect(standardRoot).toMatchObject({
      colorDraws: 20,
      shadowDraws: 10,
      // placement-weighted shipping geometry after R16-30 densify + 12 boardwalks
      triangles: 81_188,
    });
    expect({
      colorDraws: standardRoot.colorDraws + questDraws * 2,
      shadowDraws: standardRoot.shadowDraws,
      triangles: 81_188 + 84 * 2,
    }).toEqual({ colorDraws: 22, shadowDraws: 10, triangles: 81_356 });

    setGfx({
      standardMaterials: false,
      dynamicShadows: false,
      surfaceDetail: false,
      composer: false,
    });
    const low = fenbridgeTownInternalsForTest.buildFromSources(sources, ground, true);
    const lowRoot = fenbridgeTownDrawStats(low.group);
    expect(lowRoot).toMatchObject({ colorDraws: 11, shadowDraws: 0, triangles: 81_188 });
    expect(lowRoot.colorDraws + questDraws * 2).toBe(13);
  });

  it('builds the exact live inventory with Standard PBR maps inside its draw budgets', () => {
    setGfx({ standardMaterials: true, dynamicShadows: true, surfaceDetail: false, composer: true });
    const atlas = new THREE.Texture();
    const normal = new THREE.Texture();
    const roughness = new THREE.Texture();
    const ground = (x: number, z: number): number => 1.2 + x * 0.01 - z * 0.002;
    const view = fenbridgeTownInternalsForTest.buildFromSources(fixtureSources(), ground, true, {
      atlas,
      normal,
      roughness,
    });

    expect(view.group.name).toBe(FENBRIDGE_TOWN_ROOT_NAME);
    expect(view.group.userData.layoutId).toBe(FENBRIDGE_LAYOUT.id);
    expect(view.group.userData.placementIds).toEqual(FENBRIDGE_TOWN_REQUIRED_PLACEMENT_IDS);
    expect(view.group.userData.assetPlacementCounts).toEqual(FENBRIDGE_TOWN_ASSET_PLACEMENT_COUNTS);
    expect(view.group.userData.assetUrls).toEqual(FENBRIDGE_TOWN_ASSET_URLS);
    expect(view.group.userData.buildingFadeTargetCount).toBe(7);
    expect(view.group.userData.triangleStats).toMatchObject({
      scope: 'fenbridge-town-render-root-only',
      includesQuestObjects: false,
      informationalOnly: true,
    });
    expect(view.group.userData.triangleStats).not.toHaveProperty('withinHardCeiling');

    const stats = fenbridgeTownDrawStats(view.group);
    expect(stats).toMatchObject({
      colorDraws: 22,
      shadowDraws: 10,
      buildingCount: 7,
      buildingFadeTargetCount: 7,
      wallSegmentCount: 16,
      gateCount: 4,
      boardwalkCount: 12,
    });
    expect(stats.colorDraws).toBeLessThanOrEqual(22);
    expect(stats.shadowDraws).toBeLessThanOrEqual(10);

    const materials = meshesOf(view.group).map((mesh) => mesh.material as THREE.Material);
    const opaque = materials.filter(
      (material): material is THREE.MeshStandardMaterial =>
        material instanceof THREE.MeshStandardMaterial && material.emissive.getHex() === 0,
    );
    expect(opaque.length).toBeGreaterThan(0);
    expect(opaque.every((material) => material.map === atlas)).toBe(true);
    expect(opaque.every((material) => material.normalMap === normal)).toBe(true);
    expect(opaque.every((material) => material.roughnessMap === roughness)).toBe(true);
    expect(opaque.every((material) => material.metalnessMap === roughness)).toBe(true);
    expect(opaque.every((material) => material.roughness === 1)).toBe(true);
    expect(opaque.every((material) => material.metalness === 1)).toBe(true);
    expect(opaque.every((material) => material.vertexColors === false)).toBe(true);

    const observedCounts: Record<string, number> = {};
    view.group.traverse((object) => {
      if (!(object instanceof THREE.InstancedMesh)) return;
      const key = object.userData.assetKey as string | undefined;
      if (key) observedCounts[key] = (observedCounts[key] ?? 0) + object.count;
    });
    expect(observedCounts).toEqual({
      fenbridge_palisade_wing: FENBRIDGE_TOWN_ASSET_PLACEMENT_COUNTS.fenbridge_palisade_wing,
      fenbridge_gate_arch: FENBRIDGE_TOWN_ASSET_PLACEMENT_COUNTS.fenbridge_gate_arch,
      fenbridge_boardwalk: FENBRIDGE_TOWN_ASSET_PLACEMENT_COUNTS.fenbridge_boardwalk,
    });
    const orderEvidence = view.group.getObjectByName('fenbridgeMusterOrderPlacements');
    expect(orderEvidence?.userData.noDuplicateTownMesh).toBe(true);
    expect(meshesOf(orderEvidence as THREE.Object3D)).toHaveLength(0);

    for (const building of FENBRIDGE_LAYOUT.buildings) {
      const node = view.group.getObjectByName(`fenbridgeBuilding:${building.id}`);
      const entrance = localToWorld(
        building.position,
        building.rotation,
        building.sockets.entrance.localPosition.x,
        building.sockets.entrance.localPosition.z,
      );
      expect(node?.position.y, `${building.id} entrance seating`).toBeCloseTo(
        ground(entrance.x, entrance.z),
        10,
      );
    }
  });

  it('keeps Low silhouette-complete with one Lambert pass per placement class and no shadows', () => {
    setGfx({
      standardMaterials: false,
      dynamicShadows: false,
      surfaceDetail: false,
      composer: false,
    });
    const atlas = new THREE.Texture();
    const normal = new THREE.Texture();
    const roughness = new THREE.Texture();
    const view = fenbridgeTownInternalsForTest.buildFromSources(fixtureSources(), () => 1.2, true, {
      atlas,
      normal,
      roughness,
    });
    const stats = fenbridgeTownDrawStats(view.group);
    expect(stats.colorDraws).toBe(11);
    expect(stats.colorDraws).toBeLessThanOrEqual(16);
    expect(stats.shadowDraws).toBe(0);
    const materials = meshesOf(view.group).map((mesh) => mesh.material as THREE.Material);
    expect(materials.every((material) => material instanceof THREE.MeshLambertMaterial)).toBe(true);
    expect(
      materials.every((material) => (material as THREE.MeshLambertMaterial).map === atlas),
    ).toBe(true);
    expect(materials.every((material) => material.vertexColors === false)).toBe(true);
  });

  it.each([
    ['Standard', true],
    ['Low', false],
  ] as const)(
    'keeps authored town and quest colors as the %s atlas-failure fallback',
    (_tier, standard) => {
      setGfx({
        standardMaterials: standard,
        dynamicShadows: standard,
        surfaceDetail: false,
        composer: standard,
      });
      const view = fenbridgeTownInternalsForTest.buildFromSources(
        fixtureSources(),
        () => 1.2,
        true,
        { atlas: undefined, normal: undefined, roughness: undefined },
      );
      const townMaterials = meshesOf(view.group).map((mesh) => mesh.material as THREE.Material);
      expect(townMaterials.length).toBeGreaterThan(0);
      for (const material of townMaterials) {
        const surface = material as THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;
        expect(surface.map).toBeNull();
        expect(surface.vertexColors).toBe(true);
      }

      const questSource = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
      });
      const questFallback = questObjectPreloadInternalsForTest.convertMaterial(
        questSource,
        'fen_muster_order',
      ) as THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;
      expect(questFallback.map).toBeNull();
      expect(questFallback.vertexColors).toBe(true);
    },
  );

  it('footprint-seats and pitches thin gate and boardwalk instances on production terrain', () => {
    setGfx({ standardMaterials: false, dynamicShadows: false, surfaceDetail: false });
    const ground = (x: number, z: number): number => terrainHeight(x, z, 20_061);
    const view = fenbridgeTownInternalsForTest.buildFromSources(
      fixtureSources(false),
      ground,
      true,
    );
    const cases = [
      {
        mesh: view.group.getObjectByName('fenbridgeTownGateArchOpaqueInstances'),
        placements: FENBRIDGE_LAYOUT.wall.gates.map((gate) => gate.arch),
      },
      {
        mesh: view.group.getObjectByName('fenbridgeTownBoardwalkOpaqueInstances'),
        placements: FENBRIDGE_LAYOUT.repeated.boardwalks,
      },
    ];
    let nonCenterSeated = 0;
    for (const entry of cases) {
      expect(entry.mesh).toBeInstanceOf(THREE.InstancedMesh);
      const mesh = entry.mesh as THREE.InstancedMesh;
      expect(mesh.count).toBe(entry.placements.length);
      for (let index = 0; index < entry.placements.length; index++) {
        const placement = entry.placements[index];
        const expected = fenbridgeTownInternalsForTest.pitchedFootprintPlacement(
          placement.position,
          placement.rotation,
          placement.nativeDimensions.width,
          placement.nativeDimensions.depth,
          ground,
        );
        const matrix = new THREE.Matrix4();
        mesh.getMatrixAt(index, matrix);
        // Instanced matrices are uploaded/stored as Float32 values.
        expect(matrix.elements[12]).toBeCloseTo(expected.centerX, 4);
        expect(matrix.elements[13]).toBeCloseTo(expected.centerY, 4);
        expect(matrix.elements[14]).toBeCloseTo(expected.centerZ, 4);
        if (
          Math.abs(expected.centerY - ground(placement.position.x, placement.position.z)) > 1e-4
        ) {
          nonCenterSeated++;
        }
      }
    }
    expect(nonCenterSeated).toBeGreaterThan(0);
  });

  it('exposes nonempty collider/route/service overlay evidence through both root hooks', () => {
    setGfx({ standardMaterials: false, dynamicShadows: false, surfaceDetail: false });
    const view = fenbridgeTownInternalsForTest.buildFromSources(
      fixtureSources(false),
      () => 1.2,
      true,
    );
    const overlay = view.group.getObjectByName(FENBRIDGE_CAPTURE_OVERLAY_NAME) as THREE.Group;
    expect(overlay.visible).toBe(false);
    expect(overlay.children).toHaveLength(3);
    expect(overlay.userData.recordCounts).toMatchObject({
      colliders: expect.any(Number),
      routes: 4,
      services: expect.any(Number),
    });
    expect(overlay.userData.recordCounts.colliders).toBeGreaterThan(0);
    expect(overlay.userData.recordCounts.services).toBeGreaterThan(0);
    expect(overlay.userData.captureRecords.colliders).not.toEqual([]);
    const musterBoard = BUILTIN_WORLD.services?.musterBoards?.[0];
    expect(musterBoard).toBeDefined();
    expect(
      overlay.userData.captureRecords.colliders.find(
        (record: { id?: string }) => record.id === musterBoard?.id,
      ),
    ).toMatchObject({
      id: 'fenbridge_muster_board',
      kind: 'obb',
      center: { x: -6, z: 278 },
      halfWidth: 1.2,
      halfDepth: 0.3,
    });
    expect(
      overlay.userData.captureRecords.services.find(
        (record: { id?: string }) => record.id === musterBoard?.id,
      ),
    ).toMatchObject({
      id: 'fenbridge_muster_board',
      kind: 'muster-board',
      position: musterBoard?.frontStandingPoint,
    });
    view.setCaptureOverlay(true);
    expect(overlay.visible).toBe(true);
    view.group.userData.setFenbridgeCaptureOverlay(false);
    expect(overlay.visible).toBe(false);
  });

  it('omits muster-board overlay evidence when the active-world service is absent', () => {
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      services: { ...BUILTIN_WORLD.services, musterBoards: [] },
    });
    const view = fenbridgeTownInternalsForTest.buildFromSources(
      fixtureSources(false),
      () => 1.2,
      true,
    );
    const overlay = view.group.getObjectByName(FENBRIDGE_CAPTURE_OVERLAY_NAME) as THREE.Group;
    for (const kind of ['colliders', 'services']) {
      expect(
        overlay.userData.captureRecords[kind].some(
          (record: { id?: string }) => record.id === 'fenbridge_muster_board',
        ),
      ).toBe(false);
    }
  });

  it('fades one intersected building independently and never mutates static batches', () => {
    setGfx({ standardMaterials: false, dynamicShadows: false, surfaceDetail: false });
    const view = fenbridgeTownInternalsForTest.buildFromSources(
      fixtureSources(false),
      () => 0,
      true,
    );
    const building = FENBRIDGE_LAYOUT.buildings[0];
    const target = view.group.getObjectByName(`fenbridgeBuilding:${building.id}`) as THREE.Group;
    const other = view.group.getObjectByName(
      `fenbridgeBuilding:${FENBRIDGE_LAYOUT.buildings[1].id}`,
    ) as THREE.Group;
    const targetMaterial = meshesOf(target)[0].material as THREE.Material;
    const otherMaterial = meshesOf(other)[0].material as THREE.Material;
    const micro = view.group.getObjectByName('fenbridgeTownMicroOpaqueBatch') as THREE.Mesh;
    const microMaterial = micro.material as THREE.Material;
    view.update(
      building.position.x + 20,
      2,
      building.position.z,
      building.position.x,
      2,
      building.position.z,
      200,
      10,
    );
    expect(targetMaterial.opacity).toBeCloseTo(0.2, 10);
    expect(otherMaterial.opacity).toBe(1);
    expect(microMaterial.opacity).toBe(1);
  });

  it('returns an empty stable custom-world root without requesting any template', () => {
    const view = fenbridgeTownInternalsForTest.buildFromSources(new Map(), () => 0, false);
    expect(view.group.name).toBe(FENBRIDGE_TOWN_ROOT_NAME);
    expect(view.group.children).toEqual([]);
    expect(view.group.userData.placementIds).toEqual([]);
    expect(fenbridgeTownDrawStats(view.group)).toMatchObject({
      colorDraws: 0,
      shadowDraws: 0,
      triangles: 0,
    });
  });

  it('suppresses only exact stable built-in IDs and wires both renderer update paths', () => {
    for (const building of FENBRIDGE_LAYOUT.buildings) {
      const record = BUILTIN_WORLD.props.buildings.find(
        (candidate) => candidate.id === building.id,
      );
      if (!record) throw new Error(`missing built-in ${building.id}`);
      expect(isFenbridgeRebuildBuilding(record)).toBe(true);
      expect(isFenbridgeRebuildBuilding({ ...record, id: `${record.id}_custom` })).toBe(false);
    }
    const well = BUILTIN_WORLD.props.wells.find(
      (candidate) => candidate.id === FENBRIDGE_LAYOUT.civic.cistern.id,
    );
    const stall = BUILTIN_WORLD.props.stalls.find(
      (candidate) => candidate.id === FENBRIDGE_LAYOUT.civic.provisionStall.id,
    );
    if (!well || !stall) throw new Error('missing built-in Fenbridge civic placements');
    expect(isFenbridgeRebuildWell(well)).toBe(true);
    expect(isFenbridgeRebuildWell({ ...well, id: 'custom-well' })).toBe(false);
    expect(isFenbridgeRebuildStall(stall)).toBe(true);
    expect(isFenbridgeRebuildStall({ ...stall, id: 'custom-stall' })).toBe(false);

    const rendererSource = readFileSync(
      path.join(__dirname, '..', 'src/render/renderer.ts'),
      'utf8',
    );
    expect(rendererSource).toContain('buildFenbridgeTownView(this.sim.cfg.seed)');
    expect(rendererSource).toContain("setRenderCategory(this.fenbridgeTownView.group, 'props')");
    expect(rendererSource.match(/this\.fenbridgeTownView\.update\(/g)).toHaveLength(2);
    expect(rendererSource).toContain('setFenbridgeCaptureOverlay(visible: boolean)');

    const propsSource = readFileSync(path.join(__dirname, '..', 'src/render/props.ts'), 'utf8');
    expect(propsSource).toContain('isFenbridgeRebuildBuilding(b)');
    expect(propsSource).toContain('isFenbridgeRebuildWell(w)');
    expect(propsSource).toContain('isFenbridgeRebuildStall(s)');
    const view = fenbridgeTownInternalsForTest.buildFromSources(
      fixtureSources(false),
      () => 0,
      true,
    );
    expect(view.update.toString()).not.toMatch(/\bnew\s+/);
  });
});
