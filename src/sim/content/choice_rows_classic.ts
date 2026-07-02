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
