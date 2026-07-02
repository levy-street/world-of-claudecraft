import type { ClassChoiceRows } from './choice_rows';

const mageSpellCostMods = [
  // Any new mage spell with a mana cost must be listed here, or Mana Attunement
  // will overstate its "all Mage spell costs" description.
  'fireball',
  'frostbolt',
  'fire_blast',
  'frost_armor',
  'arcane_intellect',
  'conjure_water',
  'conjure_food',
  'arcane_missiles',
  'polymorph',
  'frost_nova',
  'arcane_explosion',
  'arcane_power',
  'combustion',
  'cone_of_cold',
  'flamestrike',
  'scorch',
  'pyroblast',
  'ice_barrier',
  'counterspell',
  'ice_lance',
  'presence_of_mind',
  'blink',
  'ice_block',
  'deep_freeze',
  'meteor',
  'evocation',
].map((ability) => ({ ability, costPct: -0.1 }));

export const WARRIOR_CHOICE_ROWS: ClassChoiceRows = {
  rows: [
    {
      level: 5,
      theme: 'onslaught',
      options: [
        {
          id: 'war_r5_juggernaut',
          name: 'Juggernaut',
          description: 'Charge cooldown reduced by 50%. You open with it on cooldown.',
          icon: 'charge',
          effect: { ability: [{ ability: 'charge', cooldownPct: -0.5 }] },
        },
        {
          id: 'war_r5_heroic_leap',
          name: 'Heroic Leap',
          description: 'Leap to a ground target, dealing small area damage. 20 sec cooldown.',
          icon: 'heroic_leap',
          effect: { grant: { ability: 'heroic_leap' } },
        },
        {
          id: 'war_r5_warbringer',
          name: 'Warbringer',
          description: 'Charge also roots the target for 1.5 sec.',
          icon: 'charge',
          effect: {
            ability: [{ ability: 'charge', addEffects: [{ type: 'root', duration: 1.5 }] }],
          },
        },
      ],
    },
    {
      level: 8,
      theme: 'warcraft',
      options: [
        {
          id: 'war_r8_pummel',
          name: 'Pummel',
          description: 'Interrupt spellcasting for a 4 sec school lockout. Costs 10 rage.',
          icon: 'pummel',
          effect: { grant: { ability: 'pummel' } },
        },
        {
          id: 'war_r8_concussive_clap',
          name: 'Concussive Clap',
          description: 'Thunder Clap also roots targets hit for 1 sec.',
          icon: 'thunder_clap',
          effect: {
            ability: [
              {
                ability: 'thunder_clap',
                addEffects: [{ type: 'aoeRoot', duration: 1, radius: 8, min: 0, max: 0 }],
              },
            ],
          },
        },
        {
          id: 'war_r8_crippling_strikes',
          name: 'Crippling Strikes',
          description: 'Hamstring costs 66% less.',
          icon: 'hamstring',
          effect: { ability: [{ ability: 'hamstring', costPct: -0.66 }] },
        },
      ],
    },
    {
      level: 11,
      theme: 'bloodlust',
      options: [
        {
          id: 'war_r11_berserker_rage',
          name: 'Berserker Rage',
          description: 'Grants Berserker Rage.',
          icon: 'berserker_rage',
          effect: { grant: { ability: 'berserker_rage' } },
        },
        {
          id: 'war_r11_furious_bloodrage',
          name: 'Furious Bloodrage',
          description: 'Bloodrage cooldown reduced by 50% and rage gain increased by 50%.',
          icon: 'bloodrage',
          effect: { ability: [{ ability: 'bloodrage', cooldownPct: -0.5, dmgPct: 0.5 }] },
        },
        {
          id: 'war_r11_commanding_presence',
          name: 'Commanding Presence',
          description: 'Battle Shout and Commanding Shout effects increased by 50%.',
          icon: 'commanding_shout',
          effect: {
            ability: [
              { ability: 'battle_shout', buffPct: 0.5 },
              { ability: 'commanding_shout', buffPct: 0.5 },
            ],
          },
        },
      ],
    },
    {
      level: 14,
      theme: 'arms_master',
      options: [
        {
          id: 'war_r14_mortal_strike',
          name: 'Mortal Strike',
          description: 'Grants Mortal Strike. If already known, its damage is increased by 15%.',
          icon: 'mortal_strike',
          effect: {
            grant: { ability: 'mortal_strike' },
            ability: [{ ability: 'mortal_strike', dmgPct: 0.15 }],
          },
        },
        {
          id: 'war_r14_whirlwind',
          name: 'Whirlwind',
          description: 'Grants Whirlwind.',
          icon: 'whirlwind',
          effect: { grant: { ability: 'whirlwind' } },
        },
        {
          id: 'war_r14_executioner',
          name: 'Executioner',
          description: 'Execute costs 50% less and deals 20% more damage.',
          icon: 'execute',
          effect: { ability: [{ ability: 'execute', costPct: -0.5, dmgPct: 0.2 }] },
        },
      ],
    },
    {
      level: 17,
      theme: 'bulwark',
      options: [
        {
          id: 'war_r17_shield_wall',
          name: 'Shield Wall',
          description: 'Grants Shield Wall.',
          icon: 'shield_wall',
          effect: { grant: { ability: 'shield_wall' } },
        },
        {
          id: 'war_r17_last_stand',
          name: 'Last Stand',
          description: 'Grants Last Stand.',
          icon: 'last_stand',
          effect: { grant: { ability: 'last_stand' } },
        },
        {
          id: 'war_r17_iron_hide',
          name: 'Iron Hide',
          description: 'Armor increased by 12%.',
          icon: 'defensive_stance',
          effect: { stats: { armorPct: 0.12 } },
        },
      ],
    },
    {
      level: 20,
      theme: 'avatar',
      options: [
        {
          id: 'war_r20_bladestorm',
          name: 'Bladestorm',
          description: 'Grants Bladestorm.',
          icon: 'bladestorm',
          effect: { grant: { ability: 'bladestorm' } },
        },
        {
          id: 'war_r20_avatar',
          name: 'Avatar',
          description: 'Grants Avatar.',
          icon: 'avatar',
          effect: { grant: { ability: 'avatar' } },
        },
        {
          id: 'war_r20_rallying_cry',
          name: 'Rallying Cry',
          description: 'Grants Rallying Cry.',
          icon: 'rallying_cry',
          effect: { grant: { ability: 'rallying_cry' } },
        },
      ],
    },
  ],
};

export const MAGE_CHOICE_ROWS: ClassChoiceRows = {
  rows: [
    {
      level: 5,
      theme: 'spellcraft',
      options: [
        {
          id: 'mag_r5_firestarter',
          name: 'Firestarter',
          description: 'Scorch is castable while moving.',
          icon: 'scorch',
          effect: { ability: [{ ability: 'scorch', castWhileMoving: true }] },
        },
        {
          id: 'mag_r5_impulse',
          name: 'Impulse',
          description: 'Fire Blast cooldown reduced by 50%.',
          icon: 'fire_blast',
          effect: { ability: [{ ability: 'fire_blast', cooldownPct: -0.5 }] },
        },
        {
          id: 'mag_r5_mana_attunement',
          name: 'Mana Attunement',
          description: 'All spell costs reduced by 10%.',
          icon: 'arcane_intellect',
          effect: { ability: mageSpellCostMods },
        },
      ],
    },
    {
      level: 8,
      theme: 'counterplay',
      options: [
        {
          id: 'mag_r8_counterspell',
          name: 'Counterspell',
          description: 'Grants Counterspell.',
          icon: 'counterspell',
          effect: { grant: { ability: 'counterspell' } },
        },
        {
          id: 'mag_r8_ice_nova',
          name: 'Ice Nova',
          description: 'Frost Nova cooldown reduced by 40% and damage increased by 50%.',
          icon: 'frost_nova',
          effect: { ability: [{ ability: 'frost_nova', cooldownPct: -0.4, dmgPct: 0.5 }] },
        },
        {
          id: 'mag_r8_quick_wits',
          name: 'Quick Wits',
          description: 'Polymorph cast time reduced by 50%.',
          icon: 'polymorph',
          effect: { ability: [{ ability: 'polymorph', castPct: -0.5 }] },
        },
      ],
    },
    {
      level: 11,
      theme: 'shatter',
      options: [
        {
          id: 'mag_r11_ice_lance',
          name: 'Ice Lance',
          description: 'Grants Ice Lance.',
          icon: 'ice_lance',
          effect: { grant: { ability: 'ice_lance' } },
        },
        {
          id: 'mag_r11_shatter',
          name: 'Shatter',
          description: 'Spell critical chance against rooted targets increased by 30%.',
          icon: 'frostbolt',
          effect: { global: { critVsRooted: 0.3 } },
        },
        {
          id: 'mag_r11_permafrost',
          name: 'Permafrost',
          description: 'Ice Barrier absorb increased by 40%.',
          icon: 'ice_barrier',
          effect: { ability: [{ ability: 'ice_barrier', dmgPct: 0.4 }] },
        },
      ],
    },
    {
      level: 14,
      theme: 'tempo',
      options: [
        {
          id: 'mag_r14_presence_of_mind',
          name: 'Presence of Mind',
          description: 'Grants Presence of Mind.',
          icon: 'presence_of_mind',
          effect: { grant: { ability: 'presence_of_mind' } },
        },
        {
          id: 'mag_r14_hot_streak',
          name: 'Hot Streak',
          description: 'Pyroblast cast time reduced by 50%.',
          icon: 'pyroblast',
          effect: { ability: [{ ability: 'pyroblast', castPct: -0.5 }] },
        },
        {
          id: 'mag_r14_netherwind',
          name: 'Netherwind',
          description: 'Arcane Missiles is channelable while moving.',
          icon: 'arcane_missiles',
          effect: { ability: [{ ability: 'arcane_missiles', castWhileMoving: true }] },
        },
      ],
    },
    {
      level: 17,
      theme: 'survival',
      options: [
        {
          id: 'mag_r17_blink',
          name: 'Blink',
          description: 'Grants Blink.',
          icon: 'blink',
          effect: { grant: { ability: 'blink' } },
        },
        {
          id: 'mag_r17_ice_block',
          name: 'Ice Block',
          description: 'Grants Ice Block.',
          icon: 'ice_block',
          effect: { grant: { ability: 'ice_block' } },
        },
        {
          id: 'mag_r17_battlemage_armor',
          name: 'Battlemage Armor',
          description: 'Armor increased by 10% and maximum health increased by 5%.',
          icon: 'frost_armor',
          effect: { stats: { armorPct: 0.1, maxHpPct: 0.05 } },
        },
      ],
    },
    {
      level: 20,
      theme: 'capstone',
      options: [
        {
          id: 'mag_r20_deep_freeze',
          name: 'Deep Freeze',
          description: 'Grants Deep Freeze.',
          icon: 'deep_freeze',
          effect: { grant: { ability: 'deep_freeze' } },
        },
        {
          id: 'mag_r20_meteor',
          name: 'Meteor',
          description: 'Grants Meteor.',
          icon: 'meteor',
          effect: { grant: { ability: 'meteor' } },
        },
        {
          id: 'mag_r20_evocation',
          name: 'Evocation',
          description: 'Grants Evocation.',
          icon: 'evocation',
          effect: { grant: { ability: 'evocation' } },
        },
      ],
    },
  ],
};

export const PALADIN_CHOICE_ROWS: ClassChoiceRows = {
  rows: [
    {
      level: 5,
      theme: 'zeal',
      options: [
        {
          id: 'pal_r5_crusaders_zeal',
          name: "Crusader's Zeal",
          description: 'Judgement cooldown reduced by 40%.',
          icon: 'judgement',
          effect: { ability: [{ ability: 'judgement', cooldownPct: -0.4 }] },
        },
        {
          id: 'pal_r5_blessed_momentum',
          name: 'Blessed Momentum',
          description: 'Holy Light is castable while moving.',
          icon: 'holy_light',
          effect: { ability: [{ ability: 'holy_light', castWhileMoving: true }] },
        },
        {
          id: 'pal_r5_vengeful_exorcism',
          name: 'Vengeful Exorcism',
          description: 'Exorcism deals 25% more damage and costs 25% less.',
          icon: 'exorcism',
          effect: { ability: [{ ability: 'exorcism', dmgPct: 0.25, costPct: -0.25 }] },
        },
      ],
    },
    {
      level: 8,
      theme: 'justice',
      options: [
        {
          id: 'pal_r8_rebuke',
          name: 'Rebuke',
          description: 'Grants Rebuke.',
          icon: 'rebuke',
          effect: { grant: { ability: 'rebuke' } },
        },
        {
          id: 'pal_r8_fist_of_justice',
          name: 'Fist of Justice',
          description: 'Hammer of Justice cooldown reduced by 40%.',
          icon: 'hammer_of_justice',
          effect: { ability: [{ ability: 'hammer_of_justice', cooldownPct: -0.4 }] },
        },
        {
          id: 'pal_r8_consecrated_ground',
          name: 'Consecrated Ground',
          description: 'Consecration deals 30% more damage and costs 30% less.',
          icon: 'consecration',
          effect: { ability: [{ ability: 'consecration', dmgPct: 0.3, costPct: -0.3 }] },
        },
      ],
    },
    {
      level: 11,
      theme: 'blessing',
      options: [
        {
          id: 'pal_r11_divine_wisdom',
          name: 'Divine Wisdom',
          description: 'Holy Light and Flash of Light cost 15% less.',
          icon: 'flash_of_light',
          effect: {
            ability: [
              { ability: 'holy_light', costPct: -0.15 },
              { ability: 'flash_of_light', costPct: -0.15 },
            ],
          },
        },
        {
          id: 'pal_r11_guardians_favor',
          name: "Guardian's Favor",
          description: 'Divine Protection and Lay on Hands cooldowns reduced by 33%.',
          icon: 'divine_protection',
          effect: {
            ability: [
              { ability: 'divine_protection', cooldownPct: -0.33 },
              { ability: 'lay_on_hands', cooldownPct: -0.33 },
            ],
          },
        },
        {
          id: 'pal_r11_greater_blessing',
          name: 'Greater Blessing',
          description: 'Blessing of Might effect increased by 50%.',
          icon: 'blessing_of_might',
          effect: { ability: [{ ability: 'blessing_of_might', buffPct: 0.5 }] },
        },
      ],
    },
    {
      level: 14,
      theme: 'righteousness',
      options: [
        {
          id: 'pal_r14_crusader_strike',
          name: 'Crusader Strike',
          description: 'Grants Crusader Strike.',
          icon: 'crusader_strike',
          effect: { grant: { ability: 'crusader_strike' } },
        },
        {
          id: 'pal_r14_holy_wrath',
          name: 'Holy Wrath',
          description: 'Grants Holy Wrath.',
          icon: 'holy_wrath',
          effect: { grant: { ability: 'holy_wrath' } },
        },
        {
          id: 'pal_r14_righteous_cause',
          name: 'Righteous Cause',
          description: 'Seal of Righteousness and Judgement deal 15% more damage.',
          icon: 'seal_of_righteousness',
          effect: {
            ability: [
              { ability: 'seal_of_righteousness', dmgPct: 0.15 },
              { ability: 'judgement', dmgPct: 0.15 },
            ],
          },
        },
      ],
    },
    {
      level: 17,
      theme: 'sanctuary',
      options: [
        {
          id: 'pal_r17_divine_shield',
          name: 'Divine Shield',
          description: 'Grants Divine Shield.',
          icon: 'divine_shield',
          effect: { grant: { ability: 'divine_shield' } },
        },
        {
          id: 'pal_r17_sacred_ward',
          name: 'Sacred Ward',
          description: 'Devotion Aura effect increased by 50% and Lay on Hands healing by 30%.',
          icon: 'devotion_aura',
          effect: {
            ability: [
              { ability: 'devotion_aura', buffPct: 0.5 },
              { ability: 'lay_on_hands', dmgPct: 0.3 },
            ],
          },
        },
        {
          id: 'pal_r17_ardent_defender',
          name: 'Ardent Defender',
          description: 'Armor increased by 10% and maximum health increased by 8%.',
          icon: 'divine_protection',
          effect: { stats: { armorPct: 0.1, maxHpPct: 0.08 } },
        },
      ],
    },
    {
      level: 20,
      theme: 'retribution',
      options: [
        {
          id: 'pal_r20_avenging_wrath',
          name: 'Avenging Wrath',
          description: 'Grants Avenging Wrath.',
          icon: 'avenging_wrath',
          effect: { grant: { ability: 'avenging_wrath' } },
        },
        {
          id: 'pal_r20_hammer_of_wrath',
          name: 'Hammer of Wrath',
          description: 'Grants Hammer of Wrath.',
          icon: 'hammer_of_wrath',
          effect: { grant: { ability: 'hammer_of_wrath' } },
        },
        {
          id: 'pal_r20_aura_mastery',
          name: 'Aura Mastery',
          description: 'Paladin aura effects increased by 60%.',
          icon: 'retribution_aura',
          effect: {
            ability: [
              { ability: 'devotion_aura', buffPct: 0.6 },
              { ability: 'retribution_aura', buffPct: 0.6 },
            ],
          },
        },
      ],
    },
  ],
};

export const HUNTER_CHOICE_ROWS: ClassChoiceRows = {
  rows: [
    {
      level: 5,
      theme: 'shots',
      options: [
        {
          id: 'hun_r5_improved_serpent_sting',
          name: 'Improved Serpent Sting',
          description: 'Serpent Sting deals 30% more damage.',
          icon: 'serpent_sting',
          effect: { ability: [{ ability: 'serpent_sting', dmgPct: 0.3 }] },
        },
        {
          id: 'hun_r5_quick_shots',
          name: 'Quick Shots',
          description: 'Arcane Shot cooldown reduced by 40%.',
          icon: 'arcane_shot',
          effect: { ability: [{ ability: 'arcane_shot', cooldownPct: -0.4 }] },
        },
        {
          id: 'hun_r5_aspect_mastery',
          name: 'Aspect Mastery',
          description: 'Aspect of the Hawk and Aspect of the Monkey effects increased by 40%.',
          icon: 'aspect_of_the_hawk',
          effect: {
            ability: [
              { ability: 'aspect_of_the_hawk', buffPct: 0.4 },
              { ability: 'aspect_of_the_monkey', buffPct: 0.4 },
            ],
          },
        },
      ],
    },
    {
      level: 8,
      theme: 'traps',
      options: [
        {
          id: 'hun_r8_counter_shot',
          name: 'Counter Shot',
          description: 'Grants Counter Shot.',
          icon: 'counter_shot',
          effect: { grant: { ability: 'counter_shot' } },
        },
        {
          id: 'hun_r8_frost_trap',
          name: 'Frost Trap',
          description: 'Grants Frost Trap.',
          icon: 'frost_trap',
          effect: { grant: { ability: 'frost_trap' } },
        },
        {
          id: 'hun_r8_improved_concussive',
          name: 'Improved Concussive',
          description: 'Concussive Shot cooldown reduced by 40%.',
          icon: 'concussive_shot',
          effect: { ability: [{ ability: 'concussive_shot', cooldownPct: -0.4 }] },
        },
      ],
    },
    {
      level: 11,
      theme: 'survival',
      options: [
        {
          id: 'hun_r11_mend_pet',
          name: 'Mend Pet',
          description: 'Grants Mend Pet.',
          icon: 'mend_pet',
          effect: { grant: { ability: 'mend_pet' } },
        },
        {
          id: 'hun_r11_efficiency',
          name: 'Efficiency',
          description: 'Hunter shots cost 15% less.',
          icon: 'aimed_shot',
          effect: {
            ability: [
              { ability: 'serpent_sting', costPct: -0.15 },
              { ability: 'arcane_shot', costPct: -0.15 },
              { ability: 'concussive_shot', costPct: -0.15 },
              { ability: 'aimed_shot', costPct: -0.15 },
              { ability: 'counter_shot', costPct: -0.15 },
              { ability: 'multi_shot', costPct: -0.15 },
            ],
          },
        },
        {
          id: 'hun_r11_survival_instincts',
          name: 'Survival Instincts',
          description: 'Maximum health increased by 8% and dodge increased by 2%.',
          icon: 'aspect_of_the_monkey',
          effect: { stats: { maxHpPct: 0.08, dodge: 0.02 } },
        },
      ],
    },
    {
      level: 14,
      theme: 'marksmanship',
      options: [
        {
          id: 'hun_r14_multi_shot',
          name: 'Multi-Shot',
          description: 'Grants Multi-Shot.',
          icon: 'multi_shot',
          effect: { grant: { ability: 'multi_shot' } },
        },
        {
          id: 'hun_r14_sniper_training',
          name: 'Sniper Training',
          description: 'Aimed Shot cast time reduced by 30% and damage increased by 10%.',
          icon: 'aimed_shot',
          effect: { ability: [{ ability: 'aimed_shot', castPct: -0.3, dmgPct: 0.1 }] },
        },
        {
          id: 'hun_r14_serpents_venom',
          name: "Serpent's Venom",
          description: 'Arcane Shot also applies a short Nature damage over time effect.',
          icon: 'serpent_sting',
          effect: {
            ability: [
              {
                ability: 'arcane_shot',
                addEffects: [{ type: 'dot', total: 24, duration: 6, interval: 2 }],
              },
            ],
          },
        },
      ],
    },
    {
      level: 17,
      theme: 'defense',
      options: [
        {
          id: 'hun_r17_deterrence',
          name: 'Deterrence',
          description: 'Grants Deterrence.',
          icon: 'deterrence',
          effect: { grant: { ability: 'deterrence' } },
        },
        {
          id: 'hun_r17_master_tamer',
          name: 'Master Tamer',
          description: 'Tame Beast and Revive Pet cast times reduced by 50%.',
          icon: 'tame_beast',
          effect: {
            ability: [
              { ability: 'tame_beast', castPct: -0.5 },
              { ability: 'revive_pet', castPct: -0.5 },
            ],
          },
        },
        {
          id: 'hun_r17_thick_hide',
          name: 'Thick Hide',
          description: 'Armor increased by 10% and dodge increased by 2%.',
          icon: 'aspect_of_the_monkey',
          effect: { stats: { armorPct: 0.1, dodge: 0.02 } },
        },
      ],
    },
    {
      level: 20,
      theme: 'wilds',
      options: [
        {
          id: 'hun_r20_improved_volley',
          name: 'Improved Volley',
          description: 'Volley deals 30% more damage and costs 20% less.',
          icon: 'volley',
          effect: { ability: [{ ability: 'volley', dmgPct: 0.3, costPct: -0.2 }] },
        },
        {
          id: 'hun_r20_rapid_killing',
          name: 'Rapid Killing',
          description: 'Rapid Fire cooldown reduced by 50% and effect increased by 25%.',
          icon: 'rapid_fire',
          effect: { ability: [{ ability: 'rapid_fire', cooldownPct: -0.5, buffPct: 0.25 }] },
        },
        {
          id: 'hun_r20_aspect_of_the_wild',
          name: 'Aspect of the Wild',
          description: 'Grants Aspect of the Wild.',
          icon: 'aspect_of_the_wild',
          effect: { grant: { ability: 'aspect_of_the_wild' } },
        },
      ],
    },
  ],
};

export const ROGUE_CHOICE_ROWS: ClassChoiceRows = {
  rows: [
    {
      level: 5,
      theme: 'opener',
      options: [
        {
          id: 'rog_r5_relentless_strikes',
          name: 'Relentless Strikes',
          description: 'Sinister Strike costs 20% less.',
          icon: 'sinister_strike',
          effect: { ability: [{ ability: 'sinister_strike', costPct: -0.2 }] },
        },
        {
          id: 'rog_r5_improved_backstab',
          name: 'Improved Backstab',
          description: 'Backstab deals 25% more damage.',
          icon: 'backstab',
          effect: { ability: [{ ability: 'backstab', dmgPct: 0.25 }] },
        },
        {
          id: 'rog_r5_opportunist',
          name: 'Opportunist',
          description: 'Ambush and Garrote deal 25% more damage.',
          icon: 'ambush',
          effect: {
            ability: [
              { ability: 'ambush', dmgPct: 0.25 },
              { ability: 'garrote', dmgPct: 0.25 },
            ],
          },
        },
      ],
    },
    {
      level: 8,
      theme: 'control',
      options: [
        {
          id: 'rog_r8_kick',
          name: 'Kick',
          description: 'Grants Kick.',
          icon: 'kick',
          effect: { grant: { ability: 'kick' } },
        },
        {
          id: 'rog_r8_improved_gouge',
          name: 'Improved Gouge',
          description: 'Gouge cooldown and cost reduced by 30%.',
          icon: 'gouge',
          effect: { ability: [{ ability: 'gouge', cooldownPct: -0.3, costPct: -0.3 }] },
        },
        {
          id: 'rog_r8_improved_kidney_shot',
          name: 'Improved Kidney Shot',
          description: 'Kidney Shot costs 25% less.',
          icon: 'kidney_shot',
          effect: { ability: [{ ability: 'kidney_shot', costPct: -0.25 }] },
        },
      ],
    },
    {
      level: 11,
      theme: 'tempo',
      options: [
        {
          id: 'rog_r11_preparation',
          name: 'Preparation',
          description: 'Grants Preparation.',
          icon: 'preparation',
          effect: { grant: { ability: 'preparation' } },
        },
        {
          id: 'rog_r11_endurance',
          name: 'Endurance',
          description: 'Sprint and Evasion cooldowns reduced by 30%.',
          icon: 'sprint',
          effect: {
            ability: [
              { ability: 'sprint', cooldownPct: -0.3 },
              { ability: 'evasion', cooldownPct: -0.3 },
            ],
          },
        },
        {
          id: 'rog_r11_improved_slice_and_dice',
          name: 'Improved Slice and Dice',
          description: 'Slice and Dice effect increased by 25%.',
          icon: 'slice_and_dice',
          effect: { ability: [{ ability: 'slice_and_dice', buffPct: 0.25 }] },
        },
      ],
    },
    {
      level: 14,
      theme: 'assassination',
      options: [
        {
          id: 'rog_r14_seal_fate',
          name: 'Seal Fate',
          description: 'Eviscerate and Rupture deal 20% more damage.',
          icon: 'eviscerate',
          effect: {
            ability: [
              { ability: 'eviscerate', dmgPct: 0.2 },
              { ability: 'rupture', dmgPct: 0.2 },
            ],
          },
        },
        {
          id: 'rog_r14_ghostly_strike',
          name: 'Ghostly Strike',
          description: 'Grants Ghostly Strike.',
          icon: 'ghostly_strike',
          effect: { grant: { ability: 'ghostly_strike' } },
        },
        {
          id: 'rog_r14_deadly_brew',
          name: 'Deadly Brew',
          description: 'Poisons deal 30% more damage.',
          icon: 'deadly_poison',
          effect: {
            ability: [
              { ability: 'crippling_poison', dmgPct: 0.3 },
              { ability: 'instant_poison', dmgPct: 0.3 },
              { ability: 'deadly_poison', dmgPct: 0.3 },
            ],
          },
        },
      ],
    },
    {
      level: 17,
      theme: 'escape',
      options: [
        {
          id: 'rog_r17_cloak_of_shadows',
          name: 'Cloak of Shadows',
          description: 'Grants Cloak of Shadows.',
          icon: 'cloak_of_shadows',
          effect: { grant: { ability: 'cloak_of_shadows' } },
        },
        {
          id: 'rog_r17_improved_evasion',
          name: 'Improved Evasion',
          description: 'Evasion effect increased by 30% and cooldown reduced by 20%.',
          icon: 'evasion',
          effect: { ability: [{ ability: 'evasion', buffPct: 0.3, cooldownPct: -0.2 }] },
        },
        {
          id: 'rog_r17_cheat_death',
          name: 'Cheat Death',
          description: 'Maximum health increased by 10% and dodge increased by 3%.',
          icon: 'vanish',
          effect: { stats: { maxHpPct: 0.1, dodge: 0.03 } },
        },
      ],
    },
    {
      level: 20,
      theme: 'mastery',
      options: [
        {
          id: 'rog_r20_shadowstep',
          name: 'Shadowstep',
          description: 'Grants Shadowstep.',
          icon: 'shadowstep',
          effect: { grant: { ability: 'shadowstep' } },
        },
        {
          id: 'rog_r20_adrenaline_junkie',
          name: 'Adrenaline Junkie',
          description: 'Adrenaline Rush cooldown reduced by 40%.',
          icon: 'adrenaline_rush',
          effect: { ability: [{ ability: 'adrenaline_rush', cooldownPct: -0.4 }] },
        },
        {
          id: 'rog_r20_master_assassin',
          name: 'Master Assassin',
          description: 'Critical strike chance increased by 5%.',
          icon: 'ambush',
          effect: { stats: { crit: 0.05 } },
        },
      ],
    },
  ],
};

export const PRIEST_CHOICE_ROWS: ClassChoiceRows = {
  rows: [
    {
      level: 5,
      theme: 'faith',
      options: [
        {
          id: 'pri_r5_searing_light',
          name: 'Searing Light',
          description: 'Smite deals 25% more damage.',
          icon: 'smite',
          effect: { ability: [{ ability: 'smite', dmgPct: 0.25 }] },
        },
        {
          id: 'pri_r5_improved_renew',
          name: 'Improved Renew',
          description: 'Renew heals 25% more.',
          icon: 'renew',
          effect: { ability: [{ ability: 'renew', dmgPct: 0.25 }] },
        },
        {
          id: 'pri_r5_twisted_faith',
          name: 'Twisted Faith',
          description: 'Shadow Word: Pain deals 20% more damage.',
          icon: 'shadow_word_pain',
          effect: { ability: [{ ability: 'shadow_word_pain', dmgPct: 0.2 }] },
        },
      ],
    },
    {
      level: 8,
      theme: 'control',
      options: [
        {
          id: 'pri_r8_silence',
          name: 'Silence',
          description: 'Grants Silence.',
          icon: 'silence',
          effect: { grant: { ability: 'silence' } },
        },
        {
          id: 'pri_r8_psychic_scream',
          name: 'Psychic Scream',
          description: 'Grants Psychic Scream.',
          icon: 'psychic_scream',
          effect: { grant: { ability: 'psychic_scream' } },
        },
        {
          id: 'pri_r8_improved_shield',
          name: 'Improved Shield',
          description: 'Power Word: Shield absorbs 25% more.',
          icon: 'power_word_shield',
          effect: { ability: [{ ability: 'power_word_shield', dmgPct: 0.25 }] },
        },
      ],
    },
    {
      level: 11,
      theme: 'discipline',
      options: [
        {
          id: 'pri_r11_inner_focus',
          name: 'Inner Focus',
          description: 'Grants Inner Focus.',
          icon: 'inner_focus',
          effect: { grant: { ability: 'inner_focus' } },
        },
        {
          id: 'pri_r11_meditation',
          name: 'Meditation',
          description: 'Priest heals cost 15% less.',
          icon: 'lesser_heal',
          effect: {
            ability: [
              { ability: 'lesser_heal', costPct: -0.15 },
              { ability: 'heal', costPct: -0.15 },
              { ability: 'flash_heal', costPct: -0.15 },
              { ability: 'prayer_of_healing', costPct: -0.15 },
            ],
          },
        },
        {
          id: 'pri_r11_vampiric_embrace',
          name: 'Vampiric Embrace',
          description: 'Mind Blast deals 15% more damage.',
          icon: 'mind_blast',
          effect: { ability: [{ ability: 'mind_blast', dmgPct: 0.15 }] },
        },
      ],
    },
    {
      level: 14,
      theme: 'focus',
      options: [
        {
          id: 'pri_r14_mind_melt',
          name: 'Mind Melt',
          description: 'Mind Blast cooldown reduced by 40%.',
          icon: 'mind_blast',
          effect: { ability: [{ ability: 'mind_blast', cooldownPct: -0.4 }] },
        },
        {
          id: 'pri_r14_greater_heal',
          name: 'Greater Heal',
          description: 'Heal restores 25% more and casts 15% faster.',
          icon: 'heal',
          effect: { ability: [{ ability: 'heal', dmgPct: 0.25, castPct: -0.15 }] },
        },
        {
          id: 'pri_r14_pain_and_suffering',
          name: 'Pain and Suffering',
          description: 'Shadow Word: Pain and Mind Flay deal 15% more damage.',
          icon: 'mind_flay',
          effect: {
            ability: [
              { ability: 'shadow_word_pain', dmgPct: 0.15 },
              { ability: 'mind_flay', dmgPct: 0.15 },
            ],
          },
        },
      ],
    },
    {
      level: 17,
      theme: 'resilience',
      options: [
        {
          id: 'pri_r17_desperate_prayer',
          name: 'Desperate Prayer',
          description: 'Grants Desperate Prayer.',
          icon: 'desperate_prayer',
          effect: { grant: { ability: 'desperate_prayer' } },
        },
        {
          id: 'pri_r17_improved_fortitude',
          name: 'Improved Fortitude',
          description: 'Power Word: Fortitude effect increased by 50%.',
          icon: 'power_word_fortitude',
          effect: { ability: [{ ability: 'power_word_fortitude', buffPct: 0.5 }] },
        },
        {
          id: 'pri_r17_inner_fire',
          name: 'Inner Fire',
          description: 'Armor increased by 10% and Spirit increased by 3.',
          icon: 'power_word_shield',
          effect: { stats: { armorPct: 0.1, spi: 3 } },
        },
      ],
    },
    {
      level: 20,
      theme: 'prayer',
      options: [
        {
          id: 'pri_r20_prayer_of_healing',
          name: 'Prayer of Healing',
          description: 'Grants Prayer of Healing.',
          icon: 'prayer_of_healing',
          effect: { grant: { ability: 'prayer_of_healing' } },
        },
        {
          id: 'pri_r20_mind_sear',
          name: 'Mind Sear',
          description: 'Grants Mind Sear.',
          icon: 'mind_sear',
          effect: { grant: { ability: 'mind_sear' } },
        },
        {
          id: 'pri_r20_blessed_recovery',
          name: 'Blessed Recovery',
          description: 'Flash Heal casts 25% faster and costs 25% less.',
          icon: 'flash_heal',
          effect: { ability: [{ ability: 'flash_heal', castPct: -0.25, costPct: -0.25 }] },
        },
      ],
    },
  ],
};
