import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type Node, NodeIO, type Root } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { MUSTER_GRAPNEL as K } from '../scripts/assets/muster_grapnel/contract.mjs';
import {
  MUSTER_GRAPNEL_SOURCE_FILES,
  musterGrapnelSourceFingerprint,
} from '../scripts/assets/muster_grapnel/source_fingerprint.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';

// The Fenbridge muster grapnel (Blender factory at scripts/assets/muster_grapnel/model.py): ONE GLB whose NODE
// NAMES are the runtime contract (see contract.mjs). Pins the source inventory, the live
// source fingerprint, and the shipped file byte for byte, then re-measures every node
// independently of the exporter. A change to any fingerprinted file means re-running
// scripts/assets/muster_grapnel/export_muster_grapnel.mjs, then
// `node scripts/build_media_manifest.mjs generate`, then re-pinning below from the
// summary the exporter prints (sizes stay put on a fingerprint-only re-export).

const REPO_ROOT = path.join(__dirname, '..');
const SOURCE_FINGERPRINT = '4ecb4fea42baa2a579aaf979917328357aac9766709c18512837a0351866281f';
const BYTES = 16_768;
const SHA256 = '02bab3764eb1e290546af387e34a78ded7535be878b832cfea6fbc375a397b56';

interface NodePin {
  triangles: number;
  primitives: number;
  materials: string[];
}

const PINS: Record<string, NodePin> = {
  Grapnel_Hook: {
    triangles: 480,
    primitives: 4,
    materials: ['MusterCloth', 'MusterIron', 'MusterRope', 'MusterSteel'],
  },
};

/** Every named node, spelled out rather than derived, so a contract edit that renames a
 *  node cannot silently re-pin itself. */
const RUNTIME_NAMES = ['Grapnel_Hook'];
const MATERIALS = ['MusterIron', 'MusterSteel', 'MusterCloth', 'MusterRope'];
const GLOW_MATERIALS = [] as string[];
/** The shipped world bounds (glTF frame, +Y up, +Z front). */
const BOUNDS = { min: [-0.174, -0.6264, -0.174], max: [0.174, 0.0599, 0.174] };

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

describe('The Fenbridge muster grapnel', () => {
  it('pins the deterministic source inventory, the live fingerprint and the optimizer spec', () => {
    expect(MUSTER_GRAPNEL_SOURCE_FILES).toEqual([
      'scripts/assets/muster_grapnel/model.py',
      'scripts/assets/muster_grapnel/contract.mjs',
      'scripts/assets/muster_grapnel/export_muster_grapnel.mjs',
      'scripts/assets/muster_grapnel/source_fingerprint.mjs',
      'scripts/assets/specs/muster_grapnel.json',
      'scripts/assets/build_assets.mjs',
      'pnpm-lock.yaml',
    ]);
    expect(musterGrapnelSourceFingerprint(REPO_ROOT)).toBe(SOURCE_FINGERPRINT);
    const spec = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'scripts/assets/specs/muster_grapnel.json'), 'utf8'),
    );
    expect(spec.items).toEqual([
      {
        src: 'tmp/asset_src/muster_grapnel/muster_grapnel.glb',
        out: K.file,
        type: 'static',
        keepExtras: true,
      },
    ]);
  });

  it('keeps the contract on exactly the names the renderer reads', () => {
    expect(K.file).toBe('models/vfx/muster_grapnel.glb');
    expect(K.root).toBe('Muster_Grapnel');
    expect(K.nodes.map((node) => node.name)).toEqual(RUNTIME_NAMES);
    expect(Object.keys(PINS)).toEqual(K.nodes.filter((node) => node.mesh).map((n) => n.name));
    expect([...K.materials]).toEqual(MATERIALS);
    expect([...K.glowMaterials]).toEqual(GLOW_MATERIALS);
    const total = Object.values(PINS).reduce((sum, pin) => sum + pin.triangles, 0);
    expect(total).toBe(480);
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
      `/media/models/vfx/muster_grapnel.${SHA256.slice(0, 12)}.glb`,
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

  it('ties the rope at the origin: the ring eye surrounds it and the prongs hang to -Y', async () => {
    const root = await shippedRoot();
    const points = worldPoints(named(root, 'Grapnel_Hook'));
    // nothing sits on the origin itself: it is the hole of the ring eye
    const nearest = Math.min(...points.map((p) => Math.hypot(...p)));
    expect(nearest).toBeGreaterThan(0.03);
    const ring = points.filter((p) => Math.hypot(...p) < 0.07);
    const ringBox = bounds(ring);
    expect(ringBox.max[1]).toBeGreaterThan(0.05);
    expect(ringBox.min[1]).toBeLessThan(-0.03);
    // about 0.7 long, the four prongs spreading at the -Y end
    const box = bounds(points);
    expect(box.max[1] - box.min[1]).toBeGreaterThan(0.66);
    expect(box.max[1] - box.min[1]).toBeLessThan(0.74);
    const head = points.filter((p) => p[1] < -0.35);
    expect(bounds(head).max[0] - bounds(head).min[0]).toBeGreaterThan(0.3);
  });
});
