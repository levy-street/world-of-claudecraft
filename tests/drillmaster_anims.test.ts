// The Muster Drillmaster's authored clips (scripts/build_drillmaster_anims.mjs): the lean on
// the planted mallet he holds between blows, and the pound that brings the mallet head down
// on the ground on the sim's strike frame. Shipped-GLB-plus-manifest-source contract, the
// tests/anim_pipeline_batch1.test.ts pattern.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MUSTER_MALLET_POUND_ABILITY } from '../src/sim/muster_effigy_core';

const ROOT = join(__dirname, '..');
const GLB = 'public/models/chars/players/drillmaster_anims.glb';

function gltfJson(path: string): {
  animations?: { name?: string; channels?: unknown[] }[];
  meshes?: unknown[];
  skins?: unknown[];
} {
  const glb = readFileSync(join(ROOT, path));
  const jsonLen = glb.readUInt32LE(12);
  return JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
}

describe('the drillmaster clips', () => {
  it('ships exactly the rest and the pound, as a mesh-free clip donor', () => {
    const doc = gltfJson(GLB);
    expect((doc.animations ?? []).map((a) => a.name).sort()).toEqual(['Drill_Pound', 'Drill_Rest']);
    for (const a of doc.animations ?? []) expect((a.channels ?? []).length).toBeGreaterThan(20);
    expect(doc.meshes ?? []).toHaveLength(0);
    expect(doc.skins ?? []).toHaveLength(0);
  });
});
