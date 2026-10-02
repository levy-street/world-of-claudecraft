import type { AbilityDef } from '../types';

// The Ninja's signature kit. The class runs on the rogue engine (energy, combo
// points, stealth) and keeps the rogue kit; these three are its own buttons.
// Every number is copied from the rogue ability it mirrors (named per entry)
// rather than invented, so the classic-era tables stay the balance source.
export const NINJA_ABILITIES: Record<string, AbilityDef> = {
  // mirrors venom_dart (cost, cooldown, range, damage), thrown as steel
  shuriken_toss: {
    id: 'shuriken_toss',
    name: 'Shuriken Toss',
    class: 'ninja',
    learnLevel: 1,
    cost: 25,
    castTime: 0,
    cooldown: 8,
    range: 20,
    school: 'physical',
    requiresTarget: true,
    awardsCombo: 1,
    effects: [{ type: 'directDamage', min: 30, max: 40 }],
    description: 'Throw a spinning shuriken for $d Physical damage. Awards 1 combo point.',
  },
  // mirrors sinister_strike's rank ladder (cost and weapon bonus per rank)
  shadow_slash: {
    id: 'shadow_slash',
    name: 'Shadow Slash',
    class: 'ninja',
    learnLevel: 1,
    cost: 45,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    awardsCombo: 1,
    effects: [{ type: 'weaponStrike', bonus: 3, normalized: true }],
    ranks: [
      {
        rank: 2,
        level: 8,
        cost: 45,
        effects: [{ type: 'weaponStrike', bonus: 6, normalized: true }],
      },
      {
        rank: 3,
        level: 14,
        cost: 45,
        effects: [{ type: 'weaponStrike', bonus: 12, normalized: true }],
      },
    ],
    description: 'A quick katana cut for weapon damage plus $d. Awards 1 combo point.',
  },
  // mirrors gouge (cost, cooldown, damage, incapacitate) as a smoke burst
  smoke_bomb: {
    id: 'smoke_bomb',
    name: 'Smoke Bomb',
    class: 'ninja',
    learnLevel: 5,
    cost: 45,
    castTime: 0,
    cooldown: 10,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    awardsCombo: 1,
    effects: [
      { type: 'directDamage', min: 8, max: 9 },
      { type: 'incapacitate', duration: 4 },
    ],
    ranks: [
      {
        rank: 2,
        level: 14,
        cost: 45,
        effects: [
          { type: 'directDamage', min: 15, max: 17 },
          { type: 'incapacitate', duration: 4 },
        ],
      },
    ],
    description:
      "Burst a smoke bomb in the target's face for $d Physical damage, incapacitating it for 4 sec. Any damage breaks the effect. Awards 1 combo point.",
  },
};

export const NINJA_SIGNATURE_IDS = Object.keys(NINJA_ABILITIES);
