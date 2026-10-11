// /dev ferry: skip the ferry timetable's waits for a playtest or a screenshot
// (ALLOW_DEV_COMMANDS only: handleDevChat is reached through the
// ctx.devCommands gate like every /dev branch). It moves only the dev-only
// schedule offset (ctx.transportClockOffset), never sim time, so every ship,
// its passengers and the deck gates all follow the same jumped clock (one
// clock for every route: a jump for one route moves the other too).
//
//   /dev ferry [route]            where that ferry is and what comes next
//   /dev ferry [route] depart     3 seconds before its next departure
//   /dev ferry [route] skip       1 second before its next phase change
//   /dev ferry [route] at <s>     its cycle position <s> seconds after its
//                                 first berth's boarding window opens
//   /dev ferry [route] board      onto its ship's waist deck, wherever it is
//                                 (a voyage in progress included)
//   /dev ferry goto <berth>       onto a berth's pier (its landing spot)
//
// [route] names a route by either of its berths (eastbrook, nightbloom,
// wickharbor, drakelands) or by number (1, 2); without it, the route the
// player rides, else the nearest one (the same pick as the HUD).
//
// A jump carries whoever stands aboard to the same deck spot at the ship's
// new pose (transport_ferry.ts carryPassengersAcrossClockJump), so skipping
// ahead mid-voyage keeps its passengers on deck.

import { TRANSPORT_ROUTES } from '../content/transport_ships';
import { ferryViewRouteIndex, transportRouteIndex } from '../ferry_view_route';
import type { SimContext } from '../sim_context';
import { settleTeleportArrival } from '../teleport_arrival';
import {
  carryPassengersAcrossClockJump,
  ferryBoardingSpot,
  transportClock,
} from '../transport_ferry';
import {
  type TransportRouteDef,
  transportCycleSeconds,
  transportPhaseAt,
} from '../transport_schedule';
import { displacePlayerForDev } from './dev_displace';

/** Seconds from `clock` to the start of `route`'s next phase of the given
 *  kind (any kind when `phase` is omitted), scanning at most two cycles. */
function secondsToNextPhase(
  route: TransportRouteDef,
  clock: number,
  phase?: string,
): number | null {
  let t = clock;
  let cur = transportPhaseAt(route, t);
  const limit = clock + 2 * transportCycleSeconds(route);
  while (t < limit) {
    t += cur.remaining + 1e-6;
    const next = transportPhaseAt(route, t);
    if (next.phase !== cur.phase && (phase === undefined || next.phase === phase)) {
      return t - clock;
    }
    cur = next;
  }
  return null;
}

function status(ctx: SimContext, route: TransportRouteDef): string {
  const s = transportPhaseAt(route, transportClock(ctx));
  const berth = route.berths[s.berth].id;
  return `[dev] Ferry ${route.id}: ${s.phase} (${berth}), ${s.remaining.toFixed(1)}s left in this phase.`;
}

/** Put a player at (x, z), then at height y when given (dev only). */
function placeForDev(ctx: SimContext, pid: number, x: number, z: number, y?: number): void {
  const p = ctx.entities.get(pid);
  if (!p) return;
  displacePlayerForDev(ctx, p, x, z);
  if (y !== undefined) p.pos.y = y;
  p.prevPos = { ...p.pos };
  settleTeleportArrival(p);
}

const USAGE =
  '[dev] /dev ferry [route] [depart | skip | at <s> | board], or /dev ferry goto <berth>';

/** The route a token names (a berth id or a 1-based number), or -1. */
function routeByToken(token: string): number {
  const n = Number(token);
  if (Number.isInteger(n) && n >= 1 && n <= TRANSPORT_ROUTES.length) return n - 1;
  return TRANSPORT_ROUTES.findIndex((r) => r.berths.some((b) => b.id === token));
}

/** Handle a /dev ferry line; true when it was one (the caller returns). */
export function handleFerryDevChat(ctx: SimContext, raw: string, pid: number): boolean {
  const m = /^\/(?:dev\s+ferry|devferry)((?:\s+[\w.-]+){0,3})\s*$/i.exec(raw);
  if (!m) return false;
  if (TRANSPORT_ROUTES.length === 0) return true;
  const words = m[1].trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words[0] === 'goto') {
    const berth = TRANSPORT_ROUTES.flatMap((r) => r.berths).find((b) => b.id === words[1]);
    if (berth) placeForDev(ctx, pid, berth.landing.x, berth.landing.z);
    else ctx.emit({ type: 'log', text: USAGE, pid });
    return true;
  }
  const p = ctx.entities.get(pid);
  const clock = transportClock(ctx);
  let index = words.length > 0 ? routeByToken(words[0]) : -1;
  if (index >= 0) words.shift();
  else {
    const riding = transportRouteIndex(p?.ferryRide?.route);
    index = ferryViewRouteIndex(clock, p?.pos.x ?? 0, p?.pos.z ?? 0, riding);
  }
  const route = TRANSPORT_ROUTES[index];
  const verb = words[0];
  if (verb === 'depart' || verb === 'skip') {
    const until = secondsToNextPhase(route, clock, verb === 'depart' ? 'sailing' : undefined);
    if (until !== null) ctx.transportClockOffset += until - (verb === 'depart' ? 3 : 1);
  } else if (verb === 'at') {
    const cycle = transportCycleSeconds(route);
    const want = Math.min(cycle, Math.max(0, Number(words[1] ?? 0) || 0));
    ctx.transportClockOffset = want - ctx.time;
  } else if (verb === 'board') {
    const spot = ferryBoardingSpot(ctx, index);
    if (spot) placeForDev(ctx, pid, spot.x, spot.z, spot.y);
  } else if (verb !== undefined) {
    ctx.emit({ type: 'log', text: USAGE, pid });
    return true;
  }
  if (transportClock(ctx) !== clock) carryPassengersAcrossClockJump(ctx, clock);
  ctx.emit({ type: 'log', text: status(ctx, route), pid });
  return true;
}
