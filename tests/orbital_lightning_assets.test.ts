import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { buildComponent, sourceFingerprint } from '../scripts/assets/orbital_lightning/build.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';

const ROOT = path.join(__dirname, '..');
const ASSETS = [
  {
    kind: 'orb',
    bytes: 20488,
    sha: '6200d962d97f665d17bf8ceb35f098adb0d84c85272ef1a60c36b5b99cce1f32',
    names: ['Core', 'LocalArcs', 'OuterEnergy', 'Sparks'],
    triangles: [80, 732, 1068, 108],
    min: [-0.844265, -0.540179, -0.906207],
    max: [0.808676, 0.607997, 0.668227],
  },
  {
    kind: 'impact',
    bytes: 18452,
    sha: '22e946c4d54688fe726ff6d8a5af53b7d1eed571d0593781a9eb7bab5c88c944',
    names: ['Crown', 'GroundArcs', 'ImpactCore', 'RadialBurst', 'Sparks'],
    triangles: [168, 612, 80, 516, 108],
    min: [-1.02133, -0.1232, -1.051493],
    max: [1.051611, 0.491387, 1.050453],
  },
] as const;

describe('Orbital Lightning approved Blender components', () => {
  for (const spec of ASSETS) {
    it(`${spec.kind} ships exact compressed bytes and rebuilds deterministically`, async () => {
      const url = `vfx/orbital-lightning/${spec.kind}.glb`;
      const bytes = readFileSync(path.join(ROOT, 'public', url));
      expect(bytes.length).toBe(spec.bytes);
      expect(bytes.length).toBeLessThan(24 * 1024);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(spec.sha);
      expect(Buffer.from(await buildComponent(spec.kind, ROOT)).equals(bytes)).toBe(true);
      expect(MEDIA_ASSETS[url]).toBe(
        `/media/vfx/orbital-lightning/${spec.kind}.${spec.sha.slice(0, 12)}.glb`,
      );
      await MeshoptDecoder.ready;
      const doc = await new NodeIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
        .readBinary(bytes);
      const root = doc.getRoot();
      expect(root.getExtras().sourceFingerprint).toBe(sourceFingerprint(spec.kind, ROOT));
      expect(root.listScenes()).toHaveLength(1);
      expect(root.listAnimations()).toHaveLength(0);
      expect(root.listSkins()).toHaveLength(0);
      expect(root.listCameras()).toHaveLength(0);
      expect(root.listTextures()).toHaveLength(0);
      expect(
        root
          .listExtensionsRequired()
          .map((extension) => extension.extensionName)
          .sort(),
      ).toEqual(['EXT_meshopt_compression', 'KHR_mesh_quantization']);
      const nodes = root.listNodes().filter((node) => node.getMesh());
      expect(nodes.map((node) => node.getName()).sort()).toEqual(spec.names);
      expect(root.listNodes()).toHaveLength(spec.names.length);
      expect(root.listMeshes()).toHaveLength(spec.names.length);
      for (let index = 0; index < spec.names.length; index++) {
        const node = nodes.find((candidate) => candidate.getName() === spec.names[index]);
        if (!node) throw new Error(`Missing component node: ${spec.names[index]}`);
        const mesh = node.getMesh();
        if (!mesh) throw new Error(`Missing component mesh: ${spec.names[index]}`);
        const primitives = mesh.listPrimitives();
        expect(primitives).toHaveLength(1);
        expect(primitives[0].getMode()).toBe(4);
        const indices = primitives[0].getIndices();
        if (!indices) throw new Error(`Missing component indices: ${spec.names[index]}`);
        expect(indices.getCount() / 3).toBe(spec.triangles[index]);
        const bounds = getBounds(node);
        for (const value of [...bounds.min, ...bounds.max])
          expect(Number.isFinite(value)).toBe(true);
      }
      const bounds = getBounds(root.listScenes()[0]);
      for (let axis = 0; axis < 3; axis++) {
        expect(bounds.min[axis]).toBeCloseTo(spec.min[axis], 3);
        expect(bounds.max[axis]).toBeCloseTo(spec.max[axis], 3);
      }
      // Core pivot stays centered, impact remains anchored on the authored ground plane.
      const pivotNode = nodes.find(
        (node) => node.getName() === (spec.kind === 'orb' ? 'Core' : 'GroundArcs'),
      );
      if (!pivotNode) throw new Error(`Missing ${spec.kind} pivot component`);
      const pivot = getBounds(pivotNode);
      if (spec.kind === 'orb') {
        for (let axis = 0; axis < 3; axis++)
          expect(pivot.min[axis] + pivot.max[axis]).toBeCloseTo(0, 3);
      } else {
        expect(pivot.min[1]).toBeCloseTo(0.006, 3);
        expect(pivot.max[1]).toBeCloseTo(0.044, 3);
      }
    });
  }
});
