// Follow-up batch to batch 1 (issue #2889): hunter ability-specific attacks
// plus the ghost family's bespoke attack. Stacked on the batch 1 PR
// (scripts/anim/pose_blend.mjs, .claude/skills/blender-anim-pipeline/SKILL.md).
// Both clips are authored by pose-sample-and-blend
// (scripts/build_hunter_ability_anims.mjs, scripts/build_ghost_anims.mjs).
// Follows tests/anim_pipeline_batch1.test.ts's exact shipped-GLB-plus-
// manifest-source contract test pattern.
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

describe('hunter ability-specific attacks (issue #2889 follow-up batch)', () => {
  const HUNTER_BAKED_CLIPS = [
    'Hunter_Melee_Gut',
    'Hunter_Melee_Counter',
    'Hunter_Melee_Clip',
    'Hunter_Shot_Snap',
    'Hunter_Shot_LongDraw',
    'Hunter_Shot_Volley',
  ];
  // aspect_of_the_hawk/monkey/cheetah and rapid_fire point straight at
  // ranger.glb's own already-baked Spellcast_Raise clip (no new clip authored
  // for them, the same no-bake pattern player_warrior's sanguine_aura uses).
  const HUNTER_MAPPED_CLIPS = [...HUNTER_BAKED_CLIPS, 'Spellcast_Raise'];

  it('ships all 6 baked clips in a mesh-free donor GLB', () => {
    const glbPath = 'public/models/chars/players/hunter_ability_anims.glb';
    expect(clipNamesOf(glbPath).sort()).toEqual([...HUNTER_BAKED_CLIPS].sort());
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it('wires both donor GLBs (the pre-existing bow_anims.glb and the new one) and an attackByAbility override for every mapped ability', () => {
    const block = manifestBlock('player_hunter: swims({', 'player_rogue: swims({');
    expect(block).toContain('bow_anims.glb');
    expect(block).toContain('hunter_ability_anims.glb');
    expect(block).toContain('attackByAbility');
    for (const clip of HUNTER_BAKED_CLIPS) expect(block).toContain(`'${clip}'`);
  });

  it('every mapped ability id is a real hunter ability, and every referenced clip is shipped or an existing rig clip', () => {
    const hunterBlock = manifestBlock('player_hunter: swims({', 'player_rogue: swims({');
    const abilityStart = hunterBlock.indexOf('attackByAbility: {');
    expect(abilityStart).toBeGreaterThanOrEqual(0);
    const abilityEnd = hunterBlock.indexOf('\n      },', abilityStart);
    expect(abilityEnd).toBeGreaterThan(abilityStart);
    const block = hunterBlock.slice(abilityStart, abilityEnd);
    const rows = [...block.matchAll(/^\s*([a-z_]+): '([A-Za-z_]+)',$/gm)];
    expect(rows.length).toBeGreaterThan(10); // catches a wholesale accidental deletion
    for (const [, abilityId, clip] of rows) {
      expect(
        ABILITIES[abilityId],
        `attackByAbility key '${abilityId}' is not a real ability id`,
      ).toBeTruthy();
      expect(ABILITIES[abilityId]?.class, `'${abilityId}' is not a hunter ability`).toBe('hunter');
      expect(
        HUNTER_MAPPED_CLIPS,
        `attackByAbility value '${clip}' for '${abilityId}' is not a shipped or existing clip`,
      ).toContain(clip);
    }
    const map = Object.fromEntries(rows.map(([, id, clip]) => [id, clip]));
    // The three melee abilities each get their own bespoke swing.
    expect(map.raptor_strike).toBe('Hunter_Melee_Gut');
    expect(map.mongoose_bite).toBe('Hunter_Melee_Counter');
    expect(map.wing_clip).toBe('Hunter_Melee_Clip');
    // Long Draw names the slow full-draw clip; Volley gets its own barrage.
    expect(map.aimed_shot).toBe('Hunter_Shot_LongDraw');
    expect(map.volley).toBe('Hunter_Shot_Volley');
    // The three aspects and Fevered Draw share the raw, unbaked Spellcast_Raise.
    expect(map.aspect_of_the_hawk).toBe('Spellcast_Raise');
    expect(map.aspect_of_the_monkey).toBe('Spellcast_Raise');
    expect(map.aspect_of_the_cheetah).toBe('Spellcast_Raise');
    expect(map.rapid_fire).toBe('Spellcast_Raise');
    // Pet-command channels have no combat swing to author.
    expect(map.tame_beast).toBeUndefined();
    expect(map.dismiss_pet).toBeUndefined();
    expect(map.revive_pet).toBeUndefined();
  });
});

describe('ghost family bespoke attack (issue #2889 follow-up batch)', () => {
  it('ships Ghost_Attack in a mesh-free donor GLB', () => {
    const glbPath = 'public/models/creatures/ghost_ability_anims.glb';
    expect(clipNamesOf(glbPath)).toEqual(['Ghost_Attack']);
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it('gives mob_ghost its own ClipMap instead of mutating the shared FLOATING constant', () => {
    const ghostBlock = manifestBlock('mob_ghost: {', 'mob_glimmerwisp: {');
    expect(ghostBlock).toContain('ghost_ability_anims.glb');
    expect(ghostBlock).toContain('clips: GHOST_FLOATING');
    expect(ghostBlock).not.toContain('clips: FLOATING,');

    // FLOATING itself (the constant definition, not a VisualDef using it) must
    // still read the original shared attack: every OTHER family sharing it by
    // reference (including the elemental's own already-migrated constant)
    // must be untouched by this change.
    const floatingConstBlock = manifestBlock('const FLOATING: ClipMap = {', '};');
    expect(floatingConstBlock).toContain("attack: ['Headbutt', 'Punch']");
    const elementalConstBlock = manifestBlock('const ELEMENTAL_FLOATING: ClipMap = {', '};');
    expect(elementalConstBlock).toContain("attack: ['Elemental_Attack']");

    // The wisps (mob_glimmerwisp/mob_duskwisp) are unrigged bespoke meshes on
    // a DIFFERENT GLB where FLOATING simply no-ops; they, mob_choir_thrall
    // (a separate ghost.glb user), and every other FLOATING family stay on
    // the shared constant. 9 families shared FLOATING/ELEMENTAL_FLOATING
    // originally (batch 1's own pin); this batch migrates one more
    // (mob_ghost), and the nightkin family's own follow-up migration to
    // NIGHTKIN_FLOATING (tests/anim_pipeline_warlock_nightkin.test.ts) takes
    // one more, and the round-2 glub migration (tests/anim_pipeline_glub.test.ts)
    // takes one more still, and the flying demon's own migration to
    // DEMON_FLYING_FLOATING (tests/anim_pipeline_shaman_demonflying.test.ts)
    // takes one more still, leaving 4 remaining direct `clips: FLOATING,`
    // usages.
    const remaining = [...MANIFEST_SRC.matchAll(/clips: FLOATING,/g)].length;
    expect(remaining).toBe(4);
  });
});
