// The sailing ship's frame on screen: one drawn clock per scheduled route and
// everything the renderer draws relative to the moving deck (Phase 3 of the
// Eastbrook ferry). Pure (no three.js, no DOM), so a Vitest drives it.
//
// The ship is posed from a DRAWN clock that glides between world ticks
// (transport_ship_core.ts advanceShipClock). A body on its deck must be drawn
// in the same frame or it slides against the planks at the ship's speed (a
// yard a tick at cruise), so every deck-bound body is drawn deck-relative:
//  - its spot in the hull's frame is interpolated (the online wire's deck
//    mirrors, or the offline Sim's prevPos and pos taken in the tick's hull
//    frame), then placed with the DRAWN pose (`deckFramedPose`);
//  - the local player's display pose is run through the usual smoother in the
//    hull's frame and placed the same way (`updateSelfRenderOnDeck`), with the
//    online prediction's deck-frame output taken as it is;
//  - the chase camera's spring and look-ahead memory are carried with the
//    drawn deck each frame, and its yaw turns with the hull, so it follows a
//    passenger's own steps, never the ship's (`deckCameraTurn`).
// The scheduled ships (transport_ferry_ships.ts) read the same drawn poses,
// so hull and passengers can never disagree.
//
// One DeckFrame per world (keyed by it, collected with it). The renderer
// advances it at the top of each frame, before it places the local player;
// the scheduled ships advance it themselves on a frame the renderer did not
// (a bare props host, the tests).

import { TRANSPORT_ROUTES, TRANSPORT_SHIP_HULLS } from '../sim/content/transport_ships';
import { isFerryPassenger } from '../sim/ferry_passenger';
import { platformSupportAt } from '../sim/physics';
import { DeckPlatform, deckToWorld, nearDeck, worldToDeck } from '../sim/transport_deck';
import {
  angleDelta,
  newTransportPhaseState,
  type TransportFerryView,
  type TransportPose,
  transportShipPoseAt,
  transportShipSpeedAt,
} from '../sim/transport_schedule';
import type { Entity } from '../sim/types';
import { WATER_LEVEL } from '../sim/world';
import type { ReconciledSelfPrediction, SelfRenderPrediction } from './self_render_position_core';
import {
  type SelfRenderPositionState,
  updateSelfRenderPosition,
} from './self_render_position_core';
import { advanceShipClock, newShipClockState, type ShipClockState } from './transport_ship_core';

/** What the deck frame reads from the world (an IWorld satisfies it). */
export interface FerryViewSource {
  ferryView(): TransportFerryView | null;
}

/** A drawn frame's move larger than this (yards) is a skip, never carried. */
const CARRY_SNAP_YD = 6;

export interface DrawnShip {
  clock: ShipClockState;
  /** The pose drawn this frame, and last frame. */
  drawn: TransportPose;
  last: TransportPose;
  hasLast: boolean;
  /** The pose at the world's newest clock: the frame the offline Sim's
   *  prevPos and pos are taken in (both sit on this tick's deck). */
  tick: TransportPose;
  /** Under way at the drawn clock, and its speed there (for the wake). */
  sailing: boolean;
  speed: number;
}

export interface DeckFrame {
  ships: DrawnShip[];
  /** Whether the world serves a ferry view at all (the built-in world). */
  active: boolean;
  /** Frames advanced, and the frame the ships last posed on. */
  frame: number;
  posedFrame: number;
  /** The route the local player was drawn aboard last frame (-1: none). */
  selfRoute: number;
  /** Scratch: the local player's deck-relative interpolation inputs. */
  readonly selfProxy: { prevPos: { x: number; y: number; z: number }; pos: typeof ZERO };
  /** Scratch: the pose `entityRenderPose` returns (read it, never keep it). */
  readonly renderPose: FramedPose;
  /** Each route's deck as drawn, for the standing surface (null: no hull). */
  readonly decks: (DeckPlatform | null)[];
}

const ZERO = { x: 0, y: 0, z: 0 };

const frames = new WeakMap<object, DeckFrame>();

/** The world's deck frame if one was built, without building it. */
export function peekDeckFrame(world: object): DeckFrame | undefined {
  return frames.get(world);
}

/** The world's deck frame (built on first ask). */
export function deckFrameFor(world: object): DeckFrame {
  let df = frames.get(world);
  if (!df) {
    df = {
      ships: TRANSPORT_ROUTES.map((route) => {
        const b = route.berths[0];
        return {
          clock: newShipClockState(),
          drawn: { x: b.x, z: b.z, rot: b.rot },
          last: { x: b.x, z: b.z, rot: b.rot },
          hasLast: false,
          tick: { x: b.x, z: b.z, rot: b.rot },
          sailing: false,
          speed: 0,
        };
      }),
      active: false,
      frame: 0,
      posedFrame: 0,
      selfRoute: -1,
      selfProxy: { prevPos: { ...ZERO }, pos: { ...ZERO } },
      renderPose: { x: 0, y: 0, z: 0, facing: 0, deck: false },
      decks: TRANSPORT_ROUTES.map((route) =>
        Object.hasOwn(TRANSPORT_SHIP_HULLS, route.ship)
          ? new DeckPlatform(TRANSPORT_SHIP_HULLS[route.ship])
          : null,
      ),
    };
    frames.set(world, df);
  }
  return df;
}

const phase = newTransportPhaseState();

/** Advance every route's drawn clock one frame toward the world's clock. The
 *  transport clock is one for all routes (whichever route IWorld.ferryView
 *  shows, its clock is the same), so every route's ship is posed here. */
export function advanceDeckFrame(df: DeckFrame, source: FerryViewSource, dt: number): void {
  df.frame++;
  const view = source.ferryView();
  df.active = view !== null;
  if (!view) return;
  for (let i = 0; i < TRANSPORT_ROUTES.length; i++) {
    const route = TRANSPORT_ROUTES[i];
    const ship = df.ships[i];
    ship.last.x = ship.drawn.x;
    ship.last.z = ship.drawn.z;
    ship.last.rot = ship.drawn.rot;
    ship.hasLast = ship.clock.ready;
    const clock = advanceShipClock(ship.clock, view.clock, dt);
    transportShipPoseAt(route, clock, ship.drawn, phase);
    ship.sailing = phase.phase === 'sailing';
    ship.speed = transportShipSpeedAt(route, clock);
    transportShipPoseAt(route, view.clock, ship.tick);
  }
}

/** The route index an entity is drawn aboard (-1 when it is not a passenger). */
export function deckRouteOf(e: Entity): number {
  if (!isFerryPassenger(e)) return -1;
  if (e.ferryDeck) return e.ferryDeck.route;
  const id = e.ferryRide?.route;
  return id === undefined ? -1 : TRANSPORT_ROUTES.findIndex((r) => r.id === id);
}

export interface FramedPose {
  x: number;
  y: number;
  z: number;
  facing: number;
  /** Set by entityRenderPose: the body is drawn on a drawn ship's deck. */
  deck?: boolean;
}

const a = { x: 0, z: 0 };
const b = { x: 0, z: 0 };

/**
 * Where to draw a passenger this frame: their deck spot interpolated by
 * `alpha` and placed on the DRAWN deck. False when the body is not aboard a
 * drawn ship (the caller draws it as usual).
 */
export function deckFramedPose(df: DeckFrame, e: Entity, alpha: number, out: FramedPose): boolean {
  const route = df.active ? deckRouteOf(e) : -1;
  const ship = route >= 0 ? df.ships[route] : undefined;
  if (!ship) return false;
  let lx: number;
  let ly: number;
  let lz: number;
  let lf: number;
  const cur = e.ferryDeck;
  const prev = e.ferryDeckPrev;
  if (cur && prev) {
    lx = prev.x + (cur.x - prev.x) * alpha;
    ly = prev.y + (cur.y - prev.y) * alpha;
    lz = prev.z + (cur.z - prev.z) * alpha;
    lf = prev.f + angleDelta(prev.f, cur.f) * Math.min(1, alpha);
  } else {
    worldToDeck(ship.tick, e.prevPos.x, e.prevPos.z, a);
    worldToDeck(ship.tick, e.pos.x, e.pos.z, b);
    lx = a.x + (b.x - a.x) * alpha;
    lz = a.z + (b.z - a.z) * alpha;
    ly = e.prevPos.y + (e.pos.y - e.prevPos.y) * alpha - WATER_LEVEL;
    const f0 = e.prevFacing - ship.tick.rot;
    lf = f0 + angleDelta(f0, e.facing - ship.tick.rot) * Math.min(1, alpha);
  }
  deckToWorld(ship.drawn, lx, lz, a);
  out.x = a.x;
  out.y = WATER_LEVEL + ly;
  out.z = a.z;
  out.facing = lf + ship.drawn.rot;
  return true;
}

/**
 * Where the renderer draws an entity this frame: a deck-bound body on the
 * drawn deck (deckFramedPose), the local player at its display pose (`self`,
 * with a deck-framed heading aboard), anyone else interpolated as usual.
 * Returns the frame's shared scratch pose.
 */
export function entityRenderPose(
  world: object,
  e: Entity,
  alpha: number,
  self: { x: number; y: number; z: number } | null,
  last?: { lastX: number; lastZ: number },
): FramedPose {
  const df = deckFrameFor(world);
  const out = df.renderPose;
  const framed = deckFramedPose(df, e, alpha, out);
  out.deck = framed;
  // The animation reads locomotion off the drawn motion since last frame: a
  // passenger's remembered spot rides the deck's own motion this frame, so
  // only their steps on the planks count (never the ship's way, which would
  // run them on the spot at cruise speed).
  if (last && framed) carryWithDrawnDeck(df, deckRouteOf(e), last);
  if (!framed) out.facing = e.prevFacing + angleDelta(e.prevFacing, e.facing) * Math.min(1, alpha);
  if (self) {
    out.x = self.x;
    out.y = self.y;
    out.z = self.z;
  } else if (!framed) {
    out.x = e.prevPos.x + (e.pos.x - e.prevPos.x) * alpha;
    out.y = e.prevPos.y + (e.pos.y - e.prevPos.y) * alpha;
    out.z = e.prevPos.z + (e.pos.z - e.prevPos.z) * alpha;
  }
  return out;
}

/** Move a remembered drawn-world spot with the drawn ship `route` from last
 *  frame's pose to this frame's (in place); a skip is left alone. */
function carryWithDrawnDeck(
  df: DeckFrame,
  route: number,
  spot: { lastX: number; lastZ: number },
): void {
  const ship = df.ships[route];
  if (!ship?.hasLast) return;
  const from = ship.last;
  const to = ship.drawn;
  if (Math.hypot(to.x - from.x, to.z - from.z) > CARRY_SNAP_YD) return;
  worldToDeck(from, spot.lastX, spot.lastZ, a);
  deckToWorld(to, a.x, a.z, a);
  spot.lastX = a.x;
  spot.lastZ = a.z;
}

/**
 * The highest drawn ship deck surface under (x, z) at or below the feet (`y`
 * plus a hair), or -Infinity: the standing surface a passenger is judged
 * against (render/entity_ground_sample.ts). The moored deck is also in the
 * collider grid, but a ship under way is not, and without this every
 * passenger read as airborne and held the jump pose for the whole voyage.
 * The drawn deck is taken moored and sailing alike, so the frame the grid's
 * gate and the drawn clock disagree (a cast-off, a mooring) never drops it.
 */
export function drawnDeckSupportAt(
  world: object,
  x: number,
  y: number,
  z: number,
  r: number,
): number {
  const df = frames.get(world);
  if (!df?.active) return Number.NEGATIVE_INFINITY;
  let best = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < df.ships.length; i++) {
    const ship = df.ships[i];
    const deck = df.decks[i];
    if (!deck || !ship.clock.ready || !nearDeck(deck.hull, ship.drawn, x, z)) continue;
    const top = platformSupportAt(deck.at(ship.drawn, WATER_LEVEL), x, z, r, y + 0.01);
    if (top > best) best = top;
  }
  return best;
}

/** What the local player's display pose reads from the world. */
export interface DeckSelfWorld extends FerryViewSource {
  cfg: { seed: number };
  riftCollisionToken?: number;
}

/**
 * The local player's display pose, deck-relative while aboard a sailing
 * ship: the smoother (self_render_position_core.ts) runs in the hull's frame
 * on the authoritative deck spot (or the online prediction's deck-frame
 * output), and the result is placed on the drawn deck. Off the deck this is
 * exactly updateSelfRenderPosition. Advances the world's deck frame first
 * (the renderer calls this once, at the top of its frame).
 */
export function updateSelfRenderOnDeck(
  world: DeckSelfWorld,
  state: SelfRenderPositionState,
  p: Entity,
  alpha: number,
  dt: number,
  selfAlphaLead: number,
  selfMotion: SelfRenderPrediction | null,
  authoritativeDiscontinuity: boolean,
): void {
  const df = deckFrameFor(world);
  const seed = world.cfg.seed;
  const riftCollisionToken = world.riftCollisionToken ?? 0;
  advanceDeckFrame(df, world, dt);
  const predicted = (selfMotion as Partial<ReconciledSelfPrediction> | null)?.kind === 'reconciled';
  const predictedDeck = predicted ? (selfMotion as ReconciledSelfPrediction).deck : undefined;
  const route = df.active ? deckRouteOf(p) : -1;
  const ship = route >= 0 ? df.ships[route] : undefined;
  if (!ship) {
    df.selfRoute = -1;
    updateSelfRenderPosition(
      state,
      p,
      seed,
      alpha,
      dt,
      selfAlphaLead,
      predicted && predictedDeck != null ? null : selfMotion,
      authoritativeDiscontinuity,
      riftCollisionToken,
    );
    return;
  }
  // Rebase last frame's display pose into the hull frame it was drawn in
  // (x port, z bow; the height stays world yards: the hull never heaves, and
  // the prediction keeps world heights in the same frame).
  const basis = df.selfRoute === route && ship.hasLast ? ship.last : ship.drawn;
  const pos = state.position;
  worldToDeck(basis, pos.x, pos.z, a);
  pos.x = a.x;
  pos.z = a.z;
  // The authoritative spot, deck-relative (the wire's mirrors online, the
  // tick's hull frame offline).
  const proxy = df.selfProxy;
  const cur = p.ferryDeck;
  const prev = p.ferryDeckPrev;
  if (cur && prev) {
    proxy.prevPos.x = prev.x;
    proxy.prevPos.y = WATER_LEVEL + prev.y;
    proxy.prevPos.z = prev.z;
    proxy.pos.x = cur.x;
    proxy.pos.y = WATER_LEVEL + cur.y;
    proxy.pos.z = cur.z;
  } else {
    worldToDeck(ship.tick, p.prevPos.x, p.prevPos.z, a);
    worldToDeck(ship.tick, p.pos.x, p.pos.z, b);
    proxy.prevPos.x = a.x;
    proxy.prevPos.y = p.prevPos.y;
    proxy.prevPos.z = a.z;
    proxy.pos.x = b.x;
    proxy.pos.y = p.pos.y;
    proxy.pos.z = b.z;
  }
  // The online prediction is used only when it too is in this deck's frame.
  const motion = predicted && predictedDeck === route ? selfMotion : null;
  updateSelfRenderPosition(
    state,
    proxy as unknown as Entity,
    seed,
    alpha,
    dt,
    selfAlphaLead,
    motion,
    authoritativeDiscontinuity,
    riftCollisionToken,
  );
  deckToWorld(ship.drawn, pos.x, pos.z, a);
  pos.x = a.x;
  pos.z = a.z;
  df.selfRoute = route;
}

/**
 * Carry the chase camera's memory with the drawn deck while the local player
 * rides it: the spring-arm pivot (position and velocity) and the look-ahead's
 * last position move rigidly with the ship, so the camera trails only the
 * player's own steps. Returns the yaw the hull turned this frame (the caller
 * turns the camera by it too, so the view swings with the ship like the
 * passenger does; the directed-move mirror turns with it). Zero, and nothing
 * moved, off the deck.
 */
export function deckCameraTurn(
  world: object,
  boom: { x: number; z: number; vx: number; vz: number },
  lastLocal: { x: number; z: number } | null,
  mirror: { yaw: number },
): number {
  const df = deckFrameFor(world);
  const ship = df.selfRoute >= 0 ? df.ships[df.selfRoute] : undefined;
  if (!ship?.hasLast) return 0;
  const from = ship.last;
  const to = ship.drawn;
  if (Math.hypot(to.x - from.x, to.z - from.z) > CARRY_SNAP_YD) return 0;
  worldToDeck(from, boom.x, boom.z, a);
  deckToWorld(to, a.x, a.z, a);
  boom.x = a.x;
  boom.z = a.z;
  const d = angleDelta(from.rot, to.rot);
  if (lastLocal) {
    worldToDeck(from, lastLocal.x, lastLocal.z, a);
    deckToWorld(to, a.x, a.z, a);
    lastLocal.x = a.x;
    lastLocal.z = a.z;
  }
  if (d !== 0) {
    const c = Math.cos(d);
    const s = Math.sin(d);
    const vx = boom.vx;
    boom.vx = vx * c + boom.vz * s;
    boom.vz = -vx * s + boom.vz * c;
    // a directed camera move reads the turn as the passenger's, not a
    // manual orbit that would cancel it
    mirror.yaw += d;
  }
  return d;
}

/** The scheduled ships' poses for this frame: advanced here only on a frame
 *  the renderer has not already advanced (a bare props host). */
export function deckFrameForShips(df: DeckFrame, source: FerryViewSource, dt: number): void {
  if (df.posedFrame === df.frame) advanceDeckFrame(df, source, dt);
  df.posedFrame = df.frame;
}
