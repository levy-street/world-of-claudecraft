// The Fire and Fly seat state as the self record carries it (one key family, see
// server/turret_self_wire.ts), for suites that feed the client mirror or the seat decoder
// without the per-session diff of server/game.ts: the family parsed, the cleared family,
// and the one seat object the client joins it back into.
import {
  TURRET_SEAT_KEYS,
  type TurretSeatWireSource,
  turretSeatWireParts,
  turretStateWireParts,
} from '../../server/turret_self_wire';
import { assembleTurretSeatWire } from '../../src/net/turret_session_wire';
import type { TurretSession } from '../../src/sim/types';

function parsed(parts: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(TURRET_SEAT_KEYS.map((key, i) => [key, JSON.parse(parts[i])]));
}

/** Every key of a left seat: explicit nulls. */
export const TURRET_SEAT_CLEARED: Readonly<Record<string, null>> = Object.freeze(
  Object.fromEntries(TURRET_SEAT_KEYS.map((key) => [key, null])),
);

/** A session's whole family at `tick`, parsed, as a session that never received it gets it. */
export function turretStateWireKeys(session: TurretSession, tick: number): Record<string, unknown> {
  return parsed(turretStateWireParts(session, tick));
}

/**
 * Any seat value (a view, a hand-built or a forged one) split as the server splits a seat,
 * its feedback ring and plan left out as the server leaves them.
 */
export function turretSeatKeys(seat: unknown): Record<string, unknown> {
  const {
    feedback: _ring,
    defense,
    ...rest
  } = seat as TurretSeatWireSource & {
    feedback?: unknown;
    defense: { plan?: unknown };
  };
  const { plan: _plan, ...state } = defense;
  return parsed(turretSeatWireParts({ ...rest, defense: state } as TurretSeatWireSource));
}

/** The one seat object the client joins the family back into, as JSON. */
export function turretStateWireJson(session: TurretSession, tick: number): string {
  return JSON.stringify(assembleTurretSeatWire(turretStateWireKeys(session, tick)));
}
