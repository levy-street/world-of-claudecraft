import type { ClassChoiceRows } from './talent_rows';

const mageManaSpendingSpellAbilityIds = [
  // Any new mage spell with a mana cost must be listed here, or Third Current
  // will overstate its "mana-spending spell" description.
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
  'cone_of_cold',
  'flamestrike',
  'scorch',
  'pyroblast',
  'ice_barrier',
  'counterspell',
  'blink',
  'ice_block',
  'deep_freeze',
  'meteor',
];

const mageDamagingFireSpellAbilityIds = [
  'fireball',
  'fire_blast',
  'flamestrike',
  'scorch',
  'pyroblast',
  'meteor',
];

const mageCastTimeCombatSpellAbilityIds = [
  'fireball',
  'frostbolt',
  'polymorph',
  'flamestrike',
  'scorch',
  'pyroblast',
];

const hunterRangedShotAbilityIds = [
  'auto_shot',
  'serpent_sting',
  'arcane_shot',
  'concussive_shot',
  'aimed_shot',
  'wyvern_sting',
  'counter_shot',
  'multi_shot',
  'volley',
];

const rogueBuilderAbilityIds = [
  'sinister_strike',
  'backstab',
  'gouge',
  'ambush',
  'garrote',
  'cheap_shot',
  'hemorrhage',
  'ghostly_strike',
];

const rogueFinisherAbilityIds = [
  'eviscerate',
  'rupture',
  'kidney_shot',
  'slice_and_dice',
  'expose_armor',
];

const priestManaHealingAbilityIds = [
  'lesser_heal',
  'renew',
  'heal',
  'flash_heal',
  'holy_nova',
  'prayer_of_healing',
];

const warlockDamagingFireSpellAbilityIds = [
  'immolate',
  'searing_pain',
  'rain_of_fire',
  'chaos_bolt',
  'conflagrate',
];

const warlockDamagingShadowSpellAbilityIds = [
  'shadow_bolt',
  'corruption',
  'curse_of_agony',
  'drain_life',
  'shadowburn',
  'siphon_life',
  'death_coil',
];

const warlockDamagingFireOrShadowSpellAbilityIds = [
  ...warlockDamagingFireSpellAbilityIds,
  ...warlockDamagingShadowSpellAbilityIds,
];

export const MAGE_CHOICE_ROWS: ClassChoiceRows = {
  rows: [
    {
      level: 5,
      theme: 'spell_economy',
      decision: 'Cinderbolt reset combo vs banked Cinderfalls vs broad mana economy',
      options: [
        {
          id: 'mag_r5_firestarter',
          name: 'Cinder Reprise',
          description:
            'Every 3rd Cinderbolt resets Cinderfall and makes your next Cinderfall within 8 sec free.',
          icon: 'scorch',
          effect: {
            proc: {
              id: 'mag_firestarter',
              name: 'Cinder Reprise',
              trigger: { on: 'castNth', n: 3, abilities: ['fireball'] },
              responses: [
                { kind: 'cooldownRefund', ability: 'fire_blast', seconds: 'reset' },
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
          name: 'Twin Embers',
          description: 'Cinderfall stores 2 uses.',
          icon: 'fire_blast',
          effect: { ability: [{ ability: 'fire_blast', bonusCharges: 1 }] },
        },
        {
          id: 'mag_r5_mana_attunement',
          name: 'Third Current',
          description:
            'Every 3rd mana-spending Mage spell restores 8% of your maximum mana and makes your next mana-spending Mage spell within 8 sec cost 50% less.',
          icon: 'arcane_intellect',
          effect: {
            proc: {
              id: 'mag_mana_attunement',
              name: 'Third Current',
              trigger: { on: 'castNth', n: 3, abilities: mageManaSpendingSpellAbilityIds },
              responses: [
                { kind: 'resource', pctMax: 0.08, resourceType: 'mana' },
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_cheap',
                  abilities: mageManaSpendingSpellAbilityIds,
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
      decision: 'spellsteal vs Icebind-to-Rimelance vs Bewitch-to-Darts',
      options: [
        {
          id: 'mag_r8_spellsteal',
          name: 'Spellsteal',
          description:
            'Grants Spellsteal: steal a beneficial magic buff from an enemy onto yourself.',
          icon: 'spellsteal',
          effect: { grant: { ability: 'spellsteal' } },
        },
        {
          id: 'mag_r8_ice_nova',
          name: 'Rime Ambush',
          description: 'Icebind makes your next Rimelance within 8 sec instant.',
          icon: 'frost_nova',
          effect: {
            proc: {
              id: 'mag_rime_ambush',
              name: 'Rime Ambush',
              trigger: { on: 'castNth', n: 1, abilities: ['frost_nova'] },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_instant',
                  abilities: ['frostbolt'],
                  duration: 8,
                },
              ],
            },
          },
        },
        {
          id: 'mag_r8_quick_wits',
          name: "Witch's Opening",
          description: 'Bewitch makes your next Aether Darts within 8 sec free.',
          icon: 'polymorph',
          effect: {
            proc: {
              id: 'mag_witchs_opening',
              name: "Witch's Opening",
              trigger: { on: 'castNth', n: 1, abilities: ['polymorph'] },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_free',
                  abilities: ['arcane_missiles'],
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
      theme: 'frozen_payoff',
      decision: 'instant frost sweep vs control-fed spell crits vs Icebind ward',
      options: [
        {
          id: 'mag_r11_cone_of_cold',
          name: 'Frostsweep',
          description: 'Grants Frostsweep.',
          icon: 'cone_of_cold',
          effect: { grant: { ability: 'cone_of_cold' } },
        },
        {
          id: 'mag_r11_shatter',
          name: 'Brittle Moment',
          description:
            'Direct-damage spells gain 30% critical strike chance against targets that are rooted, slowed, stunned, incapacitated, polymorphed, or in stasis.',
          icon: 'frostbolt',
          effect: { global: { critVsRooted: 0.3 } },
        },
        {
          id: 'mag_r11_permafrost',
          name: 'Deep Rime',
          description: 'Each Icebind grants you a shield absorbing 50 damage for 8 sec.',
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
      theme: 'casting_tempo',
      decision: 'on-demand instant cast vs fire-cadence instant cast vs mobile channel',
      options: [
        {
          id: 'mag_r14_presence_of_mind',
          name: 'Racing Mind',
          description:
            'A spell critical strike makes your next cast-time combat spell within 8 sec instant. 15 sec internal cooldown.',
          icon: 'presence_of_mind',
          effect: {
            proc: {
              id: 'mag_racing_mind',
              name: 'Racing Mind',
              school: 'arcane',
              trigger: { on: 'spellCrit', icd: 15 },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_instant',
                  abilities: mageCastTimeCombatSpellAbilityIds,
                  duration: 8,
                },
              ],
            },
          },
        },
        {
          id: 'mag_r14_hot_streak',
          name: 'Slow Burn',
          description:
            'Every 3rd damaging Fire spell makes your next Cinderbolt or Pyrelance within 8 sec instant.',
          icon: 'pyroblast',
          effect: {
            proc: {
              id: 'mag_slow_burn',
              name: 'Slow Burn',
              trigger: {
                on: 'castNth',
                n: 3,
                abilities: mageDamagingFireSpellAbilityIds,
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
          name: 'Dartstride',
          description: 'Aether Darts is channelable while moving.',
          icon: 'arcane_missiles',
          effect: { ability: [{ ability: 'arcane_missiles', castWhileMoving: true }] },
        },
      ],
    },
    {
      level: 17,
      theme: 'survival',
      decision: 'reactive escape-and-counter vs emergency stasis vs reactive ward',
      options: [
        {
          id: 'mag_r17_frigid_reversal',
          name: 'Frigid Reversal',
          description:
            'Taking a hit for at least 15% of your maximum health resets Flickerstep and makes your next Rimelance within 8 sec instant. 20 sec internal cooldown.',
          icon: 'frostbolt',
          effect: {
            proc: {
              id: 'mag_frigid_reversal',
              name: 'Frigid Reversal',
              school: 'frost',
              trigger: { on: 'bigHitTaken', hpFrac: 0.15, icd: 20 },
              responses: [
                { kind: 'cooldownRefund', ability: 'blink', seconds: 'reset' },
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_instant',
                  abilities: ['frostbolt'],
                  duration: 8,
                },
              ],
            },
          },
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
          name: 'Glassward Reflex',
          description:
            'Taking a hit for at least 15% of your maximum health raises a ward absorbing 90 damage for 8 sec. 20 sec internal cooldown.',
          icon: 'frost_armor',
          effect: {
            proc: {
              id: 'mag_battlemage_armor',
              name: 'Glassward Reflex',
              trigger: { on: 'bigHitTaken', hpFrac: 0.15, icd: 20 },
              responses: [{ kind: 'absorb', amount: 90, duration: 8, name: 'Glassward Reflex' }],
            },
          },
        },
      ],
    },
    {
      level: 20,
      theme: 'finishing_power',
      decision: 'single-target frost control vs area fire devastation vs mana recovery',
      options: [
        {
          id: 'mag_r20_deep_freeze',
          name: 'Deadfrost',
          description: 'Grants Deadfrost.',
          icon: 'deep_freeze',
          effect: { grant: { ability: 'deep_freeze' } },
        },
        {
          id: 'mag_r20_meteor',
          name: 'Skystone',
          description: 'Grants Skystone.',
          icon: 'meteor',
          effect: { grant: { ability: 'meteor' } },
        },
        {
          id: 'mag_r20_evocation',
          name: 'Aetherwell',
          description: 'Grants Aetherwell.',
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
      theme: 'holy_tempo',
      decision: 'Verdict-fed mana vs mobile Mending Light vs Verdict-Rite resets',
      options: [
        {
          id: 'pal_r5_crusaders_zeal',
          name: 'Oath Returned',
          description: 'Verdict restores 25 mana when cast.',
          icon: 'judgement',
          effect: {
            proc: {
              id: 'pal_oath_returned',
              name: 'Oath Returned',
              trigger: { on: 'castNth', n: 1, abilities: ['judgement'] },
              responses: [{ kind: 'resource', amount: 25, resourceType: 'mana' }],
            },
          },
        },
        {
          id: 'pal_r5_blessed_momentum',
          name: "Pilgrim's Light",
          description: 'Mending Light is castable while moving.',
          icon: 'holy_light',
          effect: { ability: [{ ability: 'holy_light', castWhileMoving: true }] },
        },
        {
          id: 'pal_r5_vengeful_exorcism',
          name: 'Ashen Sentence',
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
      decision: 'ally dispel vs banked stuns vs Holy Ground lockdown',
      options: [
        {
          id: 'pal_r8_cleansing_verdict',
          name: 'Cleansing Verdict',
          description:
            'Grants Cleansing Verdict: purge a harmful magic effect off an ally and heal them.',
          icon: 'cleansing_verdict',
          effect: { grant: { ability: 'cleansing_verdict' } },
        },
        {
          id: 'pal_r8_fist_of_justice',
          name: 'Twin Gavels',
          description: 'Sundering Gavel stores 2 uses.',
          icon: 'hammer_of_justice',
          effect: { ability: [{ ability: 'hammer_of_justice', bonusCharges: 1 }] },
        },
        {
          id: 'pal_r8_consecrated_ground',
          name: 'Hallowed Snare',
          description: 'Holy Ground also roots enemies within 8 yd for 2 sec.',
          icon: 'consecration',
          effect: {
            ability: [
              {
                ability: 'consecration',
                addEffects: [{ type: 'aoeRoot', duration: 2, radius: 8, min: 0, max: 0 }],
              },
            ],
          },
        },
      ],
    },
    {
      level: 11,
      theme: 'devotion',
      decision: 'healing cadence vs shield-to-emergency reset vs critical-heal wards',
      options: [
        {
          id: 'pal_r11_divine_wisdom',
          name: 'Third Benediction',
          description:
            'Every 3rd Mending Light or Lightmend makes your next Mending Light within 10 sec instant.',
          icon: 'flash_of_light',
          effect: {
            proc: {
              id: 'pal_divine_wisdom',
              name: 'Third Benediction',
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
          name: 'Mercy from Ruin',
          description:
            "When Ward of Faith is fully consumed, it shaves 120 sec off Last Rite's cooldown.",
          icon: 'divine_protection',
          effect: {
            proc: {
              id: 'pal_guardians_favor',
              name: 'Mercy from Ruin',
              trigger: { on: 'shieldConsumed', ability: 'divine_protection' },
              responses: [{ kind: 'cooldownRefund', ability: 'lay_on_hands', seconds: 120 }],
            },
          },
        },
        {
          id: 'pal_r11_greater_blessing',
          name: 'Afterglow Aegis',
          description:
            'Critical heals from Mending Light, Lightmend, and Last Rite also ward the target, absorbing 60 damage for 10 sec.',
          icon: 'blessing_of_might',
          effect: {
            proc: {
              id: 'pal_greater_blessing',
              name: 'Greater Blessing',
              trigger: {
                on: 'spellCrit',
                abilities: ['holy_light', 'flash_of_light', 'lay_on_hands'],
              },
              responses: [{ kind: 'absorb', amount: 60, duration: 10, name: 'Greater Blessing' }],
            },
          },
        },
      ],
    },
    {
      level: 14,
      theme: 'reckoning',
      decision: 'banked Verdicts vs area holy burst vs Oathbrand-fed Verdict tempo',
      options: [
        {
          id: 'pal_r14_swift_verdicts',
          name: 'Swift Verdicts',
          description: 'Verdict costs 20% less mana and deals 25% more damage.',
          icon: 'judgement',
          effect: { ability: [{ ability: 'judgement', costPct: -0.2, dmgPct: 0.25 }] },
        },
        {
          id: 'pal_r14_holy_wrath',
          name: "Saint's Ire",
          description: "Grants Saint's Ire.",
          icon: 'holy_wrath',
          effect: { grant: { ability: 'holy_wrath' } },
        },
        {
          id: 'pal_r14_righteous_cause',
          name: 'Oathwheel',
          description:
            'Landed melee attacks while your Oathbrand is active shave 0.5 sec off the cooldown of Verdict.',
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
      decision: 'personal bulwark vs ally emergency ward vs cheat death',
      options: [
        {
          id: 'pal_r17_divine_shield',
          name: 'Lightward',
          description: 'Grants Lightward.',
          icon: 'divine_shield',
          effect: { grant: { ability: 'divine_shield' } },
        },
        {
          id: 'pal_r17_sacred_ward',
          name: "Rite's Afterglow",
          description:
            'Last Rite also wraps its target in a sacred ward absorbing 360 damage for 10 sec.',
          icon: 'devotion_aura',
          effect: {
            ability: [
              {
                ability: 'lay_on_hands',
                addEffects: [{ type: 'absorb', amount: 360, duration: 10 }],
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
      theme: 'holy_arsenal',
      decision: 'self empowerment vs ranged execute vs silencing shield ricochet',
      options: [
        {
          id: 'pal_r20_avenging_wrath',
          name: 'Wrathwing',
          description: 'Grants Wrathwing.',
          icon: 'avenging_wrath',
          effect: { grant: { ability: 'avenging_wrath' } },
        },
        {
          id: 'pal_r20_hammer_of_wrath',
          name: 'Tolling Hammer',
          description: 'Grants Tolling Hammer.',
          icon: 'hammer_of_wrath',
          effect: { grant: { ability: 'hammer_of_wrath' } },
        },
        {
          id: 'pal_r20_aura_mastery',
          name: 'Dawnward Ricochet',
          description: 'Grants Dawnward Ricochet.',
          icon: 'holy_shield',
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
      theme: 'shot_cadence',
      decision: 'Venom Barb handoff vs banked Fell Shots vs guise-fed shot discount',
      options: [
        {
          id: 'hun_r5_improved_serpent_sting',
          name: 'Venom Relay',
          description: 'Venom Barb makes your next Fell Shot within 8 sec free.',
          icon: 'serpent_sting',
          effect: {
            proc: {
              id: 'hun_venom_relay',
              name: 'Venom Relay',
              trigger: { on: 'castNth', n: 1, abilities: ['serpent_sting'] },
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
          name: 'Twin Fletching',
          description: 'Fell Shot stores 2 uses.',
          icon: 'arcane_shot',
          effect: { ability: [{ ability: 'arcane_shot', bonusCharges: 1 }] },
        },
        {
          id: 'hun_r5_aspect_mastery',
          name: 'Guisecraft',
          description:
            "Changing into Harrier's Guise or Marten's Guise makes your next shot within 8 sec cost 50% less.",
          icon: 'aspect_of_the_hawk',
          effect: {
            proc: {
              id: 'hun_aspect_mastery',
              name: 'Guisecraft',
              trigger: {
                on: 'castNth',
                n: 1,
                abilities: ['aspect_of_the_hawk', 'aspect_of_the_monkey', 'aspect_of_the_cheetah'],
              },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_cheap',
                  abilities: hunterRangedShotAbilityIds,
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
      theme: 'ranged_control',
      decision: 'ranged disorient vs ground root vs frequent rooting shot',
      options: [
        {
          id: 'hun_r8_startle_shot',
          name: 'Startle Shot',
          description: 'Grants Startle Shot: a ranged disorient that breaks on any damage.',
          icon: 'startle_shot',
          effect: { grant: { ability: 'startle_shot' } },
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
          name: 'Pinning Barb',
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
      theme: 'sustain',
      decision: 'pet sustain vs shot-fed mana and instant aim vs reactive self-shield',
      options: [
        {
          id: 'hun_r11_mend_pet',
          name: 'Patch Up',
          description: 'Patch Up heals a living pet for 50% more.',
          icon: 'mend_pet',
          effect: { ability: [{ ability: 'revive_pet', dmgPct: 0.5 }] },
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
                abilities: hunterRangedShotAbilityIds,
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
            'Taking a hit for at least 30% of your maximum health grants a shield absorbing 200 damage for 8 sec. 30 sec internal cooldown.',
          icon: 'aspect_of_the_monkey',
          effect: {
            proc: {
              id: 'hun_deathless_will',
              name: 'Deathless Will',
              trigger: { on: 'bigHitTaken', hpFrac: 0.3, icd: 30 },
              responses: [{ kind: 'absorb', amount: 200, duration: 8, name: 'Deathless Will' }],
            },
          },
        },
      ],
    },
    {
      level: 14,
      theme: 'damage_profile',
      decision: 'area shot vs Long Draw follow-up vs venomous instant shot',
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
          description: "Long Draw's cast time is reduced by 30% and it deals 15% more damage.",
          icon: 'aimed_shot',
          effect: { ability: [{ ability: 'aimed_shot', castPct: -0.3, dmgPct: 0.15 }] },
        },
        {
          id: 'hun_r14_serpents_venom',
          name: 'Viperfletch',
          description:
            'Fell Shot also envenoms the target for 50% of its damage over 3 sec, ticking every 1 sec.',
          icon: 'serpent_sting',
          effect: {
            ability: [
              {
                ability: 'arcane_shot',
                addEffects: [
                  {
                    type: 'dot',
                    total: 0,
                    directPct: 0.5,
                    duration: 3,
                    interval: 1,
                    school: 'nature',
                  },
                ],
              },
            ],
          },
        },
      ],
    },
    {
      level: 17,
      theme: 'survival_response',
      decision: 'active avoidance vs pet damage sharing vs hit-fed instant aim',
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
          name: 'Bloodbond',
          description: 'While your pet is alive, 20% of damage you take is redirected to it.',
          icon: 'tame_beast',
          effect: { global: { petDmgSharePct: 0.2 } },
        },
        {
          id: 'hun_r17_thick_hide',
          name: 'Calloused Hide',
          description:
            'Taking a hit for at least 15% of your maximum health makes your next Long Draw within 8 sec instant. 15 sec internal cooldown.',
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
      theme: 'apex_hunt',
      decision: 'steadfast Arrowfall vs shot-fed burst uptime vs party attack rally',
      options: [
        {
          id: 'hun_r20_improved_volley',
          name: 'Steady Rain',
          description:
            'Arrowfall deals 50% more damage, and taking damage cannot shorten its channel.',
          icon: 'volley',
          effect: {
            ability: [{ ability: 'volley', dmgPct: 0.5, damagePushbackImmune: true }],
          },
        },
        {
          id: 'hun_r20_rapid_killing',
          name: 'Redline Draw',
          description: "Every 3rd ranged shot reduces Fevered Draw's cooldown by 15 sec.",
          icon: 'rapid_fire',
          effect: {
            proc: {
              id: 'hun_redline_draw',
              name: 'Redline Draw',
              trigger: { on: 'castNth', n: 3, abilities: hunterRangedShotAbilityIds },
              responses: [{ kind: 'cooldownRefund', ability: 'rapid_fire', seconds: 15 }],
            },
          },
        },
        {
          id: 'hun_r20_aspect_of_the_wild',
          name: 'Wildfang Rally',
          description: 'Grants Wildfang Rally.',
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
      theme: 'opening_rotation',
      decision: 'Wicked Slash cadence vs Craven Thrust weave vs opener energy',
      options: [
        {
          id: 'rog_r5_relentless_strikes',
          name: 'Ceaseless Cuts',
          description: 'Every 3rd Wicked Slash restores 30 energy.',
          icon: 'sinister_strike',
          effect: {
            proc: {
              id: 'rog_ceaseless_cuts',
              name: 'Ceaseless Cuts',
              trigger: { on: 'castNth', n: 3, abilities: ['sinister_strike'] },
              responses: [{ kind: 'resource', amount: 30, resourceType: 'energy' }],
            },
          },
        },
        {
          id: 'rog_r5_improved_backstab',
          name: "Knife's Dividend",
          description: 'Craven Thrust makes your next Dirt Nap within 6 sec cost 50% less energy.',
          icon: 'backstab',
          effect: {
            proc: {
              id: 'rog_improved_backstab',
              name: "Knife's Dividend",
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
          name: 'Dusk Dividend',
          description: "Using Lurker's Strike or Throat Wire restores 20 energy.",
          icon: 'ambush',
          effect: {
            proc: {
              id: 'rog_dusk_dividend',
              name: 'Dusk Dividend',
              trigger: { on: 'castNth', n: 1, abilities: ['ambush', 'garrote'] },
              responses: [{ kind: 'resource', amount: 20, resourceType: 'energy' }],
            },
          },
        },
      ],
    },
    {
      level: 8,
      theme: 'control',
      decision: 'evasive smoke vs Eye Jab follow-up vs Low Blow energy refund',
      options: [
        {
          id: 'rog_r8_smoke_screen',
          name: 'Smoke Screen',
          description: 'Grants Smoke Screen: a cloud that raises your dodge by 30% for 8 sec.',
          icon: 'smoke_screen',
          effect: { grant: { ability: 'smoke_screen' } },
        },
        {
          id: 'rog_r8_improved_gouge',
          name: 'Blindside Opening',
          description: 'Eye Jab makes your next Craven Thrust within 6 sec free.',
          icon: 'gouge',
          effect: {
            proc: {
              id: 'rog_blindside_opening',
              name: 'Blindside Opening',
              trigger: { on: 'castNth', n: 1, abilities: ['gouge'] },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_free',
                  abilities: ['backstab'],
                  duration: 6,
                },
              ],
            },
          },
        },
        {
          id: 'rog_r8_improved_kidney_shot',
          name: 'Paid in Pain',
          description: 'Low Blow restores 15 energy when used.',
          icon: 'kidney_shot',
          effect: {
            proc: {
              id: 'rog_improved_low_blow',
              name: 'Paid in Pain',
              trigger: { on: 'castNth', n: 1, abilities: ['kidney_shot'] },
              responses: [{ kind: 'resource', amount: 15 }],
            },
          },
        },
      ],
    },
    {
      level: 11,
      theme: 'cooldown_tempo',
      decision: 'full cooldown reset vs stored escape charges vs builder-fed free tempo',
      options: [
        {
          id: 'rog_r11_preparation',
          name: 'Contingency',
          description: 'Grants Contingency.',
          icon: 'preparation',
          effect: { grant: { ability: 'preparation' } },
        },
        {
          id: 'rog_r11_endurance',
          name: 'Second Exit',
          description: 'Swift Heels and Ghostfoot each store 2 uses.',
          icon: 'sprint',
          effect: {
            ability: [
              { ability: 'sprint', bonusCharges: 1 },
              { ability: 'evasion', bonusCharges: 1 },
            ],
          },
        },
        {
          id: 'rog_r11_improved_slice_and_dice',
          name: 'Borrowed Tempo',
          description: 'Every 3rd builder makes your next Cutthroat Tempo within 8 sec free.',
          icon: 'slice_and_dice',
          effect: {
            proc: {
              id: 'rog_improved_cutthroat_tempo',
              name: 'Borrowed Tempo',
              trigger: {
                on: 'castNth',
                n: 3,
                abilities: rogueBuilderAbilityIds,
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
      theme: 'combo_engine',
      decision: 'two-finisher builder discount vs evasive strike vs poison-fed energy',
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
                  abilities: rogueBuilderAbilityIds,
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
          description: 'Grants Wraith Strike.',
          icon: 'ghostly_strike',
          effect: { grant: { ability: 'ghostly_strike' } },
        },
        {
          id: 'rog_r14_deadly_brew',
          name: 'Venom Dividend',
          description: 'Landed melee auto-attacks with an active poison restore 5 energy.',
          icon: 'deadly_poison',
          effect: {
            proc: {
              id: 'rog_deadly_brew',
              name: 'Venom Dividend',
              trigger: { on: 'meleeSwingWhile', auraKind: 'imbue' },
              responses: [{ kind: 'resource', amount: 5 }],
            },
          },
        },
      ],
    },
    {
      level: 17,
      theme: 'survival_escape',
      decision: 'spell defense vs Ghostfoot burst energy vs lethal-hit insurance',
      options: [
        {
          id: 'rog_r17_cloak_of_shadows',
          name: 'Shadecloak',
          description: 'Grants Shadecloak.',
          icon: 'cloak_of_shadows',
          effect: { grant: { ability: 'cloak_of_shadows' } },
        },
        {
          id: 'rog_r17_improved_evasion',
          name: 'Ghostfoot Gambit',
          description:
            'Ghostfoot restores 30 energy and makes your next builder within 8 sec cost 50% less energy.',
          icon: 'evasion',
          effect: {
            proc: {
              id: 'rog_improved_evasion',
              name: 'Ghostfoot Gambit',
              trigger: { on: 'castNth', n: 1, abilities: ['evasion'] },
              responses: [
                { kind: 'resource', amount: 30 },
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_cheap',
                  abilities: rogueBuilderAbilityIds,
                  duration: 8,
                  costPct: 0.5,
                },
              ],
            },
          },
        },
        {
          id: 'rog_r17_cheat_death',
          name: 'Borrowed Breath',
          description:
            'A blow that would kill you leaves you at 1 health instead. Once every 120 sec.',
          icon: 'vanish',
          effect: { global: { cheatDeathIcd: 120 } },
        },
      ],
    },
    {
      level: 20,
      theme: 'capstone_execution',
      decision: 'target teleport vs finisher-fed haste cooldown vs opener-fed finisher discount',
      options: [
        {
          id: 'rog_r20_shadowstep',
          name: 'Shadeslip',
          description: 'Grants Shadeslip.',
          icon: 'shadowstep',
          effect: { grant: { ability: 'shadowstep' } },
        },
        {
          id: 'rog_r20_adrenaline_junkie',
          name: 'Redline Habit',
          description: "Each finisher reduces Quickened Blood's cooldown by 6 sec.",
          icon: 'adrenaline_rush',
          effect: {
            proc: {
              id: 'rog_adrenaline_junkie',
              name: 'Redline Habit',
              trigger: { on: 'castNth', n: 1, abilities: rogueFinisherAbilityIds },
              responses: [{ kind: 'cooldownRefund', ability: 'adrenaline_rush', seconds: 6 }],
            },
          },
        },
        {
          id: 'rog_r20_master_assassin',
          name: 'First Cut, Last Word',
          description: 'Each opener makes your next finisher within 6 sec cost 50% less energy.',
          icon: 'ambush',
          effect: {
            proc: {
              id: 'rog_master_assassin',
              name: 'First Cut, Last Word',
              trigger: { on: 'castNth', n: 1, abilities: ['ambush', 'garrote', 'cheap_shot'] },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_cheap',
                  abilities: rogueFinisherAbilityIds,
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
      decision: 'Scouring Hymn cadence vs prayer-cadence ward vs Dirge-gated Mindfracture damage',
      options: [
        {
          id: 'pri_r5_searing_light',
          name: 'Third Verse',
          description:
            'Every 3rd Scouring Hymn makes your next mana-cost healing spell within 8 sec free.',
          icon: 'smite',
          effect: {
            proc: {
              id: 'pri_searing_light',
              name: 'Third Verse',
              trigger: { on: 'castNth', n: 3, abilities: ['smite'] },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_free',
                  abilities: priestManaHealingAbilityIds,
                  duration: 8,
                },
              ],
            },
          },
        },
        {
          id: 'pri_r5_improved_renew',
          name: 'Warding Refrain',
          description:
            'Every 3rd Whispered Prayer hardens its target into a ward absorbing 40 damage for 10 sec.',
          icon: 'lesser_heal',
          effect: {
            proc: {
              id: 'pri_lingering_ward',
              name: 'Warding Refrain',
              trigger: { on: 'castNth', n: 3, abilities: ['lesser_heal'] },
              responses: [{ kind: 'absorb', amount: 40, duration: 10, name: 'Warding Refrain' }],
            },
          },
        },
        {
          id: 'pri_r5_twisted_faith',
          name: 'Dirgebound Thought',
          description:
            'Mindfracture deals 25% more damage to targets afflicted by your Dirge of Decay.',
          icon: 'shadow_word_pain',
          effect: {
            ability: [
              {
                ability: 'mind_blast',
                dmgPctVsDotted: 0.25,
                dmgPctVsDottedAbility: 'shadow_word_pain',
              },
            ],
          },
        },
      ],
    },
    {
      level: 8,
      theme: 'intercession',
      decision: 'single-target silence vs area fear vs consumed-shield heal',
      options: [
        {
          id: 'pri_r8_silence',
          name: 'Hushword',
          description: 'Grants Hushword.',
          icon: 'silence',
          effect: { grant: { ability: 'silence' } },
        },
        {
          id: 'pri_r8_psychic_scream',
          name: 'Terror Canticle',
          description: 'Grants Terror Canticle.',
          icon: 'psychic_scream',
          effect: { grant: { ability: 'psychic_scream' } },
        },
        {
          id: 'pri_r8_improved_shield',
          name: 'Shattered Psalm',
          description:
            'When your Psalm of Warding is fully consumed, it bursts, healing its owner for 45.',
          icon: 'power_word_shield',
          effect: {
            proc: {
              id: 'pri_shield_burst',
              name: 'Shattered Psalm',
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
      decision: 'on-demand free cast vs healing-cadence discount vs Mindfracture leech',
      options: [
        {
          id: 'pri_r11_inner_focus',
          name: 'Stilled Mind',
          description: 'Grants Stilled Mind.',
          icon: 'inner_focus',
          effect: { grant: { ability: 'inner_focus' } },
        },
        {
          id: 'pri_r11_meditation',
          name: 'Measured Mercy',
          description:
            'Every 3rd mana-cost healing spell makes your next mana-cost healing spell within 10 sec cost 50% less.',
          icon: 'lesser_heal',
          effect: {
            proc: {
              id: 'pri_nocturns',
              name: 'Measured Mercy',
              trigger: {
                on: 'castNth',
                n: 3,
                abilities: priestManaHealingAbilityIds,
              },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_cheap',
                  abilities: priestManaHealingAbilityIds,
                  duration: 10,
                  costPct: 0.5,
                },
              ],
            },
          },
        },
        {
          id: 'pri_r11_vampiric_embrace',
          name: 'Gloam Siphon',
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
      theme: 'investment',
      decision: 'single-target Dirge refresh vs emergency heal echo vs area Dirge spread',
      options: [
        {
          id: 'pri_r14_deathless_dirge',
          name: 'Deathless Dirge',
          description: 'Mindfracture refreshes your Dirge of Decay on its target.',
          icon: 'mind_blast',
          effect: {
            ability: [
              {
                ability: 'mind_blast',
                addEffects: [{ type: 'refreshDot', dot: 'shadow_word_pain' }],
              },
            ],
          },
        },
        {
          id: 'pri_r14_greater_heal',
          name: 'Mercy Deferred',
          description:
            'Solemn Prayer leaves an echo for 10 sec: if the target falls below 35% health, they are instantly healed for 60.',
          icon: 'heal',
          effect: {
            proc: {
              id: 'pri_heal_echo',
              name: 'Mercy Deferred',
              trigger: { on: 'castNth', n: 1, abilities: ['heal'] },
              responses: [
                { kind: 'echo', belowFrac: 0.35, window: 10, heal: 60, name: 'Mercy Deferred' },
              ],
            },
          },
        },
        {
          id: 'pri_r14_plague_chorus',
          name: 'Plague Chorus',
          description:
            'Mindfracture copies your Dirge of Decay on the target to enemies within 8 yards.',
          icon: 'mind_blast',
          effect: {
            ability: [
              {
                ability: 'mind_blast',
                addEffects: [{ type: 'spreadDot', dot: 'shadow_word_pain', radius: 8 }],
              },
            ],
          },
        },
      ],
    },
    {
      level: 17,
      theme: 'resilience',
      decision: 'long Litany commitment vs stronger party fortitude vs completion burst',
      options: [
        {
          id: 'pri_r17_ninefold_litany',
          name: 'Ninefold Litany',
          description: 'Litany of Woe channels for 9 sec and strikes 9 times.',
          icon: 'mind_flay',
          effect: { ability: [{ ability: 'mind_flay', channelDurationPct: 2 }] },
        },
        {
          id: 'pri_r17_improved_fortitude',
          name: 'Resolve Unbroken',
          description:
            'Litany of Resolve effect increased by 50%, granting your party 7.5% Stamina instead of 5%.',
          icon: 'power_word_fortitude',
          effect: { ability: [{ ability: 'power_word_fortitude', buffPct: 0.5 }] },
        },
        {
          id: 'pri_r17_woes_crescendo',
          name: "Woe's Crescendo",
          description:
            'The final tick of a completed Litany of Woe bursts for 36 Shadow damage to enemies within 8 yards of the target.',
          icon: 'mind_flay',
          effect: {
            ability: [
              {
                ability: 'mind_flay',
                addEffects: [{ type: 'channelFinisher', amount: 36, radius: 8 }],
              },
            ],
          },
        },
      ],
    },
    {
      level: 20,
      theme: 'prayer',
      decision: 'party healing vs area shadow damage vs critical-heal wards',
      options: [
        {
          id: 'pri_r20_prayer_of_healing',
          name: 'Choirmend',
          description: 'Grants Choirmend.',
          icon: 'prayer_of_healing',
          effect: { grant: { ability: 'prayer_of_healing' } },
        },
        {
          id: 'pri_r20_mind_sear',
          name: 'Thoughtburn',
          description: 'Grants Thoughtburn.',
          icon: 'mind_sear',
          effect: { grant: { ability: 'mind_sear' } },
        },
        {
          id: 'pri_r20_blessed_recovery',
          name: 'Halo Aftershock',
          description:
            'Critical heals from Whispered Prayer, Solemn Prayer, Urgent Prayer, Sunburst Canticle, and Choirmend also ward the target, absorbing 50 damage for 10 sec.',
          icon: 'flash_heal',
          effect: {
            proc: {
              id: 'pri_blessed_recovery',
              name: 'Halo Aftershock',
              trigger: {
                on: 'spellCrit',
                abilities: ['lesser_heal', 'heal', 'flash_heal', 'holy_nova', 'prayer_of_healing'],
              },
              responses: [{ kind: 'absorb', amount: 50, duration: 10, name: 'Halo Aftershock' }],
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
      decision: 'Arc Bolt-fed free jolt vs imbued-melee Jolt cooldowns vs imbued sustain',
      options: [
        {
          id: 'sha_r5_concussion',
          name: 'Fault Line',
          description:
            'Every 3rd Arc Bolt makes your next Earthen Jolt, Cinder Jolt, or Rime Jolt within 8 sec free.',
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
          id: 'sha_r14_weapon_fury',
          name: 'Imbued Tempo',
          description:
            'Landed melee auto-attacks with an imbued weapon shave 0.5 sec off your Jolt cooldowns.',
          icon: 'stormstrike',
          effect: {
            proc: {
              id: 'sha_weapon_fury',
              name: 'Imbued Tempo',
              trigger: { on: 'meleeSwingWhile', auraKind: 'imbue' },
              responses: [
                { kind: 'cooldownRefund', ability: 'earth_shock', seconds: 0.5 },
                { kind: 'cooldownRefund', ability: 'flame_shock', seconds: 0.5 },
                { kind: 'cooldownRefund', ability: 'frost_shock', seconds: 0.5 },
              ],
            },
          },
        },
        {
          id: 'sha_r5_imbue_mastery',
          name: 'Imbued Lifeblood',
          description:
            'Each landed melee auto-attack with an active weapon imbue heals you for 4% of your maximum health.',
          icon: 'rockbiter_weapon',
          effect: {
            proc: {
              id: 'sha_imbued_lifeblood',
              name: 'Imbued Lifeblood',
              trigger: { on: 'meleeSwingWhile', auraKind: 'imbue' },
              responses: [{ kind: 'heal', pctMax: 0.04 }],
            },
          },
        },
      ],
    },
    {
      level: 8,
      theme: 'jolts',
      decision: 'interrupting Earthen Jolt vs reflected-hit instant bolt vs healing spring',
      options: [
        {
          id: 'sha_r8_improved_earth_shock',
          name: 'Fault Rebuke',
          description: 'Earthen Jolt also interrupts spellcasting for a 2 sec school lockout.',
          icon: 'earth_shock',
          effect: {
            ability: [{ ability: 'earth_shock', addEffects: [{ type: 'interrupt', lockout: 2 }] }],
          },
        },
        {
          id: 'sha_r5_improved_lightning_shield',
          name: 'Rebounding Current',
          description:
            'When your Thunder Ward reflects a strike, your next Arc Bolt within 8 sec is instant.',
          icon: 'lightning_shield',
          effect: {
            proc: {
              id: 'sha_ward_surge',
              name: 'Rebounding Current',
              trigger: { on: 'thornsReflect', ability: 'lightning_shield' },
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
          id: 'sha_r11_healing_stream',
          name: 'Springwell',
          description: 'Grants Springwell.',
          icon: 'healing_stream',
          effect: { grant: { ability: 'healing_stream' } },
        },
      ],
    },
    {
      level: 11,
      theme: 'attunement',
      decision: 'heal-crit tempo vs Thunder Ward charge weaving vs Jolt-fed mana',
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
          id: 'sha_r11_fulmination',
          name: 'Fulmination',
          description:
            'While Thunder Ward is active, each Arc Bolt adds a charge up to 9. Each charge gives Arc Bolt 5% Overload chance for a free half-damage repeat that chains to one nearby enemy. Earthen Jolt consumes every charge for 8 Nature damage each to the target and nearby enemies.',
          icon: 'lightning_shield',
          effect: {
            ability: [
              {
                ability: 'earth_shock',
                addEffects: [
                  {
                    type: 'consumeAuraChargesDamage',
                    auraId: 'lightning_shield',
                    damagePerCharge: 8,
                    radius: 8,
                  },
                ],
              },
            ],
            proc: {
              id: 'sha_fulmination',
              name: 'Fulmination',
              school: 'nature',
              trigger: { on: 'castNth', n: 1, abilities: ['lightning_bolt'] },
              responses: [
                {
                  kind: 'addAuraCharges',
                  ability: 'lightning_shield',
                  amount: 1,
                  maxCharges: 9,
                },
              ],
            },
          },
        },
        {
          id: 'sha_r8_shock_efficiency',
          name: 'Returning Current',
          description: 'Every 3rd Jolt restores 8% of your maximum mana.',
          icon: 'earth_shock',
          effect: {
            proc: {
              id: 'sha_returning_current',
              name: 'Returning Current',
              trigger: {
                on: 'castNth',
                n: 3,
                abilities: ['earth_shock', 'flame_shock', 'frost_shock'],
              },
              responses: [{ kind: 'resource', pctMax: 0.08, resourceType: 'mana' }],
            },
          },
        },
      ],
    },
    {
      level: 14,
      theme: 'storm',
      decision: 'area lightning vs DoT detonation vs rooting Rime Jolt',
      options: [
        {
          id: 'sha_r14_chain_lightning',
          name: 'Skybranch',
          description: 'Grants Skybranch.',
          icon: 'chain_lightning',
          effect: { grant: { ability: 'chain_lightning' } },
        },
        {
          id: 'sha_r14_improved_flame_shock',
          name: 'Cinder Rupture',
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
          id: 'sha_r8_frost_bind',
          name: 'Rime Lock',
          description: 'Rime Jolt also roots the target for 2 sec.',
          icon: 'frost_shock',
          effect: {
            ability: [{ ability: 'frost_shock', addEffects: [{ type: 'root', duration: 2 }] }],
          },
        },
      ],
    },
    {
      level: 17,
      theme: 'warding',
      decision: 'ground root vs instant travel form vs reactive absorb',
      options: [
        {
          id: 'sha_r17_earthbind',
          name: 'Gripping Earth',
          description: 'Grants Gripping Earth.',
          icon: 'earthbind',
          effect: { grant: { ability: 'earthbind' } },
        },
        {
          id: 'sha_r17_improved_ghost_wolf',
          name: 'Wolfstep',
          description: 'Shadewolf becomes instant.',
          icon: 'ghost_wolf',
          effect: { ability: [{ ability: 'ghost_wolf', castPct: -1 }] },
        },
        {
          id: 'sha_r17_elemental_warding',
          name: 'Stonewake Shell',
          description:
            'Taking a hit for at least 15% of your maximum health raises an earthen shell absorbing 80 damage for 10 sec. 20 sec internal cooldown.',
          icon: 'lightning_shield',
          effect: {
            proc: {
              id: 'sha_elemental_warding',
              name: 'Stonewake Shell',
              trigger: { on: 'bigHitTaken', hpFrac: 0.15, icd: 20 },
              responses: [{ kind: 'absorb', amount: 80, duration: 10, name: 'Stonewake Shell' }],
            },
          },
        },
      ],
    },
    {
      level: 20,
      theme: 'ascendance',
      decision: 'party haste vs melee reset cadence vs emergency healing echoes',
      options: [
        {
          id: 'sha_r20_bloodlust',
          name: 'Storm Chorus',
          description: 'Grants Storm Chorus.',
          icon: 'bloodlust',
          effect: { grant: { ability: 'bloodlust' } },
        },
        {
          id: 'sha_r20_elemental_fury',
          name: 'Tempest Reprise',
          description:
            "Landed Ancestral Strikes have a 20% chance to reset Ancestral Strike's cooldown.",
          icon: 'stormstrike',
          effect: {
            proc: {
              id: 'sha_tempest_reprise',
              name: 'Tempest Reprise',
              spec: 'enhancement',
              school: 'nature',
              trigger: { on: 'meleeHit', abilities: ['stormstrike'], chance: 0.2 },
              responses: [{ kind: 'cooldownRefund', ability: 'stormstrike', seconds: 'reset' }],
            },
          },
        },
        {
          id: 'sha_r20_tidal_waves',
          name: 'Undertow Promise',
          description:
            'Every 3rd Mending Waters leaves an echo for 10 sec: if the target falls below 35% health, the echo heals them for 80.',
          icon: 'healing_wave',
          effect: {
            proc: {
              id: 'sha_undertow_promise',
              name: 'Undertow Promise',
              trigger: { on: 'castNth', n: 3, abilities: ['healing_wave'] },
              responses: [
                { kind: 'echo', belowFrac: 0.35, window: 10, heal: 80, name: 'Undertow Promise' },
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
      theme: 'malefic_cadence',
      decision: 'Gloom-to-Blackrot cadence vs Blackrot control vs pact-fed instant bolt',
      options: [
        {
          id: 'wlk_r5_bane',
          name: 'Grave Rhythm',
          description: 'Every 3rd Gloom Bolt makes your next Blackrot within 8 sec instant.',
          icon: 'shadow_bolt',
          effect: {
            proc: {
              id: 'wlk_grave_rhythm',
              name: 'Grave Rhythm',
              trigger: { on: 'castNth', n: 3, abilities: ['shadow_bolt'] },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_instant',
                  abilities: ['corruption'],
                  duration: 8,
                },
              ],
            },
          },
        },
        {
          id: 'wlk_r5_improved_corruption',
          name: 'Blacktide',
          description: 'Blackrot also slows its target by 30% for 6 sec.',
          icon: 'corruption',
          effect: {
            ability: [
              { ability: 'corruption', addEffects: [{ type: 'slow', mult: 0.7, duration: 6 }] },
            ],
          },
        },
        {
          id: 'wlk_r5_improved_immolate',
          name: 'Pact Reversal',
          description: 'Every 3rd Burning Pact makes your next Gloom Bolt within 8 sec instant.',
          icon: 'immolate',
          effect: {
            proc: {
              id: 'wlk_improved_immolate',
              name: 'Pact Reversal',
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
      decision: 'magic devour vs area fear vs sustained slow',
      options: [
        {
          id: 'wlk_r8_voidfeast',
          name: 'Voidfeast',
          description: 'Grants Voidfeast: devour a magic effect and heal yourself.',
          icon: 'voidfeast',
          effect: { grant: { ability: 'voidfeast' } },
        },
        {
          id: 'wlk_r8_howl_of_terror',
          name: 'Dread Chorus',
          description: 'Grants Dread Chorus.',
          icon: 'howl_of_terror',
          effect: { grant: { ability: 'howl_of_terror' } },
        },
        {
          id: 'wlk_r8_curse_of_exhaustion',
          name: 'Leaden Hex',
          description: 'Grants Leaden Hex.',
          icon: 'curse_of_exhaustion',
          effect: { grant: { ability: 'curse_of_exhaustion' } },
        },
      ],
    },
    {
      level: 11,
      theme: 'dark_sustenance',
      decision: 'Hard Bargain tempo vs mobile Consume vs reactive ward',
      options: [
        {
          id: 'wlk_r11_improved_life_tap',
          name: 'Blood Credit',
          description:
            'Hard Bargain makes your next Gloom Bolt or Burning Pact within 8 sec instant.',
          icon: 'life_tap',
          effect: {
            proc: {
              id: 'wlk_blood_credit',
              name: 'Blood Credit',
              trigger: { on: 'castNth', n: 1, abilities: ['life_tap'] },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_instant',
                  abilities: ['shadow_bolt', 'immolate'],
                  duration: 8,
                },
              ],
            },
          },
        },
        {
          id: 'wlk_r11_fel_concentration',
          name: 'Walking Hunger',
          description: 'Consume is channelable while moving.',
          icon: 'drain_life',
          effect: { ability: [{ ability: 'drain_life', castWhileMoving: true }] },
        },
        {
          id: 'wlk_r11_demon_armor',
          name: 'Fiendward',
          description:
            'Taking a hit for at least 15% of your maximum health raises a ward absorbing 60 damage for 10 sec. 20 sec internal cooldown.',
          icon: 'demon_skin',
          effect: {
            proc: {
              id: 'wlk_demon_armor',
              name: 'Fiendward',
              trigger: { on: 'bigHitTaken', hpFrac: 0.15, icd: 20 },
              responses: [{ kind: 'absorb', amount: 60, duration: 10, name: 'Fiendward' }],
            },
          },
        },
      ],
    },
    {
      level: 14,
      theme: 'school_weaving',
      decision: 'DoT-fed bolt damage vs bolt-fed instant pact vs fire-fed shadow discount',
      options: [
        {
          id: 'wlk_r14_amplify_curse',
          name: 'Deepened Hex',
          description: 'Gloom Bolt deals 20% more damage to targets afflicted by your DoTs.',
          icon: 'curse_of_agony',
          effect: { ability: [{ ability: 'shadow_bolt', dmgPctVsDotted: 0.2 }] },
        },
        {
          id: 'wlk_r14_ruin',
          name: 'Ashen Relay',
          description: 'Every 3rd Gloom Bolt makes your next Burning Pact within 8 sec instant.',
          icon: 'shadowburn',
          effect: {
            proc: {
              id: 'wlk_desolation',
              name: 'Ashen Relay',
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
          name: 'Shadow Credit',
          description:
            'Each damaging Fire spell makes your next damaging Shadow spell within 8 sec cost 50% less.',
          icon: 'shadow_bolt',
          effect: {
            proc: {
              id: 'wlk_umbral_mastery',
              name: 'Shadow Credit',
              trigger: { on: 'castNth', n: 1, abilities: warlockDamagingFireSpellAbilityIds },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_cheap',
                  abilities: warlockDamagingShadowSpellAbilityIds,
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
      theme: 'under_pressure',
      decision: 'instant horror vs fear-to-bolt tempo vs reactive self-heal',
      options: [
        {
          id: 'wlk_r17_death_coil',
          name: 'Morrowlash',
          description: 'Grants Morrowlash.',
          icon: 'death_coil',
          effect: { grant: { ability: 'death_coil' } },
        },
        {
          id: 'wlk_r17_improved_fear',
          name: 'Cruel Awakening',
          description: 'Harrow makes your next Gloom Bolt within 8 sec instant.',
          icon: 'fear',
          effect: {
            proc: {
              id: 'wlk_cruel_awakening',
              name: 'Cruel Awakening',
              trigger: { on: 'castNth', n: 1, abilities: ['fear'] },
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
        {
          id: 'wlk_r17_demonic_resilience',
          name: 'Unyielding Pact',
          description:
            'Taking a hit for at least 15% of your maximum health heals you for 50. 20 sec internal cooldown.',
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
      theme: 'final_pact',
      decision: 'direct chaos burst vs damaging-cast ward vs curse-fed instant bolt',
      options: [
        {
          id: 'wlk_r20_chaos_bolt',
          name: 'Ruinbolt',
          description: 'Grants Ruinbolt.',
          icon: 'chaos_bolt',
          effect: { grant: { ability: 'chaos_bolt' } },
        },
        {
          id: 'wlk_r20_grimoire_of_haste',
          name: 'Hellglass Ward',
          description:
            'Every 3rd damaging Fire or Shadow spell raises a demonic ward absorbing 90 damage for 10 sec.',
          icon: 'summon_felhound',
          effect: {
            proc: {
              id: 'wlk_grimoire_of_carnage',
              name: 'Hellglass Ward',
              trigger: {
                on: 'castNth',
                n: 3,
                abilities: warlockDamagingFireOrShadowSpellAbilityIds,
              },
              responses: [{ kind: 'absorb', amount: 90, duration: 10, name: 'Hellglass Ward' }],
            },
          },
        },
        {
          id: 'wlk_r20_curse_mastery',
          name: 'Hexstorm',
          description:
            'Every 3rd Blackrot or Hex of Anguish makes your next Gloom Bolt within 8 sec instant.',
          icon: 'curse_of_agony',
          effect: {
            proc: {
              id: 'wlk_curse_mastery',
              name: 'Hexstorm',
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
      theme: 'opening_cycles',
      decision: 'Wildbolt spell cycle vs Wolf Form opener vs Wildbloom healing payoff',
      options: [
        {
          id: 'dru_r5_improved_wrath',
          name: 'Moonkindle',
          description: 'Every 3rd Wildbolt makes your next Lunar Tempest within 8 sec free.',
          icon: 'wrath',
          effect: {
            proc: {
              id: 'dru_improved_wildbolt',
              name: 'Moonkindle',
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
            'Shifting into Wolf Form makes your next Rendclaw or Flense within 8 sec cost 50% less.',
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
          name: "Bloom's End",
          description:
            'When Wildbloom runs its full duration, your next Wildmend within 8 sec is instant.',
          icon: 'rejuvenation',
          effect: {
            proc: {
              id: 'dru_natures_bounty',
              name: "Bloom's End",
              trigger: { on: 'hotExpired', ability: 'rejuvenation' },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_instant',
                  abilities: ['healing_touch'],
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
      theme: 'disruption',
      decision: 'area knockback vs root-to-spell setup vs Concuss rage and reset',
      options: [
        {
          id: 'dru_r8_typhoon',
          name: 'Typhoon',
          description: 'Grants Typhoon: knock back and daze all enemies within 8 yd.',
          icon: 'typhoon',
          effect: { grant: { ability: 'typhoon' } },
        },
        {
          id: 'dru_r8_improved_roots',
          name: 'Briar Ambush',
          description: 'Gripping Roots makes your next Wildbolt within 8 sec instant.',
          icon: 'entangling_roots',
          effect: {
            proc: {
              id: 'dru_briar_ambush',
              name: 'Briar Ambush',
              trigger: { on: 'castNth', n: 1, abilities: ['entangling_roots'] },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_instant',
                  abilities: ['wrath'],
                  duration: 8,
                },
              ],
            },
          },
        },
        {
          id: 'dru_r8_brutal_bash',
          name: 'Brutal Bash',
          description: 'Concuss restores 15 rage and makes your next Bonecrush within 8 sec free.',
          icon: 'bash',
          effect: {
            proc: {
              id: 'dru_brutal_bash',
              name: 'Brutal Bash',
              trigger: { on: 'castNth', n: 1, abilities: ['bash'] },
              responses: [
                { kind: 'resource', amount: 15, resourceType: 'rage' },
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
      theme: 'renewal',
      decision: 'cross-form resource waves vs shapeshift attack discount vs healing cadence ward',
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
          name: 'Formrush',
          description: 'Shapeshifting makes your next form attack within 8 sec cost 50% less.',
          icon: 'bear_form',
          effect: {
            proc: {
              id: 'dru_wildsurge',
              name: 'Formrush',
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
          name: 'Grove Covenant',
          description: 'Every 3rd Wildmend shields its target, absorbing 90 damage for 10 sec.',
          icon: 'mark_of_the_wild',
          effect: {
            proc: {
              id: 'dru_grove_covenant',
              name: 'Grove Covenant',
              trigger: { on: 'castNth', n: 3, abilities: ['healing_touch'] },
              responses: [{ kind: 'absorb', amount: 90, duration: 10, name: 'Grove Covenant' }],
            },
          },
        },
      ],
    },
    {
      level: 14,
      theme: 'payoff_loops',
      decision: 'feral finisher cycle vs lunar instant cast vs emergency heal echo',
      options: [
        {
          id: 'dru_r14_savage_fury',
          name: 'Redtooth Rhythm',
          description:
            'Each Gorebite or Bloodrift makes your next Rendclaw or Flense within 8 sec cost 50% less.',
          icon: 'ferocious_bite',
          effect: {
            proc: {
              id: 'dru_savage_fury',
              name: 'Redtooth Rhythm',
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
          description: 'Lunar Tempest makes your next Skyfall within 8 sec instant.',
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
          name: 'Mercy Seed',
          description:
            'Wildmend leaves a stored heal of 60 that triggers if the target falls below 35% health within 8 sec.',
          icon: 'healing_touch',
          effect: {
            proc: {
              id: 'dru_empowered_touch',
              name: 'Mercy Seed',
              trigger: { on: 'castNth', n: 1, abilities: ['healing_touch'] },
              responses: [
                { kind: 'echo', belowFrac: 0.35, window: 8, heal: 60, name: 'Mercy Seed' },
              ],
            },
          },
        },
      ],
    },
    {
      level: 17,
      theme: 'survival',
      decision: 'Oakhide-fed instant spell vs active bear healing vs hit-fed rage shield',
      options: [
        {
          id: 'dru_r17_improved_barkskin',
          name: 'Oaken Reflex',
          description:
            'Oakhide makes your next Wildbolt, Skyfall, Wildmend, or Second Bloom within 8 sec instant.',
          icon: 'barkskin',
          effect: {
            proc: {
              id: 'dru_improved_barkskin',
              name: 'Oaken Reflex',
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
          description: 'Grants Savage Mending.',
          icon: 'frenzied_regeneration',
          effect: { grant: { ability: 'frenzied_regeneration' } },
        },
        {
          id: 'dru_r17_survival_of_the_fittest',
          name: 'Ironhide Reflex',
          description:
            'Taking a hit for at least 20% of your maximum health shields you, absorbing 80 damage for 6 sec. While in Bruin Form, it also restores 20 rage. 20 sec internal cooldown.',
          icon: 'bear_form',
          effect: {
            proc: {
              id: 'dru_survival_of_the_fittest',
              name: 'Ironhide Reflex',
              trigger: { on: 'bigHitTaken', hpFrac: 0.2, icd: 20 },
              responses: [
                { kind: 'resource', amount: 20, resourceType: 'rage' },
                { kind: 'absorb', amount: 80, duration: 6, name: 'Ironhide Reflex' },
              ],
            },
          },
        },
      ],
    },
    {
      level: 20,
      theme: 'apex_harmony',
      decision: 'Galeheart cadence vs feral burst vs party healing channel',
      options: [
        {
          id: 'dru_r20_improved_hurricane',
          name: 'Storm Refrain',
          description:
            'Starting Galeheart removes 4 sec from its cooldown and makes your next Lunar Tempest within 8 sec free.',
          icon: 'hurricane',
          effect: {
            proc: {
              id: 'dru_improved_hurricane',
              name: 'Storm Refrain',
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
          description: 'Grants Red Haze.',
          icon: 'berserk',
          effect: { grant: { ability: 'berserk' } },
        },
        {
          id: 'dru_r20_tranquility',
          name: 'Gladesong',
          description: 'Grants Gladesong.',
          icon: 'tranquility',
          effect: { grant: { ability: 'tranquility' } },
        },
      ],
    },
  ],
};
