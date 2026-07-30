import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getBounds, type Node, NodeIO, Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import {
  GRAND_FERRY_SHIP_SOURCE_FILES,
  grandFerryShipSourceFingerprint,
} from '../scripts/assets/grand_ferry_ship/source_fingerprint.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { type Collider, queryOpenWorldColliders } from '../src/sim/colliders';
import { GRAND_FERRY_SHIP_PLAN } from '../src/sim/grand_ferry_ship_plan.generated';
import { HARBORS, type HarborRail, type HarborRamp } from '../src/sim/harbor_layout';

const REPO_ROOT = path.join(__dirname, '..');
const ASSET_PATH = path.join(REPO_ROOT, 'public/models/props/grand_ferry_ship.glb');
const ASSET_BYTES = 33_592;
const ASSET_SHA256 = 'ae6a2adcaf5c95bae4a0c75ba838031e68f5ca318935aa351885d75158085a45';
const SOURCE_FINGERPRINT = 'a12acdf6352a17b4e0963424588a3ab6a5b70ff877272f39fe2e72a41a8eb6b4';
const PLAN_MESH_EPSILON = GRAND_FERRY_SHIP_PLAN.measurementEpsilons.optimized;
const RAMP_MATING_EPSILON = 1e-9;
const RAIL_GAP_INTERIOR_EPSILON = 0.02;
const RAIL_SIDE_VERTEX_EPSILON = 0.12;
const COLLIDER_MATCH_EPSILON = 1e-9;
const HULL_BLOCKER_OVERHANG_EPSILON = 0.12;
const TRIANGLE_AREA_SQUARED_EPSILON = 1e-10;

function requiredNode(nodes: readonly Node[], name: string): Node {
  const node = nodes.find((candidate) => candidate.getName() === name);
  if (!node) throw new Error(`grand ferry asset lost ${name}`);
  return node;
}

function highEdge(ramp: HarborRamp): { x: number; z: number } {
  switch (ramp.dir) {
    case 'x+':
      return { x: ramp.x - ramp.hw, z: ramp.z };
    case 'x-':
      return { x: ramp.x + ramp.hw, z: ramp.z };
    case 'z+':
      return { x: ramp.x, z: ramp.z - ramp.hd };
    case 'z-':
      return { x: ramp.x, z: ramp.z + ramp.hd };
  }
}

function railContains(rail: HarborRail, point: { x: number; z: number }): boolean {
  const cos = Math.cos(-rail.rot);
  const sin = Math.sin(-rail.rot);
  const dx = point.x - rail.x;
  const dz = point.z - rail.z;
  const localX = dx * cos + dz * sin;
  const localZ = -dx * sin + dz * cos;
  return Math.abs(localX) <= rail.hw && Math.abs(localZ) <= (rail.halfThickness ?? 0.14);
}

function plannedBlockerContains(
  blocker: (typeof GRAND_FERRY_SHIP_PLAN.blockingVolumes)[number],
  point: { x: number; z: number },
): boolean {
  const cos = Math.cos(-blocker.rot);
  const sin = Math.sin(-blocker.rot);
  const dx = point.x - blocker.x;
  const dz = point.z - blocker.z;
  const localX = dx * cos + dz * sin;
  const localZ = -dx * sin + dz * cos;
  return (
    Math.abs(localX) <= blocker.hw + PLAN_MESH_EPSILON &&
    Math.abs(localZ) <= blocker.hd + PLAN_MESH_EPSILON
  );
}

function blockerCorners(
  blocker: (typeof GRAND_FERRY_SHIP_PLAN.blockingVolumes)[number],
): readonly { x: number; z: number }[] {
  const cos = Math.cos(blocker.rot);
  const sin = Math.sin(blocker.rot);
  return [-1, 1].flatMap((along) =>
    [-1, 1].map((across) => {
      const localX = along * blocker.hw;
      const localZ = across * blocker.hd;
      return {
        x: blocker.x + localX * cos + localZ * sin,
        z: blocker.z - localX * sin + localZ * cos,
      };
    }),
  );
}

function triangleAreaSquared(
  triangle: readonly [[number, number, number], [number, number, number], [number, number, number]],
): number {
  const [a, b, c] = triangle;
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  return cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2;
}

function hullHalfBeamAt(
  profile: readonly { x: number; halfBeam: number }[],
  requestedX: number,
): number {
  const x = Math.max(profile[0].x, Math.min(profile.at(-1)?.x ?? profile[0].x, requestedX));
  const rightIndex = profile.findIndex((point) => point.x >= x);
  if (rightIndex <= 0) return profile[0].halfBeam;
  const left = profile[rightIndex - 1];
  const right = profile[rightIndex];
  const t = (x - left.x) / (right.x - left.x);
  return left.halfBeam + (right.halfBeam - left.halfBeam) * t;
}

function contractAxis(value: number): number {
  if (Math.abs(value) < 1e-12) return 0;
  if (Math.abs(value - 1) < 1e-12) return 1;
  if (Math.abs(value + 1) < 1e-12) return -1;
  return value;
}

function expectedWorldPoint(
  harbor: (typeof HARBORS)[number],
  x: number,
  z: number,
): { x: number; z: number } {
  const scale = harbor.berth.length / GRAND_FERRY_SHIP_PLAN.model.length;
  const mirror = harbor.berth.mirrorZ ? -1 : 1;
  const cos = contractAxis(Math.cos(harbor.berth.rot));
  const sin = contractAxis(Math.sin(harbor.berth.rot));
  const localX = x * scale;
  const localZ = z * mirror * scale;
  return {
    x: harbor.berth.x + localX * cos + localZ * sin,
    z: harbor.berth.z - localX * sin + localZ * cos,
  };
}

function expectedWorldY(harbor: (typeof HARBORS)[number], localY: number): number {
  const scale = harbor.berth.length / GRAND_FERRY_SHIP_PLAN.model.length;
  const baseY = GRAND_FERRY_SHIP_PLAN.standardBerth.waterlineY - harbor.berth.draft;
  return Math.round((baseY + localY * scale) * 1e12) / 1e12;
}

function worldVertices(node: Node): readonly [number, number, number][] {
  const mesh = node.getMesh();
  if (!mesh) throw new Error(`${node.getName()} has no mesh`);
  const matrix = node.getWorldMatrix();
  const vertices: [number, number, number][] = [];
  for (const primitive of mesh.listPrimitives()) {
    const position = primitive.getAttribute('POSITION');
    if (!position) throw new Error(`${node.getName()} has no POSITION`);
    const local = [0, 0, 0];
    for (let index = 0; index < position.getCount(); index++) {
      position.getElement(index, local);
      vertices.push([
        matrix[0] * local[0] + matrix[4] * local[1] + matrix[8] * local[2] + matrix[12],
        matrix[1] * local[0] + matrix[5] * local[1] + matrix[9] * local[2] + matrix[13],
        matrix[2] * local[0] + matrix[6] * local[1] + matrix[10] * local[2] + matrix[14],
      ]);
    }
  }
  return vertices;
}

function worldTriangles(
  node: Node,
): readonly (readonly [
  [number, number, number],
  [number, number, number],
  [number, number, number],
])[] {
  const mesh = node.getMesh();
  if (!mesh) throw new Error(`${node.getName()} has no mesh`);
  const matrix = node.getWorldMatrix();
  const transform = (local: readonly number[]): [number, number, number] => [
    matrix[0] * local[0] + matrix[4] * local[1] + matrix[8] * local[2] + matrix[12],
    matrix[1] * local[0] + matrix[5] * local[1] + matrix[9] * local[2] + matrix[13],
    matrix[2] * local[0] + matrix[6] * local[1] + matrix[10] * local[2] + matrix[14],
  ];
  const triangles: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ][] = [];
  for (const primitive of mesh.listPrimitives()) {
    const position = primitive.getAttribute('POSITION');
    if (!position) throw new Error(`${node.getName()} has no POSITION`);
    const indices = primitive.getIndices();
    const element = [0, 0, 0];
    const vertexAt = (index: number): [number, number, number] => {
      position.getElement(index, element);
      return transform(element);
    };
    const count = indices?.getCount() ?? position.getCount();
    for (let index = 0; index < count; index += 3) {
      const a = indices ? indices.getScalar(index) : index;
      const b = indices ? indices.getScalar(index + 1) : index + 1;
      const c = indices ? indices.getScalar(index + 2) : index + 2;
      triangles.push([vertexAt(a), vertexAt(b), vertexAt(c)]);
    }
  }
  return triangles;
}

function lowEdge(ramp: HarborRamp): { x: number; z: number } {
  const high = highEdge(ramp);
  return { x: ramp.x * 2 - high.x, z: ramp.z * 2 - high.z };
}

function crossSectionPoints(
  ramp: HarborRamp,
  edge: { x: number; z: number },
): readonly [{ x: number; z: number }, { x: number; z: number }] {
  const inset = RAIL_GAP_INTERIOR_EPSILON;
  if (ramp.dir === 'x+' || ramp.dir === 'x-') {
    return [
      { x: edge.x, z: edge.z - ramp.hd + inset },
      { x: edge.x, z: edge.z + ramp.hd - inset },
    ];
  }
  return [
    { x: edge.x - ramp.hw + inset, z: edge.z },
    { x: edge.x + ramp.hw - inset, z: edge.z },
  ];
}

function colliderMatchesBlocker(
  collider: Collider,
  blocker: (typeof HARBORS)[number]['shipBlockers'][number],
) {
  return (
    collider.type === 'obb' &&
    Math.abs(collider.x - blocker.x) <= COLLIDER_MATCH_EPSILON &&
    Math.abs(collider.z - blocker.z) <= COLLIDER_MATCH_EPSILON &&
    Math.abs(collider.hw - blocker.hw) <= COLLIDER_MATCH_EPSILON &&
    Math.abs(collider.hd - blocker.hd) <= COLLIDER_MATCH_EPSILON &&
    Math.abs(collider.rot - blocker.rot) <= COLLIDER_MATCH_EPSILON &&
    collider.cameraTopY === blocker.cameraTopY &&
    collider.moveTopY === blocker.topY
  );
}

describe('grand ferry procedural asset contract', () => {
  it('pins the deterministic source inventory, optimizer spec, and stable render binding', () => {
    expect(GRAND_FERRY_SHIP_SOURCE_FILES).toEqual([
      'scripts/assets/grand_ferry_ship/model.js',
      'scripts/assets/grand_ferry_ship/export_entry.js',
      'scripts/assets/grand_ferry_ship/export_grand_ferry_ship.mjs',
      'scripts/assets/grand_ferry_ship/source_fingerprint.mjs',
      'scripts/assets/specs/grand_ferry_ship.json',
      'scripts/assets/build_assets.mjs',
      'src/sim/grand_ferry_ship_plan.generated.ts',
      'package-lock.json',
    ]);
    expect(grandFerryShipSourceFingerprint(REPO_ROOT)).toBe(SOURCE_FINGERPRINT);
    expect(grandFerryShipSourceFingerprint(REPO_ROOT)).toBe(
      grandFerryShipSourceFingerprint(REPO_ROOT),
    );
    expect(
      JSON.parse(
        readFileSync(path.join(REPO_ROOT, 'scripts/assets/specs/grand_ferry_ship.json'), 'utf8'),
      ),
    ).toEqual({
      items: [
        {
          src: 'tmp/asset_src/grand_ferry_ship/grand_ferry_ship-final.glb',
          out: 'models/props/grand_ferry_ship.glb',
          type: 'static',
          keepExtras: true,
        },
      ],
    });
    const propsSource = readFileSync(path.join(REPO_ROOT, 'src/render/props.ts'), 'utf8');
    expect(propsSource).toContain(
      "harborShip: { url: '/models/props/grand_ferry_ship.glb', kit: 'pirate' }",
    );
    expect(propsSource.match(/side: s\.side,/g)).toHaveLength(2);
    const harborSource = readFileSync(path.join(REPO_ROOT, 'src/render/harbor.ts'), 'utf8');
    expect(harborSource).toContain('const shipVisual = addAsset(g, ship);');
    expect(harborSource).toContain('if (harbor.berth.mirrorZ) shipVisual.scale.z = -1;');
    expect(harborSource).toContain('z: GRAND_FERRY_SHIP_PLAN.deck.z * HARBOR_SHIP_STANDARD_SCALE,');
    const layoutSource = readFileSync(path.join(REPO_ROOT, 'src/sim/harbor_layout.ts'), 'utf8');
    expect(layoutSource).toContain('const MAINLAND_SHIP = generatedShipPlacement(MAINLAND_BERTH);');
    expect(layoutSource).toContain(
      'const GULLHAVEN_SHIP = generatedShipPlacement(GULLHAVEN_BERTH);',
    );
    expect(layoutSource.match(/shipDecks: (MAINLAND|GULLHAVEN)_SHIP\.decks,/g)).toHaveLength(2);
    expect(layoutSource.match(/shipRails: (MAINLAND|GULLHAVEN)_SHIP\.rails,/g)).toHaveLength(2);
    expect(layoutSource.match(/shipBlockers: (MAINLAND|GULLHAVEN)_SHIP\.blockers,/g)).toHaveLength(
      2,
    );
    expect(layoutSource).toContain('generatedDirection(localEdge.outward)');
    expect(layoutSource).toContain(
      'min: MAINLAND_SHIP.rampMatingEdge.z - MAINLAND_SHIP.rampMatingEdge.halfWidth,',
    );
    expect(layoutSource).toContain(
      'min: GULLHAVEN_SHIP.rampMatingEdge.x - GULLHAVEN_SHIP.rampMatingEdge.halfWidth,',
    );
    const collidersSource = readFileSync(path.join(REPO_ROOT, 'src/sim/colliders.ts'), 'utf8');
    expect(collidersSource).toContain('for (const blocker of h.shipBlockers)');
    for (const relativePath of GRAND_FERRY_SHIP_SOURCE_FILES.filter(
      (file) =>
        file.includes('grand_ferry_ship') || file === 'src/sim/grand_ferry_ship_plan.generated.ts',
    )) {
      const source = readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
      expect(source, relativePath).not.toMatch(/\bMath\.random\b|\bDate\.now\b/);
    }
  });

  it('pins optimized bytes, topology, materials, bounds, and source fingerprints', async () => {
    await MeshoptDecoder.ready;
    const bytes = readFileSync(ASSET_PATH);
    expect(bytes).toHaveLength(ASSET_BYTES);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(ASSET_SHA256);
    expect(bytes.length).toBeLessThanOrEqual(140 * 1024);
    expect(MEDIA_ASSETS['models/props/grand_ferry_ship.glb']).toBe(
      `/media/models/props/grand_ferry_ship.${ASSET_SHA256.slice(0, 12)}.glb`,
    );

    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const document = await io.readBinary(bytes);
    const root = document.getRoot();
    expect(
      root
        .listExtensionsUsed()
        .map((extension) => extension.extensionName)
        .sort(),
    ).toEqual(['EXT_meshopt_compression', 'KHR_mesh_quantization']);
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

    const scene = root.listScenes()[0];
    expect(scene.listChildren().map((node) => node.getName())).toEqual(['GrandFerryShip']);
    const nodes = root.listNodes();
    expect(
      nodes
        .filter((node) => node.getMesh())
        .map((node) => node.getName())
        .sort(),
    ).toEqual([
      'GrandFerryAccents',
      'GrandFerryGangwayMating',
      'GrandFerryHull',
      'GrandFerryMainDeck',
      'GrandFerryRails',
      'GrandFerryRigging',
      'GrandFerrySails',
      'GrandFerrySuperstructure',
      'GrandFerrySuperstructureDetails',
    ]);

    const primitiveContracts = nodes
      .filter((node) => node.getMesh())
      .map((node) => {
        const primitives = node.getMesh()?.listPrimitives() ?? [];
        expect(primitives, node.getName()).toHaveLength(1);
        const primitive = primitives[0];
        expect(primitive.getMode()).toBe(Primitive.Mode.TRIANGLES);
        expect(primitive.listSemantics().sort()).toEqual(['COLOR_0', 'NORMAL', 'POSITION']);
        const position = primitive.getAttribute('POSITION');
        const normal = primitive.getAttribute('NORMAL');
        const color = primitive.getAttribute('COLOR_0');
        if (!position || !normal || !color) {
          throw new Error(`${node.getName()} lost required vertex attributes`);
        }
        expect(position.getNormalized()).toBe(true);
        expect(normal.getNormalized()).toBe(true);
        expect(color.getNormalized()).toBe(true);
        return {
          name: node.getName(),
          material: primitive.getMaterial()?.getName(),
          triangles: (primitive.getIndices()?.getCount() ?? position.getCount()) / 3,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
    expect(primitiveContracts).toEqual([
      { name: 'GrandFerryAccents', material: 'GrandFerryMetalAndGlass', triangles: 280 },
      { name: 'GrandFerryGangwayMating', material: 'GrandFerryTimber', triangles: 12 },
      { name: 'GrandFerryHull', material: 'GrandFerryHullPaint', triangles: 116 },
      { name: 'GrandFerryMainDeck', material: 'GrandFerryTimber', triangles: 12 },
      { name: 'GrandFerryRails', material: 'GrandFerryTimber', triangles: 648 },
      { name: 'GrandFerryRigging', material: 'GrandFerryTimber', triangles: 140 },
      { name: 'GrandFerrySails', material: 'GrandFerrySailcloth', triangles: 4 },
      { name: 'GrandFerrySuperstructure', material: 'GrandFerryHullPaint', triangles: 12 },
      {
        name: 'GrandFerrySuperstructureDetails',
        material: 'GrandFerryMetalAndGlass',
        triangles: 124,
      },
    ]);
    expect(primitiveContracts.reduce((sum, contract) => sum + contract.triangles, 0)).toBe(1_348);
    expect(
      root
        .listMaterials()
        .map((material) => material.getName())
        .sort(),
    ).toEqual([
      'GrandFerryHullPaint',
      'GrandFerryMetalAndGlass',
      'GrandFerrySailcloth',
      'GrandFerryTimber',
    ]);
    expect(
      root
        .listMaterials()
        .find((material) => material.getName() === 'GrandFerrySailcloth')
        ?.getDoubleSided(),
    ).toBe(true);

    const bounds = getBounds(scene);
    expect(bounds.min[0]).toBeCloseTo(-GRAND_FERRY_SHIP_PLAN.model.length / 2, 3);
    expect(bounds.min[1]).toBeCloseTo(GRAND_FERRY_SHIP_PLAN.model.keelY, 2);
    expect(bounds.min[2]).toBeCloseTo(-GRAND_FERRY_SHIP_PLAN.model.beam / 2, 3);
    expect(bounds.max[0]).toBeCloseTo(GRAND_FERRY_SHIP_PLAN.model.length / 2, 3);
    expect(bounds.max[1]).toBeCloseTo(GRAND_FERRY_SHIP_PLAN.model.height, 3);
    expect(bounds.max[2]).toBeCloseTo(GRAND_FERRY_SHIP_PLAN.model.beam / 2, 3);

    const modelRoot = requiredNode(nodes, 'GrandFerryShip');
    expect(modelRoot.getTranslation()).toEqual([0, 0, 0]);
    expect(modelRoot.getRotation()).toEqual([0, 0, 0, 1]);
    expect(modelRoot.getScale()).toEqual([1, 1, 1]);
    expect(modelRoot.getExtras()).toMatchObject({
      sculptRuntime: {
        version: 1,
        source: 'deterministic-procedural-threejs',
        frontAxis: [1, 0, 0],
        floorSeated: true,
        collisionPlanVersion: 1,
        shippingCollisionMesh: false,
        serviceCues: [
          'deep-blue-flared-hull',
          'warm-timber-main-deck',
          'port-gangway-opening',
          'raised-wheelhouse',
          'twin-mast-silhouette',
        ],
      },
    });
    expect(root.getExtras()).toEqual({ sourceFingerprint: SOURCE_FINGERPRINT });
    expect(root.getAsset().extras).toEqual({ sourceFingerprint: SOURCE_FINGERPRINT });
  });

  it('matches generated deck, opening, mating edge, and blocker dimensions to the mesh', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const document = await io.read(ASSET_PATH);
    const nodes = document.getRoot().listNodes();
    const deck = GRAND_FERRY_SHIP_PLAN.deck;
    const deckBounds = getBounds(requiredNode(nodes, 'GrandFerryMainDeck'));
    expect(deckBounds.min[0]).toBeCloseTo(deck.x - deck.hw, 2);
    expect(deckBounds.min[1]).toBeCloseTo(deck.y - deck.thickness, 2);
    expect(deckBounds.min[2]).toBeCloseTo(deck.z - deck.hd, 2);
    expect(deckBounds.max[0]).toBeCloseTo(deck.x + deck.hw, 2);
    expect(deckBounds.max[1]).toBeCloseTo(deck.y, 2);
    expect(deckBounds.max[2]).toBeCloseTo(deck.z + deck.hd, 2);

    const hullBounds = getBounds(requiredNode(nodes, 'GrandFerryHull'));
    const stern = GRAND_FERRY_SHIP_PLAN.blockingVolumes.filter((volume) => volume.kind === 'stern');
    const bow = GRAND_FERRY_SHIP_PLAN.blockingVolumes.filter((volume) => volume.kind === 'bow');
    const superstructure = GRAND_FERRY_SHIP_PLAN.blockingVolumes.find(
      (volume) => volume.kind === 'superstructure',
    );
    if (stern.length === 0 || bow.length === 0 || !superstructure) {
      throw new Error('generated blocker plan is incomplete');
    }
    const sternCorners = stern.flatMap(blockerCorners);
    const bowCorners = bow.flatMap(blockerCorners);
    expect(
      Math.abs(Math.min(...sternCorners.map(({ x }) => x)) - hullBounds.min[0]),
    ).toBeLessThanOrEqual(HULL_BLOCKER_OVERHANG_EPSILON + PLAN_MESH_EPSILON);
    expect(
      Math.abs(Math.max(...sternCorners.map(({ x }) => x)) - deckBounds.min[0]),
    ).toBeLessThanOrEqual(HULL_BLOCKER_OVERHANG_EPSILON + PLAN_MESH_EPSILON);
    expect(
      Math.abs(Math.min(...bowCorners.map(({ x }) => x)) - deckBounds.max[0]),
    ).toBeLessThanOrEqual(HULL_BLOCKER_OVERHANG_EPSILON + PLAN_MESH_EPSILON);
    expect(
      Math.abs(Math.max(...bowCorners.map(({ x }) => x)) - hullBounds.max[0]),
    ).toBeLessThanOrEqual(HULL_BLOCKER_OVERHANG_EPSILON + PLAN_MESH_EPSILON);
    const endBlockers = [...stern, ...bow];
    const hullVertices = worldVertices(requiredNode(nodes, 'GrandFerryHull'));
    const hullTopY = deck.y - deck.thickness;
    const hullTopVertices = hullVertices.filter(
      ([x, y]) =>
        Math.abs(y - hullTopY) <= PLAN_MESH_EPSILON &&
        (x < deckBounds.min[0] + PLAN_MESH_EPSILON || x > deckBounds.max[0] - PLAN_MESH_EPSILON),
    );
    for (const [x, , z] of hullTopVertices) {
      expect(
        endBlockers.some((volume) => plannedBlockerContains(volume, { x, z })),
        `hull top vertex ${x},${z} escaped the bow and stern blocker envelope`,
      ).toBe(true);
    }
    const profileByX = new Map<string, { x: number; halfBeam: number }>();
    for (const [x, , z] of hullVertices.filter(
      ([, y]) => Math.abs(y - hullTopY) <= PLAN_MESH_EPSILON,
    )) {
      const key = x.toFixed(4);
      const current = profileByX.get(key);
      if (!current || Math.abs(z) > current.halfBeam) {
        profileByX.set(key, { x, halfBeam: Math.abs(z) });
      }
    }
    const hullProfile = [...profileByX.values()].sort((left, right) => left.x - right.x);
    for (const volume of endBlockers) {
      for (const corner of blockerCorners(volume)) {
        const longitudinalOverhang = Math.max(
          hullProfile[0].x - corner.x,
          corner.x - (hullProfile.at(-1)?.x ?? hullProfile[0].x),
          0,
        );
        const lateralOverhang = Math.max(
          Math.abs(corner.z) - hullHalfBeamAt(hullProfile, corner.x),
          0,
        );
        expect(
          Math.max(longitudinalOverhang, lateralOverhang),
          `${volume.id} exceeds the measured hull profile at ${corner.x},${corner.z}`,
        ).toBeLessThanOrEqual(HULL_BLOCKER_OVERHANG_EPSILON + PLAN_MESH_EPSILON);
      }
    }
    const superstructureBounds = getBounds(requiredNode(nodes, 'GrandFerrySuperstructure'));
    expect(superstructure.x - superstructure.hw).toBeCloseTo(superstructureBounds.min[0], 2);
    expect(superstructure.z - superstructure.hd).toBeCloseTo(superstructureBounds.min[2], 2);
    expect(superstructure.x + superstructure.hw).toBeCloseTo(superstructureBounds.max[0], 2);
    expect(superstructure.z + superstructure.hd).toBeCloseTo(superstructureBounds.max[2], 2);

    const edge = GRAND_FERRY_SHIP_PLAN.rampMatingEdge;
    const matingBounds = getBounds(requiredNode(nodes, 'GrandFerryGangwayMating'));
    expect(matingBounds.min[0]).toBeCloseTo(edge.x - edge.halfWidth, 2);
    expect(matingBounds.max[0]).toBeCloseTo(edge.x + edge.halfWidth, 2);
    expect(matingBounds.min[2]).toBeCloseTo(edge.z, 2);
    expect(matingBounds.max[1]).toBeCloseTo(edge.y, 2);
    const socket = requiredNode(nodes, 'Socket_GangwayMatingEdge');
    expect(socket.getTranslation()[0]).toBeCloseTo(edge.x, 12);
    expect(socket.getTranslation()[1]).toBeCloseTo(edge.y, 12);
    expect(socket.getTranslation()[2]).toBeCloseTo(edge.z, 12);

    const deckMinX = deck.x - deck.hw;
    const deckMaxX = deck.x + deck.hw;
    const openingMinX = edge.x - edge.halfWidth;
    const openingMaxX = edge.x + edge.halfWidth;
    const hullTriangles = worldTriangles(requiredNode(nodes, 'GrandFerryHull'));
    for (const [index, triangle] of hullTriangles.entries()) {
      expect(triangleAreaSquared(triangle), `hull triangle ${index} is degenerate`).toBeGreaterThan(
        TRIANGLE_AREA_SQUARED_EPSILON,
      );
    }
    const corridorTopTriangles = hullTriangles.filter((triangle) => {
      const centerX = triangle.reduce((sum, vertex) => sum + vertex[0], 0) / 3;
      return (
        centerX > openingMinX + PLAN_MESH_EPSILON &&
        centerX < openingMaxX - PLAN_MESH_EPSILON &&
        triangle.every((vertex) => Math.abs(vertex[1] - hullTopY) <= PLAN_MESH_EPSILON)
      );
    });
    expect(corridorTopTriangles.length).toBeGreaterThan(0);
    for (const triangle of corridorTopTriangles) {
      expect(Math.min(...triangle.map((vertex) => vertex[2]))).toBeGreaterThanOrEqual(
        edge.z - PLAN_MESH_EPSILON,
      );
    }
    const rails = new Map(GRAND_FERRY_SHIP_PLAN.rails.map((rail) => [rail.id, rail] as const));
    expect(rails.get('starboard')?.x).toBeCloseTo(deck.x, 12);
    expect(rails.get('starboard')?.hw).toBeCloseTo(deck.hw, 12);
    expect((rails.get('port-stern')?.x ?? 0) - (rails.get('port-stern')?.hw ?? 0)).toBeCloseTo(
      deckMinX,
      12,
    );
    expect((rails.get('port-stern')?.x ?? 0) + (rails.get('port-stern')?.hw ?? 0)).toBeCloseTo(
      openingMinX,
      12,
    );
    expect((rails.get('port-bow')?.x ?? 0) - (rails.get('port-bow')?.hw ?? 0)).toBeCloseTo(
      openingMaxX,
      12,
    );
    expect((rails.get('port-bow')?.x ?? 0) + (rails.get('port-bow')?.hw ?? 0)).toBeCloseTo(
      deckMaxX,
      12,
    );
    expect(rails.get('stern')?.x).toBeCloseTo(deckMinX, 12);
    expect(rails.get('bow')?.x).toBeCloseTo(deckMaxX, 12);

    const railVertices = worldVertices(requiredNode(nodes, 'GrandFerryRails'));
    const portVertices = railVertices.filter(
      ([, , z]) => Math.abs(z - edge.z) <= RAIL_SIDE_VERTEX_EPSILON,
    );
    expect(portVertices.some(([x]) => x < openingMinX)).toBe(true);
    expect(portVertices.some(([x]) => x > openingMaxX)).toBe(true);
    expect(
      portVertices.filter(
        ([x]) =>
          x > openingMinX + RAIL_GAP_INTERIOR_EPSILON &&
          x < openingMaxX - RAIL_GAP_INTERIOR_EPSILON,
      ),
    ).toHaveLength(0);
  });

  it('transforms the generated plan into both berths with flush ramps and open rail gaps', () => {
    for (const harbor of HARBORS) {
      expect(harbor.shipDecks).toHaveLength(1);
      expect(harbor.shipRails).toHaveLength(GRAND_FERRY_SHIP_PLAN.rails.length);
      expect(harbor.shipBlockers).toHaveLength(GRAND_FERRY_SHIP_PLAN.blockingVolumes.length);
      const scale = harbor.berth.length / GRAND_FERRY_SHIP_PLAN.model.length;
      const mirror = harbor.berth.mirrorZ ? -1 : 1;
      for (const [index, localRail] of GRAND_FERRY_SHIP_PLAN.rails.entries()) {
        const worldRail = harbor.shipRails[index];
        const center = expectedWorldPoint(harbor, localRail.x, localRail.z);
        expect(worldRail.x).toBeCloseTo(center.x, 12);
        expect(worldRail.z).toBeCloseTo(center.z, 12);
        expect(worldRail.hw).toBeCloseTo(localRail.hw * scale, 12);
        expect(worldRail.halfThickness).toBeCloseTo(localRail.halfThickness * scale, 12);
        expect(worldRail.rot).toBeCloseTo(harbor.berth.rot + localRail.rot * mirror, 12);
      }
      for (const [index, localBlocker] of GRAND_FERRY_SHIP_PLAN.blockingVolumes.entries()) {
        const worldBlocker = harbor.shipBlockers[index];
        const center = expectedWorldPoint(harbor, localBlocker.x, localBlocker.z);
        expect(worldBlocker.id).toBe(localBlocker.id);
        expect(worldBlocker.kind).toBe(localBlocker.kind);
        expect(worldBlocker.x).toBeCloseTo(center.x, 12);
        expect(worldBlocker.z).toBeCloseTo(center.z, 12);
        expect(worldBlocker.hw).toBeCloseTo(localBlocker.hw * scale, 12);
        expect(worldBlocker.hd).toBeCloseTo(localBlocker.hd * scale, 12);
        expect(worldBlocker.rot).toBeCloseTo(harbor.berth.rot + localBlocker.rot * mirror, 12);
        if (localBlocker.topY === null) {
          expect(worldBlocker.topY).toBeUndefined();
        } else {
          expect(worldBlocker.topY).toBe(expectedWorldY(harbor, localBlocker.topY));
        }
        expect(worldBlocker.cameraTopY).toBe(expectedWorldY(harbor, localBlocker.cameraTopY));
      }
      for (const kind of ['lower-hull', 'bow', 'stern', 'superstructure'] as const) {
        expect(harbor.shipBlockers.some((blocker) => blocker.kind === kind)).toBe(true);
      }
      const deck = harbor.shipDecks[0];
      expect(deck.y).toBe(GRAND_FERRY_SHIP_PLAN.standardBerth.deckWorldY);
      const ramp = harbor.ramps[harbor.ramps.length - 1];
      const edge = highEdge(ramp);
      const pierEdge = lowEdge(ramp);
      expect(ramp.highY).toBe(deck.y);
      const expectedHalfWidth =
        (GRAND_FERRY_SHIP_PLAN.rampMatingEdge.halfWidth * harbor.berth.length) /
        GRAND_FERRY_SHIP_PLAN.model.length;
      expect(ramp.dir === 'x+' || ramp.dir === 'x-' ? ramp.hd : ramp.hw).toBeCloseTo(
        expectedHalfWidth,
        12,
      );
      const edgeDistance = Math.min(
        Math.abs(edge.x - (deck.x - deck.hw)),
        Math.abs(edge.x - (deck.x + deck.hw)),
        Math.abs(edge.z - (deck.z - deck.hd)),
        Math.abs(edge.z - (deck.z + deck.hd)),
      );
      expect(edgeDistance).toBeLessThanOrEqual(RAMP_MATING_EPSILON);
      expect(harbor.shipRails.some((rail) => railContains(rail, edge))).toBe(false);
      for (const point of crossSectionPoints(ramp, edge)) {
        expect(harbor.shipRails.some((rail) => railContains(rail, point))).toBe(false);
      }
      for (const point of crossSectionPoints(ramp, pierEdge)) {
        expect(
          harbor.rails
            .map((rail, index) => ({ index, rail }))
            .filter(({ rail }) => railContains(rail, point))
            .map(({ index }) => index),
          `${harbor.id} pier rail overlaps ${point.x},${point.z}`,
        ).toEqual([]);
      }
      expect(
        harbor.shipBlockers.some((blocker) => blocker.kind === 'bow' && blocker.topY === undefined),
      ).toBe(true);
      expect(
        harbor.shipBlockers.some(
          (blocker) => blocker.kind === 'stern' && blocker.topY === undefined,
        ),
      ).toBe(true);
      expect(
        harbor.shipBlockers.some(
          (blocker) => blocker.kind === 'superstructure' && blocker.topY === undefined,
        ),
      ).toBe(true);

      const minX = Math.min(...harbor.shipBlockers.map((blocker) => blocker.x - blocker.hw));
      const maxX = Math.max(...harbor.shipBlockers.map((blocker) => blocker.x + blocker.hw));
      const minZ = Math.min(...harbor.shipBlockers.map((blocker) => blocker.z - blocker.hd));
      const maxZ = Math.max(...harbor.shipBlockers.map((blocker) => blocker.z + blocker.hd));
      const queried: Collider[] = [];
      queryOpenWorldColliders(42, minX, minZ, maxX, maxZ, queried);
      for (const blocker of harbor.shipBlockers) {
        expect(
          queried.some((collider) => colliderMatchesBlocker(collider, blocker)),
          `${harbor.id} ${blocker.id} is missing from runtime colliders`,
        ).toBe(true);
      }
    }
    expect(HARBORS[0].berth.mirrorZ).toBeUndefined();
    expect(HARBORS[1].berth.mirrorZ).toBe(true);
    expect(HARBORS[0].ramps.at(-1)?.z).toBe(-48.25);
    expect(HARBORS[1].ramps.at(-1)?.x).toBe(727.75);
  });
});
