// Warrior-only melee defense folded into the existing one-roll hit tables.
// The class check is deliberate: the redesigned Warrior gains parry and shield
// block without changing any of the eight other classes or their RNG order.
import type { Entity } from '../types';
import { angleTo, normAngle } from '../types';

const WARRIOR_PARRY_BASE = 0.05;
const WARRIOR_PARRY_PER_STRENGTH = 0.0005;
const WARRIOR_FRONT_ARC = Math.PI / 2;

export interface WarriorMeleeDefense {
  parryChance: number;
  blockChance: number;
}

// The Strength-scaled parry chance on its own, so the character sheet can show
// the same number combat rolls against (front-arc gating stays in
// warriorMeleeDefense; the sheet shows the in-arc chance).
export function warriorParryChance(str: number): number {
  return Math.max(0, WARRIOR_PARRY_BASE + str * WARRIOR_PARRY_PER_STRENGTH);
}

export function warriorMeleeDefense(defender: Entity, attacker: Entity): WarriorMeleeDefense {
  if (defender.kind !== 'player' || defender.templateId !== 'warrior') {
    return { parryChance: 0, blockChance: 0 };
  }
  const inFront =
    Math.abs(normAngle(angleTo(defender.pos, attacker.pos) - defender.facing)) < WARRIOR_FRONT_ARC;
  if (!inFront) return { parryChance: 0, blockChance: 0 };
  return {
    parryChance: warriorParryChance(defender.stats.str),
    blockChance: defender.blockValue > 0 && defender.blockChance > 0 ? defender.blockChance : 0,
  };
}
