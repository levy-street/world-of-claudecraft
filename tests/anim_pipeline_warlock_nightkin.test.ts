// One batch of the large-scale animation authoring initiative (issue #2889):
// warlock ability-specific spellcasts + the nightkin family's bespoke attack.
// Both clips are authored by pose-sample-and-blend (scripts/anim/pose_blend.mjs,
// scripts/build_warlock_ability_anims.mjs, scripts/build_nightkin_anims.mjs), the
// same technique documented in .claude/skills/blender-anim-pipeline/SKILL.md and
// pinned for the first batch by tests/anim_pipeline_batch1.test.ts.
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

describe('warlock ability-specific spellcasts (issue #2889)', () => {
  const WARLOCK_CAST_CLIPS = [
    'Warlock_Cast_Shadow',
    'Warlock_Cast_Fire',
    'Warlock_Cast_Drain',
    'Warlock_Cast_Burst',
  ];

  it('ships all 4 cast clips in a mesh-free donor GLB', () => {
    const glbPath = 'public/models/chars/players/warlock_ability_anims.glb';
    expect(clipNamesOf(glbPath).sort()).toEqual([...WARLOCK_CAST_CLIPS].sort());
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it('wires the donor GLB and an attackByAbility override for every mapped ability', () => {
    const block = manifestBlock('player_warlock: swims({', 'player_druid: swims({');
    expect(block).toContain('warlock_ability_anims.glb');
    expect(block).toContain('attackByAbility');
    for (const clip of WARLOCK_CAST_CLIPS) expect(block).toContain(`'${clip}'`);
  });

  it('every mapped ability id is a real warlock ability, and every referenced clip is shipped', () => {
    const warlockBlock = manifestBlock('player_warlock: swims({', 'player_druid: swims({');
    const abilityStart = warlockBlock.indexOf('attackByAbility: {');
    expect(abilityStart).toBeGreaterThanOrEqual(0);
    const abilityEnd = warlockBlock.indexOf('\n      },', abilityStart);
    expect(abilityEnd).toBeGreaterThan(abilityStart);
    const block = warlockBlock.slice(abilityStart, abilityEnd);
    const rows = [...block.matchAll(/^\s*([a-z_]+): '([A-Za-z_]+)',$/gm)];
    expect(rows.length).toBe(12); // catches a wholesale accidental deletion
    for (const [, abilityId, clip] of rows) {
      const ability = ABILITIES[abilityId];
      expect(ability, `attackByAbility key '${abilityId}' is not a real ability id`).toBeTruthy();
      expect(ability?.class, `attackByAbility key '${abilityId}' is not a warlock ability`).toBe(
        'warlock',
      );
      expect(
        WARLOCK_CAST_CLIPS,
        `attackByAbility value '${clip}' for '${abilityId}' is not a shipped clip`,
      ).toContain(clip);
    }
    // Every non-pet warlock ability is mapped; the pet-summon channels
    // (summon_imp/voidwalker/succubus/felhunter/felguard/infernal/doomguard)
    // have no combat swing and stay unmapped.
    const map = Object.fromEntries(rows.map(([, id, clip]) => [id, clip]));
    expect(map.shadow_bolt).toBe('Warlock_Cast_Shadow');
    expect(map.corruption).toBe('Warlock_Cast_Shadow');
    expect(map.curse_of_agony).toBe('Warlock_Cast_Shadow');
    expect(map.immolate).toBe('Warlock_Cast_Fire');
    expect(map.searing_pain).toBe('Warlock_Cast_Fire');
    expect(map.rain_of_fire).toBe('Warlock_Cast_Fire');
    expect(map.drain_life).toBe('Warlock_Cast_Drain');
    expect(map.shadowburn).toBe('Warlock_Cast_Burst');
    expect(map.fear).toBe('Warlock_Cast_Burst');
    expect(map.life_tap).toBe('Warlock_Cast_Burst');
    expect(map.demon_skin).toBe('Warlock_Cast_Burst');
    expect(map.spell_lock).toBe('Warlock_Cast_Burst');
    // The seven pet-summon abilities stay on the default wand zap.
    for (const petAbility of [
      'summon_imp',
      'summon_voidwalker',
      'summon_succubus',
      'summon_felhunter',
      'summon_felguard',
      'summon_infernal',
      'summon_doomguard',
    ]) {
      expect(
        map[petAbility],
        `${petAbility} should not have an authored cast clip`,
      ).toBeUndefined();
    }
  });
});

describe('nightkin family bespoke attack (issue #2889)', () => {
  it('ships Nightkin_Attack in a mesh-free donor GLB', () => {
    const glbPath = 'public/models/creatures/nightkin_ability_anims.glb';
    expect(clipNamesOf(glbPath)).toEqual(['Nightkin_Attack']);
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it('gives mob_nightkin its own ClipMap instead of mutating the shared FLOATING constant', () => {
    const nightkinBlock = manifestBlock('mob_nightkin: {', 'mob_ghost: {');
    expect(nightkinBlock).toContain('nightkin_ability_anims.glb');
    expect(nightkinBlock).toContain('clips: NIGHTKIN_FLOATING');
    expect(nightkinBlock).not.toContain('clips: FLOATING,');

    // FLOATING itself (the constant definition, not a VisualDef using it) must
    // still read the original shared attack: every other family sharing it by
    // reference must be untouched by this change.
    const floatingConstBlock = manifestBlock('const FLOATING: ClipMap = {', '};');
    expect(floatingConstBlock).toContain("attack: ['Headbutt', 'Punch']");

    // Every other VisualDef still pointing at the shared constant is untouched:
    // exactly 7 remaining direct `clips: FLOATING,` usages in this batch's base
    // (8 in this branch's base, minus the one migrated to NIGHTKIN_FLOATING
    // above; other batches migrating other members land as separate PRs).
    const remaining = [...MANIFEST_SRC.matchAll(/clips: FLOATING,/g)].length;
    expect(remaining).toBe(7);
  });
});
