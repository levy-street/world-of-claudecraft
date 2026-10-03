// Fire and Fly hunts, the engine half: a wave's pack groups gather at rallies in the field,
// then advance together. A member walks in from its pack's side to its own place in a disc
// around the rally (`muster`) and stands there (`hold`). Once every living member stands,
// or once the hold timer since the first gathering member's arrival runs out (scouts, the
// quickest, arrive ahead and wait without starting it), the leader cries (the cue) and
// the pack leaves exactly TURRET_RALLY.cueLeadTicks later, at its one advance pace; its
// scouts break out at their own. A member thrown while the pack gathers gets up and walks
// back to its place; one not standing there at the departure goes for the tower alone at
// the pack's pace. A sprint group never gathers. The rally record lives only while its pack
// gathers: at the departure every member drops it. No marker of any kind: the standing pack
// and the cue are the telegraph. Pure: private stateless draws only, every leg an existing
// march or still segment.

import { TURRET_EXPLOSIVE_BARREL, TURRET_RALLY } from '../content/turret_defense';
import { groundOr, marchSegment, positionAt, stillSegment, type ThrowProbe } from './thrown_body';
import type { TurretBearingSector } from './turret_barrels';
import type { TurretDefenseState, TurretEvent, TurretMonster } from './turret_defense';
import { turretStrikeDistance } from './turret_defense_plan';
import { TURRET_STREAM, type TurretDrawSource, turretDraw } from './turret_defense_rng';
import {
  type TurretWavePlan,
  turretPackCount,
  turretPackGroup,
  turretPackLeaderKind,
} from './turret_group_plan';
import { TURRET_HUNT_LIMITS } from './turret_hunt_plan';
import { turretPaceOf } from './turret_pace';

const TAU = Math.PI * 2;
/** The golden angle: consecutive slots never line up, so the disc fills evenly. */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** How far apart (as a share of a turn, either side) a pack's side may wander off the even spread. */
const SIDE_JITTER = 0.08;
/** Turns (shares of a turn) a rally tries off its side's bearing when a standing keg covers every draw on it. */
const RALLY_TURNS = [0, 0.04, -0.04, 0.08, -0.08] as const;

export interface TurretRally {
  /** wave * TURRET_HUNT_LIMITS.packs + pack. */
  id: number;
  x: number;
  z: number;
  /** The advance's pace (yd/s), from the plan. */
  pace: number;
  /** Ticks from the first arrival to the cue, at the latest. */
  holdTicks: number;
  /** The leader's monster id, -1 until it spawns. */
  leader: number;
  /** -1 until each happens; the first arrival is a gathering member's, never a scout's. */
  firstArrivalTick: number;
  cueTick: number;
  departTick: number;
}

export function turretRallyId(wave: number, pack: number): number {
  return wave * TURRET_HUNT_LIMITS.packs + pack;
}

export function turretRallyPack(id: number): number {
  return id % TURRET_HUNT_LIMITS.packs;
}

/** The unit axis from a rally toward the tower, and its left-hand normal. */
function axisOf(x: number, z: number, cx: number, cz: number) {
  const dx = cx - x;
  const dz = cz - z;
  const d = Math.hypot(dx, dz);
  const ux = d > 1e-9 ? dx / d : 0;
  const uz = d > 1e-9 ? dz / d : 1;
  return { ux, uz, vx: -uz, vz: ux };
}

/** A member's place: slot n of the disc around the rally, turned to the advance axis. No draw. */
export function turretRallySlot(
  rally: { readonly x: number; readonly z: number },
  cx: number,
  cz: number,
  slot: number,
): { x: number; z: number } {
  const { ux, uz, vx, vz } = axisOf(rally.x, rally.z, cx, cz);
  const r = TURRET_RALLY.slotSpacing * Math.sqrt(slot + 0.5);
  const along = r * Math.cos(slot * GOLDEN);
  const across = r * Math.sin(slot * GOLDEN);
  return { x: rally.x + ux * along + vx * across, z: rally.z + uz * along + vz * across };
}

/** How far the gathering disc of `size` members reaches from its rally point (yd). */
export function turretRallyReach(size: number): number {
  return TURRET_RALLY.slotSpacing * Math.sqrt(Math.max(0, size - 0.5));
}

/** The latest a holder stands: the timer's cue, its lead, then the departure. */
export function turretRallyHoldEnd(rally: TurretRally, firstArrivalTick: number): number {
  if (rally.departTick >= 0) return rally.departTick;
  return firstArrivalTick + rally.holdTicks + TURRET_RALLY.cueLeadTicks;
}

/** The bearing a pack's side is centred on; the sprint group (-1) comes between the first two. */
function sideBearing(run: TurretDrawSource, wave: number, packs: number, group: number): number {
  const base = turretDraw(run, TURRET_STREAM.rallySide, wave, 0) * TAU;
  if (group < 0) return base + (0.5 / packs) * TAU;
  const jitter = packs > 1 ? turretDraw(run, TURRET_STREAM.rallySide, wave, 1 + group) * 2 - 1 : 0;
  return base + ((group + jitter * SIDE_JITTER) / packs) * TAU;
}

/** The arc a pack group's spawn (`g`) comes through, or the sprint group's: its side's. */
export function turretHuntSector(
  run: TurretDrawSource,
  waveIndex: number,
  wave: TurretWavePlan,
  g: number,
): TurretBearingSector {
  const group = wave.groups[g];
  const pack = group.brick === 'pack' ? group.pack : -1;
  const center = sideBearing(run, waveIndex, turretPackCount(wave), pack);
  const width = (group.brick === 'pack' || group.brick === 'sprint' ? group.widthTurn : 0) * TAU;
  return { from: center - width / 2, width };
}

/** Members pack `pack` of a wave gathers: its group's count. */
export function turretPackSize(wave: TurretWavePlan, pack: number): number {
  const g = turretPackGroup(wave, pack);
  return g < 0 ? 0 : wave.groups[g].count;
}

/** How far the nearest standing keg stands outside the gathering disc plus the clearance (yd). */
function rallyRoom(state: TurretDefenseState, x: number, z: number, reach: number): number {
  const room = reach + TURRET_RALLY.kegClearance + TURRET_EXPLOSIVE_BARREL.radius;
  let least = Number.POSITIVE_INFINITY;
  for (const b of state.barrels) least = Math.min(least, Math.hypot(b.x - x, b.z - z) - room);
  return least;
}

/**
 * Opens the current wave's rallies at its start, one per pack: on the pack's side, at a
 * drawn distance in its band, redrawn while the gathering disc would cover a standing keg
 * (the draw that leaves the most room stands). Returns the ones opened, in pack order.
 */
export function openTurretRallies(state: TurretDefenseState, wave: TurretWavePlan): TurretRally[] {
  const packs = turretPackCount(wave);
  if (!packs) return [];
  state.rallies ??= [];
  const rallies = state.rallies;
  const opened: TurretRally[] = [];
  const tries = TURRET_RALLY.placementTries;
  for (const group of wave.groups) {
    if (group.brick !== 'pack') continue;
    const p = group.pack;
    const bearing = sideBearing(state, state.wave, packs, p);
    const reach = turretRallyReach(group.count);
    let x = state.cx;
    let z = state.cz;
    let best = Number.NEGATIVE_INFINITY;
    // The side's own bearing first, then turned a little either way, the same draws each.
    search: for (const turn of RALLY_TURNS) {
      for (let attempt = 0; attempt < tries; attempt++) {
        const key = p * tries + attempt;
        const u = turretDraw(state, TURRET_STREAM.rallyRadius, state.wave, key);
        const r = group.minRadius + u * (group.maxRadius - group.minRadius);
        const tx = state.cx + Math.sin(bearing + turn * TAU) * r;
        const tz = state.cz + Math.cos(bearing + turn * TAU) * r;
        const room = rallyRoom(state, tx, tz, reach);
        if (room <= best) continue;
        best = room;
        x = tx;
        z = tz;
        if (room >= 0) break search;
      }
    }
    const rally: TurretRally = {
      id: turretRallyId(state.wave, p),
      x,
      z,
      pace: group.pace,
      holdTicks: group.holdTicks,
      leader: -1,
      firstArrivalTick: -1,
      cueTick: -1,
      departTick: -1,
    };
    rallies.push(rally);
    opened.push(rally);
  }
  return opened;
}

function rallyById(state: TurretDefenseState, id: number | undefined): TurretRally | undefined {
  return id === undefined ? undefined : state.rallies?.find((r) => r.id === id);
}

function facingToward(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(tx - x, tz - z);
}

/** A march to the tower from `p` at the monster's pace, from tick `at`. */
function marchIn(state: TurretDefenseState, m: TurretMonster, at: number, p: Vec): void {
  const kind = state.plan.kinds[m.kind];
  m.state = 'march';
  m.seg = marchSegment(
    at,
    p.x,
    p.y,
    p.z,
    state.cx,
    state.cz,
    turretPaceOf(state, m),
    turretStrikeDistance(kind),
  );
  m.facing = facingToward(p.x, p.z, state.cx, state.cz);
}

interface Vec {
  x: number;
  y: number;
  z: number;
}

/** A walk from `p` back to the member's place at the rally, at its own pace. */
function musterTo(
  state: TurretDefenseState,
  m: TurretMonster,
  rally: TurretRally,
  at: number,
  p: Vec,
): void {
  const slot = turretRallySlot(rally, state.cx, state.cz, m.slot ?? 0);
  m.state = 'muster';
  m.seg = marchSegment(at, p.x, p.y, p.z, slot.x, slot.z, turretPaceOf(state, m), 0);
  m.facing = facingToward(p.x, p.z, slot.x, slot.z);
}

/**
 * A pack group's new monster (group `g`, its `index`-th), already on the field with a march
 * to the tower at its own pace: it turns to its place at its pack's rally (and takes the lead
 * when it is the pack's leader); one whose pack already left goes for the tower at the pack's
 * pace (a scout at its own). Any other group's keeps its march.
 */
export function joinTurretHunt(
  state: TurretDefenseState,
  m: TurretMonster,
  wave: TurretWavePlan,
  g: number,
  index: number,
  tick: number,
): void {
  const group = wave.groups[g];
  if (group.brick !== 'pack') return;
  const rally = rallyById(state, turretRallyId(state.wave, group.pack));
  const p = { x: m.seg.x, y: m.seg.y, z: m.seg.z };
  if (!rally) {
    if (state.plan.kinds[m.kind].role !== 'scout') m.pace = group.pace;
    marchIn(state, m, tick, p);
    return;
  }
  m.rally = rally.id;
  m.slot = index;
  if (index === group.leader) rally.leader = m.id;
  musterTo(state, m, rally, tick, p);
}

/** A member arrived at its place: it stands there facing the tower until the departure. */
export function arriveTurretRally(
  state: TurretDefenseState,
  m: TurretMonster,
  at: number,
  probe: ThrowProbe,
): void {
  const p = positionAt(m.seg, at, probe);
  const rally = rallyById(state, m.rally);
  if (!rally) {
    marchIn(state, m, at, p);
    return;
  }
  const scout = state.plan.kinds[m.kind].role === 'scout';
  if (rally.firstArrivalTick < 0 && !scout) rally.firstArrivalTick = state.tick;
  const first = rally.firstArrivalTick >= 0 ? rally.firstArrivalTick : state.tick;
  m.state = 'hold';
  m.seg = stillSegment(at, Math.max(0, turretRallyHoldEnd(rally, first) - at), p);
  m.facing = facingToward(p.x, p.z, state.cx, state.cz);
}

/**
 * A holder's stand ran out before its pack left (a cue held back by another rally's
 * departure): it stands on until the departure, or one gap more while none is set.
 */
export function holdOnTurretRally(
  state: TurretDefenseState,
  m: TurretMonster,
  at: number,
  probe: ThrowProbe,
): void {
  const p = positionAt(m.seg, at, probe);
  const rally = rallyById(state, m.rally);
  if (!rally) {
    marchIn(state, m, at, p);
    return;
  }
  const until = rally.departTick >= 0 ? rally.departTick : at + TURRET_RALLY.departGapTicks;
  m.seg = stillSegment(at, Math.max(1, until - at), p);
}

/** A thrown member back on its feet: back to its place while its pack gathers, else for the tower. */
export function riseTurretMonster(
  state: TurretDefenseState,
  m: TurretMonster,
  at: number,
  p: Vec,
): void {
  const rally = rallyById(state, m.rally);
  if (rally) musterTo(state, m, rally, at, p);
  else marchIn(state, m, at, p);
}

/** Drops a member's rally: from now on it goes for the tower at the pack's pace (a scout at its own). */
function release(
  state: TurretDefenseState,
  m: TurretMonster,
  rally: TurretRally,
  tick: number,
  probe: ThrowProbe,
): void {
  delete m.rally;
  delete m.slot;
  if (m.hp <= 0) return;
  if (state.plan.kinds[m.kind].role !== 'scout') m.pace = rally.pace;
  if (m.state === 'hold' || m.state === 'muster')
    marchIn(state, m, tick, positionAt(m.seg, tick, probe));
}

function dropRally(state: TurretDefenseState, rally: TurretRally, tick: number, probe: ThrowProbe) {
  for (const m of state.monsters) if (m.rally === rally.id) release(state, m, rally, tick, probe);
  state.rallies = state.rallies?.filter((r) => r !== rally);
  state.rev++;
}

/** The packs whose departure is due leave: every member goes for the tower. Runs before the bodies move. */
export function departTurretRallies(
  state: TurretDefenseState,
  tick: number,
  probe: ThrowProbe,
): void {
  const due = state.rallies?.filter((r) => r.departTick >= 0 && r.departTick <= tick);
  if (!due?.length) return;
  for (const rally of due) dropRally(state, rally, tick, probe);
}

/** Every member of the rally's pack spawned: its wave is behind, or its group's last spawn is. */
function allSpawned(state: TurretDefenseState, rally: TurretRally): boolean {
  const waveIndex = Math.floor(rally.id / TURRET_HUNT_LIMITS.packs);
  if (waveIndex < state.wave) return true;
  const wave = state.plan.waves[waveIndex];
  const g = wave ? turretPackGroup(wave, turretRallyPack(rally.id)) : -1;
  if (g < 0) return true;
  return (state.spawning[g]?.cursor ?? 0) >= wave.groups[g].count;
}

/** The plan kind of the rally's leader: only a monster of that kind may cry in its place. */
function leaderKindOf(state: TurretDefenseState, rally: TurretRally): number {
  const wave = state.plan.waves[Math.floor(rally.id / TURRET_HUNT_LIMITS.packs)];
  return wave ? turretPackLeaderKind(wave, turretPackGroup(wave, turretRallyPack(rally.id))) : -1;
}

/** A cue now would leave too close to another rally's departure. */
function departureCrowded(state: TurretDefenseState, rally: TurretRally, depart: number): boolean {
  return (state.rallies ?? []).some(
    (r) =>
      r !== rally &&
      r.departTick >= 0 &&
      Math.abs(r.departTick - depart) < TURRET_RALLY.departGapTicks,
  );
}

/**
 * The cues due this tick: a gathering rally whose living members all stand at it (every
 * one spawned), or whose hold timer ran out since its first arrival, cues now unless its
 * departure would crowd another's. The leader cries; fallen, the first living member of its
 * own kind cries in its place (the same voice), and with none the cue is silent (`id` -1).
 * A pack with no one left living closes. Runs after the bodies moved.
 */
export function cueTurretRallies(
  state: TurretDefenseState,
  tick: number,
  probe: ThrowProbe,
  events: TurretEvent[],
): void {
  const open = state.rallies?.filter((r) => r.cueTick < 0);
  if (!open?.length) return;
  for (const rally of open) {
    let living = 0;
    let standing = 0;
    let leader: TurretMonster | null = null;
    let heir: TurretMonster | null = null;
    const leaderKind = leaderKindOf(state, rally);
    for (const m of state.monsters) {
      if (m.rally !== rally.id || m.hp <= 0) continue;
      living++;
      if (m.state === 'hold') standing++;
      if (m.id === rally.leader) leader = m;
      if (m.kind === leaderKind && (!heir || m.id < heir.id)) heir = m;
    }
    const spawned = allSpawned(state, rally);
    if (living === 0) {
      if (spawned) dropRally(state, rally, tick, probe);
      continue;
    }
    const gathered = spawned && standing === living;
    const timedOut =
      rally.firstArrivalTick >= 0 && tick >= rally.firstArrivalTick + rally.holdTicks;
    if (!gathered && !timedOut) continue;
    const depart = tick + TURRET_RALLY.cueLeadTicks;
    if (departureCrowded(state, rally, depart)) continue;
    rally.cueTick = tick;
    rally.departTick = depart;
    state.rev++;
    const crier = leader ?? heir;
    events.push({
      type: 'rallyCue',
      rally: rally.id,
      id: crier ? crier.id : -1,
      x: rally.x,
      y: groundOr(probe, rally.x, rally.z, 0),
      z: rally.z,
      departTick: depart,
    });
  }
}
