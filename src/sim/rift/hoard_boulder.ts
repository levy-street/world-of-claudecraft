// Grask's ROLLING BOULDER (the Buried Hoard brute boss), the authoritative half:
// when he throws, whom he marks and that they cannot move, where each boulder
// is, who stood with the marked when it arrived, whether it is thrown back at
// him or crushes them, and that nothing (no root, no stun, no cast bar) outlives
// the fight. The numbers, the roll and the hit tests are pure and shared with
// the renderer (hoard_boulder_core.ts).
//
// State rides HoardBossState.boulder; the telegraphs ride the ordinary hoard cue
// list (the variants are listed in the core). The carrier is a SWEEP, so the boss
// engine's busy gate holds his combo back while a boulder is in play. Draws no rng.

import type { SimContext } from '../sim_context';
import { DT, type Entity } from '../types';
import { hoardBossKit } from './hoard_boss_kits';
import {
  BOULDER,
  boulderPlan,
  boulderProgress,
  boulderReturnSec,
  boulderRunsOver,
  boulderTravelSec,
  HOARD_BOULDER_DAZE_AURA_ID,
  HOARD_BOULDER_DREAD_AURA_ID,
  HOARD_BOULDER_STAGGER_AURA_ID,
  isBoulderVariant,
  standsWith,
} from './hoard_boulder_core';
import { HOARD_CAST_ROLLING_BOULDER } from './hoard_control_cast_ids';
import {
  HOARD_DOUBLE_MECHANIC_INTENSITY,
  hoardIntensity,
  hoardMechanicDamage,
  hoardPressure,
} from './hoard_scaling';
import type { HoardBossCue, HoardBossState, RiftInstance } from './types';

export const HOARD_BOULDER_ABILITY = 'Rolling Boulder';

/** Cadence: it takes turns with his combo, and the hoard's rarity presses it
 *  like every other boss's clock. */
export const BOULDER_FIRST_SEC = 15;
export const BOULDER_EVERY_SEC = 38;

interface Boulder {
  cueId: number;
  /** The marked player (null alone: the boulder only has a lane). */
  targetId: number | null;
  needed: number;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  travel: number;
  progress: number;
  phase: 'rolling' | 'returning' | 'broken';
}

export interface HoardBoulderState {
  timer: number;
  carrierId: number;
  boulders: Boulder[];
  /** Rotates whom he marks, cast to cast. */
  casts: number;
}

type Emit = (ctx: SimContext, inst: RiftInstance, cue: HoardBossCue) => void;
type SweepCue = Extract<HoardBossCue, { kind: 'sweep' }>;
type MarkCue = Extract<HoardBossCue, { kind: 'mark' }>;

export function isBoulderCue(cue: HoardBossCue): boolean {
  return isBoulderVariant(cue.variant);
}

function boulderState(state: HoardBossState): HoardBoulderState {
  state.boulder ??= {
    timer: BOULDER_FIRST_SEC,
    carrierId: -1,
    boulders: [],
    casts: 0,
  };
  return state.boulder;
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

function clearCast(boss: Entity | undefined): void {
  if (!boss || boss.castingAbility !== HOARD_CAST_ROLLING_BOULDER) return;
  boss.castingAbility = null;
  boss.castRemaining = 0;
  boss.castTotal = 0;
  boss.castTargetId = null;
}

function release(player: Entity | undefined): void {
  if (!player) return;
  player.auras = player.auras.filter((aura) => aura.id !== HOARD_BOULDER_DREAD_AURA_ID);
}

function begin(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  living: readonly Entity[],
  emit: Emit,
): void {
  const held = boulderState(state);
  const pressure = hoardPressure(inst.vault);
  const double = hoardIntensity(inst.vault, living.length) >= HOARD_DOUBLE_MECHANIC_INTENSITY;
  const plan = boulderPlan(living.length, double);
  held.casts++;
  held.boulders = [];
  // The carrier outlives every beat; it is withdrawn the moment the last boulder
  // is done with.
  const longest =
    BOULDER.warningSec +
    BOULDER.doubleStaggerSec +
    boulderTravelSec(80, pressure.speed) +
    boulderReturnSec(80) +
    BOULDER.crushSec;
  const carrier: SweepCue = {
    id: state.nextCueId,
    kind: 'sweep',
    variant: 'brute-boulder-throw',
    x: boss.pos.x,
    z: boss.pos.z,
    facing: boss.facing,
    radius: BOULDER.boulderRadius,
    halfAngle: Math.PI,
    remaining: longest,
    total: longest,
  };
  // The carrier, then one id per boulder: the renderer pairs them by id.
  state.nextCueId += 1 + plan.boulders;
  held.carrierId = carrier.id;
  state.cues.push(carrier);
  emit(ctx, inst, carrier);
  for (let n = 0; n < plan.boulders; n++) {
    // `living` is id-sorted (instancePlayers sorts); the turn walks round it, and
    // a second mark is always someone else.
    const target =
      living[(held.casts + n * Math.max(1, Math.floor(living.length / 2))) % living.length];
    if (held.boulders.some((other) => other.targetId === target.id)) continue;
    const solo = plan.needed === 0;
    const dx = target.pos.x - boss.pos.x;
    const dz = target.pos.z - boss.pos.z;
    const range = Math.max(1e-6, Math.hypot(dx, dz));
    // Alone the lane runs on past where they stood: moving BACK along it is no escape.
    const reach = solo ? range + BOULDER.soloOvershoot : range;
    const to = ctx.groundPos(boss.pos.x + (dx / range) * reach, boss.pos.z + (dz / range) * reach);
    const travel = boulderTravelSec(reach, pressure.speed);
    const total = BOULDER.warningSec + n * BOULDER.doubleStaggerSec + travel;
    const cue: MarkCue = {
      id: carrier.id + 1 + n,
      kind: 'mark',
      variant: 'brute-boulder',
      // Never rewritten: both sides read the roll off the shared clock.
      phase: 'warning',
      x: to.x,
      z: to.z,
      radius: BOULDER.supportRadius,
      innerRadius: plan.needed,
      targetId: solo ? undefined : target.id,
      remaining: total,
      total,
    };
    state.cues.push(cue);
    emit(ctx, inst, cue);
    held.boulders.push({
      cueId: cue.id,
      targetId: solo ? null : target.id,
      needed: plan.needed,
      fromX: boss.pos.x,
      fromZ: boss.pos.z,
      toX: to.x,
      toZ: to.z,
      travel,
      progress: 0,
      phase: 'rolling',
    });
    if (!solo) {
      // Held where they stand until the boulder is answered, one way or the other.
      ctx.applyAura(target, {
        id: HOARD_BOULDER_DREAD_AURA_ID,
        name: 'Rooted in Dread',
        kind: 'root',
        remaining: total + 0.5,
        duration: total + 0.5,
        value: 0,
        sourceId: boss.id,
        school: 'physical',
        unbreakableControl: true,
      });
    }
  }
  boss.castingAbility = HOARD_CAST_ROLLING_BOULDER;
  boss.castTotal = BOULDER.warningSec;
  boss.castRemaining = BOULDER.warningSec;
  boss.castTargetId = held.boulders[0]?.targetId ?? null;
  held.timer = BOULDER_EVERY_SEC * pressure.cadence;
  ctx.emit({
    type: 'spellfxAt',
    x: boss.pos.x,
    z: boss.pos.z,
    school: 'physical',
    fx: 'burst',
    ability: HOARD_BOULDER_ABILITY,
    duration: BOULDER.warningSec,
    sourceId: boss.id,
  });
  ctx.emit({
    type: 'log',
    text:
      plan.needed === 0
        ? `${boss.name} hurls a boulder down the room. Get out of its way!`
        : `${boss.name} hefts a boulder at a marked player. Stand with them to throw it back!`,
    color: '#e0b070',
    entityId: boss.id,
  });
}

function crush(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  victim: Entity,
  helpless: boolean,
): void {
  let amount = hoardMechanicDamage(inst, BOULDER.crushDamageFraction);
  // A ROOTED mark could do nothing about it, so the boulder alone never kills
  // them: it takes them to a sliver. A lone player who stood in its lane could
  // have moved, and gets no such floor.
  if (helpless) amount = Math.min(amount, Math.floor(victim.hp) - 1);
  if (amount <= 0) return;
  ctx.dealDamage(boss, victim, amount, false, 'physical', HOARD_BOULDER_ABILITY, 'hit', true);
  if (victim.dead) return;
  ctx.applyAura(victim, {
    id: HOARD_BOULDER_DAZE_AURA_ID,
    name: 'Crushed',
    kind: 'stun',
    remaining: BOULDER.crushStunSec,
    duration: BOULDER.crushStunSec,
    value: 0,
    sourceId: boss.id,
    school: 'physical',
  });
}

/** The boulder is done with: its cue becomes the break (`hit`: it ran someone down). */
function shatter(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  boulder: Boulder,
  x: number,
  z: number,
  hit: boolean,
  emit: Emit,
): void {
  boulder.phase = 'broken';
  const cue = findCue(state, boulder.cueId);
  if (cue && cue.kind === 'mark') {
    cue.variant = 'brute-boulder-crush';
    cue.x = x;
    cue.z = z;
    cue.innerRadius = hit ? 1 : 0;
    cue.targetId = undefined;
    cue.remaining = BOULDER.crushSec;
    cue.total = BOULDER.crushSec;
    emit(ctx, inst, cue);
  }
  ctx.emit({
    type: 'spellfxAt',
    x,
    z,
    school: 'physical',
    fx: 'burst',
    ability: HOARD_BOULDER_ABILITY,
    radius: BOULDER.boulderRadius * 1.5,
    sourceId: boss.id,
  });
}

function tickBoulder(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  boulder: Boulder,
  living: readonly Entity[],
  emit: Emit,
): void {
  const cue = findCue(state, boulder.cueId);
  if (!cue || boulder.phase === 'broken') return;
  // Decimal second timers must fire on their exact fixed-step boundary.
  const elapsed = cue.total - cue.remaining + 1e-8;
  if (boulder.phase === 'returning') {
    if (cue.remaining > DT + 1e-8) return;
    // Back where it came from: he reels, and it costs him.
    ctx.applyAura(boss, {
      id: HOARD_BOULDER_STAGGER_AURA_ID,
      name: 'Staggered',
      kind: 'stun',
      remaining: BOULDER.bossStunSec,
      duration: BOULDER.bossStunSec,
      value: 0,
      sourceId: boss.id,
      school: 'physical',
      unbreakableControl: true,
      encounterOwned: true,
    });
    // Credited to whoever was marked (even if they have since died: he never
    // hits himself), and worth NO threat: answering the mechanic must not turn
    // him on a healer the moment he stops reeling.
    const thrower = ctx.entities.get(boulder.targetId ?? -1);
    if (thrower) {
      ctx.dealDamage(
        thrower,
        boss,
        Math.max(1, Math.round(boss.maxHp * BOULDER.reflectDamageFraction)),
        false,
        'physical',
        HOARD_BOULDER_ABILITY,
        'hit',
        true,
        { mult: 0 },
      );
    }
    shatter(ctx, inst, boss, state, boulder, boulder.fromX, boulder.fromZ, true, emit);
    return;
  }
  // The engine drops a spent cue before this runs: its last live tick IS the arrival.
  const progress =
    cue.remaining <= DT + 1e-8 ? 1 : boulderProgress(elapsed, cue.total, boulder.travel);
  if (boulder.targetId === null) {
    // Alone: it runs down whoever is in its lane, and breaks on them or at its end.
    for (const player of living) {
      if (
        !boulderRunsOver(
          boulder.fromX,
          boulder.fromZ,
          boulder.toX,
          boulder.toZ,
          boulder.progress,
          progress,
          player.pos.x,
          player.pos.z,
        )
      )
        continue;
      crush(ctx, inst, boss, player, false);
      shatter(ctx, inst, boss, state, boulder, player.pos.x, player.pos.z, true, emit);
      return;
    }
    boulder.progress = progress;
    if (progress >= 1)
      shatter(ctx, inst, boss, state, boulder, boulder.toX, boulder.toZ, false, emit);
    return;
  }
  boulder.progress = progress;
  if (progress < 1) return;
  // Let go whether or not they still stand: the root survives death by design
  // (no player counter sheds it), so only this module ever takes it off.
  release(ctx.entities.get(boulder.targetId ?? -1));
  const target = living.find((player) => player.id === boulder.targetId);
  if (!target) {
    // Its mark died or left before it arrived: it breaks on empty ground.
    shatter(ctx, inst, boss, state, boulder, boulder.toX, boulder.toZ, false, emit);
    return;
  }
  let standing = 0;
  for (const player of living) {
    if (player.id === target.id) continue;
    if (standsWith(target.pos.x, target.pos.z, player.pos.x, player.pos.z)) standing++;
  }
  if (standing < boulder.needed) {
    crush(ctx, inst, boss, target, true);
    shatter(ctx, inst, boss, state, boulder, target.pos.x, target.pos.z, true, emit);
    ctx.emit({
      type: 'log',
      text: 'The boulder crushes its mark: too few stood with them.',
      color: '#ff9a9a',
      entityId: boss.id,
    });
    return;
  }
  // Enough of them: it goes back the way it came.
  boulder.phase = 'returning';
  if (cue.kind === 'mark') {
    const back = boulderReturnSec(
      Math.hypot(boulder.fromX - target.pos.x, boulder.fromZ - target.pos.z),
    );
    cue.variant = 'brute-boulder-return';
    cue.x = target.pos.x;
    cue.z = target.pos.z;
    cue.targetId = undefined;
    cue.remaining = back;
    cue.total = back;
    emit(ctx, inst, cue);
  }
  ctx.emit({
    type: 'log',
    text: `The boulder is thrown back. ${boss.name} is staggered!`,
    color: '#a8e6a0',
    entityId: boss.id,
  });
}

/** One tick of the brute kit's boulder clock. Called only while he is engaged. */
export function tickHoardBoulder(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  players: readonly Entity[],
  emit: Emit,
): void {
  const held = boulderState(state);
  const living = players.filter((p) => !p.dead);
  if (held.boulders.length === 0) {
    held.timer -= DT;
    if (held.timer > 0 || living.length === 0) return;
    // Only into a clean room, and never into the middle of his combo.
    if (state.cues.length > 0 || state.sequenceStep !== 0) return;
    begin(ctx, inst, boss, state, living, emit);
    return;
  }
  const carrier = findCue(state, held.carrierId);
  if (carrier) {
    const elapsed = carrier.total - carrier.remaining;
    if (elapsed < BOULDER.warningSec) boss.castRemaining = BOULDER.warningSec - elapsed;
    else clearCast(boss);
  }
  let open = 0;
  for (const boulder of held.boulders) {
    tickBoulder(ctx, inst, boss, state, boulder, living, emit);
    if (findCue(state, boulder.cueId)) open++;
  }
  if (open > 0 && carrier) return;
  if (carrier && boss.auras.some((aura) => aura.id === HOARD_BOULDER_STAGGER_AURA_ID)) {
    // He is reeling: the carrier stays up, so the busy gate holds his combo for
    // exactly as long as the stun itself lasts.
    carrier.remaining = Math.max(carrier.remaining, DT * 2);
    return;
  }
  // Every boulder is done with (or the carrier was cleared from under them).
  for (const boulder of held.boulders) {
    release(ctx.entities.get(boulder.targetId ?? -1));
    const cue = findCue(state, boulder.cueId);
    if (cue) withdraw(ctx, inst, cue, emit);
  }
  held.boulders = [];
  if (carrier) withdraw(ctx, inst, carrier, emit);
  held.carrierId = -1;
  clearCast(boss);
}

/** A boulder cue's tick. The module above owns every beat; a cue only has to say
 *  whether it still lives. */
export function tickHoardBoulderCue(cue: HoardBossCue): boolean {
  return cue.remaining > 1e-8;
}

/** Grask plants his feet for the throw: he stands where he cast until the
 *  boulder has left his hands. Scoped to the hoard boss, after normal target and
 *  leash checks. */
export function holdHoardBoulder(ctx: SimContext, mob: Entity): boolean {
  if (hoardBossKit(mob.templateId) !== 'brute') return false;
  if (mob.castingAbility !== HOARD_CAST_ROLLING_BOULDER) return false;
  const inst = ctx.riftInstances.find(
    (entry) => entry.vault && entry.partyKey !== null && entry.bossId === mob.id,
  );
  const cues = inst?.hoardBoss?.cues;
  if (!cues) return false;
  for (const cue of cues) {
    if (cue.remaining <= 0 || cue.variant !== 'brute-boulder-throw') continue;
    mob.pos.x = cue.x;
    mob.pos.z = cue.z;
    mob.swingTimer = Math.max(mob.swingTimer, 0.5);
    return true;
  }
  return false;
}

/** The fight reset or ended: nobody stays rooted, he does not stay staggered,
 *  and the cast bar goes (the cues already went). */
export function clearHoardBoulder(
  ctx: SimContext,
  boss: Entity | undefined,
  state: HoardBossState,
): void {
  const held = state.boulder;
  if (held) for (const boulder of held.boulders) release(ctx.entities.get(boulder.targetId ?? -1));
  if (boss) {
    boss.auras = boss.auras.filter((aura) => aura.id !== HOARD_BOULDER_STAGGER_AURA_ID);
    clearCast(boss);
  }
  delete state.boulder;
}
