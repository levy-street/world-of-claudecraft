// Follow-up batch of the large-scale animation authoring initiative (issue
// #2889): paladin ability-specific clips + the skeleton golem's bespoke
// attack. Both clips are authored by pose-sample-and-blend
// (scripts/anim/pose_blend.mjs, scripts/build_paladin_ability_anims.mjs,
// scripts/build_skeleton_golem_anims.mjs), the same technique documented in
// .claude/skills/blender-anim-pipeline/SKILL.md and pinned for batch 1 by
// tests/anim_pipeline_batch1.test.ts (the shipped-GLB-plus-manifest-source
// contract test pattern, itself following tests/weapon_skins.test.ts's "bow
// skin attack animation" describe block).
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

describe('paladin ability-specific clips (issue #2889 follow-up batch)', () => {
  const PALADIN_CLIPS = [
    'Cast_Verdict',
    'Cast_Consecrate',
    'Cast_HammerBash',
    'Cast_Ward',
    'Cast_Blessing',
    'Cast_HolyMend',
  ];

  it('ships all 6 clips in a mesh-free donor GLB', () => {
    const glbPath = 'public/models/chars/players/paladin_ability_anims.glb';
    expect(clipNamesOf(glbPath).sort()).toEqual([...PALADIN_CLIPS].sort());
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it('wires the donor GLB and an attackByAbility override for every mapped ability', () => {
    const block = manifestBlock('player_paladin: swims({', 'player_hunter: swims({');
    expect(block).toContain('paladin_ability_anims.glb');
    expect(block).toContain('attackByAbility');
    for (const clip of PALADIN_CLIPS) expect(block).toContain(`'${clip}'`);
  });

  it('every mapped ability id is a real paladin ability, and every referenced clip is shipped', () => {
    const paladinBlock = manifestBlock('player_paladin: swims({', 'player_hunter: swims({');
    const abilityStart = paladinBlock.indexOf('attackByAbility: {');
    expect(abilityStart).toBeGreaterThanOrEqual(0);
    const abilityEnd = paladinBlock.indexOf('\n      },', abilityStart);
    expect(abilityEnd).toBeGreaterThan(abilityStart);
    const block = paladinBlock.slice(abilityStart, abilityEnd);
    const rows = [...block.matchAll(/^\s*([a-z_]+): '([A-Za-z_]+)',$/gm)];
    expect(rows.length).toBeGreaterThan(8); // catches a wholesale accidental deletion
    for (const [, abilityId, clip] of rows) {
      expect(
        ABILITIES[abilityId],
        `attackByAbility key '${abilityId}' is not a real ability id`,
      ).toBeTruthy();
      expect(ABILITIES[abilityId]?.class, `'${abilityId}' is not a paladin ability`).toBe(
        'paladin',
      );
      expect(
        PALADIN_CLIPS,
        `attackByAbility value '${clip}' for '${abilityId}' is not a shipped clip`,
      ).toContain(clip);
    }
    // Judgement (the seal-unleashing finisher) and Consecration (the ground
    // AoE) each name their own clip; the two defensive cooldowns share
    // Cast_Ward and the four buff/aura abilities share Cast_Blessing.
    const map = Object.fromEntries(rows.map(([, id, clip]) => [id, clip]));
    expect(map.judgement).toBe('Cast_Verdict');
    expect(map.consecration).toBe('Cast_Consecrate');
    expect(map.hammer_of_justice).toBe('Cast_HammerBash');
    expect(map.divine_protection).toBe('Cast_Ward');
    expect(map.sacred_bulwark).toBe('Cast_Ward');
    expect(map.holy_light).toBe('Cast_HolyMend');
    expect(map.flash_of_light).toBe('Cast_HolyMend');
    expect(map.lay_on_hands).toBe('Cast_HolyMend');
  });
});

describe('skeleton golem bespoke attack (issue #2889 follow-up batch)', () => {
  it('ships Golem_Slam in a mesh-free donor GLB', () => {
    const glbPath = 'public/models/chars/enemies/skeleton_golem_anims.glb';
    expect(clipNamesOf(glbPath)).toEqual(['Golem_Slam']);
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it('gives skel_golem its own bespoke attack instead of the generic two-hand swing', () => {
    const golemBlock = manifestBlock('skel_golem: {', 'mob_bandit: {');
    expect(golemBlock).toContain('skeleton_golem_anims.glb');
    // The clips object OVERRIDES attack to the bespoke clip; the underlying
    // spread call still names the original generic pair it replaces (the
    // same shape ELEMENTAL_FLOATING uses over the shared FLOATING constant:
    // spread the old value, override just the changed field).
    expect(golemBlock).toContain(
      "...skeletonLargeClips(['2H_Melee_Attack_Chop', '1H_Melee_Attack_Chop'])",
    );
    expect(golemBlock).toContain("attack: ['Golem_Slam']");

    // skel_golem is the ONLY VisualDef calling skeletonLargeClips; the other
    // skeleton VisualDefs share the smaller 41-joint rig via skeletonClips()
    // instead and are untouched by this change.
    const largeClipsCallers = [...MANIFEST_SRC.matchAll(/clips: \{\s*\.\.\.skeletonLargeClips\(/g)]
      .length;
    expect(largeClipsCallers).toBe(1);
    const skeletonClipsCallers = [...MANIFEST_SRC.matchAll(/clips: skeletonClips\(/g)].length;
    expect(skeletonClipsCallers).toBeGreaterThanOrEqual(10);
  });

  it('is wired to a real boss/rare mob (a dungeon final boss among them)', () => {
    const mobKeysBlock = manifestBlock('nythraxis_scourge_of_thornpeak:', '\n  ');
    expect(mobKeysBlock).toContain("'skel_golem'");
  });
});
