// The standalone Deepglass arena world.
//
// A sky-caldera carrying the bell and its stadium, and nothing else, no
// procedural trees, no camps, no shipped overworld content. Built
// PROGRAMMATICALLY rather than published from Studio, because the arena is
// pure geometry: a 13 MB serialized map doc would carry no information this
// file does not state in a couple of hundred lines.
//
// The landscape is deliberately unlike anywhere else in the realm, see the
// terrain section below. The stadium standing on it is render-side
// (src/render/deepglass_stadium.ts).
//
// Booted by ?map=deepglass (src/main.ts) or hot-swapped by the /deepglass dev
// command (src/sim/dev_commands.ts).

import { DEEPGLASS_EVENT_NPCS, DG_MARKET_STALLS } from '../content/deepglass_event';
import { DEEPGLASS_PORTAL_WIZARD_NPC_ID, PORTAL_WIZARD_NPCS } from '../portal_wizard';
import { type ColliderVolume, emptyZoneProps, type NpcDef, type WorldContent } from '../types';
import {
  citadelBackingRange,
  citadelLakes,
  citadelOpensParapet,
  citadelSuppressesMassifPeak,
  TH_WATER_Y,
  TIDEHOLD_NPCS,
} from './citadel';
import {
  ringLights as cityLights,
  ringPlacements as cityPlacements,
  RING_POI,
  RING_WIZARD_POS,
  ringBiomePaint,
  ringBlockers,
  ringColliderVolumes,
  ringGrassClear,
  ringLakes,
  ringLocations,
  ringPointSounds,
  ringTerrain,
} from './citadel_ring';
import {
  DEEPGLASS_CENTER,
  DEEPGLASS_CRADLE_R,
  DEEPGLASS_RADIUS,
  DG_BOWL_GAP,
  DG_BOWL_INNER_R,
  DG_BOWL_OUTER_R,
  DG_CAUSEWAY_DECK_TOP_Y,
  DG_CAUSEWAY_HALF_W,
  DG_CAUSEWAY_Z_FAR,
  DG_CAUSEWAY_Z_NEAR,
} from './layout';

/** Half the arena world's x extent. Grown with the city: Tidehold's peninsula,
 *  its two fjords and the far-shore ranges all live east-west of the axis. */
export const DG_WORLD_HALF_X = 460;
/** The arena's z band. */
export const DG_WORLD_HALF_Z = 250;
/** How far NORTH the world runs. Asymmetric on purpose: the caldera is the
 *  same size it always was, and Tidehold and its backing range are built out
 *  past the old rim on the far side of the chasm. */
export const DG_WORLD_Z_NORTH = 1120;

/** The icy sea. The bell holds its OWN water (a render volume) and the arena
 *  terrace sits at y 0, so the waterline lives well below both, but ABOVE the
 *  chasm floor and the carved ocean bed (-46 / -55), which is what turns the
 *  ring chasm into a moat and every low place the city stamps carve into
 *  frozen sea. citadel.ts owns the carving AND the waterline (the bergs are
 *  stamped relative to it, so they must agree); this is just the surface. */
const DG_WORLD_WATER_LEVEL = TH_WATER_Y;

/** Where a player lands on boot: outside the bell's shadow, north of it, far
 *  enough back that all 76 yards of glass fits in view. */
export const DG_ARRIVAL = { x: 0, z: DEEPGLASS_RADIUS + 20 };

/**
 * The match marshal, and the reason she exists.
 *
 * Before her the only ways into a bout were a DEV chat command (`/deepglass N`,
 * dead in a production build) and a URL parameter, so a player who walked down
 * the causeway could look at the bell and had no way to start anything. She is
 * the in-world fixture desk: talk to her, pick a size, play.
 *
 * Placed on the near end of the causeway, four yards clear of the glass: inside
 * the seating bowl's north gap, outside the play sphere (radius 49.4), and
 * between the two rows of avenue lamps at x = +/-7. `facing: 0` looks north up
 * the processional, the sim's convention is that facing f points along
 * (sin f, cos f), so she is looking at the arriving player rather than past
 * them, since the walk in runs south from DG_ARRIVAL.
 */
export const DEEPGLASS_MARSHAL_POS = { x: 0, z: DEEPGLASS_RADIUS + 4 };

/** The fixtures she runs. The match driver itself accepts 1..5 a side, but a
 *  bout is only as good as the bodies in it: 4v4 and 5v5 fill the bell with
 *  bots and the ball stops being findable, so the card stops at three. */
export const DEEPGLASS_BOUT_SIZES = [1, 2, 3] as const;

export const DEEPGLASS_MARSHAL: NpcDef = {
  id: 'deepglass_marshal',
  name: 'Marshal Yvette Coralwake',
  title: 'Keeper of the Whistle',
  pos: { ...DEEPGLASS_MARSHAL_POS },
  facing: 0,
  color: 0x8ee8ff,
  questIds: [],
  deepglassMarshal: true,
  // Registered in the global NPCS table (the dialog resolves an NPC's flags
  // through NPCS[templateId], not through the world it is standing in) but
  // DYNAMIC there, so the built-in world never surface-places her: these
  // coordinates are open water in the overworld. The arena's own roster below
  // re-declares her with `dynamic: false`, which is what actually spawns her.
  dynamic: true,
  greeting:
    'Bell is warm and the water is clear, $C. Name your fixture and I will blow ' +
    'the whistle, singles if you want the ball to yourself, or a full three a ' +
    'side if you would rather have someone to blame.',
};

// ---------------------------------------------------------------------------
// The land. Nothing here is borrowed from the overworld: the arena stands on a
// SKY-CALDERA of its own, and the shape is stamped from first principles rather
// than lifted off any existing zone's heightfield.
//
// Read from the middle out:
//
//   the terrace, a dead-flat mesa carrying the bell and the whole stadium
//   the fall, a ring chasm dropping away from the terrace on every side,
//                 so the arena reads as an island in the air
//   the wall, a jagged massif ringing the horizon, tall enough to close the
//                 sky off and irregular enough never to read as a wall
//
// The point of the silhouette is that from inside the bowl the only things
// above the cornice are peaks and sky. There is no landscape to recognise.
// ---------------------------------------------------------------------------

/** The flat terrace the stadium stands on. Comfortably past the bowl's outer
 *  wall (r 88) and its cornice. */
const DG_TERRACE_R = 104;
/** The chasm ring: where the terrace ends and the world falls away. */
const DG_CHASM_R = 128;
const DG_CHASM_DEPTH = 46;
/** The encircling massif. */
const DG_MASSIF_R = 172;
const DG_MASSIF_H = 78;
const DG_MASSIF_PEAKS = 22;

/**
 * Deterministic per-peak variation. A hash walk rather than rng: world content
 * must build identically on every host, and this module is imported by both the
 * sim and the render.
 */
function peakJitter(i: number, salt: number): number {
  const h = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return (h - Math.floor(h)) * 2 - 1; // -1..1
}

/** Where the parapet stands: just inside the lip, where the terrace starts to
 *  fall away toward the chasm. */
const DG_PARAPET_R = 99;
const DG_PARAPET_SEGMENTS = 40;

/**
 * The terrace rail.
 *
 * The chasm is a fifty-five yard drop and the terrace runs right up to it, so
 * the first thing a player does after arriving is wander to the edge, fall in
 * and die of it, which is exactly what happened the first time this landscape
 * was walked. A ring of blockers along the lip turns the drop into scenery.
 * The matching stone balustrade is rendered by deepglass_stadium.ts; this is
 * the collision half, and the two share DG_PARAPET_R so they cannot drift.
 */
function parapetBlockers(): NonNullable<WorldContent['blockers']> {
  const out: NonNullable<WorldContent['blockers']> = [];
  for (let i = 0; i < DG_PARAPET_SEGMENTS; i++) {
    const a0 = (i / DG_PARAPET_SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / DG_PARAPET_SEGMENTS) * Math.PI * 2;
    // The Tideway leaves the terrace here: the rail opens for the causeway
    // mouth, which carries its own edge blockers instead.
    if (citadelOpensParapet(a0, a1)) continue;
    out.push({
      x1: DEEPGLASS_CENTER.x + Math.cos(a0) * DG_PARAPET_R,
      z1: DEEPGLASS_CENTER.z + Math.sin(a0) * DG_PARAPET_R,
      x2: DEEPGLASS_CENTER.x + Math.cos(a1) * DG_PARAPET_R,
      z2: DEEPGLASS_CENTER.z + Math.sin(a1) * DG_PARAPET_R,
    });
  }
  return out;
}

/**
 * The stadium's own collision. The bowl, the causeway and the cradle were
 * renderer geometry with NO colliders at all, a body outside a bout walked
 * straight through the risers into the hollow of the stands, sank shin-deep
 * into the causeway deck, and passed through the cradle pylons. Every number
 * here is imported from layout.ts, the same module the stadium renders from,
 * so the collision cannot drift from the stone you can see.
 *
 * None of this touches a bout: flooded flight replaces the entire ground
 * pipeline for a body inside the bell (deepglassFlightPass), and everything
 * below stands outside the play sphere anyway.
 */

/**
 * An arc of `wall` collider volumes, chord after chord around the ring, with
 * explicit endpoints so the arc stops EXACTLY at the entrance cut. Angles are
 * the cos/sin convention (north = pi/2).
 *
 * Wall VOLUMES rather than BlockerDef segments on purpose: the two bowl rings
 * take ninety-two of them, `sanitizeMapDoc` caps a document's blockers at
 * MAX_BLOCKERS (128), and the citadel + parapet already spend eighty, as
 * blockers, a Studio republish of this venue would silently drop a third of
 * the bowl's collision at the cap. Collider volumes ride the placement
 * pipeline instead, which also makes each chord editable in Studio.
 */
function arcWalls(
  out: ColliderVolume[],
  r: number,
  aStart: number,
  aEnd: number,
  segments: number,
): void {
  for (let i = 0; i < segments; i++) {
    const a0 = aStart + ((aEnd - aStart) * i) / segments;
    const a1 = aStart + ((aEnd - aStart) * (i + 1)) / segments;
    const x0 = DEEPGLASS_CENTER.x + Math.cos(a0) * r;
    const z0 = DEEPGLASS_CENTER.z + Math.sin(a0) * r;
    const x1 = DEEPGLASS_CENTER.x + Math.cos(a1) * r;
    const z1 = DEEPGLASS_CENTER.z + Math.sin(a1) * r;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    out.push({
      kind: 'wall',
      x: (x0 + x1) / 2,
      z: (z0 + z1) / 2,
      // Local +x maps to (cos rotY, -sin rotY) under a three.js Y-rotation.
      rotY: -Math.atan2(dz, dx),
      // A little end pad so adjacent chords cannot leave a corner sliver.
      sizeX: len + 0.6,
      sizeY: 10,
      sizeZ: 0.8,
    });
  }
}

/** Collider volumes for everything the blockers cannot say: walkable floors
 *  (the causeway deck, its kerbs, the plaza disc), the entrance cheek walls,
 *  and round footprints for the colonnade and the cradle pylons. */
function stadiumColliderVolumes(): ColliderVolume[] {
  const out: ColliderVolume[] = [];
  const cx = DEEPGLASS_CENTER.x;
  const cz = DEEPGLASS_CENTER.z;

  // The bowl's walls: the innermost riser (off the concourse) and the outer
  // skin (off the terrace), each running gap-edge to gap-edge around the ring.
  const aFrom = Math.PI / 2 + DG_BOWL_GAP / 2;
  const aTo = Math.PI / 2 + Math.PI * 2 - DG_BOWL_GAP / 2;
  arcWalls(out, DG_BOWL_INNER_R, aFrom, aTo, 44);
  arcWalls(out, DG_BOWL_OUTER_R + 0.7, aFrom, aTo, 48);

  // The causeway deck is a RAISED floor, not a wall: one walkable plane at the
  // deck's top face, so a body stands on the stone instead of wading through
  // it. The kerbs are two narrow strips a half-step higher, an honest curb.
  // All the floor planes are DETACHED (anchored to absolute y 0, the slate the
  // stadium is drawn against), not terrain-following: a plane's base otherwise
  // reads the live terrain at its CENTRE, and the citadel's boulevard stamps
  // raise that mid-causeway, which floated the whole deck collider a half
  // yard above the drawn stone.
  const causewayLen = DG_CAUSEWAY_Z_FAR - DG_CAUSEWAY_Z_NEAR;
  const causewayMidZ = cz + (DG_CAUSEWAY_Z_NEAR + DG_CAUSEWAY_Z_FAR) / 2;
  out.push({
    kind: 'plane',
    x: cx,
    z: causewayMidZ,
    rotY: 0,
    sizeX: DG_CAUSEWAY_HALF_W * 2,
    sizeY: DG_CAUSEWAY_DECK_TOP_Y,
    sizeZ: causewayLen,
    detached: true,
    groundY: 0,
  });
  for (const side of [-1, 1]) {
    out.push({
      kind: 'plane',
      x: cx + side * DG_CAUSEWAY_HALF_W,
      z: causewayMidZ,
      rotY: 0,
      sizeX: 0.8,
      sizeY: 1.05,
      sizeZ: causewayLen,
      detached: true,
      groundY: 0,
    });
  }

  // The plaza disc under the bell has no plane here: collider planes are
  // rectangles and no small set of them covers a 44-yard circle without
  // either shin-deep gaps at the rim or phantom floor past it. The walkable
  // lift for the disc is a terrain stamp instead (calderaTerrain), which is
  // round by construction.

  // The entrance cheek walls: one full-height slab down each cut face of the
  // bowl, matching the stepped masonry the stadium draws there.
  for (const side of [-1, 1]) {
    const aCut = Math.PI / 2 + side * (DG_BOWL_GAP / 2);
    const rIn = DG_BOWL_INNER_R - 0.6;
    const rOut = DG_BOWL_OUTER_R + 2.6;
    const rMid = (rIn + rOut) / 2;
    out.push({
      kind: 'wall',
      x: cx + Math.cos(aCut) * rMid,
      z: cz + Math.sin(aCut) * rMid,
      rotY: -aCut,
      sizeX: rOut - rIn,
      sizeY: 12,
      sizeZ: 2.0,
    });
  }

  // The colonnade flanking the causeway (deepglass_stadium's own spacing).
  for (let z = DG_CAUSEWAY_Z_NEAR + 6; z < DG_CAUSEWAY_Z_FAR; z += 9) {
    for (const side of [-1, 1]) {
      out.push({
        kind: 'sphere',
        x: cx + side * (DG_CAUSEWAY_HALF_W + 2.5),
        z: cz + z,
        rotY: 0,
        sizeX: 2.0,
        sizeY: 2.0,
        sizeZ: 2.0,
      });
    }
  }

  // The sixteen cradle pylons gripping the bell (render/deepglass_kit.ts, the
  // same ring the Studio adapter gives a 1.1 yd circle).
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    out.push({
      kind: 'sphere',
      x: cx + Math.cos(a) * DEEPGLASS_CRADLE_R,
      z: cz + Math.sin(a) * DEEPGLASS_CRADLE_R,
      rotY: 0,
      sizeX: 2.4,
      sizeY: 2.4,
      sizeZ: 2.4,
    });
  }

  return out;
}

function calderaTerrain(): WorldContent['terrainEdits'] {
  const out: NonNullable<WorldContent['terrainEdits']> = [];

  // 1. The terrace, dead flat. `mode: 'level'` with a hard disc drives the
  //    heightfield to exactly 0, the stadium needs a true plane to stand on,
  //    and every collider under it assumes y = 0.
  out.push({
    x: DEEPGLASS_CENTER.x,
    z: DEEPGLASS_CENTER.z,
    radius: DG_TERRACE_R,
    delta: 0,
    falloff: 'flat',
    mode: 'level',
  });

  // 1b. The plaza disc. The render lays a 0.4-thick stone disc under the bell
  //     (deepglass.ts buildCradle); this stamp lifts the WALKABLE ground to
  //     just under its top face so a body stands on the stone instead of
  //     wading through it. 0.34 rather than 0.40 on purpose: level the
  //     heightfield exactly to the disc's top and the two surfaces z-fight
  //     wherever a terrain triangle crosses the rim.
  out.push({
    x: DEEPGLASS_CENTER.x,
    z: DEEPGLASS_CENTER.z,
    radius: DG_PLAZA_R,
    delta: 0.34,
    falloff: 'flat',
    mode: 'level',
  });

  // 2. The fall. A ring of overlapping bowls just outside the terrace, cut deep
  //    enough that the far lip is out of sight from the arena floor.
  const chasmSteps = 30;
  for (let i = 0; i < chasmSteps; i++) {
    const a = (i / chasmSteps) * Math.PI * 2;
    out.push({
      x: DEEPGLASS_CENTER.x + Math.cos(a) * DG_CHASM_R,
      z: DEEPGLASS_CENTER.z + Math.sin(a) * DG_CHASM_R,
      radius: 34,
      delta: -DG_CHASM_DEPTH,
      falloff: 'smooth',
      mode: 'add',
    });
  }

  // 3. The wall. Peaks of varying height and reach, stepped around the horizon
  //    and deliberately uneven, a ring of identical cones reads as a fence.
  for (let i = 0; i < DG_MASSIF_PEAKS; i++) {
    const a = (i / DG_MASSIF_PEAKS) * Math.PI * 2;
    // North is Tidehold's: those peaks would be stamped straight through the
    // wards, so the arc opens and citadelBackingRange() closes the horizon
    // again from behind the Warden's Seat.
    if (citadelSuppressesMassifPeak(a)) continue;
    const r = DG_MASSIF_R + peakJitter(i, 3) * 16;
    const h = DG_MASSIF_H * (0.62 + 0.38 * Math.abs(peakJitter(i, 11)));
    out.push({
      x: DEEPGLASS_CENTER.x + Math.cos(a) * r,
      z: DEEPGLASS_CENTER.z + Math.sin(a) * r,
      radius: 40 + peakJitter(i, 29) * 10,
      delta: h,
      falloff: 'smooth',
      mode: 'add',
    });
    // A shoulder peak between each pair, lower and set further back, so the
    // massif has depth instead of being one row of teeth.
    const a2 = ((i + 0.5) / DG_MASSIF_PEAKS) * Math.PI * 2;
    if (citadelSuppressesMassifPeak(a2)) continue;
    out.push({
      x: DEEPGLASS_CENTER.x + Math.cos(a2) * (r + 26),
      z: DEEPGLASS_CENTER.z + Math.sin(a2) * (r + 26),
      radius: 52,
      delta: h * 0.72,
      falloff: 'smooth',
      mode: 'add',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dressing. Everything below is authored through the SAME layers the Studio
// editor writes (lighting, skybox, weather, placements, lights, point sounds,
// grass clear), this arena just fills them in code instead of through the GUI,
// because every position is derived from the bell's radius rather than dragged.
// ---------------------------------------------------------------------------

/** Radius of the stone plaza the render lays under the bell. */
const DG_PLAZA_R = 44;
/** Ring of crystal lamps just inside the plaza rim. */
const DG_LAMP_R = 40;
const DG_LAMP_COUNT = 16;
/** The processional approach from the arrival point in to the cradle. */
const DG_AVENUE_STEP = 11;

const LAMP_MODEL = '/models/props/streetlamp_veiled_crystal.glb';

/** The processional's colonnade: a Blender-authored fluted column (a 9 yd
 *  reference model, origin at the foot; asset_scale.ts targetHeightFor keeps
 *  those yards, so scale here is height / 9) per seat of the old procedural
 *  cylinders, shortening toward the bell exactly as they did (9 -> 5.5 yd) so
 *  the perspective still exaggerates the approach. Seated on the plaza floor
 *  (FLOOR_Y 0, detached, like the stadium's own deck planes). No collider of
 *  their own: stadiumColliderVolumes already stands a sphere at every seat. */
const PILLAR_MODEL = '/models/props/deepglass_pillar.glb';
const PILLAR_MODEL_HEIGHT = 9;
export function colonnadePlacements(): NonNullable<WorldContent['placements']> {
  const out: NonNullable<WorldContent['placements']> = [];
  const cx = DEEPGLASS_CENTER.x;
  const cz = DEEPGLASS_CENTER.z;
  const len = DG_CAUSEWAY_Z_FAR - DG_CAUSEWAY_Z_NEAR;
  for (let z = DG_CAUSEWAY_Z_NEAR + 6; z < DG_CAUSEWAY_Z_FAR; z += 9) {
    const t = (z - DG_CAUSEWAY_Z_NEAR) / len;
    const h = 9 - t * 3.5;
    for (const side of [-1, 1]) {
      out.push({
        path: PILLAR_MODEL,
        x: cx + side * (DG_CAUSEWAY_HALF_W + 2.5),
        z: cz + z,
        rotY: 0,
        scale: h / PILLAR_MODEL_HEIGHT,
        detached: true,
        groundY: 0,
      });
    }
  }
  return out;
}

function ringPlacements(): NonNullable<WorldContent['placements']> {
  const out: NonNullable<WorldContent['placements']> = [];
  for (let i = 0; i < DG_LAMP_COUNT; i++) {
    const a = (i / DG_LAMP_COUNT) * Math.PI * 2;
    const x = DEEPGLASS_CENTER.x + Math.cos(a) * DG_LAMP_R;
    const z = DEEPGLASS_CENTER.z + Math.sin(a) * DG_LAMP_R;
    out.push({
      path: LAMP_MODEL,
      x,
      z,
      // Face the bell, so the lamps read as a ring turned inward.
      rotY: Math.atan2(DEEPGLASS_CENTER.x - x, DEEPGLASS_CENTER.z - z),
      scale: 1.5,
      collideRadius: 0.6,
      // A lamp collides as the thin circle it is; the baked set adds nothing.
      collideCustom: true,
    });
  }
  // The avenue: paired lamps marching from the arrival point to the plaza rim.
  for (let z = DG_ARRIVAL.z; z > DG_PLAZA_R + 2; z -= DG_AVENUE_STEP) {
    for (const side of [-1, 1]) {
      out.push({
        path: LAMP_MODEL,
        x: DEEPGLASS_CENTER.x + side * 7,
        z,
        rotY: side < 0 ? Math.PI / 2 : -Math.PI / 2,
        scale: 1.25,
        collideRadius: 0.6,
        collideCustom: true,
      });
    }
  }
  return out;
}

function ringLights(): NonNullable<WorldContent['lights']> {
  const out: NonNullable<WorldContent['lights']> = [];
  for (let i = 0; i < DG_LAMP_COUNT; i += 2) {
    const a = (i / DG_LAMP_COUNT) * Math.PI * 2;
    out.push({
      x: DEEPGLASS_CENTER.x + Math.cos(a) * DG_LAMP_R,
      z: DEEPGLASS_CENTER.z + Math.sin(a) * DG_LAMP_R,
      y: 4.5,
      color: 0x7fe6ff, // tide-glass cyan, matching the bell
      intensity: 2.2,
      range: 34,
    });
  }
  return out;
}

export function buildDeepglassWorld(): WorldContent {
  return {
    zones: [
      {
        id: 'deepglass',
        name: 'The Deepglass',
        zMin: -DG_WORLD_HALF_Z,
        zMax: DG_WORLD_Z_NORTH,
        levelRange: [1, 1],
        biome: 'vale',
        hub: { x: DEEPGLASS_CENTER.x, z: DEEPGLASS_CENTER.z, radius: 40, name: 'The Deepglass' },
        graveyard: { x: DG_ARRIVAL.x, z: DG_ARRIVAL.z },
        // The icy sea. Declared, not just carved: without these footprints
        // waterLevelAt() answers -Infinity over every stamped low and the
        // whole ocean renders (and swims) as a dry pit. See citadelLakes().
        lakes: [...citadelLakes(), ...ringLakes()],
        pois: [
          { x: DEEPGLASS_CENTER.x, z: DEEPGLASS_CENTER.z, label: 'The Deepglass', id: 'deepglass' },
          { x: RING_POI.x, z: RING_POI.z, label: 'Tidehold', id: 'tidehold' },
        ],
        welcome: 'The bell is full and the truce holds. Type /deepglass to start a bout.',
      },
    ],
    camps: [],
    // She stays DYNAMIC here so the generic surface loop skips her: that loop
    // allocates ids as it goes, and one extra allocation shifts every id after
    // it (and with it the bout's rng). Sim spawns her from this entry at a
    // reserved id instead, see spawnDeepglassMarshal.
    npcs: {
      [DEEPGLASS_MARSHAL.id]: DEEPGLASS_MARSHAL,
      // Baldemar's Tidehold self, standing at the Wardens' Fountain in the
      // middle of the Glass Market, the city's crossroads, where the boulevard
      // from the causeway meets the two bridge spans. A traveller portals in
      // and out from the heart of everything (main.ts lands portal arrivals
      // beside him). Same dynamic plus reserved-id treatment as the marshal;
      // see spawnDeepglassPortalWizard.
      [DEEPGLASS_PORTAL_WIZARD_NPC_ID]: {
        ...PORTAL_WIZARD_NPCS[DEEPGLASS_PORTAL_WIZARD_NPC_ID],
        pos: { x: RING_WIZARD_POS.x, z: RING_WIZARD_POS.z },
        // Facing points along (sin f, cos f): look south, at travellers coming
        // up the boulevard from the causeway. His portal opens off his left
        // shoulder (west), into the open plaza floor.
        facing: Math.PI,
      },
      // The city event: twenty spectators and three stallkeepers, all dynamic
      // (deepglass/crowd.ts spawns them at reserved ids and clears them for
      // every bout). Listed here so only THIS world ever has the event.
      ...DEEPGLASS_EVENT_NPCS,
      // Tidehold's forty residents. All dynamic and reserved-id for the same
      // reason the marshal is (src/sim/deepglass/citadel_spawn.ts): placing
      // them through the generic loop would shift every id after them and
      // move the bout's rng with it.
      ...TIDEHOLD_NPCS,
    },
    groundObjects: [],
    roads: [],
    // The match-day market: six stalls flanking the arrival avenue (data in
    // content/deepglass_event.ts). Rendered by the ordinary stall pass in
    // render/props.ts, which also registers their colliders; the renderer
    // hides the market while a bout runs (the crowd's despawn, in prop form).
    props: { ...emptyZoneProps(), stalls: [...DG_MARKET_STALLS] },
    playerStart: { ...DG_ARRIVAL },
    terrainEdits: [...(calderaTerrain() ?? []), ...citadelBackingRange(), ...ringTerrain()],
    blockers: [...parapetBlockers(), ...ringBlockers()],
    // The stadium's deck/cheek planes plus the city's stair floors (the sloped
    // planes the body walks up every flight on; see citadel.ts climbStairs).
    colliderVolumes: [...stadiumColliderVolumes(), ...ringColliderVolumes()],
    placements: [...ringPlacements(), ...colonnadePlacements(), ...cityPlacements()],
    lights: [...ringLights(), ...cityLights()],
    // Cold twilight, deliberately DARK. The bell, the rings and the lamps are
    // all additive, so they read by contrast: a bright sunset sky (tried first)
    // washed 76 yards of glass into a flat grey ball, while a dim cool
    // environment makes it glow like the lantern it is meant to be. The sun sits
    // low and warm purely to catch the fresnel rim.
    // Dusk, not night. The first pass ran this MUCH darker on the reasoning
    // that a bright sky washed 76 yards of glass into a flat grey ball, true
    // when the bell was the only thing here, and wrong the moment a pale stone
    // arena went up around it: from outside, a dark bell against a dark sky in
    // a dark bowl read as an empty screen. The sun is low and warm so the
    // pylons and the bowl's cornice catch a hard rim, the sky stays cold behind
    // them, and the bell still reads by contrast because everything AROUND it
    // is lit and it is not.
    lighting: {
      sunIntensity: 1.35,
      sunColor: 0xffc48c,
      hemiIntensity: 0.62,
      skyColor: 0x35526f,
      envScale: 1.0,
      sunAzimuthDeg: 118,
      sunElevationDeg: 15,
    },
    skybox: 'builtin:frost_twilight',
    // A THIN deck hugging the slate. The first pass at 0.42/14 fogged the whole
    // arena white and swallowed the bell; this is just enough to give the plaza
    // a floor mist.
    weather: { mode: 'auto', clouds: { coverage: 0.16, height: 7 } },
    music: { zoneTrack: 'amber' },
    // The bell is audible before it is visible.
    pointSounds: [
      {
        x: DEEPGLASS_CENTER.x,
        z: DEEPGLASS_CENTER.z,
        y: 6,
        sound: 'amb_water',
        radius: 90,
        volume: 0.5,
      },
      // And the city is audible before it is visible on the way back up.
      ...ringPointSounds(),
    ],
    // Scrub the procedural meadow grass off the plaza and the avenue: a mown
    // ground reads as a built arena, and grass poking through a stone plaza is
    // the tell that a map was dropped rather than authored.
    grassClear: [
      { x: DEEPGLASS_CENTER.x, z: DEEPGLASS_CENTER.z, r: DG_PLAZA_R + 4 },
      { x: DEEPGLASS_CENTER.x, z: (DG_PLAZA_R + DG_ARRIVAL.z) / 2, r: 14 },
      // The whole terrace is a paved esplanade now (citadel paintAt r<=103):
      // scrub the meadow to match, in a ring of discs over the concourse.
      ...Array.from({ length: 14 }, (_, i) => {
        const a = (i / 14) * Math.PI * 2;
        return {
          x: DEEPGLASS_CENTER.x + Math.cos(a) * 76,
          z: DEEPGLASS_CENTER.z + Math.sin(a) * 76,
          r: 32,
        };
      }),
      // Groomed ground under each market stall (they stand off the avenue
      // patch above, on the otherwise untouched concourse).
      ...DG_MARKET_STALLS.map((s) => ({ x: s.x, z: s.z, r: 5 })),
      ...ringGrassClear(),
    ],
    waterLevel: DG_WORLD_WATER_LEVEL,
    worldHalfX: DG_WORLD_HALF_X,
    decorationsMode: 'empty',
    presentationMode: 'deepglass',
    // The texture painter's layer: plaza paving, boulevard cobbles, frost lips
    // and the rest, authored from built-in PBR sets so it opens (and repaints)
    // in Studio like any hand-painted map. See citadel.ts's paint section.
    biomePaint: ringBiomePaint(),
    // The terrace stays a plain surface, the stadium's own stone is laid over
    // it and any repaint would fight that. The MASSIF is the opposite case:
    // once there are real peaks on the horizon, slope rock and snow caps are
    // exactly the rules that make them read as mountains rather than green
    // lumps, so those two come on. `rimMountains` stays off: that generates the
    // engine's own world rim, which is precisely what the caldera replaces.
    terrainStyle: {
      slopeRock: true,
      snowCaps: true,
      rimMountains: false,
      shoreSand: false,
    },
    locations: [
      ...ringLocations(),
      {
        name: 'The Deepglass',
        minX: DEEPGLASS_CENTER.x - DEEPGLASS_RADIUS,
        maxX: DEEPGLASS_CENTER.x + DEEPGLASS_RADIUS,
        minZ: DEEPGLASS_CENTER.z - DEEPGLASS_RADIUS,
        maxZ: DEEPGLASS_CENTER.z + DEEPGLASS_RADIUS,
      },
    ],
  };
}

/** Registry entry shaped like a Studio-published map, so ?map=deepglass boots
 *  it through the same path without touching the generated registry file. */
export const DEEPGLASS_MAP_ENTRY = {
  slug: 'deepglass',
  name: 'The Deepglass',
  seed: 20261,
  load: async (): Promise<WorldContent> => buildDeepglassWorld(),
};
