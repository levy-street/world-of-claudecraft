// ---------------------------------------------------------------------------
// Specialization identities and masteries for the eight non-Warrior classes.
// Their class-wide choice rows live in choice_rows_classic.ts.
// ---------------------------------------------------------------------------

import type { PlayerClass } from '../types';
import type { ClassTalents, Role, SpecDef, TalentEffect } from './talents';

function spec(
  id: string,
  cls: PlayerClass,
  name: string,
  role: Role,
  icon: string,
  description: string,
  signature: string,
  masteryName: string,
  masteryDescription: string,
  effect: TalentEffect,
): SpecDef {
  return {
    id,
    class: cls,
    name,
    role,
    icon,
    description,
    signature,
    mastery: { name: masteryName, description: masteryDescription, effect },
  };
}

const PALADIN_SPECS: SpecDef[] = [
  spec(
    'holy',
    'paladin',
    'Sacrament',
    'healer',
    '+',
    'A devoted healer who turns the Light into steady single-target recovery.',
    'holy_shock',
    'Kindled Faith',
    'Your healing spells critically heal for double.',
    { global: { critDmgHealPct: 0.5 } },
  ),
  spec(
    'protection',
    'paladin',
    'Vigil',
    'tank',
    '#',
    'A shield-bearing defender who converts Holy power into threat and mitigation.',
    'holy_shield',
    'Oathward',
    'Increases all threat you generate by 50% and your armor by 20%.',
    { global: { threatPct: 0.5 }, stats: { armorPct: 0.2 } },
  ),
  spec(
    'retribution',
    'paladin',
    'Requital',
    'dps',
    'x',
    'A holy warrior who judges enemies with weapon strikes and radiant burst.',
    'crusader_strike',
    'Blood Debt',
    "Each landed melee auto-attack and Crusader Strike has a 20% chance to clear Rite of Expulsion's cooldown and make your next Rite of Expulsion free for 8 sec. Increases your Holy and physical ability damage by 20%.",
    {
      global: { meleeDmgPct: 0.2, spellDmgPct: 0.2 },
      proc: {
        id: 'pal_blood_debt',
        name: 'Blood Debt',
        spec: 'retribution',
        requiresKnownAbility: 'exorcism',
        school: 'holy',
        trigger: {
          on: 'meleeHit',
          abilities: ['auto_attack', 'crusader_strike'],
          chance: 0.2,
          chanceWhenEmpowered: {
            ability: 'crusader_strike',
            auraId: 'pal_oaths_due',
            chance: 0.7,
          },
        },
        responses: [
          { kind: 'cooldownRefund', ability: 'exorcism', seconds: 'reset' },
          {
            kind: 'empowerNext',
            aura: 'next_cast_free',
            abilities: ['exorcism'],
            duration: 8,
          },
        ],
      },
    },
  ),
];

const HUNTER_SPECS: SpecDef[] = [
  spec(
    'beast_mastery',
    'hunter',
    'Packlord',
    'dps',
    '+',
    'A wild commander who fights beside a durable companion.',
    'bestial_wrath',
    'Packbond',
    'Your pet deals 20% more damage and you gain 8% maximum health. Every 3rd landed pet attack reduces Howling Rage cooldown by 4 sec and makes your next Fell Shot within 8 sec free.',
    {
      global: { petDmgPct: 0.2 },
      stats: { maxHpPct: 0.08 },
      proc: {
        id: 'hun_packbond',
        name: 'Packbond',
        spec: 'beast_mastery',
        requiresKnownAbility: 'bestial_wrath',
        school: 'nature',
        trigger: { on: 'petHitNth', n: 3 },
        responses: [
          { kind: 'cooldownRefund', ability: 'bestial_wrath', seconds: 4 },
          {
            kind: 'empowerNext',
            aura: 'next_cast_free',
            abilities: ['arcane_shot'],
            duration: 8,
          },
        ],
      },
    },
  ),
  spec(
    'marksmanship',
    'hunter',
    'Coldsight',
    'dps',
    'x',
    'A precise archer built around ranged burst and efficient shots.',
    'trueshot_aura',
    'Iron Aim',
    'Increases your ranged ability damage by 10% and critical strike chance by 3%. A landed Rattling Shot makes your next Long Draw within 8 sec instant.',
    {
      ability: [
        { ability: 'serpent_sting', dmgPct: 0.1 },
        { ability: 'arcane_shot', dmgPct: 0.1 },
        { ability: 'concussive_shot', dmgPct: 0.1 },
        { ability: 'aimed_shot', dmgPct: 0.1 },
        { ability: 'multi_shot', dmgPct: 0.1 },
        { ability: 'volley', dmgPct: 0.1 },
      ],
      stats: { crit: 0.03 },
      proc: {
        id: 'hun_iron_aim',
        name: 'Iron Aim',
        spec: 'marksmanship',
        requiresKnownAbility: 'aimed_shot',
        school: 'physical',
        trigger: { on: 'rangedHit', abilities: ['concussive_shot'] },
        responses: [
          {
            kind: 'empowerNext',
            aura: 'next_cast_instant',
            abilities: ['aimed_shot'],
            duration: 8,
          },
        ],
      },
    },
  ),
  spec(
    'survival',
    'hunter',
    'Fieldcraft',
    'dps',
    'o',
    'A skirmisher who controls distance and survives close pressure.',
    'wyvern_sting',
    'Quickblood',
    'Increases your Agility and physical ability damage by 5%. Briar Trap and Rime Snare make your next Gutting Strike within 12 sec deal 50% more damage. A landed Gutting Strike restores 10 mana and reduces Briar Trap cooldown by 8 sec.',
    {
      global: { meleeDmgPct: 0.05 },
      stats: { agiPct: 0.05 },
      procs: [
        {
          id: 'hun_quickblood_setup',
          name: 'Quickblood',
          spec: 'survival',
          requiresKnownAbility: 'wyvern_sting',
          school: 'nature',
          trigger: { on: 'castNth', n: 1, abilities: ['wyvern_sting', 'frost_trap'] },
          responses: [
            {
              kind: 'empowerNext',
              aura: 'next_ability_damage',
              abilities: ['raptor_strike'],
              duration: 12,
              dmgPct: 0.5,
            },
          ],
        },
        {
          id: 'hun_quickblood_return',
          name: 'Quickblood',
          spec: 'survival',
          requiresKnownAbility: 'wyvern_sting',
          school: 'physical',
          trigger: { on: 'meleeHit', abilities: ['raptor_strike'] },
          responses: [
            { kind: 'resource', amount: 10 },
            { kind: 'cooldownRefund', ability: 'wyvern_sting', seconds: 8 },
          ],
        },
      ],
    },
  ),
];

const MAGE_SPECS: SpecDef[] = [
  spec(
    'arcane',
    'mage',
    'Aethermancy',
    'dps',
    '*',
    'A precision caster using mana efficiency and focused arcane barrages.',
    'arcane_power',
    'Aetheric Flux',
    'Increases your spell damage by 15% and your spell haste by 10%.',
    { global: { spellDmgPct: 0.15, spellHastePct: 0.1 } },
  ),
  spec(
    'fire',
    'mage',
    'Pyromancy',
    'dps',
    'x',
    'A volatile caster built around fast, high-damage Fire spells.',
    'combustion',
    'Afterflame',
    'Your spell critical strikes deal double damage. Increases critical strike chance by 2%.',
    { global: { critDmgSpellPct: 0.5 }, stats: { crit: 0.02 } },
  ),
  spec(
    'frost',
    'mage',
    'Cryomancy',
    'dps',
    '#',
    'A controlling caster who trades peak burst for survival and slows.',
    'icy_veins',
    'Brittlebreak',
    'Increases your Frost spell damage by 25% and armor by 10%. Rimelance hits store an Icicle, up to 5, and have a 15% chance to grant Frostbite for 15 sec. Grants Icefall, which consumes the Icicles for fixed damage that cannot critically strike: 8 Frost damage each, or 20 each against a rooted or stunned target or while Frostbite is active. Icefall consumes Frostbite.',
    // The scalable mastery axis is the Frost-kit damage (ability-scoped so the
    // mage's fire/arcane baseline spells stay untouched); armor is the static
    // secondary. Crit-vs-rooted identity returns as a Shatter-style row option.
    {
      ability: [
        { ability: 'frostbolt', dmgPct: 0.25 },
        { ability: 'frost_nova', dmgPct: 0.25 },
      ],
      stats: { armorPct: 0.1 },
      grant: { ability: 'icefall' },
      proc: {
        id: 'mag_icicles',
        name: 'Icicles',
        school: 'frost',
        trigger: { on: 'spellHit', abilities: ['frostbolt'] },
        responses: [
          { kind: 'stackAura', aura: 'icicles', maxStacks: 5, duration: 3600 },
          {
            kind: 'chanceAura',
            id: 'mag_frostbite',
            name: 'Frostbite',
            aura: 'frostbite',
            chance: 0.15,
            duration: 15,
            charges: 1,
          },
        ],
      },
    },
  ),
];

const ROGUE_SPECS: SpecDef[] = [
  spec(
    'assassination',
    'rogue',
    'Knifework',
    'dps',
    'x',
    'A burst specialist using critical strikes and finishers.',
    'cold_blood',
    'Redhanded',
    'Increases your bleed damage by 20% and critical strike chance by 3%. Landing Leaden Venom makes your next Dirt Nap or Bleed Out within 8 sec free.',
    {
      global: { dotDmgPct: 0.2 },
      stats: { crit: 0.03 },
      proc: {
        id: 'rog_redhanded',
        name: 'Redhanded',
        spec: 'assassination',
        requiresKnownAbility: 'crippling_poison',
        school: 'nature',
        trigger: { on: 'spellHit', abilities: ['crippling_poison'] },
        responses: [
          {
            kind: 'empowerNext',
            aura: 'next_cast_free',
            abilities: ['eviscerate', 'rupture'],
            duration: 8,
          },
        ],
      },
    },
  ),
  spec(
    'combat',
    'rogue',
    'Thuggery',
    'dps',
    '/',
    'A sustained fighter focused on direct weapon strikes.',
    'blade_flurry',
    "Scrapper's Edge",
    'Increases attack speed by 10% and reduces melee ability damage by 10%.',
    { global: { meleeHastePct: 0.1, meleeDmgPct: -0.1 } },
  ),
  spec(
    'subtlety',
    'rogue',
    'Skulduggery',
    'dps',
    '>',
    'A stealth attacker built around openers, control, and avoidance.',
    'hemorrhage',
    'False Face',
    'Increases the damage of your critical strikes by 40% and your Agility by 10%.',
    { global: { critDmgPhysPct: 0.4 }, stats: { agiPct: 0.1 } },
  ),
];

const PRIEST_SPECS: SpecDef[] = [
  spec(
    'discipline',
    'priest',
    'Doctrine',
    'healer',
    '#',
    'A mitigator who shields allies and heals through controlled efficiency.',
    'power_infusion',
    'Fixed Purpose',
    'Your shields absorb 30% more. Increases maximum health by 8%.',
    { global: { absorbPct: 0.3 }, stats: { maxHpPct: 0.08 } },
  ),
  spec(
    'holy',
    'priest',
    'Benison',
    'healer',
    '+',
    'A direct healer with strong throughput and restorative prayers.',
    'holy_nova',
    'Grave Mercy',
    'Increases all healing you do by 20%.',
    { global: { healPct: 0.2 } },
  ),
  spec(
    'shadow',
    'priest',
    'Vespers',
    'dps',
    '*',
    'A damage caster built around Shadow damage over time and mind spells.',
    'shadowform',
    'Gloamveil',
    'Increases your damage-over-time damage by 15% and your spell damage by 10%.',
    { global: { dotDmgPct: 0.15, spellDmgPct: 0.1 } },
  ),
];

const SHAMAN_SPECS: SpecDef[] = [
  spec(
    'elemental',
    'shaman',
    'Thundercall',
    'dps',
    '*',
    'A ranged caster who calls lightning, flame, and frost.',
    'elemental_mastery',
    'Earthen Fury',
    'Increases your spell damage by 15% and your spell haste by 10%.',
    { global: { spellDmgPct: 0.15, spellHastePct: 0.1 } },
  ),
  spec(
    'enhancement',
    'shaman',
    'Warspirit',
    'dps',
    'x',
    'A weapon fighter who channels the storm through melee swings.',
    'stormstrike',
    'Skyrend',
    'Each landed melee auto-attack and Ancestral Strike builds Skyrend, up to 5 stacks. Each stack shortens your next Arc Bolt cast by 20% and increases its damage by 10%. Arc Bolt consumes every stack, becoming instant at 5. Increases your melee attack speed by 10% and your physical ability damage by 10%.',
    {
      global: { meleeHastePct: 0.1, meleeDmgPct: 0.1 },
      proc: {
        id: 'sha_skyrend',
        name: 'Skyrend',
        school: 'nature',
        trigger: { on: 'meleeHit', abilities: ['auto_attack', 'stormstrike'] },
        responses: [{ kind: 'stackAura', aura: 'stormcharge', maxStacks: 5, duration: 30 }],
      },
    },
  ),
  spec(
    'restoration',
    'shaman',
    'Spiritmend',
    'healer',
    '+',
    'A healer using ancestral waves and efficient nature magic.',
    'chain_heal',
    'Cleansing Tides',
    'Your healing spells cost 20% less mana.',
    {
      ability: [
        { ability: 'chain_heal', costPct: -0.2 },
        { ability: 'healing_wave', costPct: -0.2 },
      ],
    },
  ),
];

const WARLOCK_SPECS: SpecDef[] = [
  spec(
    'affliction',
    'warlock',
    'Hexcraft',
    'dps',
    '*',
    'A curse-weaver using damage over time and drains.',
    'siphon_life',
    'Creeping Rot',
    'Your damage-over-time effects deal 20% more damage.',
    { global: { dotDmgPct: 0.2 } },
  ),
  spec(
    'demonology',
    'warlock',
    'Pactbound',
    'dps',
    '+',
    'A durable warlock who survives through demonic resilience.',
    'metamorphosis',
    'Fiendlore',
    '20% of damage you take is redirected to your demon. Increases Stamina by 10%.',
    { global: { petDmgSharePct: 0.2 }, stats: { staPct: 0.1 } },
  ),
  spec(
    'destruction',
    'warlock',
    'Ruination',
    'dps',
    'x',
    'A burst caster using Gloom Bolt, fire, and Duskfire.',
    'conflagrate',
    'Desolation',
    'Your Fire spell critical strikes deal double damage, and ' +
      'your critical strike chance is increased by 2%.',
    { global: { critDmgSpellPct: 0.5 }, stats: { crit: 0.02 } },
  ),
];

const DRUID_SPECS: SpecDef[] = [
  spec(
    'balance',
    'druid',
    'Moongrove',
    'dps',
    '*',
    'A caster who uses lunar and nature magic from range.',
    'moonkin_form',
    'Moonrage',
    'Increases your spell damage by 15% and your spell haste by 10%.',
    { global: { spellDmgPct: 0.15, spellHastePct: 0.1 } },
  ),
  spec(
    'feral',
    'druid',
    'Wildfang',
    'tank',
    'x',
    'A shapeshifter who tanks in bear form and fights up close.',
    'feral_charge',
    'Primal Heart',
    'Increases your physical ability damage by 15%, your bleed damage by 15%, and threat by 20%.',
    { global: { meleeDmgPct: 0.15, dotDmgPct: 0.15, threatPct: 0.2 } },
  ),
  spec(
    'restoration',
    'druid',
    'Groveheart',
    'healer',
    '+',
    'A healer using heal-over-time effects and efficient nature magic.',
    'swiftmend',
    "Grove's Gift",
    'Your heal-over-time effects heal 25% more.',
    { global: { hotHealPct: 0.25 } },
  ),
];

export const PALADIN_TALENTS: ClassTalents = {
  class: 'paladin',
  specs: PALADIN_SPECS,
};
export const HUNTER_TALENTS: ClassTalents = {
  class: 'hunter',
  specs: HUNTER_SPECS,
};
export const MAGE_TALENTS: ClassTalents = {
  class: 'mage',
  specs: MAGE_SPECS,
};
export const ROGUE_TALENTS: ClassTalents = {
  class: 'rogue',
  specs: ROGUE_SPECS,
};
export const PRIEST_TALENTS: ClassTalents = {
  class: 'priest',
  specs: PRIEST_SPECS,
};
export const SHAMAN_TALENTS: ClassTalents = {
  class: 'shaman',
  specs: SHAMAN_SPECS,
};
export const WARLOCK_TALENTS: ClassTalents = {
  class: 'warlock',
  specs: WARLOCK_SPECS,
};
export const DRUID_TALENTS: ClassTalents = {
  class: 'druid',
  specs: DRUID_SPECS,
};
