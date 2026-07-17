import { describe, expect, it } from 'vitest';
import { SFX_CLIPS, SFX_MOB_EXTENSION_FAMILIES } from '../src/game/sfx_manifest.generated';
import type { Aura, Entity, SimEvent } from '../src/sim/types';
import {
  auraApplyCue,
  castCueForAbility,
  impactCueForDamage,
  MOB_VOICE_CUES,
  mobVoiceActionForDamage,
  mobVoiceCue,
  mobVoiceCueWithFallback,
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

  it('gives a wand auto-attack projectile its own cue, distinct from the real spell cast', () => {
    for (const school of ['arcane', 'holy', 'shadow']) {
      const wandCue = spellFxCue({
        type: 'spellfx',
        sourceId: 10,
        targetId: 20,
        school,
        fx: 'projectile',
        wand: true,
      });
      expect(wandCue?.key, school).toBe(`wand_${school}`);
      expect(wandCue !== null && wandCue.key in SFX_CLIPS, school).toBe(true);
      const castCue = spellFxCue({
        type: 'spellfx',
        sourceId: 10,
        targetId: 20,
        school,
        fx: 'projectile',
      });
      expect(castCue?.key, school).toBe(`proj_${school}`);
      expect(wandCue?.key, school).not.toBe(castCue?.key);
    }
  });

  it('falls back to the real spell cue for a wand projectile of a school with no dedicated cue', () => {
    // No wand-equipped class currently casts fire/frost/nature, but the fallback
    // must still hold if that ever changes: a wand flag alone should never
    // resolve to null.
    expect(
      spellFxCue({
        type: 'spellfx',
        sourceId: 10,
        targetId: 20,
        school: 'fire',
        fx: 'projectile',
        wand: true,
      }),
    ).toEqual({ key: 'proj_fire', anchorId: 10 });
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

    // bog_bloat has no subfamily alias, so it still keys off its own raw
    // templateId (unlike the wolf-shaped beasts covered below).
    const specific = 'mob_beast_bog_bloat_attack';
    expect(mobVoiceCue('bog_bloat', 'attack', (key) => key === specific)).toBe(specific);
    expect(mobVoiceCue('bog_bloat', 'attack', () => false)).toBe('mob_beast_attack');
  });

  it('shares one recorded wolf subfamily voice across every wolf-shaped beast', () => {
    const wolfCue = 'mob_beast_wolf_attack';
    const hasWolfCue = (key: string) => key === wolfCue;
    for (const wolfLike of ['forest_wolf', 'ridge_stalker', 'mire_prowler', 'old_greyjaw']) {
      expect(mobVoiceCue(wolfLike, 'attack', hasWolfCue), wolfLike).toBe(wolfCue);
    }
    // A non-aliased templateId is unaffected: it keys off its own id, not 'wolf'.
    expect(mobVoiceCue('crypt_shambler', 'attack', hasWolfCue)).toBe('mob_undead_attack');
    // With no recorded wolf take at all, every aliased template falls back to
    // the plain family-level sound, same as an unaliased one would.
    for (const wolfLike of ['forest_wolf', 'ridge_stalker', 'mire_prowler', 'old_greyjaw']) {
      expect(
        mobVoiceCue(wolfLike, 'attack', () => false),
        wolfLike,
      ).toBe('mob_beast_attack');
    }
  });

  it('resolves the reptile family for its first real mob', () => {
    expect(mobVoiceFamily('deepfen_spearjaw')).toBe('reptile');
    expect(mobVoiceCue('deepfen_spearjaw', 'aggro')).toBe('mob_reptile_aggro');
    expect(mobVoiceCue('deepfen_spearjaw', 'attack')).toBe('mob_reptile_attack');
    expect(mobVoiceCue('deepfen_spearjaw', 'death')).toBe('mob_reptile_death');
    expect(mobVoiceCue('deepfen_spearjaw', 'hurt')).toBe('mob_reptile_hurt');
  });

  // Table-driven over every one of the 13 real mob families (not a sample),
  // so a cue mapped to the wrong family's key (still a valid SfxId, so tsc
  // and a spot check would both miss it) fails here.
  it('resolves a real, correctly-mapped hurt cue for every mob family', () => {
    const familyByTemplateId: Record<string, string> = {
      forest_wolf: 'beast',
      wild_boar: 'boar',
      mire_widow: 'spider',
      mudfin_murloc: 'mudfin',
      tunnel_rat: 'burrower',
      mogger: 'humanoid',
      crypt_shambler: 'undead',
      fen_troll: 'troll',
      korgath_the_bound: 'ogre',
      stormcrag_elemental: 'elemental',
      sanctum_drakonid: 'dragonkin',
      emberkin: 'demon',
      deepfen_spearjaw: 'reptile',
    };
    expect(Object.keys(familyByTemplateId)).toHaveLength(13);
    for (const [templateId, family] of Object.entries(familyByTemplateId)) {
      expect(mobVoiceFamily(templateId), templateId).toBe(family);
      const expected = `mob_${family}_hurt`;
      expect(mobVoiceCue(templateId, 'hurt'), templateId).toBe(expected);
      expect(expected in SFX_CLIPS, expected).toBe(true);
    }
  });

  it('stages a real, buffered idle clip for every family in MOB_VOICE_CUES', () => {
    // Iterates the live catalog (not a hardcoded template-id table) so a
    // future 14th family is automatically covered; the `satisfies` clause on
    // MOB_VOICE_CUES only forces a cue STRING at compile time, not that a
    // clip is actually staged, which is what this asserts at runtime.
    const families = Object.entries(MOB_VOICE_CUES);
    expect(families).toHaveLength(13);
    for (const [family, cues] of families) {
      expect(cues.idle, family).toBe(`mob_${family}_idle`);
      expect(cues.idle in SFX_CLIPS, cues.idle).toBe(true);
    }
  });

  it('keeps MOB_VOICE_CUES in lockstep with the real family list', () => {
    // A family added to one and forgotten in the other resolves at runtime
    // to a key with no clip: no error, it just plays nothing.
    expect(Object.keys(MOB_VOICE_CUES).sort()).toEqual([...SFX_MOB_EXTENSION_FAMILIES].sort());
  });

  it('requests a hurt reaction only for a crit against a non-boss mob', () => {
    const mob = target('mob', 'crypt_shambler');
    const boss = target('mob', 'nythraxis_scourge_of_thornpeak');
    const player = target('player', 'warrior');
    expect(mobVoiceActionForDamage(damage({ crit: true }), mob)).toBe('hurt');
    expect(mobVoiceActionForDamage(damage({ crit: false }), mob)).toBeNull();
    expect(mobVoiceActionForDamage(damage({ crit: true }), boss)).toBeNull();
    expect(mobVoiceActionForDamage(damage({ crit: true }), player)).toBeNull();
  });

  it('falls back to the attack cue only when the resolved cue is not yet buffered', () => {
    const hasCue = () => false;
    const warm = () => true;
    const cold = () => false;
    // warm arm: the resolved hurt cue is already buffered, use it as is.
    expect(mobVoiceCueWithFallback('crypt_shambler', 'hurt', hasCue, warm)).toBe('mob_undead_hurt');
    // cold arm: the resolved hurt cue is not buffered yet, fall back to attack.
    expect(mobVoiceCueWithFallback('crypt_shambler', 'hurt', hasCue, cold)).toBe(
      'mob_undead_attack',
    );
    // no-cue arm: an unmapped templateId resolves neither cue nor a fallback.
    expect(mobVoiceCueWithFallback('not_a_real_mob', 'hurt', hasCue, warm)).toBeNull();
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
