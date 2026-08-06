import { describe, expect, it } from 'vitest';
import { SFX_CLIPS, SFX_MOB_EXTENSION_FAMILIES } from '../src/game/sfx_manifest.generated';
import type { Aura, Entity, SimEvent } from '../src/sim/types';
import {
  auraApplyCue,
  castCueForAbility,
  consumeHealCue,
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

type HealEvent = Extract<SimEvent, { type: 'heal' }>;

function heal(overrides: Partial<HealEvent> = {}): HealEvent {
  return { type: 'heal', targetId: 1, amount: 0, ...overrides };
}

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
  it('routes the Water Elemental away from the generic elemental growls', () => {
    expect(mobVoiceFamily('water_elemental')).toBe('water_elemental');
    expect(mobVoiceCue('water_elemental', 'aggro')).toBe('mob_water_elemental_aggro');
    expect(mobVoiceCue('water_elemental', 'attack')).toBe('mob_water_elemental_attack');
    expect(mobVoiceCue('water_elemental', 'death')).toBe('mob_water_elemental_death');
    // Owned summon: no idle bark exists, the sweep must get null.
    expect(mobVoiceCue('water_elemental', 'idle')).toBeNull();
    expect(mobVoiceCue('water_elemental', 'hurt')).toBe('mob_water_elemental_attack');
    expect(mobVoiceFamily('stormcrag_elemental')).toBe('elemental');
  });
  it('suppresses the crit ding for a boss but not the Training Dummy', () => {
    expect(shouldPlayCritSfxForTarget(target('mob', 'nythraxis_scourge_of_thornpeak'))).toBe(false);
    expect(shouldPlayCritSfxForTarget(target('mob', 'nythraxis_skeleton_warrior'))).toBe(true);
    expect(shouldPlayCritSfxForTarget(target('player', 'warrior'))).toBe(true);
    // 2026-07-19 follow-up to #2116: the dummy still gets the plain crit
    // ding (only the hurt-bark vocalization is suppressed for it, see
    // mobVoiceActionForDamage below).
    expect(shouldPlayCritSfxForTarget(target('mob', 'training_dummy'))).toBe(true);
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

  it('gives the three AoE fear shouts their own nova cue instead of the shared spell_nova', () => {
    for (const ability of ['psychic_scream', 'howl_of_terror', 'intimidating_shout']) {
      expect(
        spellFxCue({
          type: 'spellfx',
          sourceId: 10,
          targetId: 10,
          school: 'shadow',
          fx: 'nova',
          ability,
        }),
      ).toEqual({ key: 'fear_shout', anchorId: 10 });
    }
    // Every other nova ability keeps the shared cue.
    expect(
      spellFxCue({
        type: 'spellfx',
        sourceId: 10,
        targetId: 10,
        school: 'arcane',
        fx: 'nova',
        ability: 'arcane_explosion',
      }),
    ).toEqual({ key: 'spell_nova', anchorId: 10 });
  });

  it('gives Frost Nova its own cast cue instead of the shared spell_nova', () => {
    expect(
      spellFxCue({
        type: 'spellfx',
        sourceId: 10,
        targetId: 10,
        school: 'frost',
        fx: 'nova',
        ability: 'frost_nova',
      }),
    ).toEqual({ key: 'frost_nova', anchorId: 10 });
  });

  it('anchors the landed-fear moment to the feared target', () => {
    expect(
      spellFxCue({
        type: 'spellfx',
        sourceId: 10,
        targetId: 20,
        school: 'shadow',
        fx: 'fearImpact',
        ability: 'fear',
      }),
    ).toEqual({ key: 'fear', anchorId: 20 });
  });

  it('anchors the landed cc moment to the target for the covered set, and stays silent otherwise', () => {
    for (const ability of ['hammer_of_justice', 'entangling_roots', 'blind', 'cheap_shot', 'sap']) {
      expect(
        spellFxCue({
          type: 'spellfx',
          sourceId: 10,
          targetId: 20,
          school: 'physical',
          fx: 'ccImpact',
          ability,
        }),
      ).toEqual({ key: ability, anchorId: 20 });
    }
    // No ability id, or an ability not in the covered set: no cue at all
    // (the sim only ever emits ccImpact for this set, but the client
    // resolver stays defensive regardless).
    expect(
      spellFxCue({
        type: 'spellfx',
        sourceId: 10,
        targetId: 20,
        school: 'physical',
        fx: 'ccImpact',
        ability: 'polymorph',
      }),
    ).toBeNull();
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

  it('gives Flamestrike its own cast cue instead of the shared spell_nova', () => {
    expect(
      spellFxCue({
        type: 'spellfx',
        sourceId: 10,
        targetId: 10,
        school: 'fire',
        fx: 'nova',
        ability: 'flamestrike',
      }),
    ).toEqual({ key: 'flamestrike', anchorId: 10 });
  });

  it('gives Scorch and Pyroblast their own impact instead of the shared impact_fire', () => {
    for (const [abilityId, key] of [
      ['scorch', 'scorch'],
      ['pyroblast', 'pyroblast'],
    ] as const) {
      expect(
        impactCueForDamage(
          damage({ school: 'fire', ability: 'display label', abilityId }),
          target('mob', 'crypt_shambler'),
        ),
      ).toBe(key);
    }
    // Every other fire spell (Fireball, etc.) keeps the shared impact_fire.
    expect(
      impactCueForDamage(
        damage({ school: 'fire', ability: 'Fireball', abilityId: 'fireball' }),
        target('mob', 'crypt_shambler'),
      ),
    ).toBe('impact_fire');
  });

  it('resolves the impact override off the stable abilityId, never the display-label ability field (#2861)', () => {
    // Scorch's real display label is "Scald", not "scorch": a lookup keyed
    // off the label instead of abilityId would silently never match.
    expect(
      impactCueForDamage(
        damage({ school: 'fire', ability: 'Scald', abilityId: 'scorch' }),
        target('mob', 'crypt_shambler'),
      ),
    ).toBe('scorch');
    // An event with the id as its label but no abilityId (a caller that
    // never threads one through) must NOT match by coincidence.
    expect(
      impactCueForDamage(
        damage({ school: 'fire', ability: 'scorch', abilityId: undefined }),
        target('mob', 'crypt_shambler'),
      ),
    ).toBe('impact_fire');
  });

  it('gives Frozen Orb and Glacial Spike their own impact instead of the shared impact_frost', () => {
    for (const [abilityId, key] of [
      ['frozen_orb', 'frozen_orb'],
      ['glacial_spike', 'glacial_spike'],
    ] as const) {
      expect(
        impactCueForDamage(
          damage({ school: 'frost', ability: 'display label', abilityId }),
          target('mob', 'crypt_shambler'),
        ),
      ).toBe(key);
    }
    // Every other frost spell (Ice Lance, etc.) keeps the shared impact_frost.
    expect(
      impactCueForDamage(
        damage({ school: 'frost', ability: 'Ice Lance', abilityId: 'ice_lance' }),
        target('mob', 'crypt_shambler'),
      ),
    ).toBe('impact_frost');
  });

  it('gives Aether Surge (arcane_surge) the arcane_blast cue instead of the shared impact_arcane', () => {
    expect(
      impactCueForDamage(
        damage({ school: 'arcane', ability: 'Aether Surge', abilityId: 'arcane_surge' }),
        target('mob', 'crypt_shambler'),
      ),
    ).toBe('arcane_blast');
    // Every other arcane spell keeps the shared impact_arcane.
    expect(
      impactCueForDamage(
        damage({ school: 'arcane', ability: 'Arcane Missiles', abilityId: 'arcane_missiles' }),
        target('mob', 'crypt_shambler'),
      ),
    ).toBe('impact_arcane');
  });

  it('gives Ambush, Backstab, Garrote, Sinister Strike, and Eviscerate their own impact instead of the shared material impact', () => {
    for (const [abilityId, key] of [
      ['ambush', 'ambush'],
      ['backstab', 'backstab'],
      ['garrote', 'garrote'],
      ['sinister_strike', 'sinister_strike'],
      ['eviscerate', 'eviscerate'],
    ] as const) {
      expect(
        impactCueForDamage(
          damage({ school: 'physical', ability: 'display label', abilityId }),
          target('mob', 'crypt_shambler'),
        ),
      ).toBe(key);
    }
    // Every other physical rogue strike keeps the shared material impact.
    expect(
      impactCueForDamage(
        damage({ school: 'physical', ability: 'Mutilate', abilityId: 'mutilate' }),
        target('mob', 'crypt_shambler'),
      ),
    ).toBe('impact_bone');
  });

  it('does not give Rupture its own impact on ordinary damage ticks (that would repeat every interval)', () => {
    // Rupture rides the same eviscerate.mp3 recording, but only once, on the
    // one-shot fx:'dotApply' apply moment tested below; the periodic 'damage'
    // event every tick emits must fall through to the shared material impact,
    // exactly like the HoT tick-silencing precedent (#2271, heal side).
    expect(
      impactCueForDamage(
        damage({ school: 'physical', ability: 'Bleed Out', abilityId: 'rupture' }),
        target('mob', 'crypt_shambler'),
      ),
    ).toBe('impact_bone');
  });

  it("does not replay Throat Wire's recording on its bleed ticks (garrote is a hybrid)", () => {
    // Garrote IS in IMPACT_ABILITY_CUES (its direct hit plays the recording),
    // and its bleed aura shares the ability id, so the only thing keeping the
    // recording off the 18s tick train is that combat/auras.ts deliberately
    // emits tick damage events with NO abilityId. Pin the tick shape here: a
    // label-only garrote event resolves the shared material impact.
    expect(
      impactCueForDamage(
        damage({ school: 'physical', ability: 'Throat Wire' }),
        target('mob', 'crypt_shambler'),
      ),
    ).toBe('impact_bone');
  });

  it('gives Rupture its own cue once, on the dotApply moment', () => {
    expect(
      spellFxCue({
        type: 'spellfx',
        sourceId: 10,
        targetId: 20,
        school: 'physical',
        fx: 'dotApply',
        ability: 'rupture',
      }),
    ).toEqual({ key: 'eviscerate', anchorId: 20 });
    // A dot with no dedicated recording stays silent.
    expect(
      spellFxCue({
        type: 'spellfx',
        sourceId: 10,
        targetId: 20,
        school: 'nature',
        fx: 'dotApply',
        ability: 'rake',
      }),
    ).toBeNull();
  });

  it('gives Blink and Shadowstep their own teleport cue (same blinkForward effect)', () => {
    expect(
      spellFxCue({
        type: 'spellfx',
        sourceId: 10,
        targetId: 10,
        school: 'arcane',
        fx: 'blinkStep',
        ability: 'blink',
      }),
    ).toEqual({ key: 'blink', anchorId: 10 });
    expect(
      spellFxCue({
        type: 'spellfx',
        sourceId: 10,
        targetId: 10,
        school: 'physical',
        fx: 'blinkStep',
        ability: 'shadowstep',
      }),
    ).toEqual({ key: 'shadowstep', anchorId: 10 });
    // An ability sharing the effect with no recording of its own stays silent.
    expect(
      spellFxCue({
        type: 'spellfx',
        sourceId: 10,
        targetId: 10,
        school: 'physical',
        fx: 'blinkStep',
        ability: 'heroic_leap',
      }),
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

  it('requests a hurt reaction only for a crit against a non-boss, non-dummy mob', () => {
    const mob = target('mob', 'crypt_shambler');
    const boss = target('mob', 'nythraxis_scourge_of_thornpeak');
    const dummy = target('mob', 'training_dummy');
    const player = target('player', 'warrior');
    expect(mobVoiceActionForDamage(damage({ crit: true }), mob)).toBe('hurt');
    expect(mobVoiceActionForDamage(damage({ crit: false }), mob)).toBeNull();
    expect(mobVoiceActionForDamage(damage({ crit: true }), boss)).toBeNull();
    // The dummy is excluded from the hurt bark specifically, even though it
    // still gets the plain crit ding (shouldPlayCritSfxForTarget, tested above).
    expect(mobVoiceActionForDamage(damage({ crit: true }), dummy)).toBeNull();
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

  it('gives Ice Block its own apply cue instead of the shared buff_apply', () => {
    const gained = { type: 'aura', targetId: 1, name: 'Test Aura', gained: true } as const;
    expect(auraApplyCue(gained, { ...aura('buff_ap'), id: 'ice_block' })).toBe('ice_block');
    // Every other buff keeps the shared chime.
    expect(auraApplyCue(gained, { ...aura('buff_ap'), id: 'ice_barrier' })).toBe('buff_apply');
  });

  it('gives Cloak of Shadows its own apply cue too (an absorb aura, same apply path)', () => {
    const gained = { type: 'aura', targetId: 1, name: 'Test Aura', gained: true } as const;
    expect(auraApplyCue(gained, { ...aura('absorb'), id: 'cloak_of_shadows' })).toBe(
      'cloak_of_shadows',
    );
    // Every other absorb shield keeps the shared chime.
    expect(auraApplyCue(gained, { ...aura('absorb'), id: 'power_word_shield' })).toBe('buff_apply');
  });

  it('gives Vanish and Stealth their own apply cue too (toggle stealth selfBuffs, same apply path)', () => {
    const gained = { type: 'aura', targetId: 1, name: 'Test Aura', gained: true } as const;
    expect(auraApplyCue(gained, { ...aura('stealth'), id: 'vanish' })).toBe('vanish');
    expect(auraApplyCue(gained, { ...aura('stealth'), id: 'stealth' })).toBe('stealth');
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
    expect(playerSwingCueForDamage(damage({ school: 'fire' }), warrior)).toBeNull();
    expect(playerSwingCueForDamage(damage({ ability: 'Auto Shot' }), warrior)).toBeNull();
  });

  it('a potion always plays its cue, a mana-only quaff included (amount 0)', () => {
    expect(consumeHealCue(heal({ source: 'potion', amount: 40 }))).toBe('player_drink_potion');
    expect(consumeHealCue(heal({ source: 'potion', amount: 0 }))).toBe('player_drink_potion');
  });

  it('eat/drink only plays on the designated sfxTick, independent of amount', () => {
    expect(consumeHealCue(heal({ source: 'food', amount: 10, sfxTick: true }))).toBe(
      'player_eat_food',
    );
    expect(consumeHealCue(heal({ source: 'food', amount: 10, sfxTick: false }))).toBeNull();
    expect(consumeHealCue(heal({ source: 'food', amount: 0, sfxTick: true }))).toBe(
      'player_eat_food',
    ); // full hp: still sounds on the sfx tick
    expect(consumeHealCue(heal({ source: 'drink', amount: 10, sfxTick: true }))).toBe(
      'player_drink_water',
    );
    expect(consumeHealCue(heal({ source: 'drink', amount: 10, sfxTick: false }))).toBeNull();
  });

  it('a heal with no source (leech, second wind, companion heals, ...) has no consume cue', () => {
    expect(consumeHealCue(heal({ amount: 25 }))).toBeNull();
  });
});
