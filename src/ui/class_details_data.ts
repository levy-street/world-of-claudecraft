// Presentation metadata for the character-select class showcase.
//
// This is a thin, host-agnostic data module (no DOM/Three imports) so the
// drift guard in tests/charselect_class_details.test.ts can import it directly
// and cross-check it against the sim's source of truth (`CLASSES`/`ABILITIES`
// in src/sim/content/classes.ts). Keeping it separate from main.ts (which
// runs browser side-effects on import) is what makes that test possible.
//
// Starting stats, resource type, HP/mana and ability tooltips all read LIVE
// from the sim at render time; the only hand-maintained data here is the
// role/armor/weapon labels and the curated "signature" ability picks.

import type { PlayerClass } from '../sim/types';
import type { TranslationKey } from './i18n';

export interface ClassDetails {
  roleKey: TranslationKey;
  roleType: 'tank' | 'dps' | 'ranged' | 'healer' | 'hybrid';
  armorKey: TranslationKey;
  weaponsKey: TranslationKey;
}

export const CLASS_DETAILS: Record<PlayerClass, ClassDetails> = {
  warrior: {
    roleKey: 'classDetails.roles.warrior',
    roleType: 'hybrid',
    armorKey: 'classDetails.armor.chainLeatherCloth',
    weaponsKey: 'classDetails.weapons.swordsMacesAxes',
  },
  paladin: {
    roleKey: 'classDetails.roles.paladin',
    roleType: 'hybrid',
    armorKey: 'classDetails.armor.chainLeatherCloth',
    weaponsKey: 'classDetails.weapons.swordsMaces',
  },
  hunter: {
    roleKey: 'classDetails.roles.hunter',
    roleType: 'ranged',
    armorKey: 'classDetails.armor.leatherCloth',
    weaponsKey: 'classDetails.weapons.axesSwords',
  },
  rogue: {
    roleKey: 'classDetails.roles.rogue',
    roleType: 'dps',
    armorKey: 'classDetails.armor.leatherCloth',
    weaponsKey: 'classDetails.weapons.daggersSwords',
  },
  priest: {
    roleKey: 'classDetails.roles.priest',
    roleType: 'healer',
    armorKey: 'classDetails.armor.cloth',
    weaponsKey: 'classDetails.weapons.staves',
  },
  shaman: {
    roleKey: 'classDetails.roles.shaman',
    roleType: 'hybrid',
    armorKey: 'classDetails.armor.chainLeatherCloth',
    weaponsKey: 'classDetails.weapons.macesAxes',
  },
  mage: {
    roleKey: 'classDetails.roles.mage',
    roleType: 'ranged',
    armorKey: 'classDetails.armor.cloth',
    weaponsKey: 'classDetails.weapons.staves',
  },
  warlock: {
    roleKey: 'classDetails.roles.warlock',
    roleType: 'ranged',
    armorKey: 'classDetails.armor.cloth',
    weaponsKey: 'classDetails.weapons.staves',
  },
  druid: {
    roleKey: 'classDetails.roles.druid',
    roleType: 'hybrid',
    armorKey: 'classDetails.armor.leatherCloth',
    weaponsKey: 'classDetails.weapons.staves',
  },
};

// Three curated "signature" abilities per class, shown on the select screen.
// Each entry MUST be a real ability that the class can learn, enforced by
// tests/charselect_class_details.test.ts so this never drifts from the sim.
export const SIGNATURE_ABILITIES: Record<PlayerClass, string[]> = {
  warrior: ['charge', 'heroic_strike', 'execute'],
  paladin: ['holy_light', 'hammer_of_grace', 'divine_ascension'],
  hunter: ['pack_command', 'measured_shot', 'raptor_strike'],
  rogue: ['sinister_strike', 'eviscerate', 'evasion'],
  priest: ['smite', 'power_word_shield', 'shadow_word_pain'],
  shaman: ['lightning_bolt', 'rockbiter_weapon', 'ghost_wolf'],
  mage: ['fireball', 'frostbolt', 'polymorph'],
  warlock: ['shadow_bolt', 'corruption', 'life_tap'],
  druid: ['wrath', 'bear_form', 'rejuvenation'],
};

// Spec-card presentation for the Specialization screen. Keyed by class, then spec id:
// spec ids are NOT globally unique (paladin/priest both have "holy", shaman/druid both
// have "restoration"), so a flat spec-id map cannot cover all 27 specs. The card's
// primary stat is read from SPEC_PRIMARY_STAT (src/sim/content/spec_primary_stat.ts),
// the one table every gear source shares; `complexity`
// is an owner-tunable designer call; `examples` are 3-4 real ability ids that showcase
// the spec (each must exist in ABILITIES, belong to the class, and be offered by the
// spec; enforced by tests/charselect_class_details.test.ts). A spec absent here renders
// the basic card (icon + name + role) with no detail rows, so coverage must stay total.
export type SpecComplexity = 'low' | 'medium' | 'high';
export interface SpecCardInfo {
  complexity: SpecComplexity;
  examples: string[];
}
export const SPEC_CARD_INFO: Record<PlayerClass, Record<string, SpecCardInfo>> = {
  warrior: {
    arms: {
      complexity: 'medium',
      examples: ['mortal_strike', 'overpower', 'sweeping_strikes', 'execute'],
    },
    fury: {
      complexity: 'high',
      examples: ['bloodthirst', 'raging_gale', 'red_harvest', 'whirlwind'],
    },
    prot: {
      complexity: 'medium',
      examples: ['shield_slam', 'revenge', 'thunder_clap', 'sunder_armor'],
    },
  },
  paladin: {
    holy: {
      complexity: 'low',
      examples: ['holy_light', 'dawns_embrace', 'radiant_chorus', 'lay_on_hands'],
    },
    protection: {
      complexity: 'medium',
      examples: ['bastion_sweep', 'oath_chain', 'holy_shield', 'consecration'],
    },
    retribution: {
      complexity: 'low',
      examples: ['final_edict', 'sun_gods_verdict', 'hammer_of_wrath', 'avenging_wrath'],
    },
  },
  hunter: {
    beast_mastery: {
      complexity: 'low',
      examples: ['pack_command', 'unleash_beast', 'bestial_wrath', 'tame_beast'],
    },
    marksmanship: {
      complexity: 'medium',
      examples: ['measured_shot', 'aimed_shot', 'rapid_fire', 'cold_focus'],
    },
    survival: {
      complexity: 'high',
      examples: ['bloodhook', 'raptor_strike', 'mongoose_bite', 'shrapnel_charge'],
    },
  },
  rogue: {
    assassination: {
      complexity: 'medium',
      examples: ['cold_blood', 'ambush', 'rupture', 'deadly_poison'],
    },
    combat: {
      complexity: 'low',
      examples: ['blade_flurry', 'sinister_strike', 'adrenaline_rush', 'eviscerate'],
    },
    subtlety: {
      complexity: 'high',
      examples: ['hemorrhage', 'cheap_shot', 'vanish', 'sap'],
    },
  },
  priest: {
    discipline: {
      complexity: 'high',
      examples: ['power_infusion', 'power_word_shield', 'power_word_fortitude', 'smite'],
    },
    holy: {
      complexity: 'low',
      examples: ['holy_nova', 'heal', 'flash_heal', 'renew'],
    },
    shadow: {
      complexity: 'medium',
      examples: ['shadowform', 'shadow_word_pain', 'mind_blast', 'mind_flay'],
    },
  },
  shaman: {
    elemental: {
      complexity: 'medium',
      examples: ['elemental_mastery', 'lightning_bolt', 'earth_shock', 'earthquake'],
    },
    enhancement: {
      complexity: 'medium',
      examples: ['stormstrike', 'rockbiter_weapon', 'galeheart_weapon', 'lightning_shield'],
    },
    restoration: {
      complexity: 'low',
      examples: ['chain_heal', 'healing_wave', 'ghost_wolf'],
    },
  },
  mage: {
    fire: {
      complexity: 'high',
      examples: ['fireball', 'pyroblast', 'combustion', 'meteor'],
    },
    frost: {
      complexity: 'medium',
      examples: ['frostbolt', 'ice_lance', 'frozen_orb', 'frost_nova'],
    },
    arcane: {
      complexity: 'high',
      examples: ['temporal_mend', 'temporal_cascade', 'temporal_rewind', 'temporal_hourglass'],
    },
  },
  warlock: {
    affliction: {
      complexity: 'high',
      examples: ['evil_eye', 'needle_of_fate', 'sentence', 'litany_of_guilt'],
    },
    demonology: {
      complexity: 'high',
      examples: ['soul_harvest', 'raise_bone_mage', 'army_of_the_dead', 'metamorphosis'],
    },
    destruction: {
      complexity: 'low',
      examples: ['conflagrate', 'immolate', 'shadowburn', 'rain_of_fire'],
    },
  },
  druid: {
    balance: {
      complexity: 'low',
      examples: ['moonkin_form', 'wrath', 'starfire', 'moonfire'],
    },
    feral: {
      complexity: 'medium',
      examples: ['feral_charge', 'bear_form', 'maul', 'swipe'],
    },
    restoration: {
      complexity: 'medium',
      examples: ['sporemender_form', 'swiftmend', 'rejuvenation', 'regrowth'],
    },
  },
};
