// ---------------------------------------------------------------------------
// Warrior talent content — the vertical-slice class. A shared Class tree plus
// three Spec trees (Arms / Fury dps, Protection tank). Pure data; the engine in
// talents.ts validates, precomputes, and serializes it. Node/spec display names
// here are content (rendered directly, like ability/quest names); only UI chrome
// strings route through i18n.
//
// Ability ids referenced by `grant`/`ability` mods that aren't in the warrior's
// base kit (mortal_strike, bloodthirst, shield_slam, whirlwind, berserker_rage)
// are added to ABILITIES in classes.ts; abilitiesKnownAt resolves them at runtime.
// ---------------------------------------------------------------------------

import type { ClassTalents, SpecDef, TalentNode } from './talents';

const CLASS_NODES: TalentNode[] = [
  {
    id: 'war_toughness', tree: 'class', kind: 'passive', maxRank: 3,
    effect: { stats: { armorPct: 0.04 } },
    icon: '🛡', name: 'Toughness', description: 'Increases your armor by 4% per rank.',
    row: 0, col: 0,
  },
  {
    id: 'war_cruelty', tree: 'class', kind: 'passive', maxRank: 3,
    effect: { stats: { crit: 0.01 } },
    icon: '⚔', name: 'Cruelty', description: 'Increases your critical strike chance by 1% per rank.',
    row: 0, col: 2,
  },
  {
    id: 'war_imp_heroic_strike', tree: 'class', kind: 'passive', maxRank: 2,
    requires: ['war_toughness'],
    effect: { ability: [{ ability: 'heroic_strike', costPct: -0.10 }] },
    icon: '💢', name: 'Improved Heroic Strike', description: 'Reduces the rage cost of Heroic Strike by 10% per rank.',
    row: 1, col: 0,
  },
  {
    id: 'war_imp_thunder_clap', tree: 'class', kind: 'passive', maxRank: 2, pointsGate: 2,
    effect: { ability: [{ ability: 'thunder_clap', dmgPct: 0.15 }] },
    icon: '🌩', name: 'Improved Thunder Clap', description: 'Increases the damage of Thunder Clap by 15% per rank.',
    row: 1, col: 1,
  },
  {
    id: 'war_deflection', tree: 'class', kind: 'passive', maxRank: 3,
    requires: ['war_cruelty'],
    effect: { stats: { dodge: 0.01 } },
    icon: '🤺', name: 'Deflection', description: 'Increases your chance to dodge by 1% per rank.',
    row: 1, col: 2,
  },
  {
    id: 'war_tactical_choice', tree: 'class', kind: 'choice', maxRank: 1, pointsGate: 5,
    choices: [
      { id: 'tc_anticipation', name: 'Anticipation', icon: '👁', description: 'Increases your dodge chance by 5%.', effect: { stats: { dodge: 0.05 } } },
      { id: 'tc_bladed_armor', name: 'Bladed Armor', icon: '🗡', description: 'Increases your attack power by 12%.', effect: { stats: { apPct: 0.12 } } },
      { id: 'tc_cruelty', name: 'Savagery', icon: '🔥', description: 'Increases your critical strike chance by 3%.', effect: { stats: { crit: 0.03 } } },
    ],
    icon: '⬡', name: 'Tactical Mastery', description: 'Choose one combat specialization.',
    row: 2, col: 1,
  },
  {
    id: 'war_berserker_rage', tree: 'class', kind: 'active', maxRank: 1, pointsGate: 8,
    requires: ['war_imp_heroic_strike'],
    effect: { grant: { ability: 'berserker_rage' } },
    icon: '😤', name: 'Berserker Rage', description: 'Grants Berserker Rage: become immune to fear and generate rage.',
    row: 3, col: 0,
  },
  {
    id: 'war_second_wind', tree: 'class', kind: 'passive', maxRank: 2, pointsGate: 8,
    requires: ['war_tactical_choice'],
    effect: { stats: { maxHpPct: 0.05, sta: 4 } },
    icon: '💚', name: 'Second Wind', description: 'Increases your maximum health by 5% and Stamina by 4 per rank.',
    row: 3, col: 2,
  },
];

const ARMS_NODES: TalentNode[] = [
  {
    id: 'arms_imp_overpower', tree: 'spec', specId: 'arms', kind: 'passive', maxRank: 2,
    effect: { ability: [{ ability: 'overpower', dmgPct: 0.25 }] },
    icon: '⤴', name: 'Improved Overpower', description: 'Increases the damage of Overpower by 25% per rank.',
    row: 0, col: 0,
  },
  {
    id: 'arms_deep_wounds', tree: 'spec', specId: 'arms', kind: 'passive', maxRank: 3,
    effect: { ability: [{ ability: 'rend', dmgPct: 0.10 }] },
    icon: '🩸', name: 'Deep Wounds', description: 'Increases the bleed damage of Rend by 10% per rank.',
    row: 0, col: 2,
  },
  {
    id: 'arms_imp_slam', tree: 'spec', specId: 'arms', kind: 'passive', maxRank: 2, pointsGate: 2,
    requires: ['arms_imp_overpower'],
    effect: { ability: [{ ability: 'slam', castPct: -0.25 }] },
    icon: '⏱', name: 'Improved Slam', description: 'Reduces the cast time of Slam by 25% per rank.',
    row: 1, col: 0,
  },
  {
    id: 'arms_tactical_mastery', tree: 'spec', specId: 'arms', kind: 'passive', maxRank: 2, pointsGate: 2,
    effect: { stats: { ap: 12 } },
    icon: '📈', name: 'Weapon Mastery', description: 'Increases your attack power by 12 per rank.',
    row: 1, col: 2,
  },
  {
    id: 'arms_choice', tree: 'spec', specId: 'arms', kind: 'choice', maxRank: 1, pointsGate: 5,
    choices: [
      { id: 'ac_sweeping', name: 'Sweeping Strikes', icon: '🌀', description: 'Increases Cleave damage by 30%.', effect: { ability: [{ ability: 'cleave', dmgPct: 0.30 }] } },
      { id: 'ac_impale', name: 'Impale', icon: '🎯', description: 'Increases your critical strike chance by 5%.', effect: { stats: { crit: 0.05 } } },
      { id: 'ac_mace_spec', name: 'Poleaxe Specialization', icon: '🪓', description: 'Mortal Strike hits for 20 additional damage.', effect: { ability: [{ ability: 'mortal_strike', flatDmg: 20 }] } },
    ],
    icon: '⬡', name: 'Blademaster', description: 'Choose one Arms refinement.',
    row: 2, col: 1,
  },
  {
    id: 'arms_imp_mortal_strike', tree: 'spec', specId: 'arms', kind: 'passive', maxRank: 2, pointsGate: 8,
    requires: ['arms_choice'],
    effect: { ability: [{ ability: 'mortal_strike', cooldownPct: -0.15, dmgPct: 0.10 }] },
    icon: '☠', name: 'Improved Mortal Strike', description: 'Reduces Mortal Strike cooldown by 15% and increases its damage by 10% per rank.',
    row: 3, col: 1,
  },
];

const FURY_NODES: TalentNode[] = [
  {
    id: 'fury_cruelty', tree: 'spec', specId: 'fury', kind: 'passive', maxRank: 3,
    effect: { stats: { crit: 0.01 } },
    icon: '💥', name: 'Cruelty', description: 'Increases your critical strike chance by 1% per rank.',
    row: 0, col: 0,
  },
  {
    id: 'fury_unbridled_wrath', tree: 'spec', specId: 'fury', kind: 'passive', maxRank: 2,
    effect: { stats: { ap: 10 } },
    icon: '😡', name: 'Unbridled Wrath', description: 'Increases your attack power by 10 per rank.',
    row: 0, col: 2,
  },
  {
    id: 'fury_whirlwind', tree: 'spec', specId: 'fury', kind: 'active', maxRank: 1, pointsGate: 2,
    requires: ['fury_cruelty'],
    effect: { grant: { ability: 'whirlwind' } },
    icon: '🌀', name: 'Whirlwind', description: 'Grants Whirlwind: strike all nearby enemies in a single spin.',
    row: 1, col: 0,
  },
  {
    id: 'fury_imp_cleave', tree: 'spec', specId: 'fury', kind: 'passive', maxRank: 2, pointsGate: 2,
    effect: { ability: [{ ability: 'cleave', dmgPct: 0.20 }] },
    icon: '🪚', name: 'Improved Cleave', description: 'Increases the damage of Cleave by 20% per rank.',
    row: 1, col: 2,
  },
  {
    id: 'fury_choice', tree: 'spec', specId: 'fury', kind: 'choice', maxRank: 1, pointsGate: 5,
    choices: [
      { id: 'fc_enrage', name: 'Enrage', icon: '🔴', description: 'Increases all melee ability damage by 8%.', effect: { global: { meleeDmgPct: 0.08 } } },
      { id: 'fc_flurry', name: 'Flurry', icon: '⚡', description: 'Increases your critical strike chance by 4%.', effect: { stats: { crit: 0.04 } } },
      { id: 'fc_bloodcraze', name: 'Blood Craze', icon: '🧛', description: 'Increases your maximum health by 8%.', effect: { stats: { maxHpPct: 0.08 } } },
    ],
    icon: '⬡', name: 'Berserker', description: 'Choose one Fury refinement.',
    row: 2, col: 1,
  },
  {
    id: 'fury_imp_bloodthirst', tree: 'spec', specId: 'fury', kind: 'passive', maxRank: 2, pointsGate: 8,
    requires: ['fury_choice'],
    effect: { ability: [{ ability: 'bloodthirst', cooldownPct: -0.15, dmgPct: 0.10 }] },
    icon: '🗡', name: 'Improved Bloodthirst', description: 'Reduces Bloodthirst cooldown by 15% and increases its damage by 10% per rank.',
    row: 3, col: 1,
  },
];

const PROT_NODES: TalentNode[] = [
  {
    id: 'prot_toughness', tree: 'spec', specId: 'prot', kind: 'passive', maxRank: 3,
    effect: { stats: { armorPct: 0.05 } },
    icon: '🛡', name: 'Shield Mastery', description: 'Increases your armor by 5% per rank.',
    row: 0, col: 0,
  },
  {
    id: 'prot_anticipation', tree: 'spec', specId: 'prot', kind: 'passive', maxRank: 3,
    effect: { stats: { dodge: 0.01 } },
    icon: '👁', name: 'Anticipation', description: 'Increases your chance to dodge by 1% per rank.',
    row: 0, col: 2,
  },
  {
    id: 'prot_imp_thunder_clap', tree: 'spec', specId: 'prot', kind: 'passive', maxRank: 2, pointsGate: 2,
    requires: ['prot_toughness'],
    effect: { ability: [{ ability: 'thunder_clap', dmgPct: 0.15, costPct: -0.25 }] },
    icon: '🌩', name: 'Improved Thunder Clap', description: 'Increases Thunder Clap damage by 15% and reduces its cost by 25% per rank.',
    row: 1, col: 0,
  },
  {
    id: 'prot_imp_sunder', tree: 'spec', specId: 'prot', kind: 'passive', maxRank: 2, pointsGate: 2,
    effect: { ability: [{ ability: 'sunder_armor', costPct: -0.25 }] },
    icon: '🔨', name: 'Improved Sunder Armor', description: 'Reduces the rage cost of Sunder Armor by 25% per rank.',
    row: 1, col: 2,
  },
  {
    id: 'prot_choice', tree: 'spec', specId: 'prot', kind: 'choice', maxRank: 1, pointsGate: 5,
    choices: [
      { id: 'pc_shield_spec', name: 'Shield Specialization', icon: '🛡', description: 'Increases your dodge chance by 5%.', effect: { stats: { dodge: 0.05 } } },
      { id: 'pc_imp_taunt', name: 'Improved Taunt', icon: '📢', description: 'Reduces the cooldown of Taunt by 20%.', effect: { ability: [{ ability: 'taunt', cooldownPct: -0.20 }] } },
      { id: 'pc_last_stand', name: 'Last Stand', icon: '❤', description: 'Increases your maximum health by 15%.', effect: { stats: { maxHpPct: 0.15 } } },
    ],
    icon: '⬡', name: 'Bulwark', description: 'Choose one Protection refinement.',
    row: 2, col: 1,
  },
  {
    id: 'prot_imp_shield_slam', tree: 'spec', specId: 'prot', kind: 'passive', maxRank: 2, pointsGate: 8,
    requires: ['prot_choice'],
    effect: { ability: [{ ability: 'shield_slam', dmgPct: 0.10 }], global: { threatPct: 0.10 } },
    icon: '💠', name: 'Improved Shield Slam', description: 'Increases Shield Slam damage by 10% and all threat by 10% per rank.',
    row: 3, col: 1,
  },
];

const SPECS: SpecDef[] = [
  {
    id: 'arms', class: 'warrior', name: 'Arms', role: 'dps', icon: '⚔',
    description: 'A master of two-handed weapons who strikes with deadly, deliberate blows.',
    signature: 'mortal_strike',
    mastery: { name: 'Sharpened Blades', description: 'Increases all melee ability damage by 10%.', effect: { global: { meleeDmgPct: 0.10 } } },
  },
  {
    id: 'fury', class: 'warrior', name: 'Fury', role: 'dps', icon: '🪓',
    description: 'A whirlwind of blows fuelled by unrelenting rage.',
    signature: 'bloodthirst',
    mastery: { name: 'Bloodthirsty', description: 'Increases your critical strike chance by 5% and attack power by 10.', effect: { stats: { crit: 0.05, ap: 10 } } },
  },
  {
    id: 'prot', class: 'warrior', name: 'Protection', role: 'tank', icon: '🛡',
    description: 'An immovable wall who holds the enemy’s attention and shields allies.',
    signature: 'shield_slam',
    mastery: { name: 'Vengeance', description: 'Increases all threat you generate by 30% and your armor by 10%.', effect: { global: { threatPct: 0.30 }, stats: { armorPct: 0.10 } } },
  },
];

export const WARRIOR_TALENTS: ClassTalents = {
  class: 'warrior',
  nodes: [...CLASS_NODES, ...ARMS_NODES, ...FURY_NODES, ...PROT_NODES],
  specs: SPECS,
};
