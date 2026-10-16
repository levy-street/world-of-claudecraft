import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type Node, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import {
  BALGATH_BOULDER_CENTRE_TOLERANCE,
  BALGATH_BOULDER_FILE,
  BALGATH_BOULDER_MATERIALS,
  BALGATH_BOULDER_MAX_BYTES,
  BALGATH_BOULDER_NODES,
  BALGATH_BOULDER_ROOT,
} from '../scripts/assets/balgath_boulder/contract.mjs';
import {
  BALGATH_BOULDER_SOURCE_FILES,
  balgathBoulderSourceFingerprint,
} from '../scripts/assets/balgath_boulder/source_fingerprint.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';

// Balgath's Boulder Toss VFX kit (Blender factory at scripts/assets/balgath_boulder/
// model.py): ONE GLB whose eleven mesh NODE NAMES are the runtime contract the renderer
// reads (the hero boulder, six shatter chunks, four vortex splinters). Pins the source
// inventory, the live source fingerprint, and the shipped file byte for byte, then
// re-measures every node independently of the exporter. A change to any fingerprinted
// file means re-running scripts/assets/balgath_boulder/export_balgath_boulder.mjs, then
// `node scripts/build_media_manifest.mjs generate`, then re-pinning below from the
// summary the exporter prints (sizes stay put on a fingerprint-only re-export).

const REPO_ROOT = path.join(__dirname, '..');
const SOURCE_FINGERPRINT = '82b959b6a01a8b0761864e9cedce0ef1a197feb1872d34718ad26af094690ebe';
const BYTES = 132_792;
const SHA256 = '969cd01fd25c37c72098925b0c6668a9da0006fd04432cc33684695252ca3e4b';

interface NodePin {
  triangles: number;
  primitives: number;
  materials: string[];
}

const PINS: Record<string, NodePin> = {
  boulder: { triangles: 2112, primitives: 3, materials: ['granite', 'moss', 'soil'] },
  chunk_0: { triangles: 246, primitives: 2, materials: ['granite', 'moss'] },
  chunk_1: { triangles: 226, primitives: 1, materials: ['granite'] },
  chunk_2: { triangles: 232, primitives: 2, materials: ['granite', 'moss'] },
  chunk_3: { triangles: 234, primitives: 1, materials: ['granite'] },
  chunk_4: { triangles: 220, primitives: 2, materials: ['granite', 'moss'] },
  chunk_5: { triangles: 236, primitives: 1, materials: ['granite'] },
  shard_0: { triangles: 30, primitives: 1, materials: ['granite'] },
  shard_1: { triangles: 30, primitives: 1, materials: ['granite'] },
  shard_2: { triangles: 30, primitives: 1, materials: ['granite'] },
  shard_3: { triangles: 30, primitives: 1, materials: ['granite'] },
};

/** The names the renderer reads, spelled out rather than derived, so a contract edit
 *  that renames a node cannot silently re-pin itself. */
const RUNTIME_NAMES = [
  'boulder',
  'chunk_0',
  'chunk_1',
  'chunk_2',
  'chunk_3',
  'chunk_4',
  'chunk_5',
  'shard_0',
  'shard_1',
  'shard_2',
  'shard_3',
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

describe("Balgath's Boulder Toss VFX kit", () => {
  it('pins the deterministic source inventory, the live fingerprint and the optimizer spec', () => {
    expect(BALGATH_BOULDER_SOURCE_FILES).toEqual([
      'scripts/assets/balgath_boulder/model.py',
      'scripts/assets/balgath_boulder/contract.mjs',
      'scripts/assets/balgath_boulder/export_balgath_boulder.mjs',
      'scripts/assets/balgath_boulder/source_fingerprint.mjs',
      'scripts/assets/specs/balgath_boulder.json',
      'scripts/assets/build_assets.mjs',
      'pnpm-lock.yaml',
    ]);
    expect(balgathBoulderSourceFingerprint(REPO_ROOT)).toBe(SOURCE_FINGERPRINT);
    const spec = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'scripts/assets/specs/balgath_boulder.json'), 'utf8'),
    );
    expect(spec.items).toEqual([
      {
        src: 'tmp/asset_src/balgath_boulder/balgath_boulder.glb',
        out: BALGATH_BOULDER_FILE,
        type: 'static',
        keepExtras: true,
      },
    ]);
  });

  it('keeps the contract on exactly the node names the renderer reads', () => {
    expect(BALGATH_BOULDER_FILE).toBe('models/vfx/balgath_boulder.glb');
    expect(BALGATH_BOULDER_NODES.map((node) => node.name)).toEqual(RUNTIME_NAMES);
    expect(Object.keys(PINS)).toEqual(RUNTIME_NAMES);
    expect([...BALGATH_BOULDER_MATERIALS]).toEqual(['granite', 'moss', 'soil']);
  });

  it('pins the shipped file byte for byte and manifests it', () => {
    const bytes = readFileSync(path.join(REPO_ROOT, 'public', BALGATH_BOULDER_FILE));
    const sha = createHash('sha256').update(bytes).digest('hex');
    expect(bytes.length).toBe(BYTES);
    expect(sha).toBe(SHA256);
    expect(bytes.length).toBeLessThanOrEqual(BALGATH_BOULDER_MAX_BYTES);
    expect(MEDIA_ASSETS[BALGATH_BOULDER_FILE]).toBe(
      `/media/models/vfx/balgath_boulder.${sha.slice(0, 12)}.glb`,
    );
  });

  it('ships a texture-free, meshopt, fingerprinted kit under one root', async () => {
    const bytes = readFileSync(path.join(REPO_ROOT, 'public', BALGATH_BOULDER_FILE));
    const root = (await (await io()).readBinary(bytes)).getRoot();
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
    expect(sceneRoots.map((node) => node.getName())).toEqual([BALGATH_BOULDER_ROOT]);
    expect(sceneRoots[0].getExtras().sculptRuntime).toMatchObject({
      schemaVersion: 1,
      assetId: 'balgath-boulder-toss-kit',
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

  for (const contract of BALGATH_BOULDER_NODES) {
    it(`pins ${contract.name}: triangles, materials, COLOR_0, centred, sized`, async () => {
      const pin = PINS[contract.name];
      const bytes = readFileSync(path.join(REPO_ROOT, 'public', BALGATH_BOULDER_FILE));
      const root = (await (await io()).readBinary(bytes)).getRoot();
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
      for (const name of materials) expect(BALGATH_BOULDER_MATERIALS).toContain(name);

      // Measured in world space, independently of the exporter's own check.
      const { tris, points } = worldTriangles(node);
      const radius = Math.max(...points.map((p) => Math.hypot(...p)));
      const min = [0, 1, 2].map((k) => Math.min(...points.map((p) => p[k])));
      const max = [0, 1, 2].map((k) => Math.max(...points.map((p) => p[k])));
      const length = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
      const size = contract.role === 'shard' ? length : radius;
      const centroid = surfaceCentroid(tris);
      expect(
        Math.hypot(...centroid),
        `${contract.name} is not centred on its own surface centroid`,
      ).toBeLessThanOrEqual(BALGATH_BOULDER_CENTRE_TOLERANCE * size);
      if (contract.role === 'shard') {
        expect(length).toBeGreaterThanOrEqual(0.47);
        expect(length).toBeLessThanOrEqual(0.53);
        // a splinter, not a pebble: much longer than it is thick
        const sorted = [max[0] - min[0], max[1] - min[1], max[2] - min[2]].sort((a, b) => a - b);
        expect(sorted[0] / sorted[2]).toBeLessThan(0.35);
      } else if (contract.role === 'chunk') {
        expect(radius).toBeGreaterThanOrEqual(0.25);
        expect(radius).toBeLessThanOrEqual(0.45);
      } else {
        expect(radius).toBeGreaterThanOrEqual(0.97);
        expect(radius).toBeLessThanOrEqual(1.03);
      }
    });
  }

  it('sizes the chunks apart so the shatter reads as a burst, not six clones', async () => {
    const bytes = readFileSync(path.join(REPO_ROOT, 'public', BALGATH_BOULDER_FILE));
    const root = (await (await io()).readBinary(bytes)).getRoot();
    const radii = root
      .listNodes()
      .filter((node) => /^chunk_\d$/.test(node.getName()))
      .map((node) => Math.max(...worldTriangles(node).points.map((p) => Math.hypot(...p))));
    expect(radii).toHaveLength(6);
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.12);
    expect(new Set(radii.map((r) => r.toFixed(2))).size).toBe(6);
  });
});
