// The harbor layout contract: the authored boardwalk-and-ship harbors that
// replaced the interim 3-section landing docks (docs/prd/last-bell-harbor.md,
// H1). Keep this leaf free of world/renderer/Sim imports, dock_layout style:
// the sim heightfield, the collider builder, the campaign anchors, the render
// harbor builder, and footstep routing all consume the same records.
//
// Unlike the dock kit, whose decks seat on their anchor's terrain (so a pier
// chained into deep water drowns its planks), every harbor deck carries an
// AUTHORED height: a long pier runs dead level from the shore out over deep
// water. Access is by RAMPS, not steps: the movement kernel gates climbing at
// PLAYER_MAX_CLIMB_SLOPE (1.5), so a raised deck with a sheer edge is a wall.
// Every shore entry and every deck seam carries a ramp rect whose surface
// interpolates between the two heights at a gentle slope; the render draws
// the same ramps as planked gangways, so what you see is what you walk.
// Deck and ramp rects are axis-aligned on purpose; both harbors sit on
// axis-aligned shores, and a rot-free footprint keeps the groundHeight arm,
// the collider builder, and the plank tiling trivially correct.
//
// The ship at each berth is walkable the same way (the FFX ferry feel). Its
// measurement exporter emits grand_ferry_ship_plan.generated.ts beside the GLB,
// then this leaf transforms that generated data into each berth. The sim never
// reads the GLB. The crossing itself is LEVEL: each berth head is raised to the
// ship's measured deck height, the climb happens on one long gentle seam ramp
// between the outer pier and the berth head, and a flat railed boarding bridge
// spans the berth-head edge to the hull skin through the generated rail gap.

import { GRAND_FERRY_SHIP_PLAN } from './grand_ferry_ship_plan.generated';

export const HARBOR_RAIL_HALF_THICK = 0.14;
export const HARBOR_RAIL_HEIGHT = 1.05;

// How far aboard the boarding anchors sit from the gangway's mating edge, and
// how far the keeper stands to one side of the route so he never blocks it.
const SHIP_BOARDING_INBOARD = 2.4;
const SHIP_KEEPER_ALONG = 2.6;

// One walkable deck rect: center, half extents, and the authored deck height.
export interface HarborDeck {
  x: number;
  z: number;
  hw: number;
  hd: number;
  y: number;
}

// A railing run: a thin OBB centered on (x, z), hw long along its rot axis
// (rot 0 runs along world x, Math.PI / 2 along world z).
export interface HarborRail {
  x: number;
  z: number;
  hw: number;
  rot: number;
  halfThickness?: number;
}

// A walkable ramp rect: the surface runs from highY (at the edge opposite
// `dir`) down to lowY (at the `dir` edge). dir is the direction of DESCENT.
// Keep (highY - lowY) / run comfortably under the 1.5 climb gate.
export interface HarborRamp {
  x: number;
  z: number;
  hw: number;
  hd: number;
  dir: 'x+' | 'x-' | 'z+' | 'z-';
  highY: number;
  lowY: number;
}

export type HarborDressingKind = 'lamp' | 'crate' | 'barrel' | 'bollard';

export interface HarborDressing {
  kind: HarborDressingKind;
  x: number;
  z: number;
  rot?: number;
}

// The moored ship's berth: hull center, yaw of the long axis, keel depth
// below the waterline, and the hull length the render scales the model to.
export interface HarborBerth {
  x: number;
  z: number;
  rot: number;
  draft: number;
  length: number;
  mirrorZ?: boolean;
}

export interface HarborShipBlocker {
  id: string;
  kind: 'lower-hull' | 'bow' | 'stern' | 'superstructure';
  x: number;
  z: number;
  hw: number;
  hd: number;
  rot: number;
  topY?: number;
  cameraTopY: number;
}

export interface HarborShipLocalBounds {
  x: number;
  z: number;
  hw: number;
  hd: number;
  bottomY: number;
  topY: number;
}

export interface HarborShipParkedPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export function harborShipParkedPose(berth: HarborBerth, waterLevel: number): HarborShipParkedPose {
  return {
    x: berth.x,
    y: waterLevel - berth.draft,
    z: berth.z,
    yaw: berth.rot,
  };
}

export function harborShipLocalBounds(berth: HarborBerth): HarborShipLocalBounds {
  const scale = berth.length / GRAND_FERRY_SHIP_PLAN.model.length;
  return {
    x: 0,
    z: 0,
    hw: berth.length / 2,
    hd: (GRAND_FERRY_SHIP_PLAN.model.beam / 2) * scale,
    bottomY: GRAND_FERRY_SHIP_PLAN.model.keelY * scale,
    topY: GRAND_FERRY_SHIP_PLAN.model.height * scale,
  };
}

export interface HarborDef {
  id: 'mainland' | 'gullhaven';
  decks: readonly HarborDeck[];
  rails: readonly HarborRail[];
  ramps: readonly HarborRamp[];
  dressing: readonly HarborDressing[];
  berth: HarborBerth;
  // Generated ship collision data transformed into this berth. Same
  // height/collider semantics as decks/rails; the GLB owns the visuals.
  // ORDER IS PART OF THE CONTRACT: the deck section the gangway meets comes
  // FIRST (arrivals and the stand-in land there) and the gangway landing comes
  // LAST; the sections between them are the rest of the deck's taper.
  shipDecks: readonly HarborDeck[];
  shipRails: readonly HarborRail[];
  shipBlockers: readonly HarborShipBlocker[];
  // The flat boarding bridge (also the LAST entry of decks) and its two side
  // rails (also present in rails). These rects deliberately mate with the
  // hull skin, so coarse hull-box sweeps special-case them by identity.
  bridge: HarborDeck;
  bridgeRails: readonly HarborRail[];
  // The boarding approach on the berth-head corridor, just short of the
  // bridge's pier edge: arrival walks end here and the ferryman post yaw
  // derives from it. facing is the yaw an NPC at the gangplank should
  // stand with (looking down the pier at arrivals).
  gangplank: { x: number; z: number; facing: number };
  // Where boarding happens: ON the ship's main deck (walk the gangplank
  // aboard, then depart). The lb_ferry fixture spawns here.
  boarding: { x: number; z: number };
  // Where the keeper stands: aboard, beside the opening, clear of the route.
  keeperPost: { x: number; z: number };
  // Where an arriving rider first appears on the parked ship deck. Voyage
  // scenes walk the real player from here down the gangplank.
  deckArrival: { x: number; z: number };
  // A landward ground reference near the harbor's shore end. Cinematic
  // arrival checks compare this with the berth to derive the open-water side.
  arrival: { x: number; z: number };
  // Enclosing xz bounds over every walkable rect, precomputed for the
  // groundHeight hot path (one cheap reject before the per-rect scan).
  bounds: { x0: number; x1: number; z0: number; z1: number };
}

function withBounds(def: Omit<HarborDef, 'bounds'>): HarborDef {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  const rects: readonly { x: number; z: number; hw: number; hd: number }[] = [
    ...def.decks,
    ...def.ramps,
    ...def.shipDecks,
  ];
  for (const d of rects) {
    x0 = Math.min(x0, d.x - d.hw);
    x1 = Math.max(x1, d.x + d.hw);
    z0 = Math.min(z0, d.z - d.hd);
    z1 = Math.max(z1, d.z + d.hd);
  }
  return { ...def, bounds: { x0, x1, z0, z1 } };
}

interface HarborShipRampMatingEdge {
  x: number;
  z: number;
  halfWidth: number;
  y: number;
  outwardX: number;
  outwardZ: number;
}

interface HarborShipPlacementPlan {
  decks: readonly HarborDeck[];
  rails: readonly HarborRail[];
  blockers: readonly HarborShipBlocker[];
  rampMatingEdge: HarborShipRampMatingEdge;
  // The hull SKIN line at the gangway station (the measured hullHalfBeam, not
  // the model's widest beam): where the boarding bridge's outboard end lands.
  bridgeHullEdge: HarborShipRampMatingEdge;
}

function snapAxis(value: number): number {
  if (Math.abs(value) < 1e-12) return 0;
  if (Math.abs(value - 1) < 1e-12) return 1;
  if (Math.abs(value + 1) < 1e-12) return -1;
  return value;
}

function snapGeneratedValue(value: number): number {
  return Math.round(value * 1e12) / 1e12;
}

function rotateLocal(lx: number, lz: number, rot: number): { x: number; z: number } {
  const cos = snapAxis(Math.cos(rot));
  const sin = snapAxis(Math.sin(rot));
  return { x: lx * cos + lz * sin, z: -lx * sin + lz * cos };
}

function generatedDirection(direction: 'x+' | 'x-' | 'z+' | 'z-'): { x: number; z: number } {
  switch (direction) {
    case 'x+':
      return { x: 1, z: 0 };
    case 'x-':
      return { x: -1, z: 0 };
    case 'z+':
      return { x: 0, z: 1 };
    case 'z-':
      return { x: 0, z: -1 };
  }
}

function generatedShipPlacement(berth: HarborBerth): HarborShipPlacementPlan {
  const scale = berth.length / GRAND_FERRY_SHIP_PLAN.model.length;
  const mirror = berth.mirrorZ ? -1 : 1;
  const baseY = GRAND_FERRY_SHIP_PLAN.standardBerth.waterlineY - berth.draft;
  const worldPoint = (x: number, z: number) => {
    const offset = rotateLocal(x * scale, z * mirror * scale, berth.rot);
    return { x: berth.x + offset.x, z: berth.z + offset.z };
  };
  const deckCos = Math.abs(snapAxis(Math.cos(berth.rot)));
  const deckSin = Math.abs(snapAxis(Math.sin(berth.rot)));
  const localEdge = GRAND_FERRY_SHIP_PLAN.rampMatingEdge;
  const edge = worldPoint(localEdge.x, localEdge.z);
  const localOutward = generatedDirection(localEdge.outward);
  const outward = rotateLocal(localOutward.x, localOutward.z * mirror, berth.rot);
  const hullEdge = worldPoint(localEdge.x, localOutward.z * (GRAND_FERRY_SHIP_PLAN.model.beam / 2));
  const landing: HarborDeck =
    Math.abs(outward.x) > 0.5
      ? {
          x: (edge.x + hullEdge.x) / 2,
          z: edge.z,
          hw: Math.abs(edge.x - hullEdge.x) / 2,
          hd: localEdge.halfWidth * scale,
          y: snapGeneratedValue(baseY + localEdge.y * scale),
        }
      : {
          x: edge.x,
          z: (edge.z + hullEdge.z) / 2,
          hw: localEdge.halfWidth * scale,
          hd: Math.abs(edge.z - hullEdge.z) / 2,
          y: snapGeneratedValue(baseY + localEdge.y * scale),
        };
  // The generated deck is a RUN of sections following the hull's taper, so
  // every one of them transforms into the berth. The section carrying the
  // gangway leads the list: a rider stepping aboard, and the arrival scene
  // that walks them off, both want the deck the plank actually meets.
  const boardingIndex = Math.max(
    0,
    GRAND_FERRY_SHIP_PLAN.decks.findIndex(
      (candidate) =>
        localEdge.x >= candidate.x - candidate.hw && localEdge.x <= candidate.x + candidate.hw,
    ),
  );
  const shipDecks = GRAND_FERRY_SHIP_PLAN.decks.map((section) => {
    const center = worldPoint(section.x, section.z);
    return {
      ...center,
      hw: (section.hw * deckCos + section.hd * deckSin) * scale,
      hd: (section.hw * deckSin + section.hd * deckCos) * scale,
      y: snapGeneratedValue(baseY + section.y * scale),
    };
  });
  const decks: readonly HarborDeck[] = [
    shipDecks[boardingIndex],
    ...shipDecks.filter((_, index) => index !== boardingIndex),
    landing,
  ];
  const rails = GRAND_FERRY_SHIP_PLAN.rails.map((rail) => {
    const center = worldPoint(rail.x, rail.z);
    return {
      ...center,
      hw: rail.hw * scale,
      rot: berth.rot + rail.rot * mirror,
      halfThickness: rail.halfThickness * scale,
    };
  });
  const blockers = GRAND_FERRY_SHIP_PLAN.blockingVolumes.map((blocker) => {
    const center = worldPoint(blocker.x, blocker.z);
    return {
      id: blocker.id,
      kind: blocker.kind,
      ...center,
      hw: blocker.hw * scale,
      hd: blocker.hd * scale,
      rot: berth.rot + blocker.rot * mirror,
      ...(blocker.topY === null ? {} : { topY: snapGeneratedValue(baseY + blocker.topY * scale) }),
      cameraTopY: snapGeneratedValue(baseY + blocker.cameraTopY * scale),
    };
  });
  const skinEdge = worldPoint(localEdge.x, localOutward.z * localEdge.hullHalfBeam);
  return {
    decks,
    rails,
    blockers,
    rampMatingEdge: {
      ...edge,
      halfWidth: localEdge.halfWidth * scale,
      y: snapGeneratedValue(baseY + localEdge.y * scale),
      outwardX: outward.x,
      outwardZ: outward.z,
    },
    bridgeHullEdge: {
      ...skinEdge,
      halfWidth: localEdge.halfWidth * scale,
      y: snapGeneratedValue(baseY + localEdge.y * scale),
      outwardX: outward.x,
      outwardZ: outward.z,
    },
  };
}

/**
 * A point on the ship's boarding deck, placed off the generated mating edge.
 *
 * `inboard` steps in from the edge along the gangway's own axis; `along` runs
 * across it, down the deck. Both anchors that used to be typed as world
 * coordinates (where a rider stands aboard, where the keeper keeps his post)
 * come from here instead, so a hull whose deck measures out differently moves
 * them with it rather than leaving them hanging over the water.
 */
function shipBoardingPoint(
  ship: HarborShipPlacementPlan,
  inboard: number,
  along = 0,
): { x: number; z: number } {
  const edge = ship.rampMatingEdge;
  const inX = -edge.outwardX;
  const inZ = -edge.outwardZ;
  return {
    x: snapGeneratedValue(edge.x + inX * inboard - inZ * along),
    z: snapGeneratedValue(edge.z + inZ * inboard + inX * along),
  };
}

// The bridge's side rails stop this far short of the hull skin: the measured
// lower-hull wall tilts with the taper, so a rail run right to the skin line
// would poke into it (the walkable deck still lands ON the skin; only the
// rails hold back, and the hull's own bulwark flanks the last stride).
const BRIDGE_RAIL_SKIN_SETBACK = 0.35;

export interface HarborBoardingBridge {
  deck: HarborDeck;
  rails: readonly HarborRail[];
}

/**
 * The flat boarding bridge: a level deck rect at the ship's measured deck
 * height, spanning the berth-head edge to the hull skin at the gangway
 * station, with a rail run down each side. It DELIBERATELY mates with the
 * hull, so every coarse hull-box sweep must treat the returned rects
 * precisely (the lint mating tolerance, the render tripwire skip, and the
 * fence-clearance suite's accurate arm all key off HarborDef.bridge).
 */
function generatedBoardingBridge(
  ship: HarborShipPlacementPlan,
  pierEdgeCoord: number,
): HarborBoardingBridge {
  const skin = ship.bridgeHullEdge;
  if (Math.abs(skin.outwardX) > 0.5) {
    const railEnd = skin.x + skin.outwardX * BRIDGE_RAIL_SKIN_SETBACK;
    const rails: readonly HarborRail[] = [-1, 1].map((side) => ({
      x: (railEnd + pierEdgeCoord) / 2,
      z: skin.z + side * skin.halfWidth,
      hw: Math.abs(railEnd - pierEdgeCoord) / 2,
      rot: 0,
    }));
    return {
      deck: {
        x: (skin.x + pierEdgeCoord) / 2,
        z: skin.z,
        hw: Math.abs(skin.x - pierEdgeCoord) / 2,
        hd: skin.halfWidth,
        y: skin.y,
      },
      rails,
    };
  }
  const railEnd = skin.z + skin.outwardZ * BRIDGE_RAIL_SKIN_SETBACK;
  const rails: readonly HarborRail[] = [-1, 1].map((side) => ({
    x: skin.x + side * skin.halfWidth,
    z: (railEnd + pierEdgeCoord) / 2,
    hw: Math.abs(railEnd - pierEdgeCoord) / 2,
    rot: Math.PI / 2,
  }));
  return {
    deck: {
      x: skin.x,
      z: (skin.z + pierEdgeCoord) / 2,
      hw: skin.halfWidth,
      hd: Math.abs(skin.z - pierEdgeCoord) / 2,
      y: skin.y,
    },
    rails,
  };
}

const MAINLAND_BERTH: HarborBerth = {
  x: 240.5,
  z: -44,
  rot: Math.PI / 2,
  draft: 2.5,
  length: 60,
};
const MAINLAND_SHIP = generatedShipPlacement(MAINLAND_BERTH);
const MAINLAND_PIER_GANGWAY_GAP = {
  min: MAINLAND_SHIP.rampMatingEdge.z - MAINLAND_SHIP.rampMatingEdge.halfWidth,
  max: MAINLAND_SHIP.rampMatingEdge.z + MAINLAND_SHIP.rampMatingEdge.halfWidth,
};
// The whole berth head stands at the ship's measured deck height so the
// crossing is level from the seam ramp's top all the way onto the main deck.
const MAINLAND_BERTH_HEAD_Y = MAINLAND_SHIP.rampMatingEdge.y;
const MAINLAND_BRIDGE = generatedBoardingBridge(MAINLAND_SHIP, 230.9);

const GULLHAVEN_BERTH: HarborBerth = {
  x: 732,
  z: 132.5,
  rot: Math.PI,
  draft: 2.5,
  length: 60,
  mirrorZ: true,
};
const GULLHAVEN_SHIP = generatedShipPlacement(GULLHAVEN_BERTH);
const GULLHAVEN_PIER_GANGWAY_GAP = {
  min: GULLHAVEN_SHIP.rampMatingEdge.x - GULLHAVEN_SHIP.rampMatingEdge.halfWidth,
  max: GULLHAVEN_SHIP.rampMatingEdge.x + GULLHAVEN_SHIP.rampMatingEdge.halfWidth,
};
const GULLHAVEN_BERTH_HEAD_Y = GULLHAVEN_SHIP.rampMatingEdge.y;
const GULLHAVEN_BRIDGE = generatedBoardingBridge(GULLHAVEN_SHIP, 722.6);

// ---------------------------------------------------------------------------
// The mainland harbor: the vale's east point. A broad shore apron hugging the
// graded shore lip (the terrain stamp below pulls the approach toward 0.3, so
// the deck sits just above the grass instead of hovering on stilts), a wide
// pier running due east over the shelf drop, and a big pier head in open
// water. Entries: a south ramp facing the headland approach and a west ramp
// to the beach path. The ship berths off the head's east edge on the strait's
// dive plateau (-5.7 to -6.6 on every seed).
// ---------------------------------------------------------------------------

export const MAINLAND_HARBOR: HarborDef = withBounds({
  id: 'mainland',
  decks: [
    // shore apron (x 166..180, z -55..-41): the harbor square
    { x: 173, z: -48, hw: 7, hd: 7, y: 0.9 },
    // main pier (x 179..197, z -51.4..-44.6), level over the shelf drop
    { x: 188, z: -48, hw: 9, hd: 3.4, y: 0.4 },
    // pier head (x 196..206, z -54..-42), all past the shelf tail
    { x: 201, z: -48, hw: 5, hd: 6, y: -0.2 },
    // the grand extension: a long outer pier and a berth head running the
    // boardwalk out to the carved-deep basin where the tall ship lies. The
    // pier runs UNDER the seam ramp all the way to the raised head's edge,
    // so the ramp's shoulders land on deck instead of open water.
    { x: 215, z: -48, hw: 9.5, hd: 2.8, y: -0.2 },
    // berth head at the ship's deck height (the seam ramp below makes the
    // climb), split around the boarding corridor so the turning hull clears
    // the two outer deck corners while the boarding route stays flush. The
    // corridor rect is centered on the generated mating edge so the bridge,
    // the corridor, and the rail gap all line up exactly.
    {
      x: 227.7,
      z: MAINLAND_SHIP.rampMatingEdge.z,
      hw: 3.2,
      hd: MAINLAND_SHIP.rampMatingEdge.halfWidth,
      y: MAINLAND_BERTH_HEAD_Y,
    },
    {
      x: 226.5,
      z: (-54.5 + MAINLAND_PIER_GANGWAY_GAP.min) / 2,
      hw: 2,
      hd: (MAINLAND_PIER_GANGWAY_GAP.min + 54.5) / 2,
      y: MAINLAND_BERTH_HEAD_Y,
    },
    {
      x: 227.7,
      z: (MAINLAND_PIER_GANGWAY_GAP.max - 41.5) / 2,
      hw: 3.2,
      hd: (-41.5 - MAINLAND_PIER_GANGWAY_GAP.max) / 2,
      y: MAINLAND_BERTH_HEAD_Y,
    },
    // the flat boarding bridge, LAST by contract (HarborDef.bridge)
    MAINLAND_BRIDGE.deck,
  ],
  rails: [
    // apron south edge; gap x 169..175 is the headland entry ramp
    { x: 167.5, z: -55, hw: 1.5, rot: 0 },
    { x: 177.5, z: -55, hw: 2.5, rot: 0 },
    { x: 173, z: -41, hw: 7, rot: 0 },
    // apron west edge; gap z -52..-44 is the beach path entry ramp
    { x: 166, z: -53.5, hw: 1.5, rot: Math.PI / 2 },
    { x: 166, z: -42.5, hw: 1.5, rot: Math.PI / 2 },
    // apron east edge outside the pier seam (walkway z -51.4..-44.6 open)
    { x: 180, z: -53.2, hw: 1.8, rot: Math.PI / 2 },
    { x: 180, z: -42.8, hw: 1.8, rot: Math.PI / 2 },
    // pier run
    { x: 188, z: -51.4, hw: 9, rot: 0 },
    { x: 188, z: -44.6, hw: 9, rot: 0 },
    // pier head; the walkway continues east onto the outer pier, so the
    // east edge rails only close the corners outside the outer pier's width
    { x: 201, z: -54, hw: 5, rot: 0 },
    { x: 201, z: -42, hw: 5, rot: 0 },
    { x: 206, z: -52.4, hw: 1.6, rot: Math.PI / 2 },
    { x: 206, z: -43.6, hw: 1.6, rot: Math.PI / 2 },
    { x: 196, z: -52.7, hw: 1.3, rot: Math.PI / 2 },
    { x: 196, z: -43.3, hw: 1.3, rot: Math.PI / 2 },
    // outer pier run, fencing the seam ramp's shoulders up to the head
    { x: 215, z: -50.8, hw: 9.5, rot: 0 },
    { x: 215, z: -45.2, hw: 9.5, rot: 0 },
    // berth head; the east edge gap is derived from the generated ship
    // mating edge, so the boarding bridge never overlaps either rail segment
    // The south run stops at the split deck corner, leaving the turning
    // hull's arrival sweep open. buildRail seats a post at this endpoint.
    { x: 226.5, z: -54.5, hw: 2, rot: 0 },
    { x: 227.7, z: -41.5, hw: 3.2, rot: 0 },
    // the corridor's south edge past the split-deck corner (x 228.5..230.9):
    // continues the bridge rail line back to the corner so the last stretch
    // before the brow is fully railed (J5). The ferry berth clearance suite
    // proves the arrival sweep clears it.
    { x: 229.7, z: MAINLAND_PIER_GANGWAY_GAP.min, hw: 1.2, rot: 0 },
    // west cross rails at the berth head's raised edge above the seam ramp
    { x: 224.5, z: -52.65, hw: 1.85, rot: Math.PI / 2 },
    { x: 224.5, z: -43.35, hw: 1.85, rot: Math.PI / 2 },
    {
      x: 231,
      z: (-54.5 + MAINLAND_PIER_GANGWAY_GAP.min) / 2,
      hw: (MAINLAND_PIER_GANGWAY_GAP.min + 54.5) / 2,
      rot: Math.PI / 2,
    },
    {
      x: 231,
      z: (MAINLAND_PIER_GANGWAY_GAP.max - 41.5) / 2,
      hw: (-41.5 - MAINLAND_PIER_GANGWAY_GAP.max) / 2,
      rot: Math.PI / 2,
    },
    // the boarding bridge's side rails (HarborDef.bridgeRails)
    ...MAINLAND_BRIDGE.rails,
  ],
  ramps: [
    // headland entry: down from the apron's south edge to the graded grass
    { x: 172, z: -57, hw: 3, hd: 2, dir: 'z-', highY: 0.9, lowY: 0.2 },
    // beach path entry: down from the apron's west edge
    { x: 164, z: -48, hw: 2, hd: 4, dir: 'x-', highY: 0.9, lowY: -0.6 },
    // deck seams: apron down to pier, pier down to head
    { x: 180.5, z: -48, hw: 1.5, hd: 2, dir: 'x+', highY: 0.9, lowY: 0.4 },
    { x: 196.75, z: -48, hw: 1.25, hd: 2, dir: 'x+', highY: 0.4, lowY: -0.2 },
    // the climb: one long gentle seam ramp from the outer pier up to the
    // raised berth head (the crossing beyond it is level all the way aboard)
    { x: 221.75, z: -48, hw: 2.75, hd: 2.5, dir: 'x-', highY: MAINLAND_BERTH_HEAD_Y, lowY: -0.2 },
  ],
  dressing: [
    { kind: 'lamp', x: 167, z: -54.2 },
    { kind: 'lamp', x: 167, z: -41.8 },
    { kind: 'lamp', x: 179, z: -54 },
    { kind: 'lamp', x: 197, z: -53.2 },
    { kind: 'lamp', x: 205.2, z: -42.8 },
    { kind: 'crate', x: 169.4, z: -52.6 },
    { kind: 'crate', x: 176.2, z: -42.4, rot: 0.5 },
    { kind: 'crate', x: 203, z: -52.6, rot: 1.1 },
    { kind: 'barrel', x: 177.4, z: -53.6 },
    { kind: 'barrel', x: 199, z: -53.3 },
    { kind: 'bollard', x: 205.7, z: -45.4 },
    { kind: 'bollard', x: 205.7, z: -50.6 },
    { kind: 'bollard', x: 197.5, z: -53.7 },
  ],
  // rot is the ship's long-axis yaw (the grand hull lies north-south off
  // the berth head, bow south; the basin under it is CARVED to depth by
  // the stamps below, so the 60 yard hull rides draft 2.5 with its main
  // deck level with the raised berth head).
  berth: MAINLAND_BERTH,
  shipDecks: MAINLAND_SHIP.decks,
  shipRails: MAINLAND_SHIP.rails,
  shipBlockers: MAINLAND_SHIP.blockers,
  bridge: MAINLAND_BRIDGE.deck,
  bridgeRails: MAINLAND_BRIDGE.rails,
  gangplank: { x: 230.4, z: MAINLAND_SHIP.rampMatingEdge.z, facing: Math.PI / 2 },
  boarding: shipBoardingPoint(MAINLAND_SHIP, SHIP_BOARDING_INBOARD),
  keeperPost: shipBoardingPoint(MAINLAND_SHIP, SHIP_BOARDING_INBOARD, SHIP_KEEPER_ALONG),
  deckArrival: {
    x: MAINLAND_SHIP.decks[0].x,
    z: MAINLAND_SHIP.decks[0].z,
  },
  arrival: { x: 173, z: -48 },
});

// ---------------------------------------------------------------------------
// The Gullhaven harbor: the town's front face on the bay. The waterfront
// apron stands on tall pilings against the sloping shore (that is the harbor
// look; the entry pocket below is graded so the town ramp lands the same on
// every seed), and the boardwalk steps down west, deck by deck with seam
// ramps, out over the bay drop (the floor plunges to -13.5 within a few
// yards), ending in a pier head with the ship berthed on its north side.
// ---------------------------------------------------------------------------

export const GULLHAVEN_HARBOR: HarborDef = withBounds({
  id: 'gullhaven',
  decks: [
    // waterfront apron (x 778..785, z 107..125): the town's harbor square
    { x: 781.5, z: 116, hw: 3.5, hd: 9, y: 5.9 },
    // upper pier (x 768..778.5, z 112.8..119.2)
    { x: 773.25, z: 116, hw: 5.25, hd: 3.2, y: 4.2 },
    // lower pier (x 760.5..769.5, z 112.8..119.2)
    { x: 765, z: 116, hw: 4.5, hd: 3.2, y: 2.6 },
    // pier head (x 753..761, z 110.5..121.5), low over the bay; the climb
    // to the ship's deck height happens on the seam ramp past the outer run
    { x: 757, z: 116, hw: 4, hd: 5.5, y: 0.2 },
    // the grand extension: the boardwalk runs on west over the deep bay to
    // the berth head where the tall ship lies. The run continues UNDER the
    // seam ramp to the raised head's edge so the ramp's shoulders land on
    // deck instead of open water, and east all the way to the pier head's
    // edge (x 753): the rail audit (J5) caught the original run ending at
    // x 750, a three yard open-water channel in the middle of the walkway.
    { x: 740.7, z: 116, hw: 12.3, hd: 2.8, y: 0.2 },
    // berth head at the ship's deck height (the seam ramp below makes the
    // climb), split around the boarding corridor so the turning hull clears
    // the two outer deck corners while the boarding route stays flush. The
    // corridor rect is centered on the mirrored generated mating edge.
    {
      x: 725.5,
      z: GULLHAVEN_SHIP.rampMatingEdge.z,
      hw: 2.9,
      hd: GULLHAVEN_SHIP.rampMatingEdge.halfWidth,
      y: GULLHAVEN_BERTH_HEAD_Y,
    },
    {
      x: 726.7,
      z: (110 + GULLHAVEN_PIER_GANGWAY_GAP.min) / 2,
      hw: 1.7,
      hd: (GULLHAVEN_PIER_GANGWAY_GAP.min - 110) / 2,
      y: GULLHAVEN_BERTH_HEAD_Y,
    },
    {
      x: 725.5,
      z: (GULLHAVEN_PIER_GANGWAY_GAP.max + 123) / 2,
      hw: 2.9,
      hd: (123 - GULLHAVEN_PIER_GANGWAY_GAP.max) / 2,
      y: GULLHAVEN_BERTH_HEAD_Y,
    },
    // the flat boarding bridge, LAST by contract (HarborDef.bridge)
    GULLHAVEN_BRIDGE.deck,
  ],
  rails: [
    // apron west edge outside the pier seam (walkway z 112.8..119.2 open)
    { x: 778, z: 109.9, hw: 2.9, rot: Math.PI / 2 },
    { x: 778, z: 122.1, hw: 2.9, rot: Math.PI / 2 },
    { x: 781.5, z: 107, hw: 3.5, rot: 0 },
    { x: 781.5, z: 125, hw: 3.5, rot: 0 },
    // apron east edge: the town entry ramp lands in the gap (z 112..120)
    { x: 785, z: 109.5, hw: 2.5, rot: Math.PI / 2 },
    { x: 785, z: 122.5, hw: 2.5, rot: Math.PI / 2 },
    // pier runs
    { x: 773.25, z: 112.8, hw: 5.25, rot: 0 },
    { x: 773.25, z: 119.2, hw: 5.25, rot: 0 },
    { x: 765, z: 112.8, hw: 4.5, rot: 0 },
    { x: 765, z: 119.2, hw: 4.5, rot: 0 },
    // pier head; the walkway continues west onto the outer run, so the
    // west edge rails only close the corners outside the run's width
    { x: 753, z: 111.85, hw: 1.35, rot: Math.PI / 2 },
    { x: 753, z: 120.15, hw: 1.35, rot: Math.PI / 2 },
    { x: 757, z: 110.5, hw: 4, rot: 0 },
    { x: 757, z: 121.5, hw: 4, rot: 0 },
    { x: 761, z: 111.65, hw: 1.15, rot: Math.PI / 2 },
    { x: 761, z: 120.35, hw: 1.15, rot: Math.PI / 2 },
    // outer run, fencing the seam ramp's shoulders up to the head
    { x: 740.7, z: 113.2, hw: 12.3, rot: 0 },
    { x: 740.7, z: 118.8, hw: 12.3, rot: 0 },
    // berth head; the west edge gap is derived from the mirrored generated
    // ship mating edge, so the boarding bridge never overlaps either rail
    // segment. The south run starts at the split deck corner, leaving the
    // turning hull's arrival sweep open. buildRail seats a post there.
    { x: 726.7, z: 110, hw: 1.7, rot: 0 },
    { x: 725.5, z: 123, hw: 2.9, rot: 0 },
    // the corridor's south edge past the split-deck corner (x 722.6..725):
    // continues the bridge rail line back to the corner so the last stretch
    // before the brow is fully railed (J5). The ferry berth clearance suite
    // proves the arrival sweep clears it.
    { x: 723.8, z: GULLHAVEN_PIER_GANGWAY_GAP.min, hw: 1.2, rot: 0 },
    {
      x: (722.5 + GULLHAVEN_PIER_GANGWAY_GAP.min) / 2,
      z: 123,
      hw: (GULLHAVEN_PIER_GANGWAY_GAP.min - 722.5) / 2,
      rot: 0,
    },
    {
      x: (GULLHAVEN_PIER_GANGWAY_GAP.max + 732.5) / 2,
      z: 123,
      hw: (732.5 - GULLHAVEN_PIER_GANGWAY_GAP.max) / 2,
      rot: 0,
    },
    // east cross rails at the berth head's raised edge above the seam ramp
    { x: 728.4, z: 111.75, hw: 1.75, rot: Math.PI / 2 },
    { x: 728.4, z: 120.75, hw: 2.25, rot: Math.PI / 2 },
    // the boarding bridge's side rails (HarborDef.bridgeRails)
    ...GULLHAVEN_BRIDGE.rails,
  ],
  ramps: [
    // the town entry up from the graded waterfront street pocket
    { x: 786.5, z: 116, hw: 1.5, hd: 4, dir: 'x+', highY: 5.9, lowY: 4.4 },
    // deck seams stepping down toward the head
    { x: 779, z: 116, hw: 1.5, hd: 2.5, dir: 'x-', highY: 5.9, lowY: 4.2 },
    { x: 768.75, z: 116, hw: 1.25, hd: 2.5, dir: 'x-', highY: 4.2, lowY: 2.6 },
    // high edge tucked just half a yard inside the lower pier's west edge
    // (the mainland seam pattern) so the exposed step at the edge stays
    // small: the rail audit (J5) caught the original placement burying the
    // whole climb under the pier, a two yard sheer step at the seam.
    { x: 758.75, z: 116, hw: 2.25, hd: 2.5, dir: 'x-', highY: 2.6, lowY: 0.2 },
    // the climb: one long gentle seam ramp from the outer run up to the
    // raised berth head (the crossing beyond it is level all the way aboard)
    { x: 730.4, z: 116, hw: 2, hd: 2.5, dir: 'x+', highY: GULLHAVEN_BERTH_HEAD_Y, lowY: 0.2 },
  ],
  dressing: [
    { kind: 'lamp', x: 779, z: 108 },
    { kind: 'lamp', x: 779, z: 124 },
    { kind: 'lamp', x: 784.2, z: 108.5 },
    { kind: 'lamp', x: 754, z: 111.2 },
    { kind: 'lamp', x: 760.4, z: 120.8 },
    { kind: 'crate', x: 783.6, z: 123.2 },
    { kind: 'crate', x: 780, z: 109, rot: 0.8 },
    { kind: 'crate', x: 763.4, z: 114, rot: 1.9 },
    { kind: 'barrel', x: 783.8, z: 110.6 },
    { kind: 'barrel', x: 758.8, z: 111.8 },
    { kind: 'bollard', x: 755.2, z: 121.2 },
    { kind: 'bollard', x: 759.4, z: 121.2 },
    { kind: 'bollard', x: 753.4, z: 111.4 },
  ],
  // The grand hull lies west of the bay's shoal corner, bow west out to
  // sea (rot PI flips the model's +x bow), over water the stamps below
  // carve deep; the gangplank gap in the berth head's north rail faces it.
  berth: GULLHAVEN_BERTH,
  shipDecks: GULLHAVEN_SHIP.decks,
  shipRails: GULLHAVEN_SHIP.rails,
  shipBlockers: GULLHAVEN_SHIP.blockers,
  bridge: GULLHAVEN_BRIDGE.deck,
  bridgeRails: GULLHAVEN_BRIDGE.rails,
  gangplank: { x: 723.5, z: GULLHAVEN_SHIP.rampMatingEdge.z, facing: 0 },
  boarding: shipBoardingPoint(GULLHAVEN_SHIP, SHIP_BOARDING_INBOARD),
  keeperPost: shipBoardingPoint(GULLHAVEN_SHIP, SHIP_BOARDING_INBOARD, SHIP_KEEPER_ALONG),
  deckArrival: {
    x: GULLHAVEN_SHIP.decks[0].x,
    z: GULLHAVEN_SHIP.decks[0].z,
  },
  arrival: { x: 782, z: 116 },
});

export const HARBORS: readonly HarborDef[] = [MAINLAND_HARBOR, GULLHAVEN_HARBOR];

// Terrain grading under the harbor approaches (applied through the world's
// HeightStamp edit layer): the mainland shore is pulled gently toward the
// apron's foot so the deck hugs the land instead of hovering, and
// Gullhaven's entry pocket is leveled so the town ramp lands at the same
// height on every seed. Kept tight: the mainland pad must not reach the
// strait crossing line (x 200, z -30, tests/farshore.test.ts pin 6) or lift
// the pier's water, and the Gullhaven pad must not touch the bay (x < 776).
export const HARBOR_TERRAIN_EDITS = [
  // the mainland shore pad under the apron
  { x: 172, z: -50, radius: 12, delta: 0.3, falloff: 'smooth', mode: 'level' },
  // the two mainland entry pockets: each ramp's foot must meet ground
  // within the movement climb gate on EVERY seed, so the ground there is
  // leveled just under the ramp lip (south lip 0.2, west lip -0.6)
  { x: 172, z: -59.5, radius: 7, delta: 0.1, falloff: 'smooth', mode: 'level' },
  { x: 161, z: -48, radius: 6, delta: -0.4, falloff: 'smooth', mode: 'level' },
  // Gullhaven's town-entry street pocket (ramp lip 4.4), centered on the
  // ramp foot so the lip meets the street flush on every seed
  { x: 788, z: 116, radius: 6, delta: 4.4, falloff: 'smooth', mode: 'level' },
  // The carved berth basins: the grand ship draws 2.5, so the floor under
  // each hull is pulled toward -12 (the mainland dive plateau sits at
  // -5.7 to -6.6 and could never float her; deepening is invisible to the
  // farshore crossing-line pins, which only need wet, open-sea points).
  { x: 265, z: -8, radius: 30, delta: -12, falloff: 'smooth', mode: 'level' },
  { x: 240, z: -14, radius: 18, delta: -12, falloff: 'smooth', mode: 'level' },
  { x: 240, z: -30, radius: 32, delta: -12, falloff: 'smooth', mode: 'level' },
  { x: 240, z: -56, radius: 22, delta: -12, falloff: 'smooth', mode: 'level' },
  { x: 240, z: -76, radius: 18, delta: -12, falloff: 'smooth', mode: 'level' },
  { x: 246, z: -88, radius: 20, delta: -12, falloff: 'smooth', mode: 'level' },
  { x: 280, z: -57, radius: 55, delta: -12, falloff: 'smooth', mode: 'level' },
  { x: 305, z: -44, radius: 22, delta: -12, falloff: 'smooth', mode: 'level' },
  { x: 673, z: 108, radius: 55, delta: -12, falloff: 'smooth', mode: 'level' },
  { x: 708, z: 76, radius: 20, delta: -12, falloff: 'smooth', mode: 'level' },
  { x: 713, z: 96, radius: 26, delta: -12, falloff: 'smooth', mode: 'level' },
  { x: 713, z: 121, radius: 24, delta: -12, falloff: 'smooth', mode: 'level' },
  { x: 713, z: 146, radius: 22, delta: -12, falloff: 'smooth', mode: 'level' },
  // The crossing channel: the voyage's filmed open-water leg rides the old
  // crossing track (360,-8) to (470,34), but the natural strait shelf is
  // only -5.7 to -6.9 there and the grand hull draws to -7.0 below the
  // -4.5 sea. Three stamps carve honest depth under the whole swept leg,
  // the same pattern as the carved berth basins above (deep mid-sea, no
  // walkable or shoreline impact).
  { x: 378.7, z: -0.9, radius: 40, delta: -12, falloff: 'smooth', mode: 'level' },
  { x: 415, z: 13, radius: 40, delta: -12, falloff: 'smooth', mode: 'level' },
  { x: 451.5, z: 27, radius: 40, delta: -12, falloff: 'smooth', mode: 'level' },
  // The J9 arrival lanes: the re-authored bow-first glides run down each
  // hull's parked axis, and the stern reaches past the old carved chain at
  // the seaward end of both approaches (mainland from the north strait
  // side, Gullhaven from the north bay). Same mid-sea deepening pattern as
  // the basins above; no walkable or shoreline impact.
  { x: 259, z: 12, radius: 26, delta: -12, falloff: 'smooth', mode: 'level' },
  { x: 696, z: 178, radius: 28, delta: -12, falloff: 'smooth', mode: 'level' },
] as const;

// The deck rect containing (x, z), or null. Later rects win ties so a seam
// overlap reports the seaward (lower) deck only after the landward one; the
// height arm takes the max either way.
export function harborDeckAt(harbor: HarborDef, x: number, z: number): HarborDeck | null {
  let hit: HarborDeck | null = null;
  for (const d of harbor.decks) {
    // The epsilon keeps points ON an authored edge inside the deck: rail
    // segments sit exactly on edge lines, and float representation of the
    // authored extents (2.6 and friends) would otherwise exclude them.
    if (Math.abs(x - d.x) <= d.hw + 1e-6 && Math.abs(z - d.z) <= d.hd + 1e-6) {
      if (hit === null || d.y > hit.y) hit = d;
    }
  }
  for (const d of harbor.shipDecks) {
    if (Math.abs(x - d.x) <= d.hw + 1e-6 && Math.abs(z - d.z) <= d.hd + 1e-6) {
      if (hit === null || d.y > hit.y) hit = d;
    }
  }
  return hit;
}

// The ramp surface height at (x, z), or -Infinity outside every ramp.
export function harborRampHeight(harbor: HarborDef, x: number, z: number): number {
  let surface = -Infinity;
  for (const r of harbor.ramps) {
    if (Math.abs(x - r.x) > r.hw + 1e-6 || Math.abs(z - r.z) > r.hd + 1e-6) continue;
    surface = Math.max(surface, rampSurfaceY(r, x, z));
  }
  return surface;
}

// The walkable boardwalk height at (x, z): the highest containing deck or
// ramp surface, or -Infinity outside the harbor. groundHeight composes this
// with the terrain and dock arms by max, dock style.
export function harborSurfaceHeight(harbor: HarborDef, x: number, z: number): number {
  const b = harbor.bounds;
  if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) return -Infinity;
  const deck = harborDeckAt(harbor, x, z);
  const deckY = deck === null ? -Infinity : deck.y;
  return Math.max(deckY, harborRampHeight(harbor, x, z));
}

// The slope of the harbor surface UNDER FOOT at (x, z), or null outside
// every walkable rect: 0 on decks and ship decks, the authored gradient on
// ramps (whichever surface rules by height). The movement kernel's
// steepness gate consumes this so a deck over a steep seabed (the strip
// edge dive wall under the mainland ship) never reads as an unwalkable
// cliff: the footing is the AUTHORED surface, not the terrain below it.
export function harborFootingSlope(harbor: HarborDef, x: number, z: number): number | null {
  const b = harbor.bounds;
  if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) return null;
  const deck = harborDeckAt(harbor, x, z);
  const deckY = deck === null ? -Infinity : deck.y;
  let rampY = -Infinity;
  let rampSlope = 0;
  for (const r of harbor.ramps) {
    if (Math.abs(x - r.x) > r.hw + 1e-6 || Math.abs(z - r.z) > r.hd + 1e-6) continue;
    const alongX = r.dir === 'x+' || r.dir === 'x-';
    const y = rampSurfaceY(r, x, z);
    if (y > rampY) {
      rampY = y;
      rampSlope = (r.highY - r.lowY) / ((alongX ? r.hw : r.hd) * 2);
    }
  }
  if (deckY === -Infinity && rampY === -Infinity) return null;
  return rampY > deckY ? rampSlope : 0;
}

function rampSurfaceY(r: HarborRamp, x: number, z: number): number {
  const dx = x - r.x;
  const dz = z - r.z;
  let t: number;
  switch (r.dir) {
    case 'x+':
      t = (dx + r.hw) / (2 * r.hw);
      break;
    case 'x-':
      t = (r.hw - dx) / (2 * r.hw);
      break;
    case 'z+':
      t = (dz + r.hd) / (2 * r.hd);
      break;
    case 'z-':
      t = (r.hd - dz) / (2 * r.hd);
      break;
  }
  const clamped = Math.min(1, Math.max(0, t));
  return r.highY + (r.lowY - r.highY) * clamped;
}

// Movement collider radius for a dressing prop; 0 means walk-through.
export function harborDressingRadius(kind: HarborDressingKind): number {
  switch (kind) {
    case 'lamp':
      return 0.2;
    case 'crate':
      return 0.55;
    case 'barrel':
      return 0.4;
    case 'bollard':
      return 0.18;
  }
}
