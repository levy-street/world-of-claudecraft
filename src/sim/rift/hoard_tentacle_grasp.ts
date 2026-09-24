// A tentacle's GRASP (the Abyssal Maw's Tentacles of the Abyss): it reaches for
// a player, and if they are still in reach when it closes it holds them where it
// stands and squeezes, until the party breaks its grip by hurting it, kills it,
// or it tires and throws them. The tentacle module (hoard_tentacles.ts) decides
// WHEN a tentacle grasps; this file owns everything from the reach to the let go,
// and that nobody stays held after the fight. Numbers and the reach test are in
// the shared core (hoard_tentacles_core.ts). Draws no rng.
//
// A held player is LIFTED: his waves pass beneath them and no other tentacle's
// lash or sweep touches them (isHeldByTentacle), so being held is never a second,
// unavoidable hit. They can still strike the tentacle that holds them, so a lone
// player is never stuck. Its squeeze alone never kills: it stops at a sliver.

import type { SimContext } from '../sim_context';
import { DT, type Entity } from '../types';
import { hoardMechanicDamage } from './hoard_scaling';
import { GRAB_TELEGRAPH_TOTAL_SEC, grabReaches, TENTACLES } from './hoard_tentacles_core';
import type { HoardBossCue, HoardBossState, RiftInstance } from './types';

export const HOARD_TENTACLE_GRASP_ABILITY = 'Crushing Coil';
export const HOARD_TENTACLE_GRASP_AURA_ID = 'hoard_tentacle_grasp';

export interface TentacleGrasp {
  cueId: number;
  victimId: number;
  holding: boolean;
  /** Where the held player is kept, and the tentacle's health when it took them. */
  holdX: number;
  holdZ: number;
  healthAtGrab: number;
  squeezeIn: number;
}

/** What this file needs to know of the tentacle that is grasping. */
export interface GraspingTentacle {
  index: number;
  x: number;
  z: number;
  entityId: number | null;
  grasp: TentacleGrasp | null;
}

type Emit = (ctx: SimContext, inst: RiftInstance, cue: HoardBossCue) => void;
type MarkCue = Extract<HoardBossCue, { kind: 'mark' }>;

export function isHeldByTentacle(player: Entity): boolean {
  for (const aura of player.auras) if (aura.id === HOARD_TENTACLE_GRASP_AURA_ID) return true;
  return false;
}

function findCue(state: HoardBossState, id: number): HoardBossCue | undefined {
  for (const cue of state.cues) if (cue.id === id) return cue;
  return undefined;
}

function withdraw(ctx: SimContext, inst: RiftInstance, cue: HoardBossCue, emit: Emit): void {
  // A zero-length cue clears its mirror on every client, now.
  cue.remaining = 0;
  cue.total = 0;
  emit(ctx, inst, cue);
}

/** It begins to reach: a mark that rides the player, so they know it is THEM. */
export function beginGrasp(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  tentacle: GraspingTentacle,
  target: Entity,
  emit: Emit,
): void {
  const cue: MarkCue = {
    id: state.nextCueId++,
    kind: 'mark',
    variant: 'tide-grab',
    phase: 'warning',
    x: target.pos.x,
    z: target.pos.z,
    radius: TENTACLES.grabRange,
    // Which tentacle is reaching: the renderer bends that one toward them.
    innerRadius: tentacle.index,
    targetId: target.id,
    remaining: GRAB_TELEGRAPH_TOTAL_SEC,
    total: GRAB_TELEGRAPH_TOTAL_SEC,
  };
  state.cues.push(cue);
  emit(ctx, inst, cue);
  tentacle.grasp = {
    cueId: cue.id,
    victimId: target.id,
    holding: false,
    holdX: tentacle.x,
    holdZ: tentacle.z,
    healthAtGrab: 0,
    squeezeIn: TENTACLES.grabEverySec,
  };
  ctx.emit({
    type: 'spellfxAt',
    x: tentacle.x,
    z: tentacle.z,
    school: 'shadow',
    fx: 'burst',
    ability: HOARD_TENTACLE_GRASP_ABILITY,
    duration: TENTACLES.grabTelegraphSec,
    sourceId: boss.id,
  });
}

/** Let go, however it ends: the hold comes off and its cue leaves every client. */
export function releaseGrasp(
  ctx: SimContext,
  inst: RiftInstance,
  state: HoardBossState,
  tentacle: GraspingTentacle,
  emit: Emit,
): void {
  const grasp = tentacle.grasp;
  if (!grasp) return;
  tentacle.grasp = null;
  const victim = ctx.entities.get(grasp.victimId);
  if (victim) victim.auras = victim.auras.filter((a) => a.id !== HOARD_TENTACLE_GRASP_AURA_ID);
  const cue = findCue(state, grasp.cueId);
  if (cue && cue.remaining > 0) withdraw(ctx, inst, cue, emit);
}

function squeeze(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  victim: Entity,
  fraction: number,
): void {
  // Held, they can do nothing about it, so its squeeze alone never kills.
  const amount = Math.min(hoardMechanicDamage(inst, fraction), Math.floor(victim.hp) - 1);
  if (amount <= 0) return;
  ctx.dealDamage(boss, victim, amount, false, 'shadow', HOARD_TENTACLE_GRASP_ABILITY, 'hit', true);
}

/** One tick of a grasp. `heldNow` is how many players are held across the set,
 *  `mayHold` how many may be. Returns false once the grasp is over. */
export function tickGrasp(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  tentacle: GraspingTentacle,
  heldNow: number,
  mayHold: number,
  emit: Emit,
): boolean {
  const grasp = tentacle.grasp;
  if (!grasp) return false;
  const cue = findCue(state, grasp.cueId);
  const victim = ctx.entities.get(grasp.victimId);
  const mob = tentacle.entityId === null ? undefined : ctx.entities.get(tentacle.entityId);
  if (!cue || !victim || victim.dead || !mob || mob.dead) {
    releaseGrasp(ctx, inst, state, tentacle, emit);
    return false;
  }
  if (!grasp.holding) {
    // The engine drops a spent cue before this runs: its last live tick IS the close.
    if (cue.remaining > DT + 1e-8) return true;
    if (
      heldNow >= mayHold ||
      isHeldByTentacle(victim) ||
      !grabReaches(tentacle.x, tentacle.z, victim.pos.x, victim.pos.z)
    ) {
      // Out of reach (or the party cannot spare another): it closes on nothing.
      releaseGrasp(ctx, inst, state, tentacle, emit);
      return false;
    }
    const dx = victim.pos.x - tentacle.x;
    const dz = victim.pos.z - tentacle.z;
    const range = Math.max(1e-6, Math.hypot(dx, dz));
    const at = ctx.groundPos(
      tentacle.x + (dx / range) * TENTACLES.grabHoldDistance,
      tentacle.z + (dz / range) * TENTACLES.grabHoldDistance,
    );
    grasp.holding = true;
    grasp.holdX = at.x;
    grasp.holdZ = at.z;
    grasp.healthAtGrab = mob.hp;
    victim.pos = { ...victim.pos, x: at.x, z: at.z };
    ctx.applyAura(victim, {
      id: HOARD_TENTACLE_GRASP_AURA_ID,
      name: 'Constricted',
      kind: 'root',
      remaining: TENTACLES.grabHoldSec + 0.5,
      duration: TENTACLES.grabHoldSec + 0.5,
      value: 0,
      sourceId: boss.id,
      school: 'shadow',
      unbreakableControl: true,
    });
    if (cue.kind === 'mark') {
      cue.variant = 'tide-grab-hold';
      cue.x = at.x;
      cue.z = at.z;
      cue.remaining = TENTACLES.grabHoldSec;
      cue.total = TENTACLES.grabHoldSec;
      emit(ctx, inst, cue);
    }
    ctx.emit({
      type: 'log',
      text: 'A tentacle seizes a player. Strike it to break its grip!',
      color: '#7fd6c8',
      entityId: boss.id,
    });
    return true;
  }
  // Held fast: nothing moves them until it lets go.
  victim.pos.x = grasp.holdX;
  victim.pos.z = grasp.holdZ;
  if (mob.hp <= grasp.healthAtGrab - mob.maxHp * TENTACLES.grabBreakFraction) {
    releaseGrasp(ctx, inst, state, tentacle, emit);
    return false;
  }
  if (cue.remaining <= DT + 1e-8) {
    // It tires of them: one last squeeze, and it throws them clear.
    squeeze(ctx, inst, boss, victim, TENTACLES.grabThrowDamageFraction);
    releaseGrasp(ctx, inst, state, tentacle, emit);
    if (!victim.dead) {
      ctx.applyKnockback(
        { ...boss, pos: { ...boss.pos, x: tentacle.x, z: tentacle.z } },
        victim,
        TENTACLES.grabThrowKnockback,
      );
    }
    return false;
  }
  grasp.squeezeIn -= DT;
  if (grasp.squeezeIn > 1e-8) return true;
  grasp.squeezeIn += TENTACLES.grabEverySec;
  squeeze(ctx, inst, boss, victim, TENTACLES.grabDamageFraction);
  return true;
}
