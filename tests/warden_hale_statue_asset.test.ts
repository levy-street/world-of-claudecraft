import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { PROP_ASSET_DEFS } from '../src/render/props';
import { FARSHORE_PROPS } from '../src/sim/content/farshore';

const REPO_ROOT = path.join(__dirname, '..');
const ASSET_REL = 'models/props/wardenHaleStatue.glb';
const ASSET_PATH = path.join(REPO_ROOT, 'public', ASSET_REL);
const ASSET_BYTES = 91_336;
const ASSET_SHA256 = 'f5c894a4ac49f2ce624414212e76e80f3048da01048ef15a422e8321e614a5c5';

async function readAsset() {
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  return io.read(ASSET_PATH);
}

// `r`/`h` are optional on a decor prop, but a camera-ghost memorial has to
// carry both: they are the collider footprint and the ghost top. Narrow by
// assertion rather than `!`, so dropping either field fails here by name.
const statue = (): { r: number; h: number } => {
  const found = FARSHORE_PROPS.decorProps?.find((p) => p.key === 'wardenHaleStatue');
  if (!found) throw new Error('wardenHaleStatue is not placed in FARSHORE_PROPS');
  const { r, h } = found;
  if (typeof r !== 'number' || typeof h !== 'number') {
    throw new Error('wardenHaleStatue must carry a measured r and h');
  }
  return { r, h };
};

describe("Warden Hale's memorial asset", () => {
  it('ships the exact bytes the exporter produces', () => {
    const bytes = readFileSync(ASSET_PATH);
    expect(bytes.byteLength).toBe(ASSET_BYTES);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(ASSET_SHA256);
  });

  // The load-bearing pin. `r` and `h` in the placement record are the collider
  // and the camera-ghost top; if a re-export changes the silhouette and nobody
  // re-measures, collision and the Q0 framing drift away from the mesh in
  // silence. Assert the record against the GLB rather than against a literal.
  it('matches the placement record it is measured from', async () => {
    const doc = await readAsset();
    const bounds = getBounds(doc.getRoot().listScenes()[0]);
    const { r, h } = statue();

    // glTF is Y-up: Blender's Z becomes height here.
    expect(bounds.max[1] - bounds.min[1]).toBeCloseTo(h, 2);
    // origin at the base, so the prop sits ON the terrain rather than in it
    expect(bounds.min[1]).toBeCloseTo(0, 2);

    const halfExtent = Math.max(
      Math.abs(bounds.min[0]),
      Math.abs(bounds.max[0]),
      Math.abs(bounds.min[2]),
      Math.abs(bounds.max[2]),
    );
    expect(halfExtent).toBeCloseTo(r, 2);
  });

  it('reads as a column, not a plinth', async () => {
    const doc = await readAsset();
    const bounds = getBounds(doc.getRoot().listScenes()[0]);
    const height = bounds.max[1] - bounds.min[1];
    const width = bounds.max[0] - bounds.min[0];
    // A memorial column has to out-measure its own footprint or it reads as a
    // block; the retired plinth sat at roughly 1.9:1.
    expect(height / width).toBeGreaterThan(2.2);
  });

  it('carries the stone/bronze/engraving materials and no baked textures', async () => {
    const doc = await readAsset();
    const root = doc.getRoot();
    expect(
      root
        .listMaterials()
        .map((m) => m.getName())
        .sort(),
    ).toEqual(['memorial_bronze', 'memorial_engraving', 'memorial_stone']);
    // every surface is a flat Principled colour, so an embedded image would be
    // dead weight the exporter is supposed to purge
    expect(root.listTextures()).toHaveLength(0);
  });

  it('is registered in the prop registry and the media manifest', () => {
    expect(PROP_ASSET_DEFS.wardenHaleStatue?.url).toBe(`/${ASSET_REL}`);
    expect(MEDIA_ASSETS[ASSET_REL]).toBeDefined();
  });
});
