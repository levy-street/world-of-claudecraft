// ---------------------------------------------------------------------------
// Glitch specializations and class-wide choice rows. Kept beside the Glitch
// kit (glitch.ts) rather than in the shared classic tables. Every option here
// uses an existing, already-applied effect kind (ability mods, global mods,
// stats); Instability itself is tuned in combat/glitch_corruption.ts.
// ---------------------------------------------------------------------------

import type { ClassChoiceRows } from './talent_rows';
import type { ClassTalents } from './talents';

export const GLITCH_TALENTS: ClassTalents = {
  class: 'glitch',
  specs: [
    {
      id: 'overclock',
      class: 'glitch',
      name: 'Overclock',
      role: 'dps',
      icon: '*',
      description: 'A burst caster who banks Instability and dumps it in one detonation.',
      signature: 'glitch_fork_bomb',
      mastery: {
        name: 'Overvolt',
        description: 'Increases Overflow and Fork Bomb damage by 10%.',
        effect: {
          ability: [
            { ability: 'glitch_overflow', dmgPct: 0.1 },
            { ability: 'glitch_fork_bomb', dmgPct: 0.1 },
          ],
        },
      },
    },
    {
      id: 'entropy',
      class: 'glitch',
      name: 'Entropy',
      role: 'dps',
      icon: '+',
      description: 'A decay caster who stacks long-running effects and lets them compound.',
      signature: 'glitch_bit_rot',
      mastery: {
        name: 'Slow Decay',
        description: 'Increases the damage of your damage-over-time effects by 10%.',
        effect: { global: { dotDmgPct: 0.1 } },
      },
    },
    {
      id: 'sandbox',
      class: 'glitch',
      name: 'Sandbox',
      role: 'dps',
      icon: 'x',
      description: 'A resilient caster who turns Instability into shields and second chances.',
      signature: 'glitch_sandbox',
      mastery: {
        name: 'Isolation',
        description: 'Increases Stamina by 10%.',
        effect: { stats: { staPct: 0.1 } },
      },
    },
  ],
};

export const GLITCH_CHOICE_ROWS: ClassChoiceRows = {
  rows: [
    {
      level: 5,
      theme: 'mobility',
      decision: 'more skips vs more fields vs a cheaper first dump',
      options: [
        {
          id: 'glt_r5_hot_swap',
          icon: 'glitch_phase_skip',
          name: 'Hot Swap',
          description: 'Phase Skip recovers 5 sec faster.',
          effect: { ability: [{ ability: 'glitch_phase_skip', cooldownFlat: -5 }] },
        },
        {
          id: 'glt_r5_wide_band',
          icon: 'glitch_noise_field',
          name: 'Wide Band',
          description: 'Noise Field recovers 3 sec faster.',
          effect: { ability: [{ ability: 'glitch_noise_field', cooldownFlat: -3 }] },
        },
        {
          id: 'glt_r5_prefetch',
          icon: 'glitch_overflow',
          name: 'Prefetch',
          description: 'Overflow costs 10% less Instability.',
          effect: { ability: [{ ability: 'glitch_overflow', costPct: -0.1 }] },
        },
      ],
    },
    {
      level: 8,
      theme: 'generation',
      decision: 'faster opener vs harder field vs harder leak',
      options: [
        {
          id: 'glt_r8_quick_byte',
          icon: 'glitch_corrupt_byte',
          name: 'Quick Byte',
          description: 'Reduces the cast time of Corrupt Byte by 50%.',
          effect: { ability: [{ ability: 'glitch_corrupt_byte', castPct: -0.5 }] },
        },
        {
          id: 'glt_r8_loud_noise',
          icon: 'glitch_noise_field',
          name: 'Loud Noise',
          description: 'Increases Noise Field damage by 20%.',
          effect: { ability: [{ ability: 'glitch_noise_field', dmgPct: 0.2 }] },
        },
        {
          id: 'glt_r8_deep_leak',
          icon: 'glitch_memory_leak',
          name: 'Deep Leak',
          description: 'Increases Memory Leak damage by 20%.',
          effect: { ability: [{ ability: 'glitch_memory_leak', dmgPct: 0.2 }] },
        },
      ],
    },
    {
      level: 11,
      theme: 'spending',
      decision: 'cheaper dump vs bigger dump vs faster dump',
      options: [
        {
          id: 'glt_r11_buffer',
          icon: 'glitch_overflow',
          name: 'Buffer',
          description: 'Overflow costs 20% less Instability.',
          effect: { ability: [{ ability: 'glitch_overflow', costPct: -0.2 }] },
        },
        {
          id: 'glt_r11_spike',
          icon: 'glitch_fork_bomb',
          name: 'Spike',
          description: 'Increases Overflow damage by 15%.',
          effect: { ability: [{ ability: 'glitch_overflow', dmgPct: 0.15 }] },
        },
        {
          id: 'glt_r11_tight_loop',
          icon: 'glitch_cascade',
          name: 'Tight Loop',
          description: 'Overflow recovers 2 sec faster.',
          effect: { ability: [{ ability: 'glitch_overflow', cooldownFlat: -2 }] },
        },
      ],
    },
    {
      level: 14,
      theme: 'survival',
      decision: 'more health vs more armor vs faster rollback',
      options: [
        {
          id: 'glt_r14_redundancy',
          icon: 'glitch_sandbox',
          name: 'Redundancy',
          description: 'Increases maximum health by 5%.',
          effect: { stats: { maxHpPct: 0.05 } },
        },
        {
          id: 'glt_r14_hardened',
          icon: 'glitch_noise_field',
          name: 'Hardened',
          description: 'Increases armor by 20%.',
          effect: { stats: { armorPct: 0.2 } },
        },
        {
          id: 'glt_r14_snapshot',
          icon: 'glitch_rollback',
          name: 'Snapshot',
          description: 'Rollback recovers 20 sec faster.',
          effect: { ability: [{ ability: 'glitch_rollback', cooldownFlat: -20 }] },
        },
      ],
    },
    {
      level: 17,
      theme: 'compounding',
      decision: 'faster cascades vs cheaper cascades vs harder decay',
      options: [
        {
          id: 'glt_r17_chain_reaction',
          icon: 'glitch_cascade',
          name: 'Chain Reaction',
          description: 'Cascade recovers 6 sec faster.',
          effect: { ability: [{ ability: 'glitch_cascade', cooldownFlat: -6 }] },
        },
        {
          id: 'glt_r17_free_cascade',
          icon: 'glitch_overflow',
          name: 'Zero Copy',
          description: 'Cascade costs no Instability.',
          effect: { ability: [{ ability: 'glitch_cascade', costPct: -1 }] },
        },
        {
          id: 'glt_r17_rot',
          icon: 'glitch_bit_rot',
          name: 'Persistent Fault',
          description: 'Increases the damage of your damage-over-time effects by 10%.',
          effect: { global: { dotDmgPct: 0.1 } },
        },
      ],
    },
    {
      level: 20,
      theme: 'capstone',
      decision: 'spell power vs spell crit vs intellect',
      options: [
        {
          id: 'glt_r20_overdrive',
          icon: 'glitch_fork_bomb',
          name: 'Overdrive',
          description: 'Increases all spell damage you deal by 6%.',
          effect: { global: { spellDmgPct: 0.06 } },
        },
        {
          id: 'glt_r20_bit_flip',
          icon: 'glitch_corrupt_byte',
          name: 'Bit Flip',
          description: 'Increases your critical strike chance by 3%.',
          effect: { stats: { crit: 0.03 } },
        },
        {
          id: 'glt_r20_parity',
          icon: 'glitch_memory_leak',
          name: 'Parity',
          description: 'Increases Intellect by 10%.',
          effect: { stats: { intPct: 0.1 } },
        },
      ],
    },
  ],
};
