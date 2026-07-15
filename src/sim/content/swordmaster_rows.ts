// SwordMaster class-wide choice rows. Six tiers at levels 5, 8, 11, 14, 17,
// and 20, with one of three choices per tier.

import type { RowTree } from './talent_rows';

export const SWORDMASTER_ROWS: RowTree = [
  {
    level: 5,
    theme: 'Mobility',
    decision: 'sustained speed, cheaper lunges, or raw agility',
    options: [
      {
        id: 'sm_row_gale_footwork',
        name: 'Gale Footwork',
        description: 'Reduces the cooldown of Fleet Step by 30%.',
        effect: { ability: [{ ability: 'fleet_step', cooldownPct: -0.3 }] },
      },
      {
        id: 'sm_row_slipstream',
        name: 'Slipstream',
        description: 'Reduces the cost and cooldown of Wind Lunge by 25%.',
        effect: {
          ability: [{ ability: 'wind_lunge', costPct: -0.25, cooldownPct: -0.25 }],
        },
      },
      {
        id: 'sm_row_long_stride',
        name: 'Long Stride',
        description: 'Increases Agility by 3.',
        effect: { stats: { agi: 3 } },
      },
    ],
  },
  {
    level: 8,
    theme: 'Edge',
    decision: 'paired strikes, sweeping pressure, or critical precision',
    options: [
      {
        id: 'sm_row_keen_twins',
        name: 'Keen Twins',
        description: 'Twin Slash deals 20% more damage.',
        effect: { ability: [{ ability: 'twin_slash', dmgPct: 0.2 }] },
      },
      {
        id: 'sm_row_wide_crescent',
        name: 'Wide Crescent',
        description: 'Crescent Sweep deals 20% more damage.',
        effect: { ability: [{ ability: 'crescent_sweep', dmgPct: 0.2 }] },
      },
      {
        id: 'sm_row_flowing_edge',
        name: 'Flowing Edge',
        description: 'Increases critical strike chance by 3%.',
        effect: { stats: { crit: 0.03 } },
      },
    ],
  },
  {
    level: 11,
    theme: 'Tempo',
    decision: 'constant cadence, efficient area attacks, or stronger agility scaling',
    options: [
      {
        id: 'sm_row_relentless_rhythm',
        name: 'Relentless Rhythm',
        description: 'Increases melee haste by 8%.',
        effect: { global: { meleeHastePct: 0.08 } },
      },
      {
        id: 'sm_row_efficient_dance',
        name: 'Efficient Dance',
        description: 'Reduces the Energy cost of Blade Dance by 25%.',
        effect: { ability: [{ ability: 'blade_dance', costPct: -0.25 }] },
      },
      {
        id: 'sm_row_inner_current',
        name: 'Inner Current',
        description: 'Increases Agility by 8%.',
        effect: { stats: { agiPct: 0.08 } },
      },
    ],
  },
  {
    level: 14,
    theme: 'Flow',
    decision: 'defensive flow, longer quickening, or a stronger lasting aura',
    options: [
      {
        id: 'sm_row_parrying_current',
        name: 'Parrying Current',
        description: 'Parrying Flow grants 25% more dodge and recharges 25% faster.',
        effect: {
          ability: [{ ability: 'parrying_flow', buffPct: 0.25, cooldownPct: -0.25 }],
        },
      },
      {
        id: 'sm_row_quicksilver',
        name: 'Quicksilver',
        description: 'Quickening grants 30% attack speed and recharges 20% faster.',
        effect: { ability: [{ ability: 'quickening', buffPct: 0.2, cooldownPct: -0.2 }] },
      },
      {
        id: 'sm_row_azure_tempering',
        name: 'Azure Tempering',
        description: 'Sword Aura grants 25% more Strength and Agility.',
        effect: { ability: [{ ability: 'sword_aura', buffPct: 0.25 }] },
      },
    ],
  },
  {
    level: 17,
    theme: 'Discipline',
    decision: 'Tempest force, Duelist cadence, or Azure mobility',
    options: [
      {
        id: 'sm_row_cyclone_edge',
        name: 'Cyclone Edge',
        description: 'Blade Cyclone deals 25% more damage.',
        effect: { ability: [{ ability: 'blade_cyclone', dmgPct: 0.25 }] },
      },
      {
        id: 'sm_row_duelist_tempo',
        name: 'Duelist Tempo',
        description: 'Duelist Flurry recharges 25% faster.',
        effect: { ability: [{ ability: 'duelist_flurry', cooldownPct: -0.25 }] },
      },
      {
        id: 'sm_row_azure_momentum',
        name: 'Azure Momentum',
        description: 'Azure Rush recharges 25% faster.',
        effect: { ability: [{ ability: 'azure_rush', cooldownPct: -0.25 }] },
      },
    ],
  },
  {
    level: 20,
    theme: 'Mastery',
    decision: 'area mastery, paired burst, or unrestricted motion',
    options: [
      {
        id: 'sm_row_storm_of_steel',
        name: 'Storm of Steel',
        description: 'Blade Dance deals 25% more damage.',
        effect: { ability: [{ ability: 'blade_dance', dmgPct: 0.25 }] },
      },
      {
        id: 'sm_row_perfect_pair',
        name: 'Perfect Pair',
        description: 'Twin Finisher deals 30% more damage.',
        effect: { ability: [{ ability: 'twin_finisher', dmgPct: 0.3 }] },
      },
      {
        id: 'sm_row_unbound_motion',
        name: 'Unbound Motion',
        description: 'Fleet Step and Wind Lunge recharge 30% faster.',
        effect: {
          ability: [
            { ability: 'fleet_step', cooldownPct: -0.3 },
            { ability: 'wind_lunge', cooldownPct: -0.3 },
          ],
        },
      },
    ],
  },
];
