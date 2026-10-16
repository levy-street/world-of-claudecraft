import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type Node, NodeIO, type Root } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { GUTTERED_EYE as K } from '../scripts/assets/guttered_eye/contract.mjs';
import {
  GUTTERED_EYE_SOURCE_FILES,
  gutteredEyeSourceFingerprint,
} from '../scripts/assets/guttered_eye/source_fingerprint.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';

// The Guttered Eye (Blender factory at scripts/assets/guttered_eye/model.py): ONE GLB whose NODE
// NAMES are the runtime contract (see contract.mjs). Pins the source inventory, the live
// source fingerprint, and the shipped file byte for byte, then re-measures every node
// independently of the exporter. A change to any fingerprinted file means re-running
// scripts/assets/guttered_eye/export_guttered_eye.mjs, then
// `node scripts/build_media_manifest.mjs generate`, then re-pinning below from the
// summary the exporter prints (sizes stay put on a fingerprint-only re-export).

const REPO_ROOT = path.join(__dirname, '..');
const SOURCE_FINGERPRINT = 'bb8008cea52831efb9f0a2a448ffc3fae3c46bf23b1f139f87cbe9b63d7ecb42';
const BYTES = 23_748;
const SHA256 = '32c1ee6478d3567db510dfd78b2f71725740b604c2452b95901b5fd827b287c0';

interface NodePin {
  triangles: number;
  primitives: number;
  materials: string[];
}

const PINS: Record<string, NodePin> = {
  Eye_Lens: { triangles: 182, primitives: 2, materials: ['GutteredEyeCrack', 'GutteredEyeGlow'] },
  Eye_Cage: { triangles: 569, primitives: 2, materials: ['GutteredEyeIron', 'GutteredEyeSinew'] },
};

/** Every named node, spelled out rather than derived, so a contract edit that renames a
 *  node cannot silently re-pin itself. */
const RUNTIME_NAMES = ['Eye_Lens', 'Eye_Cage', 'Socket_Beam'];
const MATERIALS = ['GutteredEyeGlow', 'GutteredEyeCrack', 'GutteredEyeIron', 'GutteredEyeSinew'];
const GLOW_MATERIALS = ['GutteredEyeGlow'];
/** The shipped world bounds (glTF frame, +Y up, +Z front). */
const BOUNDS = { min: [-0.272, -0.5199, -0.216], max: [0.2692, 0.3044, 0.1496] };

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

describe('The Guttered Eye', () => {
  it('pins the deterministic source inventory, the live fingerprint and the optimizer spec', () => {
    expect(GUTTERED_EYE_SOURCE_FILES).toEqual([
      'scripts/assets/guttered_eye/model.py',
      'scripts/assets/guttered_eye/contract.mjs',
      'scripts/assets/guttered_eye/export_guttered_eye.mjs',
      'scripts/assets/guttered_eye/source_fingerprint.mjs',
      'scripts/assets/specs/guttered_eye.json',
      'scripts/assets/build_assets.mjs',
      'pnpm-lock.yaml',
    ]);
    expect(gutteredEyeSourceFingerprint(REPO_ROOT)).toBe(SOURCE_FINGERPRINT);
    const spec = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'scripts/assets/specs/guttered_eye.json'), 'utf8'),
    );
    expect(spec.items).toEqual([
      {
        src: 'tmp/asset_src/guttered_eye/guttered_eye.glb',
        out: K.file,
        type: 'static',
        keepExtras: true,
      },
    ]);
  });

  it('keeps the contract on exactly the names the renderer reads', () => {
    expect(K.file).toBe('models/vfx/guttered_eye.glb');
    expect(K.root).toBe('Guttered_Eye');
    expect(K.nodes.map((node) => node.name)).toEqual(RUNTIME_NAMES);
    expect(Object.keys(PINS)).toEqual(K.nodes.filter((node) => node.mesh).map((n) => n.name));
    expect([...K.materials]).toEqual(MATERIALS);
    expect([...K.glowMaterials]).toEqual(GLOW_MATERIALS);
    const total = Object.values(PINS).reduce((sum, pin) => sum + pin.triangles, 0);
    expect(total).toBe(751);
    expect(total).toBeLessThanOrEqual(K.maxTriangles);
  });

  it('pins the shipped file byte for byte', () => {
    const bytes = shippedBytes();
    expect(bytes.length).toBe(BYTES);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(SHA256);
    expect(bytes.length).toBeLessThanOrEqual(K.maxBytes);
  });

  it('manifests the shipped file under its content hash', () => {
    expect(MEDIA_ASSETS[K.file]).toBe(`/media/models/vfx/guttered_eye.${SHA256.slice(0, 12)}.glb`);
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

  it('looks down +Z: the lens face and the beam socket lead the eye', async () => {
    const root = await shippedRoot();
    const lens = bounds(worldPoints(named(root, 'Eye_Lens')));
    const cage = bounds(worldPoints(named(root, 'Eye_Cage')));
    const socket = named(root, 'Socket_Beam').getTranslation();
    // the lens bulges forward past its hidden back, and the socket sits on its face
    expect(lens.max[2]).toBeGreaterThan(-lens.min[2]);
    expect(socket[2]).toBeCloseTo(lens.max[2], 2);
    // the cup closes the back: the cage reaches further back than the lens
    expect(cage.min[2]).toBeLessThan(lens.min[2]);
    // about 0.55 across, centred on the lens
    expect(cage.max[0] - cage.min[0]).toBeGreaterThan(0.5);
    expect(cage.max[0] - cage.min[0]).toBeLessThan(0.6);
    expect(Math.abs(lens.max[0] + lens.min[0])).toBeLessThan(0.005);
  });
});
