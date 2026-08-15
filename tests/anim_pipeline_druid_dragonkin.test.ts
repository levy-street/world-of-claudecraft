// Batch of the large-scale animation authoring initiative (issue #2889):
// druid caster-side ability-specific spellcasts + the dragonkin family's
// bespoke attack. Stacked on the batch 1 PR (mage casts + elemental attack,
// #2954). Both clips are authored by pose-sample-and-blend
// (scripts/anim/pose_blend.mjs, scripts/build_druid_ability_anims.mjs,
// scripts/build_dragonkin_anims.mjs), the same technique documented in
// .claude/skills/blender-anim-pipeline/SKILL.md. Follows the shipped-GLB-
// plus-manifest-source contract test pattern used by
// tests/anim_pipeline_batch1.test.ts (itself following
// tests/weapon_skins.test.ts's "bow skin attack animation" describe block).
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

describe('druid caster-side ability-specific spellcasts (issue #2889)', () => {
  const DRUID_CAST_CLIPS = [
    'Cast_Nature',
    'Cast_Starfall',
    'Cast_Nurture',
    'Cast_Roots',
    'Cast_Storm',
  ];

  it('ships all 5 cast clips in a mesh-free donor GLB', () => {
    const glbPath = 'public/models/chars/players/druid_ability_anims.glb';
    expect(clipNamesOf(glbPath).sort()).toEqual([...DRUID_CAST_CLIPS].sort());
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it('wires the donor GLB and an attackByAbility override for every mapped ability', () => {
    const block = manifestBlock('player_druid: swims({', 'player_mech: swims({');
    expect(block).toContain('druid_ability_anims.glb');
    expect(block).toContain('attackByAbility');
    for (const clip of DRUID_CAST_CLIPS) expect(block).toContain(`'${clip}'`);
  });

  it('every mapped ability id is a real druid ability, and every referenced clip is shipped', () => {
    const druidBlock = manifestBlock('player_druid: swims({', 'player_mech: swims({');
    const abilityStart = druidBlock.indexOf('attackByAbility: {');
    expect(abilityStart).toBeGreaterThanOrEqual(0);
    const abilityEnd = druidBlock.indexOf('\n      },', abilityStart);
    expect(abilityEnd).toBeGreaterThan(abilityStart);
    const block = druidBlock.slice(abilityStart, abilityEnd);
    const rows = [...block.matchAll(/^\s*([a-z_]+): '([A-Za-z_]+)',$/gm)];
    expect(rows.length).toBe(13);
    for (const [, abilityId, clip] of rows) {
      expect(
        ABILITIES[abilityId],
        `attackByAbility key '${abilityId}' is not a real ability id`,
      ).toBeTruthy();
      expect(ABILITIES[abilityId]?.class, `'${abilityId}' is not a druid ability`).toBe('druid');
      expect(
        DRUID_CAST_CLIPS,
        `attackByAbility value '${clip}' for '${abilityId}' is not a shipped clip`,
      ).toContain(clip);
    }
    // Primary signal is school (nature vs arcane); heal, root/CC, and channel
    // roles are the named exceptions within the nature school.
    const map = Object.fromEntries(rows.map(([, id, clip]) => [id, clip]));
    expect(map.moonfire).toBe('Cast_Starfall');
    expect(map.starfire).toBe('Cast_Starfall');
    expect(map.healing_touch).toBe('Cast_Nurture');
    expect(map.regrowth).toBe('Cast_Nurture');
    expect(map.rejuvenation).toBe('Cast_Nurture');
    expect(map.entangling_roots).toBe('Cast_Roots');
    expect(map.hibernate).toBe('Cast_Roots');
    expect(map.hurricane).toBe('Cast_Storm');
    expect(map.wrath).toBe('Cast_Nature');
  });
});

describe('dragonkin family bespoke attack (issue #2889)', () => {
  it('ships Dragonkin_Attack in a mesh-free donor GLB', () => {
    const glbPath = 'public/models/creatures/dragonkin_ability_anims.glb';
    expect(clipNamesOf(glbPath)).toEqual(['Dragonkin_Attack']);
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it('gives mob_dragonkin its own ClipMap instead of mutating the shared FLOATING constant', () => {
    const dragonkinBlock = manifestBlock('mob_dragonkin: {', 'mob_dragonkin_broodlord: {');
    expect(dragonkinBlock).toContain('dragonkin_ability_anims.glb');
    expect(dragonkinBlock).toContain('clips: DRAGONKIN_FLOATING');
    expect(dragonkinBlock).not.toContain('clips: FLOATING,');

    // FLOATING itself (the constant definition, not a VisualDef using it) must
    // still read the original shared attack: the other families sharing it
    // by reference (after batch 1's elemental migration, the ghost and
    // nightkin follow-ups, and this batch's dragonkin migration) must be
    // untouched by this change.
    const floatingConstBlock = manifestBlock('const FLOATING: ClipMap = {', '};');
    expect(floatingConstBlock).toContain("attack: ['Headbutt', 'Punch']");

    // Every other VisualDef still pointing at the shared constant is
    // untouched: exactly 3 remaining direct `clips: FLOATING,` usages (9
    // originally, minus batch 1's elemental migration, minus the ghost,
    // nightkin, round-2 glub, and flying demon follow-up migrations, minus
    // this batch's dragonkin migration).
    const remaining = [...MANIFEST_SRC.matchAll(/clips: FLOATING,/g)].length;
    expect(remaining).toBe(3);
  });

  it('does not touch the mage or elemental object literals from batch 1', () => {
    // Disjointness guard: this batch's manifest edits must not clash with
    // batch 1's (#2954) player_mage / mob_elemental blocks, or the other two
    // in-flight batches' player_paladin / mob_undead and player_hunter /
    // mob_ghost families.
    const mageBlock = manifestBlock('player_mage: swims({', 'player_warlock: swims({');
    expect(mageBlock).not.toContain('druid_ability_anims.glb');
    expect(mageBlock).not.toContain('Cast_Nature');

    const elementalBlock = manifestBlock('mob_elemental: {', 'mob_water_elemental: {');
    expect(elementalBlock).not.toContain('dragonkin_ability_anims.glb');
    expect(elementalBlock).toContain('clips: ELEMENTAL_FLOATING');
  });
});
