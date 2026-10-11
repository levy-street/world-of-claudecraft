// The online client's half of the scheduled ferry (src/sim/transport_ferry.ts
// is the authority). Two things ride the wire:
//  - the snapshot head's `time` (every snapshot already carries it) is the
//    schedule clock, unless a dev skip is active on the server, in which case
//    the head adds `fc` (the offset clock; server/transport_head.ts);
//  - a passenger's `fry`: their spot on the moving deck in the hull's frame,
//    [route index, x, y, z, heading off the bow], taken at the same tick as
//    their world x/y/z (server transport_head.ts ferryDeckWire).
// From the clock the ClientWorld derives the same phase and ship pose the
// server runs (transport_schedule.ts) and re-applies the berth gates to its
// own collider grid, so the renderer's seating and the local prediction see
// the moored deck where the server does. The deck spot is mirrored twice, the
// newest and the one being interpolated from (re-anchored exactly like
// prevPos), so the renderer draws every deck-bound body in the ship's frame:
// a passenger walking the deck never slides against it while it sails.
//
// The decoded clock lives in a WeakMap keyed by the world (one entry per
// ClientWorld, collected with it), so online.ts carries no field for it.
// DOM-free and socket-free.

import { setColliderGateOpen } from '../sim/colliders';
import { TRANSPORT_ROUTES } from '../sim/content/transport_ships';
import { ferryViewRouteIndex } from '../sim/ferry_view_route';
import { syncTransportGates } from '../sim/transport_gates';
import {
  angleDelta,
  emptyTransportFerryView,
  type TransportFerryView,
  transportFerryViewAt,
} from '../sim/transport_schedule';
import type { Entity, FerryDeckMirror } from '../sim/types';
import { WATER_LEVEL } from '../sim/world';

/** What the decode needs from the world: its seed and its own player. */
export interface TransportWireWorld {
  cfg: { seed: number };
  player: Entity | undefined;
}

interface ClientTransportState {
  clock: number;
  views: TransportFerryView[] | null;
}

const states = new WeakMap<object, ClientTransportState>();

function stateFor(world: object): ClientTransportState {
  let st = states.get(world);
  if (!st) {
    st = { clock: 0, views: null };
    states.set(world, st);
  }
  return st;
}

/** The schedule clock a snapshot head carries (`fc` when a dev skip is on,
 *  else `time`), or null when the frame carries neither as a finite number. */
export function transportClockFromHead(snap: Readonly<Record<string, unknown>>): number | null {
  const fc = snap.fc;
  if (typeof fc === 'number' && Number.isFinite(fc)) return fc;
  const time = snap.time;
  if (typeof time === 'number' && Number.isFinite(time)) return time;
  return null;
}

/** Decode one snapshot head: record the clock, re-apply the berth gates. */
export function applyTransportSnapshot(
  world: TransportWireWorld,
  snap: Readonly<Record<string, unknown>>,
): void {
  const clock = transportClockFromHead(snap);
  if (clock === null) return;
  stateFor(world).clock = clock;
  syncTransportGates(world.cfg.seed, clock, setColliderGateOpen);
}

/** Parse a `fry` wire value into a deck spot, or null when absent or bad. */
export function parseFerryDeck(fry: unknown): FerryDeckMirror | null {
  if (!Array.isArray(fry) || fry.length !== 5) return null;
  const [route, x, y, z, f] = fry as unknown[];
  if (typeof route !== 'number' || !Number.isSafeInteger(route) || route < 0) return null;
  if (route >= TRANSPORT_ROUTES.length) return null;
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  if (typeof z !== 'number' || typeof f !== 'number') return null;
  if (!Number.isFinite(x + y + z + f)) return null;
  return { route, x, y, z, f };
}

/**
 * Decode an entity's `fry` onto its deck mirrors. `alpha` is the same
 * re-anchor alpha ClientWorld.applyWire moves prevPos by (a negative alpha,
 * or a spot on another route, snaps): the interpolation restarts from where
 * the body was drawn on the deck, never from a stale spot.
 */
export function applyFerryWire(e: Entity, fry: unknown, alpha: number): void {
  const next = parseFerryDeck(fry);
  e.ferryRiding = next !== null;
  if (!next) {
    e.ferryDeck = null;
    e.ferryDeckPrev = null;
    return;
  }
  const cur = e.ferryDeck;
  const prev = e.ferryDeckPrev;
  if (alpha < 0 || !cur || !prev || cur.route !== next.route || prev.route !== next.route) {
    e.ferryDeckPrev = { ...next };
  } else {
    const a = Math.min(1.25, alpha);
    e.ferryDeckPrev = {
      route: next.route,
      x: prev.x + (cur.x - prev.x) * a,
      y: prev.y + (cur.y - prev.y) * a,
      z: prev.z + (cur.z - prev.z) * a,
      f: prev.f + angleDelta(prev.f, cur.f) * Math.min(1, a),
    };
  }
  e.ferryDeck = next;
}

/** ClientWorld.ferryView at the last snapshot's clock: the route the player
 *  rides (their deck mirror names it), else the nearest one, the same pick
 *  as the offline Sim (sim/ferry_view_route.ts). */
export function clientFerryView(world: TransportWireWorld): TransportFerryView | null {
  const st = stateFor(world);
  const p = world.player;
  const riding = p?.ferryRiding === true ? (p.ferryDeck?.route ?? -1) : -1;
  const i = ferryViewRouteIndex(st.clock, p?.pos.x ?? 0, p?.pos.z ?? 0, riding);
  const route = TRANSPORT_ROUTES[i];
  if (!route) return null;
  st.views ??= TRANSPORT_ROUTES.map((r) => emptyTransportFerryView(r));
  return transportFerryViewAt(route, st.clock, WATER_LEVEL, riding === i, st.views[i]);
}
