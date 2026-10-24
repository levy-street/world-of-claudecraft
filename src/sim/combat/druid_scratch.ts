// Scratch, the Cat Form sweep builder (Wildfang kit).
//
// A weaponStrike authored with `sweepRadius` strikes EVERY hostile in that
// radius around the cat instead of one target: each enemy rolls its own melee
// swing (weapon damage plus the flat bonus) through ctx.meleeSwing, and each
// swing that LANDS awards the ability's combo points. The shared combo pool
// still caps at 5 (Sim.awardCombo). Old Blood rides the landed-swing hook
// inside meleeSwing (druidEngineOnLandedStrike keyed on the ability id), so a
// feral banks 1 per landed hit up to the 3-stage cap with nothing extra here.
//
// The sweep also SPOTS stealthers: every hostile it reaches that is hidden
// (any stealth aura, Vanish included) is pulled out of stealth through the
// single ctx.breakStealth funnel BEFORE the swings roll, so a missed or
// dodged swing still reveals. The sweep goes off with nobody in reach too
// (requiresTarget false), which is what makes it a stealth check. No rng.
//
// Determinism: targets are collected first (hostilesInRadius order, then the
// line-of-sight gate, which draws no rng), then each swing draws its own hit
// table in that order, exactly as a single weaponStrike would per target. A
// sweep that finds nobody draws nothing.
import type { SimContext } from '../sim_context';
import type { AbilityDef, Entity } from '../types';

export interface WeaponSweepOpts {
  primaryDamageMult: number;
  weaponMult?: number;
  threatFlat?: number;
  threatMult?: number;
  critBonus: number;
  /** Combo points per landed hit (the ability's awardsCombo plus any bend). */
  comboPerHit: number;
  /** A sure-crit aura forces every swing of the sweep to crit, exactly as it
   *  forces a single weaponStrike; the caller spends the charge once. */
  forceCrit: boolean;
}

/** The hostiles a sweep of `radius` around the caster would strike, in the
 *  deterministic order it strikes them. */
export function weaponSweepTargets(ctx: SimContext, p: Entity, radius: number): Entity[] {
  const out: Entity[] = [];
  for (const m of ctx.hostilesInRadius(p, p.pos, radius)) {
    if (m.dead) continue;
    if (!ctx.hasLineOfSight(p, m)) continue;
    out.push(m);
  }
  return out;
}

/** Resolve a sweep and return how many swings landed. */
export function resolveWeaponSweep(
  ctx: SimContext,
  p: Entity,
  ability: Pick<AbilityDef, 'id' | 'name' | 'school'>,
  radius: number,
  bonus: number,
  opts: WeaponSweepOpts,
): number {
  const targets = weaponSweepTargets(ctx, p, radius);
  for (const target of targets) {
    if (target.auras.some((aura) => aura.kind === 'stealth')) ctx.breakStealth(target);
  }
  ctx.emit({
    type: 'spellfx',
    sourceId: p.id,
    targetId: p.id,
    school: ability.school,
    fx: 'nova',
    ability: ability.id,
  });
  let landed = 0;
  for (const target of targets) {
    if (target.dead) continue;
    const hit = ctx.meleeSwing(p, target, bonus, ability.name, {
      weaponMult: opts.weaponMult,
      primaryDamageMult: opts.primaryDamageMult,
      threatFlat: opts.threatFlat,
      threatMult: opts.threatMult,
      critBonus: opts.critBonus,
      forceCrit: opts.forceCrit,
      abilityId: ability.id,
    });
    if (!hit) continue;
    landed += 1;
    if (opts.comboPerHit > 0) ctx.awardCombo(p, target, opts.comboPerHit);
  }
  return landed;
}
