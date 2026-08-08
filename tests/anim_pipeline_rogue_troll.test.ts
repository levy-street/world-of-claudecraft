// Rogue-troll batch of the large-scale animation authoring initiative (issue
// #2889): the rest of the rogue's ability kit (beyond its existing garrote/
// kick/blind trio) plus mob_troll's bespoke attack. Both clips are authored
// by pose-sample-and-blend (scripts/anim/pose_blend.mjs,
// scripts/build_rogue_ability_anims.mjs, scripts/build_troll_anims.mjs), the
// same technique documented in .claude/skills/blender-anim-pipeline/SKILL.md.
// Follows the shipped-GLB-plus-manifest-source contract test pattern
// (tests/anim_pipeline_batch1.test.ts).
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

describe('rogue ability-specific attacks (issue #2889 rogue-troll batch)', () => {
  const ROGUE_NEW_CLIPS = [
    'Rogue_Quick_Strike',
    'Rogue_Backstab',
    'Rogue_Ambush',
    'Rogue_Low_Blow',
    'Rogue_Finisher_Slash',
  ];
  // Pre-existing bespoke clips (an earlier, unrelated generation) baked
  // directly into rogue.glb itself: this batch must not touch or duplicate
  // them, only add alongside.
  const ROGUE_PRIOR_CLIPS = ['Garrote_Choke', 'Kick_A', 'Dirt_Throw'];
  // Already-shipped rogue.glb clips this batch reuses with no baking (a
  // defensive guard and a raise gesture, the same no-bake pattern player_
  // warrior's raised_guard/sanguine_aura and the hunter batch's aspect
  // toggles use).
  const ROGUE_NOBAKE_CLIPS = ['Block', 'Spellcast_Raise'];

  it('ships all 5 new clips in a mesh-free donor GLB', () => {
    const glbPath = 'public/models/chars/players/rogue_ability_anims.glb';
    expect(clipNamesOf(glbPath).sort()).toEqual([...ROGUE_NEW_CLIPS].sort());
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it('the pre-existing bespoke clips and the no-bake reuses are shipped in rogue.glb itself', () => {
    const names = clipNamesOf('public/models/chars/players/rogue.glb');
    for (const clip of [...ROGUE_PRIOR_CLIPS, ...ROGUE_NOBAKE_CLIPS]) {
      expect(names, `rogue.glb missing '${clip}'`).toContain(clip);
    }
  });

  it('wires the donor GLB and every new clip on player_rogue, leaving the prior 3 entries untouched', () => {
    const block = manifestBlock('player_rogue: swims({', 'player_priest: swims({');
    expect(block).toContain('rogue_ability_anims.glb');
    expect(block).toContain('attackByAbility');
    for (const clip of ROGUE_NEW_CLIPS) expect(block).toContain(`'${clip}'`);
    // The 3 prior entries (an earlier, unrelated generation) are untouched.
    expect(block).toContain("garrote: 'Garrote_Choke'");
    expect(block).toContain("kick: 'Kick_A'");
    expect(block).toContain("blind: 'Dirt_Throw'");
  });

  it('every mapped ability id is a real rogue ability, and every referenced clip is shipped', () => {
    const rogueBlock = manifestBlock('player_rogue: swims({', 'player_priest: swims({');
    const abilityStart = rogueBlock.indexOf('attackByAbility: {');
    expect(abilityStart).toBeGreaterThanOrEqual(0);
    const abilityEnd = rogueBlock.indexOf('\n      },', abilityStart);
    expect(abilityEnd).toBeGreaterThan(abilityStart);
    const block = rogueBlock.slice(abilityStart, abilityEnd);
    const rows = [...block.matchAll(/^\s*([a-z_]+): '([A-Za-z_]+)',$/gm)];
    // 3 prior entries plus at least 10 new ones this batch adds.
    expect(rows.length).toBeGreaterThan(12);
    const knownClips = [...ROGUE_NEW_CLIPS, ...ROGUE_PRIOR_CLIPS, ...ROGUE_NOBAKE_CLIPS];
    for (const [, abilityId, clip] of rows) {
      expect(
        ABILITIES[abilityId],
        `attackByAbility key '${abilityId}' is not a real ability id`,
      ).toBeTruthy();
      expect(
        ABILITIES[abilityId]?.class,
        `attackByAbility key '${abilityId}' is not a rogue ability`,
      ).toBe('rogue');
      expect(
        knownClips,
        `attackByAbility value '${clip}' for '${abilityId}' is not a shipped clip`,
      ).toContain(clip);
    }
    const map = Object.fromEntries(rows.map(([, id, clip]) => [id, clip]));
    // Representative spot-checks: the positional opener, the kit's biggest
    // stealth hit, and a combo-spending finisher land on distinct clips.
    expect(map.backstab).toBe('Rogue_Backstab');
    expect(map.ambush).toBe('Rogue_Ambush');
    expect(map.eviscerate).toBe('Rogue_Finisher_Slash');
    expect(map.rupture).toBe('Rogue_Finisher_Slash');
    expect(map.evasion).toBe('Block');
    expect(map.stealth).toBe('Spellcast_Raise');
    // instant_poison/deadly_poison (the weapon-imbue self-buffs) are
    // deliberately excluded from this batch, no entry at all.
    expect(map.instant_poison).toBeUndefined();
    expect(map.deadly_poison).toBeUndefined();
  });
});

describe('mob_troll bespoke attack (issue #2889 rogue-troll batch)', () => {
  it('ships Troll_Smash in a mesh-free donor GLB', () => {
    const glbPath = 'public/models/creatures/troll_ability_anims.glb';
    expect(clipNamesOf(glbPath)).toEqual(['Troll_Smash']);
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it('gives mob_troll its own ClipMap instead of mutating the shared BIPED14 constant', () => {
    const trollBlock = manifestBlock('mob_troll: {', 'mob_ogre: {');
    expect(trollBlock).toContain('troll_ability_anims.glb');
    expect(trollBlock).toContain('clips: TROLL_BIPED14');
    expect(trollBlock).not.toContain('clips: BIPED14,');

    // BIPED14 itself (the constant definition, not a VisualDef using it) must
    // still read the original shared attack: every other family sharing it
    // by reference must be untouched by this change.
    const biped14ConstBlock = manifestBlock('const BIPED14: ClipMap = {', '};');
    expect(biped14ConstBlock).toContain("attack: ['Punch', 'Weapon']");

    // A specific sibling family this batch does not touch (a concurrent
    // in-flight batch may independently migrate a DIFFERENT BIPED14 member,
    // so this asserts one named family rather than an exact remaining count).
    // mob_yeti, mob_murloc, and mob_bear were all later migrated off the
    // shared constant too (issue #2889 round 2, their own bespoke attacks),
    // so mob_demon is the still-untouched sibling this assertion now names.
    const demonBlock = manifestBlock('mob_demon: {', 'mob_demon_flying: {');
    expect(demonBlock).toContain('clips: BIPED14,');
  });
});
