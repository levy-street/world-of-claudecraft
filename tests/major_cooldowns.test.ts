import { describe, expect, it, vi } from 'vitest';
import { ABILITIES } from '../src/sim/data';
import {
  MAJOR_COOLDOWN_MIN_SEC,
  majorAuraGroup,
  majorBuffTable,
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
});

// The active-only tier: short offensive or defensive buffs from abilities with
// no tracked cooldown (rotation riders such as Red Harvest's Enrage). Shown while
// up, never as spent.
const BUFF_DEFENSIVE = [
  'bastion_rite',
  'ghostly_strike',
  'holy_shield',
  'iron_resolve',
  'power_word_shield',
  'raised_guard',
  'temporal_barrier',
];
const BUFF_OFFENSIVE = ['enrage_passive', 'veilstrike'];

describe('active-only buffs', () => {
  const buffKeys = (group: string) =>
    [...majorBuffTable()]
      .filter(([, g]) => g === group)
      .map(([k]) => k)
      .sort();

  it('admits exactly the agreed short buffs', () => {
    expect(buffKeys('defensive')).toEqual(BUFF_DEFENSIVE);
    expect(buffKeys('offensive')).toEqual(BUFF_OFFENSIVE);
  });

  it('never reaches the cooldown table the wire filters by, so none shows as spent', () => {
    for (const key of [...BUFF_DEFENSIVE, ...BUFF_OFFENSIVE]) {
      expect(majorCooldownGroup(key), key).toBeNull();
      expect(majorAuraGroup(key), key).not.toBeNull();
    }
  });

  it('maps the Enrage every source applies (Red Harvest, Bloodletting) to one slot', () => {
    expect(majorCooldownKeyForAura('fury_enrage')).toBe('enrage_passive');
    expect(majorAuraGroup('enrage_passive')).toBe('offensive');
    // Both rotation attacks really do apply it, at a duration the tier admits.
    for (const id of ['red_harvest', 'bloodthirst']) {
      expect(
        ABILITIES[id].effects.some((e) => e.type === 'enrageChance'),
        id,
      ).toBe(true);
    }
  });

  it('leaves out maintenance buffs, forms, speed and stealth however short the cooldown', () => {
    for (const key of [
      'battle_shout',
      'aspect_of_the_hawk',
      'aspect_of_the_monkey',
      'devotion_aura',
      'cat_form',
      'stealth',
      'scorch',
      'slice_and_dice',
      'mortal_strike',
      'overpower',
    ]) {
      expect(majorAuraGroup(key), key).toBeNull();
    }
  });

  it('maps a short buff aura and its companions back to its ability', () => {
    expect(majorCooldownKeyForAura('raised_guard')).toBe('raised_guard');
    expect(majorCooldownKeyForAura('bastion_rite_buff_dr_phys')).toBe('bastion_rite');
    expect(majorCooldownKeyForAura('power_word_shield')).toBe('power_word_shield');
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
    for (const id of [
      'rend',
      'berserker_rage',
      'sated',
      'dash',
      'stealth_x',
      'constructor',
      'toString',
      '__proto__',
      'evocation',
    ]) {
      const key = majorCooldownKeyForAura(id);
      if (id === 'evocation') expect(key).toBe('evocation');
      else expect(key, id).toBeNull();
    }
  });

  it('never retains dynamic caster ids or unknown negative answers', () => {
    majorCooldownTable(); // Build the finite content classifier before observing writes.
    const writes = vi.spyOn(Map.prototype, 'set');
    let retainedWrites: number;
    try {
      for (let i = 0; i < 2000; i++) {
        if (majorCooldownKeyForAura(`aegis_first_dawn_dr:${i}`) !== 'aegis_first_dawn')
          throw new Error('dynamic tracked aura changed classification');
        if (majorCooldownKeyForAura(`unknown_${i}:caster_${i}`) !== null)
          throw new Error('unknown aura changed classification');
        if (majorCooldownKeyForAura(`unknown_alias_${i}`) !== null)
          throw new Error('unknown alias changed classification');
      }
      retainedWrites = writes.mock.calls.length;
    } finally {
      writes.mockRestore();
    }
    expect(retainedWrites).toBe(0);
    expect(majorCooldownKeyForAura('howling_rage_empower')).toBe('bestial_wrath');
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
