import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type Node, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import {
  BALGATH_STARWAKE_CENTRE_TOLERANCE,
  BALGATH_STARWAKE_FILE,
  BALGATH_STARWAKE_MATERIALS,
  BALGATH_STARWAKE_MAX_BYTES,
  BALGATH_STARWAKE_MAX_TRIANGLES,
  BALGATH_STARWAKE_NODES,
  BALGATH_STARWAKE_ROOT,
} from '../scripts/assets/balgath_starwake/contract.mjs';
import {
  BALGATH_STARWAKE_SOURCE_FILES,
  balgathStarwakeSourceFingerprint,
} from '../scripts/assets/balgath_starwake/source_fingerprint.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import {
  BALGATH_LAVA_CHUNKS,
  BALGATH_POOL_CRUSTS,
  BALGATH_STAR_CRYSTALS,
  balgathGeyserColumnGeometry,
  balgathLavaChunkGeometry,
  balgathPoolCrustGeometry,
  balgathStarCrystalGeometry,
} from '../src/render/balgath_starwake_kit';

// Balgath's Starwake VFX kit (Blender factory at scripts/assets/balgath_starwake/
// model.py): ONE GLB whose seventeen mesh NODE NAMES are the runtime contract the
// renderer reads (six star crystals, six lava chunks, four pool crusts, the geyser
// column). Pins the source inventory, the live source fingerprint, and the shipped file
// byte for byte, then re-measures every node independently of the exporter. A change to
// any fingerprinted file means re-running
// scripts/assets/balgath_starwake/export_balgath_starwake.mjs, then
// `node scripts/build_media_manifest.mjs generate`, then re-pinning below from the
// summary the exporter prints (sizes stay put on a fingerprint-only re-export).

const REPO_ROOT = path.join(__dirname, '..');
const SOURCE_FINGERPRINT = '7d144bb5ffa9c5146500a03727e5d73eb9ae177343742e3d9ea24e08ed0264c7';
const BYTES = 109_920;
const SHA256 = 'a7c17ce025b57a34f377df124d02b1e6581c82d0b0d54b362a0c802957b938d9';

interface NodePin {
  triangles: number;
  primitives: number;
  materials: string[];
}

const CRYSTAL = ['crystal'];
const CRUST = ['basalt', 'ember'];

const PINS: Record<string, NodePin> = {
  star_crystal_0: { triangles: 78, primitives: 1, materials: CRYSTAL },
  star_crystal_1: { triangles: 40, primitives: 1, materials: CRYSTAL },
  star_crystal_2: { triangles: 48, primitives: 1, materials: CRYSTAL },
  star_crystal_3: { triangles: 70, primitives: 1, materials: CRYSTAL },
  star_crystal_4: { triangles: 48, primitives: 1, materials: CRYSTAL },
  star_crystal_5: { triangles: 48, primitives: 1, materials: CRYSTAL },
  lava_chunk_0: { triangles: 208, primitives: 2, materials: CRUST },
  lava_chunk_1: { triangles: 216, primitives: 2, materials: CRUST },
  lava_chunk_2: { triangles: 212, primitives: 2, materials: CRUST },
  lava_chunk_3: { triangles: 216, primitives: 2, materials: CRUST },
  lava_chunk_4: { triangles: 204, primitives: 2, materials: CRUST },
  lava_chunk_5: { triangles: 216, primitives: 2, materials: CRUST },
  pool_crust_0: { triangles: 180, primitives: 2, materials: CRUST },
  pool_crust_1: { triangles: 160, primitives: 2, materials: CRUST },
  pool_crust_2: { triangles: 160, primitives: 2, materials: CRUST },
  pool_crust_3: { triangles: 180, primitives: 2, materials: CRUST },
  geyser_column: { triangles: 616, primitives: 1, materials: ['ember'] },
};

/** The names the renderer reads, spelled out rather than derived, so a contract edit
 *  that renames a node cannot silently re-pin itself. */
const RUNTIME_NAMES = [
  'star_crystal_0',
  'star_crystal_1',
  'star_crystal_2',
  'star_crystal_3',
  'star_crystal_4',
  'star_crystal_5',
  'lava_chunk_0',
  'lava_chunk_1',
  'lava_chunk_2',
  'lava_chunk_3',
  'lava_chunk_4',
  'lava_chunk_5',
  'pool_crust_0',
  'pool_crust_1',
  'pool_crust_2',
  'pool_crust_3',
  'geyser_column',
];

async function io(): Promise<NodeIO> {
  await MeshoptDecoder.ready;
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
}

type Vec3 = [number, number, number];

function transformPoint(m: ArrayLike<number>, p: ArrayLike<number>): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/** Every triangle of a node's mesh in WORLD space (the meshopt quantization lives in the
 *  node transform, which is exactly what the renderer must honour too). */
function worldTriangles(node: Node): { tris: Vec3[][]; points: Vec3[] } {
  const world = node.getWorldMatrix();
  const tris: Vec3[][] = [];
  const points: Vec3[] = [];
  for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
    const position = primitive.getAttribute('POSITION');
    if (!position) continue;
    const local: Vec3[] = [];
    const el = [0, 0, 0];
    for (let i = 0; i < position.getCount(); i++) {
      local.push(transformPoint(world, position.getElement(i, el)));
    }
    points.push(...local);
    const indices = primitive.getIndices();
    const count = indices ? indices.getCount() : position.getCount();
    for (let t = 0; t < count; t += 3) {
      tris.push([0, 1, 2].map((k) => local[indices ? indices.getScalar(t + k) : t + k]));
    }
  }
  return { tris, points };
}

function surfaceCentroid(tris: Vec3[][]): Vec3 {
  const acc: Vec3 = [0, 0, 0];
  let total = 0;
  for (const [a, b, c] of tris) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const area =
      Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) /
      2;
    total += area;
    for (let k = 0; k < 3; k++) acc[k] += ((a[k] + b[k] + c[k]) / 3) * area;
  }
  return [acc[0] / total, acc[1] / total, acc[2] / total];
}

function bounds(points: Vec3[]): { min: number[]; max: number[]; extent: number[] } {
  const min = [0, 1, 2].map((k) => Math.min(...points.map((p) => p[k])));
  const max = [0, 1, 2].map((k) => Math.max(...points.map((p) => p[k])));
  return { min, max, extent: [0, 1, 2].map((k) => max[k] - min[k]) };
}

async function shippedRoot() {
  const bytes = readFileSync(path.join(REPO_ROOT, 'public', BALGATH_STARWAKE_FILE));
  return (await (await io()).readBinary(bytes)).getRoot();
}

describe("Balgath's Starwake VFX kit", () => {
  it('pins the deterministic source inventory, the live fingerprint and the optimizer spec', () => {
    expect(BALGATH_STARWAKE_SOURCE_FILES).toEqual([
      'scripts/assets/balgath_starwake/model.py',
      'scripts/assets/balgath_starwake/contract.mjs',
      'scripts/assets/balgath_starwake/export_balgath_starwake.mjs',
      'scripts/assets/balgath_starwake/source_fingerprint.mjs',
      'scripts/assets/specs/balgath_starwake.json',
      'scripts/assets/build_assets.mjs',
      'pnpm-lock.yaml',
    ]);
    expect(balgathStarwakeSourceFingerprint(REPO_ROOT)).toBe(SOURCE_FINGERPRINT);
    const spec = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'scripts/assets/specs/balgath_starwake.json'), 'utf8'),
    );
    expect(spec.items).toEqual([
      {
        src: 'tmp/asset_src/balgath_starwake/balgath_starwake.glb',
        out: BALGATH_STARWAKE_FILE,
        type: 'static',
        keepExtras: true,
      },
    ]);
  });

  it('keeps the contract on exactly the node names the renderer reads', () => {
    expect(BALGATH_STARWAKE_FILE).toBe('models/vfx/balgath_starwake.glb');
    expect(BALGATH_STARWAKE_NODES.map((node) => node.name)).toEqual(RUNTIME_NAMES);
    expect(Object.keys(PINS)).toEqual(RUNTIME_NAMES);
    expect([...BALGATH_STARWAKE_MATERIALS]).toEqual(['basalt', 'crystal', 'ember']);
    expect(BALGATH_STARWAKE_MAX_TRIANGLES).toBe(4000);
    const total = Object.values(PINS).reduce((sum, pin) => sum + pin.triangles, 0);
    expect(total).toBeLessThanOrEqual(BALGATH_STARWAKE_MAX_TRIANGLES);
  });

  it('pins the shipped file byte for byte and manifests it', () => {
    const bytes = readFileSync(path.join(REPO_ROOT, 'public', BALGATH_STARWAKE_FILE));
    const sha = createHash('sha256').update(bytes).digest('hex');
    expect(bytes.length).toBe(BYTES);
    expect(sha).toBe(SHA256);
    expect(bytes.length).toBeLessThanOrEqual(BALGATH_STARWAKE_MAX_BYTES);
    expect(MEDIA_ASSETS[BALGATH_STARWAKE_FILE]).toBe(
      `/media/models/vfx/balgath_starwake.${sha.slice(0, 12)}.glb`,
    );
  });

  it('ships a texture-free, meshopt, fingerprinted kit under one root', async () => {
    const root = await shippedRoot();
    expect(
      root
        .listExtensionsUsed()
        .map((extension) => extension.extensionName)
        .sort(),
    ).toEqual(['EXT_meshopt_compression', 'KHR_mesh_quantization']);
    expect(root.listTextures()).toHaveLength(0);
    expect(root.listAnimations()).toHaveLength(0);
    expect(root.listSkins()).toHaveLength(0);
    expect(root.listScenes()).toHaveLength(1);
    const sceneRoots = root.listScenes()[0].listChildren();
    expect(sceneRoots.map((node) => node.getName())).toEqual([BALGATH_STARWAKE_ROOT]);
    expect(sceneRoots[0].getExtras().sculptRuntime).toMatchObject({
      schemaVersion: 1,
      assetId: 'balgath-starwake-kit',
      stage: 'final',
    });
    expect(
      sceneRoots[0]
        .listChildren()
        .map((node) => node.getName())
        .sort(),
    ).toEqual([...RUNTIME_NAMES].sort());
    expect(root.getExtras().sourceFingerprint).toBe(SOURCE_FINGERPRINT);
    expect(
      (root.getAsset().extras as { sourceFingerprint?: string } | undefined)?.sourceFingerprint,
    ).toBe(SOURCE_FINGERPRINT);
  });

  for (const contract of BALGATH_STARWAKE_NODES) {
    it(`pins ${contract.name}: triangles, materials, COLOR_0, anchored, sized`, async () => {
      const pin = PINS[contract.name];
      const root = await shippedRoot();
      const matches = root.listNodes().filter((node) => node.getName() === contract.name);
      expect(matches, `exactly one node named ${contract.name}`).toHaveLength(1);
      const node = matches[0];
      const mesh = node.getMesh();
      expect(mesh, `${contract.name} carries no mesh`).not.toBeNull();

      let triangles = 0;
      const materials = new Set<string>();
      const primitives = mesh?.listPrimitives() ?? [];
      for (const primitive of primitives) {
        const position = primitive.getAttribute('POSITION');
        triangles += (primitive.getIndices()?.getCount() ?? position?.getCount() ?? 0) / 3;
        expect(
          primitive.getAttribute('COLOR_0'),
          `${contract.name} primitive without COLOR_0`,
        ).not.toBeNull();
        materials.add(primitive.getMaterial()?.getName() ?? '');
      }
      expect(triangles).toBe(pin.triangles);
      expect(triangles).toBeLessThanOrEqual(contract.maxTriangles);
      expect(primitives).toHaveLength(pin.primitives);
      expect([...materials].sort()).toEqual(pin.materials);
      for (const name of materials) expect(BALGATH_STARWAKE_MATERIALS).toContain(name);

      // Measured in world space, independently of the exporter's own check.
      const { tris, points } = worldTriangles(node);
      const { min, max, extent } = bounds(points);
      const tol = BALGATH_STARWAKE_CENTRE_TOLERANCE;
      if (contract.anchor === 'base') {
        const height = extent[1];
        expect(Math.abs(min[1]), `${contract.name} base is not on y = 0`).toBeLessThanOrEqual(
          tol * height,
        );
        expect(
          Math.hypot((min[0] + max[0]) / 2, (min[2] + max[2]) / 2),
          `${contract.name} footprint is not centred in x/z`,
        ).toBeLessThanOrEqual(tol * height);
        expect(height).toBeGreaterThanOrEqual(contract.minHeight ?? 0);
        expect(height).toBeLessThanOrEqual(contract.maxHeight ?? 0);
        const footprint = Math.max(extent[0], extent[2]) / height;
        expect(footprint).toBeGreaterThanOrEqual(contract.minFootprint ?? 0);
        expect(footprint).toBeLessThanOrEqual(contract.maxFootprint ?? 0);
      } else {
        const radius = Math.max(...points.map((p) => Math.hypot(...p)));
        const length = Math.max(...extent);
        const size = contract.role === 'crust' ? length : radius;
        expect(
          Math.hypot(...surfaceCentroid(tris)),
          `${contract.name} is not centred on its own surface centroid`,
        ).toBeLessThanOrEqual(tol * size);
        if (contract.role === 'chunk') {
          expect(radius).toBeGreaterThanOrEqual(0.25);
          expect(radius).toBeLessThanOrEqual(0.45);
        } else {
          // flat in XZ: the thin axis is y
          expect(length).toBeGreaterThanOrEqual(0.9);
          expect(length).toBeLessThanOrEqual(1.3);
          expect(extent[1]).toBeGreaterThanOrEqual(0.06);
          expect(extent[1]).toBeLessThanOrEqual(0.14);
          expect(extent[1]).toBeLessThan(Math.min(extent[0], extent[2]));
        }
      }
    });
  }

  it('grades each crystal from a red base to a pale gold tip', async () => {
    const root = await shippedRoot();
    for (let i = 0; i < 6; i++) {
      const node = root.listNodes().find((n) => n.getName() === `star_crystal_${i}`);
      const primitive = node?.getMesh()?.listPrimitives()[0];
      const position = primitive?.getAttribute('POSITION');
      const color = primitive?.getAttribute('COLOR_0');
      expect(position && color).toBeTruthy();
      if (!position || !color) continue;
      let low = { y: Infinity, c: [0, 0, 0] };
      let high = { y: -Infinity, c: [0, 0, 0] };
      const p = [0, 0, 0];
      for (let v = 0; v < position.getCount(); v++) {
        position.getElement(v, p);
        const c = color.getElement(v, [0, 0, 0, 0]);
        if (p[1] < low.y) low = { y: p[1], c: [...c] };
        if (p[1] > high.y) high = { y: p[1], c: [...c] };
      }
      // tip: near white (all channels high); base: red dominant, blue low
      expect(Math.min(high.c[0], high.c[1], high.c[2])).toBeGreaterThan(0.45);
      expect(low.c[0]).toBeGreaterThan(low.c[2] * 4);
      expect(low.c[1]).toBeLessThan(0.3);
    }
  });

  it('sizes the chunks and crystals apart so no two read as clones', async () => {
    const root = await shippedRoot();
    const measure = (re: RegExp, f: (points: Vec3[]) => number) =>
      root
        .listNodes()
        .filter((node) => re.test(node.getName()))
        .map((node) => f(worldTriangles(node).points));
    const radii = measure(/^lava_chunk_\d$/, (pts) =>
      Math.max(...pts.map((p) => Math.hypot(...p))),
    );
    expect(radii).toHaveLength(6);
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.12);
    expect(new Set(radii.map((r) => r.toFixed(2))).size).toBe(6);
    const heights = measure(/^star_crystal_\d$/, (pts) => bounds(pts).extent[1]);
    expect(heights).toHaveLength(6);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.6);
    expect(new Set(heights.map((h) => h.toFixed(2))).size).toBe(6);
  });
});

describe('the Starwake kit loader stand-ins (Node, no GLB)', () => {
  const attrs = (g: { attributes: Record<string, unknown> }) => Object.keys(g.attributes).sort();

  it('hands back the loaded attribute set: position, normal, color', () => {
    const all = [
      ...Array.from({ length: BALGATH_STAR_CRYSTALS }, (_, i) => balgathStarCrystalGeometry(i)),
      ...Array.from({ length: BALGATH_LAVA_CHUNKS }, (_, i) => balgathLavaChunkGeometry(i)),
      ...Array.from({ length: BALGATH_POOL_CRUSTS }, (_, i) => balgathPoolCrustGeometry(i)),
      balgathGeyserColumnGeometry(),
    ];
    for (const g of all) expect(attrs(g)).toEqual(['color', 'normal', 'position']);
  });

  it('anchors the crystals and column at the base and centres the chunks and crusts', () => {
    for (let i = 0; i < BALGATH_STAR_CRYSTALS; i++) {
      const g = balgathStarCrystalGeometry(i);
      g.computeBoundingBox();
      expect(g.boundingBox?.min.y).toBeCloseTo(0, 5);
    }
    const column = balgathGeyserColumnGeometry();
    column.computeBoundingBox();
    expect(column.boundingBox?.min.y).toBeCloseTo(0, 5);
    expect(column.boundingBox?.max.y).toBeCloseTo(1, 3);
    const crust = balgathPoolCrustGeometry(0);
    crust.computeBoundingBox();
    const box = crust.boundingBox;
    expect(box).not.toBeNull();
    if (box) {
      expect(box.max.y - box.min.y).toBeLessThan(box.max.x - box.min.x);
      expect(Math.abs(box.max.y + box.min.y)).toBeLessThan(1e-3);
    }
    expect(balgathLavaChunkGeometry(7)).toBe(balgathLavaChunkGeometry(1));
  });
});
