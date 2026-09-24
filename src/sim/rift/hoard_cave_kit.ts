// What the cave bosses of the common and rare hoards share (the Mother of
// Mushrooms keeps her own older module; Deeprake, the Colossal Bat and the
// Voracious Chest use this one): laying a mark or a sweep on the ordinary hoard
// cue list, putting a scripted cast bar on the boss and taking it off, their
// shared clock step, and the hold that keeps the locomotion seam from walking a
// boss while a module moves it (a leap, a dive, a burrow).
//
// Draws no rng: every placement is a pure function of positions and counters.

import type { SimContext } from '../sim_context';
import { DT, type Entity } from '../types';
import { hoardPressure } from './hoard_scaling';
import type { HoardBossCue, HoardBossCueVariant, HoardBossState, RiftInstance } from './types';

export type CaveEmit = (ctx: SimContext, inst: RiftInstance, cue: HoardBossCue) => void;
export type CaveMark = Extract<HoardBossCue, { kind: 'mark' }>;
export type CaveSweep = Extract<HoardBossCue, { kind: 'sweep' }>;

/** One tick of a cave boss's clock: the hoard's rarity presses it like every
 *  other boss's (a rare map a little faster, a common one a little slower). */
export function caveStep(inst: RiftInstance): number {
  return DT / hoardPressure(inst.vault).cadence;
}

/** A rare (or rarer) map: the cave boss's extra mechanic is on. */
export function caveRare(inst: RiftInstance): boolean {
  return inst.vault !== null && inst.vault !== undefined && inst.vault.rarity !== 'common';
}

export function caveMark(
  ctx: SimContext,
  inst: RiftInstance,
  state: HoardBossState,
  variant: HoardBossCueVariant,
  x: number,
  z: number,
  radius: number,
  windup: number,
  emit: CaveEmit,
  targetId?: number,
): CaveMark {
  const cue: CaveMark = {
    id: state.nextCueId++,
    kind: 'mark',
    variant,
    phase: 'warning',
    x,
    z,
    radius,
    remaining: windup,
    total: windup,
    targetId,
  };
  state.cues.push(cue);
  emit(ctx, inst, cue);
  return cue;
}

export function caveSweep(
  ctx: SimContext,
  inst: RiftInstance,
  state: HoardBossState,
  variant: HoardBossCueVariant,
  from: { x: number; z: number },
  facing: number,
  radius: number,
  halfAngle: number,
  windup: number,
  emit: CaveEmit,
): CaveSweep {
  const cue: CaveSweep = {
    id: state.nextCueId++,
    kind: 'sweep',
    variant,
    x: from.x,
    z: from.z,
    facing,
    radius,
    halfAngle,
    remaining: windup,
    total: windup,
  };
  state.cues.push(cue);
  emit(ctx, inst, cue);
  return cue;
}

/** Take a module's cue off the list and tell the clients it is gone. */
export function caveWithdraw(
  ctx: SimContext,
  inst: RiftInstance,
  state: HoardBossState,
  cue: HoardBossCue,
  emit: CaveEmit,
): void {
  // A zero-length cue clears its mirror on every client, now (a zero remaining
  // with its old total would re-arm the online mirror for the full length).
  cue.remaining = 0;
  cue.total = 0;
  state.cues = state.cues.filter((other) => other.id !== cue.id);
  emit(ctx, inst, cue);
}

export function caveFindCue(state: HoardBossState, id: number): HoardBossCue | undefined {
  for (const cue of state.cues) if (cue.id === id) return cue;
  return undefined;
}

/** Put a scripted cast bar on the boss (the render plays the clip its visual
 *  maps to this cast id: castByAbility). */
export function caveCast(boss: Entity, castId: string, seconds: number, targetId?: number): void {
  boss.castingAbility = castId;
  boss.castTotal = seconds;
  boss.castRemaining = seconds;
  boss.castTargetId = targetId ?? null;
  boss.channeling = false;
}

/** Take the boss's cast bar off if it is still the given cast. */
export function caveClearCast(boss: Entity, castId: string): void {
  if (boss.castingAbility !== castId) return;
  boss.castingAbility = null;
  boss.castRemaining = 0;
  boss.castTotal = 0;
  boss.castTargetId = null;
}

/** Whether anything the boss asked of the party is still pending: a sweep, or a
 *  mark still in its warning. One thing at a time. */
export function caveBusy(state: HoardBossState): boolean {
  return state.cues.some((cue) => cue.kind === 'sweep' || cue.phase === 'warning');
}

/** Pick points no two closer than `spacing`, from candidates in order. */
export function caveSpread(
  candidates: ReadonlyArray<{ x: number; z: number }>,
  count: number,
  spacing: number,
  avoid: ReadonlyArray<{ x: number; z: number; r: number }> = [],
): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  for (const point of candidates) {
    if (out.length >= count) break;
    if (out.some((p) => (p.x - point.x) ** 2 + (p.z - point.z) ** 2 < spacing * spacing)) continue;
    if (avoid.some((a) => (a.x - point.x) ** 2 + (a.z - point.z) ** 2 < a.r * a.r)) continue;
    out.push({ x: point.x, z: point.z });
  }
  return out;
}

/** Points on a ring round `center`, `slots` of them turned by `turn`. */
export function caveRing(
  center: { x: number; z: number },
  radius: number,
  slots: number,
  turn: number,
): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < slots; i++) {
    // Every other slot first, then the ones between: spread before it fills.
    const half = Math.ceil(slots / 2);
    const slot = (turn + (i < half ? i * 2 : (i - half) * 2 + 1)) % slots;
    const angle = (slot / slots) * Math.PI * 2;
    out.push({ x: center.x + Math.sin(angle) * radius, z: center.z + Math.cos(angle) * radius });
  }
  return out;
}

/** The locomotion seam (mob/combat_profile.ts) holds a cave boss still while one
 *  of these modules moves it or has it underground. */
export function holdHoardCaveBoss(ctx: SimContext, mob: Entity): boolean {
  for (const inst of ctx.riftInstances) {
    if (inst.bossId !== mob.id) continue;
    return inst.hoardBoss?.caveHeld === true;
  }
  return false;
}
