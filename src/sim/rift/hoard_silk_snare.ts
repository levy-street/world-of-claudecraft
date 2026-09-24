// Broodmother Vysska's SILK SNARE (her third mechanic beside the cocoons and the
// eggs): she casts, and a thread of silk flies to every player in the room. A
// thread draws its player toward her a little every tick and hurts them as it
// goes; it snaps the moment they get far enough from her. The room's play is to
// walk AWAY from her, each in their own direction; standing on her means being
// reeled in and bitten. She anchors herself to spin: while her threads hold she
// does not move (a lone player could never outrun her otherwise, playtest).
//
// The beats, every one a cue the renderer draws and an event the room hears:
//   cast    -> a bar on her (HOARD_CAST_SILK_SNARE, a kick cancels it for good);
//   threads -> one 'venom-silk' tether per player, from her to them, re-aimed
//              every tick so the thread is always where the player is;
//   snap    -> a thread past its length is withdrawn; a player past their whole
//              set is free. Threads also die with her, with the player, or on reset.

import type { SimContext } from '../sim_context';
import { DT, type Entity } from '../types';
import { HOARD_CAST_SILK_SNARE } from './hoard_control_cast_ids';
import { hoardMechanicDamage } from './hoard_scaling';
import type { HoardBossCue, HoardBossState, RiftInstance } from './types';

export const SILK_SNARE = Object.freeze({
  /** Seconds between snares, and before her first. */
  everySec: 22,
  firstSec: 12,
  /** The cast: a bar a kick cancels. */
  castSec: 3,
  /** Players further than this when she finishes are not threaded. */
  rangeYards: 40,
  /** A thread snaps past this length; it lives at most this long. */
  breakYards: 16,
  maxSec: 10,
  /** Yards a second the thread reels its player in, and how much of their
   *  health it costs them each second on it. */
  reelSpeed: 2.6,
  damagePerSec: 0.035,
  /** Reeled no nearer than this. */
  stopYards: 2.5,
  /** A thread bites this often (every tick was a drumroll of hit sounds). */
  biteSec: 0.5,
});

export interface HoardSilkSnareState {
  timer: number;
  phase: 'idle' | 'cast' | 'threads';
  threads: Array<{ playerId: number; cueId: number; remaining: number; bite: number }>;
}

type Emit = (ctx: SimContext, inst: RiftInstance, cue: HoardBossCue) => void;

function snareState(state: HoardBossState): HoardSilkSnareState {
  if (!state.silkSnare)
    state.silkSnare = { timer: SILK_SNARE.firstSec, phase: 'idle', threads: [] };
  return state.silkSnare;
}

function findCue(state: HoardBossState, id: number): HoardBossCue | undefined {
  return state.cues.find((cue) => cue.id === id);
}

function withdraw(
  ctx: SimContext,
  inst: RiftInstance,
  state: HoardBossState,
  id: number,
  emit: Emit,
): void {
  const cue = findCue(state, id);
  if (!cue) return;
  cue.remaining = 0;
  state.cues = state.cues.filter((other) => other.id !== id);
  emit(ctx, inst, cue);
}

function clearCast(boss: Entity): void {
  if (boss.castingAbility !== HOARD_CAST_SILK_SNARE) return;
  boss.castingAbility = null;
  boss.castRemaining = 0;
  boss.castTotal = 0;
  boss.castTargetId = null;
}

/** A thread's cue: from her to the player, re-aimed each tick. */
function aim(cue: HoardBossCue, boss: Entity, player: Entity): void {
  if (cue.kind !== 'sweep') return;
  const dx = player.pos.x - boss.pos.x;
  const dz = player.pos.z - boss.pos.z;
  cue.x = boss.pos.x;
  cue.z = boss.pos.z;
  cue.facing = Math.atan2(dx, dz);
  cue.radius = Math.max(0.5, Math.hypot(dx, dz));
}

/** How far a thread will have reeled its player in after `seconds` on it (pure). */
export function silkReel(distance: number, seconds: number): number {
  return Math.max(SILK_SNARE.stopYards, distance - SILK_SNARE.reelSpeed * seconds);
}

function thread(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  living: readonly Entity[],
  emit: Emit,
): void {
  const held = snareState(state);
  held.threads = [];
  for (const player of living) {
    if (Math.hypot(player.pos.x - boss.pos.x, player.pos.z - boss.pos.z) > SILK_SNARE.rangeYards)
      continue;
    const cue: HoardBossCue = {
      id: state.nextCueId++,
      kind: 'sweep',
      variant: 'venom-silk',
      x: boss.pos.x,
      z: boss.pos.z,
      facing: 0,
      radius: 1,
      halfAngle: 0.02,
      remaining: SILK_SNARE.maxSec,
      total: SILK_SNARE.maxSec,
    };
    aim(cue, boss, player);
    state.cues.push(cue);
    emit(ctx, inst, cue);
    held.threads.push({
      playerId: player.id,
      cueId: cue.id,
      remaining: SILK_SNARE.maxSec,
      bite: 0,
    });
  }
  held.phase = held.threads.length > 0 ? 'threads' : 'idle';
  if (held.phase === 'idle') held.timer = SILK_SNARE.everySec;
}

export function tickHoardSilkSnare(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  players: readonly Entity[],
  emit: Emit,
): void {
  const held = snareState(state);
  const living = players.filter((player) => !player.dead);
  if (held.phase === 'idle') {
    held.timer -= DT;
    if (held.timer > 0 || living.length === 0) return;
    // Never over her own cocoon or egg beats.
    if (state.cues.length > 0 || boss.castingAbility !== null) return;
    held.phase = 'cast';
    boss.castingAbility = HOARD_CAST_SILK_SNARE;
    boss.castTotal = SILK_SNARE.castSec;
    boss.castRemaining = SILK_SNARE.castSec;
    boss.castTargetId = null;
    boss.channeling = false;
    return;
  }
  if (held.phase === 'cast') {
    if (boss.castingAbility !== HOARD_CAST_SILK_SNARE || boss.dead || living.length === 0) {
      // Kicked, killed, or nobody left: the snare is lost for good.
      clearCast(boss);
      held.phase = 'idle';
      held.timer = SILK_SNARE.everySec;
      return;
    }
    boss.castRemaining = Math.max(0, boss.castRemaining - DT);
    if (boss.castRemaining > 0) return;
    clearCast(boss);
    thread(ctx, inst, boss, state, living, emit);
    return;
  }
  // The threads: each reels its player in, hurts them, and snaps past its length.
  const live: HoardSilkSnareState['threads'] = [];
  for (const item of held.threads) {
    const player = ctx.entities.get(item.playerId);
    const cue = findCue(state, item.cueId);
    const dx = player ? player.pos.x - boss.pos.x : 0;
    const dz = player ? player.pos.z - boss.pos.z : 0;
    const distance = Math.hypot(dx, dz);
    item.remaining -= DT;
    const snapped =
      !player ||
      player.dead ||
      boss.dead ||
      !cue ||
      item.remaining <= 0 ||
      distance > SILK_SNARE.breakYards;
    if (snapped) {
      withdraw(ctx, inst, state, item.cueId, emit);
      continue;
    }
    if (distance > SILK_SNARE.stopYards) {
      const next = silkReel(distance, DT);
      player.pos.x = boss.pos.x + (dx / distance) * next;
      player.pos.z = boss.pos.z + (dz / distance) * next;
      ctx.grid.update(player);
      ctx.playerGrid.update(player);
    }
    item.bite += DT;
    if (item.bite >= SILK_SNARE.biteSec) {
      item.bite -= SILK_SNARE.biteSec;
      ctx.dealDamage(
        boss,
        player,
        hoardMechanicDamage(inst, SILK_SNARE.damagePerSec * SILK_SNARE.biteSec),
        false,
        'nature',
        'Silk Snare',
        'hit',
        true,
      );
    }
    aim(cue, boss, player);
    live.push(item);
  }
  held.threads = live;
  if (live.length === 0) {
    held.phase = 'idle';
    held.timer = SILK_SNARE.everySec;
  }
}

export function isSilkCue(cue: HoardBossCue): boolean {
  return cue.variant === 'venom-silk';
}

/** Whether a player is on a thread right now. */
export function silkSnared(state: HoardBossState | undefined, playerId: number): boolean {
  return state?.silkSnare?.threads.some((item) => item.playerId === playerId) ?? false;
}

/** The locomotion seam: she stands to spin and to hold her threads. */
export function holdHoardSilkSnare(ctx: SimContext, mob: Entity): boolean {
  for (const inst of ctx.riftInstances) {
    if (inst.bossId !== mob.id || !inst.hoardBoss?.silkSnare) continue;
    return inst.hoardBoss.silkSnare.phase !== 'idle';
  }
  return false;
}
