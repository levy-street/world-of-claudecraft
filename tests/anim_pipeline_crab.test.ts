// mob_crab's bespoke attack (issue #2889 round 2). Authored by
// pose-sample-and-blend (scripts/anim/pose_blend.mjs,
// scripts/build_crab_anims.mjs), the same technique documented in
// .claude/skills/blender-anim-pipeline/SKILL.md. Follows the
// shipped-GLB-plus-manifest-source contract test pattern
// (tests/anim_pipeline_batch1.test.ts).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');

function clipNamesOf(glbPath: string): string[] {
  const glb = readFileSync(join(ROOT, glbPath));
  const jsonLen = glb.readUInt32LE(12);
  const doc = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
  return (doc.animations ?? []).map((a: { name?: string }) => a.name);
}

function meshCountOf(glbPath: string): number {
  const glb = readFileSync(join(ROOT, glbPath));
  const jsonLen = glb.readUInt32LE(12);
  const doc = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
  return (doc.meshes ?? []).length;
}

const MANIFEST_SRC = readFileSync(join(ROOT, 'src/render/characters/manifest.ts'), 'utf8');

function manifestBlock(startAnchor: string, endAnchor: string): string {
  const start = MANIFEST_SRC.indexOf(startAnchor);
  expect(start, startAnchor).toBeGreaterThanOrEqual(0);
  const end = MANIFEST_SRC.indexOf(endAnchor, start);
  expect(end, `${startAnchor} .. ${endAnchor}`).toBeGreaterThan(start);
  return MANIFEST_SRC.slice(start, end);
}

describe('mob_crab bespoke attack (issue #2889 round 2)', () => {
  it('ships Crab_Attack in a mesh-free donor GLB', () => {
    const glbPath = 'public/models/creatures/crab_ability_anims.glb';
    expect(clipNamesOf(glbPath)).toEqual(['Crab_Attack']);
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it('gives mob_crab its own ClipMap instead of mutating the shared ENEMY_BITE constant', () => {
    const crabBlock = manifestBlock('mob_crab: {', 'mob_bull: {');
    expect(crabBlock).toContain('crab_ability_anims.glb');
    expect(crabBlock).toContain('clips: CRAB_ENEMY_BITE');
    expect(crabBlock).not.toContain('clips: ENEMY_BITE,');

    // ENEMY_BITE itself (the constant definition, not a VisualDef using it)
    // must still read the original shared attack: mob_treant, the other
    // family sharing it by reference, must be untouched by this change.
    const enemyBiteConstBlock = manifestBlock('const ENEMY_BITE: ClipMap = {', '};');
    expect(enemyBiteConstBlock).toContain("attack: ['Bite_Front']");

    // Exactly 0 remaining direct `clips: ENEMY_BITE,` usages (2 as of this
    // branch's base off upstream/release/v0.35.0: mob_treant was migrated to
    // TREANT_ENEMY_BITE in parallel, and mob_crab is migrated to
    // CRAB_ENEMY_BITE above).
    const remaining = [...MANIFEST_SRC.matchAll(/clips: ENEMY_BITE,/g)].length;
    expect(remaining).toBe(0);
  });
});
