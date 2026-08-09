// Area B (issue #2889 round 2): mob_glub's bespoke "spore burst" attack.
// Authored by pose-sample-and-blend (scripts/anim/pose_blend.mjs,
// scripts/build_glub_anims.mjs), the same technique documented in
// .claude/skills/blender-anim-pipeline/SKILL.md and proven by batch 1
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

describe('glub family bespoke attack (issue #2889 round 2)', () => {
  it('ships Glub_Attack in a mesh-free donor GLB', () => {
    const glbPath = 'public/models/creatures/glub_ability_anims.glb';
    expect(clipNamesOf(glbPath)).toEqual(['Glub_Attack']);
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it('gives mob_glub its own ClipMap instead of mutating the shared FLOATING constant', () => {
    const glubBlock = manifestBlock('mob_glub: {', 'mob_crab: {');
    expect(glubBlock).toContain('glub_ability_anims.glb');
    expect(glubBlock).toContain('clips: GLUB_FLOATING');
    expect(glubBlock).not.toContain('clips: FLOATING,');

    // FLOATING itself (the constant definition, not a VisualDef using it)
    // must still read the original shared attack: the other families
    // sharing it by reference must be untouched by this change.
    const floatingConstBlock = manifestBlock('const FLOATING: ClipMap = {', '};');
    expect(floatingConstBlock).toContain("attack: ['Headbutt', 'Punch']");

    // Exactly 3 remaining direct `clips: FLOATING,` usages: mob_choir_thrall,
    // mob_glimmerwisp, mob_duskwisp.
    // mob_nightkin, mob_ghost, mob_demon_flying, and mob_dragonkin already
    // migrated off FLOATING on this branch's base; mob_glub migrates off it
    // above.
    const remaining = [...MANIFEST_SRC.matchAll(/clips: FLOATING,/g)].length;
    expect(remaining).toBe(3);
  });
});
