import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isPlacedBuildingAsset,
  isPlacedBuildingInterior,
} from '../src/render/eastbrook_placed_building';
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
import { setGpuPrepClockForTest } from '../src/render/gpu_prep_events';
import { interiorCameraInternalsForTest } from '../src/render/interior_camera';
import { setDitherFadeEnabledForTest } from '../src/render/occluder_dither_fade';
import { isOccluderGhostMaterial } from '../src/render/occluder_ghost_variant_key';
import { placedTownCameraInterior } from '../src/render/placed_town_interior_core';
import { questObjectPreloadInternalsForTest } from '../src/render/quest_objects';
import { createRevealGateCore } from '../src/render/reveal_gate_core';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { FENBRIDGE_LAYOUT, localToWorld } from '../src/sim/fenbridge_layout';
import { terrainHeight } from '../src/sim/world';

// This suite pins the BLENDED camera ghost (the transparent flip and its gate);
// the dithered arm is pinned by tests/occluder_dither_fade.test.ts.
beforeEach(() => setDitherFadeEnabledForTest(false));

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

// Added for the painted town (src/render/eastbrook_placed_building.ts, stood
// through buildPlacedTownBuilding): every row of FENBRIDGE_LAYOUT.buildings is
// a PLACED building now, a raw clone of a painted Tidehold model drawn with its
// own materials, so those URLs take this stand-in instead of the template one
// above. It is the shape tests/eastbrook_town_renderer.test.ts stands its own
// placed buildings from, and models what the placed path has to respect:
// - a footing that drops 0.75 below the model's ground line, so the seat rule
//   has a lowest point to rest on the terrain;
// - a shell that sits off the origin on +X and a porch that reaches past it on
//   -Z, so a clone recentred on its wall box or fitted per axis to it measures
//   differently from one stood at its own anchor;
// - two source materials shared the way the shipped models share theirs (the
//   walls on the shell and the porch, the props on the furniture), the walls
//   carrying the model's own colour map;
// - one mesh under a G_INT node, the furniture that never casts a shadow.
const PLACED_FIXTURE_MIN = Object.freeze({ x: -2, y: -0.75, z: -3 });
const PLACED_FIXTURE_MAX = Object.freeze({ x: 4, y: 4.25, z: 2 });
const PLACED_FIXTURE_MESHES = Object.freeze([
  { name: 'shell', material: 'PlacedWalls', castShadow: true },
  { name: 'porch', material: 'PlacedWalls', castShadow: true },
  { name: 'table', material: 'PlacedProps', castShadow: false },
]);
const PLACED_FIXTURE_MESH_NAMES = PLACED_FIXTURE_MESHES.map((mesh) => mesh.name);

function placedSourceAsset(): THREE.Group {
  const source = new THREE.Group();
  const walls = new THREE.MeshStandardMaterial({ color: 0x8899aa, map: new THREE.Texture() });
  walls.name = 'PlacedWalls';
  const shell = new THREE.Mesh(new THREE.BoxGeometry(6, 5, 4).translate(1, 1.75, 0), walls);
  shell.name = 'shell';
  source.add(shell);
  const porch = new THREE.Mesh(new THREE.BoxGeometry(2, 0.5, 1).translate(0, 0.25, -2.5), walls);
  porch.name = 'porch';
  source.add(porch);
  const interior = new THREE.Group();
  interior.name = 'G_INT_furniture';
  const props = new THREE.MeshStandardMaterial({ color: 0x664422 });
  props.name = 'PlacedProps';
  const table = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), props);
  table.name = 'table';
  interior.add(table);
  source.add(interior);
  return source;
}

function fixtureSources(withEmissive = true): Map<string, THREE.Object3D> {
  return new Map(
    FENBRIDGE_TOWN_PROP_ASSET_URLS.map((url) => [
      url,
      isPlacedBuildingAsset(url) ? placedSourceAsset() : sourceAsset(withEmissive),
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

function materialsOf(root: THREE.Object3D): THREE.Material[] {
  return meshesOf(root).flatMap((mesh) =>
    Array.isArray(mesh.material) ? mesh.material : [mesh.material],
  );
}

function trianglesOf(root: THREE.Object3D): number {
  return meshesOf(root).reduce(
    (sum, mesh) =>
      sum + (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3,
    0,
  );
}

type FenbridgeBuilding = (typeof FENBRIDGE_LAYOUT.buildings)[number];

function buildingGroup(root: THREE.Object3D, id: string): THREE.Group {
  const group = root.getObjectByName(`fenbridgeBuilding:${id}`);
  if (!(group instanceof THREE.Group)) throw new Error(`renderer fixture lost ${id}`);
  return group;
}

type Rect = {
  center: { x: number; z: number };
  rotation: number;
  halfWidth: number;
  halfDepth: number;
};

/** A world point given in a rectangle's own axes (the layout's yaw rule). */
function pointIn(rect: Rect, localX: number, localZ: number): { x: number; z: number } {
  return localToWorld(rect.center, rect.rotation, localX, localZ);
}

/** Whether a world point lies strictly inside a rectangle (its inverse yaw). */
function insideRect(rect: Rect, point: { x: number; z: number }): boolean {
  const dx = point.x - rect.center.x;
  const dz = point.z - rect.center.z;
  const cos = Math.cos(rect.rotation);
  const sin = Math.sin(rect.rotation);
  return (
    Math.abs(dx * cos - dz * sin) < rect.halfWidth && Math.abs(dx * sin + dz * cos) < rect.halfDepth
  );
}

/** The four corners of a building's reach, each pulled `inset` yards toward
 *  its centre along both of the reach's axes. */
function reachCorners(building: FenbridgeBuilding, inset = 0): { x: number; z: number }[] {
  const { reach } = building;
  return [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ].map(([signX, signZ]) =>
    pointIn(reach, signX * (reach.halfWidth - inset), signZ * (reach.halfDepth - inset)),
  );
}

/** Every `left = right` assignment in a source file as code, whitespace
 *  folded: comments are trivia to the parser, so a pin on this list can only
 *  be met by code, never by a comment that quotes it. */
function assignmentsIn(relativePath: string): string[] {
  const text = readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
  const source = ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      found.push(
        `${node.left.getText(source)} = ${node.right.getText(source)}`.replace(/\s+/g, ' '),
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Every mesh the five painted buildings draw; the rest of the root is batches. */
function buildingMeshSet(root: THREE.Object3D): Set<THREE.Mesh> {
  return new Set(
    FENBRIDGE_LAYOUT.buildings.flatMap((building) => meshesOf(buildingGroup(root, building.id))),
  );
}

/** Colour draws and shadow casters, split between the painted buildings and
 *  the template batches (fenbridgeTownDrawStats counts them the same way). */
function townDrawSplit(root: THREE.Object3D) {
  const buildingMeshes = buildingMeshSet(root);
  const split = { batchColor: 0, batchShadow: 0, buildingColor: 0, buildingShadow: 0 };
  for (const mesh of meshesOf(root)) {
    const draws = Array.isArray(mesh.material) ? mesh.material.length : 1;
    if (buildingMeshes.has(mesh)) {
      split.buildingColor += draws;
      if (mesh.castShadow) split.buildingShadow++;
    } else {
      split.batchColor += draws;
      if (mesh.castShadow) split.batchShadow++;
    }
  }
  return split;
}

/**
 * What the placed path (src/render/eastbrook_placed_building.ts) guarantees
 * for one Fenbridge row stood from the fixture above, where the template path
 * gave a vertex-colour shell on the town atlas and a foundation skirt: the
 * group stands at the model's own ANCHOR and turn (never recentred on the wall
 * box), at ONE uniform scale (never fitted per axis to nativeDimensions),
 * seated by the model's lowest point on the ground under that anchor and sunk
 * by the authored lift, so the footing is buried and no skirt is drawn. Every
 * mesh draws its own clone of its source material, carrying the model's own
 * map and vertex-colour setting (never the town atlas) and a camera-fade
 * record; the furniture under a G_INT node never casts. Returns the materials.
 */
function expectPlacedBuilding(
  root: THREE.Object3D,
  building: FenbridgeBuilding,
  source: THREE.Object3D,
  groundAt: (x: number, z: number) => number,
  materialType: 'MeshStandardMaterial' | 'MeshLambertMaterial',
): THREE.Material[] {
  const { id, placement } = building;
  const group = buildingGroup(root, id);
  expect(group.position.x, `${id} anchor x`).toBe(placement.x);
  expect(group.position.z, `${id} anchor z`).toBe(placement.z);
  expect(group.rotation.y, `${id} turn`).toBe(placement.rotation);
  const anchorY = groundAt(placement.x, placement.z);
  expect(group.position.y, `${id} seat`).toBeCloseTo(
    anchorY - PLACED_FIXTURE_MIN.y * placement.scale + placement.lift,
    10,
  );
  // The model's lowest point rests the lift below the ground under its anchor.
  expect(placement.lift, `${id} lift buries the footing`).toBeLessThan(0);
  expect(group.position.y + PLACED_FIXTURE_MIN.y * placement.scale, `${id} footing`).toBeCloseTo(
    anchorY + placement.lift,
    10,
  );
  expect(group.userData).toMatchObject({
    fenbridgeBuildingId: id,
    placementId: id,
    assetUrl: building.assetId,
    foundationDepth: 0,
  });
  expect(group.userData.placement).toBe(placement);
  expect(group.userData.target).toBe(building.nativeDimensions);
  // One wrap carrying the uniform scale, one clone inside it, nothing else: a
  // skirt would be a second child of the group.
  expect(group.children, `${id} group children`).toHaveLength(1);
  const wrap = group.children[0];
  expect(wrap.scale.toArray(), `${id} uniform scale`).toEqual([
    placement.scale,
    placement.scale,
    placement.scale,
  ]);
  expect(wrap.children, `${id} wrap children`).toHaveLength(1);
  expect(wrap.children[0].position.toArray(), `${id} clone offset`).toEqual([0, 0, 0]);
  // Measured on a parentless clone, so the wrap's own transform is the whole
  // chain: the model's own bounds at the placed scale, off-centre on X and
  // with its footing below the wrap's y 0.
  const bounds = new THREE.Box3().setFromObject(wrap.clone(true));
  for (const axis of ['x', 'y', 'z'] as const) {
    expect(bounds.min[axis], `${id} min ${axis}`).toBeCloseTo(
      PLACED_FIXTURE_MIN[axis] * placement.scale,
      5,
    );
    expect(bounds.max[axis], `${id} max ${axis}`).toBeCloseTo(
      PLACED_FIXTURE_MAX[axis] * placement.scale,
      5,
    );
  }
  const sourceByName = new Map(materialsOf(source).map((material) => [material.name, material]));
  const meshes = meshesOf(group);
  expect(
    meshes.map((mesh) => mesh.name),
    id,
  ).toEqual(PLACED_FIXTURE_MESH_NAMES);
  return meshes.map((mesh, index) => {
    const expected = PLACED_FIXTURE_MESHES[index];
    const label = `${id} ${mesh.name}`;
    expect(Array.isArray(mesh.material), label).toBe(false);
    const material = mesh.material as THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;
    const from = sourceByName.get(expected.material) as THREE.MeshStandardMaterial;
    expect(material.type, label).toBe(materialType);
    expect(material.name, label).toBe(expected.material);
    expect(material, `${label} is a clone`).not.toBe(from);
    expect(material.map, `${label} map`).toBe(from.map);
    expect(material.vertexColors, `${label} vertex colours`).toBe(from.vertexColors);
    expect(isOccluderGhostMaterial(material), `${label} fade record`).toBe(true);
    expect(mesh.castShadow, `${label} casts`).toBe(expected.castShadow);
    expect(mesh.receiveShadow, `${label} receives`).toBe(true);
    return material;
  });
}

function shippedGlbBytes(assetUrl: string): Uint8Array {
  return readFileSync(path.join(__dirname, '..', 'public', assetUrl.replace(/^\//, '')));
}

async function parseGlb(bytes: Uint8Array): Promise<THREE.Group> {
  await MeshoptDecoder.ready;
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return await new Promise<THREE.Group>((resolve, reject) => {
    loader.parse(arrayBuffer, '', (gltf) => resolve(gltf.scene), reject);
  });
}

async function loadRuntimeGlb(assetUrl: string): Promise<THREE.Group> {
  return parseGlb(shippedGlbBytes(assetUrl));
}

let shippedIo: NodeIO | null = null;
async function shippedGlbIo(): Promise<NodeIO> {
  await MeshoptDecoder.ready;
  shippedIo ??= new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  return shippedIo;
}

/** A shipped GLB's triangles, counted off the file with gltf-transform (the
 *  way tests/eastbrook_town_renderer.test.ts counts its painted buildings). */
async function shippedTriangles(assetUrl: string): Promise<number> {
  const document = await (await shippedGlbIo()).readBinary(shippedGlbBytes(assetUrl));
  let triangles = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const positions = primitive.getAttribute('POSITION');
      if (!positions) throw new Error(`${assetUrl} has no POSITION`);
      triangles += (primitive.getIndices()?.getCount() ?? positions.getCount()) / 3;
    }
  }
  return triangles;
}

/**
 * A painted building's shipped GLB as three's GLTFLoader parses it, less its
 * maps. The painted models carry KTX2 textures (KHR_texture_basisu), which
 * three's loader refuses in Node without a transcoder, so gltf-transform drops
 * the textures and writes the file back plain (its meshopt streams were decoded
 * on read). Every node, mesh, primitive, material and triangle is the shipped
 * file's, and a draw or triangle total reads nothing else.
 */
async function loadShippedGlbWithoutMaps(assetUrl: string): Promise<THREE.Group> {
  const io = await shippedGlbIo();
  const document = await io.readBinary(shippedGlbBytes(assetUrl));
  const root = document.getRoot();
  for (const texture of root.listTextures()) texture.dispose();
  for (const extension of root.listExtensionsUsed()) {
    const name = extension.extensionName;
    if (name === 'KHR_texture_basisu' || name === 'EXT_meshopt_compression') extension.dispose();
  }
  return parseGlb(await io.writeBinary(document));
}

afterEach(() => {
  setGfx(ORIGINAL_GFX);
  setActiveWorldContent(null);
  setGpuPrepClockForTest(null);
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
  it('reserves no foundation triangles for the placed buildings and holds the 88k runtime ceiling exactly', () => {
    // Re-pinned for the painted town: five placed Tidehold buildings replaced
    // the seven template shells (src/render/eastbrook_placed_building.ts). A
    // template shell seated at its entrance grade and closed the gap to the
    // lowest ground under its wall box with a 12-triangle skirt, which the
    // budget reserved per building (7 * 12 = 84). A placed building buries its
    // model's own footing and draws no skirt, so the reserve counts only the
    // rows that are NOT placed, and Fenbridge has none: the boundary is the
    // hard ceiling itself.
    expect(FENBRIDGE_LAYOUT.buildings).toHaveLength(5);
    expect(
      FENBRIDGE_LAYOUT.buildings.filter((building) => !isPlacedBuildingAsset(building.assetId)),
    ).toEqual([]);
    const exactBoundaryCounts = Object.fromEntries(
      FENBRIDGE_TOWN_ASSET_URLS.map((assetUrl) => [assetUrl, 0]),
    );
    exactBoundaryCounts[FENBRIDGE_TOWN_ASSET_URLS[0]] = 88_000;

    const budget = fenbridgeTownTriangleBudget(exactBoundaryCounts);
    expect(budget.maximumFoundationTriangles).toBe(0);
    expect(budget.assetTriangles).toBe(88_000);
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
    // A prop the town still extracts (the painted buildings never take this
    // path: they are stood raw, see expectPlacedBuilding).
    const template = fenbridgeTownInternalsForTest.extractTemplate(
      source,
      FENBRIDGE_LAYOUT.civic.cistern.assetId,
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
    // Every asset's triangles, counted off the shipped file itself.
    const triangleCountByAsset: Record<string, number> = {};
    for (const assetUrl of FENBRIDGE_TOWN_ASSET_URLS) {
      triangleCountByAsset[assetUrl] = await shippedTriangles(assetUrl);
    }
    // The sources the town stands, from the shipped files: each template prop
    // as three parses it, each painted building as three parses it less its
    // KTX2 maps (loadShippedGlbWithoutMaps). Either way three holds exactly
    // the file's triangles, so the totals below are the shipped town's own.
    const sources = new Map<string, THREE.Object3D>();
    for (const assetUrl of FENBRIDGE_TOWN_PROP_ASSET_URLS) {
      const source = isPlacedBuildingAsset(assetUrl)
        ? await loadShippedGlbWithoutMaps(assetUrl)
        : await loadRuntimeGlb(assetUrl);
      expect(trianglesOf(source), assetUrl).toBe(triangleCountByAsset[assetUrl]);
      sources.set(assetUrl, source);
    }
    const questSource = await loadRuntimeGlb(fenbridgeTownInternalsForTest.questAssetUrl);
    const questTriangles = trianglesOf(questSource);
    const questDraws = meshesOf(questSource).reduce(
      (sum, mesh) => sum + (Array.isArray(mesh.material) ? mesh.material.length : 1),
      0,
    );
    expect({ questTriangles, questDraws }).toEqual({ questTriangles: 204, questDraws: 1 });
    expect(triangleCountByAsset[fenbridgeTownInternalsForTest.questAssetUrl]).toBe(questTriangles);

    // Re-pinned for the painted town: five placed Tidehold buildings in the
    // Fenrire look (src/render/eastbrook_placed_building.ts) replaced the seven
    // template shells, one instance each. Keyed by row, not by file, because a
    // look re-bakes a model's maps on the same geometry.
    expect(
      Object.fromEntries(
        FENBRIDGE_LAYOUT.buildings.map((building) => [
          building.id,
          triangleCountByAsset[building.assetId],
        ]),
      ),
    ).toEqual({
      fenbridge_warden_gatehouse: 1_663,
      fenbridge_crooked_reed_inn: 12_844,
      fenbridge_lantern_chapel: 3_857,
      fenbridge_moonwort_apothecary: 5_433,
      fenbridge_gilded_strongbox: 7_210,
    });
    const budget = fenbridgeTownTriangleBudget(triangleCountByAsset);
    const shareOf = (placed: boolean): number =>
      budget.assets
        .filter((asset) => isPlacedBuildingAsset(asset.assetUrl) === placed)
        .reduce((sum, asset) => sum + asset.repeatedTriangles, 0);
    // The seven template shells' 53_852 triangles left and the painted models'
    // 31_007 arrived (furniture included), and the boardwalks went 12 to 10
    // (-752), so the whole town moved 80_344 to 56_747. Re-pinned for the
    // open town: the 16 palisade wings (766 each, -12_256) and the 4 gate
    // arches (1_216 each, -4_864) came down with the ring, so the legacy
    // family goes 25_740 to 8_620 and the whole town 56_747 to 39_627. The
    // legacy-family share is the sibling of tests/fenbridge_town_assets.test.ts
    // EXPECTED_TOTALS.townPlacementTriangles; move both together. The skirt
    // reserve stays 0 (see the reserve test above).
    expect({ legacyFamily: shareOf(false), paintedBuildings: shareOf(true) }).toEqual({
      legacyFamily: 8_620,
      paintedBuildings: 31_007,
    });
    expect(budget).toMatchObject({
      assetTriangles: 39_627,
      maximumFoundationTriangles: 0,
      maximumRuntimeTriangles: 39_627,
      hardCeiling: 88_000,
      withinHardCeiling: true,
    });
    // The budget no longer carries either ring model at all.
    expect(budget.assets.map((asset) => asset.assetUrl)).not.toContain(
      '/models/props/fenbridge_palisade_wing.glb',
    );
    expect(budget.assets.map((asset) => asset.assetUrl)).not.toContain(
      '/models/props/fenbridge_gate_arch.glb',
    );

    // The shipped models' furniture: every mesh under a G_INT node, which
    // never casts.
    const interiorMeshes = FENBRIDGE_LAYOUT.buildings.reduce((sum, building) => {
      const source = sources.get(building.assetId);
      if (!source) throw new Error(`missing shipped source for ${building.id}`);
      return sum + meshesOf(source).filter((mesh) => isPlacedBuildingInterior(mesh)).length;
    }, 0);
    expect(interiorMeshes).toBe(15);

    const ground = (x: number, z: number): number => terrainHeight(x, z, 20_061);
    setGfx({ standardMaterials: true, dynamicShadows: true, surfaceDetail: false, composer: true });
    const standard = fenbridgeTownInternalsForTest.buildFromSources(sources, ground, true);
    const standardRoot = fenbridgeTownDrawStats(standard.group);
    expect(standard.group.userData.triangleStats).toMatchObject({
      scope: 'fenbridge-town-render-root-only',
      emittedFoundationTriangles: 0,
      includesQuestObjects: false,
    });
    // Re-pinned for the painted town: a placed building draws every mesh of its
    // model on its own material, so the seven shells' 14 draws (one opaque and
    // one emissive pass each) become the five models' 72 meshes, 57 of them
    // casting (all but the 15 furniture meshes). Colour went 20 to 78, shadow
    // 10 to 60.
    // Re-pinned for the open town: the palisade's opaque pass and the gate
    // arch's opaque and emissive passes left with the ring (two of them
    // casting), so the template batches are 3 colour draws (the micro batch's
    // opaque and emissive passes, the boardwalk's opaque one) and 1 shadow
    // draw (only the micro batch's opaque pass casts). Colour 78 to 75, shadow
    // 60 to 58, triangles 56_339 to 39_219.
    expect(standardRoot).toMatchObject({ colorDraws: 75, shadowDraws: 58, triangles: 39_219 });
    expect(townDrawSplit(standard.group)).toEqual({
      batchColor: 3,
      batchShadow: 1,
      buildingColor: 72,
      buildingShadow: 72 - interiorMeshes,
    });
    // Every triangle the root draws is shipped geometry: the whole budget less
    // the muster orders the quest renderer draws, with no skirt anywhere.
    expect(standardRoot.triangles).toBe(
      budget.assetTriangles - questTriangles * FENBRIDGE_LAYOUT.repeated.musterOrders.length,
    );
    expect({
      colorDraws: standardRoot.colorDraws + questDraws * 2,
      shadowDraws: standardRoot.shadowDraws,
      triangles: standardRoot.triangles + questTriangles * 2,
    }).toEqual({ colorDraws: 77, shadowDraws: 58, triangles: 39_627 });

    setGfx({
      standardMaterials: false,
      dynamicShadows: false,
      surfaceDetail: false,
      composer: false,
    });
    const low = fenbridgeTownInternalsForTest.buildFromSources(sources, ground, true);
    const lowRoot = fenbridgeTownDrawStats(low.group);
    // Re-pinned for the painted town: Low still folds every batch's glow into
    // one Lambert pass per placement class, and the painted models keep all 72
    // of their meshes on their own Lambert clones. The buildings' 57 cast
    // flags are their own on every tier (src/render/eastbrook_placed_building.ts,
    // as in Eastbrook's town and on an authored map) and inert on Low, where
    // the renderer turns the shadow map off: see the Low silhouette test below.
    // Re-pinned for the open town: the palisade and gate-arch classes left
    // with the ring, so the batches are 2 Lambert passes (the micro batch and
    // the boardwalk, no caster) and colour goes 76 to 74.
    expect(lowRoot).toMatchObject({ colorDraws: 74, shadowDraws: 57, triangles: 39_219 });
    expect(townDrawSplit(low.group)).toEqual({
      batchColor: 2,
      batchShadow: 0,
      buildingColor: 72,
      buildingShadow: 72 - interiorMeshes,
    });
    expect(lowRoot.colorDraws + questDraws * 2).toBe(76);
    // The Low draw ceiling, re-set for the painted town and again for the
    // open one. The template town held Low under 16 draws: one Lambert pass
    // per building and per placement class. A painted building draws its
    // model's own materials on every tier (72 meshes over the five shipped
    // models), so the ceiling is those meshes plus the two batch passes left
    // once the ring came down. A model that gains a mesh, or a batch that
    // stops folding its glow into its colour pass, crosses it and has to move
    // it on purpose.
    const LOW_TOWN_COLOR_DRAW_CEILING = 74;
    expect(lowRoot.colorDraws).toBeLessThanOrEqual(LOW_TOWN_COLOR_DRAW_CEILING);
  });

  it('builds the exact live inventory with Standard PBR batches and painted buildings in their own materials', () => {
    setGfx({ standardMaterials: true, dynamicShadows: true, surfaceDetail: false, composer: true });
    const atlas = new THREE.Texture();
    const normal = new THREE.Texture();
    const roughness = new THREE.Texture();
    const ground = (x: number, z: number): number => 1.2 + x * 0.01 - z * 0.002;
    const sources = fixtureSources();
    const view = fenbridgeTownInternalsForTest.buildFromSources(sources, ground, true, {
      atlas,
      normal,
      roughness,
    });

    expect(view.group.name).toBe(FENBRIDGE_TOWN_ROOT_NAME);
    expect(view.group.userData.layoutId).toBe(FENBRIDGE_LAYOUT.id);
    expect(view.group.userData.placementIds).toEqual(FENBRIDGE_TOWN_REQUIRED_PLACEMENT_IDS);
    expect(view.group.userData.assetPlacementCounts).toEqual(FENBRIDGE_TOWN_ASSET_PLACEMENT_COUNTS);
    expect(view.group.userData.assetUrls).toEqual(FENBRIDGE_TOWN_ASSET_URLS);
    // Re-pinned for the painted town: five placed Tidehold buildings replaced
    // the seven template shells (the tannery and the scout lodge are gone),
    // and every one of them is still a camera-fade target.
    expect(FENBRIDGE_LAYOUT.buildings).toHaveLength(5);
    expect(view.group.userData.buildingFadeTargetCount).toBe(5);
    expect(view.group.userData.triangleStats).toMatchObject({
      scope: 'fenbridge-town-render-root-only',
      includesQuestObjects: false,
      informationalOnly: true,
    });
    expect(view.group.userData.triangleStats).not.toHaveProperty('withinHardCeiling');

    const stats = fenbridgeTownDrawStats(view.group);
    // Re-pinned for the painted town: each building's opaque and emissive
    // template pass (14 draws, 7 casting) became the fixture's three meshes
    // on their own materials (15 draws, the 10 exterior ones casting). The
    // boardwalks went 12 to 10. Re-pinned for the open town: the palisade and
    // gate-arch classes left with the ring, so the batches are one opaque and
    // one emissive pass for each of the two classes left (4), and only the
    // micro batch's opaque pass casts (1): colour 23 to 19, shadow 13 to 11.
    // These are the FIXTURE's numbers; the shipped totals are pinned in the
    // shipping-GLB test above.
    expect(stats).toMatchObject({
      colorDraws: 19,
      shadowDraws: 11,
      buildingCount: 5,
      buildingFadeTargetCount: 5,
      microBatchCount: 2,
      repeatedBatchCount: 2,
      boardwalkCount: 10,
    });
    // ...and the stats carry no wall-segment or gate count any more.
    expect(stats).not.toHaveProperty('wallSegmentCount');
    expect(stats).not.toHaveProperty('gateCount');
    expect(townDrawSplit(view.group)).toEqual({
      batchColor: 4,
      batchShadow: 1,
      buildingColor: 15,
      buildingShadow: 10,
    });
    // No palisade or gate-arch mesh is built: the repeated batches are the
    // boardwalk's two passes and nothing else.
    expect(view.group.userData.repeatedBatchNames).toEqual([
      'fenbridgeTownBoardwalkOpaqueInstances',
      'fenbridgeTownBoardwalkEmissiveInstances',
    ]);
    expect(view.group.getObjectByName('fenbridgeTownPalisadeOpaqueInstances')).toBeUndefined();
    expect(view.group.getObjectByName('fenbridgeTownGateArchOpaqueInstances')).toBeUndefined();
    expect(FENBRIDGE_TOWN_ASSET_PLACEMENT_COUNTS).toEqual({
      fenbridge_boardwalk: 10,
      fenbridge_muster_order: 2,
    });

    // The Standard PBR maps are the batches' alone: the painted buildings
    // carry their own (below).
    const buildingMeshes = buildingMeshSet(view.group);
    const materials = meshesOf(view.group)
      .filter((mesh) => !buildingMeshes.has(mesh))
      .map((mesh) => mesh.material as THREE.Material);
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
      fenbridge_boardwalk: FENBRIDGE_TOWN_ASSET_PLACEMENT_COUNTS.fenbridge_boardwalk,
    });
    const orderEvidence = view.group.getObjectByName('fenbridgeMusterOrderPlacements');
    expect(orderEvidence?.userData.noDuplicateTownMesh).toBe(true);
    expect(meshesOf(orderEvidence as THREE.Object3D)).toHaveLength(0);

    // Re-staged for the painted town: a template shell was seated at its
    // entrance grade on the town atlas with a skirt under it; every row now
    // takes the placed path (expectPlacedBuilding), seated by its own anchor
    // on this sloped ground.
    const placedMaterials = FENBRIDGE_LAYOUT.buildings.flatMap((building) => {
      const source = sources.get(building.assetId);
      if (!source) throw new Error(`missing fixture source for ${building.id}`);
      return expectPlacedBuilding(view.group, building, source, ground, 'MeshStandardMaterial');
    });
    // No material is shared inside a building or across buildings, and none
    // of them reads a town map.
    expect(new Set(placedMaterials).size).toBe(15);
    for (const material of placedMaterials as THREE.MeshStandardMaterial[]) {
      expect([atlas, normal, roughness]).not.toContain(material.map);
      expect([atlas, normal, roughness]).not.toContain(material.normalMap);
      expect([atlas, normal, roughness]).not.toContain(material.roughnessMap);
    }
  });

  it('keeps Low silhouette-complete with one Lambert pass per placement class and no shadow pass', () => {
    setGfx({
      standardMaterials: false,
      dynamicShadows: false,
      surfaceDetail: false,
      composer: false,
    });
    const atlas = new THREE.Texture();
    const normal = new THREE.Texture();
    const roughness = new THREE.Texture();
    const ground = (): number => 1.2;
    const sources = fixtureSources();
    const view = fenbridgeTownInternalsForTest.buildFromSources(sources, ground, true, {
      atlas,
      normal,
      roughness,
    });
    const stats = fenbridgeTownDrawStats(view.group);
    // Re-pinned for the painted town: the seven template shells drew one
    // Lambert pass each, holding the town to 11 draws under its 16-draw Low
    // cap. The five placed buildings draw their model's own meshes on every
    // tier (the fixture's three each). Re-pinned for the open town: the
    // palisade and gate-arch classes left with the ring, so the town is 17
    // draws on Low: the batches' one pass per placement class (2) plus the
    // buildings' 15. The shipped models' count is pinned in the shipping-GLB
    // test above.
    expect(stats.colorDraws).toBe(17);
    expect(townDrawSplit(view.group)).toEqual({
      batchColor: 2,
      batchShadow: 0,
      buildingColor: 15,
      buildingShadow: 10,
    });
    // Low folds every batch's glow into its colour pass: exactly one Lambert
    // batch per placement class, no emissive batch at all.
    const buildingMeshes = buildingMeshSet(view.group);
    const batches = meshesOf(view.group).filter((mesh) => !buildingMeshes.has(mesh));
    expect(batches.map((mesh) => mesh.name)).toEqual([
      'fenbridgeTownMicroOpaqueBatch',
      'fenbridgeTownBoardwalkOpaqueInstances',
    ]);
    // No shadow pass on Low. No batch casts, and the shadow draws counted here
    // are the buildings' own exterior meshes, whose cast flags the placed path
    // sets on every tier (as Eastbrook's town and an authored map do). They
    // are inert on Low, and that rests on the code, not on the forced setGfx
    // above: the Low tier's own settings turn dynamic shadows off whatever its
    // shadow-quality dial says (gfx.ts settingsFor), and the renderer turns
    // its shadow map on or off from that one switch (renderer.ts).
    expect(stats.shadowDraws).toBe(10);
    expect(batches.every((mesh) => !mesh.castShadow)).toBe(true);
    const desktop = {
      search: '',
      maxTouchPoints: 0,
      coarsePointer: false,
      narrowViewport: false,
      deviceMemory: 16,
    };
    for (const shadowQuality of [0, 0.5, 1]) {
      expect(
        gfxInternalsForTest.settingsFor('low', { ...desktop, shadowQuality }).dynamicShadows,
        `Low at shadow quality ${shadowQuality}`,
      ).toBe(false);
    }
    // On the same device a tier that keeps its shadows reads true, so the pin
    // above is not one every tier would pass.
    expect(gfxInternalsForTest.settingsFor('medium', desktop).dynamicShadows).toBe(true);
    expect(assignmentsIn('src/render/renderer.ts')).toContain(
      'this.webgl.shadowMap.enabled = GFX.dynamicShadows',
    );
    const materials = meshesOf(view.group).map((mesh) => mesh.material as THREE.Material);
    expect(materials.every((material) => material instanceof THREE.MeshLambertMaterial)).toBe(true);
    expect(
      batches.every((mesh) => (mesh.material as THREE.MeshLambertMaterial).map === atlas),
    ).toBe(true);
    expect(materials.every((material) => material.vertexColors === false)).toBe(true);
    // The buildings take Lambert clones carrying their own maps, never the atlas.
    for (const building of FENBRIDGE_LAYOUT.buildings) {
      const source = sources.get(building.assetId);
      if (!source) throw new Error(`missing fixture source for ${building.id}`);
      expectPlacedBuilding(view.group, building, source, ground, 'MeshLambertMaterial');
    }
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
      const ground = (): number => 1.2;
      const sources = fixtureSources();
      const view = fenbridgeTownInternalsForTest.buildFromSources(sources, ground, true, {
        atlas: undefined,
        normal: undefined,
        roughness: undefined,
      });
      const buildingMeshes = buildingMeshSet(view.group);
      const townMaterials = meshesOf(view.group)
        .filter((mesh) => !buildingMeshes.has(mesh))
        .map((mesh) => mesh.material as THREE.Material);
      expect(townMaterials.length).toBeGreaterThan(0);
      for (const material of townMaterials) {
        const surface = material as THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;
        expect(surface.map).toBeNull();
        expect(surface.vertexColors).toBe(true);
      }
      // Re-staged for the painted town: the placed buildings never read the
      // town atlas (their colour is the painted model's own map), so an atlas
      // failure leaves each one exactly as authored, own map and own
      // vertex-colour setting, where a template shell fell back to COLOR_0.
      for (const building of FENBRIDGE_LAYOUT.buildings) {
        const source = sources.get(building.assetId);
        if (!source) throw new Error(`missing fixture source for ${building.id}`);
        expectPlacedBuilding(
          view.group,
          building,
          source,
          ground,
          standard ? 'MeshStandardMaterial' : 'MeshLambertMaterial',
        );
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

  it('footprint-seats and pitches the thin boardwalk instances on production terrain', () => {
    // Re-staged for the open town: the gate arches this test seated beside
    // the boardwalks came down with the ring.
    setGfx({ standardMaterials: false, dynamicShadows: false, surfaceDetail: false });
    const ground = (x: number, z: number): number => terrainHeight(x, z, 20_061);
    const view = fenbridgeTownInternalsForTest.buildFromSources(
      fixtureSources(false),
      ground,
      true,
    );
    const mesh = view.group.getObjectByName('fenbridgeTownBoardwalkOpaqueInstances');
    expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
    const instances = mesh as THREE.InstancedMesh;
    const placements = FENBRIDGE_LAYOUT.repeated.boardwalks;
    expect(instances.count).toBe(placements.length);
    let nonCenterSeated = 0;
    for (let index = 0; index < placements.length; index++) {
      const placement = placements[index];
      const expected = fenbridgeTownInternalsForTest.pitchedFootprintPlacement(
        placement.position,
        placement.rotation,
        placement.nativeDimensions.width,
        placement.nativeDimensions.depth,
        ground,
      );
      const matrix = new THREE.Matrix4();
      instances.getMatrixAt(index, matrix);
      // Instanced matrices are uploaded/stored as Float32 values.
      expect(matrix.elements[12]).toBeCloseTo(expected.centerX, 4);
      expect(matrix.elements[13]).toBeCloseTo(expected.centerY, 4);
      expect(matrix.elements[14]).toBeCloseTo(expected.centerZ, 4);
      if (Math.abs(expected.centerY - ground(placement.position.x, placement.position.z)) > 1e-4) {
        nonCenterSeated++;
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
    // Added for the painted town: a placed building collides on its wall box
    // AND on each solid part outside it (a bell tower, a turret, a stall
    // counter), so the overlay records every one of those boxes, not just the
    // footprint.
    const buildingBoxes = FENBRIDGE_LAYOUT.buildings.flatMap((building) => [
      building.footprint,
      ...building.annexes,
    ]);
    expect(buildingBoxes.length).toBeGreaterThan(FENBRIDGE_LAYOUT.buildings.length);
    for (const box of buildingBoxes) {
      expect(
        overlay.userData.captureRecords.colliders.filter(
          (record: { id?: string }) => record.id === box.id,
        ),
        box.id,
      ).toEqual([
        {
          kind: 'obb',
          id: box.id,
          center: box.center,
          halfWidth: box.halfWidth,
          halfDepth: box.halfDepth,
          rotation: box.rotation,
        },
      ]);
    }
    const musterBoard = BUILTIN_WORLD.services?.musterBoards?.[0];
    expect(musterBoard).toBeDefined();
    // Re-pinned for the open town: the complete collider evidence is the
    // buildings' boxes, the cistern, the stall and the muster board. The
    // sixteen palisade wings and eight gate jambs it used to outline came down
    // with the ring.
    expect(
      overlay.userData.captureRecords.colliders.map((record: { id?: string }) => record.id),
    ).toEqual([
      ...buildingBoxes.map((box) => box.id),
      FENBRIDGE_LAYOUT.civic.cistern.id,
      FENBRIDGE_LAYOUT.civic.provisionStall.id,
      musterBoard?.id,
    ]);
    expect(overlay.userData.recordCounts.colliders).toBe(buildingBoxes.length + 3);
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

  it('stands the square dressing down for a document that owns it as placements', () => {
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      placements: [],
      promotedScenery: { authoredTownDressing: true },
    });
    try {
      const view = fenbridgeTownInternalsForTest.buildFromSources(
        fixtureSources(),
        () => 1.2,
        true,
      );
      // the cistern, the provision stall and the muster board are the whole
      // micro batch, and the boardwalk planks their own instanced set
      for (const name of [
        'fenbridgeTownMicroOpaqueBatch',
        'fenbridgeTownMicroEmissiveBatch',
        'fenbridgeTownBoardwalkOpaqueInstances',
        'fenbridgeTownBoardwalkEmissiveInstances',
      ]) {
        expect(view.group.getObjectByName(name), name).toBeUndefined();
      }
    } finally {
      setActiveWorldContent(null);
    }
    const shipped = fenbridgeTownInternalsForTest.buildFromSources(
      fixtureSources(),
      () => 1.2,
      true,
    );
    expect(shipped.group.getObjectByName('fenbridgeTownMicroOpaqueBatch')).toBeInstanceOf(
      THREE.Mesh,
    );
    expect(shipped.group.getObjectByName('fenbridgeTownBoardwalkOpaqueInstances')).toBeInstanceOf(
      THREE.InstancedMesh,
    );
  });

  it('keeps the indoor camera to every walk-in building it stands, and drops the rooms with it', () => {
    // each walk-in painted building registers its air (placed_town_interiors.ts), stood on the
    // ground the view stands its building on (a slope, so a wrong anchor reads differently)
    const ground = (x: number, z: number) => 1.2 + 0.03 * x - 0.02 * z;
    const rooms = () => interiorCameraInternalsForTest.interiors();
    const walkIn = FENBRIDGE_LAYOUT.buildings.filter((building) => building.walkIn);
    expect(walkIn.length).toBeGreaterThan(1);
    interiorCameraInternalsForTest.reset();
    try {
      fenbridgeTownInternalsForTest.buildFromSources(fixtureSources(), ground, true);
      expect(rooms().map((room) => room.id)).toEqual(
        walkIn.map((building) => `placed_town:${building.id}`),
      );
      for (const [index, building] of walkIn.entries()) {
        expect(rooms()[index], building.id).toEqual(
          placedTownCameraInterior(building, ground(building.placement.x, building.placement.z)),
        );
      }
      // a rebuild replaces them, never doubles them
      fenbridgeTownInternalsForTest.buildFromSources(fixtureSources(), ground, true);
      expect(rooms()).toHaveLength(walkIn.length);
      // a document that owns the buildings as placements keeps no town air
      setActiveWorldContent({
        ...BUILTIN_WORLD,
        placements: [],
        promotedScenery: { authoredTowns: true },
      });
      try {
        fenbridgeTownInternalsForTest.buildFromSources(fixtureSources(), ground, true);
        expect(rooms()).toEqual([]);
      } finally {
        setActiveWorldContent(null);
      }
      // ...nor does a world without the town
      fenbridgeTownInternalsForTest.buildFromSources(fixtureSources(), ground, true);
      expect(rooms()).toHaveLength(walkIn.length);
      fenbridgeTownInternalsForTest.buildFromSources(new Map(), () => 0, false);
      expect(rooms()).toEqual([]);
    } finally {
      interiorCameraInternalsForTest.reset();
    }
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

  it('holds the buildings with the static batches on a walking approach until the gate settles', () => {
    setGfx({ standardMaterials: false, dynamicShadows: false, surfaceDetail: false });
    const view = fenbridgeTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
    const requested: string[] = [];
    const gate = createRevealGateCore((key) => requested.push(key));
    view.setRevealGate(gate);
    const buildingGroups = FENBRIDGE_LAYOUT.buildings.map((building) => {
      const group = view.group.getObjectByName(`fenbridgeBuilding:${building.id}`);
      if (!group) throw new Error(`renderer fixture lost ${building.id}`);
      return group;
    });
    const micro = view.group.getObjectByName('fenbridgeTownMicroOpaqueBatch');
    if (!micro) throw new Error('renderer fixture lost the micro batch');
    // The gate compiles the buildings WITH the batches: every building group
    // (each painted model's own cloned materials, its glow among them) is a
    // reveal root.
    for (const group of buildingGroups) expect(view.staticRevealRoots()).toContain(group);
    expect(view.staticRevealRoots()).toContain(micro);

    // Camera outside the town cull radius, town and buildings inside the fog.
    // The radius is the hub ring plus a fixed margin, where the walled town
    // had it (the 34-yard hub plus half a twelve-yard wing, 40 yards), or
    // further, so it holds every building's own cull circle whole: stood
    // grand, the apothecary's reaches about 44.8 yards out.
    const hub = FENBRIDGE_LAYOUT.hub.center;
    const cullRadius = fenbridgeTownInternalsForTest.townCullRadius;
    expect(cullRadius).toBeCloseTo(44.76, 2);
    const approachX = hub.x + cullRadius + 20;
    view.update(approachX, 2, hub.z, approachX - 5, 2, hub.z, 400, 0.05);
    expect(requested).toEqual(['fenbridge-town-static']);
    expect(micro.visible).toBe(false);
    for (const group of buildingGroups) expect(group.visible).toBe(false);

    // Held frames never re-request; the settle reveals batches and buildings
    // together, and the latch never consults the gate again.
    view.update(approachX, 2, hub.z, approachX - 5, 2, hub.z, 400, 0.05);
    expect(requested).toEqual(['fenbridge-town-static']);
    for (const group of buildingGroups) expect(group.visible).toBe(false);
    gate.settle('fenbridge-town-static');
    view.update(approachX, 2, hub.z, approachX - 5, 2, hub.z, 400, 0.05);
    expect(micro.visible).toBe(true);
    for (const group of buildingGroups) expect(group.visible).toBe(true);
    view.setRevealGate(createRevealGateCore((key) => requested.push(`again:${key}`)));
    view.update(approachX, 2, hub.z, approachX - 5, 2, hub.z, 400, 0.05);
    expect(requested).toEqual(['fenbridge-town-static']);
    for (const group of buildingGroups) expect(group.visible).toBe(true);
  });

  it('reveals each root as its own compile lands, without waiting for the whole town', () => {
    // The town key covers every batch plus every building group. Holding all
    // of them until the slowest link settles turns the settle frame into the
    // one-frame first-draw burst the gate exists to prevent, so a root whose
    // own compile has landed draws while the rest keep waiting.
    setGfx({ standardMaterials: false, dynamicShadows: false, surfaceDetail: false });
    const view = fenbridgeTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
    const gate = createRevealGateCore((key) => gate.noteRoots(key, view.staticRevealRoots()));
    view.setRevealGate(gate);
    const first = FENBRIDGE_LAYOUT.buildings[0];
    const firstGroup = view.group.getObjectByName(`fenbridgeBuilding:${first.id}`);
    const second = FENBRIDGE_LAYOUT.buildings[1];
    const secondGroup = view.group.getObjectByName(`fenbridgeBuilding:${second.id}`);
    const micro = view.group.getObjectByName('fenbridgeTownMicroOpaqueBatch');
    if (!firstGroup || !secondGroup || !micro) throw new Error('renderer fixture lost a town node');

    const hub = FENBRIDGE_LAYOUT.hub.center;
    const cullRadius = fenbridgeTownInternalsForTest.townCullRadius;
    const approachX = hub.x + cullRadius + 20;
    view.update(approachX, 2, hub.z, approachX - 5, 2, hub.z, 400, 0.05);
    expect(firstGroup.visible).toBe(false);

    gate.settleRoot('fenbridge-town-static', firstGroup);
    view.update(approachX, 2, hub.z, approachX - 5, 2, hub.z, 400, 0.05);
    expect(gate.state('fenbridge-town-static')).toBe('compiling');
    expect(firstGroup.visible).toBe(true);
    // Nothing else moved: the batches and the other buildings are still cold.
    expect(micro.visible).toBe(false);
    expect(secondGroup.visible).toBe(false);

    // A revealed root is never taken back while the key is still held.
    view.update(approachX, 2, hub.z, approachX - 5, 2, hub.z, 400, 0.05);
    expect(firstGroup.visible).toBe(true);
  });

  it('holds the buildings as an IMMINENT key when the camera is already inside', () => {
    // The arrival shape: it used to reveal on the spot without consulting,
    // which linked the whole town kit in the live frames after the jump on a
    // host whose boot manifest never carried it. It consults now, holds, and
    // what standing inside buys is that the compiles go out first.
    setGfx({ standardMaterials: false, dynamicShadows: false, surfaceDetail: false });
    const view = fenbridgeTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
    const requested: { key: string; imminent: boolean }[] = [];
    view.setRevealGate(createRevealGateCore((key, imminent) => requested.push({ key, imminent })));
    const far = FENBRIDGE_LAYOUT.buildings[FENBRIDGE_LAYOUT.buildings.length - 1];
    const farGroup = view.group.getObjectByName(`fenbridgeBuilding:${far.id}`);
    if (!farGroup) throw new Error('renderer fixture lost the last building');
    const hub = FENBRIDGE_LAYOUT.hub.center;
    view.update(hub.x, 2, hub.z, hub.x, 2, hub.z + 5, 200, 0.05);
    expect(requested).toEqual([{ key: 'fenbridge-town-static', imminent: true }]);
    expect(farGroup.visible).toBe(false);
    // No clock is threaded anywhere: the hold outlasts any number of frames.
    for (let frame = 0; frame < 200; frame++) {
      view.update(hub.x, 2, hub.z, hub.x, 2, hub.z + 5, 200, 0.05);
    }
    expect(farGroup.visible).toBe(false);
    expect(requested).toHaveLength(1);
  });

  it("shows a building at arm's length on the first held frame, linked or not", () => {
    // The reach floor: the sim colliders of a building the camera is standing
    // in must not sit under something invisible, whatever the driver is doing.
    setGfx({ standardMaterials: false, dynamicShadows: false, surfaceDetail: false });
    const view = fenbridgeTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
    view.setRevealGate(createRevealGateCore(() => undefined));
    const building = FENBRIDGE_LAYOUT.buildings[0];
    const group = view.group.getObjectByName(`fenbridgeBuilding:${building.id}`);
    if (!group) throw new Error('renderer fixture lost the first building');
    // The floor reads the wall box's own centre, the record the sim collides
    // with. Every Fenbridge row centres its walls on the model's anchor, so
    // that point is also where the group stands; the probe reads it off the
    // record because the record is what the floor is defined on.
    const { x, z } = building.position;
    view.update(x, 2, z, x, 2, z + 5, 200, 0.05);
    expect(group.visible).toBe(true);
    // The town key itself never warmed: this is the floor, not a reveal.
    const micro = view.group.getObjectByName('fenbridgeTownMicroOpaqueBatch');
    if (!micro) throw new Error('renderer fixture lost the micro batch');
    expect(micro.visible).toBe(false);
  });

  it('hands the gate its roots nearest to the camera first', () => {
    // The compiles are submitted in the order the roots come back, so an
    // arrival links what it landed among before the far side of the town.
    setGfx({ standardMaterials: false, dynamicShadows: false, surfaceDetail: false });
    const view = fenbridgeTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
    let submitted: readonly THREE.Object3D[] = [];
    view.setRevealGate(
      createRevealGateCore(() => {
        submitted = [...view.staticRevealRoots()];
      }),
    );
    const last = FENBRIDGE_LAYOUT.buildings[FENBRIDGE_LAYOUT.buildings.length - 1];
    const lastGroup = view.group.getObjectByName(`fenbridgeBuilding:${last.id}`);
    if (!lastGroup) throw new Error('renderer fixture lost the last building');
    // A building's reveal anchor is its wall box's centre, which for every
    // Fenbridge row is also the model's anchor where its group stands (see the
    // reach floor above); the camera stands on it.
    const { x, z } = last.position;
    view.update(x, 2, z, x, 2, z + 5, 200, 0.05);
    expect(submitted).toHaveLength(view.staticRevealRoots().length);
    expect(submitted[0]).toBe(lastGroup);
  });

  it('fades one intersected building independently and never mutates static batches', () => {
    setGfx({ standardMaterials: false, dynamicShadows: false, surfaceDetail: false });
    const view = fenbridgeTownInternalsForTest.buildFromSources(
      fixtureSources(false),
      () => 0,
      true,
    );
    const building = FENBRIDGE_LAYOUT.buildings[0];
    const target = buildingGroup(view.group, building.id);
    const other = buildingGroup(view.group, FENBRIDGE_LAYOUT.buildings[1].id);
    // Re-pinned for the painted town: a placed building ghosts as its whole
    // model, one fade record per material and mesh shape, so every one of its
    // three fixture materials answers and none of its neighbour's does.
    const targetMaterials = materialsOf(target);
    const otherMaterials = materialsOf(other);
    expect(targetMaterials).toHaveLength(3);
    expect(otherMaterials).toHaveLength(3);
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
    for (const material of targetMaterials) expect(material.opacity).toBeCloseTo(0.2, 10);
    for (const material of otherMaterials) expect(material.opacity).toBe(1);
    expect(microMaterial.opacity).toBe(1);
  });

  it('ghosts a placed building from inside its wall box under its roof line, never from under its eaves, and keeps a walk-in room solid round a camera inside it', () => {
    // Added for the painted town, the probe tests/eastbrook_town_renderer.test.ts
    // runs on Eastbrook's placed buildings. A template shell was scaled to its
    // wall box, so the box that ghosted it and the shell it drew were one
    // rectangle. A placed model reaches well past its walls (porch, stair,
    // awning, eaves), and the camera-fade box stays the WALL box: the record's
    // footprint, topped at the model's own height above the ground under its
    // anchor (nativeDimensions.height, the buried footing not counted). The
    // shared probes stand the camera and the eye on one point, so the only way
    // to ghost a sealed building is to be inside that box, and every material
    // of the building answers together. Half extents taken from the reach fail
    // the eaves probes; a roof line that counted the footing fails the roof
    // probe.
    // Split for the walk-in buildings (fenbridge_layout.ts walkIn): the inn,
    // the chapel, the apothecary and the bank are rooms a player walks into,
    // so with the eye inside one of them it ghosts only once the camera is
    // outside its wall box or over its roof line; eye and camera both inside
    // keep it solid. A camera inside the box with the eye outside still
    // ghosts it, as for any building. The sealed warden house keeps the rule
    // above unchanged (fenbridge_town_visibility_core.ts).
    expect(
      FENBRIDGE_LAYOUT.buildings
        .filter((building) => building.walkIn)
        .map((building) => building.id),
    ).toEqual([
      'fenbridge_crooked_reed_inn',
      'fenbridge_lantern_chapel',
      'fenbridge_moonwort_apothecary',
      'fenbridge_gilded_strongbox',
    ]);
    expect(
      FENBRIDGE_LAYOUT.buildings
        .filter((building) => !building.walkIn)
        .map((building) => building.id),
    ).toEqual(['fenbridge_warden_gatehouse']);
    setGfx({ standardMaterials: false, dynamicShadows: false, surfaceDetail: false });
    const groundY = 1.5;
    const view = fenbridgeTownInternalsForTest.buildFromSources(
      fixtureSources(),
      () => groundY,
      true,
    );
    const micro = view.group.getObjectByName('fenbridgeTownMicroOpaqueBatch') as THREE.Mesh;
    if (!micro) throw new Error('renderer fixture lost the micro batch');
    const fadeState = (materials: readonly THREE.Material[]): string => {
      if (materials.every((material) => !material.transparent && material.opacity === 1)) {
        return 'solid';
      }
      const ghosted = materials.every(
        (material) =>
          material.transparent && material.depthWrite && Math.abs(material.opacity - 0.2) < 1e-9,
      );
      return ghosted ? 'ghost' : 'mixed';
    };

    for (const building of FENBRIDGE_LAYOUT.buildings) {
      const materials = materialsOf(buildingGroup(view.group, building.id));
      expect(materials, building.id).toHaveLength(3);
      const { footprint, reach } = building;
      const roofY = groundY + building.nativeDimensions.height;
      const belowRoof = groundY + 2;
      // Stand well over the roof first (so each probe starts from the authored
      // state), then put the camera and the eye where the probe says.
      const stateWith = (
        camera: { x: number; y: number; z: number },
        eye: { x: number; y: number; z: number },
      ): string => {
        view.update(eye.x, roofY + 20, eye.z, eye.x, roofY + 20, eye.z, 200, 10);
        expect(fadeState(materials), `${building.id} cleared`).toBe('solid');
        view.update(camera.x, camera.y, camera.z, eye.x, eye.y, eye.z, 200, 10);
        return fadeState(materials);
      };
      const stateAt = (point: { x: number; z: number }, y: number): string =>
        stateWith({ x: point.x, y, z: point.z }, { x: point.x, y, z: point.z });

      for (const [signX, signZ] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        // A step inside each corner of the wall box: the box is the whole
        // footprint, not a patch around the door. A sealed building ghosts;
        // a walk-in room with the eye and the camera both in it stays solid.
        const inside = pointIn(
          footprint,
          signX * (footprint.halfWidth - 0.05),
          signZ * (footprint.halfDepth - 0.05),
        );
        expect(insideRect(footprint, inside)).toBe(true);
        expect(stateAt(inside, belowRoof), `${building.id} inside ${signX},${signZ}`).toBe(
          building.walkIn ? 'solid' : 'ghost',
        );
        if (!building.walkIn) continue;
        // The walk-in room still ghosts when the camera leaves its box with
        // the eye inside, and when the camera backs into it from an eye
        // outside: three yards out past the same corner, under the roof line.
        const outPastCorner = pointIn(
          footprint,
          signX * (footprint.halfWidth + 3),
          signZ * (footprint.halfDepth + 3),
        );
        expect(insideRect(footprint, outPastCorner)).toBe(false);
        expect(
          stateWith(
            { x: outPastCorner.x, y: belowRoof, z: outPastCorner.z },
            { x: inside.x, y: belowRoof, z: inside.z },
          ),
          `${building.id} camera out past ${signX},${signZ}`,
        ).toBe('ghost');
        expect(
          stateWith(
            { x: inside.x, y: belowRoof, z: inside.z },
            { x: outPastCorner.x, y: belowRoof, z: outPastCorner.z },
          ),
          `${building.id} camera backed in at ${signX},${signZ}`,
        ).toBe('ghost');
      }
      // A step outside each wall, still under the model's eaves (inside its
      // reach): never a ghost.
      for (const [localX, localZ] of [
        [footprint.halfWidth + 0.05, 0],
        [-footprint.halfWidth - 0.05, 0],
        [0, footprint.halfDepth + 0.05],
        [0, -footprint.halfDepth - 0.05],
      ]) {
        const outside = pointIn(footprint, localX, localZ);
        const label = `${building.id} outside ${localX},${localZ}`;
        expect(insideRect(footprint, outside), label).toBe(false);
        expect(insideRect(reach, outside), `${label} under the eaves`).toBe(true);
        expect(stateAt(outside, belowRoof), label).toBe('solid');
      }
      // The four corners of the reach, where the porch, the stair and the
      // eaves end: on the model's ground, outside its walls.
      const underEaves = reachCorners(building, 0.05);
      expect(underEaves).toHaveLength(4);
      for (const point of underEaves) {
        expect(insideRect(footprint, point), `${building.id} reach corner`).toBe(false);
        expect(stateAt(point, belowRoof), `${building.id} under the eaves`).toBe('solid');
      }
      // The roof line is the model's own top over the ground under its anchor.
      // Eye and camera together just under it: a sealed building ghosts, a
      // walk-in room stays solid. Just over it, neither ghosts.
      expect(stateAt(footprint.center, roofY - 0.05), `${building.id} under the roof`).toBe(
        building.walkIn ? 'solid' : 'ghost',
      );
      expect(stateAt(footprint.center, roofY + 0.05), `${building.id} over the roof`).toBe('solid');
      if (building.walkIn) {
        // With the eye in the room, the same roof line decides by the camera:
        // still under it keeps the room solid, over it ghosts the room.
        const eye = { x: footprint.center.x, y: belowRoof, z: footprint.center.z };
        expect(
          stateWith({ x: eye.x, y: roofY - 0.05, z: eye.z }, eye),
          `${building.id} camera under the roof`,
        ).toBe('solid');
        expect(
          stateWith({ x: eye.x, y: roofY + 0.05, z: eye.z }, eye),
          `${building.id} camera over the roof`,
        ).toBe('ghost');
      }
      // The merged microgeometry is never a camera-fade target.
      expect((micro.material as THREE.Material).transparent).toBe(false);
      expect((micro.material as THREE.Material).opacity).toBe(1);
    }
  });

  it('keeps a placed building drawn for as long as the fog reaches the far corner of its reach', () => {
    // Added for the painted town, the probe tests/eastbrook_town_renderer.test.ts
    // runs on Eastbrook's placed buildings. A template shell culled on its wall
    // box's corner radius (maxCornerRadius), which was the whole shell. A placed
    // model's porch, stair and eaves stand outside that circle, so its fog cull
    // is measured from the record's own centre out to the far corner of the
    // REACH: culling on the wall box would pop the building out while part of
    // it was still in view.
    setGfx({ standardMaterials: false, dynamicShadows: false, surfaceDetail: false });
    const fogFar = 100;
    const view = fenbridgeTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
    const micro = view.group.getObjectByName('fenbridgeTownMicroOpaqueBatch');
    if (!micro) throw new Error('renderer fixture lost the micro batch');
    const hub = FENBRIDGE_LAYOUT.hub.center;
    for (const building of FENBRIDGE_LAYOUT.buildings) {
      const group = buildingGroup(view.group, building.id);
      const { footprint, reach } = building;
      const center = footprint.center;
      const farCorner = Math.max(
        ...reachCorners(building).map((corner) =>
          Math.hypot(corner.x - center.x, corner.z - center.z),
        ),
      );
      // The reach really does stand outside the wall box's own circle, so the
      // first probe below is one the old radius would have culled.
      expect(farCorner, `${building.id} reach past the walls`).toBeGreaterThan(
        building.maxCornerRadius + 1,
      );
      // No looser than the reach's own centre offset plus its half diagonal.
      const widest =
        Math.hypot(reach.center.x - center.x, reach.center.z - center.z) +
        Math.hypot(reach.halfWidth, reach.halfDepth);
      expect(widest).toBeGreaterThanOrEqual(farCorner);
      // The camera backs away along the line from the building through the hub
      // centre, the point the town-wide static cull measures from, so the town
      // stays in the fog and only the building's own cull can hide it.
      const dx = center.x - hub.x;
      const dz = center.z - hub.z;
      const length = Math.hypot(dx, dz);
      const standAt = (distance: number): void => {
        const x = center.x - (dx / length) * distance;
        const z = center.z - (dz / length) * distance;
        view.update(x, 5, z, x, 5, z, fogFar, 0.05);
      };
      standAt(fogFar + farCorner - 0.01);
      expect(group.visible, `${building.id} far corner still in the fog`).toBe(true);
      standAt(fogFar + widest + 0.01);
      expect(group.visible, `${building.id} past its cull radius`).toBe(false);
      expect(micro.visible, `${building.id} town still in the fog`).toBe(true);
      standAt(fogFar + farCorner - 0.01);
      expect(group.visible, `${building.id} back inside the fog`).toBe(true);
    }
  });

  it('keeps a grand building drawn from beyond its back wall: the town circle holds its cull', () => {
    // Stood grand, the north street's shops reach past the hub ring and its
    // six-yard margin. The town-wide fog answer hides every building with the
    // batches, so a camera backing away OUT past a building's back wall (the
    // town at its farthest) lost the building while the fog still reached it,
    // unless the town circle holds that building's own cull circle whole.
    setGfx({ standardMaterials: false, dynamicShadows: false, surfaceDetail: false });
    const fogFar = 100;
    const view = fenbridgeTownInternalsForTest.buildFromSources(fixtureSources(), () => 0, true);
    const hub = FENBRIDGE_LAYOUT.hub.center;
    const cullRadius = fenbridgeTownInternalsForTest.townCullRadius;
    const pastTheMargin: string[] = [];
    for (const building of FENBRIDGE_LAYOUT.buildings) {
      const group = buildingGroup(view.group, building.id);
      const { footprint, reach } = building;
      const center = footprint.center;
      const farCorner = Math.max(
        ...reachCorners(building).map((corner) =>
          Math.hypot(corner.x - center.x, corner.z - center.z),
        ),
      );
      const widest =
        Math.hypot(reach.center.x - center.x, reach.center.z - center.z) +
        Math.hypot(reach.halfWidth, reach.halfDepth);
      const dx = center.x - hub.x;
      const dz = center.z - hub.z;
      const length = Math.hypot(dx, dz);
      if (length + widest > FENBRIDGE_LAYOUT.hub.radius + 6) pastTheMargin.push(building.id);
      expect(length + widest, `${building.id} cull circle inside the town's`).toBeLessThanOrEqual(
        cullRadius + 1e-9,
      );
      const standAt = (distance: number): void => {
        const x = center.x + (dx / length) * distance;
        const z = center.z + (dz / length) * distance;
        view.update(x, 5, z, x, 5, z, fogFar, 0.05);
      };
      standAt(fogFar + farCorner - 0.01);
      expect(group.visible, `${building.id} from beyond its back wall`).toBe(true);
      standAt(fogFar + widest + 0.01);
      expect(group.visible, `${building.id} past its own cull radius`).toBe(false);
    }
    // the case is live: the grand apothecary and bank reach past the margin
    expect(pastTheMargin).toEqual(['fenbridge_moonwort_apothecary', 'fenbridge_gilded_strongbox']);
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
    // the rebuilt towns ride one list: mounted, frozen and updated in loops
    expect(rendererSource).toContain(
      'this.townViews = [this.eastbrookTownView, this.fenbridgeTownView, highwatch];',
    );
    expect(rendererSource).toContain("setRenderCategory(town.group, 'props')");
    expect(rendererSource.match(/\btown\.update\(/g)).toHaveLength(2);
    expect(rendererSource.match(/this\.fenbridgeTownView\.update\(/g)).toBeNull();
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
