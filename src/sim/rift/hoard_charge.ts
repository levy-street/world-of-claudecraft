// Warlord Grask's CHARGE (his second mechanic beside the boulders): he fixes on
// whoever holds him, keeps turning after them through a cast, then throws himself
// down that line. Anyone caught in the line is bowled over; if the line ends in a
// wall he crashes into it and reels, stunned, for a few seconds. The tank's play
// is to stand so that the line ends in a wall; the room's is to be out of it.
//
// The beats, every one of them a cue the renderer draws and an event the room hears:
//   aim   -> a cast bar on him (HOARD_CAST_CHARGE, never kickable: the wall is the
//            answer) and a narrow sector from him to the wall, re-aimed at the
//            tank every tick, so the lane is always where he will really go;
//   dash  -> he travels the lane; a player he passes is knocked along it and hurt;
//   crash -> the lane met a wall: he stops there and is staggered (the boulders'
//            own stagger aura, so the client already knows how to show it);
//   miss  -> the lane ran out before any wall: he stops, and that is all.
// He holds his ground while he aims and the module moves him while he dashes
// (holdHoardCharge, from the locomotion seam); nothing else moves him meanwhile.

import { RIFT_REGION_HALF_X, RIFT_REGION_HALF_Z, riftInstanceOrigin } from '../data';
import { layoutColliders } from '../dungeon_layout';
import type { SimContext } from '../sim_context';
import { threatEntries } from '../threat';
import { DT, type Entity } from '../types';
import { HOARD_BOULDER_STAGGER_AURA_ID } from './hoard_boulder_core';
import { HOARD_CAST_CHARGE } from './hoard_control_cast_ids';
import { hoardMechanicDamage } from './hoard_scaling';
import { tideFloorBlocked } from './hoard_tide_fit';
import { generateRiftFloor } from './rift_gen';
import type { HoardBossCue, HoardBossState, RiftInstance } from './types';

export const CHARGE = Object.freeze({
  /** Seconds between charges, and before his first. */
  everySec: 24,
  firstSec: 14,
  /** The aim: a cast bar he keeps turning through. */
  aimSec: 3,
  /** How far he can go before the charge dies out on open floor. */
  maxYards: 75,
  /** Yards a second, and how far ahead the lane is probed for the wall. */
  speed: 22,
  probeStep: 0.5,
  /** Half the lane's width: who is bowled over. */
  halfWidth: 2.2,
  /** Sector half angle the lane is drawn with (a narrow fan from him). */
  laneHalfAngle: 0.055,
  /** A bowled player: this far along the lane, and this share of the reference health. */
  knockYards: 9,
  damageFraction: 0.18,
  /** He reels for this long after a wall. */
  stunSec: 4,
});

export interface HoardChargeState {
  timer: number;
  phase: 'idle' | 'aim' | 'dash';
  cueId: number;
  targetId: number;
  facing: number;
  /** Yards from where he started the dash to the wall (or the lane's end). */
  reach: number;
  travelled: number;
  hitIds: Set<number>;
  origin: { x: number; z: number };
}

type Emit = (ctx: SimContext, inst: RiftInstance, cue: HoardBossCue) => void;

function chargeState(state: HoardBossState): HoardChargeState {
  if (!state.charge) {
    state.charge = {
      timer: CHARGE.firstSec,
      phase: 'idle',
      cueId: -1,
      targetId: -1,
      facing: 0,
      reach: 0,
      travelled: 0,
      hitIds: new Set(),
      origin: { x: 0, z: 0 },
    };
  }
  return state.charge;
}

function findCue(state: HoardBossState, id: number): HoardBossCue | undefined {
  return state.cues.find((cue) => cue.id === id);
}

function withdraw(ctx: SimContext, inst: RiftInstance, cue: HoardBossCue, emit: Emit): void {
  // A zero-length cue clears its mirror on every client, now.
  cue.remaining = 0;
  cue.total = 0;
  state_cues_drop(inst, cue);
  emit(ctx, inst, cue);
}

function state_cues_drop(inst: RiftInstance, cue: HoardBossCue): void {
  const state = inst.hoardBoss;
  if (!state) return;
  state.cues = state.cues.filter((other) => other.id !== cue.id);
}

function clearCast(boss: Entity): void {
  if (boss.castingAbility !== HOARD_CAST_CHARGE) return;
  boss.castingAbility = null;
  boss.castRemaining = 0;
  boss.castTotal = 0;
  boss.castTargetId = null;
}

/** Whoever holds him: his aggro target, else the top of his threat table. */
function tank(ctx: SimContext, boss: Entity, living: readonly Entity[]): Entity | null {
  const byAggro = living.find((player) => player.id === boss.aggroTargetId);
  if (byAggro) return byAggro;
  const [topId] = threatEntries(boss, 1)[0] ?? [];
  return living.find((player) => player.id === topId) ?? living[0] ?? null;
}

/** How far the lane runs from `from` along `facing` before scenery or the room's
 *  edge stops it: the wall he would crash into. Pure geometry of the floor. */
export function chargeReach(
  inst: RiftInstance,
  from: { x: number; z: number },
  facing: number,
): number {
  const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
  const colliders = layoutColliders(
    generateRiftFloor(inst.seed, inst.baseLevel, inst.floorIndex, inst.upgrade).layout,
  );
  const sin = Math.sin(facing);
  const cos = Math.cos(facing);
  for (let d = CHARGE.probeStep; d <= CHARGE.maxYards; d += CHARGE.probeStep) {
    const x = from.x + sin * d;
    const z = from.z + cos * d;
    if (
      Math.abs(x - origin.x) > RIFT_REGION_HALF_X ||
      Math.abs(z - origin.z) > RIFT_REGION_HALF_Z ||
      tideFloorBlocked(colliders, x - origin.x, z - origin.z)
    )
      return d - CHARGE.probeStep;
  }
  return CHARGE.maxYards;
}

/** Whether the lane ends in a wall (rather than dying out on open floor). */
export function chargeEndsInWall(reach: number): boolean {
  return reach < CHARGE.maxYards - 1e-6;
}

/** Is a point in the lane he will run: within halfWidth of the line, ahead of him, inside reach. */
export function pointInChargeLane(
  from: { x: number; z: number },
  facing: number,
  reach: number,
  point: { x: number; z: number },
): boolean {
  const dx = point.x - from.x;
  const dz = point.z - from.z;
  const along = dx * Math.sin(facing) + dz * Math.cos(facing);
  const across = dx * Math.cos(facing) - dz * Math.sin(facing);
  return along >= -0.5 && along <= reach + 0.5 && Math.abs(across) <= CHARGE.halfWidth;
}

function begin(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  target: Entity,
  emit: Emit,
): void {
  const held = chargeState(state);
  held.phase = 'aim';
  held.targetId = target.id;
  held.facing = Math.atan2(target.pos.x - boss.pos.x, target.pos.z - boss.pos.z);
  held.reach = chargeReach(inst, boss.pos, held.facing);
  held.origin = { x: boss.pos.x, z: boss.pos.z };
  held.hitIds = new Set();
  held.travelled = 0;
  const total = CHARGE.aimSec + CHARGE.maxYards / CHARGE.speed + CHARGE.stunSec;
  const cue: HoardBossCue = {
    id: state.nextCueId++,
    kind: 'sweep',
    variant: 'brute-charge',
    x: boss.pos.x,
    z: boss.pos.z,
    facing: held.facing,
    halfAngle: CHARGE.laneHalfAngle,
    radius: held.reach,
    remaining: total,
    total,
  };
  held.cueId = cue.id;
  state.cues.push(cue);
  emit(ctx, inst, cue);
  boss.castingAbility = HOARD_CAST_CHARGE;
  boss.castTotal = CHARGE.aimSec;
  boss.castRemaining = CHARGE.aimSec;
  boss.castTargetId = target.id;
  boss.channeling = false;
  boss.facing = held.facing;
}

function finish(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  emit: Emit,
): void {
  const held = chargeState(state);
  const cue = findCue(state, held.cueId);
  if (cue) withdraw(ctx, inst, cue, emit);
  held.phase = 'idle';
  held.cueId = -1;
  held.timer = CHARGE.everySec;
  clearCast(boss);
}

function bowl(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  player: Entity,
  facing: number,
): void {
  ctx.dealDamage(
    boss,
    player,
    hoardMechanicDamage(inst, CHARGE.damageFraction),
    false,
    'physical',
    'Charge',
    'hit',
    true,
  );
  // Thrown on down the lane, not away from him: the knockback's own direction is
  // away from its source, which for a player at his shoulder is sideways, so the
  // source it sees is a point just behind the player on the lane.
  const behind = {
    ...boss,
    pos: {
      x: player.pos.x - Math.sin(facing),
      y: player.pos.y,
      z: player.pos.z - Math.cos(facing),
    },
  };
  ctx.applyKnockback(behind, player, CHARGE.knockYards);
}

export function tickHoardCharge(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  players: readonly Entity[],
  emit: Emit,
): void {
  const held = chargeState(state);
  const living = players.filter((player) => !player.dead);
  if (held.phase === 'idle') {
    held.timer -= DT;
    if (held.timer > 0 || living.length === 0) return;
    // Only into a clean room, and never into the middle of his combo.
    if (state.cues.length > 0 || state.sequenceStep !== 0) return;
    const target = tank(ctx, boss, living);
    if (!target) return;
    begin(ctx, inst, boss, state, target, emit);
    return;
  }
  const cue = findCue(state, held.cueId);
  if (!cue || cue.kind !== 'sweep' || living.length === 0 || boss.dead) {
    finish(ctx, inst, boss, state, emit);
    return;
  }
  if (held.phase === 'aim') {
    // He keeps turning after the tank for the whole aim; the lane turns with him.
    const target = ctx.entities.get(held.targetId);
    if (target && !target.dead) {
      held.facing = Math.atan2(target.pos.x - boss.pos.x, target.pos.z - boss.pos.z);
      held.reach = chargeReach(inst, boss.pos, held.facing);
    }
    boss.facing = held.facing;
    cue.facing = held.facing;
    cue.radius = held.reach;
    cue.x = boss.pos.x;
    cue.z = boss.pos.z;
    boss.castRemaining = Math.max(0, boss.castRemaining - DT);
    if (boss.castRemaining > 0) return;
    clearCast(boss);
    held.phase = 'dash';
    held.origin = { x: boss.pos.x, z: boss.pos.z };
    held.travelled = 0;
    return;
  }
  // The dash: he travels the lane, bowling over whoever is in it.
  const step = Math.min(CHARGE.speed * DT, held.reach - held.travelled);
  held.travelled += step;
  boss.pos.x = held.origin.x + Math.sin(held.facing) * held.travelled;
  boss.pos.z = held.origin.z + Math.cos(held.facing) * held.travelled;
  boss.facing = held.facing;
  ctx.grid.update(boss);
  for (const player of living) {
    if (held.hitIds.has(player.id)) continue;
    const dx = player.pos.x - boss.pos.x;
    const dz = player.pos.z - boss.pos.z;
    if (Math.hypot(dx, dz) > CHARGE.halfWidth + 0.6) continue;
    held.hitIds.add(player.id);
    bowl(ctx, inst, boss, player, held.facing);
  }
  if (held.travelled < held.reach - 1e-6) return;
  if (chargeEndsInWall(held.reach)) {
    ctx.applyAura(boss, {
      id: HOARD_BOULDER_STAGGER_AURA_ID,
      name: 'Staggered',
      kind: 'stun',
      remaining: CHARGE.stunSec,
      duration: CHARGE.stunSec,
      value: 0,
      sourceId: boss.id,
      school: 'physical',
    });
    ctx.emit({
      type: 'spellfxAt',
      x: boss.pos.x,
      z: boss.pos.z,
      school: 'physical',
      fx: 'nova',
      ability: 'charge',
      radius: 4,
      sourceId: boss.id,
    });
  }
  finish(ctx, inst, boss, state, emit);
}

/** The locomotion seam: he holds his ground while he aims and is moved by the
 *  charge while he dashes; ordinary chasing never moves him meanwhile. */
export function holdHoardCharge(ctx: SimContext, mob: Entity): boolean {
  for (const inst of ctx.riftInstances) {
    if (inst.bossId !== mob.id || !inst.hoardBoss?.charge) continue;
    return inst.hoardBoss.charge.phase !== 'idle';
  }
  return false;
}

export function isChargeCue(cue: HoardBossCue): boolean {
  return cue.variant === 'brute-charge';
}
