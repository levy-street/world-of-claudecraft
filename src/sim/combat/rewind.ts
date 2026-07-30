// Chronomancy Rewind (Rebobinar): the "Correct" pillar's raid cooldown. Instant, no
// target, centered on the Chronomancer. It restores a fraction of the REAL damage
// each living group/raid member within range took over the last few seconds, capped
// per target, so a raid that just ate a burst can claw back part of it on demand.
//
// Design (owner-approved, docs/prd/mage-chronomancy.md):
//   - 40 yd radius, all living group/raid PLAYERS in range (self when solo).
//   - Per target: min( fraction * real damage in the window, maxHpFraction * maxHp,
//     missing HP ). 0 if they took no recent damage or are at full health.
//   - Never crits, draws no rng, never resurrects, applies no Echo, and does not
//     touch the Arcane damage->heal conversion. Normal heal threat.
//
// It reuses the canonical heal route (ctx.applyHeal with canCrit=false) so healing,
// threat, and events behave exactly like every other heal, and the deterministic
// 5s damage ring (combat/damage_history.ts) as its only input. Draws no rng.
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no Math.random/Date.now.

import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { damageTakenWithin } from './damage_history';
import { livingGroupRaidInRadius } from './group_targeting';

export interface RewindParams {
  fraction: number; // of recent real damage restored (0.30)
  maxHpFraction: number; // per-target cap as a fraction of max HP (0.35)
  windowSec: number; // look-back window in seconds (must be <= REWIND_WINDOW_SEC)
  radius: number; // yards from the caster (40)
}

// Rewind's targets are the living group/raid in range of the caster (the shared
// resolver). Kept as a named export for readability at the call site and focused tests.
export function selectRewindTargets(ctx: SimContext, caster: Entity, radius: number): Entity[] {
  return livingGroupRaidInRadius(ctx, caster, radius);
}

// The per-target Rewind heal, before healingTakenMult / absorb (which applyHeal
// folds in): min( fraction of recent real damage, maxHpFraction of max HP, missing
// HP ). 0 when the ally took no recent damage or is already at full health. No rng.
export function rewindHealFor(ctx: SimContext, ally: Entity, p: RewindParams): number {
  const recent = damageTakenWithin(ally, ctx.tickCount, Math.round(p.windowSec * 20));
  return rewindHealAmount(recent, ally.hp, ally.maxHp, p.fraction, p.maxHpFraction);
}

/** Pure preview shared by Rewind and party-frame wire projection. */
export function rewindHealAmount(
  recentDamage: number,
  hp: number,
  maxHp: number,
  fraction = 0.3,
  maxHpFraction = 0.35,
): number {
  const fromDamage = Math.round(recentDamage * fraction);
  const maxHpCap = Math.round(maxHp * maxHpFraction);
  const missing = maxHp - hp;
  return Math.max(0, Math.min(fromDamage, maxHpCap, missing));
}

// Cast Rewind from `caster`: an arcane wave off the Chronomancer, then a rewind heal
// on every valid ally with a brief temporal glyph on each ally that actually gained
// health (zero-heal allies get no glyph, keeping raid frames legible). Reuses
// applyHeal (canCrit=false => no crit, no rng), which also fans out normal heal
// threat. Returns the total EFFECTIVE healing done (for dev readouts/tests).
export function applyRewind(
  ctx: SimContext,
  caster: Entity,
  p: RewindParams,
  abilityName: string,
): number {
  // The arcane wave rolling off the Chronomancer. Its specific cue preserves the
  // nova visual without triggering the generic spell_nova audio clip.
  ctx.emit({
    type: 'spellfx',
    sourceId: caster.id,
    targetId: caster.id,
    school: 'arcane',
    fx: 'temporalRewindNova',
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: caster.id,
    targetId: caster.id,
    school: 'arcane',
    fx: 'temporalClock',
  });
  let totalHealed = 0;
  for (const ally of selectRewindTargets(ctx, caster, p.radius)) {
    const heal = rewindHealFor(ctx, ally, p);
    if (heal <= 0) continue;
    const before = ally.hp;
    ctx.applyHeal(caster, ally, heal, abilityName, null, false);
    const applied = ally.hp - before;
    if (applied <= 0) continue;
    totalHealed += applied;
    ctx.emit({
      type: 'spellfx',
      sourceId: caster.id,
      targetId: ally.id,
      school: 'arcane',
      fx: 'temporalGlyph',
    });
  }
  return totalHealed;
}
