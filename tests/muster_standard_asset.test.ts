import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type Node, NodeIO, type Root } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { MUSTER_STANDARD as K } from '../scripts/assets/muster_standard/contract.mjs';
import {
  MUSTER_STANDARD_SOURCE_FILES,
  musterStandardSourceFingerprint,
} from '../scripts/assets/muster_standard/source_fingerprint.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';

// The Fenbridge muster standard (Blender factory at scripts/assets/muster_standard/model.py): ONE GLB whose NODE
// NAMES are the runtime contract (see contract.mjs). Pins the source inventory, the live
// source fingerprint, and the shipped file byte for byte, then re-measures every node
// independently of the exporter. A change to any fingerprinted file means re-running
// scripts/assets/muster_standard/export_muster_standard.mjs, then
// `node scripts/build_media_manifest.mjs generate`, then re-pinning below from the
// summary the exporter prints (sizes stay put on a fingerprint-only re-export).

const REPO_ROOT = path.join(__dirname, '..');
const SOURCE_FINGERPRINT = '1a7e09657c28f212277d2598b3fa26b220b8cce1f5d7945206891deb0fb43e23';
const BYTES = 45_844;
const SHA256 = 'acb85918c11fa0d775962c858ff07335992eedfba58d89eb641a27fb90175641';

interface NodePin {
  triangles: number;
  primitives: number;
  materials: string[];
}

const PINS: Record<string, NodePin> = {
  Standard_Pole: {
    triangles: 742,
    primitives: 5,
    materials: ['MusterBrass', 'MusterCloth', 'MusterIron', 'MusterLeather', 'MusterOak'],
  },
  Standard_Banner_Cloth: { triangles: 776, primitives: 1, materials: ['MusterCloth'] },
  Standard_Finial: { triangles: 124, primitives: 1, materials: ['MusterBrass'] },
};

/** Every named node, spelled out rather than derived, so a contract edit that renames a
 *  node cannot silently re-pin itself. */
const RUNTIME_NAMES = [
  'Standard_Pole',
  'Standard_Banner',
  'Standard_Banner_Cloth',
  'Standard_Finial',
];
const MATERIALS = ['MusterOak', 'MusterIron', 'MusterBrass', 'MusterLeather', 'MusterCloth'];
const GLOW_MATERIALS = [] as string[];
/** The shipped world bounds (glTF frame, +Y up, +Z front). */
const BOUNDS = { min: [-0.7349, 0, -0.2225], max: [0.7349, 3.3, 0.1491] };

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

/** Every vertex of a node's mesh in WORLD space (the meshopt quantization lives in the
 *  node transform, which is exactly what the renderer must honour too). */
function worldPoints(node: Node): Vec3[] {
  const world = node.getWorldMatrix();
  const points: Vec3[] = [];
  for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
    const position = primitive.getAttribute('POSITION');
    if (!position) continue;
    const el = [0, 0, 0];
    for (let i = 0; i < position.getCount(); i++) {
      points.push(transformPoint(world, position.getElement(i, el)));
    }
  }
  return points;
}

function bounds(points: Vec3[]): { min: number[]; max: number[] } {
  return {
    min: [0, 1, 2].map((k) => Math.min(...points.map((p) => p[k]))),
    max: [0, 1, 2].map((k) => Math.max(...points.map((p) => p[k]))),
  };
}

function shippedBytes(): Buffer {
  return readFileSync(path.join(REPO_ROOT, 'public', K.file));
}

async function shippedRoot(): Promise<Root> {
  return (await (await io()).readBinary(shippedBytes())).getRoot();
}

function named(root: Root, name: string): Node {
  const matches = root.listNodes().filter((node) => node.getName() === name);
  expect(matches, `exactly one node named ${name}`).toHaveLength(1);
  return matches[0];
}

describe('The Fenbridge muster standard', () => {
  it('pins the deterministic source inventory, the live fingerprint and the optimizer spec', () => {
    expect(MUSTER_STANDARD_SOURCE_FILES).toEqual([
      'scripts/assets/muster_standard/model.py',
      'scripts/assets/muster_standard/contract.mjs',
      'scripts/assets/muster_standard/export_muster_standard.mjs',
      'scripts/assets/muster_standard/source_fingerprint.mjs',
      'scripts/assets/specs/muster_standard.json',
      'scripts/assets/build_assets.mjs',
      'pnpm-lock.yaml',
    ]);
    expect(musterStandardSourceFingerprint(REPO_ROOT)).toBe(SOURCE_FINGERPRINT);
    const spec = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'scripts/assets/specs/muster_standard.json'), 'utf8'),
    );
    expect(spec.items).toEqual([
      {
        src: 'tmp/asset_src/muster_standard/muster_standard.glb',
        out: K.file,
        type: 'static',
        keepExtras: true,
      },
    ]);
  });

  it('keeps the contract on exactly the names the renderer reads', () => {
    expect(K.file).toBe('models/vfx/muster_standard.glb');
    expect(K.root).toBe('Muster_Standard');
    expect(K.nodes.map((node) => node.name)).toEqual(RUNTIME_NAMES);
    expect(Object.keys(PINS)).toEqual(K.nodes.filter((node) => node.mesh).map((n) => n.name));
    expect([...K.materials]).toEqual(MATERIALS);
    expect([...K.glowMaterials]).toEqual(GLOW_MATERIALS);
    const total = Object.values(PINS).reduce((sum, pin) => sum + pin.triangles, 0);
    expect(total).toBe(1642);
    expect(total).toBeLessThanOrEqual(K.maxTriangles);
  });

  it('pins the shipped file byte for byte', () => {
    const bytes = shippedBytes();
    expect(bytes.length).toBe(BYTES);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(SHA256);
    expect(bytes.length).toBeLessThanOrEqual(K.maxBytes);
  });

  it('manifests the shipped file under its content hash', () => {
    expect(MEDIA_ASSETS[K.file]).toBe(
      `/media/models/vfx/muster_standard.${SHA256.slice(0, 12)}.glb`,
    );
  });

  it('ships a texture-free, unanimated, meshopt, fingerprinted file under one root', async () => {
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
    expect(sceneRoots.map((node) => node.getName())).toEqual([K.root]);
    expect(sceneRoots[0].getMesh()).toBeNull();
    expect(sceneRoots[0].getExtras().sculptRuntime).toMatchObject({
      schemaVersion: 1,
      assetId: K.assetId,
      stage: 'final',
    });
    for (const contract of K.nodes) {
      const node = named(root, contract.name);
      expect(node.getParentNode()?.getName(), `${contract.name} parent`).toBe(contract.parent);
      expect(node.getMesh() !== null, `${contract.name} mesh presence`).toBe(contract.mesh);
    }
    // no stray mesh node outside the contract
    expect(
      root
        .listNodes()
        .filter((node) => node.getMesh())
        .map((node) => node.getName())
        .sort(),
    ).toEqual(Object.keys(PINS).sort());
    expect(root.getExtras().sourceFingerprint).toBe(SOURCE_FINGERPRINT);
    expect(
      (root.getAsset().extras as { sourceFingerprint?: string } | undefined)?.sourceFingerprint,
    ).toBe(SOURCE_FINGERPRINT);
  });

  it('keeps every material bucket, the glow ones emissive and the rest not', async () => {
    const root = await shippedRoot();
    const materials = root.listMaterials();
    expect(materials.map((m) => m.getName()).sort()).toEqual([...MATERIALS].sort());
    for (const material of materials) {
      const glowing = Math.max(...material.getEmissiveFactor()) > 0;
      expect(glowing, `${material.getName()} emissive`).toBe(
        GLOW_MATERIALS.includes(material.getName()),
      );
    }
  });

  for (const [name, pin] of Object.entries(PINS)) {
    it(`pins ${name}: triangles, primitives, materials, COLOR_0`, async () => {
      const root = await shippedRoot();
      const contract = K.nodes.find((node) => node.name === name);
      const primitives = named(root, name).getMesh()?.listPrimitives() ?? [];
      let triangles = 0;
      const materials = new Set<string>();
      for (const primitive of primitives) {
        const position = primitive.getAttribute('POSITION');
        triangles += (primitive.getIndices()?.getCount() ?? position?.getCount() ?? 0) / 3;
        expect(
          primitive.getAttribute('COLOR_0'),
          `${name} primitive without COLOR_0`,
        ).not.toBeNull();
        materials.add(primitive.getMaterial()?.getName() ?? '');
      }
      expect(triangles).toBe(pin.triangles);
      expect(triangles).toBeLessThanOrEqual(contract?.maxTriangles ?? 0);
      expect(primitives).toHaveLength(pin.primitives);
      expect([...materials].sort()).toEqual(pin.materials);
    });
  }

  it('holds the anchors and the world bounds', async () => {
    const root = await shippedRoot();
    for (const [name, at] of Object.entries(K.anchors)) {
      const node = named(root, name);
      expect(node.getMesh(), `${name} is an empty`).toBeNull();
      const translation = node.getTranslation();
      for (let k = 0; k < 3; k++) expect(translation[k]).toBeCloseTo(at[k], 4);
      expect([...node.getRotation()]).toEqual([0, 0, 0, 1]);
      expect([...node.getScale()]).toEqual([1, 1, 1]);
    }
    const points = Object.keys(PINS).flatMap((name) => worldPoints(named(root, name)));
    const box = bounds(points);
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(box.min[k] - BOUNDS.min[k]), `min[${k}]`).toBeLessThanOrEqual(0.002);
      expect(Math.abs(box.max[k] - BOUNDS.max[k]), `max[${k}]`).toBeLessThanOrEqual(0.002);
      expect(Math.abs(box.min[k] - K.bounds.min[k])).toBeLessThanOrEqual(K.bounds.tolerance);
      expect(Math.abs(box.max[k] - K.bounds.max[k])).toBeLessThanOrEqual(K.bounds.tolerance);
    }
  });

  it('hangs the banner cloth from the crossbar pivot, in front of the pole', async () => {
    const root = await shippedRoot();
    const pivot = named(root, 'Standard_Banner');
    const [px, py, pz] = pivot.getWorldMatrix().slice(12, 15);
    expect([px, py, pz]).toEqual([0, 2.85, 0.074].map((v) => expect.closeTo(v, 4)));
    const cloth = bounds(worldPoints(named(root, 'Standard_Banner_Cloth')));
    // the tabs wrap the crossbar just over the pivot and the notched hem hangs 1.6 below
    expect(cloth.max[1] - py).toBeGreaterThan(0.02);
    expect(cloth.max[1] - py).toBeLessThan(0.05);
    expect(py - cloth.min[1]).toBeGreaterThan(1.55);
    expect(py - cloth.min[1]).toBeLessThan(1.7);
    // where it crosses the pole, the cloth stays in front (+Z) of the pole, its iron
    // bands and its leather grip (the tabs round the bar are spaced clear of it)
    const inBand = (p: Vec3) => Math.abs(p[0]) < 0.07 && p[1] > cloth.min[1] && p[1] < py - 0.1;
    const pole = worldPoints(named(root, 'Standard_Pole')).filter(inBand);
    const hang = worldPoints(named(root, 'Standard_Banner_Cloth')).filter(inBand);
    expect(pole.length).toBeGreaterThan(0);
    expect(hang.length).toBeGreaterThan(0);
    // at every height, each cloth point stands in front of the pole's front face there
    // (the ribbons tied under the finial hang BEHIND the pole, so they never count)
    let checked = 0;
    for (const h of hang) {
      const near = pole.filter((p) => Math.abs(p[1] - h[1]) < 0.03 && p[2] >= 0);
      if (near.length === 0) continue;
      checked++;
      const front = Math.max(...near.map((p) => p[2]));
      expect(h[2], `cloth at y ${h[1].toFixed(3)}`).toBeGreaterThan(front);
    }
    expect(checked).toBeGreaterThan(20);
    // planted: the spike point is the lowest point, on the origin
    const low = bounds(worldPoints(named(root, 'Standard_Pole'))).min;
    expect(low[1]).toBeCloseTo(0, 3);
  });
});
