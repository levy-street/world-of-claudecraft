// Contract test for the shipped Riftbound Boulder mount GLB.
//
// This model is not a downloaded asset: it is authored by
// scripts/assets/riftbound_boulder/ and its geometry carries load-bearing
// promises the renderer relies on but cannot check at runtime. The important
// one is the FRAMING contract. The renderer rolls this mount by rotating its
// visual root, and that only spins the stone in place while the root's origin
// is the stone's own centre. manifest.ts reaches that by pairing height 1.6
// with hover -0.8, and both numbers are correct only while the authored bounds
// are exactly 2.0 tall and centred on the origin. A factory edit that broke the
// centring would not throw anywhere: the stone would quietly start orbiting its
// own contact point instead of spinning, so it is pinned here.
//
// Materials, attributes and clips are read straight off the GLB JSON chunk (the
// same way tests/weapon_skins.test.ts reads its clip names); the BOUNDS go
// through gltf-transform, because the shipping pass quantizes positions and the
// raw accessor min/max are lattice integers rather than yards.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BOULDER_SOURCE_FILES,
  boulderSourceFingerprint,
} from '../scripts/assets/riftbound_boulder/source_fingerprint.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';

const repoRoot = path.resolve(__dirname, '..');
const glbPath = path.join(repoRoot, 'public/models/mounts/riftbound_boulder.glb');

// Sealed literals, mirroring tests/terrorspark_groundshaker_asset.test.ts. A
// fingerprint that only ever checks itself against its own live inputs is
// auto-healing: drop a file from the seal list, re-run the exporter, and the
// seal is weaker with nothing a reviewer would see move. Pinning the list AND
// the hex AND the shipped bytes means any of those three moving is visible in
// the diff.
const EXPECTED_SOURCE_FINGERPRINT =
  '6e2c8aeb9f6452a284046fcd88e2971c12011431f3f1e3e6c394130f3ba11966';
const EXPECTED_ASSET_SHA256 = 'd06f95fbd0fd2e9ad9d00e912b5ad07d0b97c772bc466b06693ec595e4082160';
/** Stone plus seams. The byte ceiling cannot catch a geometry blow-up on its
 *  own: the shipped GLB is 28 KB against a 96 KiB gate, so the triangle count
 *  could roughly triple before bytes complained. */
const TRIANGLE_CEILING = 1200;

interface GlbJson {
  asset: { extras?: Record<string, unknown> };
  accessors: { count: number }[];
  extras?: Record<string, unknown>;
  meshes: { name?: string; primitives: { attributes: Record<string, number> }[] }[];
  materials?: { name?: string }[];
  animations?: unknown[];
  images?: unknown[];
  textures?: unknown[];
}

/** Parse a binary glTF's JSON chunk. */
function readGlbJson(file: string): GlbJson {
  const bytes = readFileSync(file);
  expect(bytes.readUInt32LE(0), 'glTF magic').toBe(0x46546c67);
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')) as GlbJson;
}

/** The model bounds in WORLD units. Read through gltf-transform rather than
 *  straight off the accessors: the shipping pass quantizes positions, so the
 *  raw accessor min/max are integer lattice coordinates and only the node
 *  transform brings them back to yards. */
let bounds: { min: number[]; max: number[] };

describe('Riftbound Boulder mount GLB', () => {
  const glb = readGlbJson(glbPath);
  const accessorCounts = glb.accessors.map((accessor) => accessor.count);

  beforeAll(async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const document = await io.read(glbPath);
    bounds = getBounds(document.getRoot().listScenes()[0]);
  });

  it('is exactly two units tall and centred on the origin', () => {
    const { min, max } = bounds;
    // Quantization from the meshopt pass moves vertices by a fraction of a
    // millimetre, so this is tight but not exact.
    expect(max[1] - min[1]).toBeCloseTo(2, 3);
    for (const axis of [0, 1, 2]) {
      expect((max[axis] + min[axis]) / 2, `axis ${axis} centre`).toBeCloseTo(0, 3);
    }
  });

  it('is roughly round, because a lumpy stone would wobble as it rolls', () => {
    const { min, max } = bounds;
    const height = max[1] - min[1];
    for (const axis of [0, 2]) {
      const extent = max[axis] - min[axis];
      // Within 12% of the height on both horizontal axes: enough relief to read
      // as broken stone, not enough to visibly wobble against a smooth roll.
      expect(Math.abs(extent - height) / height, `axis ${axis} roundness`).toBeLessThan(0.12);
    }
  });

  it('ships the stone and the rift seams as two vertex-coloured meshes', () => {
    const names = (glb.materials ?? []).map((material) => material.name).sort();
    expect(names).toEqual(['riftbound_stone', 'riftbound_vein']);
    for (const mesh of glb.meshes) {
      for (const primitive of mesh.primitives) {
        expect(primitive.attributes.COLOR_0, 'every primitive carries vertex colors').toBeDefined();
      }
    }
  });

  it('carries no textures at all, which is why it needs no KTX2 pass', () => {
    expect(glb.images ?? []).toHaveLength(0);
    expect(glb.textures ?? []).toHaveLength(0);
  });

  it('is clipless: its motion is the roll, never a baked gait', () => {
    expect(glb.animations ?? []).toHaveLength(0);
  });

  it('stays small enough to stop being a size question', () => {
    expect(readFileSync(glbPath).byteLength).toBeLessThan(96 * 1024);
  });

  it('seals the deterministic source inventory and the optimizer specification', () => {
    // The list itself is pinned: a file silently dropped from the seal narrows
    // what staleness can be detected, and without this it would narrow quietly.
    expect(BOULDER_SOURCE_FILES).toEqual([
      'scripts/assets/riftbound_boulder/model.js',
      'scripts/assets/riftbound_boulder/export_entry.js',
      'scripts/assets/riftbound_boulder/export_riftbound_boulder.mjs',
      'scripts/assets/riftbound_boulder/source_fingerprint.mjs',
      'scripts/assets/specs/riftbound_boulder.json',
      'scripts/assets/build_assets.mjs',
      'pnpm-lock.yaml',
    ]);
    expect(boulderSourceFingerprint(repoRoot)).toBe(EXPECTED_SOURCE_FINGERPRINT);
    expect(
      JSON.parse(
        readFileSync(path.join(repoRoot, 'scripts/assets/specs/riftbound_boulder.json'), 'utf8'),
      ),
    ).toEqual({
      items: [
        {
          src: 'tmp/asset_src/riftbound_boulder/riftbound_boulder-final.glb',
          out: 'models/mounts/riftbound_boulder.glb',
          type: 'static',
          keepExtras: true,
        },
      ],
    });
  });

  it('is not stale: the stamped fingerprint matches its live sources and bytes', () => {
    const stamped = glb.asset.extras?.sourceFingerprint ?? glb.extras?.sourceFingerprint;
    expect(
      stamped,
      'committed GLB is stale; re-run node scripts/assets/riftbound_boulder/export_riftbound_boulder.mjs',
    ).toBe(boulderSourceFingerprint(repoRoot));
    expect(stamped).toBe(EXPECTED_SOURCE_FINGERPRINT);

    // The shipped bytes themselves, which also cross-checks the media manifest:
    // the digest the client fetches by is derived from these same bytes.
    const sha256 = createHash('sha256').update(readFileSync(glbPath)).digest('hex');
    expect(sha256).toBe(EXPECTED_ASSET_SHA256);
    expect(MEDIA_ASSETS['models/mounts/riftbound_boulder.glb']).toBe(
      `/media/models/mounts/riftbound_boulder.${sha256.slice(0, 12)}.glb`,
    );
  });

  it('stays within its triangle budget, which the byte gate cannot enforce', () => {
    let triangles = 0;
    for (const mesh of glb.meshes) {
      for (const primitive of mesh.primitives) {
        const attribute = primitive.attributes.POSITION;
        expect(typeof attribute, 'POSITION accessor index').toBe('number');
        triangles += accessorCounts[attribute] / 3;
      }
    }
    expect(triangles).toBeGreaterThan(0);
    expect(triangles).toBeLessThan(TRIANGLE_CEILING);
  });
});
