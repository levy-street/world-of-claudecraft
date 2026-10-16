import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type Node, NodeIO, type Root } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { CRATERGLASS_STAVE as K } from '../scripts/assets/craterglass_stave/contract.mjs';
import {
  CRATERGLASS_STAVE_SOURCE_FILES,
  craterglassStaveSourceFingerprint,
} from '../scripts/assets/craterglass_stave/source_fingerprint.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { VARIANT_GRIPS } from '../src/render/characters/assets';

// The Craterglass Stave (Blender factory at scripts/assets/craterglass_stave/model.py): ONE GLB whose NODE
// NAMES are the runtime contract (see contract.mjs). Pins the source inventory, the live
// source fingerprint, and the shipped file byte for byte, then re-measures every node
// independently of the exporter. A change to any fingerprinted file means re-running
// scripts/assets/craterglass_stave/export_craterglass_stave.mjs, then
// `node scripts/build_media_manifest.mjs generate`, then re-pinning below from the
// summary the exporter prints (sizes stay put on a fingerprint-only re-export).

const REPO_ROOT = path.join(__dirname, '..');
const SOURCE_FINGERPRINT = 'bcf69ed37e5647bf2c642fa8470f1c5de0d1603209fbcb404a9f88d0904c2bf3';
const BYTES = 38_780;
const SHA256 = '5748f167400f83f165a9d700b5818061be4720197ce724ef310a4b24e16a5fc2';

interface NodePin {
  triangles: number;
  primitives: number;
  materials: string[];
}

const PINS: Record<string, NodePin> = {
  Stave_Shaft: {
    triangles: 838,
    primitives: 4,
    materials: ['StaveBogOak', 'StaveBronze', 'StaveIron', 'StaveLeather'],
  },
  Stave_Head: {
    triangles: 552,
    primitives: 3,
    materials: ['StaveBronze', 'StaveGlass', 'StaveGlow'],
  },
};

/** Every named node, spelled out rather than derived, so a contract edit that renames a
 *  node cannot silently re-pin itself. */
const RUNTIME_NAMES = ['Stave_Shaft', 'Stave_Head', 'Socket_Core'];
const MATERIALS = [
  'StaveBogOak',
  'StaveIron',
  'StaveBronze',
  'StaveLeather',
  'StaveGlass',
  'StaveGlow',
];
const GLOW_MATERIALS = ['StaveGlow'];
/** The shipped world bounds (glTF frame, +Y up, +Z front). */
const BOUNDS = { min: [-0.1544, -0.912, -0.0993], max: [0.1557, 1.368, 0.1289] };

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

describe('The Craterglass Stave', () => {
  it('pins the deterministic source inventory, the live fingerprint and the optimizer spec', () => {
    expect(CRATERGLASS_STAVE_SOURCE_FILES).toEqual([
      'scripts/assets/craterglass_stave/model.py',
      'scripts/assets/craterglass_stave/contract.mjs',
      'scripts/assets/craterglass_stave/export_craterglass_stave.mjs',
      'scripts/assets/craterglass_stave/source_fingerprint.mjs',
      'scripts/assets/specs/craterglass_stave.json',
      'scripts/assets/build_assets.mjs',
      'pnpm-lock.yaml',
    ]);
    expect(craterglassStaveSourceFingerprint(REPO_ROOT)).toBe(SOURCE_FINGERPRINT);
    const spec = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'scripts/assets/specs/craterglass_stave.json'), 'utf8'),
    );
    expect(spec.items).toEqual([
      {
        src: 'tmp/asset_src/craterglass_stave/craterglass_stave.glb',
        out: K.file,
        type: 'static',
        keepExtras: true,
      },
    ]);
  });

  it('keeps the contract on exactly the names the renderer reads', () => {
    expect(K.file).toBe('models/weapons/craterglass_stave.glb');
    expect(K.root).toBe('Craterglass_Stave');
    expect(K.nodes.map((node) => node.name)).toEqual(RUNTIME_NAMES);
    expect(Object.keys(PINS)).toEqual(K.nodes.filter((node) => node.mesh).map((n) => n.name));
    expect([...K.materials]).toEqual(MATERIALS);
    expect([...K.glowMaterials]).toEqual(GLOW_MATERIALS);
    const total = Object.values(PINS).reduce((sum, pin) => sum + pin.triangles, 0);
    expect(total).toBe(1390);
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
      `/media/models/weapons/craterglass_stave.${SHA256.slice(0, 12)}.glb`,
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

  it('matches the held staff convention: grip at the origin, 2.28 long, head up and wide on X', async () => {
    const root = await shippedRoot();
    const box = bounds(
      ['Stave_Shaft', 'Stave_Head'].flatMap((name) => worldPoints(named(root, name))),
    );
    const height = box.max[1] - box.min[1];
    // the VAR_STAFF grip attaches at the origin and only ever scales DOWN past maxHeight
    expect(height).toBeCloseTo(2.28, 3);
    expect(height).toBeLessThanOrEqual(VARIANT_GRIPS.VAR_STAFF.maxHeight);
    expect(box.min[1]).toBeCloseTo(-0.912, 3);
    expect(-box.min[1] / height).toBeCloseTo(0.4, 3);
    // the grip wrap straddles the origin on the shaft axis
    const grip = worldPoints(named(root, 'Stave_Shaft')).filter((p) => Math.abs(p[1]) < 0.05);
    expect(grip.length).toBeGreaterThan(0);
    const gripBox = bounds(grip);
    expect(Math.abs(gripBox.max[0] + gripBox.min[0]) / 2).toBeLessThan(0.01);
    expect(Math.abs(gripBox.max[2] + gripBox.min[2]) / 2).toBeLessThan(0.01);
    // the head is up and its wide axis lies on X
    const head = bounds(worldPoints(named(root, 'Stave_Head')));
    expect(head.min[1]).toBeGreaterThan(0.9);
    expect(head.max[0] - head.min[0]).toBeGreaterThan(head.max[2] - head.min[2]);
    // the glow core socket sits inside the crown
    const core = named(root, 'Socket_Core').getTranslation();
    expect(core[1]).toBeGreaterThan(head.min[1]);
    expect(core[1]).toBeLessThan(head.max[1]);
  });
});
