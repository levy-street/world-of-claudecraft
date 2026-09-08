/** Explicit intent by canonical ID. Shared native motion vocabulary has
 * class-specific posture; timing always comes from live cast/channel state. */
export type CastPurpose =
  | 'bolt'
  | 'lance'
  | 'flick'
  | 'call'
  | 'place'
  | 'shape'
  | 'ward'
  | 'self'
  | 'offer'
  | 'embrace'
  | 'pray'
  | 'mark'
  | 'mind'
  | 'hush'
  | 'drain'
  | 'raise'
  | 'command'
  | 'rend'
  | 'breath'
  | 'wave'
  | 'cultivate'
  | 'imbue'
  | 'smear'
  | 'lowstrike'
  | 'brace';
const GROUPS: Readonly<Partial<Record<CastPurpose, string>>> = {
  brace: 'feral_charge iron_resolve furious_mending bloodrage sweeping_strikes battle_stance berserker_stance defensive_stance cold_blood blade_flurry sprint',
  bolt: 'chain_lightning smite fireball frostbolt shadow_bolt lightning_bolt wrath immolate searing_pain',
  lance: 'pyroblast glacial_spike mercy_lance soul_lance needle_of_fate chaos_bolt sunlance',
  flick:
    'venom_dart melting_acid scorch fire_blast ice_lance flurry conflagrate shadowburn flame_shock frost_shock',
  call: 'hour_of_judgment blizzard flamestrike meteor starfire rain_of_fire summon_infernal sun_gods_verdict valkyrs_calling',
  place: 'smoke_screen rings_of_frost rune_of_power temporal_hourglass soulwell evil_eye earthbind consecration',
  shape:
    'conjure_food conjure_water polymorph frozen_orb temporal_echo temporal_cascade arcane_surge arcane_missiles',
  ward: 'shellskin frost_armor temporal_barrier blazing_barrier ice_barrier mass_barrier power_word_shield seraphic_vigil martyrs_aegis demon_skin bone_armor cinderhide lightning_shield stoneward thorns barkskin mark_of_the_wild divine_protection holy_shield bastion_rite devotion_ward faithforged_guard aegis_first_dawn guardian_covenant',
  self: 'bestial_wrath cold_focus bloodtrail_assault wildheart arcane_intellect ice_floes ignition hot_streak fingers_of_frost brain_freeze greater_invisibility perfect_moment fireball_form ice_block combustion icy_veins power_echo overload presence_of_mind cold_snap temporal_acceleration blink shadowform veilstep inner_focus desperate_prayer metamorphosis umbral_anchor sacrilegious_march vicarious_suffering cruel_pact dark_pact possess_evil_eye ghost_wolf thunder_reservoir elemental_mastery warspirit_cadence primal_exaltation stormsurge elemental_trance cat_form bear_form moonkin_form travel_form frenzied_regeneration enrage berserk prowl dash tigers_fury primal_reflexes divine_ascension dawn_devotion sacred_form righteous_fury grace_devotion radiant_devotion avenging_wrath veilbound_march solar_step retribution_aura',
  offer:
    'holy_light renew rejuvenation swiftmend tidecall healing_wave chain_heal temporal_mend temporal_reversal temporal_rewind lay_on_hands',
  embrace:
    'prayer_of_healing choir_of_deliverance dawns_embrace radiant_chorus tranquility holy_nova arcane_explosion frost_nova glacial_front typhoon',
  pray: 'revive_pet lesser_heal heal flash_heal recall_the_fallen collective_reversal ancestor_return',
  mark: 'shadow_word_pain corruption curse_of_agony maledict_gaze sentence litany_of_guilt hex_of_violence ossuary_mark ruinous_brand moonfire moonseed faerie_fire power_infusion power_word_fortitude solar_invocation beacon_of_light life_covenant sacred_challenge',
  mind: 'mind_blast mind_flay fear psychic_scream howl_of_terror',
  hush: 'silence counterspell spell_lock hushbrand',
  drain: 'drain_life life_tap evocation innervate',
  raise:
    'summon_imp summon_voidwalker summon_water_elemental summon_tithefiend raise_graveguard raise_skeletal_warrior raise_bone_mage raise_gravewing army_of_the_dead',
  command:
    'tame_beast stampede pack_rally unholy_command reaping_command cursed_accomplice coven bloodlust aura_mastery',
  rend: 'soul_harvest funeral_harvest sacrifice_undead corpse_explosion abyssal_rift shatter moonlash overbloom',
  breath: 'dragons_breath',
  wave: 'hurricane earthquake earth_shock scouring_mercy hammer_of_grace hammer_of_justice hammer_of_wrath sunward_disc oath_chain',
  cultivate: 'healing_touch regrowth entangling_roots hibernate insect_swarm',
  smear: 'nightshade_coating',
  lowstrike: 'crippling_poison',
  imbue:
    'instant_poison deadly_poison rockbiter_weapon flametongue_weapon galeheart_weapon lifespring_weapon unleash_weapon',
};
export const CAST_PERFORMANCES: Readonly<Record<string, CastPurpose>> = Object.freeze(
  Object.fromEntries(
    Object.entries(GROUPS).flatMap(([purpose, ids]) =>
      ids.split(' ').map((id) => [id, purpose as CastPurpose]),
    ),
  ),
);
export function castClass(key: string): string | null {
  const cls = key.replace(/^player_/, '').replace(/_modular$/, '');
  if (key === 'form_moonkin') return 'druid';
  return ['mage', 'priest', 'warlock', 'shaman', 'druid', 'paladin', 'hunter', 'rogue', 'warrior'].includes(
    cls,
  )
    ? cls
    : null;
}

// These primary nonprojectile impacts have no separate successful spellfx cue.
export const DAMAGE_CAST_RELEASES = new Set([
  'scorch',
  'arcane_surge',
  'mercy_lance',
  'fire_blast',
]);
