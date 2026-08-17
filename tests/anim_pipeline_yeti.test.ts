// Area B (issue #2889 round 2): mob_yeti's bespoke "icy roar-and-swipe"
// attack. Authored by pose-sample-and-blend (scripts/anim/pose_blend.mjs,
// scripts/build_yeti_anims.mjs), the same technique documented in
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

describe('yeti family bespoke attack (issue #2889 round 2)', () => {
  it('ships Yeti_Attack in a mesh-free donor GLB', () => {
    const glbPath = 'public/models/creatures/yeti_ability_anims.glb';
    expect(clipNamesOf(glbPath)).toEqual(['Yeti_Attack']);
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it('gives mob_yeti its own ClipMap instead of mutating the shared BIPED14 constant', () => {
    const yetiBlock = manifestBlock('mob_yeti: {', 'mob_spider: {');
    expect(yetiBlock).toContain('yeti_ability_anims.glb');
    expect(yetiBlock).toContain('clips: YETI_BIPED14');
    expect(yetiBlock).not.toContain('clips: BIPED14,');

    const bipedConstBlock = manifestBlock('const BIPED14: ClipMap = {', '};');
    expect(bipedConstBlock).toContain("attack: ['Punch', 'Weapon']");

    // No remaining direct `clips: BIPED14,` usages. mob_yeti moved to
    // YETI_BIPED14 above, mob_troll moved to TROLL_BIPED14 (issue #2889),
    // mob_murloc moved to MURLOC_BIPED14 (issue #2889 round 2), mob_bear
    // moved to BEAR_BIPED14, and mob_demon / mob_demonalt moved to
    // DEMON_BIPED14 (the warlock demon pet bespoke-attack change).
    const remaining = [...MANIFEST_SRC.matchAll(/clips: BIPED14,/g)].length;
    expect(remaining).toBe(0);
  });
});
