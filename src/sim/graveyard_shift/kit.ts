// Morthen's player kit for a Graveyard Shift run. Mode-local AbilityDefs: never
// in ABILITIES (no icon, wiki or catalog obligations while the run is a dev
// prototype); casting resolves them through meta.known like any ability. Built
// only from existing effect kinds. Numbers come from the shipped `morthen`
// template where it has one; the rest are first-playtest values to tune. Costs
// are 0 until the Dread resource lands. `class: 'warrior'` is a neutral carrier
// (the clockwork_shock_bomb precedent): the class-keyed hooks key on warlock
// and mage abilities, never on warrior ones.

import type { KnownAbility } from '../content/classes';
import type { AbilityDef, AbilityEffect } from '../types';
import { MORTHEN_SOLO_DAMAGE_MULT } from './morthen_profile';

export const MORTHEN_KIT: readonly AbilityDef[] = [
  {
    // Half of the template's melee swing (41 to 65 at level 10 elite).
    id: 'gshift_gravecall',
    name: 'Gravecall',
    class: 'warrior',
    learnLevel: 1,
    cost: 0,
    castTime: 0,
    cooldown: 6,
    range: 20,
    school: 'shadow',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 20, max: 32, spellPowerCoeff: 0 }],
    description: 'Hurls a bolt of grave shadow at the target for 20 to 32 Shadow damage.',
  },
  {
    // The template's Shadow Pulse (12 to 18 damage, 12 yards, every 10 sec) as a
    // 2 sec cast the party can interrupt, plus the concept's knockback.
    id: 'gshift_shadow_pulse',
    name: 'Shadow Pulse',
    class: 'warrior',
    learnLevel: 1,
    cost: 0,
    castTime: 2,
    cooldown: 10,
    range: 0,
    school: 'shadow',
    requiresTarget: false,
    effects: [
      { type: 'aoeDamage', min: 12, max: 18, radius: 12 },
      { type: 'aoeKnockback', radius: 12, distance: 8, dazeMult: 0.7, dazeDuration: 3 },
    ],
    description:
      'After 2 sec, a pulse of shadow deals 12 to 18 Shadow damage to enemies within 12 yards and hurls them back.',
  },
  {
    // The paladin pull's travel numbers, plus a short silence and a kick.
    id: 'gshift_sextons_chain',
    name: "Sexton's Chain",
    class: 'warrior',
    learnLevel: 1,
    cost: 0,
    castTime: 0,
    cooldown: 18,
    range: 25,
    school: 'shadow',
    requiresTarget: true,
    effects: [
      { type: 'pullTarget', stopDistance: 3, travelSpeed: 18, slowMult: 0.5, slowDuration: 2 },
      { type: 'interrupt', lockout: 2 },
      { type: 'silence', duration: 2 },
    ],
    description: 'Drags the target to you, interrupts its spellcasting and silences it for 2 sec.',
  },
  {
    // Physical school so one kick on a shadow spell never locks it out.
    id: 'gshift_barrow_shroud',
    name: 'Barrow Shroud',
    class: 'warrior',
    learnLevel: 1,
    cost: 0,
    castTime: 0,
    cooldown: 45,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    effects: [{ type: 'selfBuff', kind: 'shield_wall', value: 0.6, duration: 6 }],
    description: 'Wraps you in grave mist, reducing damage taken by 60% for 6 sec.',
  },
];

// The authored numbers above are the template's; the known list carries them
// through the solo damage multiplier (morthen_profile.ts), so what lands, the
// tooltips and the bar all read the resolved effects.
function soloEffect(effect: AbilityEffect): AbilityEffect {
  if (effect.type === 'directDamage' || effect.type === 'aoeDamage') {
    return {
      ...effect,
      min: effect.min * MORTHEN_SOLO_DAMAGE_MULT,
      max: effect.max * MORTHEN_SOLO_DAMAGE_MULT,
    };
  }
  return effect;
}

export function morthenKitKnown(): KnownAbility[] {
  return MORTHEN_KIT.map((def) => ({
    def,
    rank: 1,
    cost: def.cost,
    castTime: def.castTime,
    cooldown: def.cooldown,
    effects: def.effects.map(soloEffect),
    threatFlat: 0,
    threatMult: 1,
    bonusCharges: 0,
  }));
}
