import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type Document, getBounds, type Node, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import {
  MUSTER_EFFIGY_HEIGHT,
  MUSTER_EFFIGY_LANTERN_HEIGHT,
  MUSTER_EFFIGY_MATERIALS,
  MUSTER_EFFIGY_PIECES,
  MUSTER_EFFIGY_PLANKS,
  MUSTER_MALLET_GRIP,
} from '../scripts/assets/muster_effigy/contract.mjs';
import {
  MUSTER_EFFIGY_SOURCE_FILES,
  musterEffigySourceFingerprint,
} from '../scripts/assets/muster_effigy/source_fingerprint.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';

// The muster training effigy of Balgath and the soldiers' stake mallet (Blender factory
// at scripts/assets/muster_effigy/model.py). Pins the source inventory, the live source
// fingerprint, and both shipped GLBs byte for byte, plus the runtime contracts: the
// detachable Plank_NN groups, the lantern nodes and flame height, the effigy's size, and
// the mallet's KayKit two-handed-axe grip frame. A change to any fingerprinted file
// means re-running scripts/assets/muster_effigy/export_muster_effigy.mjs, then
// `node scripts/build_media_manifest.mjs generate`, then re-pinning below from the
// summary the exporter prints.

const REPO_ROOT = path.join(__dirname, '..');
const SOURCE_FINGERPRINT = 'fc4a3b23df82de86c1347d7b7f29f0132add746827aa5469ec2f0cf4afb7938c';

interface Pin {
  bytes: number;
  sha256: string;
  triangles: number;
  primitives: number;
  materials: string[];
}

const PINS: Record<string, Pin> = {
  musterEffigy: {
    bytes: 182_308,
    sha256: 'c6047f569725d37bd3b0b61bc537903ff02975d1ff3acd088425ad9f074a9844',
    triangles: 8359,
    primitives: 36,
    materials: [
      'EffigyCloth',
      'EffigyGlass',
      'EffigyIron',
      'EffigyRock',
      'EffigyRope',
      'EffigyStraw',
      'EffigyWood',
    ],
  },
  musterMallet: {
    bytes: 15_344,
    sha256: '9e1865d69d587893596410a4d7c9d2c04b7364fadd315f065c08dfbd5ee09433',
    triangles: 556,
    primitives: 3,
    materials: ['EffigyIron', 'EffigyRope', 'EffigyWood'],
  },
};

async function io(): Promise<NodeIO> {
  await MeshoptDecoder.ready;
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
}

async function load(rel: string): Promise<Document> {
  return (await io()).readBinary(readFileSync(path.join(REPO_ROOT, 'public', rel)));
}

function meshMaterials(node: Node): string[] {
  return [
    ...new Set(
      (node.getMesh()?.listPrimitives() ?? []).map((p) => p.getMaterial()?.getName() ?? ''),
    ),
  ].sort();
}

describe('muster training effigy and stake mallet pipeline', () => {
  it('pins the deterministic source inventory, the live fingerprint and the optimizer spec', () => {
    expect(MUSTER_EFFIGY_SOURCE_FILES).toEqual([
      'scripts/assets/muster_effigy/model.py',
      'scripts/assets/muster_effigy/contract.mjs',
      'scripts/assets/muster_effigy/export_muster_effigy.mjs',
      'scripts/assets/muster_effigy/source_fingerprint.mjs',
      'scripts/assets/specs/muster_effigy.json',
      'scripts/assets/build_assets.mjs',
      'pnpm-lock.yaml',
    ]);
    expect(musterEffigySourceFingerprint(REPO_ROOT)).toBe(SOURCE_FINGERPRINT);
    const spec = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'scripts/assets/specs/muster_effigy.json'), 'utf8'),
    );
    expect(spec.items).toEqual(
      MUSTER_EFFIGY_PIECES.map((piece) => ({
        src: `tmp/asset_src/muster_effigy/${piece.file}.glb`,
        out: `${piece.dir}/${piece.file}.glb`,
        type: 'static',
        keepExtras: true,
      })),
    );
    expect(Object.keys(PINS).sort()).toEqual(MUSTER_EFFIGY_PIECES.map((p) => p.key).sort());
  });

  for (const piece of MUSTER_EFFIGY_PIECES) {
    it(`pins ${piece.file}.glb: bytes, structure, vertex colour, fingerprint`, async () => {
      const pin = PINS[piece.key];
      const rel = `${piece.dir}/${piece.file}.glb`;
      const bytes = readFileSync(path.join(REPO_ROOT, 'public', rel));
      const sha = createHash('sha256').update(bytes).digest('hex');
      expect(bytes.length).toBe(pin.bytes);
      expect(sha).toBe(pin.sha256);
      expect(bytes.length).toBeLessThanOrEqual(piece.maxBytes);
      expect(MEDIA_ASSETS[rel]).toBe(`/media/${piece.dir}/${piece.file}.${sha.slice(0, 12)}.glb`);

      const document = await (await io()).readBinary(bytes);
      const root = document.getRoot();
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

      let triangles = 0;
      let primitives = 0;
      const materials = new Set<string>();
      for (const mesh of root.listMeshes()) {
        for (const primitive of mesh.listPrimitives()) {
          primitives++;
          const position = primitive.getAttribute('POSITION');
          triangles += (primitive.getIndices()?.getCount() ?? position?.getCount() ?? 0) / 3;
          expect(
            primitive.getAttribute('COLOR_0'),
            `${rel} primitive without COLOR_0`,
          ).not.toBeNull();
          materials.add(primitive.getMaterial()?.getName() ?? '');
        }
      }
      expect(triangles).toBe(pin.triangles);
      expect(triangles).toBeLessThanOrEqual(piece.maxTriangles);
      expect(primitives).toBe(pin.primitives);
      expect([...materials].sort()).toEqual(pin.materials);
      for (const name of materials) expect(MUSTER_EFFIGY_MATERIALS).toContain(name);
      expect(root.getExtras().sourceFingerprint).toBe(SOURCE_FINGERPRINT);
      expect(
        (root.getAsset().extras as { sourceFingerprint?: string } | undefined)?.sourceFingerprint,
      ).toBe(SOURCE_FINGERPRINT);
    });
  }

  it('stands the effigy at half Balgath, floor-seated and centred, front toward +Z', async () => {
    const document = await load('models/creatures/muster_effigy.glb');
    const scene = document.getRoot().listScenes()[0];
    const roots = scene.listChildren();
    expect(roots.map((node) => node.getName())).toEqual(['MusterEffigy']);
    const { min, max } = getBounds(scene);
    const height = max[1] - min[1];
    expect(Math.abs(min[1])).toBeLessThanOrEqual(0.01);
    expect(height).toBeGreaterThanOrEqual(MUSTER_EFFIGY_HEIGHT.min);
    expect(height).toBeLessThanOrEqual(MUSTER_EFFIGY_HEIGHT.max);
    expect(Math.abs(min[0] + max[0])).toBeLessThanOrEqual(0.02);
    expect(Math.abs(min[2] + max[2])).toBeLessThanOrEqual(0.02);
    const extras = roots[0].getExtras() as Record<string, unknown>;
    expect(extras.height as number).toBeCloseTo(height, 2);
    expect(extras.sculptRuntime).toMatchObject({
      schemaVersion: 1,
      kitKey: 'musterEffigy',
      stage: 'final',
      coordinateFrame: { front: '+Z', up: '+Y', right: '+X', units: 'world-yards' },
      collider: { shippingCollisionMesh: false },
    });
  });

  it('ships every plank group as its own detachable node over a finished body', async () => {
    const document = await load('models/creatures/muster_effigy.glb');
    const nodes = document.getRoot().listNodes();
    const root = document.getRoot().listScenes()[0].listChildren()[0];
    const planks = nodes.filter((node) => /^Plank_\d\d$/.test(node.getName()));
    expect(planks.length).toBeGreaterThanOrEqual(MUSTER_EFFIGY_PLANKS.min);
    expect(planks.length).toBeLessThanOrEqual(MUSTER_EFFIGY_PLANKS.max);
    expect(planks.map((node) => node.getName())).toEqual(
      planks.map((_, i) => `Plank_${String(i).padStart(2, '0')}`),
    );
    expect((root.getExtras() as { plankCount?: number }).plankCount).toBe(planks.length);
    for (const plank of planks) {
      // a direct child of the root, its own mesh, wood and iron nails only, and its
      // origin at the centre of its own bounds (so a drop rotates about the plank)
      expect(plank.getParentNode()).toBe(root);
      expect(plank.getMesh()).not.toBeNull();
      expect(meshMaterials(plank)).toEqual(['EffigyIron', 'EffigyWood']);
      const { min, max } = getBounds(plank);
      const t = plank.getWorldTranslation();
      for (let axis = 0; axis < 3; axis++) {
        expect(Math.abs(t[axis] - (min[axis] + max[axis]) / 2)).toBeLessThanOrEqual(0.01);
      }
    }
    // the body under the planks is its own node carrying the straw and the frame
    const body = nodes.find((node) => node.getName() === 'EffigyBody');
    expect(body?.getParentNode()).toBe(root);
    expect(meshMaterials(body as Node)).toEqual(
      expect.arrayContaining(['EffigyStraw', 'EffigyWood', 'EffigyRope']),
    );
  });

  it('seats the lantern eye: housing, glass and the flame anchor at the contract height', async () => {
    const document = await load('models/creatures/muster_effigy.glb');
    const nodes = document.getRoot().listNodes();
    const byName = (name: string) => nodes.find((node) => node.getName() === name);
    const lantern = byName('Lantern');
    const glass = byName('LanternGlass');
    const flame = byName('LanternFlame');
    expect(meshMaterials(lantern as Node)).toEqual(['EffigyIron']);
    expect(meshMaterials(glass as Node)).toEqual(['EffigyGlass']);
    expect(flame?.getMesh()).toBeNull();
    expect(flame?.getExtras()).toEqual({ flameAnchor: 1 });
    const at = flame?.getWorldTranslation() ?? [0, 0, 0];
    expect(at[1]).toBeCloseTo(MUSTER_EFFIGY_LANTERN_HEIGHT, 3);
    const root = document.getRoot().listScenes()[0].listChildren()[0];
    const extras = root.getExtras() as { lanternHeight?: number; lanternFlame?: number[] };
    expect(extras.lanternHeight).toBeCloseTo(at[1], 3);
    expect(extras.lanternFlame?.[0]).toBeCloseTo(at[0], 3);
    expect(extras.lanternFlame?.[2]).toBeCloseTo(at[2], 3);
    // on the centre line, in the face at the front (+Z), inside the glass
    expect(Math.abs(at[0])).toBeLessThanOrEqual(0.02);
    const scene = getBounds(document.getRoot().listScenes()[0]);
    expect(at[2]).toBeGreaterThan(scene.max[2] - 0.5);
    const g = getBounds(glass as Node);
    for (let axis = 0; axis < 3; axis++) {
      expect(at[axis]).toBeGreaterThan(g.min[axis]);
      expect(at[axis]).toBeLessThan(g.max[axis]);
    }
  });

  it("holds the mallet in the KayKit two-handed axe's grip frame", async () => {
    const mallet = await load('models/weapons/muster_mallet.glb');
    const axe = await load(MUSTER_MALLET_GRIP.reference);
    const [node] = mallet.getRoot().listScenes()[0].listChildren();
    const [axeNode] = axe.getRoot().listScenes()[0].listChildren();
    // one mesh node, like the axe: the runtime flatten keeps its scale, the grip its place
    expect(mallet.getRoot().listScenes()[0].listChildren()).toHaveLength(1);
    expect(node.getName()).toBe('MusterMallet');
    expect(node.getMesh()).not.toBeNull();
    expect(node.listChildren()).toHaveLength(0);
    const t = node.getTranslation();
    const at = axeNode.getTranslation();
    for (let axis = 0; axis < 3; axis++) expect(Math.abs(t[axis] - at[axis])).toBeLessThan(0.002);
    expect(node.getRotation()).toEqual(axeNode.getRotation());
    const s = node.getScale();
    const as = axeNode.getScale();
    for (let axis = 0; axis < 3; axis++) expect(Math.abs(s[axis] - as[axis])).toBeLessThan(0.002);
    expect(t[1]).toBeCloseTo(MUSTER_MALLET_GRIP.translationY, 3);
    expect(s[0]).toBeCloseTo(MUSTER_MALLET_GRIP.scale, 3);
    // the handle runs up +Y from the axe's butt to the axe's crown, centred on its axis
    const b = getBounds(mallet.getRoot().listScenes()[0]);
    const ab = getBounds(axe.getRoot().listScenes()[0]);
    expect(Math.abs(b.min[1] - ab.min[1])).toBeLessThan(0.005);
    expect(Math.abs(b.max[1] - ab.max[1])).toBeLessThan(0.005);
    expect(Math.abs(b.min[0] + b.max[0])).toBeLessThan(0.005);
    expect(Math.abs(b.min[2] + b.max[2])).toBeLessThan(0.005);
    expect(b.max[1] - b.min[1]).toBeGreaterThan(Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]));
    // the heavy head sits at the crown end: every wide vertex is in the top third
    const position = node.getMesh()?.listPrimitives()[0].getAttribute('POSITION');
    expect(position).not.toBeNull();
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      const accessor = primitive.getAttribute('POSITION');
      const el: number[] = [0, 0, 0];
      for (let i = 0; i < (accessor?.getCount() ?? 0); i++) {
        accessor?.getElement(i, el);
        const x = t[0] + s[0] * el[0];
        const y = t[1] + s[1] * el[1];
        if (Math.abs(x) > 0.2) expect(y).toBeGreaterThan(b.min[1] + (b.max[1] - b.min[1]) * 0.66);
      }
    }
  });
});
