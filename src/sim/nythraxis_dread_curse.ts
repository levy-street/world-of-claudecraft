// Dread Curse: the Nythraxis tank-swap debuff, on BOTH difficulties.
//
// Every NYTHRAXIS_DREAD_CURSE_EVERY seconds, if the aggro holder is inside the
// boss's melee reach, Nythraxis lands a max-hp shadow hit and one stack of Dread
// Curse. Each stack raises the damage the victim takes FROM NYTHRAXIS (kind
// 'vuln_source', source-scoped, so the guards' hits are not amplified). The
// stacks live on the aura, not on the encounter state: a taunt swap leaves the
// old tank's stacks to expire on their own while the new tank starts at zero,
// which is what makes the swap a real swap. Heroic only raises the per-stack
// bonus; the cadence, cap, duration, and swap point are shared.
//
// `src/sim`-pure: no rng, no wall clock, no DOM. The driver in
// encounters/nythraxis.ts owns the cadence timer and calls castNythraxisDreadCurse.

import { mobEffectiveMeleeRange } from './mob/combat_profile';
import type { SimContext } from './sim_context';
import { type DungeonDifficulty, dist2d, type Entity } from './types';

export const NYTHRAXIS_DREAD_CURSE_AURA_ID = 'nythraxis_dread_curse';
export const NYTHRAXIS_DREAD_CURSE_CAST_ID = 'Dread Curse';
export const NYTHRAXIS_DREAD_CURSE_EVERY = 10;
export const NYTHRAXIS_DREAD_CURSE_HIT_MAX_HP_NORMAL = 0.25;
export const NYTHRAXIS_DREAD_CURSE_HIT_MAX_HP_HEROIC = 0.3;
export const NYTHRAXIS_DREAD_CURSE_DURATION = 30;
export const NYTHRAXIS_DREAD_CURSE_MAX_STACKS = 3;
export const NYTHRAXIS_DREAD_CURSE_PER_STACK_NORMAL = 0.35;
export const NYTHRAXIS_DREAD_CURSE_PER_STACK_HEROIC = 0.45;
/** The stack count at which the other tank must taunt (published to the guide). */
export const NYTHRAXIS_DREAD_CURSE_TANK_SWAP_STACKS = 2;

export function nythraxisDreadCurseHitMaxHp(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_DREAD_CURSE_HIT_MAX_HP_HEROIC
    : NYTHRAXIS_DREAD_CURSE_HIT_MAX_HP_NORMAL;
}

export function nythraxisDreadCursePerStack(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_DREAD_CURSE_PER_STACK_HEROIC
    : NYTHRAXIS_DREAD_CURSE_PER_STACK_NORMAL;
}

/** Current Dread Curse stacks this boss has on the target (0 when none). */
export function nythraxisDreadCurseStacks(target: Entity, bossId: number): number {
  const aura = target.auras.find(
    (candidate) => candidate.id === NYTHRAXIS_DREAD_CURSE_AURA_ID && candidate.sourceId === bossId,
  );
  return aura ? Math.max(1, aura.stacks ?? 1) : 0;
}

export type DreadCurseOutcome = 'outOfReach' | 'applied' | 'swapCall';

/**
 * Land one Dread Curse on the aggro holder: the max-hp hit, then the stack
 * (refreshing the duration). Returns 'swapCall' on the application that reaches
 * the swap point so the driver can raise the center-screen callout exactly once
 * per climb; 'outOfReach' when the target is outside melee reach (the cadence
 * re-arms and nothing lands, the same hold Ignivar's Forge Strike applies).
 */
export function castNythraxisDreadCurse(
  ctx: SimContext,
  boss: Entity,
  target: Entity,
  difficulty: DungeonDifficulty,
): DreadCurseOutcome {
  if (dist2d(boss.pos, target.pos) > mobEffectiveMeleeRange(boss)) return 'outOfReach';
  const existing = target.auras.find(
    (aura) => aura.id === NYTHRAXIS_DREAD_CURSE_AURA_ID && aura.sourceId === boss.id,
  );
  // alreadyFinal: the redo's max-hp fractions follow the Ignivar / Varkhul
  // convention (Forge Strike, Maker's Brand), where the percentage IS the
  // mechanic and a damage-done debuff on the boss does not shrink it. The two
  // legacy Nythraxis sites (Soul Rend, Deathless Rage) keep their conditional
  // form because their normal-mode hits were never meant to be guaranteed.
  const hit = nythraxisDreadCurseHitMaxHp(difficulty);
  ctx.dealDamage(
    boss,
    target,
    Math.ceil(target.maxHp * hit),
    false,
    'shadow',
    NYTHRAXIS_DREAD_CURSE_CAST_ID,
    'hit',
    true,
    undefined,
    false,
    false,
    true,
  );
  if (target.dead) return 'applied';
  const perStack = nythraxisDreadCursePerStack(difficulty);
  let stacks: number;
  if (existing) {
    stacks = Math.min(NYTHRAXIS_DREAD_CURSE_MAX_STACKS, Math.max(1, existing.stacks ?? 1) + 1);
    existing.stacks = stacks;
    existing.value = stacks * perStack;
    existing.value2 = hit;
    existing.remaining = NYTHRAXIS_DREAD_CURSE_DURATION;
    ctx.emit({ type: 'aura', targetId: target.id, name: existing.name, gained: true });
  } else {
    stacks = 1;
    ctx.applyAura(target, {
      id: NYTHRAXIS_DREAD_CURSE_AURA_ID,
      name: NYTHRAXIS_DREAD_CURSE_CAST_ID,
      kind: 'vuln_source',
      remaining: NYTHRAXIS_DREAD_CURSE_DURATION,
      duration: NYTHRAXIS_DREAD_CURSE_DURATION,
      value: perStack,
      // The hit fraction rides the aura so the tooltip reads the tier's number.
      value2: hit,
      stacks: 1,
      sourceId: boss.id,
      school: 'shadow',
      encounterOwned: true,
    });
  }
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: target.id,
    school: 'shadow',
    fx: 'projectile',
  });
  return stacks === NYTHRAXIS_DREAD_CURSE_TANK_SWAP_STACKS ? 'swapCall' : 'applied';
}
