// greyjaw's bespoke attack (issue #2889 round 2). Authored by
// pose-sample-and-blend (scripts/anim/pose_blend.mjs,
// scripts/build_greyjaw_anims.mjs), the same technique documented in
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

describe('greyjaw bespoke attack (issue #2889 round 2)', () => {
  it('ships Greyjaw_Attack in a mesh-free donor GLB', () => {
    const glbPath = 'public/models/creatures/greyjaw_ability_anims.glb';
    expect(clipNamesOf(glbPath)).toEqual(['Greyjaw_Attack']);
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it('gives greyjaw its own ClipMap instead of mutating the shared WOLF_BAKED constant', () => {
    const greyjawBlock = manifestBlock('greyjaw: {', 'mob_boar: {');
    expect(greyjawBlock).toContain('greyjaw_ability_anims.glb');
    expect(greyjawBlock).toContain('clips: GREYJAW_WOLF');
    expect(greyjawBlock).not.toContain('clips: WOLF_BAKED,');

    // WOLF_BAKED itself (the constant definition) must still build off the
    // shared animal() core with the plain Attack: mob_wolf and form_cat, the
    // other two families sharing it by reference, must be untouched.
    const wolfBakedConstBlock = manifestBlock('const WOLF_BAKED: ClipMap = {', '};');
    expect(wolfBakedConstBlock).toContain("...animal(['Attack'])");

    // Exactly 2 remaining direct `clips: WOLF_BAKED,` usages (3 as of this
    // branch's base off upstream/release/v0.35.0, minus the one migrated to
    // GREYJAW_WOLF above): mob_wolf, form_cat.
    const remaining = [...MANIFEST_SRC.matchAll(/clips: WOLF_BAKED,/g)].length;
    expect(remaining).toBe(2);
  });

  it('is attack-only: greyjaw already wires both hit-react clips via animal(), no hit-variety change needed', () => {
    const greyjawBlock = manifestBlock('greyjaw: {', 'mob_boar: {');
    expect(greyjawBlock).not.toContain('hit:');
    const wolfBakedConstBlock = manifestBlock('const WOLF_BAKED: ClipMap = {', '};');
    expect(wolfBakedConstBlock).not.toContain('hit:');
    const animalFactoryBlock = manifestBlock(
      'const animal = (attack: string[]): ClipMap => ({',
      '});',
    );
    expect(animalFactoryBlock).toContain("hit: ['Idle_HitReact_Left', 'Idle_HitReact_Right']");
  });
});
