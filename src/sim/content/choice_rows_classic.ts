import type { ClassChoiceRows } from './talent_rows';

const rogueBuilderAbilityIds = [
  'sinister_strike',
  'body_blow', // Wicked Slash transformed inside the Redline window
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

const priestManaSpellAbilityIds = [
  'smite',
  'lesser_heal',
  'power_word_fortitude',
  'shadow_word_pain',
  'power_word_shield',
  'renew',
  'mind_blast',
  'heal',
  'mind_flay',
  'flash_heal',
  'scouring_mercy',
  'prayer_of_healing',
  'holy_nova',
  'seraphic_vigil',
  'summon_tithefiend',
  'silence',
  'psychic_scream',
  'veilstep',
  'power_infusion',
  'martyrs_aegis',
  'choir_of_deliverance',
];

export const MAGE_CHOICE_ROWS: ClassChoiceRows = {
  rows: [
    {
      level: 5,
      theme: 'mobility',
      options: [
        {
          id: 'mag_r5_ice_floes',
          name: 'Ice Floes',
          description:
            'Grants Ice Floes: your next two spells with a cast time can be cast while moving.',
          icon: 'ice_floes',
          effect: { grant: { ability: 'ice_floes' } },
        },
        {
          id: 'mag_r5_double_blink',
          name: 'Double Blink',
          description: 'Flickerstep stores 2 charges, but each recharges 30% more slowly.',
          icon: 'double_blink',
          effect: { ability: [{ ability: 'blink', bonusCharges: 1, cooldownPct: 0.3 }] },
        },
        {
          id: 'mag_r5_blink_cast',
          name: 'Blink While Casting',
          description: 'You can use Flickerstep in the middle of a cast without interrupting it.',
          icon: 'blink_while_casting',
          effect: { global: { blinkCast: 1 } },
        },
      ],
    },
    {
      level: 8,
      theme: 'survival',
      options: [
        {
          id: 'mag_r8_warded',
          name: 'Warded',
          description:
            'While your personal barrier is up you take 15% less damage, and it heals its bearer for 10% of your maximum health when it breaks after absorbing.',
          icon: 'warded',
          effect: {
            global: { barrierDrPct: 0.15 },
            // Percentage scaling keeps the break heal proportional while the
            // personal barriers grow through their leveling ranks.
            // 'personal_barrier' is the SLOT sentinel: Frostveil for Frost,
            // Blazing Barrier for Fire, or Temporal Barrier for Chronomancy.
            // Source scaling prevents an allied tank's HP pool from amplifying it.
            proc: {
              id: 'mag_warded',
              name: 'Warded',
              trigger: { on: 'shieldConsumed', ability: 'personal_barrier' },
              responses: [{ kind: 'heal', amountPctSourceMaxHp: 0.1 }],
            },
          },
        },
        {
          id: 'mag_r8_temporal_rift',
          name: 'Shifting Ward',
          description: 'Casting your personal barrier breaks roots affecting you.',
          icon: 'temporal_rift',
          effect: {
            ability: [
              { ability: 'ice_barrier', addEffects: [{ type: 'breakRoots' }] },
              { ability: 'blazing_barrier', addEffects: [{ type: 'breakRoots' }] },
              // Chronomancy's shield fills the same personal-barrier slot (see
              // PERSONAL_BARRIER_IDS) and can also be cast on an ally: the
              // breakRoots dispatch case gates on a self-cast so a ward laid
              // on an ally never cleanses the caster's own root.
              { ability: 'temporal_barrier', addEffects: [{ type: 'breakRoots' }] },
            ],
          },
        },
        {
          id: 'mag_r8_greater_invis',
          name: 'Greater Invisibility',
          description:
            'Grants Greater Invisibility: vanish for 20 sec and remove 2 damage-over-time effects. When the invisibility ends, take 90% less damage for 2 sec.',
          icon: 'greater_invisibility',
          effect: { grant: { ability: 'greater_invisibility' } },
        },
      ],
    },
    {
      level: 11,
      theme: 'control',
      options: [
        {
          id: 'mag_r11_rings_of_frost',
          name: 'Ring of Frost',
          description:
            'Grants Ring of Frost: its perimeter persists for 10 sec and freezes enemies that cross it for 4 sec.',
          icon: 'rings_of_frost',
          effect: { grant: { ability: 'rings_of_frost' } },
        },
        {
          id: 'mag_r11_snap_polymorph',
          name: 'Snap Bewitch',
          description: 'Bewitch becomes instant, on a 20 sec cooldown.',
          icon: 'snap_polymorph',
          effect: { ability: [{ ability: 'polymorph', castPct: -1, cooldownFlat: 20 }] },
        },
        {
          id: 'mag_r11_twin_nova',
          name: 'Twin Icebind',
          description: 'Icebind stores 2 charges that recharge independently.',
          icon: 'twin_frost_nova',
          effect: { ability: [{ ability: 'frost_nova', bonusCharges: 1 }] },
        },
      ],
    },
    {
      level: 14,
      theme: 'amplify',
      options: [
        {
          id: 'mag_r14_power_echo',
          name: 'Power Echo',
          description:
            'Grants Power Echo: your next direct spell repeats at 50% power on the same target.',
          icon: 'power_echo',
          effect: { grant: { ability: 'power_echo' } },
        },
        {
          id: 'mag_r14_overload',
          name: 'Overload',
          description:
            'Grants Overload: your next spell is amplified by 40% but costs 50% more mana.',
          icon: 'overload',
          effect: { grant: { ability: 'overload' } },
        },
        {
          id: 'mag_r14_presence_of_mind',
          name: 'Racing Mind',
          description: 'Grants Racing Mind: your next spell with a cast time is cast instantly.',
          icon: 'presence_of_mind',
          effect: { grant: { ability: 'presence_of_mind' } },
        },
      ],
    },
    {
      level: 17,
      theme: 'cooldown',
      options: [
        {
          id: 'mag_r17_convergence',
          name: 'Elemental Convergence',
          description:
            'Alternating a Fire and a Frost spell opens an 8 sec surge of power, once per 30 sec.',
          icon: 'elemental_convergence',
          effect: { global: { convergence: 1 } },
        },
        {
          id: 'mag_r17_cold_snap',
          name: "Winter's Recall",
          description:
            "Grants Winter's Recall: instantly finishes the cooldown of Flickerstep, Frostveil and Greater Invisibility.",
          icon: 'cold_snap',
          effect: { grant: { ability: 'cold_snap' } },
        },
        {
          id: 'mag_r17_mass_barrier',
          name: 'Mass Barrier',
          description: 'Grants Mass Barrier: shield you and all allies within 30 yd.',
          icon: 'mass_barrier',
          effect: { grant: { ability: 'mass_barrier' } },
        },
      ],
    },
    {
      level: 20,
      theme: 'capstone',
      options: [
        {
          id: 'mag_r20_rune_of_power',
          name: 'Rune of Power',
          description:
            'Grants Rune of Power: inscribe a rune; allies standing near it deal 10% more damage.',
          icon: 'rune_of_power',
          effect: { grant: { ability: 'rune_of_power' } },
        },
        {
          id: 'mag_r20_overflowing_power',
          name: 'Overflowing Power',
          description:
            'Spending mana shaves the cooldown of your defensives: 2 sec per tenth of your maximum mana spent, up to 10 sec every 30 sec.',
          icon: 'overflowing_power',
          effect: { global: { manaDefCdrPer10: 2 } },
        },
        {
          id: 'mag_r20_evocation',
          name: 'Aetherwell',
          description:
            'Grants Aetherwell: channel to restore mana, building spell power the longer you channel.',
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
      theme: 'mobility',
      decision: 'speed after Hammer of Grace vs a stronger Solar Step vs Devotion-driven speed',
      options: [
        {
          id: 'pal_r5_radiant_stride',
          name: 'Radiant Stride',
          description: 'Hammer of Grace grants 30% movement speed for 4 sec when it deals damage.',
          icon: 'pal_r5_radiant_stride',
          effect: { global: { paladinRadiantStride: 0.3 } },
        },
        {
          id: 'pal_r5_steadfast_step',
          name: 'Steadfast Step',
          description: 'Solar Step lasts 2 sec longer and makes you immune to slows while active.',
          icon: 'pal_r5_steadfast_step',
          effect: {
            ability: [
              {
                ability: 'solar_step',
                durationFlat: 2,
                addEffects: [{ type: 'selfBuff', kind: 'slow_immunity', value: 1, duration: 2 }],
              },
            ],
          },
        },
        {
          id: 'pal_r5_divine_steed',
          name: 'Divine Steed',
          description:
            'Gain 0.75% movement speed per Devotion, up to 15% at 20. Activating Divine Ascension spends your Devotion and grants 30% movement speed for 5 sec.',
          icon: 'pal_r5_divine_steed',
          effect: {
            global: { paladinDivineSteed: 0.15, paladinDivineSteedBurstPct: 0.3 },
          },
        },
      ],
    },
    {
      level: 8,
      theme: 'survival',
      decision: 'a stronger personal ward vs a stronger emergency heal vs shielding overhealing',
      options: [
        {
          id: 'pal_r8_enduring_protection',
          name: 'Enduring Protection',
          description:
            "Increases Ward of Faith's maximum-health absorption by 40% and makes it last 5 sec longer.",
          icon: 'pal_r8_enduring_protection',
          effect: {
            ability: [{ ability: 'divine_protection', dmgPct: 0.4, durationFlat: 5 }],
          },
        },
        {
          id: 'pal_r8_steady_hands',
          name: 'Steady Hands',
          description:
            'Last Rite recharges 30% faster and heals the target for another 30% of its direct healing over 6 sec.',
          icon: 'pal_r8_steady_hands',
          effect: {
            ability: [{ ability: 'lay_on_hands', cooldownPct: -0.3 }],
            global: { paladinSteadyHandsHotPct: 0.3 },
          },
        },
        {
          id: 'pal_r8_recurring_grace',
          name: 'Recurring Grace',
          description:
            'Hammer of Grace overhealing becomes an absorb shield for 10 sec, capped at 10% of your maximum health.',
          icon: 'pal_r8_recurring_grace',
          effect: { global: { paladinRecurringGrace: 0.1 } },
        },
      ],
    },
    {
      level: 11,
      theme: 'control',
      decision: 'a shorter stun cooldown vs two stored stuns vs a ranged slow',
      options: [
        {
          id: 'pal_r11_fist_of_justice',
          name: 'Fist of Justice',
          description: "Sundering Gavel's cooldown is reduced by 25%.",
          icon: 'pal_r11_fist_of_justice',
          effect: { ability: [{ ability: 'hammer_of_justice', cooldownPct: -0.25 }] },
        },
        {
          id: 'pal_r11_double_sentence',
          name: 'Double Sentence',
          description: 'Sundering Gavel stores 2 uses.',
          icon: 'pal_r11_double_sentence',
          effect: { ability: [{ ability: 'hammer_of_justice', bonusCharges: 1 }] },
        },
        {
          id: 'pal_r11_radiant_shackles',
          name: 'Radiant Shackles',
          description: 'Hammer of Grace slows its target by 40% for 4 sec.',
          icon: 'pal_r11_radiant_shackles',
          effect: {
            ability: [
              {
                ability: 'hammer_of_grace',
                addEffects: [{ type: 'slow', mult: 0.6, duration: 4 }],
              },
            ],
          },
        },
      ],
    },
    {
      level: 14,
      theme: 'devotion',
      decision: 'extra generation cadence vs a post-Ascension reserve vs charge conservation',
      options: [
        {
          id: 'pal_r14_zeal',
          name: 'Zeal',
          description:
            'Every third ability that actually generates Devotion grants 1 extra Devotion.',
          icon: 'pal_r14_zeal',
          effect: { global: { paladinZeal: 1 } },
        },
        {
          id: 'pal_r14_sacred_reserve',
          name: 'Sacred Reserve',
          description: 'When Divine Ascension ends, regain 5 Devotion.',
          icon: 'pal_r14_sacred_reserve',
          effect: { global: { paladinSacredReserve: 5 } },
        },
        {
          id: 'pal_r14_divine_purpose',
          name: 'Divine Purpose',
          description: 'Ascension-empowered abilities have a 20% chance not to consume a charge.',
          icon: 'pal_r14_divine_purpose',
          effect: { global: { paladinDivinePurposeChance: 0.2 } },
        },
      ],
    },
    {
      level: 17,
      theme: 'dawn',
      decision: 'more Ascension charges vs longer Avenging Wrath vs crit and haste during it',
      options: [
        {
          id: 'pal_r17_extended_dawn',
          name: 'Extended Dawn',
          description: 'Divine Ascension empowers 2 additional abilities.',
          icon: 'pal_r17_extended_dawn',
          effect: { global: { ascensionChargeBonus: 2 } },
        },
        {
          id: 'pal_r17_radiant_wrath',
          name: 'Radiant Wrath',
          description:
            'Avenging Wrath lasts 5 sec longer (20 sec total) and its cooldown is reduced to 100 sec.',
          icon: 'pal_r17_radiant_wrath',
          effect: {
            ability: [{ ability: 'avenging_wrath', cooldownFlat: -20, durationFlat: 5 }],
          },
        },
        {
          id: 'pal_r17_sanctified_fervor',
          name: 'Sanctified Fervor',
          description: 'Avenging Wrath also grants 15% critical strike chance and 15% haste.',
          icon: 'pal_r17_sanctified_fervor',
          effect: {
            ability: [
              {
                ability: 'avenging_wrath',
                addEffects: [
                  { type: 'selfBuff', kind: 'buff_crit', value: 0.15, duration: 15 },
                  { type: 'selfBuff', kind: 'buff_haste', value: 1.15, duration: 15 },
                  { type: 'selfBuff', kind: 'buff_spellhaste', value: 0.15, duration: 15 },
                ],
              },
            ],
          },
        },
      ],
    },
    {
      level: 20,
      theme: 'capstone',
      decision: 'empower active group auras vs direct-spell echoes vs a final solar burst',
      options: [
        {
          id: 'pal_r20_aura_mastery',
          name: 'Sacred Concord',
          description:
            'For 8 sec, empower every active Devotion and Requital Aura in your group. Devotion reduces damage by 15%; Requital deals 15 Holy damage. 120 sec cooldown. Multiple uses refresh instead of stacking.',
          icon: 'pal_r20_aura_mastery',
          effect: { grant: { ability: 'aura_mastery' } },
        },
        {
          id: 'pal_r20_dawn_echo',
          name: 'Dawn Echo',
          description:
            'Every third direct ability that actually generates Devotion repeats its primary direct damage or healing at 40% on the same target. An effective echo grants 1 Devotion. The echo cannot crit or trigger other echoes, and grants no Devotion during Divine Ascension.',
          icon: 'pal_r20_dawn_echo',
          effect: { global: { paladinDawnEcho: 0.4, paladinDawnEchoDevotion: 1 } },
        },
        {
          id: 'pal_r20_perpetual_sun',
          name: 'Perpetual Sun',
          description:
            'Consuming your last Ascension charge deals 150 Holy damage within 10 m, heals allies within 20 m for 150, then doubles ability Devotion generation for 5 sec. Expiration does not trigger it.',
          icon: 'pal_r20_perpetual_sun',
          effect: { global: { paladinPerpetualSun: 150 } },
        },
      ],
    },
  ],
};

export const HUNTER_CHOICE_ROWS: ClassChoiceRows = {
  rows: [
    {
      level: 5,
      theme: 'mobility',
      decision: 'active escape vs long travel vs rotational movement',
      options: [
        {
          id: 'hun_r5_tactical_retreat',
          name: 'Tactical Retreat',
          description: 'Trailbreak stores 2 uses and removes roots and movement slows when used.',
          icon: 'trailbreak',
          effect: { ability: [{ ability: 'trailbreak', bonusCharges: 1 }] },
        },
        {
          id: 'hun_r5_enduring_courser',
          name: 'Enduring Courser',
          description:
            "Courser's Guise grants 60% movement speed for 3 sec when activated. 20 sec internal cooldown.",
          icon: 'aspect_of_the_cheetah',
          effect: {
            ability: [{ ability: 'aspect_of_the_cheetah' }],
            runtime: { movementSpeedPct: 0.6, duration: 3, internalCooldown: 20 },
          },
        },
        {
          id: 'hun_r5_predators_pace',
          name: "Predator's Pace",
          description:
            'A successful Pack Command, Measured Shot, or Gutting Strike grants 20% movement speed for 3 sec. 8 sec internal cooldown.',
          icon: 'measured_shot',
          effect: {
            ability: [{ ability: 'measured_shot' }],
            runtime: { movementSpeedPct: 0.2, duration: 3, internalCooldown: 8 },
          },
        },
      ],
    },
    {
      level: 8,
      theme: 'defense',
      decision: 'precise mitigation vs recovery vs passive smoothing',
      options: [
        {
          id: 'hun_r8_receding_shell',
          name: 'Receding Shell',
          description:
            'Recast Shellskin to end it early and refund 50% of its unused duration, up to 45 sec.',
          icon: 'shellskin',
          effect: {
            ability: [{ ability: 'shellskin' }],
            runtime: { cooldownRefundPct: 0.5, cooldownRefundCap: 45 },
          },
        },
        {
          id: 'hun_r8_shared_recovery',
          name: 'Shared Recovery',
          description:
            'Wildheart also heals your pet for 30% and grants both of you 20% damage reduction for 4 sec.',
          icon: 'wildheart',
          effect: {
            ability: [{ ability: 'wildheart' }],
            runtime: { petHealPct: 0.3, damageReductionPct: 0.2, duration: 4 },
          },
        },
        {
          id: 'hun_r8_beastguard',
          name: 'Beastguard',
          description:
            'Redirect 15% of damage to a living pet without reducing it below 20% health. Without one, take 8% less damage below 50% health.',
          icon: 'concussive_shot',
          effect: {
            global: { petDmgSharePct: 0.15 },
            runtime: {
              petHealthFloorPct: 0.2,
              fallbackDamageReductionPct: 0.08,
              healthThresholdPct: 0.5,
            },
          },
        },
      ],
    },
    {
      level: 11,
      theme: 'control',
      decision: 'interrupt coverage vs trap control vs pursuit control',
      options: [
        {
          id: 'hun_r11_double_hush',
          name: 'Double Hush',
          description: 'Hushing Shot stores 2 uses, each with a 24 sec recharge.',
          icon: 'counter_shot',
          effect: {
            ability: [{ ability: 'counter_shot', bonusCharges: 1, cooldownFlat: 4 }],
          },
        },
        {
          id: 'hun_r11_binding_payload',
          name: 'Binding Payload',
          description:
            'Frostjaw Trap roots every enemy in its trigger area for 3 sec, then slows them by 40% for 4 sec.',
          icon: 'frostjaw_trap',
          effect: {
            ability: [{ ability: 'frostjaw_trap' }],
            runtime: { rootDuration: 3, slowPct: 0.4, slowDuration: 4 },
          },
        },
        {
          id: 'hun_r11_crippling_pursuit',
          name: 'Crippling Pursuit',
          description:
            'Rattling Shot or Fettering Slash roots an already slowed target for 2 sec. 12 sec per-target cooldown.',
          icon: 'concussive_shot',
          effect: {
            ability: [{ ability: 'concussive_shot' }],
            runtime: { rootDuration: 2, perTargetCooldown: 12 },
          },
        },
      ],
    },
    {
      level: 14,
      theme: 'focus_engine',
      decision: 'resource rhythm vs trap linkage vs timed guises',
      options: [
        {
          id: 'hun_r14_efficient_rhythm',
          name: 'Efficient Rhythm',
          description:
            'After spending 75 Focus, your next Pack Command, Measured Shot, or Gutting Strike grants 20 additional Focus.',
          icon: 'measured_shot',
          effect: {
            ability: [{ ability: 'measured_shot' }],
            runtime: { focusSpendThreshold: 75, focusBonus: 20 },
          },
        },
        {
          id: 'hun_r14_trapcraft',
          name: 'Trapcraft',
          description:
            "Frostjaw Trap's cooldown is reduced by 20%. Triggering it restores 20 Focus and reduces Trailbreak's cooldown by 5 sec.",
          icon: 'frostjaw_trap',
          effect: { ability: [{ ability: 'frostjaw_trap', cooldownPct: -0.2 }] },
        },
        {
          id: 'hun_r14_guise_mastery',
          name: 'Guise Mastery',
          description:
            "For 6 sec, Harrier's Guise increases Focus generation by 50%, Marten's Guise reduces direct damage by 25%, and Courser's Guise grants 50% movement speed, or 60% with Enduring Courser. 20 sec shared cooldown.",
          icon: 'aspect_of_the_hawk',
          effect: {
            ability: [{ ability: 'aspect_of_the_hawk' }],
            runtime: {
              duration: 6,
              focusGenerationPct: 0.5,
              damageReductionPct: 0.25,
              movementSpeedPct: 0.5,
              enduringMovementSpeedPct: 0.6,
              internalCooldown: 20,
            },
          },
        },
      ],
    },
    {
      level: 17,
      theme: 'major_window',
      decision: 'personal burst vs pressure defense vs party rally',
      options: [
        {
          id: 'hun_r17_apex_instinct',
          name: 'Apex Instinct',
          description:
            'Howling Rage, Cold Focus, or Bloodtrail Assault restores 40 Focus. Your next 3 Focus spenders cost 50% less and deal 20% more damage. These uses expire 4 sec after the triggering cooldown ends.',
          icon: 'bestial_wrath',
          effect: {
            ability: [{ ability: 'arcane_shot' }],
            runtime: {
              focusGain: 40,
              charges: 3,
              costReductionPct: 0.5,
              primaryDamagePct: 0.2,
              durationBuffer: 4,
            },
          },
        },
        {
          id: 'hun_r17_shell_and_fang',
          name: 'Shell and Fang',
          description:
            'Shellskin allows attacks and pet commands, but its damage reduction is reduced to 40%.',
          icon: 'shellskin',
          effect: {
            ability: [{ ability: 'shellskin' }],
            runtime: { damageReductionPct: 0.4 },
          },
        },
        {
          id: 'hun_r17_pack_rally',
          name: 'Pack Rally',
          description:
            "Courser's Guise can trigger Pack Rally. You, your companion, and group or raid allies within 30 yards gain 30% movement speed and 10% attack, casting, and channeling speed for 10 sec. 90 sec cooldown.",
          icon: 'aspect_of_the_wild',
          effect: {
            ability: [{ ability: 'aspect_of_the_cheetah' }],
            runtime: {
              movementSpeedPct: 0.3,
              hastePct: 0.1,
              duration: 10,
              internalCooldown: 90,
            },
          },
        },
      ],
    },
    {
      level: 20,
      theme: 'focus_capstone',
      decision: 'personal cleave vs trap echoes vs pet echoes',
      options: [
        {
          id: 'hun_r20_overdraw',
          name: 'Overdraw',
          description:
            'Every 3rd Fell Shot, Long Draw, or Woundrend deals 35% more damage to its target and 50% of that damage to up to 2 enemies within 5 yards.',
          icon: 'arcane_shot',
          effect: {
            ability: [{ ability: 'arcane_shot' }],
            runtime: { everyNth: 3, primaryDamagePct: 0.35, cleavePct: 0.5, targetCap: 2 },
          },
        },
        {
          id: 'hun_r20_chain_reaction',
          name: 'Chain Reaction',
          description:
            'Frostjaw Trap marks enemies within 4 yards for 8 sec. Your next 3 Focus spenders echo 40% damage between marked enemies.',
          icon: 'frostjaw_trap',
          effect: {
            ability: [{ ability: 'frostjaw_trap' }],
            runtime: { radius: 4, markDuration: 8, charges: 3, echoPct: 0.4 },
          },
        },
        {
          id: 'hun_r20_fang_chorus',
          name: 'Fang Chorus',
          description:
            'Each Focus spender commands a 50%-strength pet echo. Every 3rd echo becomes a 4 yd clap.',
          icon: 'tame_beast',
          effect: {
            ability: [{ ability: 'arcane_shot' }],
            runtime: { echoPct: 0.5, everyNth: 3, radius: 4 },
          },
        },
      ],
    },
  ],
};

export const ROGUE_CHOICE_ROWS: ClassChoiceRows = {
  rows: [
    {
      level: 5,
      theme: 'movement',
      decision: 'teleport strike vs kill momentum vs rotational speed',
      options: [
        {
          id: 'rog_r5_shadeslip',
          name: 'Shadeslip',
          description: 'Grants Shadeslip.',
          icon: 'shadowstep',
          effect: { grant: { ability: 'shadowstep' } },
        },
        {
          id: 'rog_r5_killers_pace',
          name: "Killer's Pace",
          description: 'Killing blows grant 40% movement speed for 6 sec.',
          icon: 'sprint',
          effect: { global: { onKillSpeedPct: 0.4 } },
        },
        {
          id: 'rog_r5_slipstream',
          name: 'Quickstep',
          description:
            'Landing Wicked Slash or Craven Thrust grants 20% movement speed for 2 sec. Once every 8 sec.',
          icon: 'sinister_strike',
          effect: {
            proc: {
              id: 'rog_slipstream',
              name: 'Quickstep',
              trigger: { on: 'castNth', n: 1, abilities: ['sinister_strike', 'backstab'], icd: 8 },
              responses: [
                {
                  kind: 'aura',
                  auraKind: 'buff_speed',
                  value: 1.2,
                  duration: 2,
                  name: 'Quickstep',
                },
              ],
            },
          },
        },
      ],
    },
    {
      level: 8,
      theme: 'defense',
      decision: 'lethal insurance vs hardened Ghostfoot vs active cloud',
      options: [
        {
          id: 'rog_r8_borrowed_breath',
          name: 'Borrowed Breath',
          description:
            'A blow that would kill you leaves you at 1 health instead. Once every 120 sec.',
          icon: 'vanish',
          effect: { global: { cheatDeathIcd: 120 } },
        },
        {
          id: 'rog_r8_ghostfoot_ward',
          name: 'Ghostfoot Ward',
          description: 'Ghostfoot also reduces all damage you take by 30% while it is active.',
          icon: 'evasion',
          effect: {
            ability: [
              {
                ability: 'evasion',
                addEffects: [{ type: 'selfBuff', kind: 'shield_wall', value: 0.3, duration: 15 }],
              },
            ],
          },
        },
        {
          id: 'rog_r8_smoke_screen',
          name: 'Smoke Screen',
          description: 'Grants Smoke Screen: a cloud that raises your dodge by 30% for 8 sec.',
          icon: 'smoke_screen',
          effect: { grant: { ability: 'smoke_screen' } },
        },
      ],
    },
    {
      level: 11,
      theme: 'control',
      decision: 'stun payoff vs free utility CC vs mid-fight stun access',
      options: [
        {
          id: 'rog_r11_marked_prey',
          name: 'Marked Prey',
          description:
            'Enemies you stun with Gut Punch or Low Blow take 10% more damage from all attackers for 6 sec.',
          icon: 'kidney_shot',
          effect: {
            ability: [
              {
                ability: 'kidney_shot',
                addEffects: [
                  {
                    type: 'debuffTargetSource',
                    kind: 'vulnerability',
                    value: 0.1,
                    duration: 6,
                    auraId: 'marked_prey',
                    auraName: 'Marked Prey',
                  },
                ],
              },
              {
                ability: 'cheap_shot',
                addEffects: [
                  {
                    type: 'debuffTargetSource',
                    kind: 'vulnerability',
                    value: 0.1,
                    duration: 6,
                    auraId: 'marked_prey',
                    auraName: 'Marked Prey',
                  },
                ],
              },
            ],
          },
        },
        {
          id: 'rog_r11_foul_play',
          name: 'Foul Play',
          description:
            'Eye Jab and Sap cost no energy, and your own poisons and bleeds no longer break your Eye Jab.',
          icon: 'gouge',
          effect: {
            ability: [
              { ability: 'gouge', costPct: -1 },
              { ability: 'sap', costPct: -1 },
            ],
            global: { foulPlayGuard: 1 },
          },
        },
        {
          id: 'rog_r11_cheap_trick',
          name: 'Cheap Trick',
          description: 'Gut Punch no longer requires Duskveil.',
          icon: 'cheap_shot',
          effect: {
            ability: [{ ability: 'cheap_shot', ignoreStealthRequirement: true }],
          },
        },
      ],
    },
    {
      level: 14,
      theme: 'kit_management',
      decision: 'cheaper stealth play vs cheaper poisons vs a faster builder',
      options: [
        {
          id: 'rog_r14_dusk_economy',
          name: 'Dusk Economy',
          description:
            'Abilities cost 50% less energy while in Duskveil or shadow-wreathed by the veil, and for 6 sec after leaving Duskveil.',
          icon: 'stealth',
          effect: { global: { duskEconomyPct: 0.5 } },
        },
        {
          // Balance pass: was a flat 5 energy on EVERY poisoned auto (a
          // permanent ~40% passive energy-regen boost on dual-wield swing
          // rates). Now the Combat Potency shape: chance-based, with an
          // internal cooldown so it cannot scale with attack speed into the
          // universally-best pick (the engines pass measured it paying the
          // fastest swinger most, inverting the row's spec flavors).
          id: 'rog_r14_venom_dividend',
          name: 'Venom Dividend',
          description:
            'Landed melee auto-attacks with an active poison have a 20% chance to restore 10 energy. Once every 2 sec.',
          icon: 'deadly_poison',
          effect: {
            proc: {
              id: 'rog_deadly_brew',
              name: 'Venom Dividend',
              trigger: { on: 'meleeSwingWhile', auraKind: 'imbue', chance: 0.2, icd: 2 },
              responses: [{ kind: 'resource', amount: 10 }],
            },
          },
        },
        {
          id: 'rog_r14_ceaseless_cuts',
          name: 'Ceaseless Cuts',
          // Wicked Slash is Thuggery's builder (Knifework thrusts, Skulduggery
          // ribbons), so this is the combat-flavored pick; tuned so it beats
          // the generic poison economy for the spec that actually slashes.
          // Haymaker counts: it IS Wicked Slash while the Redline window
          // runs, and the window starving itself would kill the sprint.
          // Inert for the dagger specs (Knifework/Skulduggery thrust and ribbon,
          // they do not slash): otherwise a non-dagger legendary forces
          // Assassination onto the Wicked Slash fallback and this refund would
          // fund a runaway spam it was never balanced for.
          description: 'Every 3rd Wicked Slash restores 50 energy. (Combat)',
          icon: 'sinister_strike',
          effect: {
            proc: {
              id: 'rog_ceaseless_cuts',
              name: 'Ceaseless Cuts',
              trigger: { on: 'castNth', n: 3, abilities: ['sinister_strike', 'body_blow'] },
              responses: [{ kind: 'resource', amount: 50, resourceType: 'energy' }],
              excludeSpecs: ['assassination', 'subtlety'],
            },
          },
        },
      ],
    },
    {
      level: 17,
      theme: 'major_window',
      decision: 'personal cleave burst vs defense turned tempo vs party rally',
      options: [
        {
          id: 'rog_r17_flurry_of_knives',
          name: 'Flurry of Knives',
          description:
            'Grants Flurry of Knives: lash every enemy within 6 yd and gain 2 combo points.',
          icon: 'flurry_of_knives',
          effect: { grant: { ability: 'flurry_of_knives' } },
        },
        {
          id: 'rog_r17_ghostfoot_gambit',
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
          id: 'rog_r17_thieves_chorus',
          name: "Thieves' Chorus",
          description:
            "Grants Thieves' Chorus: your party attacks and casts 10% faster for 10 sec.",
          icon: 'thieves_chorus',
          effect: { grant: { ability: 'thieves_chorus' } },
        },
      ],
    },
    {
      level: 20,
      theme: 'capstone',
      decision: 'shadow echo vs marked target vs kill momentum',
      options: [
        {
          id: 'rog_r20_second_shadow',
          name: 'Second Shadow',
          description:
            'Dirt Nap cast at 5 combo points strikes again from the shadows for 75% of its damage.',
          icon: 'backstab',
          effect: { global: { secondShadowPct: 0.75 } },
        },
        {
          id: 'rog_r20_deathmark',
          name: 'Grave Brand',
          description:
            'Your Duskveil openers brand the target for 20 sec. You deal 12% more damage to the branded target.',
          icon: 'garrote',
          effect: {
            ability: [
              {
                ability: 'ambush',
                addEffects: [
                  {
                    type: 'debuffTargetSource',
                    kind: 'vuln_source',
                    value: 0.12,
                    duration: 20,
                    auraId: 'deathmark',
                    auraName: 'Grave Brand',
                  },
                ],
              },
              {
                ability: 'garrote',
                addEffects: [
                  {
                    type: 'debuffTargetSource',
                    kind: 'vuln_source',
                    value: 0.12,
                    duration: 20,
                    auraId: 'deathmark',
                    auraName: 'Grave Brand',
                  },
                ],
              },
              {
                ability: 'cheap_shot',
                addEffects: [
                  {
                    type: 'debuffTargetSource',
                    kind: 'vuln_source',
                    value: 0.12,
                    duration: 20,
                    auraId: 'deathmark',
                    auraName: 'Grave Brand',
                  },
                ],
              },
            ],
          },
        },
        {
          id: 'rog_r20_kill_chain',
          name: 'Kill Chain',
          description: 'Killing blows refresh Smokestep and grant 5 combo points.',
          icon: 'vanish',
          effect: { global: { onKillCombo: 5, onKillVanishReset: 1 } },
        },
      ],
    },
  ],
};

export const PRIEST_CHOICE_ROWS: ClassChoiceRows = {
  rows: [
    {
      level: 5,
      theme: 'movement',
      decision: 'move a protected ally, escape control, or preserve casting while moving',
      options: [
        {
          id: 'pri_r5_improved_renew',
          name: 'Sheltering Step',
          description: 'Psalm of Warding grants its target 40% movement speed for 3 sec.',
          icon: 'power_word_shield',
          effect: {
            intrinsic: { mechanic: 'priest_sheltering_step', metrics: { pct: 0.4, duration: 3 } },
          },
        },
        {
          id: 'pri_r5_searing_light',
          name: 'Veil Unbound',
          description:
            'Veilstep removes roots and slows, then grants 50% movement speed for 3 sec.',
          icon: 'veilstep',
          effect: {
            intrinsic: { mechanic: 'priest_veil_unbound', metrics: { pct: 0.5, duration: 3 } },
          },
        },
        {
          id: 'pri_r5_twisted_faith',
          name: 'Processional Grace',
          description: 'Veilstep allows the Priest to cast while moving for 4 sec.',
          icon: 'choir_of_deliverance',
          effect: {
            intrinsic: { mechanic: 'priest_processional_grace', metrics: { duration: 4 } },
          },
        },
      ],
    },
    {
      level: 8,
      theme: 'defense',
      decision: 'active self recovery, prepared ally recovery, or reactive protection',
      options: [
        {
          id: 'pri_r17_desperate_prayer',
          name: 'Last Prayer',
          description: 'Learn Last Prayer, which instantly heals you for 30% of maximum health.',
          icon: 'desperate_prayer',
          effect: {
            grant: { ability: 'desperate_prayer' },
            intrinsic: { mechanic: 'priest_last_prayer', metrics: { pct: 0.3 } },
          },
        },
        {
          id: 'pri_r8_improved_shield',
          name: 'Shattered Psalm',
          description:
            'When Psalm of Warding is fully consumed, it heals its target for 12% maximum health.',
          icon: 'power_word_shield',
          effect: {
            proc: {
              id: 'pri_shield_burst',
              name: 'Shattered Psalm',
              trigger: { on: 'shieldConsumed', ability: 'power_word_shield' },
              responses: [{ kind: 'heal', amountPctMaxHp: 0.12 }],
            },
          },
        },
        {
          id: 'pri_r17_inner_fire',
          name: 'Wounded Halo',
          description:
            'A hit for at least 15% maximum health grants a 15% absorb for 10 sec. 20 sec internal cooldown.',
          icon: 'martyrs_aegis',
          effect: {
            proc: {
              id: 'pri_inner_fire',
              name: 'Wounded Halo',
              trigger: { on: 'bigHitTaken', hpFrac: 0.15, icd: 20 },
              responses: [
                { kind: 'absorb', amountPctMaxHp: 0.15, duration: 10, name: 'Wounded Halo' },
              ],
            },
          },
        },
      ],
    },
    {
      level: 11,
      theme: 'control',
      decision: 'single-target stop, longer area control, or shield-fed pursuit control',
      options: [
        {
          id: 'pri_r8_silence',
          name: 'Hushword',
          description: 'Learn Hushword, which silences one enemy for 4 sec. 30 sec cooldown.',
          icon: 'silence',
          effect: { grant: { ability: 'silence' } },
        },
        {
          id: 'pri_r8_psychic_scream',
          name: 'Lingering Dread',
          description:
            "Reduces Terror Canticle's cooldown by 30%. Feared enemies remain 50% slowed for 4 sec.",
          icon: 'psychic_scream',
          effect: {
            ability: [{ ability: 'psychic_scream', cooldownPct: -0.3 }],
            intrinsic: { mechanic: 'priest_lingering_dread', metrics: { pct: 0.5, duration: 4 } },
          },
        },
        {
          id: 'pri_r11_vampiric_embrace',
          name: 'Binding Psalm',
          description:
            'An enemy that fully consumes Psalm of Warding is rooted for 2 sec, once per enemy every 12 sec.',
          icon: 'power_word_shield',
          effect: {
            intrinsic: { mechanic: 'priest_binding_psalm', metrics: { duration: 2, icd: 12 } },
          },
        },
      ],
    },
    {
      level: 14,
      theme: 'management',
      decision: 'protect one key spell, follow a mana rhythm, or deepen the spec relationship',
      options: [
        {
          id: 'pri_r11_inner_focus',
          name: 'Stilled Mind',
          description: 'Grants Stilled Mind. Your next Priest spell is free and uninterruptible.',
          icon: 'inner_focus',
          effect: { grant: { ability: 'inner_focus' } },
        },
        {
          id: 'pri_r11_meditation',
          name: 'Measured Faith',
          description:
            'Every 3rd Mana-spending Priest spell makes the next Priest spell within 10 sec cost 50% less Mana.',
          icon: 'lesser_heal',
          effect: {
            proc: {
              id: 'pri_measured_faith',
              name: 'Measured Faith',
              trigger: { on: 'castNth', n: 3, abilities: priestManaSpellAbilityIds },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_cheap',
                  abilities: priestManaSpellAbilityIds,
                  duration: 10,
                  costPct: 0.5,
                },
              ],
            },
          },
        },
        {
          id: 'pri_r14_pain_and_suffering',
          name: 'Living Covenant',
          description:
            'Doctrine damage-healing restores Psalm of Warding by 20% of the healing done, up to its original absorb. Benison turns Choirmend overhealing into a 10 sec absorb capped at 10% maximum health. Each Vespers Effigy echo extends Dirge of Decay by 1 sec, up to 6 sec per target.',
          icon: 'power_word_shield',
          effect: {
            intrinsic: {
              mechanic: 'priest_living_covenant',
              metrics: {
                doctrineShieldPct: 0.2,
                benisonAbsorbDuration: 10,
                benisonAbsorbCapPct: 0.1,
                vespersExtension: 1,
                vespersExtensionCap: 6,
              },
            },
          },
        },
      ],
    },
    {
      level: 17,
      theme: 'major prayer',
      decision: 'throughput, planned ally protection, or sustained group recovery',
      options: [
        {
          id: 'pri_r17_anointing',
          name: 'Anointing',
          description:
            'Learn Anointing, which grants one ally 20% more damage, healing, and casting speed for 15 sec. 120 sec cooldown.',
          icon: 'power_infusion',
          effect: { grant: { ability: 'power_infusion' } },
        },
        {
          id: 'pri_r17_martyrs_aegis',
          name: "Martyr's Aegis",
          description:
            "Learn Martyr's Aegis, which reduces one ally's incoming damage by 40% for 8 sec. 120 sec cooldown.",
          icon: 'martyrs_aegis',
          effect: { grant: { ability: 'martyrs_aegis' } },
        },
        {
          id: 'pri_r17_choir_of_deliverance',
          name: 'Choir of Deliverance',
          description:
            'Learn Choir of Deliverance. Channel for 6 sec, healing party members within 30 yards every 2 sec. 180 sec cooldown.',
          icon: 'choir_of_deliverance',
          effect: { grant: { ability: 'choir_of_deliverance' } },
        },
      ],
    },
    {
      level: 20,
      theme: 'capstone',
      decision: 'widen the relationship, repeat its payoff, or manifest its spirit',
      options: [
        {
          id: 'pri_r20_twin_covenant',
          name: 'Twin Covenant',
          description:
            'Doctrine can link 2 allies and converts 70% of Holy damage into healing for each. Benison stores 2 Seraphic Vigil uses and can protect 2 allies. Vespers can bind 2 Effigies; both build the same Gloomtithe bank.',
          icon: 'seraphic_vigil',
          effect: {
            ability: [{ ability: 'seraphic_vigil', bonusCharges: 1 }],
            intrinsic: {
              mechanic: 'priest_twin_covenant',
              metrics: {
                doctrineConversionPct: 0.7,
                linkCap: 2,
                vigilCharges: 2,
                vigilTargetCap: 2,
                effigyCap: 2,
              },
            },
          },
        },
        {
          id: 'pri_r20_second_verse',
          name: 'Second Verse',
          description:
            'After 2 sec, repeat 40% of Scouring Mercy healing from Doctrine, group healing from Benison, or Effigy echo damage from Vespers. The repeat cannot trigger itself.',
          icon: 'smite',
          effect: {
            intrinsic: { mechanic: 'priest_second_verse', metrics: { pct: 0.4, delay: 2 } },
          },
        },
        {
          id: 'pri_r20_incarnate_spirit',
          name: 'Incarnate Spirit',
          description:
            'A fully consumed Psalm of Warding heals its target for 40% of the original absorb. Benison Vigil healing also heals up to 3 party members within 15 yards for 40%. A 5-stack Vespers Tithefiend deals 50% more damage and lasts 50% longer.',
          icon: 'summon_tithefiend',
          effect: {
            intrinsic: {
              mechanic: 'priest_incarnate_spirit',
              metrics: {
                shieldHealPct: 0.4,
                splashTargetCap: 3,
                splashHealPct: 0.4,
                tithefiendStacks: 5,
                tithefiendDamagePct: 0.5,
                tithefiendDurationPct: 0.5,
              },
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
      theme: 'movement',
      decision: 'instant escape vs planned speed burst vs mobile elemental casting',
      options: [
        {
          id: 'sha_r5_concussion',
          name: 'Wolfstep',
          description: 'Shadewolf becomes instant. Entering it removes roots and movement slows.',
          icon: 'ghost_wolf',
          effect: { ability: [{ ability: 'ghost_wolf', castPct: -1 }] },
        },
        {
          id: 'sha_r5_improved_lightning_shield',
          name: 'Gathering Winds',
          description: 'Entering Shadewolf grants 60% movement speed for 3 sec, once every 20 sec.',
          icon: 'galeheart_weapon',
          effect: { runtime: { speedPercent: 60, duration: 3, internalCooldown: 20 } },
        },
        {
          id: 'sha_r5_imbue_mastery',
          name: 'Flowing Elements',
          description:
            'After using a Jolt, the next Arc Bolt or Mending Waters started within 8 sec can be cast while moving.',
          icon: 'lightning_bolt',
          effect: { runtime: { window: 8 } },
        },
      ],
    },
    {
      level: 8,
      theme: 'defense',
      decision: 'prepared ally protection vs reactive warding vs automatic burst recovery',
      options: [
        {
          id: 'sha_r8_improved_earth_shock',
          name: 'Stoneward',
          description:
            'Grants Stoneward, a 60 sec ally shield with 6 charges. Damage consumes a charge to heal 5% maximum health, once every 3 sec.',
          icon: 'stoneward',
          effect: { grant: { ability: 'stoneward' } },
        },
        {
          id: 'sha_r8_frost_bind',
          name: 'Warded Elements',
          description: 'Thunder Ward retaliation grants 10% damage reduction for 3 sec.',
          icon: 'lightning_shield',
          effect: { runtime: { damageReductionPercent: 10, duration: 3 } },
        },
        {
          id: 'sha_r8_shock_efficiency',
          name: 'Ancestral Mending',
          description:
            'Taking a hit for at least 15% of your maximum health heals you for 12% of maximum health. 20 sec internal cooldown.',
          icon: 'healing_wave',
          effect: {
            proc: {
              id: 'sha_ancestral_mending',
              name: 'Ancestral Mending',
              trigger: { on: 'bigHitTaken', hpFrac: 0.15, icd: 20 },
              responses: [{ kind: 'heal', amountPctMaxHp: 0.12 }],
            },
          },
        },
      ],
    },
    {
      level: 11,
      theme: 'control',
      decision: 'interrupt vs single-target root vs target-centered group control',
      options: [
        {
          id: 'sha_r11_ancestral_guidance',
          name: 'Fault Rebuke',
          description: 'Earthen Jolt interrupts spellcasting for a 4 sec school lockout.',
          icon: 'earth_shock',
          effect: {
            ability: [{ ability: 'earth_shock', addEffects: [{ type: 'interrupt', lockout: 4 }] }],
          },
        },
        {
          id: 'sha_r11_elemental_attunement',
          name: 'Rime Lock',
          description: 'Rime Jolt roots the target for 2 sec.',
          icon: 'frost_shock',
          effect: {
            ability: [{ ability: 'frost_shock', addEffects: [{ type: 'root', duration: 2 }] }],
          },
        },
        {
          id: 'sha_r11_healing_stream',
          name: 'Gripping Earth',
          description:
            'Grants a target-centered Groundsnare that roots enemies within 4 yd for 2 sec, then slows them by 40% for 6 sec. 30 sec cooldown.',
          icon: 'earthbind',
          effect: { grant: { ability: 'earthbind' }, runtime: { slowPercent: 40 } },
        },
      ],
    },
    {
      level: 14,
      theme: 'kit_management',
      decision: 'predictable mana efficiency vs stronger imbues vs ward sustain',
      options: [
        {
          id: 'sha_r14_chain_lightning',
          name: 'Flow State',
          description:
            'After spending 120 Mana, your next Shaman action that costs Mana costs 40 less. The ready state has no short expiry.',
          icon: 'healing_wave',
          effect: { runtime: { manaThreshold: 120, costReduction: 40 } },
        },
        {
          id: 'sha_r14_improved_flame_shock',
          name: 'Imbue Mastery',
          description:
            'Pyrebrand grants 1 extra Thunder charge every 3rd Arc Bolt. Galeheart echoes deal 25% more damage, Stonebound gains 5% damage reduction, and Lifespring deposits 20% more Mending Current.',
          icon: 'rockbiter_weapon',
          effect: {
            runtime: {
              extraCharge: 1,
              everyNthBolt: 3,
              galeheartPercent: 25,
              stoneboundPercent: 5,
              lifespringPercent: 20,
            },
          },
        },
        {
          id: 'sha_r14_weapon_fury',
          name: 'Ward Cycle',
          description:
            'A successful Arc Bolt, Ancestral Strike, or Mending Waters restores 1 Thunder Ward charge and 10 Mana, once every 6 sec.',
          icon: 'lightning_shield',
          effect: { runtime: { wardCharges: 1, mana: 10, internalCooldown: 6 } },
        },
      ],
    },
    {
      level: 17,
      theme: 'power_spike',
      decision: 'throughput cooldown vs extended mobile casting vs major ward defense',
      options: [
        {
          id: 'sha_r17_earthbind',
          name: 'Primal Exaltation',
          description:
            'For 12 sec, Thundercall Arc Bolt and Skybranch cast 50% faster, while Arc Bolt grants 2 Thunder; Warspirit triggers its cadence every 2 weapon hits; Spiritmend adds 50% more healing to Mending Current. 120 sec cooldown.',
          icon: 'elemental_mastery',
          effect: { grant: { ability: 'primal_exaltation' } },
        },
        {
          id: 'sha_r17_improved_ghost_wolf',
          name: 'Wayfarer Grace',
          description:
            'When ready, exiting Shadewolf allows casting while moving for 8 sec. 90 sec internal cooldown.',
          icon: 'ghost_wolf',
          effect: { runtime: { duration: 8, internalCooldown: 90 } },
        },
        {
          id: 'sha_r17_elemental_warding',
          name: 'Ancestral Bulwark',
          description:
            'Activating Thunder Ward grants 40% damage reduction for 6 sec. 120 sec internal cooldown.',
          icon: 'lightning_shield',
          effect: {
            runtime: { damageReductionPercent: 40, duration: 6, internalCooldown: 120 },
          },
        },
      ],
    },
    {
      level: 20,
      theme: 'capstone',
      decision: 'refill faster vs spend again sooner vs your weapon picks the spend',
      options: [
        {
          id: 'sha_r20_bloodlust',
          name: 'Deep Reservoir',
          description:
            'After Earthen Jolt or Faultwake consumes all Thunder, retain 2 Thunder. After a spell consumes Stormcast, retain 1 Warspirit Cadence step. After Cascading Mend consumes Mending Current, restore 25% of the amount consumed.',
          icon: 'lightning_bolt',
          effect: { runtime: { thunderCharges: 2, cadenceSteps: 1, reseedPercent: 25 } },
        },
        {
          id: 'sha_r20_elemental_fury',
          name: 'Echoing Elements',
          description:
            'After Earthen Jolt or Faultwake consumes all Thunder, repeat 40% of its damage after 1 sec. A spell that consumes Stormcast repeats at 40% strength. Healing from consumed Mending Current repeats at 40% strength after 2 sec. These repeats cannot trigger other effects.',
          icon: 'chain_lightning',
          effect: { runtime: { echoPercent: 40, damageDelay: 1, healingDelay: 2 } },
        },
        {
          id: 'sha_r20_tidal_waves',
          name: 'Living Weapon',
          description:
            "After Earthen Jolt or Faultwake consumes all Thunder, Pyrebrand makes the next Arc Bolt instant. Galeheart's final echo deals 50% damage to up to 2 enemies within 8 yards. A Stonebound spell that consumes Stormcast grants an absorb equal to 8% of your maximum health. With Lifespring active, Tidecall also adds 50% of its full heal to the most injured ally within 10 yards.",
          icon: 'rockbiter_weapon',
          effect: {
            runtime: {
              cleavePercent: 50,
              cleaveTargets: 2,
              absorbPercent: 8,
              allyDepositPercent: 50,
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
      theme: 'mobility',
      decision: 'faster anchor vs post-anchor sprint vs sustained health-paid movement',
      options: [
        {
          id: 'wlk_r5_bane',
          name: 'Grave Rhythm',
          description: 'Umbral Anchor recovers 15 sec faster.',
          icon: 'wlk_r5_bane',
          effect: { ability: [{ ability: 'umbral_anchor', cooldownFlat: -15 }] },
        },
        {
          id: 'wlk_r5_improved_corruption',
          name: 'Blacktide',
          description: 'Returning to Umbral Anchor grants 40% movement speed for 4 sec.',
          icon: 'wlk_r5_improved_corruption',
          effect: {
            global: { warlockBlacktideSpeedPct: 0.4 },
            tuning: { duration: 4 },
          },
        },
        {
          id: 'wlk_r5_improved_immolate',
          name: 'Sacrilegious March',
          description:
            'Grants Sacrilegious March: move 35% faster while sacrificing 2% maximum health each second.',
          icon: 'wlk_r5_improved_immolate',
          effect: { grant: { ability: 'sacrilegious_march' } },
        },
      ],
    },
    {
      level: 8,
      theme: 'control',
      decision: 'ranged interrupt vs area fear vs escalating spell snare',
      options: [
        {
          id: 'wlk_r8_voidfeast',
          name: 'Abyssal Gag',
          description:
            'Grants Abyssal Gag early. It interrupts the enemy and silences all of its spells for 4 sec.',
          icon: 'wlk_r8_voidfeast',
          effect: {
            grant: { ability: 'spell_lock' },
            ability: [
              {
                ability: 'spell_lock',
                addEffects: [{ type: 'silence', duration: 4 }],
              },
            ],
          },
        },
        {
          id: 'wlk_r8_howl_of_terror',
          name: 'Dread Chorus',
          description:
            'Grants Dread Chorus: frighten enemies within 8 yards for up to 3 sec. Damage may break the effect. 40 sec cooldown.',
          icon: 'wlk_r8_howl_of_terror',
          effect: { grant: { ability: 'howl_of_terror' } },
        },
        {
          id: 'wlk_r8_curse_of_exhaustion',
          name: 'Leaden Hex',
          description:
            'Damaging spells apply a 5% slow for 5 sec, stacking 3 times. At 3 stacks, the next spell roots for 1.5 sec and consumes them. A target can be rooted once every 15 sec.',
          icon: 'wlk_r8_curse_of_exhaustion',
          effect: {
            global: { warlockLeadenHex: 0.05 },
            tuning: {
              maxStacks: 3,
              slowDuration: 5,
              rootDuration: 1.5,
              rootLockDuration: 15,
            },
          },
        },
      ],
    },
    {
      level: 11,
      theme: 'survival',
      decision: 'stronger Fiendhide vs health-paid shield vs party Soulwell ward',
      options: [
        {
          id: 'wlk_r11_improved_life_tap',
          name: 'Pact Deepened',
          description:
            'Fiendhide grants 100% more armor and reduces magic damage taken by 5% while active.',
          icon: 'wlk_r11_improved_life_tap',
          effect: {
            ability: [{ ability: 'demon_skin', buffPct: 1 }],
            global: { warlockFiendhideMagicDrPct: 0.05 },
          },
        },
        {
          id: 'wlk_r11_fel_concentration',
          name: 'Sanguine Covenant',
          description:
            'Grants Sanguine Covenant: sacrifice 10% of your current health to absorb 30% of your maximum health for 8 sec.',
          icon: 'wlk_r11_fel_concentration',
          effect: { grant: { ability: 'dark_pact' } },
        },
        {
          id: 'wlk_r11_demon_armor',
          name: 'Deep Hunger',
          description:
            'The first time each group member touches your Soulwell, it shields them for 15% of their maximum health for 30 sec. Each player can gain this shield once per Soulwell.',
          icon: 'wlk_r11_demon_armor',
          effect: {
            global: { warlockSoulwellWardPct: 0.15 },
            tuning: { soulwellWardDuration: 30 },
          },
        },
      ],
    },
    {
      level: 14,
      theme: 'resource_behavior',
      decision: 'cheaper generator vs richer Hard Bargain vs spender-fed free generators',
      options: [
        {
          id: 'wlk_r14_amplify_curse',
          name: 'Deepened Hex',
          description: "Your specialization's primary generator costs 25% less mana.",
          icon: 'wlk_r14_amplify_curse',
          effect: {
            ability: [
              { ability: 'needle_of_fate', costPct: -0.25 },
              { ability: 'soul_harvest', costPct: -0.25 },
              { ability: 'shadow_bolt', costPct: -0.25 },
            ],
          },
        },
        {
          id: 'wlk_r14_ruin',
          name: 'Blood Credit',
          description: 'Hard Bargain and Cruel Pact restore 50% more mana for the same health.',
          icon: 'wlk_r14_ruin',
          effect: {
            ability: [
              { ability: 'life_tap', buffPct: 0.5 },
              { ability: 'cruel_pact', buffPct: 0.5 },
            ],
          },
        },
        {
          id: 'wlk_r14_shadow_mastery',
          name: 'Shadow Credit',
          description:
            'Each time you spend at least 40% of your specialization resource, you gain 1 free generator. Spending at least 80% at once grants 2. Separate triggers can accumulate up to 2 charges.',
          icon: 'wlk_r14_shadow_mastery',
          effect: {
            global: { warlockShadowCredit: 0.4 },
            tuning: { upperThresholdPct: 0.8, lowerCharges: 1, upperCharges: 2, maxCharges: 2 },
          },
        },
      ],
    },
    {
      level: 17,
      theme: 'major_offense',
      decision: 'faster signature window vs stationary focus vs periodic instant generator',
      options: [
        {
          id: 'wlk_r17_death_coil',
          name: 'Grand Malediction',
          description:
            "Reduces your specialization's setup cooldown by 25%: Hex of Violence (Affliction; punishes the enemy's damaging actions), Unholy Command (Necromancy; briefly empowers all your undead), or Ruinous Brand (Destruction; echoes your direct spells).",
          icon: 'wlk_r17_death_coil',
          effect: {
            ability: [
              { ability: 'hex_of_violence', cooldownPct: -0.25 },
              { ability: 'unholy_command', cooldownPct: -0.25 },
              { ability: 'ruinous_brand', cooldownPct: -0.25 },
            ],
          },
        },
        {
          id: 'wlk_r17_improved_fear',
          name: 'Ashen Focus',
          description:
            "After standing still for 1 sec, your specialization's primary generator casts 20% faster. Moving removes the benefit immediately.",
          icon: 'wlk_r17_improved_fear',
          effect: {
            global: { warlockAshenFocus: 0.2 },
            tuning: { stationaryDuration: 1 },
          },
        },
        {
          id: 'wlk_r17_demonic_resilience',
          name: 'Hexstorm',
          description:
            "Every 3rd primary generator makes your specialization's next generator within 8 sec instant, at most once every 10 sec.",
          icon: 'wlk_r17_demonic_resilience',
          effect: {
            proc: {
              id: 'wlk_curse_mastery',
              name: 'Hexstorm',
              trigger: {
                on: 'castNth',
                n: 3,
                abilities: ['needle_of_fate', 'soul_harvest', 'shadow_bolt'],
                icd: 10,
              },
              responses: [
                {
                  kind: 'empowerNext',
                  aura: 'next_cast_instant',
                  abilities: ['needle_of_fate', 'soul_harvest', 'shadow_bolt'],
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
      theme: 'capstone_utility',
      decision: 'casting-driven Warlock cooldowns vs one forbidden repeat vs battlefield rift',
      options: [
        {
          id: 'wlk_r20_chaos_bolt',
          name: 'Unbroken Ritual',
          description:
            'Each second spent casting or channeling reduces the remaining cooldown of your Warlock class and specialization abilities by 0.5 sec. Does not affect capstone talents.',
          icon: 'wlk_r20_chaos_bolt',
          effect: { global: { warlockUnbrokenRitual: 0.5 } },
        },
        {
          id: 'wlk_r20_grimoire_of_haste',
          name: 'Forbidden Reflection',
          description:
            'The first Warlock class or specialization ability with a cooldown that you use, except Soulwell and Army of the Dead, creates a forbidden reflection. You may use that same ability once more within 10 sec for its normal cost without starting another cooldown. This effect can occur once every 60 sec.',
          icon: 'wlk_r20_grimoire_of_haste',
          effect: {
            global: { warlockForbiddenReflection: 60 },
            tuning: { reflectionWindow: 10 },
          },
        },
        {
          id: 'wlk_r20_curse_mastery',
          name: 'Abyssal Rift',
          description:
            'Grants Abyssal Rift: pull enemies within 8 yards to the chosen location, deal heavy Shadow damage, and stun them for 2 sec. Bosses take damage but cannot be pulled or stunned.',
          icon: 'wlk_r20_curse_mastery',
          effect: { grant: { ability: 'abyssal_rift' } },
        },
      ],
    },
  ],
};

export const DRUID_CHOICE_ROWS: ClassChoiceRows = {
  rows: [
    {
      level: 5,
      theme: 'movement',
      decision: 'escape control, sprint after shifting, or cast while moving',
      options: [
        {
          id: 'dru_r5_improved_wrath',
          name: 'Wildshift',
          description: 'Shapeshifting removes breakable roots and slows.',
          icon: 'travel_form',
          effect: { intrinsic: { mechanic: 'druid_wildshift', metrics: {} } },
        },
        {
          id: 'dru_r5_ferocity',
          name: 'Loping Stride',
          description:
            'Shapeshifting grants 60% movement speed for 3 sec, at most once every 20 sec.',
          icon: 'cat_form',
          effect: {
            intrinsic: {
              mechanic: 'druid_loping_stride',
              metrics: { pct: 0.6, duration: 3, icd: 20 },
            },
          },
        },
        {
          id: 'dru_r5_natures_bounty',
          name: 'Skylark',
          description: 'Wildbolt, Skyfall, Wildmend, and Second Bloom are castable while moving.',
          icon: 'wrath',
          effect: {
            ability: [
              { ability: 'wrath', castWhileMoving: true },
              { ability: 'starfire', castWhileMoving: true },
              { ability: 'healing_touch', castWhileMoving: true },
              { ability: 'regrowth', castWhileMoving: true },
            ],
          },
        },
      ],
    },
    {
      level: 8,
      theme: 'defense',
      decision: 'active armor, reactive absorption, or reactive self healing',
      options: [
        {
          id: 'dru_r8_typhoon',
          name: 'Oakhide Reflex',
          description: 'Oakhide gains 50% more armor and its cooldown is reduced by 20 sec.',
          icon: 'barkskin',
          effect: {
            ability: [{ ability: 'barkskin', buffPct: 0.5, cooldownFlat: -20 }],
          },
        },
        {
          id: 'dru_r8_improved_roots',
          name: 'Ironhide Reflex',
          description:
            'Taking a hit for at least 20% of maximum health shields you for 15% of maximum health for 6 sec. 20 sec internal cooldown.',
          icon: 'bear_form',
          effect: {
            proc: {
              id: 'dru_ironhide_reflex',
              name: 'Ironhide Reflex',
              trigger: { on: 'bigHitTaken', hpFrac: 0.2, icd: 20 },
              responses: [
                {
                  kind: 'absorb',
                  amountPctMaxHp: 0.15,
                  duration: 6,
                  name: 'Ironhide Reflex',
                },
              ],
            },
          },
        },
        {
          id: 'dru_r8_brutal_bash',
          name: 'Bear-Blood Mending',
          description:
            'Taking a hit for at least 20% of maximum health heals you for 12% of maximum health. 20 sec internal cooldown.',
          icon: 'healing_touch',
          effect: {
            proc: {
              id: 'dru_bear_blood_mending',
              name: 'Bear-Blood Mending',
              trigger: { on: 'bigHitTaken', hpFrac: 0.2, icd: 20 },
              responses: [{ kind: 'heal', amountPctMaxHp: 0.12, target: 'self' }],
            },
          },
        },
      ],
    },
    {
      level: 11,
      theme: 'control',
      decision: 'area knockback, a root that arms a free cast, or a cheaper stun',
      options: [
        {
          id: 'dru_r11_innervate',
          name: 'Typhoon',
          description: 'Grants Typhoon: knock back and daze all enemies within 8 yd.',
          icon: 'typhoon',
          effect: { grant: { ability: 'typhoon' } },
        },
        {
          id: 'dru_r11_furor',
          name: 'Gripping Ambush',
          description:
            'Gripping Roots makes your next Wildbolt within 8 sec instant, at most once every 15 sec.',
          icon: 'entangling_roots',
          effect: {
            proc: {
              id: 'dru_gripping_ambush',
              name: 'Gripping Ambush',
              trigger: { on: 'castNth', n: 1, abilities: ['entangling_roots'], icd: 15 },
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
          id: 'dru_r11_improved_mark',
          name: 'Concussive Economy',
          description: 'Concuss restores 15 rage and removes 20 sec from its cooldown.',
          icon: 'bash',
          effect: {
            proc: {
              id: 'dru_concussive_economy',
              name: 'Concussive Economy',
              trigger: { on: 'castNth', n: 1, abilities: ['bash'] },
              responses: [
                { kind: 'resource', amount: 15, resourceType: 'rage' },
                { kind: 'cooldownRefund', ability: 'bash', seconds: 20 },
              ],
            },
          },
        },
      ],
    },
    {
      level: 14,
      theme: 'engine_economy',
      decision: 'Moongrove refunds, bleed-fed Old Blood, or wider Overbloom replanting',
      options: [
        {
          id: 'dru_r14_savage_fury',
          name: 'Blooddrunk',
          description: 'Each tick of your Flense and Bloodrift bleeds also adds 1 Old Blood.',
          icon: 'rip',
          effect: { intrinsic: { mechanic: 'druid_blooddrunk', metrics: { oldBloodPerTick: 1 } } },
        },
        {
          id: 'dru_r14_moonfury',
          name: 'Highmoon Tithe',
          description: 'Moonsurge and Sunwake each also restore 15% of your maximum mana.',
          icon: 'moonseed',
          effect: {
            intrinsic: { mechanic: 'druid_highmoon_tithe', metrics: { pct: 0.15 } },
          },
        },
        {
          id: 'dru_r14_empowered_touch',
          name: 'Seedspread',
          description:
            'Overbloom replants a fresh Wildbloom on every ally whose healing it harvested.',
          icon: 'rejuvenation',
          effect: {
            intrinsic: { mechanic: 'druid_seedspread', metrics: {} },
          },
        },
      ],
    },
    {
      level: 17,
      theme: 'major_cooldown',
      decision: 'feral burst, party healing, or resource restoration',
      options: [
        {
          id: 'dru_r17_improved_barkskin',
          name: 'Red Haze',
          description: 'Grants Red Haze.',
          icon: 'berserk',
          effect: { grant: { ability: 'berserk' } },
        },
        {
          id: 'dru_r17_frenzied_regeneration',
          name: 'Gladesong',
          description: 'Grants Gladesong.',
          icon: 'tranquility',
          effect: { grant: { ability: 'tranquility' } },
        },
        {
          id: 'dru_r17_survival_of_the_fittest',
          name: 'Lifesap',
          description:
            'Grants Lifesap: living sap restores your current resource in waves, in any form.',
          icon: 'innervate',
          effect: { grant: { ability: 'innervate' } },
        },
      ],
    },
    {
      level: 20,
      theme: 'engine_capstone',
      decision: 'a head start after spending, a stronger spend, or resource back while filling',
      options: [
        {
          id: 'dru_r20_improved_hurricane',
          name: "Nature's Echo",
          description:
            'After you spend Moontide, Old Blood, or Verdance, it starts refilling with 1 already gained.',
          icon: 'moonseed',
          effect: { intrinsic: { mechanic: 'druid_natures_echo', metrics: { headStart: 1 } } },
        },
        {
          id: 'dru_r20_berserk',
          name: 'Wild Apex',
          description:
            'Moonsurge, Sunwake, Redharvest, Marrowbreak, and Overbloom are 25% stronger.',
          icon: 'primal_reflexes',
          effect: { intrinsic: { mechanic: 'druid_wild_apex', metrics: { pct: 0.25 } } },
        },
        {
          id: 'dru_r20_tranquility',
          name: 'Quickening',
          description:
            'Every 1 of Moontide, Old Blood, or Verdance you gain restores 2% of your maximum mana, 5 energy, or 3 rage, matching your current form.',
          icon: 'innervate',
          effect: {
            intrinsic: {
              mechanic: 'druid_quickening',
              metrics: { perStageGained: 1, manaPct: 0.02, energy: 5, rage: 3 },
            },
          },
        },
      ],
    },
  ],
};
