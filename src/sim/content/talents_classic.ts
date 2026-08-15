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
    'Sunmender',
    'healer',
    '+',
    'A devoted healer who turns the Light into steady single-target recovery.',
    'mercy_lance',
    'Kindled Faith',
    'Your healing spells critically heal for double.',
    { global: { critDmgHealPct: 0.5 } },
  ),
  spec(
    'protection',
    'paladin',
    'Faithwarden',
    'tank',
    '#',
    'A shield-bearing defender who converts Holy power into threat and mitigation.',
    'sunward_disc',
    'Oathward',
    'Increases all threat you generate by 50%, your armor by 20% and your Stamina by 35%.',
    // staPct 0.35 carries the 2026-07 tank-parity pass that used to live in
    // SPEC_BASELINES: with no stamina multiplier the paladin sat at 76% of the
    // prot warrior's effective HP. The mastery is where an overhauled class
    // keeps its floor (see Recompense on the warrior), so it lands here.
    { global: { threatPct: 0.5 }, stats: { armorPct: 0.2, staPct: 0.35 } },
  ),
  spec(
    'retribution',
    'paladin',
    'Dawnreaver',
    'dps',
    'x',
    'A holy warrior who judges enemies with weapon strikes and radiant burst.',
    'final_edict',
    'Blood Debt',
    'Increases your Holy and physical ability damage by 20%.',
    { global: { meleeDmgPct: 0.2, spellDmgPct: 0.2 } },
  ),
];

const HUNTER_SPECS: SpecDef[] = [
  spec(
    'beast_mastery',
    'hunter',
    'Packlord',
    'dps',
    '+',
    'A wild commander who builds Pack Ferocity and unleashes a growing companion.',
    'bestial_wrath',
    'Packbond',
    'Your pet deals 25% more damage and your maximum health is increased by 8%.',
    { global: { petDmgPct: 0.25 }, stats: { maxHpPct: 0.08 } },
  ),
  spec(
    'marksmanship',
    'hunter',
    'Coldsight',
    'dps',
    'x',
    'A deliberate archer who builds Focus and commits to precision shots.',
    'cold_focus',
    'Cold Read',
    'Increases physical ability damage by 12% and critical strike chance by 3%.',
    { global: { meleeDmgPct: 0.12 }, stats: { crit: 0.03 } },
  ),
  spec(
    'survival',
    'hunter',
    'Fieldcraft',
    'dps',
    'o',
    'A melee-first skirmisher who tears one wound and controls re-entry.',
    'bloodhook',
    // Balance pass: was +15% Agility / +15% physical damage, a straight Iron
    // Aim rival with no niche. Now the evasive-skirmisher identity.
    'Quickblood',
    'Increases your Agility by 15% and your dodge chance by 4%.',
    { stats: { agiPct: 0.15, dodge: 0.04 } },
  ),
];

const MAGE_SPECS: SpecDef[] = [
  // Chronomancy (docs/prd/mage-chronomancy.md Phase 1): the healer that
  // replaced the Aethermancy DPS. The INTERNAL id stays 'arcane' so existing
  // characters, loadouts and persisted builds survive untouched (the PRD
  // records this decision); only the presentation and role changed. The old
  // signature arcane_power is now unreferenced content debt (PRD, section 14).
  spec(
    'arcane',
    'mage',
    'Chronomancy',
    'healer',
    '*',
    'A mage who manipulates time and aether to protect allies. They can anticipate wounds, repeat healing, and reverse damage before it is too late.',
    'temporal_mend',
    'Chronoweave',
    'Increases all healing you do by 15%, your maximum mana by 5%, and your mana regeneration by 20%.',
    { global: { healPct: 0.15, manaPct: 0.05, manaRegenPct: 0.2 } },
  ),
  spec(
    'fire',
    'mage',
    'Pyromancy',
    'dps',
    'x',
    'A master of flame who chains critical strikes into devastating explosions. Fast, aggressive, and capable of igniting many enemies.',
    // Signature swapped to the Hot Streak spender (owner leveling pass 2026-07-14):
    // Phoenix Trance moved into the spec kit at level 12, and a signature grant would
    // bypass that learnLevel gate (grants always do).
    'pyroblast',
    'Ignition',
    'Your spell critical strikes burn the target for 40% of the damage dealt over 6 sec, stacking. Increases critical strike chance by 2%.',
    // The burn fraction is the scalable mastery axis (runtime: fire_mage's
    // igniteOnCrit copies the resolved crit damage); crit chance is the static
    // secondary.
    { global: { ignitionPct: 0.4 }, stats: { crit: 0.02 } },
  ),
  spec(
    'frost',
    'mage',
    'Cryomancy',
    'dps',
    '#',
    'A spellcaster who controls the battlefield with ice, slows, and freezes. They build glacial power to destroy enemies with precise attacks.',
    // Signature swapped to the proc spender (owner leveling pass 2026-07-14):
    // Icy Veins moved into the spec kit at level 12 (see combustion above).
    'ice_lance',
    'Brittlebreak',
    'Increases your Frost spell damage by 25%. Increases armor by 10%.',
    // The scalable mastery axis is the Frost-kit damage (ability-scoped so the
    // mage's fire/arcane baseline spells stay untouched); armor is the static
    // secondary. Crit-vs-rooted identity returns as a Shatter-style row option.
    {
      ability: [
        { ability: 'frostbolt', dmgPct: 0.25 },
        { ability: 'frost_nova', dmgPct: 0.25 },
      ],
      stats: { armorPct: 0.1 },
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
    'A poison specialist. Your strikes add Venom Ritual; at 6, Dirt Nap becomes Venomrend, which cashes in all your bleeds at once and plants a fresh wound.',
    'cold_blood',
    // Balance pass (maintainer sheet): the backstab identity (the classic
    // Improved Backstab 30%), not a bleed rider on Subtlety's turf.
    'Redhanded',
    "Increases Craven Thrust's critical strike chance by 30% and your poison damage by 10%.",
    {
      ability: [
        { ability: 'backstab', critPct: 0.3 },
        // The assassination poison identity (Potent Poisons shape): the two
        // weapon coats scale their per-swing rider, the strike its hit.
        { ability: 'instant_poison', buffPct: 0.1 },
        { ability: 'deadly_poison', buffPct: 0.1 },
        { ability: 'crippling_poison', dmgPct: 0.1 },
      ],
    },
  ),
  spec(
    'combat',
    'rogue',
    'Thuggery',
    'dps',
    '/',
    'A stand-up brawler. A 4+ combo Dirt Nap starts Redline for 8 sec: your strikes become Haymakers that build it up, and Lights Out spends it all before the timer ends.',
    'blade_flurry',
    // Balance pass (maintainer sheet): the only mastery in the game with a
    // penalty loses it.
    "Scrapper's Edge",
    'Increases attack speed by 10%, and your auto-attacks have a 5% chance to trigger an extra attack.',
    // The extra-attack chance is the classic Sword Specialization max rank; 10%
    // was considered and rejected (with the haste it would push auto throughput
    // past 20% and drown the haste half).
    { global: { meleeHastePct: 0.1, extraAttackPct: 0.05 } },
  ),
  spec(
    'subtlety',
    'rogue',
    'Skulduggery',
    'dps',
    '>',
    "A stealth striker. Openers from Duskveil add Gloam; at 3 Gloam your openers work without stealth, and the next one is free and starts the Shadow Veil, doubling your first Lurker's Strike inside it.",
    'hemorrhage',
    // Balance pass (maintainer sheet): tuned down from +40% crit damage and
    // +10% Agility; the stealth-speed identity comes in instead (the Duskveil
    // slow eases from 50% toward 25% at full mastery).
    'False Face',
    'Increases the damage of your critical strikes by 25%, and you move 50% faster while in Duskveil.',
    {
      global: { critDmgPhysPct: 0.25 },
      ability: [
        { ability: 'stealth', buffPct: 0.5 },
        { ability: 'vanish', buffPct: 0.5 },
      ],
    },
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
    'scouring_mercy',
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
    'seraphic_vigil',
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
    'summon_tithefiend',
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
    'Increases your melee attack speed by 10% and your physical ability damage by 10%.',
    { global: { meleeHastePct: 0.1, meleeDmgPct: 0.1 } },
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
    'Mending Waters and Cascading Mend cost 20% less Mana.',
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
    'A curse-weaver who turns enemy and allied actions into Condemnation.',
    'evil_eye',
    'Sentence',
    'Increases Needle of Fate, Sentence, and Litany of Guilt damage by 10%.',
    {
      ability: [
        { ability: 'needle_of_fate', dmgPct: 0.1 },
        { ability: 'sentence', dmgPct: 0.1 },
        // The viability pass authored Litany's 5/9/14 expecting the mastery on
        // top (tests/warlock_viability_fixes.test.ts pins 6/10/15 resolved);
        // the wiring was missed when the ability landed.
        { ability: 'litany_of_guilt', dmgPct: 0.1 },
      ],
    },
  ),
  spec(
    'demonology',
    'warlock',
    'Necromancy',
    'dps',
    '+',
    'A master of Soul Fragments who raises and commands an undead army.',
    'metamorphosis',
    'Grave Dominion',
    'Your undead deal 20% more damage, and your Graveguard intercepts 20% of damage you take. Increases Stamina by 10%.',
    { global: { petDmgPct: 0.2, petDmgSharePct: 0.2 }, stats: { staPct: 0.1 } },
  ),
  spec(
    'destruction',
    'warlock',
    'Ruination',
    'dps',
    'x',
    'A siege caster who builds Wrack and spends it on overwhelming fire.',
    'conflagrate',
    'Desolation',
    'Conflagrate grants Desolation. It significantly shortens your next Ruinbolt cast or calls down the first wave of Rain of Fire immediately.',
    {},
  ),
];

const DRUID_SPECS: SpecDef[] = [
  spec(
    'balance',
    'druid',
    'Moongrove',
    'dps',
    '*',
    'A Moonwing caster whose casts fill the Moontide; at 3 you choose how to spend it: Moonsurge for damage or Sunwake for mana.',
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
    'A shapeshifter whose landed hits build Old Blood in both forms: Wolf spends it for damage, Bruin spends it to tank.',
    'feral_charge',
    'Primal Heart',
    // The +15% armor carries the v0.27 Dire Bruin retune (the old feral_choice_bear
    // node) into the spec mastery: in Talents 2.0 the bear-tank identity IS this spec.
    'Increases your physical ability damage by 50%, your bleed damage by 50%, your threat by 20%, and your armor by 15%.',
    { global: { meleeDmgPct: 0.5, dotDmgPct: 0.5, threatPct: 0.2 }, stats: { armorPct: 0.15 } },
  ),
  spec(
    'restoration',
    'druid',
    'Groveheart',
    'healer',
    '+',
    'A healer who grows Verdance with completed HoT casts and harvests the garden with Overbloom.',
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
