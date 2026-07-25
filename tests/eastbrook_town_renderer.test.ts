import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EASTBROOK_TOWN_ASSET_INSTANCE_COUNTS,
  EASTBROOK_TOWN_ASSET_URLS,
  EASTBROOK_TOWN_NEW_ASSET_URLS,
  EASTBROOK_TOWN_ROOT_NAME,
  eastbrookTownDrawStats,
  eastbrookTownInternalsForTest,
  eastbrookTownTriangleBudget,
  isEastbrookRebuildBuilding,
  isEastbrookRebuildFence,
  isEastbrookRebuildStall,
  isEastbrookRebuildWell,
} from '../src/render/eastbrook_town';
import {
  type EastbrookRoofVisibilityTarget,
  eastbrookCameraSegmentHitsRoof,
  eastbrookFogVisible,
  eastbrookRoofVisibilityPlanInto,
  newEastbrookRoofVisibilityPlan,
} from '../src/render/eastbrook_town_visibility_core';
import { GFX } from '../src/render/gfx';
import { vertexColorEmissiveInternalsForTest } from '../src/render/vertex_color_emissive';
import { BUILDING_TERRAIN_SAMPLE_STEP } from '../src/sim/building_layout';
import { BUILTIN_WORLD } from '../src/sim/data';
import { EASTBROOK_LAYOUT, localToWorld } from '../src/sim/eastbrook_layout';
import { terrainHeight } from '../src/sim/world';

const ORIGINAL_STANDARD_MATERIALS = GFX.standardMaterials;

function sourceAsset(withEmissive: boolean): THREE.Group {
  const source = new THREE.Group();
  const opaque = new THREE.MeshStandardMaterial({ color: 0x789abc });
  opaque.name = 'TownOpaque';
  source.add(new THREE.Mesh(new THREE.BoxGeometry(2, 3, 4), opaque));
  if (withEmissive) {
    const emissive = new THREE.MeshStandardMaterial({
      color: 0xffb45a,
      emissive: 0xff7a20,
    });
    emissive.name = 'TownEmissive';
    source.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), emissive));
  }
  return source;
}

function fixtureSources(): Map<string, THREE.Object3D> {
  return new Map(
    EASTBROOK_TOWN_ASSET_URLS.map((assetUrl) => [
      assetUrl,
      sourceAsset(EASTBROOK_TOWN_NEW_ASSET_URLS.includes(assetUrl)),
    ]),
  );
}

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  return meshes;
}

afterEach(() => {
  (GFX as unknown as { standardMaterials: boolean }).standardMaterials =
    ORIGINAL_STANDARD_MATERIALS;
});

const ROTATED_ROOF: EastbrookRoofVisibilityTarget = {
  x: 10,
  z: -4,
  halfWidth: 2,
  halfDepth: 4,
  cosine: Math.cos(Math.PI / 2),
  sine: Math.sin(Math.PI / 2),
  topY: 8,
  cullRadius: Math.hypot(2, 4),
};

describe('Eastbrook town visibility core', () => {
  it('uses the fog range plus target radius and excludes the exact outer boundary', () => {
    expect(eastbrookFogVisible(10, -4, 10, -4, 100, 30)).toBe(true);
    expect(eastbrookFogVisible(139.999, -4, 10, -4, 100, 30)).toBe(true);
    expect(eastbrookFogVisible(140, -4, 10, -4, 100, 30)).toBe(false);
  });

  it('detects a below-roof camera segment through a rotated footprint', () => {
    expect(eastbrookCameraSegmentHitsRoof(ROTATED_ROOF, 4, 2, -4, 16, 2, -4)).toBe(true);
    expect(eastbrookCameraSegmentHitsRoof(ROTATED_ROOF, 4, 9, -4, 16, 9, -4)).toBe(false);
    expect(eastbrookCameraSegmentHitsRoof(ROTATED_ROOF, 4, 2, 0, 16, 2, 0)).toBe(false);
  });

  it('treats either below-roof endpoint inside the footprint as an intersection', () => {
    expect(eastbrookCameraSegmentHitsRoof(ROTATED_ROOF, 10, 2, -4, 30, 2, -4)).toBe(true);
    expect(eastbrookCameraSegmentHitsRoof(ROTATED_ROOF, 30, 2, -4, 10, 2, -4)).toBe(true);
    expect(eastbrookCameraSegmentHitsRoof(ROTATED_ROOF, 10, 8, -4, 30, 8, -4)).toBe(false);
  });

  it('writes fog, roof-hide, and state-transition decisions into one reusable plan', () => {
    const plan = newEastbrookRoofVisibilityPlan();

    expect(
      eastbrookRoofVisibilityPlanInto(plan, ROTATED_ROOF, true, 1000, 2, -4, 4, 2, -4, 100),
    ).toBe(plan);
    expect(plan).toEqual({ visible: false, hidden: true, hiddenChanged: false });

    eastbrookRoofVisibilityPlanInto(plan, ROTATED_ROOF, false, 16, 2, -4, 4, 2, -4, 100);
    expect(plan).toEqual({ visible: true, hidden: true, hiddenChanged: true });

    eastbrookRoofVisibilityPlanInto(plan, ROTATED_ROOF, true, 16, 2, -4, 4, 2, -4, 100);
    expect(plan).toEqual({ visible: true, hidden: true, hiddenChanged: false });

    eastbrookRoofVisibilityPlanInto(plan, ROTATED_ROOF, true, 16, 9, -4, 4, 9, -4, 100);
    expect(plan).toEqual({ visible: true, hidden: false, hiddenChanged: true });
  });
});

describe('Eastbrook town renderer', () => {
  it('places the exact canonical buildings and initialization-batches every low prop and wall chord', () => {
    const view = eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), () => 1.5, true);
    expect(view.group.name).toBe(EASTBROOK_TOWN_ROOT_NAME);
    expect(view.group.userData.newAssetUrls).toEqual(EASTBROOK_TOWN_NEW_ASSET_URLS);
    expect(view.group.userData.assetUrls).toEqual(EASTBROOK_TOWN_ASSET_URLS);

    for (const building of EASTBROOK_LAYOUT.buildings) {
      const group = view.group.getObjectByName(`eastbrookBuilding:${building.id}`);
      expect(group, building.id).toBeInstanceOf(THREE.Group);
      expect(group?.position.x).toBe(building.position.x);
      expect(group?.position.y).toBe(1.5);
      expect(group?.position.z).toBe(building.position.z);
      expect(group?.rotation.y).toBe(building.rotation);
      expect(group?.userData.assetUrl).toBe(building.assetId);
      expect(group?.userData.target).toBe(building.nativeDimensions);
      expect(group?.userData.front).toBe(building.frontStandingPoint);
      expect(group?.getObjectByName(`eastbrookBuildingOpaque:${building.id}`)).toBeInstanceOf(
        THREE.Mesh,
      );
      expect(group?.getObjectByName(`eastbrookBuildingEmissive:${building.id}`)).toBeInstanceOf(
        THREE.Mesh,
      );
      const opaque = group?.getObjectByName(`eastbrookBuildingOpaque:${building.id}`) as THREE.Mesh;
      opaque.geometry.computeBoundingBox();
      const size = opaque.geometry.boundingBox?.getSize(new THREE.Vector3());
      expect(size?.x).toBeCloseTo(building.nativeDimensions.width, 5);
      expect(size?.y).toBeCloseTo(building.nativeDimensions.height, 5);
      expect(size?.z).toBeCloseTo(building.nativeDimensions.depth, 5);
    }

    expect(view.group.getObjectByName('eastbrookTownMicroOpaqueBatch')).toBeInstanceOf(THREE.Mesh);
    expect(view.group.getObjectByName('eastbrookTownMicroEmissiveBatch')).toBeInstanceOf(
      THREE.Mesh,
    );
    const wallBatches = meshesOf(view.group).filter(
      (mesh) => mesh.userData.eastbrookWallInstances,
    ) as THREE.InstancedMesh[];
    expect(wallBatches).toHaveLength(4);
    expect(wallBatches.every((mesh) => mesh instanceof THREE.InstancedMesh)).toBe(true);
    expect(wallBatches.filter((mesh) => mesh.userData.handedness === 'mirrored')).toHaveLength(2);
    expect(wallBatches.filter((mesh) => mesh.userData.handedness === 'original')).toHaveLength(2);
    expect(
      wallBatches
        .filter((mesh) => !mesh.name.includes('Emissive'))
        .reduce((sum, mesh) => sum + mesh.count, 0),
    ).toBe(EASTBROOK_LAYOUT.wall.segments.length);
    expect(view.group.userData.wallSegmentCount).toBe(EASTBROOK_LAYOUT.wall.segments.length);
    expect(view.group.userData.gateCount).toBe(6);
    expect(view.group.userData.roofHideTargetCount).toBe(EASTBROOK_LAYOUT.buildings.length);
    expect(view.group.userData.microPlacementIds).toEqual([
      EASTBROOK_LAYOUT.civic.wellBeacon.id,
      ...EASTBROOK_LAYOUT.civic.benches.map((bench) => bench.id),
      ...EASTBROOK_LAYOUT.market.stalls.map((stall) => stall.id),
      ...EASTBROOK_LAYOUT.fences.map((fence) => fence.id),
      ...EASTBROOK_LAYOUT.wall.segments.map((segment) => segment.id),
    ]);
    expect(view.group.userData.microPlacementIds).not.toContain('eastbrook_market_stall_artisans');
    expect(eastbrookTownDrawStats(view.group)).toMatchObject({
      colorDraws: 18,
      shadowDraws: 9,
      buildingCount: 6,
      roofHideTargetCount: 6,
      microBatchCount: 2,
      wallBatchCount: 4,
      wallSegmentCount: 26,
      gateCount: 6,
    });
  });

  it('seats every service building on its real terrain envelope with a non-floating foundation', () => {
    const seed = 20_061;
    const ground = (x: number, z: number) => terrainHeight(x, z, seed);
    const view = eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), ground, true);
    const flatView = eastbrookTownInternalsForTest.buildFromSources(
      fixtureSources(),
      () => 0,
      true,
    );

    for (const building of EASTBROOK_LAYOUT.buildings) {
      const group = view.group.getObjectByName(`eastbrookBuilding:${building.id}`);
      if (!group) throw new Error(`missing rendered building ${building.id}`);
      const opaque = group.getObjectByName(`eastbrookBuildingOpaque:${building.id}`) as THREE.Mesh;
      const flatOpaque = flatView.group.getObjectByName(
        `eastbrookBuildingOpaque:${building.id}`,
      ) as THREE.Mesh;
      if (!opaque || !flatOpaque) throw new Error(`missing opaque geometry for ${building.id}`);
      const { width, depth } = building.nativeDimensions;
      const xSteps = Math.max(1, Math.ceil(width / BUILDING_TERRAIN_SAMPLE_STEP));
      const zSteps = Math.max(1, Math.ceil(depth / BUILDING_TERRAIN_SAMPLE_STEP));
      const entrance = localToWorld(building.position, building.rotation, 0, depth / 2);
      const entranceY = ground(entrance.x, entrance.z);
      let minimumY = Infinity;
      const samples: Array<{ x: number; z: number; ground: number }> = [];
      for (let zIndex = 0; zIndex <= zSteps; zIndex++) {
        const localZ = -depth / 2 + (depth * zIndex) / zSteps;
        for (let xIndex = 0; xIndex <= xSteps; xIndex++) {
          const localX = -width / 2 + (width * xIndex) / xSteps;
          const point = localToWorld(building.position, building.rotation, localX, localZ);
          const sampleGround = ground(point.x, point.z);
          minimumY = Math.min(minimumY, sampleGround);
          samples.push({ ...point, ground: sampleGround });
        }
      }

      const foundationDepth = Math.max(0, entranceY - minimumY);
      expect(group.position.y, `${building.id} entrance grade`).toBeCloseTo(entranceY, 10);
      expect(group.userData.foundationDepth, building.id).toBeCloseTo(foundationDepth, 10);
      expect(foundationDepth, `${building.id} real-terrain foundation branch`).toBeGreaterThan(0);
      const opaqueTriangles =
        (opaque.geometry.index?.count ?? opaque.geometry.getAttribute('position').count) / 3;
      const flatOpaqueTriangles =
        (flatOpaque.geometry.index?.count ?? flatOpaque.geometry.getAttribute('position').count) /
        3;
      expect(opaqueTriangles, `${building.id} foundation geometry`).toBe(flatOpaqueTriangles + 12);
      opaque.geometry.computeBoundingBox();
      expect(
        opaque.geometry.boundingBox?.min.y,
        `${building.id} foundation mesh bottom`,
      ).toBeCloseTo(-foundationDepth, 5);
      const foundationBottom = group.position.y - foundationDepth;
      for (const sample of samples) {
        expect(
          foundationBottom,
          `${building.id} foundation floats at ${sample.x},${sample.z}`,
        ).toBeLessThanOrEqual(sample.ground + 1e-8);
      }
      expect(foundationBottom, `${building.id} deepest terrain seat`).toBeCloseTo(minimumY, 10);
    }
  });

  it('roof-ghosts only building volumes and restores them without touching microgeometry', () => {
    const view = eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
    const bank = EASTBROOK_LAYOUT.buildings[0];
    const bankGroup = view.group.getObjectByName(`eastbrookBuilding:${bank.id}`);
    const micro = view.group.getObjectByName('eastbrookTownMicroOpaqueBatch') as THREE.Mesh;
    if (!bankGroup || !micro) throw new Error('renderer fixture lost Eastbrook scene nodes');
    const bankMaterials = meshesOf(bankGroup).map((mesh) => mesh.material as THREE.Material);
    const microMaterial = micro.material as THREE.Material;

    view.update(45, 2, 45, bank.position.x, 2, bank.position.z, 200);
    expect(bankMaterials.every((material) => !material.colorWrite && !material.depthWrite)).toBe(
      true,
    );
    expect(microMaterial.colorWrite).toBe(true);
    expect(microMaterial.depthWrite).toBe(true);

    view.update(45, 30, 45, bank.position.x, 30, bank.position.z, 200);
    expect(bankMaterials.every((material) => material.colorWrite && material.depthWrite)).toBe(
      true,
    );
    expect(microMaterial.colorWrite).toBe(true);
  });

  it('uses Lambert vertex-color materials on Low without changing geometry or draw counts', () => {
    (GFX as unknown as { standardMaterials: boolean }).standardMaterials = false;
    const view = eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
    const meshes = meshesOf(view.group);
    expect(meshes).toHaveLength(18);
    expect(
      meshes.every((mesh) => (mesh.material as THREE.Material).type === 'MeshLambertMaterial'),
    ).toBe(true);
    expect(meshes.every((mesh) => (mesh.material as THREE.MeshLambertMaterial).vertexColors)).toBe(
      true,
    );
    expect(eastbrookTownDrawStats(view.group)).toMatchObject({ colorDraws: 18, shadowDraws: 9 });
  });

  it('mirrors exactly the first real wall chord after each asymmetric gate socket', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const document = await io.readBinary(
      readFileSync(path.join(__dirname, '..', 'public/models/props/eastbrook_wall_wing.glb')),
    );
    const nodes = Object.fromEntries(
      document
        .getRoot()
        .listNodes()
        .filter((node) => node.getName().startsWith('Socket_'))
        .map((node) => [node.getName(), node.getTranslation()]),
    );
    expect(nodes.Socket_LeftJoin?.[0]).toBeLessThan(0);
    expect(nodes.Socket_RightGate?.[0]).toBeGreaterThan(0);

    const expectedMirrored = EASTBROOK_LAYOUT.wall.segments.filter((segment) =>
      eastbrookTownInternalsForTest.wallSegmentNeedsMirror(segment),
    );
    expect(expectedMirrored).toHaveLength(EASTBROOK_LAYOUT.wall.gates.length);
    for (const gate of EASTBROOK_LAYOUT.wall.gates) {
      expect(
        expectedMirrored.some(
          (segment) =>
            Math.abs(segment.start.x - gate.end.x) < 1e-8 &&
            Math.abs(segment.start.z - gate.end.z) < 1e-8,
        ),
      ).toBe(true);
    }

    const view = eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
    expect(view.group.userData.mirroredWallSegmentIds).toEqual(
      expectedMirrored.map((segment) => segment.id),
    );
    const mirrored = view.group.getObjectByName(
      'eastbrookTownWallOpaqueMirroredInstances',
    ) as THREE.InstancedMesh;
    const original = view.group.getObjectByName(
      'eastbrookTownWallOpaqueInstances',
    ) as THREE.InstancedMesh;
    expect(mirrored.count).toBe(6);
    expect(original.count).toBe(EASTBROOK_LAYOUT.wall.segments.length - 6);
    expect(mirrored.geometry).not.toBe(original.geometry);

    const position = mirrored.geometry.getAttribute('position');
    const normal = mirrored.geometry.getAttribute('normal');
    const a = new THREE.Vector3().fromBufferAttribute(position, 0);
    const b = new THREE.Vector3().fromBufferAttribute(position, 1);
    const c = new THREE.Vector3().fromBufferAttribute(position, 2);
    const faceNormal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    const storedNormal = new THREE.Vector3().fromBufferAttribute(normal, 0).normalize();
    expect(faceNormal.dot(storedNormal)).toBeGreaterThan(0);
  });

  it('keeps pitched wall and fence spans terrain-supported across their full footprints', () => {
    const seed = 20061;
    const ground = (x: number, z: number) => terrainHeight(x, z, seed);
    const records = [
      ...EASTBROOK_LAYOUT.fences.map((fence) => ({
        id: fence.id,
        start: fence.start,
        end: fence.end,
        width: fence.width,
      })),
      ...EASTBROOK_LAYOUT.wall.segments.map((segment) => ({
        id: segment.id,
        start: segment.start,
        end: segment.end,
        width: EASTBROOK_LAYOUT.wall.thickness,
      })),
    ];
    let adjustedPlacements = 0;
    for (const record of records) {
      const placement = eastbrookTownInternalsForTest.pitchedSegmentPlacement(
        record.start,
        record.end,
        record.width,
        ground,
      );
      const startY = ground(record.start.x, record.start.z);
      const endY = ground(record.end.x, record.end.z);
      const horizontalLength = Math.hypot(
        record.end.x - record.start.x,
        record.end.z - record.start.z,
      );
      expect(placement.spatialLength, record.id).toBeCloseTo(
        Math.hypot(horizontalLength, endY - startY),
        10,
      );
      if (placement.terrainOffset < -1e-6) adjustedPlacements++;
      eastbrookTownInternalsForTest.forEachSegmentFootprintSample(
        record.start,
        record.end,
        record.width,
        (x, z, progress) => {
          const bottomY = startY + (endY - startY) * progress + placement.terrainOffset;
          expect(bottomY, `${record.id} floats at ${x},${z}`).toBeLessThanOrEqual(
            ground(x, z) + 1e-8,
          );
        },
      );
    }
    expect(adjustedPlacements).toBeGreaterThan(0);
  });

  it('preserves mixed vertex-color emissive cues in the shared Lambert and Standard shader arms', () => {
    for (const standardMaterials of [false, true]) {
      (GFX as unknown as { standardMaterials: boolean }).standardMaterials = standardMaterials;
      const view = eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
      const emissiveMaterials = meshesOf(view.group)
        .filter((mesh) => mesh.name.includes('Emissive'))
        .map((mesh) => mesh.material as THREE.Material);
      expect(emissiveMaterials.length).toBeGreaterThan(0);
      for (const material of emissiveMaterials) {
        expect(material.userData.vertexColorEmissive).toBe(
          vertexColorEmissiveInternalsForTest.programCacheKey,
        );
        const shader = {
          vertexShader: '#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>',
          fragmentShader: '#include <common>\n#include <emissivemap_fragment>',
          uniforms: {},
        };
        material.onBeforeCompile(
          shader as THREE.WebGLProgramParametersWithUniforms,
          null as unknown as THREE.WebGLRenderer,
        );
        expect(shader.fragmentShader).toContain('totalEmissiveRadiance *= vColor;');
        expect(material.customProgramCacheKey()).toContain(
          vertexColorEmissiveInternalsForTest.programCacheKey,
        );
      }
    }
  });

  it('fog-culls and restores all static wall and micro batches without per-frame allocation', () => {
    const view = eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
    const staticBatches = meshesOf(view.group).filter(
      (mesh) => mesh.userData.eastbrookMicroBatch || mesh.userData.eastbrookWallInstances,
    );
    expect(staticBatches).toHaveLength(6);
    view.update(1000, 5, 1000, 1000, 5, 1000, 100);
    expect(staticBatches.every((mesh) => !mesh.visible)).toBe(true);
    view.update(0, 5, 0, 0, 5, 0, 100);
    expect(staticBatches.every((mesh) => mesh.visible)).toBe(true);
  });

  it('returns an empty stable root for custom worlds before asking for any built-in asset source', () => {
    const view = eastbrookTownInternalsForTest.buildFromSources(new Map(), () => 0, false);
    expect(view.group.name).toBe(EASTBROOK_TOWN_ROOT_NAME);
    expect(view.group.children).toEqual([]);
    expect(eastbrookTownDrawStats(view.group)).toMatchObject({
      colorDraws: 0,
      shadowDraws: 0,
      triangles: 0,
      buildingCount: 0,
      microBatchCount: 0,
      wallBatchCount: 0,
    });
    expect(() => view.update(0, 0, 0, 0, 0, 0, 100)).not.toThrow();
  });

  it('recognizes only the exact built-in records replaced by the dedicated renderer', () => {
    for (const building of EASTBROOK_LAYOUT.buildings) {
      const record = BUILTIN_WORLD.props.buildings.find((item) => item.id === building.id);
      if (!record) throw new Error(`missing ${building.id}`);
      expect(isEastbrookRebuildBuilding(record)).toBe(true);
      expect(isEastbrookRebuildBuilding({ ...record, x: record.x + 0.01 })).toBe(false);
    }
    const well = BUILTIN_WORLD.props.wells[0];
    const stall = BUILTIN_WORLD.props.stalls[0];
    const fence = BUILTIN_WORLD.props.fences[0];
    expect(isEastbrookRebuildWell(well)).toBe(true);
    expect(isEastbrookRebuildWell({ ...well, x: well.x + 0.01 })).toBe(false);
    expect(isEastbrookRebuildStall(stall)).toBe(true);
    expect(isEastbrookRebuildStall({ ...stall, rot: stall.rot + 0.01 })).toBe(false);
    expect(
      isEastbrookRebuildStall({
        id: 'eastbrook_market_stall_artisans',
        x: 3.5,
        z: 11.5,
        rot: -2.788602,
        r: Math.hypot(1.4, 1.1),
        w: 2.8,
        d: 2.2,
      }),
    ).toBe(false);
    expect(isEastbrookRebuildFence(fence)).toBe(true);
    expect(isEastbrookRebuildFence({ ...fence, x2: fence.x2 + 0.01 })).toBe(false);
  });

  it('is mounted, updated, and de-duplicated at the renderer integration seam', () => {
    const rendererSource = readFileSync(
      path.join(__dirname, '..', 'src/render/renderer.ts'),
      'utf8',
    );
    expect(rendererSource).toContain('buildEastbrookTownView(this.sim.cfg.seed)');
    expect(rendererSource).toContain("setRenderCategory(this.eastbrookTownView.group, 'props')");
    expect(rendererSource.match(/this\.eastbrookTownView\.update\(/g)).toHaveLength(2);

    const propsSource = readFileSync(path.join(__dirname, '..', 'src/render/props.ts'), 'utf8');
    expect(propsSource).toContain('builtInWorld && isEastbrookRebuildBuilding(b)');
    expect(propsSource).toContain('builtInWorld && isEastbrookRebuildWell(w)');
    expect(propsSource).toContain('builtInWorld && isEastbrookRebuildStall(s)');
    expect(propsSource).toContain('builtInWorld && isEastbrookRebuildFence(f)');

    const view = eastbrookTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
    expect(view.update.toString()).not.toMatch(/\bnew\s+/);
    const townSource = readFileSync(
      path.join(__dirname, '..', 'src/render/eastbrook_town.ts'),
      'utf8',
    );
    expect(townSource).not.toContain('[first, second] = [second, first]');
  });
});

describe('Eastbrook repeated placement triangle budget', () => {
  it('derives the true aggregate from final artifacts and stays under the hard runtime ceiling', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const triangleCountByAsset: Record<string, number> = {};
    for (const assetUrl of EASTBROOK_TOWN_ASSET_URLS) {
      const bytes = readFileSync(path.join(__dirname, '..', 'public', assetUrl.replace(/^\//, '')));
      const document = await io.readBinary(bytes);
      let triangles = 0;
      for (const mesh of document.getRoot().listMeshes()) {
        for (const primitive of mesh.listPrimitives()) {
          const positions = primitive.getAttribute('POSITION');
          if (!positions) throw new Error(`${assetUrl} has no POSITION`);
          triangles += (primitive.getIndices()?.getCount() ?? positions.getCount()) / 3;
        }
      }
      triangleCountByAsset[assetUrl] = triangles;
    }

    const budget = eastbrookTownTriangleBudget(triangleCountByAsset);
    expect(
      Object.fromEntries(budget.assets.map((asset) => [asset.assetUrl, asset.instances])),
    ).toEqual(EASTBROOK_TOWN_ASSET_INSTANCE_COUNTS);
    expect(
      budget.assets.find((asset) => asset.assetUrl.endsWith('eastbrook_market_stall.glb')),
    ).toMatchObject({ instances: 2 });
    expect(
      budget.assets.find((asset) => asset.assetUrl.endsWith('eastbrook_wall_wing.glb')),
    ).toMatchObject({ instances: EASTBROOK_LAYOUT.wall.segments.length });
    expect(budget.maximumFoundationTriangles).toBe(EASTBROOK_LAYOUT.buildings.length * 12);
    expect(budget.assetTriangles).toBe(28_258);
    expect(budget.maximumFoundationTriangles).toBe(72);
    expect(budget.maximumRuntimeTriangles).toBe(
      budget.assetTriangles + budget.maximumFoundationTriangles,
    );
    expect(budget.maximumRuntimeTriangles).toBe(28_330);
    expect(
      budget.maximumRuntimeTriangles,
      JSON.stringify({
        maximumRuntimeTriangles: budget.maximumRuntimeTriangles,
        assets: budget.assets,
      }),
    ).toBeLessThanOrEqual(40_000);
    expect(budget.withinHardCeiling).toBe(true);
    expect(budget.target).toBe(30_000);
    expect(budget.maximumRuntimeTriangles).toBeLessThanOrEqual(budget.target);
    expect(budget.meetsTarget).toBe(true);
  });
});
