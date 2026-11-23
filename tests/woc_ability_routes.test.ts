// Exact ability-to-clip routes for every WOC player body. A route names the clip a class
// plays for that ability (attackByAbility for a strike or release, castByAbility for a
// channel, cast for every other cast). These are pinned exactly, not by membership in an
// allowed set, so swapping one keyed clip for another reads as a deliberate change here.
// The loadout swaps that rewrite these per weapon set are pinned in
// tests/weapon_loadout_core.test.ts; tests/character_clipmaps.test.ts proves every clip ships.
import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';

const ROUTES: Record<
  string,
  { cast: string; attackByAbility: Record<string, string>; castByAbility: Record<string, string> }
> = {
  warrior: {
    cast: 'Woc_Cast_Directed',
    attackByAbility: {
      mortal_strike: 'Woc_Attack_2H_0',
      execute: 'Woc_Attack_2H_0',
      slam: 'Woc_Attack_2H_0',
      red_harvest: 'Woc_Attack_2H_1',
      breachmaker: 'Woc_Attack_2H_1',
      shield_slam: 'Woc_Shield_Bash',
      raging_gale: 'Woc_Attack_Dual',
      bloodthirst: 'Woc_Attack_Dual',
      cleave: 'Woc_Special_1H',
      revenge: 'Woc_Attack_1H_1',
      thunder_clap: 'Woc_Special_1H',
      faultline: 'Woc_Attack_2H_1',
      heroic_strike: 'Woc_Attack_1H_0',
      overpower: 'Woc_Attack_1H_1',
      hamstring: 'Woc_Attack_1H_Stab',
      pummel: 'Woc_Attack_Unarmed_0',
      heroic_leap: 'Woc_Attack_2H_0',
      victory_rush: 'Woc_Attack_1H_1',
    },
    castByAbility: {},
  },
  paladin: {
    cast: 'Woc_Cast_Omni',
    attackByAbility: {
      crusader_strike: 'Woc_Attack_1H_0',
      vowkeeper_strike: 'Woc_Attack_1H_1',
      final_edict: 'Woc_Attack_2H_0',
      hushbrand: 'Woc_Shield_Bash',
      rebuke: 'Woc_Attack_1H_0',
      mercy_lance: 'Woc_Cast_Shoot',
    },
    castByAbility: {},
  },
  hunter: {
    cast: 'Woc_Attack_Rifle#aim',
    attackByAbility: {
      aimed_shot: 'Woc_Attack_Rifle#release',
      measured_shot: 'Woc_Attack_Rifle#release',
      arcane_shot: 'Woc_Attack_Rifle',
      serpent_sting: 'Woc_Attack_Rifle',
      wyvern_sting: 'Woc_Attack_Rifle',
      raptor_strike: 'Woc_Attack_1H_0',
      mongoose_bite: 'Woc_Attack_1H_1',
      wing_clip: 'Woc_Attack_1H_1',
      bloodhook: 'Woc_Attack_1H_Stab',
      counter_shot: 'Woc_Attack_Rifle',
      startle_shot: 'Woc_Attack_Rifle',
      concussive_shot: 'Woc_Attack_Rifle',
      multi_shot: 'Woc_Attack_Rifle',
      phosphor_flask: 'Woc_Attack_Rifle',
      scatterbolt: 'Woc_Attack_Rifle',
      shrapnel_charge: 'Woc_Attack_Rifle',
    },
    castByAbility: {
      volley: 'Woc_Attack_Rifle',
      rapid_fire: 'Woc_Attack_Rifle',
      tame_beast: 'Woc_Channel_Directed',
      revive_pet: 'Woc_Cast_Omni',
    },
  },
  rogue: {
    cast: 'Woc_Cast_Directed',
    attackByAbility: {
      venom_dart: 'Woc_Attack_Thrown',
      crippling_poison: 'Woc_Attack_1H_1',
      rupture: 'Woc_Attack_1H_1',
      eviscerate: 'Woc_Special_1H',
      expose_armor: 'Woc_Attack_1H_1',
      backstab: 'Woc_Attack_1H_Stab',
      ambush: 'Woc_Attack_1H_Stab',
      gouge: 'Woc_Attack_1H_0',
      cheap_shot: 'Woc_Attack_1H_0',
      kidney_shot: 'Woc_Attack_1H_0',
    },
    castByAbility: {},
  },
  priest: {
    cast: 'Woc_Cast_Directed',
    attackByAbility: {
      smite: 'Woc_Cast_Shoot',
      mind_blast: 'Woc_Cast_Shoot',
      void_rupture: 'Woc_Cast_Shoot',
    },
    castByAbility: {
      mind_flay: 'Woc_Channel_Directed',
      mind_sear: 'Woc_Channel_Directed',
      choir_of_deliverance: 'Woc_Cast_Omni',
    },
  },
  shaman: {
    cast: 'Woc_Cast_Directed',
    attackByAbility: {
      lightning_bolt: 'Woc_Cast_Shoot',
      chain_lightning: 'Woc_Cast_Shoot',
      stormstrike: 'Woc_Special_1H',
    },
    castByAbility: {},
  },
  mage: {
    cast: 'Woc_Cast_Directed',
    attackByAbility: {
      fireball: 'Woc_Cast_Shoot',
      frostbolt: 'Woc_Cast_Shoot',
      flurry: 'Woc_Cast_Shoot',
      glacial_spike: 'Woc_Cast_Shoot',
      pyroblast: 'Woc_Cast_Shoot',
      arcane_surge: 'Woc_Cast_Omni_Release',
      scorch: 'Woc_Cast_Shoot',
      flamestrike: 'Woc_Cast_Omni_Release',
      blizzard: 'Woc_Cast_Omni_Release',
      rings_of_frost: 'Woc_Cast_Omni_Release',
      polymorph: 'Woc_Cast_Shoot',
      temporal_hourglass: 'Woc_Cast_Shoot',
      glacial_front: 'Woc_Cast_Shoot',
      dragons_breath: 'Woc_Cast_Omni_Release',
    },
    castByAbility: {
      arcane_missiles: 'Woc_Channel_Directed',
      evocation: 'Woc_Cast_Omni',
    },
  },
  warlock: {
    cast: 'Woc_Cast_Directed',
    attackByAbility: {
      shadow_bolt: 'Woc_Cast_Shoot',
      immolate: 'Woc_Cast_Shoot',
      corruption: 'Woc_Cast_Shoot',
      soul_lance: 'Woc_Cast_Shoot',
      searing_pain: 'Woc_Cast_Shoot',
      soul_harvest: 'Woc_Cast_Omni_Release',
      chaos_bolt: 'Woc_Cast_Shoot',
      fear: 'Woc_Cast_Shoot',
      needle_of_fate: 'Woc_Cast_Shoot',
    },
    castByAbility: {
      drain_life: 'Woc_Channel_Directed',
    },
  },
  druid: {
    cast: 'Woc_Cast_Directed',
    attackByAbility: {
      wrath: 'Woc_Cast_Shoot',
      starfire: 'Woc_Cast_Omni_Release',
      entangling_roots: 'Woc_Cast_Shoot',
      hibernate: 'Woc_Cast_Shoot',
    },
    castByAbility: {
      hurricane: 'Woc_Channel_Directed',
      tranquility: 'Woc_Cast_Omni',
    },
  },
};

describe('WOC player ability routes', () => {
  it.each(Object.keys(ROUTES))('%s plays exactly its pinned clip per ability', (cls) => {
    const clips = VISUALS[`player_${cls}`].clips;
    expect({
      cast: clips.cast,
      attackByAbility: clips.attackByAbility ?? {},
      castByAbility: clips.castByAbility ?? {},
    }).toEqual(ROUTES[cls]);
  });

  it.each(Object.keys(ROUTES))('the female %s body shares the male routes', (cls) => {
    const male = VISUALS[`player_${cls}`].clips;
    const female = VISUALS[`player_${cls}_female`]?.clips;
    expect(female, `player_${cls}_female`).toBeDefined();
    expect(female?.cast).toBe(male.cast);
    expect(female?.attackByAbility).toEqual(male.attackByAbility);
    expect(female?.castByAbility).toEqual(male.castByAbility);
  });
});
