import type { ClassChoiceRows } from './choice_rows';

const mageSpellAbilityIds = [
  // Any new mage spell with a mana cost must be listed here, or Mana Attunement
  // will overstate its "mana spell" description.
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
  'icy_veins',
  'cone_of_cold',
  'flamestrike',
  'scorch',
  'pyroblast',
  'ice_barrier',
  'counterspell',
  'presence_of_mind',
  'blink',
  'ice_block',
  'deep_freeze',
  'meteor',
  'evocation',
];

export const WARRIOR_CHOICE_ROWS: ClassChoiceRows = {
  rows: [
    {
      level: 5,
      theme: 'onslaught',
      options: [
        {
          id: 'war_r5_twin_onrush',
          name: 'Twin Onrush',
          description:
            "Blaine1705's playtested tuning: Onrush stores 2 uses, so you can charge twice in a row.",
          icon: 'charge',
          effect: { ability: [{ ability: 'charge', bonusCharges: 1 }] },
        },
        {
          id: 'war_r5_hot_pursuit',
          name: 'Hot Pursuit',
          description:
            "Blaine1705's playtested tuning: each enemy you kill grants 30% movement speed for 6 sec.",
          icon: 'sprint',
          effect: { global: { onKillSpeedPct: 0.3, onKillSpeedDuration: 6 } },
        },
        {
          id: 'war_r5_crushing_onrush',
          name: 'Crushing Onrush',
          description:
            "Blaine1705's playtested tuning: Onrush also roots the target for 4 sec and slows it by 50% for 15 sec.",
          icon: 'charge',
          effect: {
            ability: [
              {
                ability: 'charge',
                addEffects: [
                  { type: 'root', duration: 4 },
                  { type: 'slow', mult: 0.5, duration: 15 },
                ],
              },
            ],
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
          name: 'Jawcrack',
          description: 'Interrupt spellcasting for a 4 sec school lockout.',
          icon: 'pummel',
          effect: { grant: { ability: 'pummel' } },
        },
        {
          id: 'war_r8_concussive_clap',
          name: 'Concussive Clap',
          description: 'Quaking Blow also roots targets hit within 8 yd for 1 sec.',
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
          description: 'Hamstring costs 66% less and slows the target by 70% for 15 sec.',
          icon: 'hamstring',
          effect: {
            ability: [
              {
                ability: 'hamstring',
                costPct: -0.66,
                addEffects: [{ type: 'slow', mult: 0.3, duration: 15 }],
              },
            ],
          },
        },
      ],
    },
    {
      level: 11,
      theme: 'bloodlust',
      options: [
        {
          id: 'war_r11_razor_howl',
          name: 'Razor Howl',
          description: 'Grants Razor Howl.',
          icon: 'demoralizing_shout',
          effect: { grant: { ability: 'razor_howl' } },
        },
        {
          id: 'war_r11_stormthrow',
          name: 'Stormthrow',
          description: 'Grants Stormthrow.',
          icon: 'throwing_axe',
          effect: { grant: { ability: 'stormthrow' } },
        },
        {
          id: 'war_r11_lingering_dread',
          name: 'Lingering Dread',
          description:
            "Blaine1705's playtested tuning: enemies feared by your shouts can endure 20% of their health in damage before the fear breaks.",
          icon: 'intimidating_shout',
          effect: { global: { fearBreakPct: 0.2 } },
        },
      ],
    },
    {
      level: 14,
      theme: 'arms_master',
      options: [
        {
          id: 'war_r14_crippling_blows',
          name: 'Crippling Blows',
          description: 'Rend also cripples the target, slowing movement by 50% for 15 sec.',
          icon: 'hamstring',
          effect: {
            ability: [{ ability: 'rend', addEffects: [{ type: 'slow', mult: 0.5, duration: 15 }] }],
          },
        },
        {
          id: 'war_r14_whirlwind',
          name: 'Bladed Gyre',
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
          id: 'war_r17_reckless_vow',
          name: 'Reckless Vow',
          description: 'Grants Reckless Vow.',
          icon: 'berserker_rage',
          effect: { grant: { ability: 'reckless_vow' } },
        },
        {
          id: 'war_r17_colossus',
          name: 'Colossus',
          description: 'Grants Colossus.',
          icon: 'avatar',
          effect: { grant: { ability: 'avatar' } },
        },
        {
          id: 'war_r17_red_harvest',
          name: 'Red Harvest',
          description:
            "Blaine1705's playtested tuning: each enemy you kill grants 5% critical strike and 5% damage dealt for 8 sec, stacking up to 25%.",
          icon: 'rend',
          effect: {
            global: { bloodbathPct: 0.05, bloodbathDuration: 8, bloodbathMaxPct: 0.25 },
          },
        },
      ],
    },
    {
      level: 20,
      theme: 'avatar',
      options: [
        {
          id: 'war_r20_giants_momentum',
          name: "Giant's Momentum",
          description:
            "Blaine1705's playtested tuning: each rage spent reduces major offensive cooldowns by 0.1 sec.",
          icon: 'avatar',
          effect: { global: { cdrPerRage: 0.1 } },
        },
        {
          id: 'war_r20_steel_cyclone',
          name: 'Steel Cyclone',
          description: 'Grants Steel Cyclone.',
          icon: 'bladestorm',
          effect: { grant: { ability: 'bladestorm' } },
        },
        {
          id: 'war_r20_red_banner',
          name: 'Red Banner',
          description: 'Grants Red Banner.',
          icon: 'rallying_cry',
          effect: { grant: { ability: 'red_banner' } },
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
          description: 'Every 3rd Fireball makes your next Fire Blast within 8 sec free.',
          icon: 'scorch',
          effect: {
            proc: {
              id: 'mag_firestarter',
              name: 'Firestarter',
              trigger: { on: 'castNth', n: 3, abilities: ['fireball'] },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_free',
                  abilities: ['fire_blast'],
                  duration: 8,
                },
              ],
            },
          },
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
          description:
            'Every 3rd mana spell restores 20 mana and makes your next spell within 8 sec cost 50% less.',
          icon: 'arcane_intellect',
          effect: {
            proc: {
              id: 'mag_mana_attunement',
              name: 'Mana Attunement',
              trigger: { on: 'castNth', n: 3, abilities: mageSpellAbilityIds },
              responses: [
                { kind: 'resource', amount: 20 },
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_cheap',
                  abilities: mageSpellAbilityIds,
                  duration: 8,
                  costPct: 0.5,
                },
              ],
            },
          },
        },
      ],
    },
    {
      level: 8,
      theme: 'counterplay',
      options: [
        {
          id: 'mag_r8_counterspell',
          name: 'Spellbreak',
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
          id: 'mag_r11_cone_of_cold',
          name: 'Frostsweep',
          description: 'Grants Cone of Cold.',
          icon: 'cone_of_cold',
          effect: { grant: { ability: 'cone_of_cold' } },
        },
        {
          id: 'mag_r11_shatter',
          name: 'Coldsnap Break',
          description: 'Spell critical chance against rooted targets increased by 30%.',
          icon: 'frostbolt',
          effect: { global: { critVsRooted: 0.3 } },
        },
        {
          id: 'mag_r11_permafrost',
          name: 'Deep Rime',
          description: 'Each Frost Nova grants you a shield absorbing 50 damage for 8 sec.',
          icon: 'ice_barrier',
          effect: {
            proc: {
              id: 'mag_deep_rime',
              name: 'Deep Rime',
              trigger: { on: 'castNth', n: 1, abilities: ['frost_nova'] },
              responses: [{ kind: 'absorb', amount: 50, duration: 8, name: 'Deep Rime' }],
            },
          },
        },
      ],
    },
    {
      level: 14,
      theme: 'tempo',
      options: [
        {
          id: 'mag_r14_presence_of_mind',
          name: 'Racing Mind',
          description: 'Grants Presence of Mind.',
          icon: 'presence_of_mind',
          effect: { grant: { ability: 'presence_of_mind' } },
        },
        {
          id: 'mag_r14_hot_streak',
          name: 'Slow Burn',
          description:
            'Every 3rd Fire spell makes your next Fireball or Pyroblast within 8 sec instant.',
          icon: 'pyroblast',
          effect: {
            proc: {
              id: 'mag_slow_burn',
              name: 'Slow Burn',
              trigger: {
                on: 'castNth',
                n: 3,
                abilities: ['fireball', 'fire_blast', 'scorch', 'pyroblast'],
              },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_instant',
                  abilities: ['fireball', 'pyroblast'],
                  duration: 8,
                },
              ],
            },
          },
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
          name: 'Flickerstep',
          description: 'Grants Blink.',
          icon: 'blink',
          effect: { grant: { ability: 'blink' } },
        },
        {
          id: 'mag_r17_ice_block',
          name: 'Cold Coffin',
          description: 'Grants Cold Coffin.',
          icon: 'ice_block',
          effect: { grant: { ability: 'ice_block' } },
        },
        {
          id: 'mag_r17_battlemage_armor',
          name: 'Battlemage Armor',
          description:
            'Taking a hit above 15% of your maximum health raises a ward absorbing 90 damage for 8 sec. 20 sec internal cooldown.',
          icon: 'frost_armor',
          effect: {
            proc: {
              id: 'mag_battlemage_armor',
              name: 'Battlemage Armor',
              trigger: { on: 'bigHitTaken', hpFrac: 0.15, icd: 20 },
              responses: [{ kind: 'absorb', amount: 90, duration: 8, name: 'Battlemage Armor' }],
            },
          },
        },
      ],
    },
    {
      level: 20,
      theme: 'capstone',
      options: [
        {
          id: 'mag_r20_deep_freeze',
          name: 'Deadfrost',
          description: 'Grants Deep Freeze.',
          icon: 'deep_freeze',
          effect: { grant: { ability: 'deep_freeze' } },
        },
        {
          id: 'mag_r20_meteor',
          name: 'Skystone',
          description: 'Grants Meteor.',
          icon: 'meteor',
          effect: { grant: { ability: 'meteor' } },
        },
        {
          id: 'mag_r20_evocation',
          name: 'Aetherwell',
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
          description:
            'Rite of Expulsion deals 25% more damage, costs 25% less, and Verdict resets its cooldown.',
          icon: 'exorcism',
          effect: {
            ability: [{ ability: 'exorcism', dmgPct: 0.25, costPct: -0.25 }],
            proc: {
              id: 'pal_vengeful_exorcism',
              name: 'Vengeful Exorcism',
              trigger: { on: 'castNth', n: 1, abilities: ['judgement'] },
              responses: [{ kind: 'cooldownRefund', ability: 'exorcism', seconds: 'reset' }],
            },
          },
        },
      ],
    },
    {
      level: 8,
      theme: 'justice',
      options: [
        {
          id: 'pal_r8_rebuke',
          name: 'Reproach',
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
          description:
            'Every 3rd healing spell you cast makes your next Mending Light within 10 sec instant.',
          icon: 'flash_of_light',
          effect: {
            proc: {
              id: 'pal_divine_wisdom',
              name: 'Divine Wisdom',
              trigger: { on: 'castNth', n: 3, abilities: ['holy_light', 'flash_of_light'] },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_instant',
                  abilities: ['holy_light'],
                  duration: 10,
                },
              ],
            },
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
          id: 'pal_r14_swift_verdicts',
          name: 'Swift Verdicts',
          description: 'Reduces the cooldown of Verdict by 40% and its mana cost by 20%.',
          icon: 'judgement',
          effect: { ability: [{ ability: 'judgement', cooldownPct: -0.4, costPct: -0.2 }] },
        },
        {
          id: 'pal_r14_holy_wrath',
          name: "Saint's Ire",
          description: 'Grants Holy Wrath.',
          icon: 'holy_wrath',
          effect: { grant: { ability: 'holy_wrath' } },
        },
        {
          id: 'pal_r14_righteous_cause',
          name: 'Righteous Cause',
          description:
            'Melee swings while your Oathbrand is active shave 0.5 sec off the cooldown of Verdict.',
          icon: 'seal_of_righteousness',
          effect: {
            proc: {
              id: 'pal_righteous_cause',
              name: 'Righteous Cause',
              trigger: { on: 'meleeSwingWhile', auraKind: 'imbue' },
              responses: [{ kind: 'cooldownRefund', ability: 'judgement', seconds: 0.5 }],
            },
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
          name: 'Lightward',
          description: 'Grants Divine Shield.',
          icon: 'divine_shield',
          effect: { grant: { ability: 'divine_shield' } },
        },
        {
          id: 'pal_r17_sacred_ward',
          name: 'Sacred Ward',
          description:
            'Last Rite also wraps its target in a sacred ward absorbing 120 damage for 10 sec.',
          icon: 'devotion_aura',
          effect: {
            ability: [
              {
                ability: 'lay_on_hands',
                addEffects: [{ type: 'absorb', amount: 120, duration: 10 }],
              },
            ],
          },
        },
        {
          id: 'pal_r17_ardent_defender',
          name: 'Deathless Ardor',
          description:
            'A blow that would kill you leaves you at 1 health instead. Once every 180 sec.',
          icon: 'divine_protection',
          effect: { global: { cheatDeathIcd: 180 } },
        },
      ],
    },
    {
      level: 20,
      theme: 'retribution',
      options: [
        {
          id: 'pal_r20_avenging_wrath',
          name: 'Wrathwing',
          description: 'Grants Avenging Wrath.',
          icon: 'avenging_wrath',
          effect: { grant: { ability: 'avenging_wrath' } },
        },
        {
          id: 'pal_r20_hammer_of_wrath',
          name: 'Tolling Hammer',
          description: 'Grants Hammer of Wrath.',
          icon: 'hammer_of_wrath',
          effect: { grant: { ability: 'hammer_of_wrath' } },
        },
        {
          id: 'pal_r20_aura_mastery',
          name: 'Radiant Swell',
          description: 'Grants Radiant Swell: overcharge your aura into a hardened bulwark.',
          icon: 'retribution_aura',
          effect: { grant: { ability: 'aura_surge' } },
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
          name: 'Improved Venom Barb',
          description: 'Every 3rd Venom Barb makes your next Fell Shot within 8 sec free.',
          icon: 'serpent_sting',
          effect: {
            proc: {
              id: 'hun_improved_venom_barb',
              name: 'Improved Venom Barb',
              trigger: { on: 'castNth', n: 3, abilities: ['serpent_sting'] },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_free',
                  abilities: ['arcane_shot'],
                  duration: 8,
                },
              ],
            },
          },
        },
        {
          id: 'hun_r5_quick_shots',
          name: 'Quick Shots',
          description: 'Fell Shot cooldown reduced by 40%.',
          icon: 'arcane_shot',
          effect: { ability: [{ ability: 'arcane_shot', cooldownPct: -0.4 }] },
        },
        {
          id: 'hun_r5_aspect_mastery',
          name: 'Aspect Mastery',
          description:
            "Changing into Harrier's Guise or Marten's Guise makes your next shot within 8 sec cost 50% less.",
          icon: 'aspect_of_the_hawk',
          effect: {
            proc: {
              id: 'hun_aspect_mastery',
              name: 'Aspect Mastery',
              trigger: {
                on: 'castNth',
                n: 1,
                abilities: ['aspect_of_the_hawk', 'aspect_of_the_monkey'],
              },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_cheap',
                  abilities: [
                    'serpent_sting',
                    'arcane_shot',
                    'concussive_shot',
                    'aimed_shot',
                    'counter_shot',
                    'multi_shot',
                    'volley',
                  ],
                  duration: 8,
                  costPct: 0.5,
                },
              ],
            },
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
          name: 'Hushing Shot',
          description: 'Grants Hushing Shot.',
          icon: 'counter_shot',
          effect: { grant: { ability: 'counter_shot' } },
        },
        {
          id: 'hun_r8_frost_trap',
          name: 'Rime Snare',
          description: 'Grants Rime Snare.',
          icon: 'frost_trap',
          effect: { grant: { ability: 'frost_trap' } },
        },
        {
          id: 'hun_r8_improved_concussive',
          name: 'Improved Concussive',
          description: 'Rattling Shot cooldown reduced by 40% and roots the target for 2 sec.',
          icon: 'concussive_shot',
          effect: {
            ability: [
              {
                ability: 'concussive_shot',
                cooldownPct: -0.4,
                addEffects: [{ type: 'root', duration: 2 }],
              },
            ],
          },
        },
      ],
    },
    {
      level: 11,
      theme: 'survival',
      options: [
        {
          id: 'hun_r11_mend_pet',
          name: 'Patch Up',
          description: 'Grants Patch Up.',
          icon: 'mend_pet',
          effect: { grant: { ability: 'mend_pet' } },
        },
        {
          id: 'hun_r11_efficiency',
          name: 'Lean Quiver',
          description:
            'Every 3rd ranged shot restores 20 mana and makes your next Long Draw within 8 sec instant.',
          icon: 'aimed_shot',
          effect: {
            proc: {
              id: 'hun_lean_quiver',
              name: 'Lean Quiver',
              trigger: {
                on: 'castNth',
                n: 3,
                abilities: [
                  'serpent_sting',
                  'arcane_shot',
                  'concussive_shot',
                  'aimed_shot',
                  'counter_shot',
                  'multi_shot',
                  'volley',
                ],
              },
              responses: [
                { kind: 'resource', amount: 20 },
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_instant',
                  abilities: ['aimed_shot'],
                  duration: 8,
                },
              ],
            },
          },
        },
        {
          id: 'hun_r11_survival_instincts',
          name: 'Deathless Will',
          description:
            'Taking a hit above 30% of your maximum health grants a shield absorbing 80 damage for 8 sec. 30 sec internal cooldown.',
          icon: 'aspect_of_the_monkey',
          effect: {
            proc: {
              id: 'hun_deathless_will',
              name: 'Deathless Will',
              trigger: { on: 'bigHitTaken', hpFrac: 0.3, icd: 30 },
              responses: [{ kind: 'absorb', amount: 80, duration: 8, name: 'Deathless Will' }],
            },
          },
        },
      ],
    },
    {
      level: 14,
      theme: 'marksmanship',
      options: [
        {
          id: 'hun_r14_multi_shot',
          name: 'Splitshot',
          description: 'Grants Splitshot.',
          icon: 'multi_shot',
          effect: { grant: { ability: 'multi_shot' } },
        },
        {
          id: 'hun_r14_sniper_training',
          name: 'Sniper Training',
          description: 'Rattling Shot makes your next Fell Shot within 8 sec free.',
          icon: 'aimed_shot',
          effect: {
            proc: {
              id: 'hun_sniper_training',
              name: 'Sniper Training',
              trigger: { on: 'castNth', n: 1, abilities: ['concussive_shot'] },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_free',
                  abilities: ['arcane_shot'],
                  duration: 8,
                },
              ],
            },
          },
        },
        {
          id: 'hun_r14_serpents_venom',
          name: "Serpent's Venom",
          description:
            'Fell Shot also envenoms the target for 24 Nature damage over 6 sec, ticking every 2 sec.',
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
          name: 'Bristleguard',
          description: 'Grants Bristleguard.',
          icon: 'deterrence',
          effect: { grant: { ability: 'deterrence' } },
        },
        {
          id: 'hun_r17_master_tamer',
          name: 'Master Tamer',
          description:
            'Your bond with your pet steels you: taking a hit above 30% of your maximum health grants a shield absorbing 60 damage for 8 sec. 20 sec cooldown.',
          icon: 'tame_beast',
          effect: {
            proc: {
              id: 'hun_master_tamer',
              name: 'Master Tamer',
              trigger: { on: 'bigHitTaken', hpFrac: 0.3, icd: 20 },
              responses: [{ kind: 'absorb', amount: 60, duration: 8, name: 'Master Tamer' }],
            },
          },
        },
        {
          id: 'hun_r17_thick_hide',
          name: 'Calloused Hide',
          description:
            'Taking a hit above 15% of your maximum health makes your next Aimed Shot within 8 sec instant. 15 sec internal cooldown.',
          icon: 'aspect_of_the_monkey',
          effect: {
            proc: {
              id: 'hun_calloused_hide',
              name: 'Calloused Hide',
              trigger: { on: 'bigHitTaken', hpFrac: 0.15, icd: 15 },
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
          description: 'Volley makes your next Fell Shot or Splitshot within 8 sec free.',
          icon: 'volley',
          effect: {
            proc: {
              id: 'hun_improved_volley',
              name: 'Improved Volley',
              trigger: { on: 'castNth', n: 1, abilities: ['volley'] },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_free',
                  abilities: ['arcane_shot', 'multi_shot'],
                  duration: 8,
                },
              ],
            },
          },
        },
        {
          id: 'hun_r20_rapid_killing',
          name: 'Rapid Killing',
          description: 'Fevered Draw cooldown reduced by 50% and effect increased by 25%.',
          icon: 'rapid_fire',
          effect: { ability: [{ ability: 'rapid_fire', cooldownPct: -0.5, buffPct: 0.25 }] },
        },
        {
          id: 'hun_r20_aspect_of_the_wild',
          name: 'Wildfang Guise',
          description: 'Grants Wildfang Guise.',
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
          name: 'Ceaseless Cuts',
          description: 'Sinister Strike costs 20% less.',
          icon: 'sinister_strike',
          effect: { ability: [{ ability: 'sinister_strike', costPct: -0.2 }] },
        },
        {
          id: 'rog_r5_improved_backstab',
          name: 'Improved Backstab',
          description: 'Craven Thrust makes your next Dirt Nap within 6 sec cost 50% less energy.',
          icon: 'backstab',
          effect: {
            proc: {
              id: 'rog_improved_backstab',
              name: 'Improved Backstab',
              trigger: { on: 'castNth', n: 1, abilities: ['backstab'] },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_cheap',
                  abilities: ['eviscerate'],
                  duration: 6,
                  costPct: 0.5,
                },
              ],
            },
          },
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
          name: 'Boot',
          description: 'Grants Kick.',
          icon: 'kick',
          effect: { grant: { ability: 'kick' } },
        },
        {
          id: 'rog_r8_improved_gouge',
          name: 'Improved Eye Jab',
          description: 'Gouge cooldown and cost reduced by 30%.',
          icon: 'gouge',
          effect: { ability: [{ ability: 'gouge', cooldownPct: -0.3, costPct: -0.3 }] },
        },
        {
          id: 'rog_r8_improved_kidney_shot',
          name: 'Improved Low Blow',
          description: 'Low Blow restores 15 energy when it lands.',
          icon: 'kidney_shot',
          effect: {
            proc: {
              id: 'rog_improved_low_blow',
              name: 'Improved Low Blow',
              trigger: { on: 'castNth', n: 1, abilities: ['kidney_shot'] },
              responses: [{ kind: 'resource', amount: 15 }],
            },
          },
        },
      ],
    },
    {
      level: 11,
      theme: 'tempo',
      options: [
        {
          id: 'rog_r11_preparation',
          name: 'Contingency',
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
          name: 'Improved Cutthroat Tempo',
          description: 'Every 3rd builder makes your next Cutthroat Tempo within 8 sec free.',
          icon: 'slice_and_dice',
          effect: {
            proc: {
              id: 'rog_improved_cutthroat_tempo',
              name: 'Improved Cutthroat Tempo',
              trigger: {
                on: 'castNth',
                n: 3,
                abilities: ['sinister_strike', 'backstab', 'gouge', 'ambush', 'garrote'],
              },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_free',
                  abilities: ['slice_and_dice'],
                  duration: 8,
                },
              ],
            },
          },
        },
      ],
    },
    {
      level: 14,
      theme: 'assassination',
      options: [
        {
          id: 'rog_r14_seal_fate',
          name: 'Final Notice',
          description:
            'Each Dirt Nap or Bleed Out makes your next builder within 8 sec cost 50% less energy.',
          icon: 'eviscerate',
          effect: {
            proc: {
              id: 'rog_final_notice',
              name: 'Final Notice',
              trigger: { on: 'castNth', n: 1, abilities: ['eviscerate', 'rupture'] },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_cheap',
                  abilities: ['sinister_strike', 'backstab', 'gouge'],
                  duration: 8,
                  costPct: 0.5,
                },
              ],
            },
          },
        },
        {
          id: 'rog_r14_ghostly_strike',
          name: 'Wraith Strike',
          description: 'Grants Ghostly Strike.',
          icon: 'ghostly_strike',
          effect: { grant: { ability: 'ghostly_strike' } },
        },
        {
          id: 'rog_r14_deadly_brew',
          name: 'Deadly Brew',
          description: 'Melee swings with an active poison restore 5 energy.',
          icon: 'deadly_poison',
          effect: {
            proc: {
              id: 'rog_deadly_brew',
              name: 'Deadly Brew',
              trigger: { on: 'meleeSwingWhile', auraKind: 'imbue' },
              responses: [{ kind: 'resource', amount: 5 }],
            },
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
          name: 'Shadecloak',
          description: 'Grants Cloak of Shadows.',
          icon: 'cloak_of_shadows',
          effect: { grant: { ability: 'cloak_of_shadows' } },
        },
        {
          id: 'rog_r17_improved_evasion',
          name: 'Improved Evasion',
          description:
            'Ghostfoot restores 30 energy and makes your next builder within 8 sec cost 50% less energy.',
          icon: 'evasion',
          effect: {
            proc: {
              id: 'rog_improved_evasion',
              name: 'Improved Evasion',
              trigger: { on: 'castNth', n: 1, abilities: ['evasion'] },
              responses: [
                { kind: 'resource', amount: 30 },
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_cheap',
                  abilities: ['sinister_strike', 'backstab', 'gouge'],
                  duration: 8,
                  costPct: 0.5,
                },
              ],
            },
          },
        },
        {
          id: 'rog_r17_cheat_death',
          name: 'Cheat Death',
          description:
            'A blow that would kill you leaves you at 1 health instead. Once every 120 sec.',
          icon: 'vanish',
          effect: { global: { cheatDeathIcd: 120 } },
        },
      ],
    },
    {
      level: 20,
      theme: 'mastery',
      options: [
        {
          id: 'rog_r20_shadowstep',
          name: 'Shadeslip',
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
          description: 'Each opener makes your next finisher within 6 sec cost 50% less energy.',
          icon: 'ambush',
          effect: {
            proc: {
              id: 'rog_master_assassin',
              name: 'Master Assassin',
              trigger: { on: 'castNth', n: 1, abilities: ['ambush', 'garrote', 'cheap_shot'] },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_cheap',
                  abilities: ['eviscerate', 'rupture', 'kidney_shot', 'slice_and_dice'],
                  duration: 6,
                  costPct: 0.5,
                },
              ],
            },
          },
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
          description:
            'Every 3rd Smite ignites your faith: your next healing spell within 8 sec is free.',
          icon: 'smite',
          effect: {
            proc: {
              id: 'pri_searing_light',
              name: 'Searing Light',
              trigger: { on: 'castNth', n: 3, abilities: ['smite'] },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_free',
                  abilities: ['lesser_heal', 'heal', 'flash_heal', 'renew', 'prayer_of_healing'],
                  duration: 8,
                },
              ],
            },
          },
        },
        {
          id: 'pri_r5_improved_renew',
          name: 'Improved Lingering Grace',
          description:
            'A Lingering Grace that runs its full course hardens into a ward absorbing 40 damage for 10 sec.',
          icon: 'renew',
          effect: {
            proc: {
              id: 'pri_lingering_ward',
              name: 'Lingering Grace',
              trigger: { on: 'hotExpired', ability: 'renew' },
              responses: [{ kind: 'absorb', amount: 40, duration: 10, name: 'Lingering Grace' }],
            },
          },
        },
        {
          id: 'pri_r5_twisted_faith',
          name: 'Twisted Faith',
          description:
            'Mindfracture deals 25% more damage to targets afflicted by your Dirge of Decay.',
          icon: 'shadow_word_pain',
          effect: { ability: [{ ability: 'mind_blast', dmgPctVsDotted: 0.25 }] },
        },
      ],
    },
    {
      level: 8,
      theme: 'control',
      options: [
        {
          id: 'pri_r8_silence',
          name: 'Silent Treatment',
          description: 'Grants Silence.',
          icon: 'silence',
          effect: { grant: { ability: 'silence' } },
        },
        {
          id: 'pri_r8_psychic_scream',
          name: 'Terror Shriek',
          description: 'Grants Psychic Scream.',
          icon: 'psychic_scream',
          effect: { grant: { ability: 'psychic_scream' } },
        },
        {
          id: 'pri_r8_improved_shield',
          name: 'Improved Shield',
          description:
            'When your Psalm of Warding is fully consumed, it bursts, healing its owner for 45.',
          icon: 'power_word_shield',
          effect: {
            proc: {
              id: 'pri_shield_burst',
              name: 'Improved Shield',
              trigger: { on: 'shieldConsumed', ability: 'power_word_shield' },
              responses: [{ kind: 'heal', amount: 45 }],
            },
          },
        },
      ],
    },
    {
      level: 11,
      theme: 'discipline',
      options: [
        {
          id: 'pri_r11_inner_focus',
          name: 'Stilled Mind',
          description: 'Grants Inner Focus.',
          icon: 'inner_focus',
          effect: { grant: { ability: 'inner_focus' } },
        },
        {
          id: 'pri_r11_meditation',
          name: 'Nocturns',
          description:
            'Every 3rd healing spell you cast makes your next heal within 10 sec cost 50% less.',
          icon: 'lesser_heal',
          effect: {
            proc: {
              id: 'pri_nocturns',
              name: 'Nocturns',
              trigger: {
                on: 'castNth',
                n: 3,
                abilities: ['lesser_heal', 'heal', 'flash_heal', 'renew', 'prayer_of_healing'],
              },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_cheap',
                  abilities: ['lesser_heal', 'heal', 'flash_heal', 'renew', 'prayer_of_healing'],
                  duration: 10,
                  costPct: 0.5,
                },
              ],
            },
          },
        },
        {
          id: 'pri_r11_vampiric_embrace',
          name: 'Leeching Dirge',
          description:
            'Mindfracture also afflicts the target for 30 damage over 3 sec, ticking every 1 sec and healing you for 100% of it.',
          icon: 'mind_blast',
          effect: {
            ability: [
              {
                ability: 'mind_blast',
                addEffects: [{ type: 'dot', total: 30, duration: 3, interval: 1, leechPct: 1 }],
              },
            ],
          },
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
          description:
            'Solemn Prayer leaves an echo for 10 sec: if the target falls below 35% health, they are instantly healed for 60.',
          icon: 'heal',
          effect: {
            proc: {
              id: 'pri_heal_echo',
              name: 'Greater Heal',
              trigger: { on: 'castNth', n: 1, abilities: ['heal'] },
              responses: [
                { kind: 'echo', belowFrac: 0.35, window: 10, heal: 60, name: 'Greater Heal' },
              ],
            },
          },
        },
        {
          id: 'pri_r14_pain_and_suffering',
          name: 'Pain and Suffering',
          description:
            'Each Litany of Woe tick extends your Shadow Word: Pain on the target by 1 sec, up to 6 added sec.',
          icon: 'mind_flay',
          effect: {
            ability: [
              {
                ability: 'mind_flay',
                addEffects: [
                  { type: 'extendDot', dot: 'shadow_word_pain', seconds: 1, maxBonus: 6 },
                ],
              },
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
          name: 'Last Prayer',
          description: 'Grants Desperate Prayer.',
          icon: 'desperate_prayer',
          effect: { grant: { ability: 'desperate_prayer' } },
        },
        {
          id: 'pri_r17_improved_fortitude',
          name: 'Improved Litany of Resolve',
          description: 'Power Word: Fortitude effect increased by 50%.',
          icon: 'power_word_fortitude',
          effect: { ability: [{ ability: 'power_word_fortitude', buffPct: 0.5 }] },
        },
        {
          id: 'pri_r17_inner_fire',
          name: 'Inner Fire',
          description:
            'Taking a hit above 15% of your maximum health kindles a ward absorbing 70 damage for 10 sec. 20 sec internal cooldown.',
          icon: 'power_word_shield',
          effect: {
            proc: {
              id: 'pri_inner_fire',
              name: 'Inner Fire',
              trigger: { on: 'bigHitTaken', hpFrac: 0.15, icd: 20 },
              responses: [{ kind: 'absorb', amount: 70, duration: 10, name: 'Inner Fire' }],
            },
          },
        },
      ],
    },
    {
      level: 20,
      theme: 'prayer',
      options: [
        {
          id: 'pri_r20_prayer_of_healing',
          name: 'Choirmend',
          description: 'Grants Prayer of Healing.',
          icon: 'prayer_of_healing',
          effect: { grant: { ability: 'prayer_of_healing' } },
        },
        {
          id: 'pri_r20_mind_sear',
          name: 'Thoughtburn',
          description: 'Grants Mind Sear.',
          icon: 'mind_sear',
          effect: { grant: { ability: 'mind_sear' } },
        },
        {
          id: 'pri_r20_blessed_recovery',
          name: 'Blessed Recovery',
          description: 'Your critical heals also ward the target, absorbing 50 damage for 10 sec.',
          icon: 'flash_heal',
          effect: {
            proc: {
              id: 'pri_blessed_recovery',
              name: 'Blessed Recovery',
              trigger: {
                on: 'spellCrit',
                abilities: ['lesser_heal', 'heal', 'flash_heal', 'prayer_of_healing'],
              },
              responses: [{ kind: 'absorb', amount: 50, duration: 10, name: 'Blessed Recovery' }],
            },
          },
        },
      ],
    },
  ],
};

export const SHAMAN_CHOICE_ROWS: ClassChoiceRows = {
  rows: [
    {
      level: 5,
      theme: 'elements',
      options: [
        {
          id: 'sha_r5_concussion',
          name: 'Fault Line',
          description:
            'Every 3rd Arc Bolt charges the earth: your next shock within 8 sec is free.',
          icon: 'lightning_bolt',
          effect: {
            proc: {
              id: 'sha_fault_line',
              name: 'Fault Line',
              trigger: { on: 'castNth', n: 3, abilities: ['lightning_bolt'] },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_free',
                  abilities: ['earth_shock', 'flame_shock', 'frost_shock'],
                  duration: 8,
                },
              ],
            },
          },
        },
        {
          id: 'sha_r5_improved_lightning_shield',
          name: 'Improved Thunder Ward',
          description:
            'When your Thunder Ward reflects a strike, your next Arc Bolt within 8 sec is instant.',
          icon: 'lightning_shield',
          effect: {
            proc: {
              id: 'sha_ward_surge',
              name: 'Thunder Ward',
              trigger: { on: 'thornsReflect' },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_instant',
                  abilities: ['lightning_bolt'],
                  duration: 8,
                },
              ],
            },
          },
        },
        {
          id: 'sha_r5_imbue_mastery',
          name: 'Imbue Mastery',
          description: 'Weapon imbues deal 30% more damage.',
          icon: 'rockbiter_weapon',
          effect: {
            ability: [
              { ability: 'rockbiter_weapon', dmgPct: 0.3 },
              { ability: 'flametongue_weapon', dmgPct: 0.3 },
              { ability: 'frostbrand_weapon', dmgPct: 0.3 },
            ],
          },
        },
      ],
    },
    {
      level: 8,
      theme: 'shocks',
      options: [
        {
          id: 'sha_r8_improved_earth_shock',
          name: 'Improved Earthen Jolt',
          description: 'Earth Shock also interrupts spellcasting for a 2 sec school lockout.',
          icon: 'earth_shock',
          effect: {
            ability: [{ ability: 'earth_shock', addEffects: [{ type: 'interrupt', lockout: 2 }] }],
          },
        },
        {
          id: 'sha_r8_frost_bind',
          name: 'Frost Bind',
          description: 'Rime Jolt also roots the target for 2 sec.',
          icon: 'frost_shock',
          effect: {
            ability: [{ ability: 'frost_shock', addEffects: [{ type: 'root', duration: 2 }] }],
          },
        },
        {
          id: 'sha_r8_shock_efficiency',
          name: 'Shock Efficiency',
          description: 'Shock costs reduced by 20%.',
          icon: 'earth_shock',
          effect: {
            ability: [
              { ability: 'earth_shock', costPct: -0.2 },
              { ability: 'flame_shock', costPct: -0.2 },
              { ability: 'frost_shock', costPct: -0.2 },
            ],
          },
        },
      ],
    },
    {
      level: 11,
      theme: 'restoration',
      options: [
        {
          id: 'sha_r11_ancestral_guidance',
          name: 'Guiding Spirits',
          description:
            'When your Mending Waters critically heals, your next Mending Waters within 10 sec is instant.',
          icon: 'healing_wave',
          effect: {
            proc: {
              id: 'sha_guiding_spirits',
              name: 'Guiding Spirits',
              trigger: { on: 'spellCrit', abilities: ['healing_wave'] },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_instant',
                  abilities: ['healing_wave'],
                  duration: 10,
                },
              ],
            },
          },
        },
        {
          id: 'sha_r11_elemental_attunement',
          name: 'Elemental Attunement',
          description: 'Lightning Bolt costs 20% less.',
          icon: 'lightning_bolt',
          effect: { ability: [{ ability: 'lightning_bolt', costPct: -0.2 }] },
        },
        {
          id: 'sha_r11_healing_stream',
          name: 'Springwell',
          description: 'Grants Healing Stream.',
          icon: 'healing_stream',
          effect: { grant: { ability: 'healing_stream' } },
        },
      ],
    },
    {
      level: 14,
      theme: 'storm',
      options: [
        {
          id: 'sha_r14_chain_lightning',
          name: 'Forked Lightning',
          description: 'Grants Chain Lightning.',
          icon: 'chain_lightning',
          effect: { grant: { ability: 'chain_lightning' } },
        },
        {
          id: 'sha_r14_improved_flame_shock',
          name: 'Improved Cinder Jolt',
          description:
            'Earthen Jolt detonates your Cinder Jolt on the target, dealing its remaining damage instantly.',
          icon: 'flame_shock',
          effect: {
            ability: [
              { ability: 'earth_shock', addEffects: [{ type: 'consumeDot', dot: 'flame_shock' }] },
            ],
          },
        },
        {
          id: 'sha_r14_weapon_fury',
          name: 'Weapon Fury',
          description: 'Melee swings with an imbued weapon shave 0.5 sec off your shock cooldowns.',
          icon: 'stormstrike',
          effect: {
            proc: {
              id: 'sha_weapon_fury',
              name: 'Weapon Fury',
              trigger: { on: 'meleeSwingWhile', auraKind: 'imbue' },
              responses: [
                { kind: 'cooldownRefund', ability: 'earth_shock', seconds: 0.5 },
                { kind: 'cooldownRefund', ability: 'flame_shock', seconds: 0.5 },
                { kind: 'cooldownRefund', ability: 'frost_shock', seconds: 0.5 },
              ],
            },
          },
        },
      ],
    },
    {
      level: 17,
      theme: 'warding',
      options: [
        {
          id: 'sha_r17_earthbind',
          name: 'Gripping Earth',
          description: 'Grants Earthbind.',
          icon: 'earthbind',
          effect: { grant: { ability: 'earthbind' } },
        },
        {
          id: 'sha_r17_improved_ghost_wolf',
          name: 'Improved Shadewolf',
          description: 'Ghost Wolf becomes instant.',
          icon: 'ghost_wolf',
          effect: { ability: [{ ability: 'ghost_wolf', castPct: -1 }] },
        },
        {
          id: 'sha_r17_elemental_warding',
          name: 'Elemental Warding',
          description:
            'Taking a hit above 15% of your maximum health raises an earthen shell absorbing 80 damage for 10 sec. 20 sec internal cooldown.',
          icon: 'lightning_shield',
          effect: {
            proc: {
              id: 'sha_elemental_warding',
              name: 'Elemental Warding',
              trigger: { on: 'bigHitTaken', hpFrac: 0.15, icd: 20 },
              responses: [{ kind: 'absorb', amount: 80, duration: 10, name: 'Elemental Warding' }],
            },
          },
        },
      ],
    },
    {
      level: 20,
      theme: 'bloodlust',
      options: [
        {
          id: 'sha_r20_bloodlust',
          name: 'War Drums',
          description: 'Grants Bloodlust.',
          icon: 'bloodlust',
          effect: { grant: { ability: 'bloodlust' } },
        },
        {
          id: 'sha_r20_elemental_fury',
          name: 'Earthen Fury',
          description: 'Critical strike chance increased by 5%.',
          icon: 'lightning_bolt',
          effect: { stats: { crit: 0.05 } },
        },
        {
          id: 'sha_r20_tidal_waves',
          name: 'Tidal Waves',
          description:
            'Every 3rd Mending Waters you cast makes your next Mending Waters within 10 sec instant.',
          icon: 'healing_wave',
          effect: {
            proc: {
              id: 'sha_tidal_waves',
              name: 'Tidal Waves',
              trigger: { on: 'castNth', n: 3, abilities: ['healing_wave'] },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_instant',
                  abilities: ['healing_wave'],
                  duration: 10,
                },
              ],
            },
          },
        },
      ],
    },
  ],
};

export const WARLOCK_CHOICE_ROWS: ClassChoiceRows = {
  rows: [
    {
      level: 5,
      theme: 'affliction',
      options: [
        {
          id: 'wlk_r5_bane',
          name: 'Hastened Doom',
          description: 'Shadow Bolt casts 20% faster.',
          icon: 'shadow_bolt',
          effect: { ability: [{ ability: 'shadow_bolt', castPct: -0.2 }] },
        },
        {
          id: 'wlk_r5_improved_corruption',
          name: 'Improved Blackrot',
          description: 'Corruption becomes instant.',
          icon: 'corruption',
          effect: { ability: [{ ability: 'corruption', castPct: -1 }] },
        },
        {
          id: 'wlk_r5_improved_immolate',
          name: 'Improved Immolate',
          description: 'Every 3rd Immolate makes your next Shadow Bolt within 8 sec instant.',
          icon: 'immolate',
          effect: {
            proc: {
              id: 'wlk_improved_immolate',
              name: 'Improved Immolate',
              trigger: { on: 'castNth', n: 3, abilities: ['immolate'] },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_instant',
                  abilities: ['shadow_bolt'],
                  duration: 8,
                },
              ],
            },
          },
        },
      ],
    },
    {
      level: 8,
      theme: 'control',
      options: [
        {
          id: 'wlk_r8_spell_lock',
          name: 'Gag Order',
          description: 'Grants Spell Lock.',
          icon: 'spell_lock',
          effect: { grant: { ability: 'spell_lock' } },
        },
        {
          id: 'wlk_r8_howl_of_terror',
          name: 'Dread Howl',
          description: 'Grants Howl of Terror.',
          icon: 'howl_of_terror',
          effect: { grant: { ability: 'howl_of_terror' } },
        },
        {
          id: 'wlk_r8_curse_of_exhaustion',
          name: 'Leaden Hex',
          description: 'Grants Curse of Exhaustion.',
          icon: 'curse_of_exhaustion',
          effect: { grant: { ability: 'curse_of_exhaustion' } },
        },
      ],
    },
    {
      level: 11,
      theme: 'demonology',
      options: [
        {
          id: 'wlk_r11_improved_life_tap',
          name: 'Improved Hard Bargain',
          description: 'Life Tap restores 30% more mana.',
          icon: 'life_tap',
          effect: { ability: [{ ability: 'life_tap', dmgPct: 0.3 }] },
        },
        {
          id: 'wlk_r11_fel_concentration',
          name: 'Unbroken Focus',
          description: 'Starting Drain Life restores 20 mana.',
          icon: 'drain_life',
          effect: {
            proc: {
              id: 'wlk_unbroken_focus',
              name: 'Unbroken Focus',
              trigger: { on: 'castNth', n: 1, abilities: ['drain_life'] },
              responses: [{ kind: 'resource', amount: 20 }],
            },
          },
        },
        {
          id: 'wlk_r11_demon_armor',
          name: 'Demon Armor',
          description:
            'Taking a hit above 15% of your maximum health raises a ward absorbing 60 damage for 10 sec. 20 sec internal cooldown.',
          icon: 'demon_skin',
          effect: {
            proc: {
              id: 'wlk_demon_armor',
              name: 'Demon Armor',
              trigger: { on: 'bigHitTaken', hpFrac: 0.15, icd: 20 },
              responses: [{ kind: 'absorb', amount: 60, duration: 10, name: 'Demon Armor' }],
            },
          },
        },
      ],
    },
    {
      level: 14,
      theme: 'destruction',
      options: [
        {
          id: 'wlk_r14_amplify_curse',
          name: 'Deepened Hex',
          description: 'Shadow Bolt deals 20% more damage to targets afflicted by your DoTs.',
          icon: 'curse_of_agony',
          effect: { ability: [{ ability: 'shadow_bolt', dmgPctVsDotted: 0.2 }] },
        },
        {
          id: 'wlk_r14_ruin',
          name: 'Desolation',
          description: 'Every 3rd Shadow Bolt makes your next Immolate within 8 sec instant.',
          icon: 'shadowburn',
          effect: {
            proc: {
              id: 'wlk_desolation',
              name: 'Desolation',
              trigger: { on: 'castNth', n: 3, abilities: ['shadow_bolt'] },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_instant',
                  abilities: ['immolate'],
                  duration: 8,
                },
              ],
            },
          },
        },
        {
          id: 'wlk_r14_shadow_mastery',
          name: 'Umbral Mastery',
          description: 'Each Fire spell makes your next Shadow spell within 8 sec cost 50% less.',
          icon: 'shadow_bolt',
          effect: {
            proc: {
              id: 'wlk_umbral_mastery',
              name: 'Umbral Mastery',
              trigger: { on: 'castNth', n: 1, abilities: ['immolate', 'searing_pain'] },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_cheap',
                  abilities: ['shadow_bolt', 'drain_life', 'curse_of_agony', 'corruption'],
                  duration: 8,
                  costPct: 0.5,
                },
              ],
            },
          },
        },
      ],
    },
    {
      level: 17,
      theme: 'horror',
      options: [
        {
          id: 'wlk_r17_death_coil',
          name: 'Grave Coil',
          description: 'Grants Death Coil.',
          icon: 'death_coil',
          effect: { grant: { ability: 'death_coil' } },
        },
        {
          id: 'wlk_r17_improved_fear',
          name: 'Improved Fear',
          description: 'Fear casts 30% faster.',
          icon: 'fear',
          effect: { ability: [{ ability: 'fear', castPct: -0.3 }] },
        },
        {
          id: 'wlk_r17_demonic_resilience',
          name: 'Unyielding Pact',
          description:
            'Taking a hit above 15% of your maximum health heals you for 50. 20 sec internal cooldown.',
          icon: 'demon_skin',
          effect: {
            proc: {
              id: 'wlk_unyielding_pact',
              name: 'Unyielding Pact',
              trigger: { on: 'bigHitTaken', hpFrac: 0.15, icd: 20 },
              responses: [{ kind: 'heal', amount: 50 }],
            },
          },
        },
      ],
    },
    {
      level: 20,
      theme: 'apotheosis',
      options: [
        {
          id: 'wlk_r20_chaos_bolt',
          name: 'Ruinbolt',
          description: 'Grants Chaos Bolt.',
          icon: 'chaos_bolt',
          effect: { grant: { ability: 'chaos_bolt' } },
        },
        {
          id: 'wlk_r20_grimoire_of_haste',
          name: 'Grimoire of Carnage',
          description:
            'Every 3rd curse, Fire, or Shadow spell raises a demonic ward absorbing 120 damage for 10 sec.',
          icon: 'summon_felhound',
          effect: {
            proc: {
              id: 'wlk_grimoire_of_carnage',
              name: 'Grimoire of Carnage',
              trigger: {
                on: 'castNth',
                n: 3,
                abilities: [
                  'corruption',
                  'curse_of_agony',
                  'immolate',
                  'shadow_bolt',
                  'drain_life',
                  'searing_pain',
                  'shadowburn',
                  'chaos_bolt',
                ],
              },
              responses: [
                { kind: 'absorb', amount: 120, duration: 10, name: 'Grimoire of Carnage' },
              ],
            },
          },
        },
        {
          id: 'wlk_r20_curse_mastery',
          name: 'Curse Mastery',
          description:
            'Every 3rd Corruption or Curse of Agony makes your next Shadow Bolt within 8 sec instant.',
          icon: 'curse_of_agony',
          effect: {
            proc: {
              id: 'wlk_curse_mastery',
              name: 'Curse Mastery',
              trigger: { on: 'castNth', n: 3, abilities: ['corruption', 'curse_of_agony'] },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_instant',
                  abilities: ['shadow_bolt'],
                  duration: 8,
                },
              ],
            },
          },
        },
      ],
    },
  ],
};

export const DRUID_CHOICE_ROWS: ClassChoiceRows = {
  rows: [
    {
      level: 5,
      theme: 'nature',
      options: [
        {
          id: 'dru_r5_improved_wrath',
          name: 'Improved Wildbolt',
          description: 'Every 3rd Wrath makes your next Moonfire within 8 sec free.',
          icon: 'wrath',
          effect: {
            proc: {
              id: 'dru_improved_wildbolt',
              name: 'Improved Wildbolt',
              trigger: { on: 'castNth', n: 3, abilities: ['wrath'] },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_free',
                  abilities: ['moonfire'],
                  duration: 8,
                },
              ],
            },
          },
        },
        {
          id: 'dru_r5_ferocity',
          name: 'Redmaw',
          description:
            'Shifting into Wolf Form makes your next Claw or Flense within 8 sec cost 50% less.',
          icon: 'claw',
          effect: {
            proc: {
              id: 'dru_redmaw',
              name: 'Redmaw',
              trigger: { on: 'castNth', n: 1, abilities: ['cat_form'] },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_cheap',
                  abilities: ['claw', 'rake'],
                  duration: 8,
                  costPct: 0.5,
                },
              ],
            },
          },
        },
        {
          id: 'dru_r5_natures_bounty',
          name: "Nature's Bounty",
          description:
            'When Rejuvenation runs its full duration, your next Regrowth within 8 sec is instant.',
          icon: 'rejuvenation',
          effect: {
            proc: {
              id: 'dru_natures_bounty',
              name: "Nature's Bounty",
              trigger: { on: 'hotExpired', ability: 'rejuvenation' },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_instant',
                  abilities: ['regrowth'],
                  duration: 8,
                },
              ],
            },
          },
        },
      ],
    },
    {
      level: 8,
      theme: 'feral',
      options: [
        {
          id: 'dru_r8_skull_bash',
          name: 'Headbutt',
          description: 'Grants Skull Bash.',
          icon: 'skull_bash',
          effect: { grant: { ability: 'skull_bash' } },
        },
        {
          id: 'dru_r8_improved_roots',
          name: 'Improved Roots',
          description: 'Entangling Roots costs 30% less and casts 30% faster.',
          icon: 'entangling_roots',
          effect: { ability: [{ ability: 'entangling_roots', costPct: -0.3, castPct: -0.3 }] },
        },
        {
          id: 'dru_r8_brutal_bash',
          name: 'Brutal Bash',
          description: 'Concuss restores 15 rage and makes your next Maul within 8 sec free.',
          icon: 'bash',
          effect: {
            proc: {
              id: 'dru_brutal_bash',
              name: 'Brutal Bash',
              trigger: { on: 'castNth', n: 1, abilities: ['bash'] },
              responses: [
                { kind: 'resource', amount: 15 },
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_free',
                  abilities: ['maul'],
                  duration: 8,
                },
              ],
            },
          },
        },
      ],
    },
    {
      level: 11,
      theme: 'restoration',
      options: [
        {
          id: 'dru_r11_innervate',
          name: 'Lifesap',
          description:
            'Grants Lifesap: living sap restores your current resource in waves, in any form.',
          icon: 'innervate',
          effect: { grant: { ability: 'innervate' } },
        },
        {
          id: 'dru_r11_furor',
          name: 'Wildsurge',
          description: 'Shapeshifting makes your next form attack within 8 sec cost 50% less.',
          icon: 'bear_form',
          effect: {
            proc: {
              id: 'dru_wildsurge',
              name: 'Wildsurge',
              trigger: {
                on: 'castNth',
                n: 1,
                abilities: ['bear_form', 'cat_form', 'travel_form'],
              },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_cheap',
                  abilities: ['maul', 'swipe', 'claw', 'rake', 'ferocious_bite', 'rip'],
                  duration: 8,
                  costPct: 0.5,
                },
              ],
            },
          },
        },
        {
          id: 'dru_r11_improved_mark',
          name: 'Improved Mark',
          description: 'Mark of the Wild also grants a shield absorbing 90 damage for 300 sec.',
          icon: 'mark_of_the_wild',
          effect: {
            proc: {
              id: 'dru_improved_mark',
              name: 'Improved Mark',
              trigger: { on: 'castNth', n: 1, abilities: ['mark_of_the_wild'] },
              responses: [{ kind: 'absorb', amount: 90, duration: 300, name: 'Improved Mark' }],
            },
          },
        },
      ],
    },
    {
      level: 14,
      theme: 'balance',
      options: [
        {
          id: 'dru_r14_savage_fury',
          name: 'Savage Fury',
          description:
            'Each Gorebite or Rip makes your next Claw or Flense within 8 sec cost 50% less.',
          icon: 'ferocious_bite',
          effect: {
            proc: {
              id: 'dru_savage_fury',
              name: 'Savage Fury',
              trigger: { on: 'castNth', n: 1, abilities: ['ferocious_bite', 'rip'] },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_cheap',
                  abilities: ['claw', 'rake'],
                  duration: 8,
                  costPct: 0.5,
                },
              ],
            },
          },
        },
        {
          id: 'dru_r14_moonfury',
          name: 'Moonspite',
          description: 'Moonfire makes your next Starfire within 8 sec instant.',
          icon: 'moonfire',
          effect: {
            proc: {
              id: 'dru_moonspite',
              name: 'Moonspite',
              trigger: { on: 'castNth', n: 1, abilities: ['moonfire'] },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_instant',
                  abilities: ['starfire'],
                  duration: 8,
                },
              ],
            },
          },
        },
        {
          id: 'dru_r14_empowered_touch',
          name: 'Empowered Touch',
          description:
            'Healing Touch leaves a stored heal of 60 that triggers if the target falls below 35% health within 8 sec.',
          icon: 'healing_touch',
          effect: {
            proc: {
              id: 'dru_empowered_touch',
              name: 'Empowered Touch',
              trigger: { on: 'castNth', n: 1, abilities: ['healing_touch'] },
              responses: [
                { kind: 'echo', belowFrac: 0.35, window: 8, heal: 60, name: 'Empowered Touch' },
              ],
            },
          },
        },
      ],
    },
    {
      level: 17,
      theme: 'survival',
      options: [
        {
          id: 'dru_r17_improved_barkskin',
          name: 'Improved Barkskin',
          description: 'Oakhide makes your next cast within 8 sec instant.',
          icon: 'barkskin',
          effect: {
            proc: {
              id: 'dru_improved_barkskin',
              name: 'Improved Barkskin',
              trigger: { on: 'castNth', n: 1, abilities: ['barkskin'] },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_instant',
                  abilities: ['wrath', 'starfire', 'healing_touch', 'regrowth'],
                  duration: 8,
                },
              ],
            },
          },
        },
        {
          id: 'dru_r17_frenzied_regeneration',
          name: 'Savage Mending',
          description: 'Grants Frenzied Regeneration.',
          icon: 'frenzied_regeneration',
          effect: { grant: { ability: 'frenzied_regeneration' } },
        },
        {
          id: 'dru_r17_survival_of_the_fittest',
          name: 'Survival of the Fittest',
          description:
            'Taking a hit above 20% of your maximum health restores 20 rage and shields you, absorbing 80 damage for 6 sec. 20 sec internal cooldown.',
          icon: 'bear_form',
          effect: {
            proc: {
              id: 'dru_survival_of_the_fittest',
              name: 'Survival of the Fittest',
              trigger: { on: 'bigHitTaken', hpFrac: 0.2, icd: 20 },
              responses: [
                { kind: 'resource', amount: 20 },
                { kind: 'absorb', amount: 80, duration: 6, name: 'Survival of the Fittest' },
              ],
            },
          },
        },
      ],
    },
    {
      level: 20,
      theme: 'harmony',
      options: [
        {
          id: 'dru_r20_improved_hurricane',
          name: 'Improved Hurricane',
          description:
            'Hurricane refunds 4 sec of its cooldown and makes your next Moonfire within 8 sec free.',
          icon: 'hurricane',
          effect: {
            proc: {
              id: 'dru_improved_hurricane',
              name: 'Improved Hurricane',
              trigger: { on: 'castNth', n: 1, abilities: ['hurricane'] },
              responses: [
                { kind: 'cooldownRefund', ability: 'hurricane', seconds: 4 },
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_free',
                  abilities: ['moonfire'],
                  duration: 8,
                },
              ],
            },
          },
        },
        {
          id: 'dru_r20_berserk',
          name: 'Red Haze',
          description: 'Grants Berserk.',
          icon: 'berserk',
          effect: { grant: { ability: 'berserk' } },
        },
        {
          id: 'dru_r20_tranquility',
          name: 'Gladesong',
          description: 'Grants Tranquility.',
          icon: 'tranquility',
          effect: { grant: { ability: 'tranquility' } },
        },
      ],
    },
  ],
};
