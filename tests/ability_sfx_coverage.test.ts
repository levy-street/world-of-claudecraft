// Which ability-audio moments a hand-recorded studio cue already carries
// (src/game/ability_sfx_coverage.ts). The procedural ability layer must stay
// SILENT on those moments instead of doubling the recording: before this
// module, a Fireball played Jamie's proj_fire and impact_fire from
// combat_sfx.ts AND a synthetic release whoosh + impact boom on the same
// instants at the same positions, which masked the recordings.
//
// Provenance is not a judgement call here: scripts/sfx/sfx_prompts.mjs marks
// every hand-recorded key `custom: true` (commit 3759b1381, "Marks every one
// of Jamie's hand-recorded custom SFX"). The pins below are keyed to that flag.
import { describe, expect, it } from 'vitest';
import {
  type AbilityAudioMoment,
  isAbilityMomentRecorded,
  RECORDED_IMPACT_ARCHETYPES,
  RECORDED_PROJECTILE_SCHOOLS,
} from '../src/game/ability_sfx_coverage';

describe('release: the launch whoosh belongs to the recorded proj_ pack', () => {
  it('is recorded for each of the six magic schools Jamie cut a proj_ take for', () => {
    // proj_fire / proj_frost / proj_arcane / proj_shadow / proj_holy /
    // proj_nature, all custom: true, fired by spellFxCue at the caster the
    // same instant the sequencer asks for its release moment.
    for (const school of ['fire', 'frost', 'arcane', 'shadow', 'holy', 'nature']) {
      expect(isAbilityMomentRecorded('release', { school, archetype: 'bolt' })).toBe(true);
    }
  });

  it('is NOT recorded for physical abilities: there is no proj_physical take', () => {
    expect(isAbilityMomentRecorded('release', { school: 'physical', archetype: 'strike' })).toBe(
      false,
    );
  });

  it('is NOT recorded when the school is unknown or absent', () => {
    expect(isAbilityMomentRecorded('release', { archetype: 'strike' })).toBe(false);
    expect(isAbilityMomentRecorded('release', { school: 'chaos', archetype: 'bolt' })).toBe(false);
  });

  it('is NOT recorded for a spell that opts out of the projectile convention', () => {
    // Fire Blast (projectile: false) resolves instantly at cast completion and
    // emits no projectile spellfx, so proj_fire never plays and the procedural
    // whoosh must keep carrying its launch.
    expect(
      isAbilityMomentRecorded('release', {
        school: 'fire',
        archetype: 'bolt',
        isProjectile: false,
      }),
    ).toBe(false);
  });

  it('treats an omitted projectile flag as the by-convention projectile', () => {
    // AbilityDef.projectile is opt-OUT for spells: undefined means it travels.
    expect(isAbilityMomentRecorded('release', { school: 'frost', archetype: 'bolt' })).toBe(true);
    expect(
      isAbilityMomentRecorded('release', {
        school: 'frost',
        archetype: 'bolt',
        isProjectile: true,
      }),
    ).toBe(true);
  });

  it('pins the recorded projectile school set to exactly the six', () => {
    expect([...RECORDED_PROJECTILE_SCHOOLS].sort()).toEqual([
      'arcane',
      'fire',
      'frost',
      'holy',
      'nature',
      'shadow',
    ]);
  });
});

describe('impact: the landing belongs to the recorded impact_ pack', () => {
  it('is recorded for every damage-landing archetype, whatever the school', () => {
    // impactCueForDamage always resolves to a recorded cue: impact_<school>
    // for the six schools, impact_flesh/metal/leather/bone for physical.
    for (const archetype of ['bolt', 'burst', 'strike', 'nova', 'beam', 'dot']) {
      expect(isAbilityMomentRecorded('impact', { school: 'fire', archetype })).toBe(true);
      expect(isAbilityMomentRecorded('impact', { school: 'physical', archetype })).toBe(true);
    }
  });

  it('is recorded for heal (heal_impact) and buff (buff_apply)', () => {
    expect(isAbilityMomentRecorded('impact', { school: 'holy', archetype: 'heal' })).toBe(true);
    expect(isAbilityMomentRecorded('impact', { school: 'nature', archetype: 'buff' })).toBe(true);
  });

  it('is NOT recorded for cc, summon, shout or dash', () => {
    // cc: debuff_apply only fires for your OWN debuffs (hud.ts returns early
    // for any other target), so an enemy cc lands on nothing recorded.
    // summon/shout/dash: no damage event, so no impact cue at all.
    for (const archetype of ['cc', 'summon', 'shout', 'dash']) {
      expect(isAbilityMomentRecorded('impact', { school: 'shadow', archetype })).toBe(false);
    }
  });

  it('is recorded for the fear-family override regardless of archetype', () => {
    // Harrow is archetype 'cc' (normally uncovered above); the two AoE fear
    // shouts are archetype 'shout' (also normally uncovered). All three now
    // have a real recording for the landed-fear moment (the 'fear' cue).
    expect(
      isAbilityMomentRecorded('impact', { school: 'shadow', archetype: 'cc', abilityId: 'fear' }),
    ).toBe(true);
    for (const abilityId of ['psychic_scream', 'howl_of_terror', 'intimidating_shout']) {
      expect(
        isAbilityMomentRecorded('impact', { school: 'shadow', archetype: 'shout', abilityId }),
      ).toBe(true);
    }
    // An ordinary cc/shout ability keeps the procedural read.
    expect(
      isAbilityMomentRecorded('impact', {
        school: 'shadow',
        archetype: 'cc',
        abilityId: 'polymorph',
      }),
    ).toBe(false);
  });

  it('is recorded for the plain cc override (hammer_of_justice, entangling_roots, blind, cheap_shot, sap)', () => {
    for (const abilityId of [
      'hammer_of_justice',
      'entangling_roots',
      'blind',
      'cheap_shot',
      'sap',
    ]) {
      expect(
        isAbilityMomentRecorded('impact', { school: 'physical', archetype: 'cc', abilityId }),
      ).toBe(true);
    }
  });

  it('pins the recorded impact archetype set', () => {
    expect([...RECORDED_IMPACT_ARCHETYPES].sort()).toEqual([
      'beam',
      'bolt',
      'buff',
      'burst',
      'dot',
      'heal',
      'nova',
      'strike',
    ]);
  });
});

describe('crit: combat_crit is a recording', () => {
  it('is recorded regardless of school or archetype', () => {
    expect(isAbilityMomentRecorded('crit', { school: 'fire', archetype: 'bolt' })).toBe(true);
    expect(isAbilityMomentRecorded('crit', { school: 'physical', archetype: 'strike' })).toBe(true);
    expect(isAbilityMomentRecorded('crit', {})).toBe(true);
  });
});

describe('the moments no recording covers keep their procedural voice', () => {
  it('leaves windup, pulse, spirit and motif uncovered', () => {
    const uncovered: AbilityAudioMoment[] = ['windup', 'pulse', 'spirit', 'motif'];
    for (const moment of uncovered) {
      expect(isAbilityMomentRecorded(moment, { school: 'fire', archetype: 'bolt' })).toBe(false);
      expect(isAbilityMomentRecorded(moment, { school: 'physical', archetype: 'strike' })).toBe(
        false,
      );
    }
  });
});
