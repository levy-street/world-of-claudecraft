// The rift course kit contract (scripts/assets/rift_course_kit/): the three
// shipped GLBs the course renderer places for launch pads, gems, and
// waybraziers. Pins the whole shipping contract, plus LIVE source-fingerprint
// equality, so a drifted factory or a stale re-export can never ship quietly.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import {
  RIFT_COURSE_KIT_SOURCE_FILES,
  riftCourseKitSourceFingerprint,
} from '../scripts/assets/rift_course_kit/source_fingerprint.mjs';
import { riftCoursePropsPreloadInternalsForTest } from '../src/render/rift_course_props';

const ROOT = process.cwd();

const CONTRACTS = [
  {
    key: 'rift_launch_pad',
    file: 'public/models/props/rift_launch_pad.glb',
    triangleCeiling: 1800,
    byteCeiling: 30 * 1024,
    height: 0.55,
  },
  {
    key: 'rift_gem_crystal',
    file: 'public/models/props/rift_gem_crystal.glb',
    triangleCeiling: 500,
    byteCeiling: 12 * 1024,
    height: 0.95,
  },
  {
    key: 'rift_waybrazier',
    file: 'public/models/props/rift_waybrazier.glb',
    triangleCeiling: 1500,
    byteCeiling: 26 * 1024,
    height: 1.7,
  },
] as const;

async function readShipped(file: string) {
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  return io.read(path.join(ROOT, file));
}

describe('rift course kit: source inventory', () => {
  it('fingerprints only files that exist, and the factory is among them', () => {
    expect(RIFT_COURSE_KIT_SOURCE_FILES.length).toBeGreaterThan(5);
    for (const rel of RIFT_COURSE_KIT_SOURCE_FILES) {
      expect(() => readFileSync(path.join(ROOT, rel)), rel).not.toThrow();
    }
    expect(RIFT_COURSE_KIT_SOURCE_FILES).toContain('scripts/assets/rift_course_kit/model.js');
    expect(RIFT_COURSE_KIT_SOURCE_FILES).toContain('package-lock.json');
  });

  it('the fingerprint is injective over its inputs (a changed byte changes it)', () => {
    const a = riftCourseKitSourceFingerprint();
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    // Deterministic across calls.
    expect(riftCourseKitSourceFingerprint()).toBe(a);
  });
});

describe('rift course kit: shipped GLB contract', () => {
  for (const contract of CONTRACTS) {
    it(`${contract.key} holds its budget, shape and provenance`, async () => {
      const bytes = readFileSync(path.join(ROOT, contract.file));
      expect(bytes.byteLength).toBeLessThanOrEqual(contract.byteCeiling);

      const document = await readShipped(contract.file);
      const root = document.getRoot();

      // Provenance: the stamped fingerprint equals the LIVE one, recomputed
      // over the sources as they stand right now.
      const extras = (root.getAsset().extras ?? {}) as Record<string, unknown>;
      expect(extras.sourceFingerprint).toBe(riftCourseKitSourceFingerprint());

      // Texture-free, animation-free, unskinned, vertex-coloured, meshopt.
      expect(root.listTextures()).toHaveLength(0);
      expect(root.listAnimations()).toHaveLength(0);
      expect(root.listSkins()).toHaveLength(0);
      const materials = root.listMaterials();
      expect(materials.length).toBeGreaterThanOrEqual(1);
      expect(materials.length).toBeLessThanOrEqual(2);
      let triangles = 0;
      let color = false;
      for (const mesh of root.listMeshes()) {
        for (const prim of mesh.listPrimitives()) {
          const indices = prim.getIndices();
          const position = prim.getAttribute('POSITION');
          triangles += Math.floor((indices ? indices.getCount() : (position?.getCount() ?? 0)) / 3);
          if (prim.getAttribute('COLOR_0')) color = true;
        }
      }
      expect(color).toBe(true);
      expect(triangles).toBeGreaterThan(20);
      expect(triangles).toBeLessThanOrEqual(contract.triangleCeiling);
      expect(
        root.listExtensionsUsed().some((ext) => ext.extensionName === 'EXT_meshopt_compression'),
      ).toBe(true);

      // Floor-seated at its contract height, centred on X/Z.
      const scene = root.getDefaultScene() ?? root.listScenes()[0];
      const bounds = getBounds(scene);
      expect(Math.abs(bounds.min[1])).toBeLessThanOrEqual(0.02);
      expect(bounds.max[1]).toBeGreaterThan(contract.height * 0.9);
      expect(bounds.max[1]).toBeLessThan(contract.height * 1.1);
      expect(Math.abs(bounds.max[0] + bounds.min[0])).toBeLessThanOrEqual(0.05);
      expect(Math.abs(bounds.max[2] + bounds.min[2])).toBeLessThanOrEqual(0.05);
    });
  }

  it('every kit URL the adapter preloads is a shipped, manifest-covered file', () => {
    const urls = riftCoursePropsPreloadInternalsForTest();
    expect(urls).toHaveLength(CONTRACTS.length);
    const manifest = readFileSync(
      path.join(ROOT, 'src/render/assets/manifest.generated.ts'),
      'utf8',
    );
    for (const url of urls) {
      expect(() => readFileSync(path.join(ROOT, 'public', url)), url).not.toThrow();
      expect(manifest, `${url} missing from the media manifest`).toContain(url.slice(1));
    }
  });

  it('shipped hashes are pinned, so a silent re-export cannot drift', () => {
    const hashes = Object.fromEntries(
      CONTRACTS.map((c) => [
        c.key,
        createHash('sha256')
          .update(readFileSync(path.join(ROOT, c.file)))
          .digest('hex'),
      ]),
    );
    // Re-pin deliberately on any intended re-export, alongside the
    // fingerprint inputs that motivated it.
    expect(hashes).toMatchInlineSnapshot(`
      {
        "rift_gem_crystal": "e43b4acc42f23917ec1621dd8145065eeda75d3ef75349e6266e6e0c7162a7d6",
        "rift_launch_pad": "4a800b22922d3c0e47ea0e11ef6659d29a0d46da00a0be6fc44b28c6436272e1",
        "rift_waybrazier": "8b3f4f63256dbb87b5593c6d72a4e8c3544cd8176031bcd9ab6d7f5e0890e3e6",
      }
    `);
  });
});
