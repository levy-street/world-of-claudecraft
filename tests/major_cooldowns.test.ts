import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/data';
import {
  MAJOR_COOLDOWN_MIN_SEC,
  majorCooldownBaseSec,
  majorCooldownGroup,
  majorCooldownKeyForAura,
  majorCooldownTable,
  PVP_MEDALLION_COOLDOWN_KEY,
} from '../src/sim/major_cooldowns';

// The full roster the nameplate cooldown row tracks, as agreed for the feature.
// A content change that moves an ability in or out of the row must update this
// pin on purpose.
const DEFENSIVE = [
  'aegis_first_dawn',
  'barkskin',
  'blazing_barrier',
  'bone_armor',
  'cinderhide',
  'cloak_of_shadows',
  'dark_pact',
  'desperate_prayer',
  'deterrence',
  'die_by_sword',
  'divine_protection',
  'elemental_trance',
  'evasion',
  'faithforged_guard',
  'frenzied_regeneration',
  'furious_mending',
  'guardian_covenant',
  'ice_barrier',
  'ice_block',
  'lay_on_hands',
  'life_covenant',
  'martyrs_aegis',
  'mass_barrier',
  'primal_reflexes',
  'rallying_cry',
  'sacred_bulwark',
  'sacrifice_undead',
  'shellskin',
  'smoke_screen',
  'wildheart',
];
const OFFENSIVE = [
  'arcane_power',
  'army_of_the_dead',
  'avatar',
  'avenging_wrath',
  'berserk',
  'bestial_wrath',
  'blade_flurry',
  'bloodlust',
  'bloodtrail_assault',
  'cold_blood',
  'combustion',
  'elemental_mastery',
  'emboldening_roar',
  'evocation',
  'feral_charge',
  'icy_veins',
  'metamorphosis',
  'overload',
  'perfect_moment',
  'power_echo',
  'power_infusion',
  'primal_exaltation',
  'recklessness',
  'sanguine_aura',
  'stampede',
  'summon_infernal',
  'summon_tithefiend',
  'temporal_acceleration',
  'thieves_chorus',
  'tigers_fury',
  'unholy_command',
];

function keysIn(group: string): string[] {
  return [...majorCooldownTable()]
    .filter(([, g]) => g === group)
    .map(([k]) => k)
    .sort();
}

describe('major cooldown classifier', () => {
  it('admits exactly the agreed defensive roster', () => {
    expect(keysIn('defensive')).toEqual(DEFENSIVE);
  });

  it('admits exactly the agreed offensive roster', () => {
    expect(keysIn('offensive')).toEqual(OFFENSIVE);
  });

  it('tracks the PvP medallion as its own group, keyed by its trinket cooldown', () => {
    expect(PVP_MEDALLION_COOLDOWN_KEY).toBe('trinket:medallion_of_defiance');
    expect(keysIn('medallion')).toEqual([PVP_MEDALLION_COOLDOWN_KEY]);
    expect(majorCooldownBaseSec(PVP_MEDALLION_COOLDOWN_KEY)).toBe(120);
  });

  it('never admits a cooldown under the minimum, whatever it does', () => {
    for (const key of [...DEFENSIVE, ...OFFENSIVE]) {
      expect(ABILITIES[key].cooldown).toBeGreaterThanOrEqual(MAJOR_COOLDOWN_MIN_SEC);
    }
    // Rotation buttons with defensive or offensive riders stay out.
    expect(majorCooldownGroup('mortal_strike')).toBeNull();
  });

  it('leaves out direct damage, crowd control, group heals, resource grants and mobility', () => {
    for (const key of [
      'fire_blast', // Cinderfall: deals damage, does not raise it
      'storm_bolt', // a stun
      'psychic_scream', // a fear
      'tranquility', // a group heal, not an emergency self-heal
      'choir_of_deliverance',
      'adrenaline_rush', // instant energy
      'innervate', // Lifesap: resource over time
      'enrage',
      'berserker_rage',
      'bloodrage',
      'sprint', // mobility
      'dash',
      'intervene', // a gap closer with a small shield
      'greater_invisibility',
      'veilbound_march',
      'vicarious_suffering',
      'aura_mastery',
      'rune_of_power',
      'sweeping_strikes',
      'cold_focus',
      'presence_of_mind',
      'soulwell',
    ]) {
      expect(majorCooldownGroup(key), key).toBeNull();
    }
  });

  it('counts the emergency self-heals as defensives: a spent one means none left', () => {
    for (const key of [
      'desperate_prayer',
      'wildheart',
      'frenzied_regeneration',
      'lay_on_hands',
      'sacrifice_undead',
    ]) {
      expect(majorCooldownGroup(key), key).toBe('defensive');
    }
  });

  it('answers for the aura a tracked buff leaves, which carries the ability id', () => {
    expect(majorCooldownGroup('barkskin')).toBe('defensive');
    expect(majorCooldownGroup('martyrs_aegis')).toBe('defensive');
    expect(majorCooldownGroup('power_infusion')).toBe('offensive');
  });

  it('reads the base cooldown for the swipe', () => {
    expect(majorCooldownBaseSec('barkskin')).toBe(60);
    expect(majorCooldownBaseSec('recklessness')).toBe(180);
    expect(majorCooldownBaseSec('not_an_ability')).toBe(0);
  });
});

describe('aura id to cooldown key', () => {
  it('maps every form a tracked buff aura takes back to its ability', () => {
    // The bare ability id (selfBuff, buffTarget, absorb, partyMeleeBuff, haste burst).
    expect(majorCooldownKeyForAura('barkskin')).toBe('barkskin');
    expect(majorCooldownKeyForAura('martyrs_aegis')).toBe('martyrs_aegis');
    expect(majorCooldownKeyForAura('perfect_moment')).toBe('perfect_moment');
    expect(majorCooldownKeyForAura('elemental_mastery')).toBe('elemental_mastery');
    // Companions: a second selfBuff kind, a group effect's suffixed id.
    expect(majorCooldownKeyForAura('icy_veins_cast_shield')).toBe('icy_veins');
    expect(majorCooldownKeyForAura('deterrence_buff_dr')).toBe('deterrence');
    expect(majorCooldownKeyForAura('rallying_cry_hp')).toBe('rallying_cry');
    expect(majorCooldownKeyForAura('emboldening_roar_crit')).toBe('emboldening_roar');
    expect(majorCooldownKeyForAura('power_infusion_buff_dmg_done_1')).toBe('power_infusion');
    expect(majorCooldownKeyForAura('bloodlust_spell')).toBe('bloodlust');
    // A per-caster stamp.
    expect(majorCooldownKeyForAura('aegis_first_dawn_dr:42')).toBe('aegis_first_dawn');
    // Handler constants.
    expect(majorCooldownKeyForAura('feral_instinct_energy')).toBe('feral_charge');
    expect(majorCooldownKeyForAura('howling_rage_empower')).toBe('bestial_wrath');
    expect(majorCooldownKeyForAura('shaman_primal_exaltation')).toBe('primal_exaltation');
  });

  it('leaves untracked auras untracked', () => {
    for (const id of ['rend', 'berserker_rage', 'sated', 'dash', 'stealth_x', 'evocation']) {
      const key = majorCooldownKeyForAura(id);
      if (id === 'evocation') expect(key).toBe('evocation');
      else expect(key, id).toBeNull();
    }
  });

  it('agrees with the handler constants it aliases', async () => {
    const { HOWLING_RAGE_EMPOWER_ID } = await import('../src/sim/combat/hunter_packlord');
    const { PRIMAL_EXALTATION_ID } = await import('../src/sim/combat/shaman_talents');
    const { PRIMAL_MASTERY_ID } = await import('../src/sim/combat/shaman_thundercall');
    const { PERFECT_MOMENT_ID } = await import('../src/sim/combat/chronomancy');
    const { PALADIN_AEGIS_ID } = await import('../src/sim/combat/paladin_aegis');
    expect(majorCooldownKeyForAura(HOWLING_RAGE_EMPOWER_ID)).toBe('bestial_wrath');
    expect(majorCooldownKeyForAura(PRIMAL_EXALTATION_ID)).toBe('primal_exaltation');
    expect(majorCooldownKeyForAura(PRIMAL_MASTERY_ID)).toBe('elemental_mastery');
    expect(majorCooldownKeyForAura(PERFECT_MOMENT_ID)).toBe('perfect_moment');
    expect(majorCooldownKeyForAura(`${PALADIN_AEGIS_ID}_dr:7`)).toBe('aegis_first_dawn');
  });
});
