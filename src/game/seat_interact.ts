// Sitting down on a seat from the pointer (the seats are src/sim/seat_anchor.ts; the sit
// command's own checks are src/sim/seating.ts). A click on a seat, with no entity under
// the pointer, picks the seat through the camera (render/seat_pick.ts) where the camera can
// see it, prefers a free place on the same piece of furniture when the clicked one is held,
// then either sits at once (the body already stands on the seat's stand spot) or walks the
// body there with click-to-move and sits on arrival. The hover cursor asks the same pick.
//
// Presentation-side only: the server re-checks every sit (seat, range, free), so nothing
// here decides an outcome; it only saves a refused round trip where the answer is known.

import type { SeatRayHit } from '../render/seat_pick_core';
import { lineOfSightClear, SIGHT_HEIGHT } from '../sim/colliders';
import { SEAT_REACH, type SeatAnchor, type SeatedBodyLike, seatHolder } from '../sim/seat_anchor';
import { activeSeats } from '../sim/seat_registry';
import type { Entity } from '../sim/types';

/** Close enough to a stand spot to sit without a step. */
export const SEAT_SIT_NOW = 0.45;
/** How far away a seat may be for the click to walk there (a room's width, never a trek). */
export const SEAT_WALK_MAX = 40;
/** A walk to a seat that has not arrived after this long is dropped. */
export const SEAT_WALK_TIMEOUT_MS = 20000;
/** How long the body stands still on arrival before the sit is sent. Online the server runs
 *  a command the moment it lands but plays movement frames out of a short queue, one a
 *  tick (server/movement_input_timeline_v2.ts): a sit sent with the last walking frames
 *  still queued would be stood up by them. Past this settle every one has played. */
export const SEAT_SIT_SETTLE_MS = 400;

/** The seat a click should take: the clicked one when free, else the free place of the same
 *  furniture nearest the click, else null (the whole piece is taken). */
export function chooseSeatForClick<E extends SeatedBodyLike>(
  seats: readonly SeatAnchor[],
  hit: { seat: SeatAnchor; x: number; z: number },
  bodies: Iterable<E>,
  selfId: number,
): SeatAnchor | null {
  const list = [...bodies];
  const free = (s: SeatAnchor): boolean => seatHolder(list, s, selfId) === null;
  if (free(hit.seat)) return hit.seat;
  let best: SeatAnchor | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const s of seats) {
    if (s.group !== hit.seat.group || s === hit.seat || !free(s)) continue;
    const d = Math.hypot(s.x - hit.x, s.z - hit.z);
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

export interface SeatInteractionDeps {
  world: {
    player: Entity;
    playerId: number;
    entities: ReadonlyMap<number, Entity>;
    cfg: { seed: number };
    riftCollisionToken: number;
    sitOnSeat(seatId: string): void;
  };
  /** The seat under a screen point through the live camera, with the camera's position. */
  pick(x: number, y: number): { hit: SeatRayHit; eye: { x: number; y: number; z: number } } | null;
  /** Walk the body to a floor point; returns the goal object click-to-move now follows. */
  walkTo(target: { x: number; z: number }): object;
  /** The goal click-to-move is following, or null when it is idle. */
  clickMoveGoal(): object | null;
  showError(text: string): void;
  /** The localized refusal lines (resolved at the moment they show). */
  errorText(kind: 'seatTaken' | 'tooFar' | 'dead'): string;
  now(): number;
}

export interface SeatInteraction {
  /** Handle a click at a screen point: true when a seat took it. */
  click(x: number, y: number): boolean;
  /** Whether a seat the camera can see is under a screen point (the hover cursor). */
  hover(x: number, y: number): boolean;
  /** Per frame: sit on arrival from a walk to a seat. */
  tick(): void;
}

/** How far the body may drift while it settles before the sit is dropped (a deliberate step
 *  away cancels it; the server's own correction of a stop never gets this far). */
const SEAT_SETTLE_DRIFT = 0.3;

const arrivedHere = (e: { pos: { x: number; z: number } }) => ({
  arrivedX: e.pos.x,
  arrivedZ: e.pos.z,
});

export function createSeatInteraction(deps: SeatInteractionDeps): SeatInteraction {
  let pending: {
    seatId: string;
    /** The click-to-move goal while walking there; null once arrived. */
    goal: object | null;
    stand: { x: number; z: number };
    at: number;
    /** When and where the body arrived (the settle's start); a step off it drops the sit. */
    arrivedAt: number | null;
    arrivedX: number;
    arrivedZ: number;
  } | null = null;

  const visible = (x: number, y: number): SeatRayHit | null => {
    const picked = deps.pick(x, y);
    if (!picked) return null;
    const { hit, eye } = picked;
    // the seat must be seen, not picked through a wall: sight from the camera to just
    // short of the seat surface, at those heights
    const back = 0.15;
    const dx = hit.x - eye.x;
    const dy = hit.y - eye.y;
    const dz = hit.z - eye.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const to = {
      x: hit.x - (dx / len) * back,
      y: hit.y - (dy / len) * back,
      z: hit.z - (dz / len) * back,
    };
    const seen = lineOfSightClear(
      deps.world.cfg.seed,
      eye,
      to,
      0.05,
      undefined,
      deps.world.riftCollisionToken,
      { from: eye.y - SIGHT_HEIGHT, to: to.y - SIGHT_HEIGHT },
    );
    return seen ? hit : null;
  };

  const sitNow = (seat: SeatAnchor): void => {
    pending = null;
    deps.world.sitOnSeat(seat.id);
  };

  return {
    click(x, y) {
      const hit = visible(x, y);
      if (!hit) return false;
      const w = deps.world;
      const p = w.player;
      if (p.dead) {
        deps.showError(deps.errorText('dead'));
        return true;
      }
      const seat = chooseSeatForClick(activeSeats(), hit, w.entities.values(), w.playerId);
      if (!seat) {
        deps.showError(deps.errorText('seatTaken'));
        return true;
      }
      const d = Math.hypot(p.pos.x - seat.standX, p.pos.z - seat.standZ);
      if (d > SEAT_WALK_MAX) {
        deps.showError(deps.errorText('tooFar'));
        return true;
      }
      const stand = { x: seat.standX, z: seat.standZ };
      const now = deps.now();
      // already on the spot: settle, then sit; else walk there first
      pending =
        d <= SEAT_SIT_NOW
          ? { seatId: seat.id, goal: null, stand, at: now, arrivedAt: now, ...arrivedHere(p) }
          : {
              seatId: seat.id,
              goal: deps.walkTo(stand),
              stand,
              at: now,
              arrivedAt: null,
              ...arrivedHere(p),
            };
      return true;
    },
    hover(x, y) {
      return visible(x, y) !== null;
    },
    tick() {
      if (!pending) return;
      const w = deps.world;
      if (w.player.dead || deps.now() - pending.at > SEAT_WALK_TIMEOUT_MS) {
        pending = null;
        return;
      }
      const goal = deps.clickMoveGoal();
      if (pending.goal !== null) {
        if (goal === pending.goal) return; // still walking there
        pending.goal = null;
        pending.arrivedAt = deps.now();
        Object.assign(pending, arrivedHere(w.player));
        // steered elsewhere (a new click, a key): drop it
        if (goal !== null) {
          pending = null;
          return;
        }
      } else if (goal !== null) {
        pending = null; // walking off while settling
        return;
      }
      const p = w.player.pos;
      const near = Math.hypot(p.x - pending.stand.x, p.z - pending.stand.z) <= SEAT_REACH - 0.2;
      const seat = activeSeats().find((s) => s.id === pending?.seatId);
      const stepped =
        Math.hypot(p.x - pending.arrivedX, p.z - pending.arrivedZ) > SEAT_SETTLE_DRIFT;
      if (!near || !seat || stepped) {
        pending = null;
        return;
      }
      if (deps.now() - (pending.arrivedAt ?? 0) >= SEAT_SIT_SETTLE_MS) sitNow(seat);
    },
  };
}
