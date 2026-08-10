import { describe, expect, it } from 'vitest';
import {
  type AuraEffectInput,
  auraEffectDescriptor,
  auraEffectMaximumFractionDigits,
} from '../src/ui/aura_effect';
import { hudChromeStrings } from '../src/ui/i18n.catalog/hud_chrome';

const desc = (a: AuraEffectInput) => auraEffectDescriptor(a);

describe('auraEffectDescriptor', () => {
  it('describes the cancelable protective Hourglass aura', () => {
    expect(desc({ id: 'temporal_hourglass', kind: 'stasis', value: 1.5 })).toEqual({
      key: 'hudChrome.auraEffect.temporalHourglass',
      nums: {},
    });
  });

  it('describes a damage-over-time with value, school and interval', () => {
    expect(desc({ kind: 'dot', value: 15, tickInterval: 3, school: 'shadow' })).toEqual({
      key: 'hudChrome.auraEffect.dot',
      nums: { value: 15, interval: 3 },
      school: 'shadow',
    });
  });

  it('defaults the dot tick interval to 1 when absent', () => {
    expect(desc({ kind: 'dot', value: 8, school: 'fire' })?.nums).toEqual({
      value: 8,
      interval: 1,
    });
  });

  it('describes a heal-over-time without a school', () => {
    const d = desc({ kind: 'hot', value: 20, tickInterval: 2 });
    expect(d).toEqual({ key: 'hudChrome.auraEffect.hot', nums: { value: 20, interval: 2 } });
    expect(d?.school).toBeUndefined();
  });

  it('describes Mending Current as a whole pool and its relative party-frame size', () => {
    expect(desc({ id: 'shaman_mending_current', kind: 'hot', value: 300 })).toEqual({
      key: 'hudChrome.auraEffect.mendingCurrent',
      nums: { value: 300 },
    });
    expect(desc({ id: 'shaman_mending_current', kind: 'hot', value: 300, poolPct: 30 })).toEqual({
      key: 'hudChrome.auraEffect.mendingCurrentPercent',
      nums: { pct: 30 },
    });
  });

  it('shows the current Pack Ferocity stack and total pet damage bonus', () => {
    expect(desc({ kind: 'hunter_ferocity', value: 2, stacks: 2 })).toEqual({
      key: 'hudChrome.auraEffect.hunterFerocity',
      nums: { stacks: 2, pct: 20 },
    });
  });

  it('describes both spell choices offered by Radiant Resonance', () => {
    expect(desc({ kind: 'paladin_radiant_resonance', value: 0.5 })).toEqual({
      key: 'hudChrome.auraEffect.radiantResonance',
      nums: { pct: 50, castTime: 1.5 },
    });
    expect(hudChromeStrings.auraEffect.radiantResonance).toBe(
      "Your next Mending Light is instant, or your next Dawn's Embrace costs {pct}% less mana and casts in {castTime} sec",
    );
    expect(auraEffectMaximumFractionDigits(50)).toBe(0);
    expect(auraEffectMaximumFractionDigits(1.5)).toBe(1);
  });

  it('describes all three choices offered by Solar Reprisal', () => {
    expect(desc({ kind: 'paladin_solar_reprisal', value: 0.2 })).toEqual({
      key: 'hudChrome.auraEffect.solarReprisal',
      nums: { pct: 20 },
    });
    expect(hudChromeStrings.auraEffect.solarReprisal).toBe(
      'Your next Sunward Disc costs no mana, ignores its cooldown, and deals {pct}% more damage; Hammer of Grace ignores its cooldown and heals for 100% of damage dealt; or Mending Light is instant',
    );
  });

  it("describes Dawn's Wrath as a stored empowered Hammer cast", () => {
    expect(desc({ kind: 'paladin_dawns_wrath', value: 0.2 })).toEqual({
      key: 'hudChrome.auraEffect.dawnsWrath',
      nums: { pct: 20 },
    });
    expect(hudChromeStrings.auraEffect.dawnsWrath).toBe(
      'HoW: all HP · +1 use · CD 0 · +{pct}% DMG',
    );
  });

  it('teaches every visible Druid engine bank and its live stage', () => {
    expect(desc({ id: 'moontide', kind: 'moontide', value: 0, stacks: 2 })).toEqual({
      key: 'hudChrome.auraEffect.moontide',
      nums: { stacks: 2, max: 3 },
    });
    expect(desc({ id: 'old_blood', kind: 'old_blood', value: 0, stacks: 3 })).toEqual({
      key: 'hudChrome.auraEffect.oldBlood',
      nums: { stacks: 3, max: 3 },
    });
    expect(desc({ id: 'verdance', kind: 'verdance', value: 0, stacks: 5 })).toEqual({
      key: 'hudChrome.auraEffect.verdance',
      nums: { stacks: 5, max: 5 },
    });
  });

  it('reports a movement slow as a percent reduction from the multiplier', () => {
    expect(desc({ kind: 'slow', value: 0.5 })).toEqual({
      key: 'hudChrome.auraEffect.slow',
      nums: { pct: 50 },
    });
  });

  it('reports a movement speed buff as a percent increase (absolute multiplier)', () => {
    expect(desc({ kind: 'buff_speed', value: 1.4 })).toEqual({
      key: 'hudChrome.auraEffect.speed',
      nums: { pct: 40 },
    });
  });

  it('describes Fireball Form without calling it the Druid travel form', () => {
    expect(desc({ kind: 'form_fireball', value: 1.4 })).toEqual({
      key: 'hudChrome.auraEffect.formFireball',
      nums: { pct: 40 },
    });
  });

  it('describes both Moonwing Form bonuses', () => {
    expect(desc({ kind: 'form_moonkin', value: 0 })).toEqual({
      key: 'hudChrome.auraEffect.formMoonkin',
      nums: { pct: 20, armorPct: 50 },
    });
  });

  it('safely omits an effect line for a future wire aura kind', () => {
    expect(desc({ kind: 'future_aura', value: 1 } as unknown as AuraEffectInput)).toBeNull();
  });

  it('distinguishes attack-speed slow from haste by the multiplier', () => {
    expect(desc({ kind: 'attackspeed', value: 1.2 })?.key).toBe(
      'hudChrome.auraEffect.attackSpeedSlow',
    );
    expect(desc({ kind: 'attackspeed', value: 0.8 })?.key).toBe(
      'hudChrome.auraEffect.attackSpeedFast',
    );
  });

  it('routes a positive stat buff to increase and a negative one to reduce', () => {
    expect(desc({ kind: 'buff_ap', value: 50 })).toEqual({
      key: 'hudChrome.auraEffect.increase.ap',
      nums: { value: 50 },
    });
    // A negative-value buff_* aura is a debuff (e.g. a curse sapping attack power).
    expect(desc({ kind: 'buff_ap', value: -30 })).toEqual({
      key: 'hudChrome.auraEffect.reduce.ap',
      nums: { value: 30 },
    });
  });

  it('always reduces for the dedicated debuff_ap kind regardless of value sign', () => {
    expect(desc({ kind: 'debuff_ap', value: 25 })).toEqual({
      key: 'hudChrome.auraEffect.reduce.ap',
      nums: { value: 25 },
    });
  });

  it('shows Sunder Armor as a percent reduction scaling with stacks', () => {
    // Sunder is now a PERCENT debuff (2% per stack); the aura value carries the threat
    // constant and is ignored for the tooltip. 5 stacks = 10%.
    expect(desc({ kind: 'sunder', value: 170, stacks: 5 })).toEqual({
      key: 'hudChrome.auraEffect.armorPctStacks',
      nums: { pct: 10, stacks: 5 },
    });
    expect(desc({ kind: 'sunder', value: 25, stacks: 1 })).toEqual({
      key: 'hudChrome.auraEffect.armorPct',
      nums: { pct: 2 },
    });
  });

  it('shows Faerie Fire as a fixed percent armor reduction', () => {
    expect(desc({ kind: 'faerie_fire', value: 0 })).toEqual({
      key: 'hudChrome.auraEffect.armorPct',
      nums: { pct: 10 },
    });
  });

  it('shows mob corrosion as a flat, stacking armor shred', () => {
    expect(desc({ kind: 'corrode', value: 30, stacks: 3 })).toEqual({
      key: 'hudChrome.auraEffect.armorFlatStacks',
      nums: { value: 90, stacks: 3 },
    });
    expect(desc({ kind: 'corrode', value: 6, stacks: 1 })).toEqual({
      key: 'hudChrome.auraEffect.armorFlat',
      nums: { value: 6 },
    });
  });

  it('shows the percent raid buffs as +N% stat lines', () => {
    expect(desc({ kind: 'buff_int_pct', value: 5 })).toEqual({
      key: 'hudChrome.auraEffect.increasePct.int',
      nums: { pct: 5 },
    });
    expect(desc({ kind: 'buff_ap_pct', value: 10 })).toEqual({
      key: 'hudChrome.auraEffect.increasePct.ap',
      nums: { pct: 10 },
    });
    expect(desc({ kind: 'buff_stats_pct', value: 5 })).toEqual({
      key: 'hudChrome.auraEffect.increasePct.allStats',
      nums: { pct: 5 },
    });
    expect(desc({ kind: 'buff_armor_pct', value: 10 })).toEqual({
      key: 'hudChrome.auraEffect.increasePct.armor',
      nums: { pct: 10 },
    });
    expect(desc({ kind: 'buff_sta_pct', value: 5 })).toEqual({
      key: 'hudChrome.auraEffect.increasePct.sta',
      nums: { pct: 5 },
    });
  });

  it('reports the expose mob affix as increased physical damage taken', () => {
    expect(desc({ kind: 'expose', value: 0.15 })).toEqual({
      key: 'hudChrome.auraEffect.physVuln',
      nums: { pct: 15 },
    });
  });

  it('reports hex as an outgoing damage/healing reduction, not crowd control', () => {
    expect(desc({ kind: 'hex', value: 0.3 })).toEqual({
      key: 'hudChrome.auraEffect.hex',
      nums: { pct: 30 },
    });
  });

  it('picks dodge direction by sign (staggerHit applies a negative buff_dodge)', () => {
    expect(desc({ kind: 'buff_dodge', value: 0.1 })).toEqual({
      key: 'hudChrome.auraEffect.dodge',
      nums: { pct: 10 },
    });
    expect(desc({ kind: 'buff_dodge', value: -0.05 })).toEqual({
      key: 'hudChrome.auraEffect.dodgeReduce',
      nums: { pct: 5 },
    });
  });

  it('describes the tank defensive cooldown auras', () => {
    expect(desc({ kind: 'shield_wall', value: 0.4 })).toEqual({
      key: 'hudChrome.auraEffect.damageReduction',
      nums: { pct: 40 },
    });
    expect(desc({ kind: 'guardian_ward', value: 0.35 })).toEqual({
      key: 'hudChrome.auraEffect.guardianWard',
      nums: { pct: 35 },
    });
  });

  it('summarizes crowd control by the restriction, not a number', () => {
    expect(desc({ kind: 'stun', value: 0 })).toEqual({ key: 'hudChrome.auraEffect.stun' });
    expect(desc({ kind: 'silence', value: 0 })).toEqual({ key: 'hudChrome.auraEffect.silence' });
    expect(desc({ kind: 'root', value: 0 })).toEqual({ key: 'hudChrome.auraEffect.root' });
  });

  it('describes the all-stats percent drain (buff_allstats_pct)', () => {
    expect(desc({ kind: 'buff_allstats_pct', value: -0.75 })).toEqual({
      key: 'hudChrome.auraEffect.allStatsPctReduce',
      nums: { pct: 75 },
    });
  });

  it('describes an active weapon imbue', () => {
    expect(desc({ kind: 'imbue', value: 0 })?.key).toBe('hudChrome.auraEffect.imbue');
  });

  it('teaches the Galeheart Weapon echo mechanic instead of the generic imbue line', () => {
    expect(desc({ id: 'galeheart_weapon', kind: 'imbue', value: 0 })).toEqual({
      key: 'hudChrome.auraEffect.galeheartWeapon',
      nums: { steps: 3, count: 2, pct: 50 },
    });
  });

  it('describes both halves of Elemental Trance (damage reduction and mana return)', () => {
    expect(desc({ id: 'elemental_trance', kind: 'buff_dr', value: 0.3 })).toEqual({
      key: 'hudChrome.auraEffect.elementalTrance',
      nums: { pct: 30, mana: 20 },
    });
  });

  it('describes structural states instead of falling back to a blank effect line', () => {
    expect(desc({ kind: 'righteous_fury', value: 0 })).toEqual({
      key: 'hudChrome.auraEffect.righteousFury',
    });
    expect(desc({ kind: 'lockout', value: 0 })).toEqual({ key: 'hudChrome.auraEffect.lockout' });
  });

  it('surfaces the exact Necromancy and Dominion state carried by visible auras', () => {
    expect(desc({ kind: 'soul_fragments', value: 3, stacks: 3 })).toEqual({
      key: 'hudChrome.auraEffect.resourceCount',
      nums: { value: 3, max: 5 },
    });
    expect(desc({ kind: 'necromancy_ossuary_mark', value: 0.2, value2: 0.5, value3: 6 })).toEqual({
      key: 'hudChrome.auraEffect.necromancyOssuaryMark',
      nums: { storedPct: 20, lancePct: 50, radius: 6 },
    });
    expect(desc({ kind: 'form_lich', value: 1 })).toEqual({
      key: 'hudChrome.auraEffect.formLich',
      nums: { targets: 2, pct: 50 },
    });
    expect(desc({ kind: 'pet_spellhaste', value: 0.2 })).toEqual({
      key: 'hudChrome.auraEffect.petHaste',
      nums: { pct: 20 },
    });
  });

  it('surfaces Affliction and Destruction resources, marks, and offensive windows', () => {
    expect(desc({ kind: 'affliction_doom', value: 64, stacks: 64 })).toEqual({
      key: 'hudChrome.auraEffect.resourceCount',
      nums: { value: 64, max: 100 },
    });
    expect(desc({ kind: 'affliction_judgment', value: 20 })).toEqual({
      key: 'hudChrome.auraEffect.afflictionJudgment',
      nums: { eyePct: 100, sentencePct: 20, refund: 20 },
    });
    expect(desc({ kind: 'desolation', value: 2, stacks: 2 })).toEqual({
      key: 'hudChrome.auraEffect.desolation',
      nums: { charges: 2, castPct: 30 },
    });
    expect(desc({ kind: 'pyre_guardian', value: 0 })).toEqual({
      key: 'hudChrome.auraEffect.pyreGuardian',
      nums: { ruin: 1, ruinInterval: 1, damage: 84, damageInterval: 2, radius: 8 },
    });
  });

  it('describes every formerly blank aura family', () => {
    const inputs: AuraEffectInput[] = [
      { kind: 'stasis', value: 1 },
      { kind: 'pet_damage_pct', value: 100 },
      { kind: 'buff_spellcrit', value: 0.05 },
      { kind: 'buff_spelldmg', value: 0.2 },
      { kind: 'buff_spellhaste', value: 0.2 },
      { kind: 'sated', value: 0 },
      { kind: 'cauterize_fatigue', value: 0 },
      { kind: 'cast_shield', value: 1 },
      { kind: 'form_moonkin', value: 0 },
      { kind: 'form_shadow', value: 15 },
      { kind: 'affliction_eye', value: 1, tickInterval: 2.5 },
      { kind: 'affliction_eye_secondary', value: 0.5 },
      { kind: 'affliction_accomplice', value: 3 },
      { kind: 'affliction_violence', value: 4, value2: 22, charges: 3 },
      { kind: 'affliction_vicarious', value: 15 },
      { kind: 'affliction_possession', value: 1 },
      { kind: 'affliction_litany', value: 30, value2: 8, value3: 4 },
      { kind: 'affliction_fate_threads', value: 3, stacks: 3 },
      { kind: 'affliction_consume_threads', value: 3, stacks: 3 },
      { kind: 'necromancy_harvest_mark', value: 1 },
      { kind: 'necromancy_death_echo', value: 0, value2: 0 },
      { kind: 'warlock_anchor', value: 0, value2: 0, value3: 0 },
      { kind: 'form_metamorph', value: 1 },
      { kind: 'buff_energyregen', value: 1 },
      { kind: 'overpower_charge', value: 0.2, stacks: 2 },
      { kind: 'sweeping_strikes', value: 1 },
      { kind: 'fingers_of_frost', value: 0, stacks: 2 },
      { kind: 'brain_freeze', value: 0 },
      { kind: 'winters_chill', value: 0, charges: 2 },
      { kind: 'icicles', value: 5, stacks: 5 },
      { kind: 'destruction_ruin', value: 4, stacks: 4 },
      { kind: 'ruinous_brand', value: 0.5, stacks: 3 },
      { kind: 'duskfire_claim', value: 1 },
      { kind: 'perfect_moment', value: 0 },
      { kind: 'bleed_vuln', value: 0.4 },
      { kind: 'vuln_source', value: 0.2 },
      { kind: 'next_execute_free', value: 0 },
      { kind: 'resource_sap', value: 20 },
      { kind: 'next_attack_crit', value: 1 },
      { kind: 'heal_echo', value: 60, value2: 0.35 },
      { kind: 'enrage', value: 0.07 },
      { kind: 'sudden_death', value: 1 },
      { kind: 'aoe_echo', value: 0, charges: 2 },
      { kind: 'sure_crit', value: 1, charges: 3 },
      { kind: 'internal_cd', value: 0 },
      { kind: 'temporal_echo', value: 0.35 },
      { kind: 'arcane_charge', value: 4, stacks: 4 },
      { kind: 'buff_dr', value: 0.2 },
      { kind: 'buff_dr_phys', value: 0.5 },
    ];

    for (const input of inputs) {
      expect(desc(input)?.key, input.kind).toMatch(/^hudChrome\.auraEffect\./);
    }
  });

  it('is a pure function: same input gives the same output', () => {
    const input: AuraEffectInput = { kind: 'dot', value: 12, tickInterval: 2, school: 'nature' };
    expect(desc(input)).toEqual(desc(input));
  });

  it('describes the damage-dealt fraction buff as a percent in both directions', () => {
    // Rune of Power / Elemental Convergence: the bearer deals more damage.
    expect(desc({ kind: 'buff_dmg_done', value: 0.1 })).toEqual({
      key: 'hudChrome.auraEffect.dmgDone',
      nums: { pct: 10 },
    });
    // Negative = a demoralize (Direhowl's pct form): the reduce wording.
    expect(desc({ kind: 'buff_dmg_done', value: -0.2 })).toEqual({
      key: 'hudChrome.auraEffect.dmgDoneReduce',
      nums: { pct: 20 },
    });
  });

  it('explains how Heating Up becomes Hot Streak', () => {
    expect(desc({ id: 'heating_up', kind: 'internal_cd', value: 0 })).toEqual({
      key: 'hudChrome.auraEffect.heatingUp',
      nums: {},
    });
  });

  it('teaches the carried-flag buff its right-click-to-drop affordance', () => {
    // The one row that describes an ACTION rather than a stat: without it the
    // voluntary drop is undiscoverable, since nothing else on screen says it.
    expect(desc({ id: 'bg_carried_flag', kind: 'flag_carried', value: 0 })).toEqual({
      key: 'hudChrome.auraEffect.carriedFlag',
      nums: {},
    });
    // The kind alone describes nothing: the id is what earns the line.
    expect(desc({ id: 'some_other_marker', kind: 'flag_carried', value: 0 })).toBeNull();
  });
});
