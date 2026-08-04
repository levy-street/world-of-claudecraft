// Gullhaven's redoubt: the landward curtain wall, its gates, and the town
// fittings the lore names but the world never showed.
//
// THE WALL IS A CURTAIN, NOT A RING. It runs from the west shore just north of
// the harbour road, up over the crown of the island's spine north-east of the
// town, and back down to the south-west shore. The sea is its flank at both
// ends, and every road out of Gullhaven passes through a gate. The first pass
// fitted a closed ring to the four original houses and produced a 25 yard pen
// that advertised how small the town was; this line fronts about 4,400 sq yd of
// buildable ground for 192 yards of wall, which is LESS wall than the pen.
//
// Why the north end stops at the west shore instead of reaching further out:
// the west coast is steep only between about z 105 and z 155, where the sea is
// at x 778 and the ground is past 4 yards by x 784. North of that the land
// spreads into a tidal flat 60 yards wide sitting between -3 and +1.5, so a
// line reaching water further north stands a third of its length on wet sand
// and fronts beach it has no reason to hold. Both ends here are within about 4
// and 11 yards of open water.
//
// Data-as-code: the wall is ONE record. Both the renderer's prop placements
// (gullhavenWallProps, spread into FARSHORE_PROPS.decorProps) and the oriented
// boxes in colliders.ts derive from GULLHAVEN_WALL, so the wall you see and the
// wall that stops you cannot drift apart.
//
// Why not the existing `walls[]` channel: that is NOT a generic wall seam. Its
// collider loop is hard-wired to Eastbrook's parapet wing, minting a standable
// parapet top plus TWO pillar colliders per segment at fixed fractional offsets
// (and a mirrored lantern pylon). Pointed at a plain kcas curtain panel it would
// invent collision the asset does not have. So this follows the memorial-rail
// pattern instead: explicit pieces, one oriented box each.

import type { HeightStamp, StaticObbPropDef } from '../types';

/**
 * Gullhaven's ground. The town's one naturally flat place is the hub plateau
 * itself, a dead-level 5.50 about 22 yards across, and that is where the market,
 * the muster and four roads already are. Everything around it is either road
 * band or natural relief a flat building footprint cannot sit on, which is why
 * the first pass could only fit its houses by standing them in the streets.
 *
 * So the town terraces its shoulders, the way a town does. Three benches, each
 * levelled to a target MEASURED off the natural ground under it rather than
 * chosen, so every pass is a shallow cut and fill and no rim becomes a cliff:
 *
 *   the east quarter  (843, 121) natural 5.5 to 6.9  ->  6.30
 *   the north knoll   (826, 101) natural 4.9 to 8.1  ->  6.10
 *   the south bench   (824, 146) natural 7.4 to 9.6  ->  7.90
 *
 * Each bench is three passes, the memorial's pattern: a broad `smooth` level
 * lifts the surround, a mid pass narrows the gap, and a small `flat` pass makes
 * the building ground dead level. A lone wide `flat` pass instead builds a grass
 * cliff at its rim; a lone `smooth` pass only reaches its target at the centre
 * and domes the middle, which puts every footprint corner at a different height.
 *
 * What these deliberately do NOT touch, all pinned in `tests/gullhaven_wall.test.ts`:
 * the harbour's street pocket levelled to 4.40 at (788, 116), which is the ramp
 * off the pier and would become a step if the town drifted; the memorial's 10.40
 * terrace and the graded contour path up to it (MEMORIAL_TERRAIN_EDITS lands
 * AFTER these and re-cuts its own terrace over the result); the hub's flat 5.50;
 * and the coastline, which does not move by a single square yard.
 */
const TOWN_BENCHES: readonly HeightStamp[] = Object.freeze([
  // the east quarter: the town's houses, cut into the foot of the spine
  { x: 843, z: 121, radius: 22, delta: 6.3, falloff: 'smooth', mode: 'level' },
  { x: 843, z: 121, radius: 15, delta: 6.3, falloff: 'smooth', mode: 'level' },
  { x: 843, z: 121, radius: 10, delta: 6.3, falloff: 'flat', mode: 'level' },
  // the north knoll, above the square, inside the north gate
  { x: 826, z: 101, radius: 17, delta: 6.1, falloff: 'smooth', mode: 'level' },
  { x: 826, z: 101, radius: 11, delta: 6.1, falloff: 'smooth', mode: 'level' },
  { x: 826, z: 101, radius: 7, delta: 6.1, falloff: 'flat', mode: 'level' },
  // the south bench, over the Wreckfields road
  { x: 824, z: 146, radius: 18, delta: 7.9, falloff: 'smooth', mode: 'level' },
  { x: 824, z: 146, radius: 12, delta: 7.9, falloff: 'smooth', mode: 'level' },
  { x: 824, z: 146, radius: 8, delta: 7.9, falloff: 'flat', mode: 'level' },
] as HeightStamp[]);

/**
 * Gullhaven's buildings. THE single source: `FARSHORE_PROPS.buildings` spreads
 * this list, and the plot pads below derive from it, so a house cannot be moved
 * without its ground moving too. (The previous pass kept a second hand-copied
 * footprint list in this module to test the wall against, which is exactly how
 * two lists drift.)
 *
 * Every site was SOLVED against the live sim rather than eyeballed: ground
 * between 4.2 and 11, at least 4.6 yards of clearance from the painted road
 * band at every point on the footprint (the band is 4 yards wide and
 * `roadDistance` warps its query by up to 3.5, which is why the previous pass
 * put eight buildings in the streets while measuring 4.2 from the polyline),
 * 2.2 yards of alley between footprints, clear of every NPC, stall, tent,
 * crate, well, watchfire and the graveyard, clear of the memorial precinct, and
 * at least 4 yards inside the curtain.
 *
 * `pad` is the plot's levelled height, measured off the benched ground under
 * that plot at WORLD_SEED, not chosen.
 */
export interface GullhavenBuilding {
  kind: 'house' | 'inn' | 'chapel';
  x: number;
  z: number;
  w: number;
  d: number;
  rot: number;
  /** The plot's levelled height; drives its pad in GULLHAVEN_TERRAIN_EDITS. */
  pad: number;
}

export const GULLHAVEN_BUILDINGS: readonly GullhavenBuilding[] = Object.freeze([
  // ---- the east quarter: ONE STREET, two facing rows, closed at its head ----
  // A lane runs north to south along x 842.5 on the levelled bench, with a row of
  // houses either side of it and the menders' hall across its head. Every
  // rotation here is a right angle, and the pairs sit opposite each other at the
  // same z: that is what makes it read as a street a town laid out rather than
  // as houses that happened to land nearby. Doors face the lane (local +z lands
  // on (sin rot, cos rot), so rot -PI/2 faces west and PI/2 faces east).
  { kind: 'house', x: 838, z: 118, w: 5, d: 5, rot: Math.PI / 2, pad: 6.3 },
  { kind: 'house', x: 847, z: 118, w: 5, d: 5, rot: -Math.PI / 2, pad: 6.3 },
  { kind: 'house', x: 838, z: 126, w: 5, d: 5, rot: Math.PI / 2, pad: 6.3 },
  { kind: 'house', x: 847, z: 126, w: 5, d: 5, rot: -Math.PI / 2, pad: 6.3 },
  // The menders' hall closes the lane's south head, facing back up it: the one
  // building you are looking at the whole way down the street.
  { kind: 'chapel', x: 842.5, z: 134, w: 5, d: 7, rot: Math.PI, pad: 6.3 },

  // ---- the knoll inside the north gate ----
  // The muster hall stands square to the shore road on the knoll above the town,
  // so it is the first roof over the wall as you come down to the north gate,
  // and it addresses the square below.
  { kind: 'inn', x: 826, z: 99, w: 6, d: 7, rot: 0, pad: 6.1 },

  // ---- the south bench: the fisher row ----
  // Two cottages in one line at the same z, facing north back at the town, on
  // the levelled bench above the Wreckfields road.
  { kind: 'house', x: 816, z: 145, w: 5, d: 5, rot: Math.PI, pad: 7.9 },
  { kind: 'house', x: 824, z: 145, w: 5, d: 5, rot: Math.PI, pad: 7.9 },
]);

/**
 * One plot pad per building, levelled to that plot's own `pad` height: a broad
 * `smooth` pass so the rim is a walkable grade, then a `flat` pass across the
 * footprint so the floor is dead level. A building seats on the ground under
 * its DOOR (`buildingTerrainEnvelope`, local +z centre) with no foundation, so
 * without this the far corner of a flat footprint floats or buries itself on
 * even gentle natural relief.
 */
function plotPads(): HeightStamp[] {
  const out: HeightStamp[] = [];
  for (const b of GULLHAVEN_BUILDINGS) {
    const plot = Math.max(b.w, b.d) / 2 + 1.1;
    out.push({
      x: b.x,
      z: b.z,
      radius: plot + 4.5,
      delta: b.pad,
      falloff: 'smooth',
      mode: 'level',
    });
    out.push({ x: b.x, z: b.z, radius: plot, delta: b.pad, falloff: 'flat', mode: 'level' });
  }
  return out;
}

/**
 * The town's benches. These land BEFORE the memorial's grading, so the memorial
 * still cuts its own terrace and contour path into the result.
 */
export const GULLHAVEN_TOWN_BENCHES: readonly HeightStamp[] = TOWN_BENCHES;

/**
 * The plot pads, which land AFTER the memorial's grading. A building floor has to
 * be flat wherever it is, and the memorial's outer domes reach the town's south
 * bench: with the pads landing first, that dome re-tilted the fisher row's plots
 * by up to 0.77 yards corner to corner. Each pad is small and sits at least
 * eleven yards clear of the memorial's own 10.40 terrace, so winning locally
 * here costs the precinct nothing.
 */
export const GULLHAVEN_PLOT_PADS: readonly HeightStamp[] = Object.freeze(plotPads());

/**
 * The curtain's waypoints, west shore to south-west shore. Verified against the
 * real height field in `tests/gullhaven_wall.test.ts`: no piece stands in the
 * sea, the ground under the run stays inside a gentle band, and no adjacent
 * pair of pieces steps more than half a yard.
 */
export const GULLHAVEN_WALL_LINE: readonly (readonly [number, number])[] = Object.freeze([
  [781, 106],
  [790.5, 101],
  [800.5, 96.5],
  [811, 92.5],
  [822, 89],
  [834, 86],
  [845, 84.5],
  [852, 88.5],
  [856, 97],
  [857, 107],
  [855.5, 117],
  [853, 127],
  [849, 137],
  [843, 146],
  [835, 153],
  [825, 158.5],
  [813, 162.5],
  [802, 164.5],
  [795, 165],
] as const);

/**
 * The gates. Each one is a MEASURED crossing of a painted road, not a chosen
 * spot: `tests/gullhaven_wall.test.ts` asserts every gate sits on the wall line
 * AND inside the painted road band, and that every road leaving the town crosses
 * the line at a gate and nowhere else.
 *
 * The north gate is the reason FARSHORE_ROADS gained the shore road. Fisher
 * Bram's escort (`esc_fs_bram`) already walked that line home from the Landing,
 * and the lore calls it the shore road, but it was not a road: he walked over
 * open grass. Without it this wall would have stood across his route with no
 * way through.
 */
export const GULLHAVEN_GATES: readonly { id: string; x: number; z: number }[] = Object.freeze([
  { id: 'north', x: 812.7, z: 91.6 }, // the shore road, up the coast to the Landing
  { id: 'east', x: 854, z: 91.7 }, // the Watch Meadow road, and the breaks beyond it
  { id: 'south', x: 840, z: 149.1 }, // the Wreckfields road
]);

/** Half the clear opening: a 6 yard gateway, comfortably wider than a road. */
const GATE_HALF_OPENING = 3;

/**
 * Piece dimensions, MEASURED off the shipping GLBs rather than chosen. The
 * attributes are int16-normalized (KHR_mesh_quantization), so the accessor
 * bounds divide by 32767; `propAsset` then re-bases each model to min-y 0, so a
 * piece stands ON the ground at its authored height.
 */
const PIECES = {
  panel: { key: 'kcasWall', assetId: '/models/biome/kcas_wall.glb', long: 4, thick: 1, tall: 4 },
  battered: {
    key: 'kcasWallCracked',
    assetId: '/models/biome/kcas_wall_cracked.glb',
    long: 4,
    thick: 1.259,
    tall: 4,
  },
  /**
   * The gate jamb: the kit's wall module WITH an integrated pier, so it is the
   * same 4 yard bay as the curtain and lines up with it exactly. The first pass
   * used the freestanding `kcasPillar` (2.23 long, and narrower and thinner than
   * the wall), which read as two isolated shrine posts standing near a hole in
   * the wall rather than as a gateway.
   */
  jamb: {
    key: 'kcasWallPillar',
    assetId: '/models/biome/kcas_wall_pillar.glb',
    long: 4,
    thick: 1.5,
    tall: 4,
  },
} as const;

/**
 * Pieces are laid at most every 3.9 yards along a 4.0 yard asset, so a run reads
 * as one wall rather than a dashed line, and each collider is the asset's own
 * footprint instead of a stretched box.
 */
const PIECE_SPACING = 3.9;

/** Jamb centres sit this far along the curve from the gate, one either side. */
const JAMB_OFFSET = GATE_HALF_OPENING + PIECES.jamb.long / 2;

/**
 * Half the gate bay: the opening plus both jambs. A curtain run BUTTS UP to this,
 * which is the whole point of measuring the bay in arc length. The first pass
 * skipped any panel whose centre fell within a radius of the gate and let the run
 * carry on with its own fixed spacing, so the first surviving panel landed
 * wherever the rhythm happened to put it: anywhere from the bay edge to a full
 * spacing past it, leaving up to four yards of open grass between the jamb and
 * the wall at every gate.
 */
const GATE_BAY_HALF = JAMB_OFFSET + PIECES.jamb.long / 2;

/** The town's heart, used only to decide which side of the wall a torch faces. */
const TOWN_CENTRE = { x: 822, z: 118 } as const;

export interface GullhavenWallPiece extends StaticObbPropDef {
  /** Prop key the renderer places (see src/render/props.ts). */
  key: string;
  /** Wall-mounted dressing, in the piece's local frame (front on +z). */
  parts?: { key: string; x?: number; y?: number; z?: number; rot?: number }[];
}

/** Centripetal-flavoured Catmull-Rom, the same curve shape the roads use. */
function densify(pts: readonly (readonly [number, number])[], step: number): [number, number][] {
  const out: [number, number][] = [];
  const axis = (a: number, b: number, c: number, d: number, t: number): number =>
    0.5 *
    (2 * b +
      (-a + c) * t +
      (2 * a - 5 * b + 4 * c - d) * t * t +
      (-a + 3 * b - 3 * c + d) * t ** 3);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const steps = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      out.push([axis(p0[0], p1[0], p2[0], p3[0], t), axis(p0[1], p1[1], p2[1], p3[1], t)]);
    }
  }
  out.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]);
  return out;
}

/**
 * A local +X rotated by `rot` about Y lands on (cos rot, -sin rot) in the (x, z)
 * plane, so a piece lies ALONG the curve when rot = atan2(-dz, dx).
 */
function tangentRot(dx: number, dz: number): number {
  return Math.atan2(-dz, dx);
}

/** A point on the curtain's centreline: position, distance travelled, tangent. */
interface CurtainPoint {
  x: number;
  z: number;
  /** arc length from the north end */
  s: number;
  rot: number;
}

function sampleCurtain(): CurtainPoint[] {
  const pts = densify(GULLHAVEN_WALL_LINE, 0.25);
  const out: CurtainPoint[] = [];
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    out.push({ x: pts[i][0], z: pts[i][1], s, rot: tangentRot(b[0] - a[0], b[1] - a[1]) });
  }
  return out;
}

/** The curtain point at arc length `s`, interpolated between samples. */
function atArcLength(curve: readonly CurtainPoint[], s: number): CurtainPoint {
  if (s <= curve[0].s) return curve[0];
  const last = curve[curve.length - 1];
  if (s >= last.s) return last;
  let lo = 0;
  let hi = curve.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (curve[mid].s <= s) lo = mid;
    else hi = mid;
  }
  const a = curve[lo];
  const b = curve[hi];
  const span = b.s - a.s;
  const t = span > 0 ? (s - a.s) / span : 0;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, s, rot: a.rot };
}

/**
 * Build the curtain as RUNS BETWEEN GATE BAYS, measured in arc length. Each run
 * gets whole panels distributed to fill it exactly (count rounded UP, so the
 * spacing shrinks below the 4 yard module and neighbours overlap rather than
 * gap), which lands the first and last panel of every run flush against the
 * jamb beside it and flush with the shore at either end of the line.
 *
 * Every fourth panel is battered: the town has held this watch for twelve
 * centuries and is currently losing, so a tidy curtain would be the wrong read.
 */
function buildWall(): GullhavenWallPiece[] {
  const curve = sampleCurtain();
  const total = curve[curve.length - 1].s;
  const out: GullhavenWallPiece[] = [];

  // each gate's position along the curve, in order from the north end
  const gates = GULLHAVEN_GATES.map((gate) => {
    let best = curve[0];
    let bestD = Number.POSITIVE_INFINITY;
    for (const p of curve) {
      const d = Math.hypot(p.x - gate.x, p.z - gate.z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return { ...gate, s: best.s, rot: best.rot };
  }).sort((a, b) => a.s - b.s);

  // the curtain runs: shore to first bay, bay to bay, last bay to shore
  const runs: [number, number][] = [];
  let cursor = 0;
  for (const gate of gates) {
    runs.push([cursor, gate.s - GATE_BAY_HALF]);
    cursor = gate.s + GATE_BAY_HALF;
  }
  runs.push([cursor, total]);

  let placed = 0;
  for (const [from, to] of runs) {
    const len = to - from;
    if (len < PIECES.panel.long / 2) continue;
    const count = Math.max(1, Math.ceil(len / PIECE_SPACING));
    const step = len / count;
    for (let i = 0; i < count; i++) {
      const at = atArcLength(curve, from + step * (i + 0.5));
      const piece = placed % 4 === 3 ? PIECES.battered : PIECES.panel;
      placed++;
      out.push({
        id: `gullhaven_wall_${out.length}`,
        key: piece.key,
        assetId: piece.assetId,
        x: at.x,
        z: at.z,
        w: piece.long,
        d: piece.thick,
        rot: at.rot,
        height: piece.tall,
        camGhost: true,
      });
    }
  }

  // The jambs: the two wall-and-pier modules that frame each opening, placed ON
  // the curve so they follow it exactly, each carrying a bracket torch on the
  // town-facing side so the gateway is lit from inside.
  for (const gate of gates) {
    for (const side of [-1, 1]) {
      const at = atArcLength(curve, gate.s + side * JAMB_OFFSET);
      // Local +z lands on (sin rot, cos rot); the sign that points at the town
      // is the side a torch bracket belongs on.
      const inside =
        (TOWN_CENTRE.x - at.x) * Math.sin(at.rot) + (TOWN_CENTRE.z - at.z) * Math.cos(at.rot) >= 0
          ? 1
          : -1;
      out.push({
        id: `gullhaven_gate_${gate.id}_${side > 0 ? 'a' : 'b'}`,
        key: PIECES.jamb.key,
        assetId: PIECES.jamb.assetId,
        x: at.x,
        z: at.z,
        w: PIECES.jamb.long,
        d: PIECES.jamb.thick,
        rot: at.rot,
        height: PIECES.jamb.tall,
        camGhost: true,
        parts: [
          {
            key: 'kcasTorchMounted',
            z: inside * (PIECES.jamb.thick / 2 + 0.06),
            y: 2.2,
            rot: inside > 0 ? 0 : Math.PI,
          },
        ],
      });
    }
  }
  return out;
}

export const GULLHAVEN_WALL: readonly GullhavenWallPiece[] = Object.freeze(buildWall());

/** Render placements for the wall, derived from the same record. */
export function gullhavenWallProps(): {
  key: string;
  x: number;
  z: number;
  rot: number;
  parts?: { key: string; x?: number; y?: number; z?: number; rot?: number }[];
}[] {
  return GULLHAVEN_WALL.map((p) => ({
    key: p.key,
    x: p.x,
    z: p.z,
    rot: p.rot,
    ...(p.parts ? { parts: p.parts } : {}),
  }));
}

/**
 * The fittings the lore names and the world never had. Every position is clear
 * of the painted roads, the buildings, the market dressing and the wall, and
 * stands on ground the town actually uses (pinned by `tests/gullhaven_wall.test.ts`).
 */
export const GULLHAVEN_TOWN_PROPS = Object.freeze([
  // THE BELL. The campaign is named for it, the zone's welcome text promises it
  // ("Gullhaven's bell will find you before the town does"), and Tam's greeting
  // spells out its code. Until now all three watchbells stood OUTSIDE the town
  // and `bellTower` was a prop no content in the game placed. It stands where the
  // square meets the head of the houses' street, so it closes the market's east
  // side and every road out of the junction passes under it.
  { key: 'bellTower', x: 832.6, z: 119.3, rot: 0, r: 1.1, h: 4.76 },
  // Edda's forge on the square's south-east shoulder, turned back toward the
  // market, with her anvil out front. She is the Redoubt Armorer and reforges the
  // Bellheart's voice at her forge in the finale; she stood in open air until now.
  { key: 'blacksmith', x: 832, z: 123.5, rot: -2.6, r: 1.9, h: 3 },
  { key: 'anvil', x: 833.5, z: 126.5, rot: 0.4, r: 0.5, h: 1 },
  // Triage beside the menders' hall, off the lane so it never blocks the door:
  // Saul treats every patient by name, and the last break cost the watch "a
  // morning and two stretchers".
  { key: 'cart', x: 847, z: 133, rot: 1.9, r: 1.1, h: 1.8 },
  { key: 'barrel', x: 846.4, z: 135.4, rot: 0, r: 0.5, h: 1.1 },
  // Star-glass salvage stacked for the mainland buyers Q0 names, on the apron
  // where the harbour road comes up off the pier.
  { key: 'crate', x: 800.5, z: 116.5, rot: 0.3, r: 0.6, h: 1.1 },
  { key: 'crate', x: 802.6, z: 115.6, rot: -0.7, r: 0.6, h: 1.1 },
  { key: 'barrel', x: 798.6, z: 117.4, rot: 0, r: 0.5, h: 1.1 },
]);
