// Warrior movement and native ability dispatch, plus the kobold family's own
// attack clip off the ENEMY7-sharing goblin.glb. Heroic Leap and Rush share
// the movement library; Gyre and Storm Bolt have native attack overrides.
// Shouts support authored gestures and retain an emote fallback when unmapped.
// Authored by pose-sample-and-blend (scripts/anim/pose_blend.mjs,
// scripts/build_warrior_ability_anims.mjs, scripts/build_kobold_anims.mjs),
// the same technique documented in
// .claude/skills/blender-anim-pipeline/SKILL.md. Follows the shipped-GLB-
// plus-manifest-source contract test pattern (tests/anim_pipeline_batch1.test.ts).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AbilityVfxDeps } from '../src/render/ability_vfx/painter';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
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

describe('warrior bespoke movement clip (issue #2889 warrior/kobold batch)', () => {
  const WARRIOR_NEW_CLIPS = ['Warrior_Heroic_Leap', 'Warrior_Rush_Loop', 'Warrior_Onrush_Arrival'];

  it('ships the new clip in a mesh-free donor GLB', () => {
    const glbPath = 'public/models/chars/players/warrior_ability_anims.glb';
    expect(clipNamesOf(glbPath)).toEqual(WARRIOR_NEW_CLIPS);
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it('keeps every attackByAbility entry on the WOC body, with the Rig_Medium donor unwired', () => {
    // The warrior moved onto the WOC modular rig (the split files: the male base
    // and its own animation library) and plays only that rig's own clips: a
    // KayKit clip binds by bone NAME onto these bones (the names match) but
    // against the wrong bind pose, so the pose-blend donor bake above stays
    // shipped and deliberately unwired.
    const block = manifestBlock('player_warrior: {', 'player_paladin: {');
    expect(block).not.toContain('warrior_ability_anims.glb');
    expect(block).toContain(
      'animUrls: [`${PLAYERS}/woc/anims_male.glb`, `${PLAYERS}/woc_keyed/woc_male.glb`]',
    );
    expect(block).toContain('attackByAbility');
    // Every entry from the earlier PRs and from this batch survives the body swap.
    const preExisting = [
      'mortal_strike',
      'execute',
      'slam',
      'red_harvest',
      'breachmaker',
      'shield_slam',
      'raging_gale',
      'bloodthirst',
      'cleave',
      'revenge',
      'thunder_clap',
      'faultline',
      'heroic_strike',
      'overpower',
      'hamstring',
      'pummel',
      'heroic_leap',
      'victory_rush',
    ];
    for (const id of preExisting) expect(block).toContain(`${id}:`);
  });

  it('every mapped ability id is a real warrior ability, and every referenced clip ships in the WOC GLB', () => {
    const warriorBlock = manifestBlock('player_warrior: {', 'player_paladin: {');
    const abilityStart = warriorBlock.indexOf('attackByAbility: {');
    expect(abilityStart).toBeGreaterThanOrEqual(0);
    const abilityEnd = warriorBlock.indexOf('\n      },', abilityStart);
    expect(abilityEnd).toBeGreaterThan(abilityStart);
    const block = warriorBlock.slice(abilityStart, abilityEnd);
    const rows = [...block.matchAll(/^\s*([a-z_]+): '([A-Za-z_0-9]+)',$/gm)];
    expect(rows.length).toBeGreaterThanOrEqual(18); // the strikes; the instant casts carry no entry
    const wocClips = new Set(clipNamesOf('public/models/chars/players/woc/anims_male.glb'));
    // the 2026-09-24 set (one-hand and single-weapon clips; its two-hand *_2H set left
    // 2026-09-30) plus the 2026-09-28 dual-wield set
    expect(wocClips.size).toBe(51);
    const map: Record<string, string> = {};
    for (const [, abilityId, clip] of rows) {
      map[abilityId] = clip;
      expect(
        ABILITIES[abilityId],
        `attackByAbility key '${abilityId}' is not a real ability id`,
      ).toBeTruthy();
      expect(
        wocClips,
        `attackByAbility value '${clip}' for '${abilityId}' is not a clip the WOC GLB ships`,
      ).toContain(clip);
    }
    // This batch's additions, re-homed on the WOC vocabulary: every one still
    // reaches playAttack the same way (the build script's header trace).
    expect(map.heroic_leap).toBe('2H_Chop');
    expect(map.victory_rush).toBe('1H_Slash');
    // Instant casts play NO gesture on the WOC body (owner call, 2026-09-16):
    // the buff and aura ids deliberately have no entry, so the painter draws
    // nothing and the generic cast arm stays silent (playAttack gestureOnly).
    for (const silent of [
      'berserker_rage',
      'recklessness',
      'die_by_sword',
      'avatar',
      'piercing_howl',
      'sanguine_aura',
      'raised_guard',
    ]) {
      expect(map[silent], `${silent} must stay silent`).toBeUndefined();
    }
    // The dead-code traps this batch deliberately avoided: none of these got
    // an entry, because no attackByAbility lookup for them is ever reached.
    for (const deadId of [
      'whirlwind',
      'bladestorm',
      'storm_bolt',
      'battle_shout',
      'demoralizing_shout',
      'emboldening_roar',
      'defiant_bellow',
      'rallying_cry',
      'intimidating_shout',
    ]) {
      expect(map[deadId], `${deadId} must stay unmapped (never reaches attackByAbility)`).toBe(
        undefined,
      );
    }
  });
});

describe('heroic_leap and piercing_howl reach triggerAttack through the real selfCast gate', () => {
  // Regression for the CHANGES_REQUESTED review on PR #2964: both ids are
  // untargeted (targetId === sourceId), full-spec archetypes 'dash' and
  // 'shout' respectively, with no castFx of their own. Before this fix, the
  // selfCast gate in handleSpellfx only claimed ceremonial archetypes
  // (buff/summon/cc/heal/spirit) or TARGETED strike/cc/burst/shout utility,
  // so both fell through unclaimed and triggerAttack was never called, i.e.
  // no attackByAbility gesture ever played (heroic_leap's leap, piercing_howl's
  // Spellcast_Raise).
  function makePainter(hasGestureClip = true) {
    const triggerAttack = vi.fn();
    const playShoutAnim = vi.fn();
    const bakedAt = vi.fn();
    const fragmentsAt = vi.fn();
    const deps = {
      vfx: {
        shoutwave: vi.fn(),
        nova: vi.fn(),
        tick: vi.fn(),
        projectile: vi.fn(),
        lightningProjectile: vi.fn(),
        burst: vi.fn(),
        buffSwirl: vi.fn(),
        beam: vi.fn(),
      },
      fx: {
        anchorOf: () => ({ x: 0, y: 0, z: 0 }),
        groundYAt: () => 0,
        bakedAt,
        fragmentsAt,
        setDelegates: vi.fn(),
        warmSpiritsForClass: vi.fn(),
        windup: vi.fn().mockReturnValue(false),
        holdShell: vi.fn(),
        holdGroundAura: vi.fn().mockReturnValue(true),
        orbit: vi.fn().mockReturnValue(true),
        bodyGlow: vi.fn(),
        sleepEntity: vi.fn(),
        update: vi.fn(),
        sequenceInstant: vi.fn(),
      },
      anchor: () => ({ x: 0, y: 0, z: 0 }),
      spawnAoeRing: vi.fn(),
      triggerAttack,
      playShoutAnim,
      hasGestureClip: () => hasGestureClip,
    } as unknown as AbilityVfxDeps;
    const painter = new AbilityVfx(deps, () => 0);
    return { painter, triggerAttack, playShoutAnim, bakedAt, fragmentsAt };
  }

  it('claims heroic_leap selfCast and triggers its attack clip', () => {
    const { painter, triggerAttack, bakedAt, fragmentsAt } = makePainter();

    const claimed = painter.handleSpellfx({
      type: 'spellfx',
      sourceId: 1,
      targetId: 1,
      school: 'physical',
      fx: 'selfCast',
      ability: 'heroic_leap',
    } as never);

    expect(claimed).toBe(true);
    expect(triggerAttack).toHaveBeenCalledWith(1, 'heroic_leap');
    expect(bakedAt).toHaveBeenCalledTimes(2);
    expect(fragmentsAt).toHaveBeenCalledTimes(2);
  });

  it('dispatches Storm Bolt windup to its mapped native attack', () => {
    const { painter, triggerAttack } = makePainter();
    expect(
      painter.handleSpellfx({
        type: 'spellfx',
        sourceId: 1,
        targetId: 2,
        school: 'physical',
        fx: 'windup',
        ability: 'storm_bolt',
      } as never),
    ).toBe(true);
    expect(triggerAttack).toHaveBeenCalledExactlyOnceWith(1, 'storm_bolt');
  });

  it.each([
    'battle_shout',
    'demoralizing_shout',
    'emboldening_roar',
    'defiant_bellow',
    'rallying_cry',
    'intimidating_shout',
  ])('dispatches %s to its gesture or emote, never both', (ability) => {
    expect(ABILITIES[ability].castFx).toBe('shout');
    for (const hasGesture of [false, true]) {
      const { painter, triggerAttack, playShoutAnim } = makePainter(hasGesture);
      expect(
        painter.handleSpellfx({
          type: 'spellfx',
          sourceId: 1,
          targetId: 1,
          school: 'physical',
          fx: 'shout',
          ability,
        } as never),
      ).toBe(true);
      if (hasGesture) {
        expect(triggerAttack).toHaveBeenCalledExactlyOnceWith(1, ability);
        expect(playShoutAnim).not.toHaveBeenCalled();
      } else {
        expect(playShoutAnim).toHaveBeenCalledExactlyOnceWith(1);
        expect(triggerAttack).not.toHaveBeenCalled();
      }
    }
  });

  it('plays one native Intimidating Shout gesture across both authoritative cast phases', () => {
    for (const phases of [
      ['shout', 'nova'],
      ['nova', 'shout'],
    ]) {
      const { painter, triggerAttack, playShoutAnim } = makePainter();
      for (const fx of phases)
        expect(
          painter.handleSpellfx({
            type: 'spellfx',
            sourceId: 1,
            targetId: 1,
            school: 'physical',
            fx,
            ability: 'intimidating_shout',
          } as never),
        ).toBe(true);
      expect(triggerAttack).toHaveBeenCalledExactlyOnceWith(1, 'intimidating_shout');
      expect(playShoutAnim).not.toHaveBeenCalled();
    }
  });

  it('claims piercing_howl selfCast and triggers its attack clip', () => {
    const { painter, triggerAttack } = makePainter();

    const claimed = painter.handleSpellfx({
      type: 'spellfx',
      sourceId: 3,
      targetId: 3,
      school: 'physical',
      fx: 'selfCast',
      ability: 'piercing_howl',
    } as never);

    expect(claimed).toBe(true);
    expect(triggerAttack).toHaveBeenCalledWith(3, 'piercing_howl');
  });
});

describe('kobold family bespoke attack (issue #2889 warrior/kobold batch)', () => {
  it('ships Kobold_Pounce in a mesh-free donor GLB', () => {
    const glbPath = 'public/models/creatures/kobold_ability_anims.glb';
    expect(clipNamesOf(glbPath)).toEqual(['Kobold_Pounce']);
    expect(meshCountOf(glbPath)).toBe(0);
  });

  it('gives mob_kobold its own ClipMap instead of mutating the shared ENEMY7 constant', () => {
    const kobold = manifestBlock('mob_kobold: {', 'mob_grubjaw: {');
    expect(kobold).toContain('kobold_ability_anims.glb');
    expect(kobold).toContain('clips: KOBOLD_ENEMY7');
    expect(kobold).not.toContain('clips: ENEMY7,');

    // ENEMY7 itself (the constant definition, not a VisualDef using it) must
    // still read the original shared attack: its remaining consumers
    // (mob_goblin, mob_kobold_digger) share the SAME constant by reference
    // and must be untouched by this change. mob_ogre, once the motivating
    // shared-by-reference case, now rides its own authored body and OGRE
    // ClipMap (ogre.glb), so the pin on it moved from ENEMY7 to OGRE.
    const enemy7ConstBlock = manifestBlock('const ENEMY7: ClipMap = {', '};');
    expect(enemy7ConstBlock).toContain("attack: ['Attack']");

    const ogreBlock = manifestBlock('mob_ogre: {', '};');
    expect(ogreBlock).toContain('clips: OGRE,');
  });
});
