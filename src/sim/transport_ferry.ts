// The scheduled ferry's passengers (Phases 2 and 3 of the Eastbrook ferry):
// who sails, how the moving deck carries them, and where they step off. The
// timetable itself is the pure transport_schedule.ts; the moored deck's
// colliders are gated by transport_gates.ts; the deck under way is the
// kinematic platform in transport_deck.ts. This module is the SimContext
// system that ties them to the players, run once at the top of every tick
// (`updateTransportFerries`, before any player moves), plus the platform the
// movement kernel stands them on (`ferryDeckPlatform`).
//
// The rules, all derived from the schedule clock (ctx.time plus the dev-only
// ctx.transportClockOffset):
//  - Carrying: every tick the ship's pose changes (it is under way, or has
//    just cast off or moored), a player aboard it where it was last tick
//    (standing on its deck, or in the air over its hull) is carried rigidly
//    to the same spot at this tick's pose (transport_deck.ts carryWithDeck).
//    Their own movement then runs on the deck like on any floor: input moves
//    them relative to it, they jump, climb the quarterdeck stair, lean on the
//    rails. Corpses ride too. A passenger who walks off the port gangway
//    opening falls into the sea where they are and is left behind.
//  - Casting off: anyone still on the gangway step or gangplank is set down
//    on the pier (the gear is stowed), so nobody drops into the water as the
//    ship leaves, and so is a corpse or a spirit on deck (the dead do not
//    sail: the body stays where its ghost will look for it). Everyone else
//    aboard becomes a passenger: dismounted, their pet parked for the voyage
//    (the delve pet-park round trip; pets do not walk the moving deck).
//  - Under way, a passenger's forced movement modes (a Charge, a leap, a
//    ledge climb, /follow) are dropped, and a feared passenger cowers where
//    they stand instead of running: those modes steer by the static world
//    and would carry a body straight off the deck. Fighting aboard is
//    allowed (a fighter is not set down), the ship simply outruns the mobs.
//  - Mooring: the passengers' ride ends where they stand on the moored deck,
//    their pet returns (on the pier), and a voyage from the other harbor
//    marks their Book of Deeds (the ferry deed takes both directions).
//  - A passenger who releases their spirit leaves the ride; their corpse is
//    carried to the destination pier. A spirit that reaches a sailing deck
//    rides like anyone, and moves no corpse that is not on that deck.
//  - A save taken aboard (logout, autosave) records the destination pier, and
//    a save taken on a docked deck records that berth's pier, so a later
//    login never lands in the sea (`ferrySavePosition`). A linkdead
//    passenger simply rides on and resumes wherever the ship has got to.
//
// Draws ZERO rng; iterates players in roster order; `src/sim`-pure. Holds no
// state: the carry reads the ship at this tick's clock and one tick before
// (a dev clock jump carries its passengers itself, dev/ferry_dev.ts), and the
// per-world deck platforms and pose memos below are caches of the clock.

import type { Collider } from './colliders';
import { setColliderGateOpen } from './colliders';
import { SHARED_FEAR_AURA_ID } from './combat/cc';
import { finishChargeArrival } from './combat/charge_route';
import { cancelValkyrsCalling } from './combat/paladin_valkyrs_calling';
import { TRANSPORT_ROUTES, TRANSPORT_SHIP_HULLS } from './content/transport_ships';
import { isBuiltinWorldActive } from './data';
import { markVisited } from './deeds';
import { ferryViewRouteIndex, transportRouteIndex } from './ferry_view_route';
import { forceDismount } from './mounts';
import { petOf, restorePetFromDelveStash, stowPetForDelve } from './pet/pet_commands';
import { type PlayerMotionDeps, stepPlayerMotion } from './player_motion';
import type { SimContext } from './sim_context';
import { settleTeleportArrival } from './teleport_arrival';
import { aboardDeck, carryWithDeck, DeckPlatform, nearDeck } from './transport_deck';
import { syncTransportGates } from './transport_gates';
import {
  emptyTransportFerryView,
  newTransportPhaseState,
  type TransportFerryView,
  type TransportPose,
  type TransportRouteDef,
  transportFerryViewAt,
  transportShipPoseAt,
} from './transport_schedule';
import { type ShipHullLayout, shipToWorld, worldToShip } from './transport_ship';
import { DT, type Entity, emptyMoveInput, type MoveInput } from './types';
import { WATER_LEVEL } from './world';

/** How far outside a boarding volume (gangway, gangplank) still counts as on it. */
const BOARDING_MARGIN = 0.6;
/** Ticks between the checks for a pet summoned mid-voyage (one a second). */
const PET_SWEEP_TICKS = 20;

/** The schedule clock: sim seconds plus the dev-only skip offset. */
export function transportClock(ctx: SimContext): number {
  return ctx.time + ctx.transportClockOffset;
}

function hullFor(route: TransportRouteDef): ShipHullLayout | null {
  return Object.hasOwn(TRANSPORT_SHIP_HULLS, route.ship) ? TRANSPORT_SHIP_HULLS[route.ship] : null;
}

/** Is the body on a boarding volume (the gangway step or gangplank)? */
function onBoardingGear(hull: ShipHullLayout, pose: TransportPose, e: Entity): boolean {
  const local = worldToShip({ ...pose, baseY: WATER_LEVEL }, e.pos.x, e.pos.z);
  const above = e.pos.y - WATER_LEVEL;
  if (above < hull.mainDeckY - 2 || above > hull.mainDeckY + 3) return false;
  for (const v of hull.volumes) {
    if (v.kind !== 'gangway' && v.kind !== 'gangplank') continue;
    const hw = (v.hw ?? 0.5) + BOARDING_MARGIN;
    const hd = (v.hd ?? 0.5) + BOARDING_MARGIN;
    if (Math.abs(local.x - v.x) <= hw && Math.abs(local.z - v.z) <= hd) return true;
  }
  return false;
}

/** Put a player down on a berth's pier (no log line: the HUD explains). */
function setDown(ctx: SimContext, p: Entity, landing: { x: number; z: number; facing: number }) {
  p.pos = ctx.groundPos(landing.x, landing.z);
  p.prevPos = { ...p.pos };
  ctx.rebucket(p);
  p.facing = landing.facing;
  settleTeleportArrival(p);
}

/** A player just carried off a berth becomes a passenger of this voyage. */
function startRide(ctx: SimContext, route: TransportRouteDef, p: Entity, from: number): void {
  p.ferryRide = { route: route.id, from, to: 1 - from, ship: { ...poseNow } };
  forceDismount(ctx, p);
  if (petOf(ctx, p.id, true)) parkPet(ctx, p);
}

function parkPet(ctx: SimContext, p: Entity): void {
  stowPetForDelve(ctx, p.id);
  p.ferryPetParked = true;
}

/** Movement modes that steer by the static world never run on a moving
 *  deck: a Charge in flight ends short (its arrival hooks settle as a miss,
 *  the path the mover would take for a runner cut off), and a leap, a climb,
 *  a Valkyr's Calling flight and a /follow end where they are. */
function dropForcedMovement(ctx: SimContext, p: Entity): void {
  if (p.chargeTargetId !== null) {
    finishChargeArrival(ctx, p, ctx.entities.get(p.chargeTargetId) ?? null, false);
    p.chargeTargetId = null;
  }
  if (p.chargePath.length > 0) p.chargePath = [];
  p.leap = null;
  p.climb = null;
  cancelValkyrsCalling(ctx, p);
  p.followTargetId = null;
}

function endRide(ctx: SimContext, p: Entity): void {
  delete p.ferryRide;
  returnParkedPet(ctx, p);
}

/**
 * Bring a pet the ferry parked back, once its owner is off the ship and
 * alive (a pet is never handed to a corpse or a spirit: it waits for the
 * revive). An owner standing on a moored deck gets it on that berth's pier,
 * where a pet can stand; anywhere else, beside the owner.
 */
function returnParkedPet(ctx: SimContext, p: Entity): void {
  if (!p.ferryPetParked || p.ferryRide || p.dead) return;
  delete p.ferryPetParked;
  restorePetFromDelveStash(ctx, p.id);
  const pet = petOf(ctx, p.id, true);
  if (!pet) return;
  for (const route of TRANSPORT_ROUTES) {
    const hull = hullFor(route);
    if (!hull) continue;
    for (const b of route.berths) {
      if (!aboardDeck(hull, b, WATER_LEVEL, p.pos.x, p.pos.y, p.pos.z)) continue;
      pet.pos = ctx.groundPos(b.landing.x, b.landing.z);
      pet.prevPos = { ...pet.pos };
      ctx.rebucket(pet);
      return;
    }
  }
}

const phaseNow = newTransportPhaseState();
const phasePrev = newTransportPhaseState();
const poseNow: TransportPose = { x: 0, z: 0, rot: 0 };
const posePrev: TransportPose = { x: 0, z: 0, rot: 0 };

/** Apply this world's schedule to its deck gates (colliders.ts), so queries
 *  made before the first tick (construction-time placement) see this world's
 *  berths, never whatever another world in the process left behind. */
export function syncFerryGates(ctx: SimContext): void {
  if (!isBuiltinWorldActive()) return;
  syncTransportGates(ctx.cfg.seed, transportClock(ctx), setColliderGateOpen);
}

/** The per-tick ferry system (called at the top of Sim.tick). */
export function updateTransportFerries(ctx: SimContext): void {
  if (!isBuiltinWorldActive()) return;
  const clock = transportClock(ctx);
  syncTransportGates(ctx.cfg.seed, clock, setColliderGateOpen);
  for (const route of TRANSPORT_ROUTES) {
    const hull = hullFor(route);
    if (!hull) continue;
    transportShipPoseAt(route, clock, poseNow, phaseNow);
    transportShipPoseAt(route, clock - DT, posePrev, phasePrev);
    const sailing = phaseNow.phase === 'sailing';
    const moving = sailing || phasePrev.phase === 'sailing';
    const castingOff = sailing && phasePrev.phase === 'docked';
    for (const meta of ctx.players.values()) {
      const p = ctx.entities.get(meta.entityId);
      if (!p) continue;
      if (p.ferryPetParked) returnParkedPet(ctx, p);
      const ride = p.ferryRide?.route === route.id ? p.ferryRide : null;
      const corpse = p.corpsePos;
      if (
        ride &&
        p.ghost &&
        corpse &&
        aboardDeck(hull, posePrev, WATER_LEVEL, corpse.x, corpse.y, corpse.z)
      ) {
        // released aboard: the spirit went to its graveyard, and the body the
        // ship carried is set down on the destination pier. Only a corpse on
        // this deck: a spirit that boards under way just rides, and a body left
        // on land stays where it fell.
        const to = route.berths[ride.to].landing;
        p.corpsePos = ctx.groundPos(to.x, to.z);
        endRide(ctx, p);
        continue;
      }
      if (!moving) {
        // moored, and nothing moved it: a voyage still open here is stale (a
        // dev clock jump onto a docked phase), over where they stand
        if (ride) endRide(ctx, p);
        continue;
      }
      // the cheap distance gate first: the whole realm walks this loop while
      // the ship moves, and only a handful are anywhere near it
      const aboard =
        nearDeck(hull, posePrev, p.pos.x, p.pos.z) &&
        aboardDeck(hull, posePrev, WATER_LEVEL, p.pos.x, p.pos.y, p.pos.z);
      if (castingOff && !ride && (onBoardingGear(hull, posePrev, p) || (aboard && p.dead))) {
        setDown(ctx, p, route.berths[phaseNow.from].landing);
        continue;
      }
      if (!aboard) {
        // walked off the gangway opening, or moved away by something else
        if (ride) endRide(ctx, p);
        continue;
      }
      carryWithDeck(posePrev, poseNow, p);
      if (sailing) {
        if (ride) {
          Object.assign(ride.ship, poseNow);
          // a pet called up mid-voyage goes back to the stash within the
          // second (pets do not walk a moving deck; it returns on the far
          // pier with the rest). Once a second: petOf walks every entity.
          // Staggered by id, so the passengers' entity scans spread over the
          // second instead of landing on one tick.
          const sweep = (ctx.tickCount + p.id) % PET_SWEEP_TICKS === 0;
          if (sweep && petOf(ctx, p.id, true)) parkPet(ctx, p);
        } else startRide(ctx, route, p, phaseNow.from);
        dropForcedMovement(ctx, p);
        continue;
      }
      // moored this tick: the voyage is over where they stand (this route's
      // ride only: a rider of the other ship put on this deck earns nothing)
      const done = ride;
      if (done && !p.dead && phaseNow.berth === done.to) {
        const from = route.berths[done.from].id;
        markVisited(ctx, meta, `ferry:${from}_${route.berths[done.to].id}`);
      }
      endRide(ctx, p);
    }
  }
}

// ---------------------------------------------------------------------------
// The deck under way, for the movement kernel
// ---------------------------------------------------------------------------

interface DeckState {
  clock: number;
  sailing: boolean[];
  poses: TransportPose[];
  platforms: DeckPlatform[];
}

// Per world: each route's deck platform and its pose at the last clock asked
// about. Caches of the clock (a pure function of it), never state.
const decks = new WeakMap<SimContext, DeckState>();
const kernelPhase = newTransportPhaseState();

function deckStateAt(ctx: SimContext, clock: number): DeckState {
  let st = decks.get(ctx);
  if (!st) {
    st = { clock: Number.NaN, sailing: [], poses: [], platforms: [] };
    decks.set(ctx, st);
    for (const route of TRANSPORT_ROUTES) {
      const hull = hullFor(route);
      st.platforms.push(new DeckPlatform(hull ?? { ...emptyHull }));
      st.poses.push({ x: 0, z: 0, rot: 0 });
      st.sailing.push(false);
    }
  }
  if (st.clock !== clock) {
    st.clock = clock;
    for (let i = 0; i < TRANSPORT_ROUTES.length; i++) {
      const route = TRANSPORT_ROUTES[i];
      transportShipPoseAt(route, clock, st.poses[i], kernelPhase);
      st.sailing[i] = kernelPhase.phase === 'sailing' && hullFor(route) !== null;
    }
  }
  return st;
}

const emptyHull: ShipHullLayout = {
  id: '',
  mainDeckY: 0,
  captainDeckY: 0,
  forecastleY: 0,
  railHeight: 0,
  length: 0,
  beam: 0,
  draft: 0,
  boarding: [],
  volumes: [],
};

/**
 * The deck a body at (x, z) stands on or beside while its ship is under way,
 * placed at this tick's pose (the Sim's `PlayerMotionDeps.platform`), or null
 * (moored ships are ordinary grid colliders, gated at their berth).
 */
export function ferryDeckPlatform(ctx: SimContext, p: Entity): readonly Collider[] | null {
  if (!isBuiltinWorldActive()) return null;
  const st = deckStateAt(ctx, transportClock(ctx));
  for (let i = 0; i < st.platforms.length; i++) {
    if (!st.sailing[i]) continue;
    const deck = st.platforms[i];
    if (nearDeck(deck.hull, st.poses[i], p.pos.x, p.pos.z)) {
      return deck.at(st.poses[i], WATER_LEVEL);
    }
  }
  return null;
}

const COWER: MoveInput = emptyMoveInput();

/**
 * A passenger's movement under way (Sim.updatePlayerMovement hands them here
 * in place of its forced-movement chain): the ordinary kernel on the deck,
 * except that a feared passenger cowers in place (fear steers by the static
 * world and would run them straight off the ship). Returns true: the step is
 * done.
 */
export function stepPassenger(deps: PlayerMotionDeps, p: Entity, input: MoveInput): boolean {
  let feared = false;
  for (let i = 0; i < p.auras.length && !feared; i++) {
    const a = p.auras[i];
    feared = a.id === SHARED_FEAR_AURA_ID && a.kind === 'incapacitate';
  }
  stepPlayerMotion(deps, p, feared ? COWER : input);
  return true;
}

/**
 * The x/z a character save records: the destination pier for a passenger,
 * a berth's pier for a player on a docked deck (the ship may have sailed by
 * the time they log back in), otherwise where they stand.
 */
export function ferrySavePosition(e: Entity): { x: number; z: number } {
  if (!isBuiltinWorldActive()) return { x: e.pos.x, z: e.pos.z };
  for (const route of TRANSPORT_ROUTES) {
    const ride = e.ferryRide;
    if (ride && ride.route === route.id) {
      const to = route.berths[ride.to].landing;
      return { x: to.x, z: to.z };
    }
    const hull = hullFor(route);
    if (!hull) continue;
    for (const b of route.berths) {
      if (aboardDeck(hull, b, WATER_LEVEL, e.pos.x, e.pos.y, e.pos.z)) {
        return { x: b.landing.x, z: b.landing.z };
      }
    }
  }
  return { x: e.pos.x, z: e.pos.z };
}

/** Where a dev jump of the clock moves the ship's passengers: the same deck
 *  spot at the ship's pose after the jump (dev/ferry_dev.ts). */
export function carryPassengersAcrossClockJump(ctx: SimContext, fromClock: number): void {
  if (!isBuiltinWorldActive()) return;
  const clock = transportClock(ctx);
  for (const route of TRANSPORT_ROUTES) {
    const hull = hullFor(route);
    if (!hull) continue;
    transportShipPoseAt(route, fromClock, posePrev);
    transportShipPoseAt(route, clock, poseNow);
    for (const meta of ctx.players.values()) {
      const p = ctx.entities.get(meta.entityId);
      if (!p || !aboardDeck(hull, posePrev, WATER_LEVEL, p.pos.x, p.pos.y, p.pos.z)) continue;
      carryWithDeck(posePrev, poseNow, p);
      p.prevPos = { ...p.pos };
      ctx.rebucket(p);
      settleTeleportArrival(p);
    }
  }
}

/** Where a dev boarding puts a player: the waist deck amidships of route
 *  `index`'s ship wherever it is (dev/ferry_dev.ts `/dev ferry board`). */
export function ferryBoardingSpot(
  ctx: SimContext,
  index: number,
): { x: number; y: number; z: number } | null {
  const route = TRANSPORT_ROUTES[index];
  const hull = route ? hullFor(route) : null;
  if (!route || !hull) return null;
  transportShipPoseAt(route, transportClock(ctx), poseNow);
  const at = shipToWorld({ ...poseNow, baseY: WATER_LEVEL }, 0, 4);
  return { x: at.x, y: WATER_LEVEL + hull.mainDeckY, z: at.z };
}

const views = new WeakMap<SimContext, TransportFerryView[]>();

/** The offline world's IWorld.ferryView: the route `viewer` rides, else the
 *  one nearest them (ferry_view_route.ts), for `viewer`. */
export function transportFerryView(ctx: SimContext, viewer: Entity | undefined) {
  if (!isBuiltinWorldActive()) return null;
  const clock = transportClock(ctx);
  const riding = transportRouteIndex(viewer?.ferryRide?.route);
  const i = ferryViewRouteIndex(clock, viewer?.pos.x ?? 0, viewer?.pos.z ?? 0, riding);
  const route = TRANSPORT_ROUTES[i];
  if (!route) return null;
  let list = views.get(ctx);
  if (!list) {
    list = TRANSPORT_ROUTES.map((r) => emptyTransportFerryView(r));
    views.set(ctx, list);
  }
  return transportFerryViewAt(route, clock, WATER_LEVEL, riding === i, list[i]);
}
