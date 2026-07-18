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
  paladin: ['holy_light', 'judgement', 'seal_of_righteousness'],
  hunter: ['serpent_sting', 'aimed_shot', 'arcane_shot'],
  rogue: ['sinister_strike', 'eviscerate', 'evasion'],
  priest: ['smite', 'power_word_shield', 'shadow_word_pain'],
  shaman: ['lightning_bolt', 'rockbiter_weapon', 'ghost_wolf'],
  mage: ['fireball', 'frostbolt', 'polymorph'],
  warlock: ['shadow_bolt', 'corruption', 'life_tap'],
  druid: ['wrath', 'bear_form', 'rejuvenation'],
};

// Spec-card presentation for the Specialization screen. Keyed by class, then spec id:
// spec ids are NOT globally unique (paladin/priest both have "holy", shaman/druid both
// have "restoration"), so a flat spec-id map cannot cover all 27 specs. `primaryStat`
// is the attribute the spec scales with (a StatId reused for its localized itemUi.stats.*
// label; melee AP is str-driven for warrior/paladin/shaman/druid, agi-driven kits and
// ranged AP for rogue/hunter, spell power is int, see src/sim/entity.ts); `complexity`
// is an owner-tunable designer call; `examples` are 3-4 real ability ids that showcase
// the spec (each must exist in ABILITIES, belong to the class, and be offered by the
// spec; enforced by tests/charselect_class_details.test.ts). A spec absent here renders
// the basic card (icon + name + role) with no detail rows, so coverage must stay total.
export type SpecComplexity = 'low' | 'medium' | 'high';
export interface SpecCardInfo {
  primaryStat: 'str' | 'agi' | 'int' | 'spi' | 'sta';
  complexity: SpecComplexity;
  examples: string[];
}
export const SPEC_CARD_INFO: Record<PlayerClass, Record<string, SpecCardInfo>> = {
  warrior: {
    arms: {
      primaryStat: 'str',
      complexity: 'medium',
      examples: ['mortal_strike', 'overpower', 'sweeping_strikes', 'execute'],
    },
    fury: {
      primaryStat: 'str',
      complexity: 'high',
      examples: ['bloodthirst', 'raging_gale', 'red_harvest', 'whirlwind'],
    },
    prot: {
      primaryStat: 'str',
      complexity: 'medium',
      examples: ['shield_slam', 'revenge', 'thunder_clap', 'sunder_armor'],
    },
  },
  paladin: {
    holy: {
      primaryStat: 'int',
      complexity: 'low',
      examples: ['holy_shock', 'holy_light', 'flash_of_light', 'lay_on_hands'],
    },
    protection: {
      primaryStat: 'str',
      complexity: 'medium',
      examples: ['holy_shield', 'consecration', 'righteous_fury', 'sacred_bulwark'],
    },
    retribution: {
      primaryStat: 'str',
      complexity: 'low',
      examples: ['crusader_strike', 'judgement', 'seal_of_righteousness', 'exorcism'],
    },
  },
  hunter: {
    beast_mastery: {
      primaryStat: 'agi',
      complexity: 'low',
      examples: ['bestial_wrath', 'tame_beast', 'serpent_sting', 'mongoose_bite'],
    },
    marksmanship: {
      primaryStat: 'agi',
      complexity: 'medium',
      examples: ['trueshot_aura', 'aimed_shot', 'rapid_fire', 'volley'],
    },
    survival: {
      primaryStat: 'agi',
      complexity: 'high',
      examples: ['wyvern_sting', 'wing_clip', 'concussive_shot', 'counter_shot'],
    },
  },
  rogue: {
    assassination: {
      primaryStat: 'agi',
      complexity: 'medium',
      examples: ['cold_blood', 'ambush', 'rupture', 'deadly_poison'],
    },
    combat: {
      primaryStat: 'agi',
      complexity: 'low',
      examples: ['blade_flurry', 'sinister_strike', 'adrenaline_rush', 'eviscerate'],
    },
    subtlety: {
      primaryStat: 'agi',
      complexity: 'high',
      examples: ['hemorrhage', 'cheap_shot', 'vanish', 'sap'],
    },
  },
  priest: {
    discipline: {
      primaryStat: 'int',
      complexity: 'high',
      examples: ['power_infusion', 'power_word_shield', 'power_word_fortitude', 'smite'],
    },
    holy: {
      primaryStat: 'int',
      complexity: 'low',
      examples: ['holy_nova', 'heal', 'flash_heal', 'renew'],
    },
    shadow: {
      primaryStat: 'int',
      complexity: 'medium',
      examples: ['shadowform', 'shadow_word_pain', 'mind_blast', 'mind_flay'],
    },
  },
  shaman: {
    elemental: {
      primaryStat: 'int',
      complexity: 'medium',
      examples: ['elemental_mastery', 'lightning_bolt', 'earth_shock', 'earthquake'],
    },
    enhancement: {
      primaryStat: 'str',
      complexity: 'medium',
      examples: ['stormstrike', 'rockbiter_weapon', 'flametongue_weapon', 'lightning_shield'],
    },
    restoration: {
      primaryStat: 'int',
      complexity: 'low',
      examples: ['chain_heal', 'healing_wave', 'ghost_wolf'],
    },
  },
  mage: {
    fire: {
      primaryStat: 'int',
      complexity: 'high',
      examples: ['fireball', 'pyroblast', 'combustion', 'meteor'],
    },
    frost: {
      primaryStat: 'int',
      complexity: 'medium',
      examples: ['frostbolt', 'ice_lance', 'frozen_orb', 'frost_nova'],
    },
    arcane: {
      primaryStat: 'int',
      complexity: 'high',
      examples: ['temporal_mend', 'temporal_cascade', 'temporal_rewind', 'temporal_hourglass'],
    },
  },
  warlock: {
    affliction: {
      primaryStat: 'int',
      complexity: 'high',
      examples: ['siphon_life', 'corruption', 'curse_of_agony', 'drain_life'],
    },
    demonology: {
      primaryStat: 'int',
      complexity: 'medium',
      examples: ['metamorphosis', 'summon_felguard', 'summon_voidwalker', 'demon_skin'],
    },
    destruction: {
      primaryStat: 'int',
      complexity: 'low',
      examples: ['conflagrate', 'immolate', 'shadowburn', 'rain_of_fire'],
    },
  },
  druid: {
    balance: {
      primaryStat: 'int',
      complexity: 'low',
      examples: ['moonkin_form', 'wrath', 'starfire', 'moonfire'],
    },
    feral: {
      primaryStat: 'str',
      complexity: 'medium',
      examples: ['feral_charge', 'bear_form', 'maul', 'swipe'],
    },
    restoration: {
      primaryStat: 'int',
      complexity: 'medium',
      examples: ['swiftmend', 'rejuvenation', 'regrowth', 'healing_touch'],
    },
  },
};
