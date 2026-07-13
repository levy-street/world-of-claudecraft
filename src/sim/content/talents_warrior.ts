// ---------------------------------------------------------------------------
// Warrior talent content - the vertical-slice class. A shared Class tree plus
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
    icon: 'O', name: 'Grit', description: 'Increases your armor by 4% per rank.',
    row: 0, col: 0,
  },
  {
    id: 'war_cruelty', tree: 'class', kind: 'passive', maxRank: 3,
    effect: { stats: { crit: 0.01 } },
    icon: 'x', name: 'Barbarity', description: 'Increases your critical strike chance by 1% per rank.',
    row: 0, col: 2,
  },
  {
    id: 'war_imp_heroic_strike', tree: 'class', kind: 'passive', maxRank: 2,
    requires: ['war_toughness'],
    effect: { ability: [{ ability: 'heroic_strike', costPct: -0.10 }] },
    icon: '!', name: 'Improved Reaver Strike', description: 'Reduces the rage cost of Reaver Strike by 10% per rank.',
    row: 1, col: 0,
  },
  {
    id: 'war_imp_thunder_clap', tree: 'class', kind: 'passive', maxRank: 2, pointsGate: 2,
    effect: { ability: [{ ability: 'thunder_clap', dmgPct: 0.15 }] },
    icon: '*', name: 'Improved Quaking Blow', description: 'Increases the damage of Quaking Blow by 15% per rank.',
    row: 1, col: 1,
  },
  {
    id: 'war_deflection', tree: 'class', kind: 'passive', maxRank: 3,
    requires: ['war_cruelty'],
    effect: { stats: { dodge: 0.01 } },
    icon: '/', name: 'Blade Turn', description: 'Increases your chance to dodge by 1% per rank.',
    row: 1, col: 2,
  },
  {
    id: 'war_tactical_choice', tree: 'class', kind: 'choice', maxRank: 1, pointsGate: 5,
    choices: [
      { id: 'tc_anticipation', name: 'Fair Warning', icon: 'o', description: 'Increases your dodge chance by 5%.', effect: { stats: { dodge: 0.05 } } },
      { id: 'tc_bladed_armor', name: 'Spiked Harness', icon: 'x', description: 'Increases your attack power by 12%.', effect: { stats: { apPct: 0.12 } } },
      { id: 'tc_cruelty', name: 'Savagery', icon: '*', description: 'Increases your critical strike chance by 3%.', effect: { stats: { crit: 0.03 } } },
    ],
    icon: '*', name: 'Battle Doctrine', description: 'Choose one combat specialization.',
    row: 2, col: 1,
  },
  {
    id: 'war_berserker_rage', tree: 'class', kind: 'active', maxRank: 1, pointsGate: 8,
    requires: ['war_imp_heroic_strike'],
    effect: { grant: { ability: 'berserker_rage' } },
    icon: '*', name: 'Seething Fury', description: 'Grants Seething Fury: become immune to fear and generate rage.',
    row: 3, col: 0,
  },
  {
    id: 'war_second_wind', tree: 'class', kind: 'passive', maxRank: 2, pointsGate: 8,
    requires: ['war_tactical_choice'],
    effect: { stats: { maxHpPct: 0.05, sta: 4 } },
    icon: '*', name: 'Deep Reserves', description: 'Increases your maximum health by 5% and Stamina by 4 per rank.',
    row: 3, col: 2,
  },
];

const ARMS_NODES: TalentNode[] = [
  {
    id: 'arms_imp_overpower', tree: 'spec', specId: 'arms', kind: 'passive', maxRank: 2,
    effect: { ability: [{ ability: 'overpower', dmgPct: 0.25 }] },
    icon: '*', name: 'Improved Redhand', description: 'Increases the damage of Redhand by 25% per rank.',
    row: 0, col: 0,
  },
  {
    id: 'arms_deep_wounds', tree: 'spec', specId: 'arms', kind: 'passive', maxRank: 3,
    effect: { ability: [{ ability: 'rend', dmgPct: 0.10 }] },
    icon: '%', name: 'Lingering Wounds', description: 'Increases the bleed damage of Deep Gash by 10% per rank.',
    row: 0, col: 2,
  },
  {
    id: 'arms_tactical_mastery', tree: 'spec', specId: 'arms', kind: 'passive', maxRank: 2, pointsGate: 2,
    effect: { stats: { ap: 12 } },
    icon: '*', name: 'Weapon Mastery', description: 'Increases your attack power by 12 per rank.',
    row: 1, col: 2,
  },
  {
    id: 'arms_choice', tree: 'spec', specId: 'arms', kind: 'choice', maxRank: 1, pointsGate: 5,
    choices: [
      { id: 'ac_sweeping', name: 'Scything Blows', icon: '@', description: 'Increases Reaping Arc damage by 30%.', effect: { ability: [{ ability: 'cleave', dmgPct: 0.30 }] } },
      { id: 'ac_impale', name: 'Bonepiercer', icon: '+', description: 'Increases your critical strike chance by 5%.', effect: { stats: { crit: 0.05 } } },
      { id: 'ac_mace_spec', name: 'Poleaxe Discipline', icon: 'x', description: 'Maiming Strike hits for 20 additional damage.', effect: { ability: [{ ability: 'mortal_strike', flatDmg: 20 }] } },
    ],
    icon: '*', name: 'Blademaster', description: 'Choose one Battlecraft refinement.',
    row: 2, col: 1,
  },
  {
    id: 'arms_imp_mortal_strike', tree: 'spec', specId: 'arms', kind: 'passive', maxRank: 2, pointsGate: 8,
    requires: ['arms_choice'],
    effect: { ability: [{ ability: 'mortal_strike', cooldownPct: -0.15, dmgPct: 0.10 }] },
    icon: 'X', name: 'Improved Maiming Strike', description: 'Reduces Maiming Strike cooldown by 15% and increases its damage by 10% per rank.',
    row: 3, col: 1,
  },
];

const FURY_NODES: TalentNode[] = [
  {
    id: 'fury_cruelty', tree: 'spec', specId: 'fury', kind: 'passive', maxRank: 3,
    effect: { stats: { crit: 0.01 } },
    icon: '*', name: 'Barbarity', description: 'Increases your critical strike chance by 1% per rank.',
    row: 0, col: 0,
  },
  {
    id: 'fury_unbridled_wrath', tree: 'spec', specId: 'fury', kind: 'passive', maxRank: 2,
    effect: { stats: { ap: 10 } },
    icon: '*', name: 'Boundless Ire', description: 'Increases your attack power by 10 per rank.',
    row: 0, col: 2,
  },
  {
    id: 'fury_whirlwind', tree: 'spec', specId: 'fury', kind: 'active', maxRank: 1, pointsGate: 2,
    requires: ['fury_cruelty'],
    effect: { grant: { ability: 'whirlwind' } },
    icon: '@', name: 'Bladed Gyre', description: 'Grants Bladed Gyre: strike all nearby enemies in a single spin. Your next two single-target abilities also strike enemies near their target.',
    row: 1, col: 0,
  },
  {
    id: 'fury_imp_cleave', tree: 'spec', specId: 'fury', kind: 'passive', maxRank: 2, pointsGate: 2,
    effect: { ability: [{ ability: 'cleave', dmgPct: 0.20 }] },
    icon: '*', name: 'Improved Reaping Arc', description: 'Increases the damage of Reaping Arc by 20% per rank.',
    row: 1, col: 2,
  },
  {
    id: 'fury_choice', tree: 'spec', specId: 'fury', kind: 'choice', maxRank: 1, pointsGate: 5,
    choices: [
      { id: 'fc_enrage', name: 'Red Mist', icon: '*', description: 'Increases all melee ability damage by 8%.', effect: { global: { meleeDmgPct: 0.08 } } },
      { id: 'fc_flurry', name: 'Rapid Blows', icon: '*', description: 'Increases your critical strike chance by 4%.', effect: { stats: { crit: 0.04 } } },
      { id: 'fc_bloodcraze', name: 'Crimson Hunger', icon: '*', description: 'Increases your maximum health by 8%.', effect: { stats: { maxHpPct: 0.08 } } },
    ],
    icon: '*', name: 'War Madness', description: 'Choose one Bloodrush refinement.',
    row: 2, col: 1,
  },
  {
    id: 'fury_imp_bloodthirst', tree: 'spec', specId: 'fury', kind: 'passive', maxRank: 2, pointsGate: 8,
    requires: ['fury_choice'],
    effect: { ability: [{ ability: 'bloodthirst', cooldownPct: -0.15, dmgPct: 0.10 }] },
    icon: 'x', name: 'Improved Bloodletting', description: 'Reduces Bloodletting cooldown by 15% and increases its damage by 10% per rank.',
    row: 3, col: 1,
  },
];

const PROT_NODES: TalentNode[] = [
  {
    id: 'prot_toughness', tree: 'spec', specId: 'prot', kind: 'passive', maxRank: 3,
    effect: { stats: { armorPct: 0.05 } },
    icon: 'O', name: 'Shieldwright', description: 'Increases your armor by 5% per rank.',
    row: 0, col: 0,
  },
  {
    id: 'prot_anticipation', tree: 'spec', specId: 'prot', kind: 'passive', maxRank: 3,
    effect: { stats: { dodge: 0.01 } },
    icon: 'o', name: 'Fair Warning', description: 'Increases your chance to dodge by 1% per rank.',
    row: 0, col: 2,
  },
  {
    id: 'prot_imp_thunder_clap', tree: 'spec', specId: 'prot', kind: 'passive', maxRank: 2, pointsGate: 2,
    requires: ['prot_toughness'],
    effect: { ability: [{ ability: 'thunder_clap', dmgPct: 0.15, costPct: -0.25 }] },
    icon: '*', name: 'Improved Quaking Blow', description: 'Increases Quaking Blow damage by 15% and reduces its cost by 25% per rank.',
    row: 1, col: 0,
  },
  {
    id: 'prot_imp_sunder', tree: 'spec', specId: 'prot', kind: 'passive', maxRank: 2, pointsGate: 2,
    effect: { ability: [{ ability: 'sunder_armor', costPct: -0.25 }] },
    icon: '#', name: 'Improved Armor Shear', description: 'Reduces the rage cost of Armor Shear by 25% per rank.',
    row: 1, col: 2,
  },
  {
    id: 'prot_choice', tree: 'spec', specId: 'prot', kind: 'choice', maxRank: 1, pointsGate: 5,
    choices: [
      { id: 'pc_shield_spec', name: 'Shieldbearer', icon: 'O', description: 'Increases your dodge chance by 5%.', effect: { stats: { dodge: 0.05 } } },
      { id: 'pc_imp_taunt', name: 'Improved Goad', icon: '<', description: 'Reduces the cooldown of Goad by 20%.', effect: { ability: [{ ability: 'taunt', cooldownPct: -0.20 }] } },
      { id: 'pc_last_stand', name: 'Eleventh Hour', icon: '*', description: 'Increases your maximum health by 15%.', effect: { stats: { maxHpPct: 0.15 } } },
    ],
    icon: '*', name: 'Bulwark', description: 'Choose one Ironguard refinement.',
    row: 2, col: 1,
  },
  {
    id: 'prot_imp_shield_slam', tree: 'spec', specId: 'prot', kind: 'passive', maxRank: 2, pointsGate: 8,
    requires: ['prot_choice'],
    effect: { ability: [{ ability: 'shield_slam', dmgPct: 0.10 }], global: { threatPct: 0.10 } },
    icon: '*', name: 'Improved Shieldcrack', description: 'Increases Shieldcrack damage by 10% and all threat by 10% per rank.',
    row: 3, col: 1,
  },
];

const SPECS: SpecDef[] = [
  {
    id: 'arms', class: 'warrior', name: 'Battlecraft', role: 'dps', icon: 'x',
    description: 'A master of arms who turns discipline and technique into his greatest strength. Every blow is calculated to break the enemy defense, exploit their weak points, and set up a devastating finisher. His combat is precise, methodical, and lethal, rewarding those who master the rhythm of battle.',
    signature: 'mortal_strike',
    mastery: { name: 'Master Armorer', description: 'While wielding a two-handed weapon, all damage you deal is increased by 10%.', effect: { global: { masteryTwoHandDmgPct: 0.1 } } },
  },
  {
    id: 'fury', class: 'warrior', name: 'Bloodrush', role: 'dps', icon: 'x',
    description: 'A berserker who fights with a weapon in each hand and lets rage drive his every move. The longer he fights, the greater his Enrage, unleashing a relentless storm of attacks that gives his enemies no respite. A frenzied, savage, aggressive style where the offensive never stops.',
    signature: 'bloodthirst',
    mastery: { name: 'Bloodletter', description: 'Increases your critical strike chance by 5% and attack power by 10.', effect: { stats: { crit: 0.05, ap: 10 } } },
  },
  {
    id: 'prot', class: 'warrior', name: 'Ironguard', role: 'tank', icon: 'O',
    description: 'The guardian who leads the front line with shield raised and unbreakable will. He withstands the assault of countless foes, protects his allies, and controls the battlefield with authority. He turns every blocked blow into a chance to answer with force.',
    signature: 'shield_slam',
    mastery: { name: 'Recompense', description: 'Increases all threat you generate by 30% and your armor by 10%. Vanguard: your Stamina is increased by 40% and you gain armor equal to 70% of your Strength.', effect: { global: { threatPct: 0.30 }, stats: { armorPct: 0.10, staPct: 0.40, armorFromStrPct: 0.70 } } },
  },
];

export const WARRIOR_TALENTS: ClassTalents = {
  class: 'warrior',
  nodes: [...CLASS_NODES, ...ARMS_NODES, ...FURY_NODES, ...PROT_NODES],
  specs: SPECS,
};
