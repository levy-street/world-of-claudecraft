// Area B (issue #2889 round 2): the warlock demon pet family's (mob_demon +
// mob_demonalt) bespoke "nod-and-slash" attack. Authored by pose-sample-
// and-blend (scripts/anim/pose_blend.mjs, scripts/build_demon_anims.mjs),
// the same technique documented in .claude/skills/blender-anim-pipeline/
// SKILL.md and proven by batch 1 (tests/anim_pipeline_batch1.test.ts).
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

describe('warlock demon pet family bespoke attack (issue #2889 round 2)', () => {
  it('ships Demon_Attack in a mesh-free donor GLB', () => {
    const glbPath = 'public/models/creatures/demon_ability_anims.glb';
    expect(clipNamesOf(glbPath)).toEqual(['Demon_Attack']);
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it('gives BOTH mob_demon and mob_demonalt the shared new ClipMap instead of mutating BIPED14', () => {
    const demonBlock = manifestBlock('mob_demon: {', 'mob_demon_flying: {');
    expect(demonBlock).toContain('demon_ability_anims.glb');
    expect(demonBlock).toContain('clips: DEMON_BIPED14');
    expect(demonBlock).not.toContain('clips: BIPED14,');

    const demonaltBlock = manifestBlock('mob_demonalt: {', 'delve_skel_wraith: {');
    expect(demonaltBlock).toContain('demon_ability_anims.glb');
    expect(demonaltBlock).toContain('clips: DEMON_BIPED14');
    expect(demonaltBlock).not.toContain('clips: BIPED14,');

    // BIPED14 itself (the constant definition, not a VisualDef using it)
    // must still read the original shared attack.
    const bipedConstBlock = manifestBlock('const BIPED14: ClipMap = {', '};');
    expect(bipedConstBlock).toContain("attack: ['Punch', 'Weapon']");

    // No remaining direct `clips: BIPED14,` usages. mob_troll, mob_yeti,
    // mob_murloc, and mob_bear already moved to their own TROLL_BIPED14 /
    // YETI_BIPED14 / MURLOC_BIPED14 / BEAR_BIPED14 clip maps, and
    // mob_demon / mob_demonalt are the TWO migrated to DEMON_BIPED14 above.
    const remaining = [...MANIFEST_SRC.matchAll(/clips: BIPED14,/g)].length;
    expect(remaining).toBe(0);
  });
});
