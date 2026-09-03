// The Bone Spike prop mob resolves to a shipped, manifest-listed, clip-less GLB.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { manifestUrls, VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import { MOBS } from '../src/sim/data';
import { NYTHRAXIS_BONE_SPIKE_ID } from '../src/sim/nythraxis_bone_spike';

const REPO_ROOT = path.join(__dirname, '..');
const RELATIVE_URL = 'models/props/nythraxis_bone_spike.glb';
const ASSET_PATH = path.join(REPO_ROOT, 'public', RELATIVE_URL);
const AUTHORED_HEIGHT = 1.6;
const AUTHORED_FOOTPRINT_RADIUS = 0.88;

describe('Nythraxis Bone Spike model', () => {
  it('routes the spike template to its own static-prop visual', () => {
    expect(MOBS[NYTHRAXIS_BONE_SPIKE_ID]?.name).toBe('Bone Spike');
    const key = visualKeyFor({ kind: 'mob', templateId: NYTHRAXIS_BONE_SPIKE_ID } as never);
    expect(key).toBe('mob_nythraxis_bone_spike');
    expect(VISUALS.mob_nythraxis_bone_spike).toMatchObject({
      url: RELATIVE_URL,
      height: AUTHORED_HEIGHT,
      yaw: 0,
      // STATIC_PROP: every action parks on the nominal 'Idle' the GLB lacks
      clips: {
        idle: 'Idle',
        walk: 'Idle',
        run: 'Idle',
        attack: ['Idle'],
        death: 'Idle',
      },
    });
  });

  it('ships the GLB on disk, in the media manifest, and in the character preload set', () => {
    expect(existsSync(ASSET_PATH)).toBe(true);
    expect(MEDIA_ASSETS[RELATIVE_URL]).toMatch(
      /^\/media\/models\/props\/nythraxis_bone_spike\.[0-9a-f]{12}\.glb$/,
    );
    expect(manifestUrls()).toContain(RELATIVE_URL);
  });

  it('is a bounded, clip-less, upright prop at the authored size', async () => {
    await MeshoptDecoder.ready;
    const bytes = readFileSync(ASSET_PATH);
    expect(bytes.byteLength).toBeLessThan(200_000);
    const document = await new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
      .readBinary(bytes);
    const root = document.getRoot();
    // Clip-less by contract (CLIPLESS_RIGS in tests/character_clipmaps.test.ts).
    expect(root.listAnimations()).toEqual([]);
    expect(root.listSkins()).toEqual([]);
    expect(root.listMeshes()).toHaveLength(1);
    const bounds = getBounds(root.listScenes()[0]);
    expect(bounds.min[1]).toBeCloseTo(0, 2);
    expect(bounds.max[1]).toBeCloseTo(AUTHORED_HEIGHT, 2);
    const footprint = Math.max(
      Math.abs(bounds.min[0]),
      Math.abs(bounds.max[0]),
      Math.abs(bounds.min[2]),
      Math.abs(bounds.max[2]),
    );
    expect(footprint).toBeCloseTo(AUTHORED_FOOTPRINT_RADIUS, 1);
  });
});
