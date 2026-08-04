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
 *   the east quarter  (843, 117) natural 5.5 to 6.9  ->  6.30
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
  { x: 843, z: 117, radius: 22, delta: 6.3, falloff: 'smooth', mode: 'level' },
  { x: 843, z: 117, radius: 15, delta: 6.3, falloff: 'smooth', mode: 'level' },
  { x: 843, z: 117, radius: 9.5, delta: 6.3, falloff: 'flat', mode: 'level' },
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
  // The east quarter: the menders' hall and the houses that face it, on the
  // bench cut into the spine's foot.
  { kind: 'chapel', x: 840.8, z: 115.5, w: 5, d: 7, rot: -2.498, pad: 6.3 },
  { kind: 'house', x: 848.2, z: 110.5, w: 5, d: 5, rot: -2.5, pad: 6.83 },
  { kind: 'house', x: 847.5, z: 119.1, w: 5, d: 5, rot: -2.486, pad: 6.3 },
  { kind: 'house', x: 842.5, z: 125, w: 5, d: 5, rot: -0.829, pad: 6.25 },
  // The muster hall, on the knoll inside the north gate: the first roof you
  // see coming down the shore road, and it looks over the square.
  { kind: 'inn', x: 826.1, z: 101.4, w: 6, d: 7, rot: 0.676, pad: 6.1 },
  // The south bench, the fisher row above the Wreckfields road.
  { kind: 'house', x: 822, z: 143, w: 5, d: 5, rot: 2.361, pad: 8.27 },
  { kind: 'house', x: 817.4, z: 148.7, w: 5, d: 5, rot: 2.345, pad: 8.7 },
  { kind: 'house', x: 827, z: 149.5, w: 5, d: 5, rot: 2.375, pad: 7.9 },
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

export const GULLHAVEN_TERRAIN_EDITS: readonly HeightStamp[] = Object.freeze([
  ...TOWN_BENCHES,
  ...plotPads(),
]);

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
  pier: {
    key: 'kcasWallPillar',
    assetId: '/models/biome/kcas_wall_pillar.glb',
    long: 4,
    thick: 1.5,
    tall: 4,
  },
  jamb: {
    key: 'kcasPillar',
    assetId: '/models/biome/kcas_pillar.glb',
    long: 2.232,
    thick: 1.71,
    tall: 4,
  },
} as const;

/**
 * Pieces are laid every 3.9 yards along a 4.0 yard asset, so a run reads as one
 * wall rather than a dashed line, and each collider is the asset's own footprint
 * instead of a stretched box. The previous pass sized each collider to
 * `edgeLength / panelCount`, which drifted from the 4.0 yard model on every
 * edge whose length was not a multiple of four.
 */
const PIECE_SPACING = 3.9;

/** A gate bay swallows the opening plus both jambs, so nothing is placed inside it. */
const GATE_BAY_CLEAR = GATE_HALF_OPENING + PIECES.jamb.long + PIECES.panel.long / 2 + 0.1;

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

/**
 * Walk the densified curve by arc length, dropping a piece every PIECE_SPACING
 * and skipping each gate bay. Every fourth piece is battered: the town has held
 * this watch for twelve centuries and is currently losing, so a tidy curtain
 * would be the wrong read.
 */
function buildWall(): GullhavenWallPiece[] {
  const curve = densify(GULLHAVEN_WALL_LINE, 0.5);
  const out: GullhavenWallPiece[] = [];
  let travelled = 0;
  let next = PIECE_SPACING / 2;
  let placed = 0;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1];
    const b = curve[i];
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (segLen <= 0) continue;
    while (next <= travelled + segLen) {
      const t = (next - travelled) / segLen;
      const x = a[0] + (b[0] - a[0]) * t;
      const z = a[1] + (b[1] - a[1]) * t;
      next += PIECE_SPACING;
      if (GULLHAVEN_GATES.some((g) => Math.hypot(x - g.x, z - g.z) < GATE_BAY_CLEAR)) continue;
      const piece = placed % 4 === 3 ? PIECES.battered : PIECES.panel;
      placed++;
      out.push({
        id: `gullhaven_wall_${out.length}`,
        key: piece.key,
        assetId: piece.assetId,
        x,
        z,
        w: piece.long,
        d: piece.thick,
        rot: tangentRot(b[0] - a[0], b[1] - a[1]),
        height: piece.tall,
        camGhost: true,
      });
    }
    travelled += segLen;
  }

  // The piece nearest each gate on either side becomes a pier, so the curtain
  // terminates in a mass rather than a cut edge.
  for (const gate of GULLHAVEN_GATES) {
    const rot = wallRotAt(curve, gate.x, gate.z);
    const along = (p: GullhavenWallPiece): number =>
      (p.x - gate.x) * Math.cos(rot) - (p.z - gate.z) * Math.sin(rot);
    for (const side of [-1, 1]) {
      // The NEAREST surviving panel on this side, with no distance cap: the bay
      // clearing plus the piece spacing means the first panel can land anywhere
      // from GATE_BAY_CLEAR to a full spacing beyond it, so a fixed window
      // silently leaves some gates with a cut panel instead of a pier.
      let best: GullhavenWallPiece | undefined;
      for (const p of out) {
        if (Math.hypot(p.x - gate.x, p.z - gate.z) > GATE_BAY_CLEAR + 2 * PIECE_SPACING) continue;
        if (Math.sign(along(p)) !== side) continue;
        if (!best || Math.abs(along(p)) < Math.abs(along(best))) best = p;
      }
      if (!best) continue;
      best.key = PIECES.pier.key;
      best.assetId = PIECES.pier.assetId;
      best.d = PIECES.pier.thick;
    }
    // The jambs: two freestanding pillars whose inner faces sit exactly on the
    // opening, each carrying a bracket torch on the town-facing side so the
    // gateway is lit from inside.
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const offset = GATE_HALF_OPENING + PIECES.jamb.long / 2;
    // Local +z lands on (sin rot, cos rot); the sign that points at the town is
    // the side a torch bracket belongs on.
    const inside = (TOWN_CENTRE.x - gate.x) * sin + (TOWN_CENTRE.z - gate.z) * cos >= 0 ? 1 : -1;
    for (const side of [-1, 1]) {
      out.push({
        id: `gullhaven_gate_${gate.id}_${side > 0 ? 'a' : 'b'}`,
        key: PIECES.jamb.key,
        assetId: PIECES.jamb.assetId,
        x: gate.x + cos * side * offset,
        z: gate.z - sin * side * offset,
        w: PIECES.jamb.long,
        d: PIECES.jamb.thick,
        rot,
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

/** The curve's tangent rotation nearest (x, z). */
function wallRotAt(curve: readonly [number, number][], x: number, z: number): number {
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1];
    const b = curve[i];
    const mx = (a[0] + b[0]) / 2;
    const mz = (a[1] + b[1]) / 2;
    const d = Math.hypot(x - mx, z - mz);
    if (d < bestD) {
      bestD = d;
      best = tangentRot(b[0] - a[0], b[1] - a[1]);
    }
  }
  return best;
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
  // and `bellTower` was a prop no content in the game placed. It stands on the
  // square's north side, where the shore road comes down off the knoll: a street
  // can hear it and stop to count.
  { key: 'bellTower', x: 820.4, z: 105.6, rot: 0, r: 1.1, h: 4.76 },
  // Edda's forge, on the square's south side within reach of her arming table.
  // She is the Redoubt Armorer and reforges the Bellheart's voice at her forge
  // in the finale; she stood in open air until now.
  { key: 'blacksmith', x: 820, z: 124.5, rot: 2.84, r: 1.9, h: 3 },
  { key: 'anvil', x: 822.5, z: 126.5, rot: 0.4, r: 0.5, h: 1 },
  // Triage outside the menders' hall: Saul treats every patient by name, and
  // the last break cost the watch "a morning and two stretchers".
  { key: 'cart', x: 836, z: 111, rot: 0.82, r: 1.1, h: 1.8 },
  { key: 'barrel', x: 835.5, z: 113.3, rot: 0, r: 0.5, h: 1.1 },
  // Star-glass salvage stacked for the mainland buyers Q0 names, on the apron
  // where the harbour road comes up off the pier.
  { key: 'crate', x: 796.2, z: 117.4, rot: 0.3, r: 0.6, h: 1.1 },
  { key: 'crate', x: 800.5, z: 116.5, rot: -0.7, r: 0.6, h: 1.1 },
  { key: 'barrel', x: 794.2, z: 117.7, rot: 0, r: 0.5, h: 1.1 },
]);
