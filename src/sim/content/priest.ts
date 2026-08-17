import type { AbilityDef } from '../types';

// Priest v0.28 spec signatures live together so their ownership and tuning can
// evolve without growing the shared class catalog. Their custom combat effects
// are wired by the spec modules in src/sim/combat/priest/.
export const PRIEST_ABILITIES: Record<string, AbilityDef> = {
  veilstep: {
    id: 'veilstep',
    name: 'Veilstep',
    class: 'priest',
    learnLevel: 5,
    cost: 30,
    castTime: 0,
    cooldown: 18,
    range: 0,
    school: 'shadow',
    requiresTarget: false,
    effects: [{ type: 'blinkForward', distance: 10 }],
    description: 'Step 10 yards forward through the veil.',
  },
  scouring_mercy: {
    id: 'scouring_mercy',
    name: 'Scouring Mercy',
    class: 'priest',
    learnLevel: 10,
    specs: ['discipline'],
    cost: 75,
    castTime: 0,
    cooldown: 8,
    range: 30,
    school: 'holy',
    requiresTarget: true,
    targetType: 'any',
    effects: [
      { type: 'directDamage', min: 72, max: 84 },
      { type: 'heal', min: 130, max: 155 },
    ],
    description:
      'Deal 72 to 84 Holy damage to an enemy or heal a friendly target for 130 to 155. Both amounts increase with Spell Power. Damage also heals each Doctrine-linked ally for 30%, or the lowest-health party member for 15% if no ally is linked. (Doctrine signature)',
  },
  seraphic_vigil: {
    id: 'seraphic_vigil',
    name: 'Seraphic Vigil',
    class: 'priest',
    learnLevel: 10,
    specs: ['holy'],
    cost: 80,
    castTime: 0,
    cooldown: 20,
    range: 30,
    school: 'holy',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [{ type: 'buffTarget', kind: 'heal_echo', value: 180, duration: 30 }],
    description:
      'Protect one ally for 30 sec. The first hit that leaves them below 35% health consumes the Vigil and heals them for 180. (Benison signature)',
  },
  summon_tithefiend: {
    id: 'summon_tithefiend',
    name: 'Call Tithefiend',
    class: 'priest',
    learnLevel: 10,
    specs: ['shadow'],
    cost: 60,
    castTime: 0,
    cooldown: 30,
    range: 0,
    school: 'shadow',
    requiresTarget: false,
    requiresAuraKind: 'gloomtithe',
    // Vespers consumes its OWN bank inside vespersAfterAbility (the summon
    // scales off the stack count), so the generic cast-commit consume must not
    // strip it first: doing so left summonTithefiend reading zero stacks and
    // silently summoning nothing.
    consumesRequiredAura: false,
    effects: [],
    description:
      'Consume all Gloomtithe to summon a Tithefiend. It lasts 6, 8, 10, 12, or 15 sec at 1 to 5 stacks and attacks every 2 sec. Each attack deals 20 to 24 Shadow damage plus 8 per extra stack and increases with your Spell Power. At 5 stacks, the fiend grows larger and deals 25% more damage. It prefers your Effigy. Each hit restores 1% maximum Mana and echoes 15% of its damage to up to 3 other enemies with your Dirge of Decay. (Vespers signature)',
  },
  martyrs_aegis: {
    id: 'martyrs_aegis',
    name: "Martyr's Aegis",
    class: 'priest',
    learnLevel: 17,
    cost: 80,
    castTime: 0,
    cooldown: 120,
    range: 30,
    school: 'holy',
    requiresTarget: true,
    targetType: 'friendly',
    effects: [{ type: 'buffTarget', kind: 'shield_wall', value: 0.4, duration: 8 }],
    description: "Reduce one ally's incoming damage by 40% for 8 sec.",
  },
  choir_of_deliverance: {
    id: 'choir_of_deliverance',
    name: 'Choir of Deliverance',
    class: 'priest',
    learnLevel: 17,
    cost: 128,
    castTime: 0,
    channel: { duration: 6, ticks: 3 },
    cooldown: 180,
    range: 0,
    school: 'holy',
    requiresTarget: false,
    effects: [{ type: 'aoeHeal', min: 90, max: 110, radius: 30 }],
    description:
      'Channel for 6 sec, healing party members within 30 yards for $d every 2 sec. Healing increases with Spell Power.',
  },
};
