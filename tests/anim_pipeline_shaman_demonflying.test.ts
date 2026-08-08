// Shaman class plus mob_demon_flying batch of the large-scale animation
// authoring initiative (issue #2889): shaman ability-specific spellcasts and
// the flying demon family's bespoke attack. Both clips are authored by
// pose-sample-and-blend (scripts/anim/pose_blend.mjs,
// scripts/build_shaman_ability_anims.mjs,
// scripts/build_demon_flying_anims.mjs), the same technique documented in
// .claude/skills/blender-anim-pipeline/SKILL.md. Follows the shipped-GLB-plus-
// manifest-source contract test pattern (tests/anim_pipeline_batch1.test.ts,
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

function channelCountOf(glbPath: string, clipName: string): number {
  const glb = readFileSync(join(ROOT, glbPath));
  const jsonLen = glb.readUInt32LE(12);
  const doc = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
  const anim = (doc.animations ?? []).find((a: { name?: string }) => a.name === clipName);
  expect(anim, `clip '${clipName}' not found in ${glbPath}`).toBeTruthy();
  return anim.channels.length;
}

const MANIFEST_SRC = readFileSync(join(ROOT, 'src/render/characters/manifest.ts'), 'utf8');

function manifestBlock(startAnchor: string, endAnchor: string): string {
  const start = MANIFEST_SRC.indexOf(startAnchor);
  expect(start, startAnchor).toBeGreaterThanOrEqual(0);
  const end = MANIFEST_SRC.indexOf(endAnchor, start);
  expect(end, `${startAnchor} .. ${endAnchor}`).toBeGreaterThan(start);
  return MANIFEST_SRC.slice(start, end);
}

describe('shaman ability-specific spellcasts (issue #2889)', () => {
  const SHAMAN_CAST_CLIPS = ['Cast_Bolt', 'Cast_Shock', 'Cast_Heal', 'Cast_Quake', 'Storm_Strike'];

  it('ships all 5 cast clips in a mesh-free donor GLB', () => {
    const glbPath = 'public/models/chars/players/shaman_ability_anims.glb';
    expect(clipNamesOf(glbPath).sort()).toEqual([...SHAMAN_CAST_CLIPS].sort());
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it('wires the donor GLB and an attackByAbility override for every mapped ability', () => {
    const block = manifestBlock('player_shaman: swims({', 'player_mage: swims({');
    expect(block).toContain('shaman_ability_anims.glb');
    expect(block).toContain('attackByAbility');
    for (const clip of SHAMAN_CAST_CLIPS) expect(block).toContain(`'${clip}'`);
  });

  it('every mapped ability id is a real shaman ability, and every referenced bespoke clip is shipped', () => {
    const shamanBlock = manifestBlock('player_shaman: swims({', 'player_mage: swims({');
    const abilityStart = shamanBlock.indexOf('attackByAbility: {');
    expect(abilityStart).toBeGreaterThanOrEqual(0);
    const abilityEnd = shamanBlock.indexOf('\n      },', abilityStart);
    expect(abilityEnd).toBeGreaterThan(abilityStart);
    const block = shamanBlock.slice(abilityStart, abilityEnd);
    const rows = [...block.matchAll(/^\s*([a-z_]+): '([A-Za-z_]+)',$/gm)];
    // 14 real shaman-tagged abilities exist in classes.ts (base kit plus the
    // Elemental/Restoration spec signatures); this batch maps every one.
    expect(rows.length).toBe(14);
    for (const [, abilityId, clip] of rows) {
      expect(
        ABILITIES[abilityId],
        `attackByAbility key '${abilityId}' is not a real ability id`,
      ).toBeTruthy();
      expect(ABILITIES[abilityId]?.class, `'${abilityId}' is not a shaman ability`).toBe('shaman');
      const isBespoke = SHAMAN_CAST_CLIPS.includes(clip);
      const isNoBakeGesture = clip === 'Spellcast_Raise' || clip === 'Block';
      expect(
        isBespoke || isNoBakeGesture,
        `attackByAbility value '${clip}' for '${abilityId}' is neither a shipped bespoke clip nor a known no-bake gesture`,
      ).toBe(true);
    }
    // Every school-differentiated damage/heal spell gets its own bespoke
    // clip; the instant shocks share one gesture (VFX carries the school),
    // and the weapon imbues/short self buffs stay on existing gestures
    // (no swing to author).
    const map = Object.fromEntries(rows.map(([, id, clip]) => [id, clip]));
    expect(map.lightning_bolt).toBe('Cast_Bolt');
    expect(map.earth_shock).toBe('Cast_Shock');
    expect(map.flame_shock).toBe('Cast_Shock');
    expect(map.frost_shock).toBe('Cast_Shock');
    expect(map.healing_wave).toBe('Cast_Heal');
    expect(map.chain_heal).toBe('Cast_Heal');
    expect(map.earthquake).toBe('Cast_Quake');
    expect(map.stormstrike).toBe('Storm_Strike');
    expect(map.rockbiter_weapon).toBe('Spellcast_Raise');
    expect(map.flametongue_weapon).toBe('Spellcast_Raise');
    expect(map.frostbrand_weapon).toBe('Spellcast_Raise');
    expect(map.ghost_wolf).toBe('Spellcast_Raise');
    expect(map.elemental_mastery).toBe('Spellcast_Raise');
    expect(map.lightning_shield).toBe('Block');
  });
});

describe('mob_demon_flying bespoke attack (issue #2889)', () => {
  it('ships DemonFlying_Attack in a mesh-free donor GLB', () => {
    const glbPath = 'public/models/creatures/demon_flying_anims.glb';
    expect(clipNamesOf(glbPath)).toEqual(['DemonFlying_Attack']);
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it('covers every donor channel, not just the No/Yes gesture subset (review #2961)', () => {
    // The initial timeline row must fall back to the merged P_all pose, not a
    // single donor pose: a channel only Punch (23 channels) contributes gets
    // dropped by bakeClip before the later ramps if the seed row's fallback
    // is missing it, even though those ramps do supply P_all. Regression for
    // that exact bug: the clip shipped with only 14 channels (No/Yes
    // coverage) instead of the full 24-channel donor union.
    const glbPath = 'public/models/creatures/demon_flying_anims.glb';
    expect(channelCountOf(glbPath, 'DemonFlying_Attack')).toBe(24);
  });

  it('gives mob_demon_flying its own ClipMap instead of mutating the shared FLOATING constant', () => {
    const demonBlock = manifestBlock('mob_demon_flying: {', 'mob_alpaca: {');
    expect(demonBlock).toContain('demon_flying_anims.glb');
    expect(demonBlock).toContain('clips: DEMON_FLYING_FLOATING');
    expect(demonBlock).not.toContain('clips: FLOATING,');

    // FLOATING itself (the constant definition, not a VisualDef using it) must
    // still read the original shared attack: every other family sharing it by
    // reference must be untouched by this change.
    const floatingConstBlock = manifestBlock('const FLOATING: ClipMap = {', '};');
    expect(floatingConstBlock).toContain("attack: ['Headbutt', 'Punch']");

    // Every other VisualDef still pointing at the shared constant is
    // untouched: exactly 4 remaining direct `clips: FLOATING,` usages (9
    // originally across the whole multi-batch initiative, minus the
    // elemental's ELEMENTAL_FLOATING migration, the ghost's GHOST_FLOATING
    // migration, the nightkin's NIGHTKIN_FLOATING migration, the glub's
    // GLUB_FLOATING migration, and the flying demon's own
    // DEMON_FLYING_FLOATING migration here).
    const remaining = [...MANIFEST_SRC.matchAll(/clips: FLOATING,/g)].length;
    expect(remaining).toBe(4);
  });
});
