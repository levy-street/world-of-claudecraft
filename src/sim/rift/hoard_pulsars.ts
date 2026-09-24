// Nyxaris's TWIN PULSARS (the Buried Hoard arcane boss), the authoritative half:
// when the orbs wake, that he cannot be harmed while one burns, who each hunts,
// where its beam is and whom it burns, what ends the phase, and that nothing
// outlives the fight. Placement, targeting and the chase are pure and shared with
// the renderer (hoard_pulsars_core.ts).
//
// State rides HoardBossState.pulsars. What the client needs rides what already
// reaches it: two boss auras (how many orbs ride him; his ward), the orbs
// themselves (real mobs while active), and ordinary hoard cues:
//   arcane-pulsar-ward   the phase, at the boss: his immunity and its deadline
//   arcane-pulsar        one per active orb, at its station (the next id up is
//                        ALWAYS that orb's lock or beam: the renderer pairs them
//                        by id, so the wire carries nothing new)
//   arcane-pulsar-lock   the harmless targeting line (it follows its target)
//   arcane-pulsar-beam   the beam's aim point: a HEARTBEAT, re-sent every couple
//                        of ticks with a short life, so a client tracks the chase
//                        and a dead orb's beam dies on its own
// Draws no rng.

import { MOBS } from '../data';
import { createMob } from '../entity';
import type { SimContext } from '../sim_context';
import { DT, type Entity } from '../types';
import { hoardBossKit } from './hoard_boss_kits';
import { HOARD_CAST_PULSAR_OVERLOAD } from './hoard_control_cast_ids';
import {
  assignPulsarTargets,
  type BeamAim,
  beamTrackSpeed,
  HOARD_BOUND_PULSARS_AURA_ID,
  HOARD_PULSAR_TEMPLATE,
  HOARD_PULSAR_WARD_AURA_ID,
  isPulsarVariant,
  PULSAR_WARD_TOTAL_SEC,
  PULSARS,
  pointInPulsarBeam,
  pulsarCount,
  pulsarStation,
  stepBeamAim,
} from './hoard_pulsars_core';
import { hoardMechanicDamage, hoardPressure } from './hoard_scaling';
import type { HoardBossCue, HoardBossState, RiftInstance } from './types';

export const HOARD_PULSARS_ABILITY = 'Twin Pulsars';
export const HOARD_PULSAR_BEAM_ABILITY = 'Tracking Beam';
export const HOARD_PULSAR_OVERLOAD_ABILITY = 'Pulsar Overload';

/** Cadence: a priority shift, not floor pressure. The hoard's rarity presses it
 *  like every other boss's clock. */
export const PULSARS_FIRST_SEC = 14;
export const PULSARS_EVERY_SEC = 48;

interface ActivePulsar {
  index: number;
  /** The orb's station cue; `cueId + 1` is reserved for its lock, then its beam. */
  cueId: number;
  /** The mob, once the activation completes. */
  entityId: number | null;
  x: number;
  z: number;
  targetId: number | null;
  /** Seconds of targeting line left before the beam fires; 0 while firing. */
  lock: number;
  firing: boolean;
  aim: BeamAim;
  heartbeat: number;
  /** Sim-time seconds until each player may be burned by THIS beam again. */
  burned: Map<number, number>;
}

export interface HoardPulsarState {
  timer: number;
  phase: 'dormant' | 'active' | 'recovering';
  carrierId: number;
  released: boolean;
  orbs: ActivePulsar[];
  recover: number;
  /** Rotates who is hunted first, cast to cast. */
  casts: number;
}

type Emit = (ctx: SimContext, inst: RiftInstance, cue: HoardBossCue) => void;
type SweepCue = Extract<HoardBossCue, { kind: 'sweep' }>;
type MarkCue = Extract<HoardBossCue, { kind: 'mark' }>;

export function isPulsarCue(cue: HoardBossCue): boolean {
  return isPulsarVariant(cue.variant);
}

function pulsarState(state: HoardBossState): HoardPulsarState {
  state.pulsars ??= {
    timer: PULSARS_FIRST_SEC,
    phase: 'dormant',
    carrierId: -1,
    released: false,
    orbs: [],
    recover: 0,
    casts: 0,
  };
  return state.pulsars;
}

function setRiding(ctx: SimContext, boss: Entity, count: number): void {
  const held = boss.auras.find((aura) => aura.id === HOARD_BOUND_PULSARS_AURA_ID);
  if (count <= 0) {
    if (held) boss.auras = boss.auras.filter((aura) => aura !== held);
    return;
  }
  if (held && held.stacks === count && held.remaining > 60) return;
  if (held) boss.auras = boss.auras.filter((aura) => aura !== held);
  // No power in it: the aura is how every client knows the orbs ride him.
  ctx.applyAura(boss, {
    id: HOARD_BOUND_PULSARS_AURA_ID,
    name: 'Bound Pulsars',
    kind: 'buff_dmg_done',
    remaining: 3600,
    duration: 3600,
    value: 0,
    stacks: count,
    sourceId: boss.id,
    school: 'arcane',
    encounterOwned: true,
  });
}

function setWard(ctx: SimContext, boss: Entity, on: boolean): void {
  boss.damageImmune = on;
  boss.auras = boss.auras.filter((aura) => aura.id !== HOARD_PULSAR_WARD_AURA_ID);
  if (!on) return;
  ctx.applyAura(boss, {
    id: HOARD_PULSAR_WARD_AURA_ID,
    name: 'Pulsar Ward',
    kind: 'buff_dmg_done',
    remaining: PULSARS.maxPhaseSec + 1,
    duration: PULSARS.maxPhaseSec + 1,
    value: 0,
    sourceId: boss.id,
    school: 'arcane',
    encounterOwned: true,
  });
}

function clearCast(boss: Entity | undefined): void {
  if (!boss || boss.castingAbility !== HOARD_CAST_PULSAR_OVERLOAD) return;
  boss.castingAbility = null;
  boss.castRemaining = 0;
  boss.castTotal = 0;
  boss.castTargetId = null;
}

/** The orbs ride him whenever he is whole, in or out of combat: called for the
 *  arcane boss before the engine's engaged check, as the brood's eggs are. */
export function ensureHoardPulsars(ctx: SimContext, inst: RiftInstance, boss: Entity): void {
  const phase = inst.hoardBoss?.pulsars?.phase ?? 'dormant';
  setRiding(ctx, boss, phase === 'dormant' ? pulsarCount(inst.vault?.rarity) : 0);
}

function withdraw(ctx: SimContext, inst: RiftInstance, cue: HoardBossCue, emit: Emit): void {
  // A zero-length cue clears its mirror on every client, now.
  cue.remaining = 0;
  cue.total = 0;
  emit(ctx, inst, cue);
}

function findCue(state: HoardBossState, id: number): HoardBossCue | undefined {
  for (const cue of state.cues) if (cue.id === id) return cue;
  return undefined;
}

function activate(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  emit: Emit,
): void {
  const pulsars = pulsarState(state);
  const carrier: SweepCue = {
    id: state.nextCueId++,
    kind: 'sweep',
    variant: 'arcane-pulsar-ward',
    x: boss.pos.x,
    z: boss.pos.z,
    facing: boss.facing,
    radius: PULSARS.stationDistance,
    halfAngle: Math.PI,
    remaining: PULSAR_WARD_TOTAL_SEC,
    total: PULSAR_WARD_TOTAL_SEC,
  };
  state.cues.push(carrier);
  emit(ctx, inst, carrier);
  pulsars.phase = 'active';
  pulsars.carrierId = carrier.id;
  pulsars.released = false;
  pulsars.orbs = [];
  pulsars.casts++;
  const count = pulsarCount(inst.vault?.rarity);
  for (let index = 0; index < count; index++) {
    const station = pulsarStation(index, boss.pos.x, boss.pos.z, boss.facing);
    const at = ctx.groundPos(station.x, station.z);
    const cue: MarkCue = {
      id: state.nextCueId,
      kind: 'mark',
      variant: 'arcane-pulsar',
      phase: 'hazard',
      x: at.x,
      z: at.z,
      // Which orb this is: the renderer flies the matching dormant orb to it.
      radius: index,
      remaining: PULSAR_WARD_TOTAL_SEC,
      total: PULSAR_WARD_TOTAL_SEC,
    };
    // This orb's cue, then the id its lock and its beam will share.
    state.nextCueId += 2;
    state.cues.push(cue);
    emit(ctx, inst, cue);
    pulsars.orbs.push({
      index,
      cueId: cue.id,
      entityId: null,
      x: at.x,
      z: at.z,
      targetId: null,
      lock: 0,
      firing: false,
      aim: { x: at.x, z: at.z, heading: 0 },
      heartbeat: 0,
      burned: new Map(),
    });
  }
  setRiding(ctx, boss, 0);
  boss.castingAbility = HOARD_CAST_PULSAR_OVERLOAD;
  boss.castTotal = PULSAR_WARD_TOTAL_SEC;
  boss.castRemaining = PULSAR_WARD_TOTAL_SEC;
  boss.castTargetId = null;
  ctx.emit({
    type: 'spellfxAt',
    x: boss.pos.x,
    z: boss.pos.z,
    school: 'arcane',
    fx: 'burst',
    ability: HOARD_PULSARS_ABILITY,
    duration: PULSARS.activationCastSec,
    sourceId: boss.id,
  });
  ctx.emit({
    type: 'log',
    text: `${boss.name} unbinds his pulsars. Nothing can harm him while they burn: destroy them!`,
    color: '#8fd0ff',
    entityId: boss.id,
  });
}

/** The activation completes: the ward closes over him and the orbs become mobs. */
function release(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  pulsars: HoardPulsarState,
): void {
  pulsars.released = true;
  const template = MOBS[HOARD_PULSAR_TEMPLATE];
  // No orbs to kill means no ward to drop: never warded without them.
  if (!template) return;
  setWard(ctx, boss, true);
  for (const orb of pulsars.orbs) {
    const mob = createMob(ctx.nextId++, template, boss.level, ctx.groundPos(orb.x, orb.z));
    mob.maxHp = Math.max(1, Math.round(boss.maxHp * PULSARS.orbHealthFraction));
    mob.hp = mob.maxHp;
    mob.summonedAdd = true;
    mob.facing = Math.atan2(boss.pos.x - orb.x, boss.pos.z - orb.z);
    mob.prevFacing = mob.facing;
    ctx.addEntity(mob);
    boss.summonedIds.push(mob.id);
    inst.mobIds.push(mob.id);
    orb.entityId = mob.id;
  }
}

function dropOrbEntity(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity | undefined,
  orb: ActivePulsar,
): void {
  if (orb.entityId === null) return;
  const id = orb.entityId;
  orb.entityId = null;
  // Whoever was attacking it is left targeting nothing, never a removed entity
  // (the convention of freeRiftFloorEntities in runs.ts).
  for (const meta of ctx.players.values()) {
    const player = ctx.entities.get(meta.entityId);
    if (player && player.targetId === id) player.targetId = null;
  }
  if (ctx.entities.has(id)) ctx.dropEntity(id);
  inst.mobIds = inst.mobIds.filter((entry) => entry !== id);
  if (boss) boss.summonedIds = boss.summonedIds.filter((entry) => entry !== id);
}

/** An orb is spent: its beam stops this tick, its cues leave every client. */
function destroyOrb(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  orb: ActivePulsar,
  emit: Emit,
): void {
  for (const id of [orb.cueId + 1, orb.cueId]) {
    const cue = findCue(state, id);
    if (cue) withdraw(ctx, inst, cue, emit);
  }
  ctx.emit({
    type: 'spellfxAt',
    x: orb.x,
    z: orb.z,
    school: 'arcane',
    fx: 'burst',
    ability: HOARD_PULSARS_ABILITY,
    radius: 3,
    sourceId: boss.id,
  });
  dropOrbEntity(ctx, inst, boss, orb);
}

function endPhase(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  emit: Emit,
): void {
  const pulsars = pulsarState(state);
  for (const orb of pulsars.orbs) destroyOrb(ctx, inst, boss, state, orb, emit);
  pulsars.orbs = [];
  const carrier = findCue(state, pulsars.carrierId);
  if (carrier) withdraw(ctx, inst, carrier, emit);
  pulsars.carrierId = -1;
  setWard(ctx, boss, false);
  clearCast(boss);
  pulsars.phase = 'recovering';
  pulsars.recover = PULSARS.orbRespawnDelaySec;
  pulsars.timer = PULSARS_EVERY_SEC * hoardPressure(inst.vault).cadence;
}

function beamCue(state: HoardBossState, orb: ActivePulsar, variant: MarkCue['variant']): MarkCue {
  const id = orb.cueId + 1;
  const held = findCue(state, id);
  if (held && held.kind === 'mark') {
    held.variant = variant;
    return held;
  }
  const cue: MarkCue = {
    id,
    kind: 'mark',
    variant,
    phase: 'hazard',
    x: orb.aim.x,
    z: orb.aim.z,
    radius: PULSARS.beamWidth,
    remaining: PULSARS.beamHeartbeatLifeSec,
    total: PULSARS.beamHeartbeatLifeSec,
  };
  state.cues.push(cue);
  return cue;
}

function tickOrb(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  orb: ActivePulsar,
  living: readonly Entity[],
  wanted: number | undefined,
  mayFire: boolean,
  emit: Emit,
): void {
  for (const [pid, left] of orb.burned) {
    if (left - DT <= 0) orb.burned.delete(pid);
    else orb.burned.set(pid, left - DT);
  }
  let target = living.find((p) => p.id === orb.targetId);
  if (!target) {
    // Its quarry died or left: the beam stops, and it locks on someone else.
    target = living.find((p) => p.id === wanted) ?? living[0];
    orb.firing = false;
    orb.lock = PULSARS.targetWarningSec;
    orb.heartbeat = 0;
    if (!target) {
      orb.targetId = null;
      const held = findCue(state, orb.cueId + 1);
      if (held && held.remaining > 0) withdraw(ctx, inst, held, emit);
      return;
    }
    orb.targetId = target.id;
  }
  if (!mayFire && orb.firing) {
    // Its turn is over: the beam stops and the harmless line goes back on them.
    orb.firing = false;
    orb.heartbeat = 0;
  }
  if (!mayFire) orb.lock = PULSARS.targetWarningSec;
  if (!orb.firing) {
    if (mayFire) orb.lock -= DT;
    if (!mayFire || orb.lock > 1e-8) {
      // The targeting line: a heartbeat like the beam, and the client draws it to
      // the target itself, wherever they run.
      const lock = beamCue(state, orb, 'arcane-pulsar-lock');
      lock.x = target.pos.x;
      lock.z = target.pos.z;
      lock.targetId = target.id;
      lock.remaining = PULSARS.lockHeartbeatLifeSec;
      lock.total = PULSARS.lockHeartbeatLifeSec;
      if (orb.heartbeat <= 0) {
        orb.heartbeat = PULSARS.lockHeartbeatTicks;
        emit(ctx, inst, lock);
      }
      orb.heartbeat--;
      return;
    }
    // It fires SHORT of them, toward the orb, and sweeps in from there.
    orb.firing = true;
    const dx = target.pos.x - orb.x;
    const dz = target.pos.z - orb.z;
    const range = Math.hypot(dx, dz);
    const reach = Math.max(0, range - PULSARS.beamStartLag) / Math.max(1e-6, range);
    orb.aim.x = orb.x + dx * reach;
    orb.aim.z = orb.z + dz * reach;
    orb.aim.heading = Math.atan2(dx, dz);
    orb.heartbeat = 0;
    const beam = beamCue(state, orb, 'arcane-pulsar-beam');
    beam.targetId = undefined;
  } else {
    stepBeamAim(
      orb.aim,
      target.pos.x,
      target.pos.z,
      beamTrackSpeed(hoardPressure(inst.vault).speed),
      PULSARS.beamTurnSpeed,
      DT,
    );
  }
  const beam = beamCue(state, orb, 'arcane-pulsar-beam');
  beam.x = orb.aim.x;
  beam.z = orb.aim.z;
  beam.remaining = PULSARS.beamHeartbeatLifeSec;
  beam.total = PULSARS.beamHeartbeatLifeSec;
  if (orb.heartbeat <= 0) {
    orb.heartbeat = PULSARS.beamHeartbeatTicks;
    emit(ctx, inst, beam);
  }
  orb.heartbeat--;
  for (const player of living) {
    if (orb.burned.has(player.id)) continue;
    if (!pointInPulsarBeam(orb.x, orb.z, orb.aim.x, orb.aim.z, player.pos.x, player.pos.z))
      continue;
    orb.burned.set(player.id, PULSARS.beamDamageTickSec);
    ctx.dealDamage(
      boss,
      player,
      hoardMechanicDamage(inst, PULSARS.beamDamageFraction),
      false,
      'arcane',
      HOARD_PULSAR_BEAM_ABILITY,
      'hit',
      true,
    );
    ctx.emit({
      type: 'spellfxAt',
      x: player.pos.x,
      z: player.pos.z,
      school: 'arcane',
      fx: 'burst',
      ability: HOARD_PULSAR_BEAM_ABILITY,
      radius: 1.4,
      sourceId: boss.id,
    });
  }
}

/** One tick of the arcane kit's own clock. Called only while Nyxaris is engaged. */
export function tickHoardPulsars(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: HoardBossState,
  players: readonly Entity[],
  emit: Emit,
): void {
  const pulsars = pulsarState(state);
  const living = players.filter((p) => !p.dead);
  if (pulsars.phase === 'recovering') {
    pulsars.recover -= DT;
    pulsars.timer -= DT;
    if (pulsars.recover <= 0) pulsars.phase = 'dormant';
    return;
  }
  if (pulsars.phase === 'dormant') {
    pulsars.timer -= DT;
    if (pulsars.timer > 0 || living.length === 0) return;
    // Only into a clean room: never on top of his Voidfall or his Event Horizon.
    if (state.cues.length > 0) return;
    activate(ctx, inst, boss, state, emit);
    return;
  }
  const carrier = findCue(state, pulsars.carrierId);
  if (!carrier) {
    endPhase(ctx, inst, boss, state, emit);
    return;
  }
  const elapsed = carrier.total - carrier.remaining + 1e-8;
  boss.castRemaining = Math.max(0, carrier.remaining);
  if (!pulsars.released) {
    if (elapsed < PULSARS.activationCastSec) return;
    release(ctx, inst, boss, pulsars);
  }
  // Orbs the players have killed.
  const standing: ActivePulsar[] = [];
  for (const orb of pulsars.orbs) {
    const mob = orb.entityId === null ? undefined : ctx.entities.get(orb.entityId);
    if (mob && !mob.dead && mob.hp > 0) standing.push(orb);
    else destroyOrb(ctx, inst, boss, state, orb, emit);
  }
  pulsars.orbs = standing;
  if (standing.length === 0) {
    endPhase(ctx, inst, boss, state, emit);
    ctx.emit({
      type: 'log',
      text: `The last pulsar dies. ${boss.name} can be harmed again!`,
      color: '#8fd0ff',
      entityId: boss.id,
    });
    return;
  }
  if (carrier.remaining <= DT + 1e-8) {
    // Too slow: they burst on their own, over everyone, and the ward falls anyway.
    for (const player of living) {
      ctx.dealDamage(
        boss,
        player,
        hoardMechanicDamage(inst, PULSARS.overloadDamageFraction),
        false,
        'arcane',
        HOARD_PULSAR_OVERLOAD_ABILITY,
        'hit',
        true,
      );
    }
    endPhase(ctx, inst, boss, state, emit);
    ctx.emit({
      type: 'log',
      text: 'The pulsars overload and burst over everyone!',
      color: '#ff9a9a',
      entityId: boss.id,
    });
    return;
  }
  // `living` is id-sorted (instancePlayers sorts), which the assignment relies on.
  const wanted = assignPulsarTargets(
    Math.max(pulsars.orbs.length, pulsarCount(inst.vault?.rarity)),
    living.map((p) => p.id),
    pulsars.casts,
  );
  // Never two live beams on one player: orbs that hunt the same quarry take
  // turns, the rest holding their harmless line on them. A lone player still
  // faces every orb, one beam at a time.
  const turn = Math.floor(Math.max(0, elapsed - PULSARS.activationCastSec) / PULSARS.beamShareSec);
  for (const orb of pulsars.orbs) {
    let sharers = 0;
    let place = 0;
    for (const other of pulsars.orbs) {
      if (other.targetId === null || other.targetId !== orb.targetId) continue;
      if (other.index < orb.index) place++;
      sharers++;
    }
    const mayFire = sharers <= 1 || turn % sharers === place;
    tickOrb(ctx, inst, boss, state, orb, living, wanted[orb.index], mayFire, emit);
  }
}

/** A pulsar cue's tick. The module above owns every beat; a cue only has to say
 *  whether it still lives (a beam's life is refreshed each tick it burns). */
export function tickHoardPulsarCue(cue: HoardBossCue): boolean {
  return cue.remaining > 1e-8;
}

/** Nyxaris stands and channels for the whole phase: the orbs keep their stations
 *  round where he cast, and he holds his swings. Scoped to the hoard boss, after
 *  normal target and leash checks. */
export function holdHoardPulsars(ctx: SimContext, mob: Entity): boolean {
  if (hoardBossKit(mob.templateId) !== 'arcane') return false;
  const inst = ctx.riftInstances.find(
    (entry) => entry.vault && entry.partyKey !== null && entry.bossId === mob.id,
  );
  const cues = inst?.hoardBoss?.cues;
  if (!cues) return false;
  for (const cue of cues) {
    if (cue.remaining <= 0 || cue.variant !== 'arcane-pulsar-ward') continue;
    mob.pos.x = cue.x;
    mob.pos.z = cue.z;
    mob.swingTimer = Math.max(mob.swingTimer, 0.5);
    return true;
  }
  return false;
}

/** The fight reset or ended: the orbs, the ward and the cast bar all go with it
 *  (the cues already went). No invisible immunity survives a reset. */
export function clearHoardPulsars(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity | undefined,
  state: HoardBossState,
): void {
  const pulsars = state.pulsars;
  if (pulsars) for (const orb of pulsars.orbs) dropOrbEntity(ctx, inst, boss, orb);
  if (boss) {
    boss.damageImmune = false;
    boss.auras = boss.auras.filter((aura) => aura.id !== HOARD_PULSAR_WARD_AURA_ID);
    clearCast(boss);
  }
  delete state.pulsars;
}
