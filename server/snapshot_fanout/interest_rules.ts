// The interest-management rules of the snapshot broadcast, as pure functions
// over a minimal per-entity view, shared verbatim by the two build paths:
// the in-thread broadcastSnapshots loop in server/game.ts and the
// snapshot-fanout worker (worker_main.ts), which reads the same facts from
// the SharedArrayBuffer mirror instead of a live Entity. One source of truth
// means the paths cannot drift; tests/server/broadcast_golden.test.ts pins
// the in-thread path and tests/server/snapshot_fanout_equivalence.test.ts
// pins the worker path against it.
//
// Moved unchanged from server/game.ts (radii, hysteresis, rate tiers); the
// only difference is that Entity field reads became explicit inputs. The
// interest gate and the record ladder stay two separate steps so the
// in-thread path keeps serializing an entity lazily, only after the gate
// passes, exactly as before.

export const INTEREST_RADIUS = 90;
export const INTEREST_DROP_RADIUS = 100;
export const NPC_INTEREST_RADIUS = 120;
export const NPC_DROP_RADIUS = 130;
// One grid query radius covers every per-kind interest radius above.
export const INTEREST_QUERY_RADIUS = NPC_DROP_RADIUS;

export const FULL_RATE_RADIUS_SQ = 55 * 55;
export const HALF_RATE_RADIUS_SQ = 80 * 80;
export const HALF_RATE_DIVISOR = 2;
export const QUARTER_RATE_DIVISOR = 4;

// npcs stay visible to the legacy radius (see the constants above);
// everything else enters at INTEREST_RADIUS and known entities persist to
// the drop radius, hysteresis against churn at the boundary
export function interestLimitSqFor(isNpc: boolean, known: boolean): number {
  if (isNpc) {
    return known ? NPC_DROP_RADIUS * NPC_DROP_RADIUS : NPC_INTEREST_RADIUS * NPC_INTEREST_RADIUS;
  }
  return known ? INTEREST_DROP_RADIUS * INTEREST_DROP_RADIUS : INTEREST_RADIUS * INTEREST_RADIUS;
}

// The interest gate: is this visited entity inside the radius that applies to
// it? The viewer's current target stays in interest to the widest drop radius
// so its unit frame doesn't vanish mid-chase.
export function withinInterest(
  d2: number,
  isNpc: boolean,
  known: boolean,
  viewerTargetsEntity: boolean,
): boolean {
  const limitSq = viewerTargetsEntity
    ? NPC_DROP_RADIUS * NPC_DROP_RADIUS
    : interestLimitSqFor(isNpc, known);
  return d2 <= limitSq;
}

// full rate close up and for anything the viewer is fighting; mid range
// updates every other tick, far entities every fourth. Measured against
// the per-session last-sent tick rather than a tick-parity stagger: when
// the event loop degrades and one broadcast covers several sim ticks, a
// parity check can stay permanently false and starve entities frozen.
// isValeBall: the one Vale Cup ball is watched by the whole Sowfield and
// turns visibly steppy at half rate, so it is always due.
export function isUpdateDueFor(
  tick: number,
  d2: number,
  isValeBall: boolean,
  viewerTargetsEntity: boolean,
  entityAggroAtViewer: boolean,
  sentAtTick: number,
): boolean {
  if (isValeBall) return true;
  if (d2 <= FULL_RATE_RADIUS_SQ) return true;
  if (viewerTargetsEntity || entityAggroAtViewer) return true;
  const divisor = d2 <= HALF_RATE_RADIUS_SQ ? HALF_RATE_DIVISOR : QUARTER_RATE_DIVISOR;
  return tick - sentAtTick >= divisor;
}

// Per-session memory of what a client already knows about one entity. Owned
// by whichever path builds that session's snapshots (ClientSession.sentEnts
// in-thread; the worker's per-session map in the fanout).
export interface SentEntityVersions {
  idVer: number;
  dynVer: number;
  sentAtTick: number;
  // an unchanged entity owes one final "settle" record after its last change
  // so the client rests on the exact at-rest state
  settled: boolean;
}

export type EntityRecordAction = 'full' | 'lite' | 'keep';

// The record ladder for an entity that passed the interest gate and is
// already known to the session, mutating `known` exactly the way
// broadcastSnapshots always has (identity change -> rate gate -> settle
// bookkeeping). First sight is the caller's arm: it registers a fresh
// SentEntityVersions ({idVer, dynVer, sentAtTick: tick, settled: true},
// first sight carries the at-rest state exactly) and pushes a full record.
export function decideKnownRecord(
  tick: number,
  d2: number,
  known: SentEntityVersions,
  idVer: number,
  dynVer: number,
  isValeBall: boolean,
  viewerTargetsEntity: boolean,
  entityAggroAtViewer: boolean,
): EntityRecordAction {
  if (known.idVer !== idVer) {
    known.idVer = idVer;
    known.dynVer = dynVer;
    known.sentAtTick = tick;
    known.settled = false;
    return 'full';
  }
  if (
    !isUpdateDueFor(
      tick,
      d2,
      isValeBall,
      viewerTargetsEntity,
      entityAggroAtViewer,
      known.sentAtTick,
    ) ||
    (known.dynVer === dynVer && known.settled)
  ) {
    // not due at this distance tier yet, or unchanged and already
    // settled: a bare id keeps it alive on the client
    return 'keep';
  }
  // due, and either changed or owing its one settle record
  known.settled = known.dynVer === dynVer;
  known.dynVer = dynVer;
  known.sentAtTick = tick;
  return 'lite';
}
