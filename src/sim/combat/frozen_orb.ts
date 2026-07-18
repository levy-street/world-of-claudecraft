// Frozen Orb: the frost mage's roaming proc generator (owner design
// 2026-07-11). The cast releases an orb that drifts slowly forward from the
// caster, pulsing frost damage and a 30% snare on everything nearby once per
// second for its 8s life. The FIRST enemy it ever strikes guarantees one
// Fingers of Frost stack; after that, every pulse that struck at least one
// enemy rolls one 20% chance for another (combat/frost_mage.ts owns the
// stack rules and the 2-stack cap).
//
// The orb is SIM STATE, not an Entity: it lives in ctx.frozenOrbs (backing
// array on Sim, the groundAoEs idiom), is never serialized or wired, and
// dies with its caster. Movement, pulses, and expiry advance in
// tickFrozenOrbs, called once per tick from Sim next to tickGroundAoEs.
//
// Determinism: pulses draw rng in a fixed order (per-target damage range in
// hostilesInRadius grid order, then AT MOST one proc chance per pulse, drawn
// only when the pulse struck someone). Only a committed-frost mage can cast
// the ability, so no pre-existing golden ever reaches these draws.
//
// `src/sim`-pure: sibling sim modules + the SimContext seam only
// (enforced by tests/architecture.test.ts).

import type { SimContext } from '../sim_context';
import { DT, type Entity } from '../types';
import { gainFingersOfFrost, gainIcicle } from './frost_mage';
import { spellDamageMultFromAuras } from './spell_combat';

// Slow drift, WoW-style: fast enough to sweep a pack, slow enough that a
// kiting target walks out of it.
export const FROZEN_ORB_SPEED = 4; // yards per second (owner playtest: 2.5 crawled)
export const FROZEN_ORB_SLOW_MULT = 0.7; // -30% move speed
export const FROZEN_ORB_SLOW_DURATION = 2.5; // refreshed every pulse it keeps hitting
export const FROZEN_ORB_FINGERS_CHANCE = 0.2; // per pulse that struck someone
// The orb LATCHES onto prey (owner design 2026-07-11, revised same day): while
// any living hostile its PULSES can strike (inside the pulse radius, with the
// pulse's own line-of-sight gate) remains, the orb holds position and grinds;
// the moment nothing strikeable lives it resumes its drift with whatever
// lifetime remains. "It is hitting someone" and "it is stopped" are the same
// condition, so the orb can never drift away from a target it is damaging.
// The life clock never pauses while latched.

export interface FrozenOrbState {
  sourceId: number;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  radius: number;
  min: number;
  max: number;
  spBonus: number;
  remaining: number;
  interval: number;
  pulseTimer: number;
  abilityName: string;
  // The first strike's guaranteed Fingers of Frost has been granted.
  firstHitDone: boolean;
  // Latched: a living enemy the pulses can strike is in reach, so the orb
  // holds position until nothing strikeable lives. Transitions emit the
  // halt/resume visual events so the client flight animation tracks the path.
  halted: boolean;
}

/** Release an orb from the caster, drifting the way they face. The damage
 *  numbers come from the ability's `frozenOrb` effect record; spBonus is
 *  snapshotted at cast like a groundAoE pulse. */
export function spawnFrozenOrb(
  ctx: SimContext,
  p: Entity,
  eff: { min: number; max: number; radius: number; duration: number; interval: number },
  abilityName: string,
  spBonus: number,
): void {
  const dirX = Math.sin(p.facing);
  const dirZ = Math.cos(p.facing);
  // Release feedback at the caster; each pulse then draws its own nova ring
  // along the drift, so the player can read where the orb is.
  ctx.emit({
    type: 'spellfxAt',
    x: p.pos.x,
    z: p.pos.z,
    school: 'frost',
    fx: 'nova',
    radius: eff.radius,
  });
  // The visible sphere: the flight is a straight line at fixed speed, so this
  // ONE event carries the whole path and the client animates the orb locally
  // (src/render/frozen_orb_fx.ts). Visual only; the pulses above stay the
  // authoritative area telegraph.
  ctx.emit({
    type: 'spellfxAt',
    x: p.pos.x,
    z: p.pos.z,
    school: 'frost',
    fx: 'orb',
    phase: 'release',
    sourceId: p.id,
    radius: eff.radius,
    dirX,
    dirZ,
    speed: FROZEN_ORB_SPEED,
    duration: eff.duration,
  });
  ctx.frozenOrbs.push({
    sourceId: p.id,
    x: p.pos.x,
    z: p.pos.z,
    dirX,
    dirZ,
    radius: eff.radius,
    min: eff.min,
    max: eff.max,
    spBonus,
    remaining: eff.duration,
    interval: eff.interval,
    // The first pulse fires one full interval after release, like a groundAoE
    // scheduled tick (the cast itself is the wind-up, not a free hit).
    pulseTimer: eff.interval,
    abilityName,
    firstHitDone: false,
    halted: false,
  });
}

/** Advance every live orb one tick: drift forward, pulse on the interval,
 *  drop when expired or orphaned. Called once per tick from Sim (next to
 *  tickGroundAoEs); iterates in release order, and reordering IS drift. */
export function tickFrozenOrbs(ctx: SimContext): void {
  if (ctx.frozenOrbs.length === 0) return;
  for (let i = ctx.frozenOrbs.length - 1; i >= 0; i--) {
    const orb = ctx.frozenOrbs[i];
    const source = ctx.entities.get(orb.sourceId);
    if (!source || source.dead) {
      ctx.frozenOrbs.splice(i, 1);
      continue;
    }
    // Latch check: any living hostile the pulses can strike pins the orb in
    // place (grid radius query + the pulse's LoS gate, draws no rng). Only the
    // TRANSITION emits a visual event, so the client flight animation freezes
    // and resumes at the server's real coordinates without per-tick traffic.
    const latched = hasOrbContact(ctx, orb, source);
    if (latched !== orb.halted) {
      orb.halted = latched;
      ctx.emit({
        type: 'spellfxAt',
        x: orb.x,
        z: orb.z,
        school: 'frost',
        fx: 'orb',
        phase: latched ? 'halt' : 'resume',
        sourceId: orb.sourceId,
      });
    }
    if (!orb.halted) {
      orb.x += orb.dirX * FROZEN_ORB_SPEED * DT;
      orb.z += orb.dirZ * FROZEN_ORB_SPEED * DT;
    }
    orb.remaining -= DT;
    orb.pulseTimer -= DT;
    if (orb.pulseTimer <= 0) {
      orb.pulseTimer += orb.interval;
      pulseOrb(ctx, orb, source);
    }
    if (orb.remaining <= 0) ctx.frozenOrbs.splice(i, 1);
  }
}

// True while any living hostile the pulses can strike is in reach: the SAME
// radius and caster-line-of-sight gate as pulseOrb, so the latch condition is
// exactly "the orb is hitting someone" (owner: it must never drift onward
// while its area is still damaging a target).
function hasOrbContact(ctx: SimContext, orb: FrozenOrbState, source: Entity): boolean {
  const center = { x: orb.x, y: source.pos.y, z: orb.z };
  for (const t of ctx.hostilesInRadius(source, center, orb.radius)) {
    if (t.dead) continue;
    if (!ctx.hasLineOfSight(source, t)) continue;
    return true;
  }
  return false;
}

function pulseOrb(ctx: SimContext, orb: FrozenOrbState, source: Entity): void {
  const center = { x: orb.x, y: source.pos.y, z: orb.z };
  ctx.emit({
    type: 'spellfxAt',
    x: orb.x,
    z: orb.z,
    school: 'frost',
    fx: 'nova',
    radius: orb.radius,
  });
  let struck = 0;
  for (const target of ctx.hostilesInRadius(source, center, orb.radius)) {
    // Line of sight from the CASTER, the pulseGroundAoE convention (a zone
    // pulse is the caster's spell, not an independent actor).
    if (!ctx.hasLineOfSight(source, target)) continue;
    const raw = ctx.rng.range(orb.min, orb.max) + orb.spBonus;
    const dmg = Math.round(raw * spellDamageMultFromAuras(source));
    ctx.dealDamage(source, target, dmg, false, 'frost', orb.abilityName, 'hit');
    ctx.applyAura(target, {
      id: 'frozen_orb_slow',
      name: orb.abilityName,
      kind: 'slow',
      value: FROZEN_ORB_SLOW_MULT,
      remaining: FROZEN_ORB_SLOW_DURATION,
      duration: FROZEN_ORB_SLOW_DURATION,
      sourceId: source.id,
      school: 'frost',
    });
    struck++;
  }
  if (struck === 0) return;
  // Each striking pulse also banks one Icicle toward Glacial Spike (deterministic,
  // no rng, so it never shifts the shared stream); this is what makes the orb the
  // spender's accelerator. One per pulse, not per target, matching the proc rule.
  gainIcicle(ctx, source);
  // Proc generation: the orb's whole point. One guaranteed stack on the first
  // strike of the orb's life, then AT MOST one 20% roll per striking pulse
  // (never one per target, so pack size cannot flood the rng stream).
  if (!orb.firstHitDone) {
    orb.firstHitDone = true;
    gainFingersOfFrost(ctx, source);
    return;
  }
  if (ctx.rng.chance(FROZEN_ORB_FINGERS_CHANCE)) gainFingersOfFrost(ctx, source);
}
