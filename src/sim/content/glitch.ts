import type { AbilityDef } from '../types';

// The Glitch: a ranged hybrid whose resource, Instability, is never spent to
// open a fight. It builds from the Glitch's own effects already running on the
// world (each damage-over-time effect it owns on an enemy, and each ground zone
// it has placed), and each effect builds faster the longer it has been running.
// The engine side lives in src/sim/combat/glitch_corruption.ts.
//
// Generators (Corrupt Byte, Noise Field, Memory Leak, Bit Rot) cost nothing;
// spenders (Overflow, Fork Bomb, Rollback, Sandbox) cost Instability. Every
// Glitch hit on a target is amplified per Glitch effect already on that target
// (Feedback), and Cascade extends every effect it touches, so effects compound.
export const GLITCH_ABILITIES: Record<string, AbilityDef> = {
  glitch_corrupt_byte: {
    id: 'glitch_corrupt_byte',
    name: 'Corrupt Byte',
    class: 'glitch',
    learnLevel: 1,
    cost: 0,
    castTime: 1.5,
    cooldown: 0,
    range: 30,
    school: 'shadow',
    requiresTarget: true,
    effects: [{ type: 'dot', total: 30, duration: 12, interval: 3 }],
    ranks: [
      {
        rank: 2,
        level: 10,
        cost: 0,
        effects: [{ type: 'dot', total: 54, duration: 12, interval: 3 }],
      },
      {
        rank: 3,
        level: 18,
        cost: 0,
        effects: [{ type: 'dot', total: 78, duration: 12, interval: 3 }],
      },
    ],
    description:
      'Corrupts the target, dealing $d Shadow damage over 12 sec. Builds Instability while it runs.',
  },
  glitch_noise_field: {
    id: 'glitch_noise_field',
    name: 'Noise Field',
    class: 'glitch',
    learnLevel: 2,
    cost: 0,
    castTime: 0,
    cooldown: 12,
    range: 30,
    school: 'arcane',
    requiresTarget: false,
    targetMode: 'position',
    effects: [
      {
        type: 'groundAoE',
        min: 6,
        max: 8,
        radius: 6,
        duration: 8,
        interval: 1,
        slowMult: 0.7,
        slowDuration: 1.5,
      },
    ],
    description:
      'Fills the target area with static for 8 sec, dealing 6 to 8 Arcane damage each second and slowing enemies inside by 30%. Builds Instability while it lasts.',
  },
  glitch_phase_skip: {
    id: 'glitch_phase_skip',
    name: 'Phase Skip',
    class: 'glitch',
    learnLevel: 4,
    cost: 0,
    castTime: 0,
    cooldown: 15,
    range: 20,
    school: 'arcane',
    requiresTarget: false,
    targetMode: 'position',
    effects: [{ type: 'blinkToAim', breakRoots: true }],
    description: 'Skip to the target location up to 20 yards away, breaking roots.',
  },
  glitch_overflow: {
    id: 'glitch_overflow',
    name: 'Overflow',
    class: 'glitch',
    learnLevel: 3,
    cost: 30,
    castTime: 0,
    cooldown: 6,
    range: 30,
    school: 'shadow',
    requiresTarget: true,
    effects: [{ type: 'directDamage', min: 44, max: 52 }],
    ranks: [
      {
        rank: 2,
        level: 16,
        cost: 30,
        effects: [{ type: 'directDamage', min: 70, max: 82 }],
      },
    ],
    description:
      'Dumps stored Instability into the target, dealing $d Shadow damage. Costs 30 Instability.',
  },
  glitch_packet_loss: {
    id: 'glitch_packet_loss',
    name: 'Packet Loss',
    class: 'glitch',
    learnLevel: 8,
    cost: 0,
    castTime: 0,
    cooldown: 24,
    range: 30,
    school: 'arcane',
    requiresTarget: true,
    effects: [{ type: 'interrupt', lockout: 6 }],
    description:
      "Drops the target's spell mid-cast, preventing any spell in that school from being cast for 6 sec.",
  },
  glitch_null_pointer: {
    id: 'glitch_null_pointer',
    name: 'Null Pointer',
    class: 'glitch',
    learnLevel: 9,
    cost: 0,
    castTime: 0,
    cooldown: 20,
    range: 30,
    school: 'arcane',
    requiresTarget: true,
    effects: [{ type: 'root', duration: 4 }],
    description: 'Points the target at nothing, rooting it in place for 4 sec.',
  },
  glitch_memory_leak: {
    id: 'glitch_memory_leak',
    name: 'Memory Leak',
    class: 'glitch',
    learnLevel: 5,
    cost: 0,
    castTime: 0,
    cooldown: 8,
    range: 30,
    school: 'shadow',
    requiresTarget: true,
    effects: [{ type: 'dot', total: 60, duration: 15, interval: 3 }],
    description:
      "Leaks the target's strength away, dealing $d Shadow damage over 15 sec. Builds Instability while it runs.",
  },
  glitch_rollback: {
    id: 'glitch_rollback',
    name: 'Rollback',
    class: 'glitch',
    learnLevel: 6,
    cost: 50,
    castTime: 0,
    cooldown: 60,
    range: 0,
    school: 'arcane',
    requiresTarget: false,
    effects: [{ type: 'heal', min: 0, max: 0, casterMaxHpPct: 0.25 }],
    description: 'Restores 25% of your maximum health. Costs 50 Instability.',
  },
  glitch_cascade: {
    id: 'glitch_cascade',
    name: 'Cascade',
    class: 'glitch',
    learnLevel: 12,
    cost: 20,
    castTime: 0,
    cooldown: 20,
    range: 30,
    school: 'arcane',
    requiresTarget: false,
    targetMode: 'position',
    effects: [{ type: 'glitchCascade', radius: 8, seconds: 4 }],
    description:
      'Extends every Glitch effect you have on enemies in the target area by 4 sec. Extended effects keep their age, so they keep building Instability faster. Costs 20 Instability.',
  },
  // ---- Spec signatures (granted at the spec pick) ----
  glitch_fork_bomb: {
    id: 'glitch_fork_bomb',
    name: 'Fork Bomb',
    class: 'glitch',
    learnLevel: 5,
    specs: ['overclock'],
    cost: 40,
    castTime: 0,
    cooldown: 10,
    range: 30,
    school: 'arcane',
    requiresTarget: false,
    targetMode: 'position',
    // One pulse: the on-cast pulse lands, and the half-second zone expires
    // before its one-second interval comes around again.
    effects: [{ type: 'groundAoE', min: 30, max: 38, radius: 8, duration: 0.5, interval: 1 }],
    description:
      'Detonates the target area, dealing $d Arcane damage to every enemy inside. Costs 40 Instability. (Overclock signature)',
  },
  glitch_bit_rot: {
    id: 'glitch_bit_rot',
    name: 'Bit Rot',
    class: 'glitch',
    learnLevel: 5,
    specs: ['entropy'],
    cost: 0,
    castTime: 0,
    cooldown: 10,
    range: 30,
    school: 'shadow',
    requiresTarget: true,
    effects: [{ type: 'dot', total: 50, duration: 10, interval: 2 }],
    description:
      'Rots the target, dealing $d Shadow damage over 10 sec. Builds Instability while it runs. (Entropy signature)',
  },
  glitch_sandbox: {
    id: 'glitch_sandbox',
    name: 'Sandbox',
    class: 'glitch',
    learnLevel: 5,
    specs: ['sandbox'],
    cost: 20,
    castTime: 0,
    cooldown: 30,
    range: 0,
    school: 'arcane',
    requiresTarget: false,
    effects: [{ type: 'selfAbsorbPctMax', pct: 0.2, duration: 10 }],
    description:
      'Isolates you in a shield that absorbs damage equal to 20% of your maximum health for 10 sec. Costs 20 Instability. (Sandbox signature)',
  },
};

// The base kit in learn order (CLASSES.glitch.abilities).
export const GLITCH_KIT: string[] = [
  'glitch_corrupt_byte',
  'glitch_noise_field',
  'glitch_overflow',
  'glitch_phase_skip',
  'glitch_memory_leak',
  'glitch_rollback',
  'glitch_packet_loss',
  'glitch_null_pointer',
  'glitch_cascade',
];
