// The Gauntlet podium ceremony. Once the Final Court crowns a champion the run
// enters its podium phase (GAUNTLET.podiumS seconds); this module poses the top
// three finishers on the three-step winners' stand behind the staging plaza
// (1st on the gold centre step, 2nd on silver, 3rd on bronze) and re-asserts
// those poses each tick so the tableau holds through the ceremony, then endRun
// sends everyone home.
//
// Positions derive from the SAME GAUNTLET_LAYOUT.podium anchors the renderer
// builds the steps from and venue_physics blocks with a collider, so an occupant
// stands exactly on the step you see. Pure placement: no rng, so an active
// ceremony never perturbs the world's global draw order.

import { GAUNTLET_LAYOUT } from '../content/gauntlet';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import type { GauntletContestant, GauntletPodiumSeat, GauntletRun } from './state';

// Seat the top finishers on the podium steps. `ranked` is the podium order
// (players first, then surviving NPCs, then the fallen); only the first three
// whose entity still exists take a step (a knocked-out NPC is despawned and
// simply leaves its step empty). Teleports each occupant onto its step now and
// records the poses on the run for holdPodiumOccupants to re-assert.
export function seatPodium(ctx: SimContext, run: GauntletRun, ranked: GauntletContestant[]): void {
  const P = GAUNTLET_LAYOUT.podium;
  const seats: GauntletPodiumSeat[] = [];
  for (let i = 0; i < P.steps.length; i++) {
    const c = ranked[i];
    if (!c) break;
    const e = ctx.entities.get(c.entityId);
    if (!e) continue;
    const step = P.steps[i];
    const wx = run.origin.x + step.x;
    const wz = run.origin.z + P.z;
    // The step top sits baseH + step.h above the venue floor; groundPos gives
    // the floor at this point (flat band, but resolved through the same helper
    // every gauntlet placement uses).
    const wy = ctx.groundPos(wx, wz).y + P.baseH + step.h;
    const seat: GauntletPodiumSeat = { entityId: c.entityId, x: wx, y: wy, z: wz, facing: 0 };
    seats.push(seat);
    placeOnSeat(ctx, e, seat);
  }
  run.podiumSeats = seats;
}

// Re-assert each seat's pose (the end-of-tick pin, mirroring holdStagedPlayers):
// the champion's own movement and the collider ejection off the podium block
// both run earlier in the tick, so this snaps every occupant back before the
// frame is broadcast. Skips a seat whose entity has left the world.
export function holdPodiumOccupants(ctx: SimContext, run: GauntletRun): void {
  if (!run.podiumSeats) return;
  for (const seat of run.podiumSeats) {
    const e = ctx.entities.get(seat.entityId);
    if (e) placeOnSeat(ctx, e, seat);
  }
}

// Drop a leaving player's seat so holdPodiumOccupants stops yanking their entity
// back to the podium after they have been sent home mid-ceremony.
export function releasePodiumSeat(run: GauntletRun, pid: number): void {
  if (run.podiumSeats) run.podiumSeats = run.podiumSeats.filter((s) => s.entityId !== pid);
}

// Snap an entity onto a seat: position + facing, with prevPos/prevFacing matched
// so it reads as a held pose (no interpolated slide across the map).
function placeOnSeat(ctx: SimContext, e: Entity, seat: GauntletPodiumSeat): void {
  e.pos.x = seat.x;
  e.pos.y = seat.y;
  e.pos.z = seat.z;
  e.prevPos = { x: seat.x, y: seat.y, z: seat.z };
  e.facing = seat.facing;
  e.prevFacing = seat.facing;
  ctx.rebucket(e);
}
