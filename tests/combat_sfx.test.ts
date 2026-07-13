import { describe, expect, it } from 'vitest';
import { SFX_CLIPS } from '../src/game/sfx_manifest.generated';
import type { Aura, Entity, SimEvent } from '../src/sim/types';
import {
  auraApplyCue,
  castCueForAbility,
  impactCueForDamage,
  mobVoiceCue,
  mobVoiceFamily,
  playerSwingCueForDamage,
  shouldPlayCombatImpactForTarget,
  shouldPlayCritSfxForTarget,
  shouldPlayMobVoiceSfxForEntity,
  spellFxCue,
  weaponSwingCue,
} from '../src/ui/combat_sfx';

type DamageEvent = Extract<SimEvent, { type: 'damage' }>;

function target(kind: Entity['kind'], templateId: string): Entity {
  return {
    id: 1,
    kind,
    templateId,
    name: 'Target',
    level: 20,
    pos: { x: 0, y: 0, z: 0 },
    prevPos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    facing: 0,
    prevFacing: 0,
    hp: 100,
    maxHp: 100,
    resource: 0,
    maxResource: 0,
    resourceType: null,
    stats: { str: 0, agi: 0, sta: 0, int: 0, spi: 0, armor: 0 },
    weapon: { min: 1, max: 2, speed: 2 },
    auras: [],
    targetId: null,
    castRemaining: 0,
    castTotal: 0,
    castingAbility: null,
    channeling: false,
    dead: false,
    inCombat: false,
    swingTimer: 0,
    moveSpeed: 7,
    radius: 0.35,
    height: 1.8,
    scale: 1,
    color: 0xffffff,
    ownerId: null,
    petMode: 'defensive',
    petTargetId: null,
    petAttackTargetId: null,
    petReturnTarget: null,
    petNextActionAt: 0,
    hostile: kind === 'mob',
    aggroRadius: 0,
    aiState: 'idle',
    aggroTargetId: null,
    spawnPos: { x: 0, y: 0, z: 0 },
    leashOrigin: { x: 0, y: 0, z: 0 },
    threat: new Map(),
    tappedById: null,
    lootable: false,
    loot: null,
    questIds: [],
    patrol: null,
    patrolIndex: 0,
    fleeing: false,
    fleeTimer: 0,
    fleeReturnTimer: 0,
    fledOnce: false,
    summonedIds: [],
    summonedById: null,
    interactable: false,
    objectItemId: null,
    dungeonId: null,
    dungeonSlot: null,
    overheadEmoteId: null,
    overheadEmoteSeq: 0,
    overheadEmoteUntil: 0,
  } as unknown as Entity;
}

function damage(overrides: Partial<DamageEvent> = {}): DamageEvent {
  return {
    type: 'damage',
    sourceId: 1,
    targetId: 2,
    amount: 10,
    crit: false,
    school: 'physical',
    ability: null,
    kind: 'hit',
    ...overrides,
  };
}

function aura(kind: Aura['kind'], value = 1): Aura {
  return {
    id: 'test',
    name: 'Test Aura',
    kind,
    remaining: 10,
    duration: 10,
    value,
    sourceId: 1,
    school: 'physical',
  };
}

describe('combat SFX policy', () => {
  it('suppresses crit stingers for boss targets only', () => {
    expect(shouldPlayCritSfxForTarget(target('mob', 'nythraxis_scourge_of_thornpeak'))).toBe(false);
    expect(shouldPlayCritSfxForTarget(target('mob', 'nythraxis_skeleton_warrior'))).toBe(true);
    expect(shouldPlayCritSfxForTarget(target('player', 'warrior'))).toBe(true);
  });

  it('suppresses Nythraxis add voice barks without muting ordinary undead', () => {
    expect(shouldPlayMobVoiceSfxForEntity(target('mob', 'nythraxis_skeleton_warrior'))).toBe(false);
    expect(shouldPlayMobVoiceSfxForEntity(target('mob', 'crypt_shambler'))).toBe(true);
    expect(shouldPlayMobVoiceSfxForEntity(target('player', 'warrior'))).toBe(false);
  });

  it('mutes all non-dialogue Nythraxis boss combat sounds', () => {
    expect(shouldPlayMobVoiceSfxForEntity(target('mob', 'nythraxis_scourge_of_thornpeak'))).toBe(
      false,
    );
    expect(shouldPlayCombatImpactForTarget(target('mob', 'nythraxis_scourge_of_thornpeak'))).toBe(
      false,
    );
    expect(shouldPlayCombatImpactForTarget(target('mob', 'crypt_shambler'))).toBe(true);
    expect(shouldPlayCombatImpactForTarget(target('player', 'warrior'))).toBe(true);
  });

  it('maps physical and six magic projectile cues without synthesizing unknown keys', () => {
    expect(
      spellFxCue({
        type: 'spellfx',
        sourceId: 10,
        targetId: 20,
        school: 'physical',
        fx: 'projectile',
      }),
    ).toEqual({ key: 'melee_bow', anchorId: 10 });
    for (const school of ['fire', 'frost', 'arcane', 'shadow', 'holy', 'nature']) {
      const cue = spellFxCue({
        type: 'spellfx',
        sourceId: 10,
        targetId: 20,
        school,
        fx: 'projectile',
      });
      expect(cue?.key, school).toBe(`proj_${school}`);
      expect(cue !== null && cue.key in SFX_CLIPS, school).toBe(true);
    }
    expect(
      spellFxCue({
        type: 'spellfx',
        sourceId: 10,
        targetId: 20,
        school: 'chaos',
        fx: 'projectile',
      }),
    ).toBeNull();
  });

  it('anchors projectiles to the source and novas to the visual target', () => {
    expect(
      spellFxCue({
        type: 'spellfx',
        sourceId: 10,
        targetId: 20,
        school: 'fire',
        fx: 'projectile',
      })?.anchorId,
    ).toBe(10);
    expect(
      spellFxCue({
        type: 'spellfx',
        sourceId: 10,
        targetId: 20,
        school: 'fire',
        fx: 'nova',
      }),
    ).toEqual({ key: 'spell_nova', anchorId: 20 });
  });

  it('uses explicit cast and impact school maps', () => {
    expect(castCueForAbility('fireball')).toBe('cast_fire');
    expect(castCueForAbility('lightning_bolt')).toBe('cast_lightning_bolt');
    expect(castCueForAbility('attack')).toBeNull();
    expect(impactCueForDamage(damage({ school: 'shadow' }), target('mob', 'crypt_shambler'))).toBe(
      'impact_shadow',
    );
    expect(
      impactCueForDamage(damage({ school: 'chaos' }), target('mob', 'crypt_shambler')),
    ).toBeNull();
  });

  it('preserves v0.25 mob families and loaded subfamily overrides', () => {
    expect(mobVoiceFamily('mudfin_murloc')).toBe('mudfin');
    expect(mobVoiceCue('mudfin_murloc', 'aggro')).toBe('mob_mudfin_aggro');
    expect(mobVoiceFamily('tunnel_rat')).toBe('burrower');
    expect(mobVoiceCue('tunnel_rat', 'death')).toBe('mob_burrower_death');

    const specific = 'mob_beast_forest_wolf_attack';
    expect(mobVoiceCue('forest_wolf', 'attack', (key) => key === specific)).toBe(specific);
    expect(mobVoiceCue('forest_wolf', 'attack', () => false)).toBe('mob_beast_attack');
  });

  it('classifies gained aura polarity and stays silent on removal or missing state', () => {
    const gained = { type: 'aura', targetId: 1, name: 'Test Aura', gained: true } as const;
    expect(auraApplyCue(gained, aura('buff_ap'))).toBe('buff_apply');
    expect(auraApplyCue(gained, aura('dot'))).toBe('debuff_apply');
    expect(auraApplyCue(gained, aura('buff_ap', -5))).toBe('debuff_apply');
    expect(auraApplyCue({ ...gained, gained: false }, aura('dot'))).toBeNull();
    expect(auraApplyCue(gained, null)).toBeNull();
  });

  it('uses unarmed swings in both druid combat forms', () => {
    const druid = target('player', 'druid');
    expect(weaponSwingCue(druid)).toBe('melee_swing_heavy');
    druid.auras = [aura('form_bear')];
    expect(weaponSwingCue(druid)).toBe('melee_unarmed');
    druid.auras = [aura('form_cat')];
    expect(weaponSwingCue(druid)).toBe('melee_unarmed');
  });

  it('plays attempted physical swings for avoidance but not magic or Auto Shot impact', () => {
    const warrior = target('player', 'warrior');
    expect(playerSwingCueForDamage(damage({ kind: 'miss' }), warrior)).toBe('melee_swing_blade');
    expect(playerSwingCueForDamage(damage({ kind: 'dodge' }), warrior)).toBe('melee_swing_blade');
    expect(playerSwingCueForDamage(damage({ kind: 'parry' }), warrior)).toBe('melee_swing_blade');
    expect(playerSwingCueForDamage(damage({ school: 'fire' }), warrior)).toBeNull();
    expect(playerSwingCueForDamage(damage({ ability: 'Auto Shot' }), warrior)).toBeNull();
  });
});
