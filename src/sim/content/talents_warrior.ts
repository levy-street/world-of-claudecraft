// ---------------------------------------------------------------------------
// Winning Warrior specialization identities and masteries. Class-wide choice
// rows live in warrior_rows.ts.
// ---------------------------------------------------------------------------

import type { ClassTalents, SpecDef } from './talents';

const SPECS: SpecDef[] = [
  {
    id: 'arms', class: 'warrior', name: 'Battlecraft', role: 'dps', icon: 'x',
    description: 'A master of arms who turns discipline and technique into his greatest strength. Every blow is calculated to break the enemy defense, exploit their weak points, and set up a devastating finisher. His combat is precise, methodical, and lethal, rewarding those who master the rhythm of battle.',
    signature: 'mortal_strike',
    mastery: { name: 'Master Armorer', description: 'While wielding a two-handed weapon, all damage you deal is increased by 10%.', effect: { global: { masteryTwoHandDmgPct: 0.1 } } },
  },
  {
    id: 'fury', class: 'warrior', name: 'Bloodrush', role: 'dps', icon: 'x',
    description: 'A berserker who fights with a weapon in each hand and lets rage drive his every move. The longer he fights, the greater his Enrage, unleashing a relentless storm of attacks that gives his enemies no respite. A frenzied, savage, aggressive style where the offensive never stops. Committing to Bloodrush unlocks dual wielding, and through Titan\'s Grip even a two-handed weapon in each hand, though wielding two-handers in both hands reduces physical damage dealt by 12%.',
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
  specs: SPECS,
};
