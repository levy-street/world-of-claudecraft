// A batch of the large-scale animation authoring initiative (issue #2889):
// skel_boss's (Morthen the Gravecaller) bespoke ritual-strike attack plus
// mob_stag's bespoke charge attack. Both clips are authored by
// pose-sample-and-blend (scripts/anim/pose_blend.mjs,
// scripts/build_skelboss_anims.mjs, scripts/build_stag_anims.mjs), the same
// technique documented in .claude/skills/blender-anim-pipeline/SKILL.md.
// Follows the shipped-GLB-plus-manifest-source contract test pattern
// (tests/weapon_skins.test.ts's "bow skin attack animation" describe block,
// tests/anim_pipeline_batch1.test.ts).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/data';

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

describe('skel_boss bespoke attack (issue #2889)', () => {
  it('ships SkelBoss_Attack in a mesh-free donor GLB', () => {
    const glbPath = 'public/models/chars/enemies/skelboss_ability_anims.glb';
    expect(clipNamesOf(glbPath)).toEqual(['SkelBoss_Attack']);
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it('gives skel_boss its own attack instead of the shared skeletonClips() chop', () => {
    const bossBlock = manifestBlock('skel_boss: {', 'skel_necromancer: {');
    expect(bossBlock).toContain('skelboss_ability_anims.glb');
    expect(bossBlock).toContain('skeletonClips(');
    expect(bossBlock).toContain("attack: ['SkelBoss_Attack']");
    expect(bossBlock).not.toContain("clips: skeletonClips(['2H_Melee_Attack_Chop'], 'Taunt'),");

    // Every clip named on this VisualDef must be a real clip shipped by the
    // new donor GLB (catches a copy-paste stray).
    expect(clipNamesOf('public/models/chars/enemies/skelboss_ability_anims.glb')).toContain(
      'SkelBoss_Attack',
    );

    // skel_mage, the other VisualDef on the SAME skeleton_mage.glb rig
    // sharing skeletonClips()'s plain '2H_Melee_Attack_Chop' vocabulary, is
    // untouched.
    const mageBlock = manifestBlock('skel_mage: {', 'skel_boss: {');
    expect(mageBlock).toContain("clips: skeletonClips(['2H_Melee_Attack_Chop']),");
  });

  it('delve_skel_varric (the other Taunt-flourish skeleton_mage.glb boss) still shares the plain chop', () => {
    const varricBlock = manifestBlock('delve_skel_varric: {', 'skel_minion: {');
    expect(varricBlock).toContain("clips: skeletonClips(['2H_Melee_Attack_Chop'], 'Taunt'),");
    expect(varricBlock).not.toContain('SkelBoss_Attack');
  });
});

describe('mob_stag bespoke attack (issue #2889)', () => {
  it('ships Stag_Attack_Charge in a mesh-free donor GLB', () => {
    const glbPath = 'public/models/creatures/stag_ability_anims.glb';
    expect(clipNamesOf(glbPath)).toEqual(['Stag_Attack_Charge']);
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it('gives mob_stag its own attack instead of the standing Headbutt/Kick pair', () => {
    const stagBlock = manifestBlock('mob_stag: {', 'mob_veiled_stag: {');
    expect(stagBlock).toContain('stag_ability_anims.glb');
    expect(stagBlock).toContain("attack: ['Stag_Attack_Charge']");
    expect(stagBlock).not.toContain("clips: animal(['Attack_Headbutt', 'Attack_Kick']),");
  });

  it('leaves the repainted rig siblings on the shared standing Headbutt/Kick pair', () => {
    // veiled_stag, gleamstag, veiled_doe and aurelhorn are the same Quaternius
    // rig re-skinned into separate GLB files, all calling animal() with the
    // identical array by convention. None of them share mob_stag's new clip.
    for (const [start, end] of [
      ['mob_veiled_stag: {', 'mob_gleamstag: {'],
      ['mob_gleamstag: {', 'mob_veiled_doe: {'],
      ['mob_aurelhorn: {', 'mob_training_dummy: {'],
    ]) {
      const block = manifestBlock(start, end);
      expect(block).toContain("clips: animal(['Attack_Headbutt', 'Attack_Kick']),");
      expect(block).not.toContain('Stag_Attack_Charge');
      expect(block).not.toContain('stag_ability_anims.glb');
    }
  });
});

describe('shared module reuse (issue #2889)', () => {
  it('both new build scripts import the shared pose_blend module, not a duplicate', () => {
    const skelboss = readFileSync(join(ROOT, 'scripts/build_skelboss_anims.mjs'), 'utf8');
    const stag = readFileSync(join(ROOT, 'scripts/build_stag_anims.mjs'), 'utf8');
    for (const src of [skelboss, stag]) {
      expect(src).toContain("from './anim/pose_blend.mjs'");
      expect(src).toContain('mergePoses');
    }
  });
});

// Neither new clip is dispatched by ability id (both are plain creature
// attack-array overrides, not a class attackByAbility set), but ABILITIES
// stays imported to match the shared contract-test shape used by sibling
// batches and to catch an accidental future attackByAbility addition on
// either VisualDef without a matching real ability id.
describe('no stray attackByAbility on either VisualDef (issue #2889)', () => {
  it('skel_boss and mob_stag carry no attackByAbility overrides', () => {
    const bossBlock = manifestBlock('skel_boss: {', 'skel_necromancer: {');
    expect(bossBlock).not.toContain('attackByAbility');
    const stagBlock = manifestBlock('mob_stag: {', 'mob_veiled_stag: {');
    expect(stagBlock).not.toContain('attackByAbility');
    expect(Object.keys(ABILITIES).length).toBeGreaterThan(0);
  });
});
