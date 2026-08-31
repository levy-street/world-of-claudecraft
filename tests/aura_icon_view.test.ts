import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { POWERUPS } from '../src/sim/content/augments';
import { CHOICE_ROWS } from '../src/sim/content/choice_rows';
import {
  auraIconCssBackground,
  createAuraIconResolver,
  RUNTIME_AURA_ICON_SOURCE_IDS,
  resolveAuraIconId,
} from '../src/ui/aura_icon_view';
import {
  AURA_IMAGE_IDS,
  abilityImageUrl,
  auraImageUrl,
  hasAbilityIconIdentity,
  hasAuraImageIdentity,
  hasAuraRecipe,
} from '../src/ui/icons';
import { observeFiestaPowerupAuras } from './helpers/fiesta_powerup_aura_observer';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const GENERATED_ABILITY_AURAS = [
  ['arcane_power_buff_spellhaste', 'arcane_power'],
  ['avenging_wrath_buff_spellpower', 'avenging_wrath'],
  ['deterrence_buff_dr', 'deterrence'],
  ['hemorrhage_bleed_vuln', 'hemorrhage'],
  ['icy_veins_cast_shield', 'icy_veins'],
  ['metamorphosis_buff_spelldmg', 'metamorphosis'],
  ['metamorphosis_buff_spellhaste', 'metamorphosis'],
  ['aspect_of_the_wild_ap', 'aspect_of_the_wild'],
  ['demoralizing_roar_ap', 'demoralizing_roar'],
  ['demoralizing_shout_ap', 'demoralizing_shout'],
  ['trueshot_aura_ap', 'trueshot_aura'],
  ['thunder_clap_as', 'thunder_clap'],
  ['emboldening_roar_crit', 'emboldening_roar'],
  ['typhoon_daze', 'typhoon'],
  ['rallying_cry_dr', 'rallying_cry'],
  ['frost_trap_freeze', 'frost_trap'],
  ['rallying_cry_hp', 'rallying_cry'],
  ['blind_incap', 'blind'],
  ['death_coil_incap', 'death_coil'],
  ['dragons_breath_incap', 'dragons_breath'],
  ['gouge_incap', 'gouge'],
  ['hibernate_incap', 'hibernate'],
  ['sap_incap', 'sap'],
  ['startle_shot_incap', 'startle_shot'],
  ['wyvern_sting_incap', 'wyvern_sting'],
  ['counter_shot_lockout', 'counter_shot'],
  ['counterspell_lockout', 'counterspell'],
  ['kick_lockout', 'kick'],
  ['pummel_lockout', 'pummel'],
  ['rebuke_lockout', 'rebuke'],
  ['skull_bash_lockout', 'skull_bash'],
  ['spell_lock_lockout', 'spell_lock'],
  ['bestial_wrath_pet', 'bestial_wrath'],
  ['metamorphosis_pet', 'metamorphosis'],
  ['metamorphosis_pet_pet_spellhaste', 'metamorphosis'],
  ['earthbind_root', 'earthbind'],
  ['entangling_roots_root', 'entangling_roots'],
  ['frost_nova_root', 'frost_nova'],
  ['glacial_front_root', 'glacial_front'],
  ['glacial_spike_root', 'glacial_spike'],
  ['rings_of_frost_root', 'rings_of_frost'],
  // aura_surge lost its ability-icon identity on the overhauled integration
  // tree, so the recovery falls back to the generic aura painting.
  ['aura_surge_silence', 'aura_buff'],
  ['silence_silence', 'silence'],
  ['concussive_shot_slow', 'concussive_shot'],
  ['crippling_poison_slow', 'crippling_poison'],
  ['curse_of_exhaustion_slow', 'curse_of_exhaustion'],
  ['frost_shock_slow', 'frost_shock'],
  ['frostbolt_slow', 'frostbolt'],
  ['glacial_front_slow', 'glacial_front'],
  ['hamstring_slow', 'hamstring'],
  ['piercing_howl_slow', 'piercing_howl'],
  ['wing_clip_slow', 'wing_clip'],
  ['bloodlust_spell', 'bloodlust'],
  ['temporal_acceleration_spell', 'temporal_acceleration'],
  ['bash_stun', 'bash'],
  ['bear_charge_stun', 'bear_charge'],
  ['charge_stun', 'charge'],
  ['cheap_shot_stun', 'cheap_shot'],
  ['deep_freeze_stun', 'deep_freeze'],
  ['faultline_stun', 'faultline'],
  ['hammer_of_justice_stun', 'hammer_of_justice'],
  ['kidney_shot_stun', 'kidney_shot'],
  ['pounce_stun', 'pounce'],
  ['storm_bolt_stun', 'storm_bolt'],
] as const;

const SOURCE_DERIVED_AURAS = [
  ['aether_surge_free', 'arcane_surge'],
  ['blizzard_slow', 'blizzard'],
  ['frozen_orb_slow', 'frozen_orb'],
  ['greater_invisibility_dr', 'greater_invisibility'],
  ['raised_guard_dr', 'raised_guard'],
  ['breachmaker_vuln', 'breachmaker'],
  ['hot_streak_instant', 'hot_streak'],
  ['revenge_free', 'revenge'],
] as const;

const NON_CHOICE_RUNTIME_AURA_SOURCES = [
  ['aether_surge_free', 'arcane_surge'],
  ['feral_instinct_energy', 'feral_charge'],
  ['fury_enrage', 'enrage_passive'],
  ['ignite', 'ignition'],
  ['natures_fury', 'hurricane'],
] as const;

const DIRECT_RUNTIME_AURA_SOURCES = [
  ['convergence_cd', 'elemental_convergence'],
  ['convergence_mark', 'elemental_convergence'],
  ['feed_pet', 'pet_feed'],
  ['heating_up', 'fireball'],
  ['shaman_thunder_charges', 'thunder_reservoir'],
  ['shaman_warspirit_cadence', 'warspirit_cadence'],
  ['water_jet', 'pet_water_jet'],
  ['water_jet_slow', 'pet_water_jet'],
] as const;

const REUSED_PAINTED_RUNTIME_AURA_SOURCES = [
  ['avenging_wrath_buff_healing_done', 'avenging_wrath'],
  ['avenging_wrath_buff_crit', 'avenging_wrath'],
  ['avenging_wrath_buff_haste', 'avenging_wrath'],
  ['bastion_rite_buff_block', 'bastion_rite'],
  ['bladed_echo', 'whirlwind'],
  ['power_infusion_buff_dmg_done_1', 'power_infusion'],
  ['power_infusion_buff_heal_done_2', 'power_infusion'],
  ['evasion_shield_wall', 'evasion'],
  ['marked_prey', 'kidney_shot'],
  ['deathmark', 'garrote'],
  ['pet_aspect_of_the_cheetah', 'aspect_of_the_cheetah'],
  ['pet_aspect_of_the_hawk', 'aspect_of_the_hawk'],
] as const;

// Class-overhaul state uses semantic wire ids that are neither AbilityDef ids
// nor mechanical `<ability>_<suffix>` derivatives. Every row is tied to the
// painted ability or authored talent icon that owns the state in production.
const POST_OVERHAUL_RUNTIME_AURA_SOURCES = [
  ['aegis_first_dawn_speed', 'aegis_first_dawn'],
  // Benison Dawnweave 4pc mend: same icon family as the Seraphic Vigil it pays off.
  ['benison_dawnweave_mend', 'seraphic_vigil'],
  ['bloodhook_bleed', 'bloodhook'],
  ['bloodhook_pending', 'bloodhook'],
  ['dawns_wrath', 'hammer_of_wrath'],
  ['desolation', 'conflagrate'],
  ['divine_steed_burst', 'divine_ascension'],
  ['drain_life_fate_threads', 'drain_life'],
  ['dusk_economy', 'stealth'],
  ['duskfire_claim', 'shadowburn'],
  ['elemental_mastery_vent', 'elemental_mastery'],
  ['funeral_harvest_mark', 'funeral_harvest'],
  ['gloam', 'veilstrike'],
  ['howling_rage_empower', 'bestial_wrath'],
  ['hunter_apex_instinct', 'bestial_wrath'],
  ['hunter_chain_reaction_uses', 'frostjaw_trap'],
  ['hunter_efficient_rhythm_progress', 'measured_shot'],
  ['hunter_efficient_rhythm_ready', 'measured_shot'],
  ['hunter_enduring_courser_burst', 'aspect_of_the_cheetah'],
  ['hunter_enduring_courser_icd', 'aspect_of_the_cheetah'],
  ['hunter_fang_chorus_counter', 'tame_beast'],
  ['hunter_guise_courser', 'aspect_of_the_cheetah'],
  ['hunter_guise_harrier', 'aspect_of_the_hawk'],
  ['hunter_guise_marten', 'aspect_of_the_monkey'],
  ['hunter_guise_mastery_icd', 'aspect_of_the_hawk'],
  ['hunter_overdraw_counter', 'arcane_shot'],
  ['hunter_pack_rally_haste', 'pack_rally'],
  ['hunter_pack_rally_speed', 'pack_rally'],
  ['hunter_pack_rally_spellhaste', 'pack_rally'],
  ['hunter_predators_pace', 'measured_shot'],
  ['hunter_predators_pace_icd', 'measured_shot'],
  ['lich_form_army', 'metamorphosis'],
  ['lich_form_army_haste', 'metamorphosis'],
  ['loping_stride', 'cat_form'],
  ['marrowbreak_guard', 'marrowbreak'],
  ['oath_chain_pull', 'oath_chain'],
  // Oathpyre 4pc consume shield: same icon family as the Solar Reprisal proc.
  ['oathpyre_bulwark', 'vowkeeper_strike'],
  ['pack_ferocity', 'pack_command'],
  ['perpetual_sun_generation', 'divine_ascension'],
  ['possess_evil_eye_sentence_echo', 'possess_evil_eye'],
  ['priest_doctrine', 'power_word_shield'],
  ['priest_effigy', 'mind_blast'],
  ['priest_gloomtithe', 'summon_tithefiend'],
  ['priest_lingering_dread', 'psychic_scream'],
  ['priest_living_covenant', 'power_word_shield'],
  ['priest_processional_grace', 'choir_of_deliverance'],
  ['priest_sheltering_step', 'power_word_shield'],
  ['priest_veil_unbound', 'veilstep'],
  ['pyre_guardian', 'summon_infernal'],
  ['radiant_resonance', 'radiant_chorus'],
  ['radiant_stride_speed', 'hammer_of_grace'],
  ['recurring_grace_absorb', 'hammer_of_grace'],
  ['redline', 'eviscerate'],
  ['reaping_command_bone_mage', 'reaping_command'],
  ['reaping_command_graveguard', 'reaping_command'],
  ['reaping_command_gravewing', 'reaping_command'],
  ['reaping_command_warrior', 'reaping_command'],
  // Slagsnare 4pc preserve lockout: same icon family as the Woundrend consume.
  ['slagsnare_momentum_icd', 'mongoose_bite'],
  ['shaman_ancestral_bulwark', 'lightning_shield'],
  ['shaman_ancestral_bulwark_icd', 'lightning_shield'],
  ['shaman_echoing_elements_damage', 'chain_lightning'],
  ['shaman_echoing_elements_heal', 'chain_lightning'],
  ['shaman_echoing_elements_stormcast', 'chain_lightning'],
  ['shaman_flow_state_progress', 'healing_wave'],
  ['shaman_flow_state_ready', 'healing_wave'],
  ['shaman_flowing_elements', 'lightning_bolt'],
  ['shaman_galeheart_unleash_haste', 'unleash_weapon'],
  ['shaman_gathering_winds', 'galeheart_weapon'],
  ['shaman_gathering_winds_icd', 'galeheart_weapon'],
  ['shaman_living_weapon_absorb', 'rockbiter_weapon'],
  ['shaman_living_weapon_bolt', 'rockbiter_weapon'],
  ['shaman_primal_exaltation', 'elemental_mastery'],
  ['shaman_pyrebrand_mastery', 'rockbiter_weapon'],
  ['shaman_stonebound_armor', 'rockbiter_weapon'],
  ['shaman_stonebound_dr', 'rockbiter_weapon'],
  ['shaman_stonebound_stamina', 'rockbiter_weapon'],
  ['shaman_stonebound_unleash_guard', 'unleash_weapon'],
  ['shaman_stonebound_ward_smooth', 'lightning_shield'],
  ['shaman_stoneward', 'stoneward'],
  ['shaman_stormsurge_ready', 'stormstrike'],
  ['shaman_ward_cycle_icd', 'lightning_shield'],
  ['shaman_warded_elements', 'lightning_shield'],
  ['shaman_wayfarer_grace', 'ghost_wolf'],
  ['shaman_wayfarer_grace_icd', 'ghost_wolf'],
  // Emberscreed 4pc instant-hymn empower: same icon family as Scouring Hymn.
  ['set_emberscreed_4pc', 'smite'],
  ['shrapnel_wound', 'shrapnel_charge'],
  ['solar_reprisal', 'vowkeeper_strike'],
  ['solar_step_slow_immunity', 'solar_step'],
  ['stampede_ready', 'stampede'],
  ['steady_hands_hot', 'lay_on_hands'],
  ['unholy_command_haste', 'unholy_command'],
  ['valkyrs_calling_flight', 'valkyrs_calling'],
  ['veiled_edge', 'veilstrike'],
  ['veilbound_mark', 'veilbound_march'],
  ['veilbound_march_armor', 'veilbound_march'],
  ['venom_ritual', 'venomrend'],
  ['wlk_blacktide_speed', 'wlk_r5_improved_corruption'],
  ['wlk_forbidden_reflection', 'wlk_r20_grimoire_of_haste'],
  ['wlk_forbidden_reflection_lock', 'wlk_r20_grimoire_of_haste'],
  ['wlk_leaden_hex_root', 'wlk_r8_curse_of_exhaustion'],
  ['wlk_leaden_hex_root_lock', 'wlk_r8_curse_of_exhaustion'],
  ['wlk_leaden_hex_slow', 'wlk_r8_curse_of_exhaustion'],
  ['wlk_shadow_credit', 'wlk_r14_shadow_mastery'],
] as const;

const POST_OVERHAUL_RUNTIME_AURA_FAMILY_SOURCES = [
  ['aegis_first_dawn_dr:17', 'aegis_first_dawn'],
  ['binding_psalm_17', 'power_word_shield'],
  ['hunter_chain_mark_17', 'frostjaw_trap'],
  ['hunter_crippling_pursuit_17', 'concussive_shot'],
  ['hunter_crippling_root_17', 'concussive_shot'],
  ['hunter_shared_recovery_17', 'wildheart'],
  ['necromancy_death_echo_0', 'ossuary_mark'],
  ['necromancy_death_echo_1', 'ossuary_mark'],
  ['necromancy_death_echo_2', 'ossuary_mark'],
  ['priest_second_verse_effigy_15_17', 'smite'],
  ['priest_second_verse_holy_nova_15', 'smite'],
  ['priest_second_verse_prayer_of_healing_15', 'smite'],
  ['priest_second_verse_scouring_mercy_15', 'smite'],
] as const;

const AURA_RESPONSE_KINDS = new Set(['empowerNext', 'absorb', 'aura', 'echo']);

describe('resolveAuraIconId', () => {
  const resolve = (id: string, kind = 'buff'): string =>
    resolveAuraIconId({ id, kind }, hasAbilityIconIdentity, hasAuraRecipe, hasAuraImageIdentity);

  it('keeps exact ability, modifier-art, and dedicated aura identities intact', () => {
    expect(resolve('moonfire', 'dot')).toBe('moonfire');
    expect(resolve('bg_sprint_rune', 'buff_speed')).toBe('bg_sprint_rune');
    for (const id of ['bloodbath', 'elemental_convergence', 'pursuit']) {
      expect(hasAbilityIconIdentity(id), `${id} fixture`).toBe(true);
      expect(resolve(id), id).toBe(id);
    }
  });

  it('recovers all unambiguous generated ability identities', () => {
    expect(GENERATED_ABILITY_AURAS).toHaveLength(64);
    for (const [id, expected] of [...GENERATED_ABILITY_AURAS, ...SOURCE_DERIVED_AURAS]) {
      expect(resolve(id), id).toBe(expected);
    }
  });

  it('maps every aura-producing choice proc and exact semantic producer to painted art', () => {
    const choiceSources: [string, string][] = [];
    const fiestaPowerupSources = observeFiestaPowerupAuras().flatMap(({ definition, auras }) =>
      auras.map(({ id }) => [id, definition.id] as const),
    );
    for (const tree of Object.values(CHOICE_ROWS)) {
      for (const row of tree.rows) {
        for (const option of row.options) {
          const proc = option.effect.proc;
          if (!proc?.responses.some((response) => AURA_RESPONSE_KINDS.has(response.kind))) {
            continue;
          }
          expect(option.icon, `${option.id} painted proc source`).toBeDefined();
          choiceSources.push([proc.id, option.icon ?? '']);
        }
      }
    }

    // Authored at 37 over the pre-overhaul choice rows; the class overhauls
    // replaced most classic rows with direct engine states, leaving seven
    // ProcDef producers plus the closed semantic inventory above.
    expect(choiceSources).toHaveLength(7);
    expect(new Set(choiceSources.map(([id]) => id)).size).toBe(choiceSources.length);
    expect(POST_OVERHAUL_RUNTIME_AURA_SOURCES).toHaveLength(103);
    const expected = new Map<string, string>([
      ...choiceSources,
      ...NON_CHOICE_RUNTIME_AURA_SOURCES,
      ...DIRECT_RUNTIME_AURA_SOURCES,
      ...fiestaPowerupSources,
      ...REUSED_PAINTED_RUNTIME_AURA_SOURCES,
      ...POST_OVERHAUL_RUNTIME_AURA_SOURCES,
    ]);
    expect([...RUNTIME_AURA_ICON_SOURCE_IDS.entries()].sort()).toEqual(
      [...expected.entries()].sort(),
    );
    expect(DIRECT_RUNTIME_AURA_SOURCES).toHaveLength(8);
    expect(fiestaPowerupSources).toHaveLength(
      POWERUPS.reduce((count, definition) => count + definition.buffs.length, 0),
    );
    expect(REUSED_PAINTED_RUNTIME_AURA_SOURCES).toHaveLength(12);
    expect(RUNTIME_AURA_ICON_SOURCE_IDS.size).toBe(143);
    for (const [id, source] of expected) {
      const paintedIdentity = hasAuraImageIdentity(id) ? id : source;
      const imageUrl = auraImageUrl(paintedIdentity);
      expect(imageUrl, `${id} -> ${paintedIdentity} static painted source`).toMatch(
        /^\/ui\/(?:skills\/[a-z]+|auras|fiesta\/powerups)\/[a-z0-9_]+\.webp$/,
      );
      expect(
        existsSync(path.join(repoRoot, 'public', (imageUrl as string).slice(1))),
        `${id} -> ${paintedIdentity} shipped WebP`,
      ).toBe(true);
      expect(resolve(id), id).toBe(paintedIdentity);
    }
  });

  it('carries every reused semantic aura through resolution to its painted ability URL', () => {
    for (const [id, source] of REUSED_PAINTED_RUNTIME_AURA_SOURCES) {
      const iconId = resolve(id);
      expect(iconId, id).toBe(source);
      expect(auraImageUrl(iconId), `${id} resolved URL`).toBe(abilityImageUrl(source));
    }
  });

  it('keeps exact aura WebP identities even when they have no procedural recipe', () => {
    expect(AURA_IMAGE_IDS.size).toBeGreaterThan(0);
    for (const id of AURA_IMAGE_IDS) {
      const iconId = resolveAuraIconId(
        { id, kind: 'debuff' },
        () => false,
        () => false,
        hasAuraImageIdentity,
      );
      expect(iconId, id).toBe(id);
      expect(auraImageUrl(iconId), `${id} resolved URL`).not.toBeNull();
    }
  });

  it('resolves only the closed numeric runtime families to their painted producers', () => {
    expect(POST_OVERHAUL_RUNTIME_AURA_FAMILY_SOURCES).toHaveLength(13);
    for (const [id, source] of POST_OVERHAUL_RUNTIME_AURA_FAMILY_SOURCES) {
      const imageUrl = abilityImageUrl(source);
      expect(imageUrl, `${id} -> ${source} static painted source`).toMatch(
        /^\/ui\/skills\/[a-z]+\/[a-z0-9_]+\.webp$/,
      );
      expect(
        existsSync(path.join(repoRoot, 'public', (imageUrl as string).slice(1))),
        `${id} -> ${source} shipped WebP`,
      ).toBe(true);
      expect(resolve(id), id).toBe(source);
    }

    for (const id of [
      'aegis_first_dawn_dr:',
      'aegis_first_dawn_dr:01',
      'binding_psalm_-1',
      'hunter_chain_mark_wolf',
      'hunter_crippling_pursuit_17_extra',
      'hunter_crippling_root_',
      'hunter_shared_recovery_01',
      'necromancy_death_echo_-1',
      'necromancy_death_echo_3',
      'necromancy_death_echo_00',
      'necromancy_death_echo_0_extra',
      'priest_second_verse_effigy_15',
      'priest_second_verse_effigy_15_17_extra',
      'priest_second_verse_holy_nova_-1',
      'priest_second_verse_prayer_of_healing_01',
      'priest_second_verse_scouring_mercy_',
    ]) {
      expect(resolve(id), id).toBe('aura_buff');
    }
  });

  it('splits the player and mob producers that share the pack frenzy wire id', () => {
    const imageUrl = abilityImageUrl('unleash_beast');
    expect(imageUrl).toBe('/ui/skills/hunter/unleash_beast.webp');
    expect(existsSync(path.join(repoRoot, 'public', (imageUrl as string).slice(1)))).toBe(true);
    expect(resolve('pack_frenzy', 'hunter_frenzy')).toBe('unleash_beast');
    expect(resolve('pack_frenzy', 'buff_haste')).toBe('mob_pack_frenzy');
    expect(auraImageUrl('mob_pack_frenzy')).toBe('/ui/auras/mob_pack_frenzy.webp');
  });

  it('routes exact mob aura wire identities to their closed painted families', () => {
    for (const [id, kind, expected] of [
      ['aoe_slow', 'slow', 'mob_aoe_slow'],
      ['mob_charge_stun', 'stun', 'mob_charge_stun'],
      ['raise_bone_mage', 'spell_vuln', 'mob_spell_vuln'],
      ['venom_duskwisp', 'poison', 'mob_venom'],
    ] as const) {
      expect(resolve(id, kind), id).toBe(expected);
      const imageUrl = auraImageUrl(expected);
      expect(imageUrl, expected).toBe(`/ui/auras/${expected}.webp`);
      expect(existsSync(path.join(repoRoot, 'public', (imageUrl as string).slice(1)))).toBe(true);
    }
  });

  it('recovers painted modifier identities from generated timer suffixes', () => {
    for (const [id, expected] of [
      ['battle_rhythm_rage', 'battle_rhythm'],
      ['colossal_might_cap', 'colossal_might'],
      ['overflowing_power_cap', 'overflowing_power'],
    ] as const) {
      expect(hasAbilityIconIdentity(expected), `${expected} fixture`).toBe(true);
      expect(resolve(id), id).toBe(expected);
    }
  });

  it('supports nested and dormant generated suffix grammar without blind prefix walking', () => {
    const known = new Set(['source_ability']);
    const probe = (id: string): boolean => known.has(id);
    expect(
      resolveAuraIconId(
        { id: 'source_ability_pet_pet_spellhaste', kind: 'buff_spellhaste' },
        probe,
        () => false,
        () => false,
      ),
    ).toBe('source_ability');
    expect(
      resolveAuraIconId(
        { id: 'source_ability_absorb', kind: 'absorb' },
        probe,
        () => false,
        () => false,
      ),
    ).toBe('source_ability');
    expect(
      resolveAuraIconId(
        { id: 'source_ability_dmg', kind: 'buff_dmg_done' },
        probe,
        () => false,
        () => false,
      ),
    ).toBe('source_ability');
  });

  it('keeps shared fear exact while leaving mob-authored prefix IDs generic', () => {
    expect(resolve('fear_incap', 'incapacitate')).toBe('fear_incap');
    expect(auraImageUrl('fear_incap')).toBe('/ui/auras/fear_incap.webp');
    expect(resolve('blind_willow_sprite', 'blind')).toBe('aura_blind');
    expect(resolve('silence_abyssal_horror', 'silence')).toBe('aura_silence');
  });

  it('falls back to the generic aura-kind identity when no authored identity exists', () => {
    expect(resolve('unknown_runtime_aura', 'buff_ap_pct')).toBe('aura_buff_ap_pct');
    for (const hostile of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(resolve(hostile, 'buff'), hostile).toBe('aura_buff');
    }
  });

  it('caches stable wire identities before they return to the frame path', () => {
    let abilityProbes = 0;
    let recipeProbes = 0;
    let auraImageProbes = 0;
    const cached = createAuraIconResolver(
      (id) => {
        abilityProbes++;
        return id === 'painted_source';
      },
      () => {
        recipeProbes++;
        return false;
      },
      (id) => {
        auraImageProbes++;
        return id === 'painted_aura';
      },
    );

    expect(cached({ id: 'painted_source_ap', kind: 'buff_ap' })).toBe('painted_source');
    expect(cached({ id: 'painted_aura', kind: 'debuff' })).toBe('painted_aura');
    const firstCounts = [abilityProbes, recipeProbes, auraImageProbes];
    for (let frame = 0; frame < 120; frame++) {
      expect(cached({ id: 'painted_source_ap', kind: 'buff_ap' })).toBe('painted_source');
      expect(cached({ id: 'painted_aura', kind: 'debuff' })).toBe('painted_aura');
    }
    expect([abilityProbes, recipeProbes, auraImageProbes]).toEqual(firstCounts);

    // A server changing the kind for the same id must recompute the generic
    // identity instead of returning the stale kind-specific fallback.
    expect(cached({ id: 'unknown', kind: 'blind' })).toBe('aura_blind');
    expect(cached({ id: 'unknown', kind: 'silence' })).toBe('aura_silence');
  });

  it('bounds the frame-path identity cache and evicts the oldest wire id first', () => {
    let probes = 0;
    const cached = createAuraIconResolver(
      () => {
        probes++;
        return false;
      },
      () => {
        probes++;
        return false;
      },
      () => {
        probes++;
        return false;
      },
    );
    for (let index = 0; index <= 256; index++) {
      cached({ id: `server_aura_${index}`, kind: 'buff' });
    }
    const afterFill = probes;
    cached({ id: 'server_aura_1', kind: 'buff' });
    expect(probes, 'a retained identity must stay cache-hot').toBe(afterFill);
    cached({ id: 'server_aura_0', kind: 'buff' });
    expect(probes, 'the oldest identity must be recomputed after the 257th insert').toBeGreaterThan(
      afterFill,
    );
  });

  it('layers painted art over warmed fallback without synchronously composing on cold caches', () => {
    let demandCalls = 0;
    expect(
      auraIconCssBackground(
        'counter_shot',
        (id) => `/ui/skills/hunter/${id}.webp`,
        () => 'data:image/png;base64,fallback',
        '/ui/crests/status/combat.webp',
        () => {
          demandCalls++;
          return 'data:image/png;base64,demand';
        },
      ),
    ).toBe('url(/ui/skills/hunter/counter_shot.webp), url(data:image/png;base64,fallback)');
    expect(
      auraIconCssBackground(
        'counter_shot',
        (id) => `/ui/skills/hunter/${id}.webp`,
        () => null,
        '/ui/crests/status/combat.webp',
        () => {
          demandCalls++;
          return 'data:image/png;base64,demand';
        },
      ),
    ).toBe('url(/ui/skills/hunter/counter_shot.webp), url(/ui/crests/status/combat.webp)');
    expect(demandCalls).toBe(0);

    expect(
      auraIconCssBackground(
        'aura_lockout',
        () => null,
        () => 'data:image/png;base64,warmed-generic',
        '/ui/crests/status/combat.webp',
        () => {
          demandCalls++;
          return 'data:image/png;base64,demand';
        },
      ),
    ).toBe('url(data:image/png;base64,warmed-generic)');
    expect(demandCalls).toBe(0);

    expect(
      auraIconCssBackground(
        'aura_lockout',
        () => null,
        () => null,
        '/ui/crests/status/combat.webp',
        () => {
          demandCalls++;
          return 'data:image/png;base64,generic';
        },
      ),
    ).toBe('url(data:image/png;base64,generic)');
    expect(demandCalls).toBe(1);
  });

  it('wires the cached identity and layered URL resolvers into every HUD aura surface', () => {
    const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    const runtime = readFileSync(
      new URL('../src/ui/aura_icon_runtime.ts', import.meta.url),
      'utf8',
    );
    expect(hud.match(/iconId: resolveHudAuraIconId/g)).toHaveLength(2);
    expect(hud.match(/resolveIconUrl: resolveHudAuraIconUrl/g)).toHaveLength(3);
    expect(runtime).toMatch(
      /createAuraIconResolver\(\s*hasAbilityIconIdentity,\s*hasAuraRecipe,\s*hasAuraImageIdentity,\s*\)/,
    );
    expect(runtime).toContain("(id) => cachedProceduralIconDataUrl('aura', id)");
    expect(runtime).toContain("crestIconUrl('status_combat')");
  });
});
