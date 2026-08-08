// Area B (issue #2889 round 2): mob_bear's bespoke "ground-swipe maul"
// attack. Authored by pose-sample-and-blend (scripts/anim/pose_blend.mjs,
// scripts/build_bear_anims.mjs), the same technique documented in
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

describe('bear family bespoke attack (issue #2889 round 2)', () => {
  it('ships Bear_Attack in a mesh-free donor GLB', () => {
    const glbPath = 'public/models/creatures/bear_ability_anims.glb';
    expect(clipNamesOf(glbPath)).toEqual(['Bear_Attack']);
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it('gives mob_bear its own ClipMap instead of mutating the shared BIPED14 constant', () => {
    const bearBlock = manifestBlock('mob_bear: {', 'mob_yeti: {');
    expect(bearBlock).toContain('bear_ability_anims.glb');
    expect(bearBlock).toContain('clips: BEAR_BIPED14');
    expect(bearBlock).not.toContain('clips: BIPED14,');

    // BIPED14 itself (the constant definition, not a VisualDef using it)
    // must still read the original shared attack.
    const bipedConstBlock = manifestBlock('const BIPED14: ClipMap = {', '};');
    expect(bipedConstBlock).toContain("attack: ['Punch', 'Weapon']");

    // Exactly 2 remaining direct `clips: BIPED14,` usages (6 originally:
    // mob_bear, mob_yeti, mob_murloc, mob_troll, mob_demon, mob_demonalt,
    // minus the one migrated to BEAR_BIPED14 above, the one already
    // migrated to TROLL_BIPED14 by mob_troll's own bespoke attack, the one
    // already migrated to YETI_BIPED14 by mob_yeti's own bespoke attack,
    // and the one already migrated to MURLOC_BIPED14 by mob_murloc's own
    // bespoke attack, #2889).
    const remaining = [...MANIFEST_SRC.matchAll(/clips: BIPED14,/g)].length;
    expect(remaining).toBe(2);
  });
});
