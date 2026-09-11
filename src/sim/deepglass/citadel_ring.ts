// Tidehold as a ring city, the 2026-09-07 redesign of the Warden City.
//
// A circular island due north of the Deepglass, three tiers rising to the
// castle at its crown:
//
//   outer ring   (y 6)   The Low Wards: quays and docks all round the rim,
//                        the poor quarters, small shops and stalls, the
//                        stables and drill yard, empty house plots.
//   middle ring  (y 20)  The Trading Ring: the Glass Market, the bank, the
//                        tavern, the smithy, Wardens' Row's tall houses and
//                        gardens with the monument, more house plots.
//   crown        (y 36)  The Warden's Seat: the castle, the Wardens' hall,
//                        the bell tower, the four skybeacons, a walled rim.
//
// Four avenues (south to the arena bridge, east, north, west) cut the tiers
// and climb every tier edge on a flight of stairs; a ring road circles each
// of the lower tiers; four diagonal lanes fill the quarters. The arena sits
// off to the south in its caldera, reached by the Tideway, a Warden bridge
// over the strait, and two more Warden bridges leave the outer ring east and
// west for the beacon terraces on the far shore.
//
// Same asset palette as the city Troy had placed on 2026-09-07 (his Studio
// save; the list at the bottom, ASSET_PALETTE, is the allowlist every
// placement is checked against), just re-laid. Helpers come from citadel.ts
// (placement, walls, stairs, paint swatches); the frame from
// citadel_ring_frame.ts.

import type {
  BiomePaint,
  ColliderVolume,
  CustomPaintSwatch,
  HeightStamp,
  PlacedAsset,
  WorldContent,
} from '../types';
import {
  AUTHORED,
  flame,
  foot,
  H,
  PAINT_CLIFF,
  PAINT_FROST,
  PAINT_GARDEN,
  PAINT_GRAVEL,
  PAINT_KEEP,
  PAINT_PLAZA,
  PAINT_STREET,
  PAINT_WARD,
  PAINT_YARD,
  placeW,
  stairBlock,
  TH_BANK_FLAMES,
  TH_CASTLE_B_FLAMES,
  TH_HALL_FLAMES,
  TH_HEARTH_COLOR,
  TH_LAMP_COLOR,
  TH_MONUMENT,
  TH_RAMP_STEP,
  TH_SEA_FLOOR,
  TH_SWATCHES,
  TH_TAVERN_B_FLAMES,
  TH_TAVERN_FLAMES,
  TH_WATER_Y,
  wallRunW,
} from './citadel';
import {
  bearingDelta,
  faceBearing,
  pol,
  polar,
  RING_AVENUE_HALF_W,
  RING_AVENUES,
  RING_BANK,
  RING_CASTLE,
  RING_CROWN,
  RING_CX,
  RING_CZ,
  RING_LANE_HALF_W,
  RING_LANES,
  RING_MIDDLE,
  RING_MONUMENT,
  RING_OUTER,
  RING_R,
  RING_ROAD_HALF_W,
  RING_SQUARE,
  RING_STAIR_HALF_W,
  RING_STAIR_RUN,
  RING_TAVERN,
  RING_TIERS,
  type RingTier,
} from './citadel_ring_frame';
import { DEEPGLASS_CENTER } from './layout';

// ---------------------------------------------------------------------------
// Fixed geometry the arena side owns (world.ts calderaTerrain), restated so
// the island can re-assert the terrace after the sea is stamped around it.
// ---------------------------------------------------------------------------
const ARENA_TERRACE_R = 104;
const ARENA_PLAZA_R = 44;
const ARENA_PLAZA_LIFT = 0.34;

/** The Tideway: the south bridge, from the arena terrace's north rim to the
 *  island's south quay. Modules tile along z. */
const TIDEWAY_Z0 = ARENA_TERRACE_R + 6; // first module centre
const TIDEWAY_MODULES = 10;
/** The east and west spans: from the quay to the beacon terraces. */
const SPAN_X0 = RING_R + 6;
const SPAN_MODULES = 8;
const BEACON_TERRACE_X = 400;
const BEACON_TERRACE_R = 32;
/** Every bridge deck is level with the outer ring; the kit's piers are 70 yd
 *  under the deck, so a seated module buries its feet in the seabed. */
const BRIDGE_DECK_Y = RING_OUTER.y;
const BRIDGE_PIER_DROP = 70;
const BRIDGE_MODULE = 12;

/** Shallow shelf around the quay, and the open sea beyond it. */
const SHORE_SHELF_Y = -12;
const SEA_Y = TH_SEA_FLOOR;

// ---------------------------------------------------------------------------
// Landmarks (bearings in radians from north, radii in yards)
// ---------------------------------------------------------------------------
const CASTLE = RING_CASTLE;
// The Warden's Hall, Troy calls it the church, moved off the crown onto the
// trading ring on 2026-09-09 ("move the church to the 2nd layer of the ring").
// It sits in the widest free arc of the ring's outer face (between House E at
// -0.6 and the row house at -1.35), facing the ring road like its neighbours.
const HALL = { r: 172, phi: -0.975 };
const BELL_TOWER = { r: 52, phi: 0.95 };
const MARKET_PAVILION = { r: 170, phi: Math.PI - 0.34 };
const MARKET_PLAZA = { r: 145, phi: Math.PI, radius: 26 };
const BANK = RING_BANK;
const TAVERN = RING_TAVERN;
const SMITHY = { r: 168, phi: Math.PI / 2 - 0.42 };
/** The Anchor & Antler (tidehold/tavern_b, bl_tavern_b.py): the Low Wards'
 *  own inn, on the wide arc between the north-east lane and the row houses,
 *  inside the ring road so its porch faces the street. */
const TAVERN_B = { r: 214, phi: 1.2 };
const ROW_HOUSES: readonly { id: string; r: number; phi: number; inside: boolean }[] = [
  { id: 'tidehold/house_b', r: 118, phi: -0.42, inside: true },
  { id: 'tidehold/house_d', r: 118, phi: 0.42, inside: true },
  { id: 'tidehold/house_e', r: 172, phi: -0.6, inside: false },
];
const ROW_SQUARE = { r: RING_SQUARE.r, phi: RING_SQUARE.phi, radius: 22 };
const LOW_HOUSES: readonly { id: string; r: number; phi: number }[] = [
  { id: 'tidehold/house_c', r: 212, phi: 2.05 },
  { id: 'tidehold/house_c', r: 212, phi: -2.05 },
  { id: 'tidehold/house_a', r: 212, phi: Math.PI - 0.45 },
];
/** More houses (Troy, 2026-09-07: "add some more houses and shops using the
 *  same models"): the tall row houses fill the free arcs of the trading ring,
 *  the small houses the poor ring. Bearings sit clear of the avenues, lanes,
 *  plots and the named buildings; `inside` = between the tier's inner edge
 *  and its ring road (faces outward), else between road and outer edge
 *  (faces inward). */
const MORE_HOUSES: readonly { id: string; r: number; phi: number; inside: boolean }[] = [
  // trading ring, outside the ring road
  { id: 'tidehold/house_d', r: 172, phi: 0.3, inside: false },
  { id: 'tidehold/house_b', r: 172, phi: 0.55, inside: false },
  { id: 'tidehold/house_e', r: 172, phi: 1.35, inside: false },
  { id: 'tidehold/house_b', r: 172, phi: -1.35, inside: false },
  { id: 'tidehold/house_d', r: 172, phi: 1.78, inside: false },
  { id: 'tidehold/house_e', r: 172, phi: -1.78, inside: false },
  { id: 'tidehold/house_c', r: 172, phi: 2.56, inside: false },
  { id: 'tidehold/house_b', r: 172, phi: -2.56, inside: false },
  { id: 'tidehold/house_d', r: 172, phi: -2.9, inside: false },
  // trading ring, inside the ring road
  { id: 'tidehold/house_b', r: 118, phi: 0.66, inside: true },
  { id: 'tidehold/house_d', r: 118, phi: -0.66, inside: true },
  // low wards, inside the ring road
  { id: 'tidehold/house_a', r: 210, phi: 2.9, inside: true },
  { id: 'tidehold/house_c', r: 210, phi: -2.9, inside: true },
  { id: 'tidehold/house_a', r: 210, phi: 1.68, inside: true },
  { id: 'tidehold/house_c', r: 210, phi: -1.68, inside: true },
  { id: 'tidehold/house_a', r: 210, phi: 2.18, inside: true },
  { id: 'tidehold/house_a', r: 210, phi: -2.18, inside: true },
  // low wards, between the ring road and the quay
  { id: 'tidehold/house_c', r: 258, phi: 1.66, inside: false },
  { id: 'tidehold/house_a', r: 258, phi: -1.66, inside: false },
  { id: 'tidehold/house_a', r: 258, phi: 1.9, inside: false },
  { id: 'tidehold/house_c', r: 258, phi: -1.9, inside: false },
];
/** Shop rows: stalls and stands along the ring roads, facing the road. */
const STALL_ROWS: readonly { r: number; phi: number; count: number; stand: boolean }[] = [
  { r: 226, phi: 0.2, count: 3, stand: false }, // the Kelp Rows, north
  { r: 226, phi: 0.95, count: 3, stand: true }, // Ropewalk, east
  { r: 244, phi: -0.6, count: 3, stand: false }, // Saltside, west quay side
  { r: 136, phi: -2.3, count: 3, stand: true }, // Lantern Terrace, by the tavern
  { r: 154, phi: 1.55, count: 2, stand: false }, // Coppersmiths' Circle, by the smithy
];
const STABLES = { r: 212, phi: -Math.PI / 2 + 0.36 };
const YARD = { r: 256, phi: -Math.PI / 2 + 0.2, radius: 15 };
const WHARFS: readonly { phi: number }[] = [
  { phi: 2.15 },
  { phi: 2.5 },
  { phi: -2.15 },
  { phi: -2.5 },
];
const WHARF_R = 284;
const SHIPS: readonly { r: number; phi: number; twist: number; h: number }[] = [
  { r: 302, phi: 2.3, twist: 0.15, h: H.ship },
  { r: 304, phi: -2.32, twist: -0.2, h: H.ship * 0.85 },
  { r: 300, phi: 2.66, twist: -0.1, h: H.ship * 0.9 },
];

/** House plots: flat dirt rectangles a player builds on, fenced, with a
 *  for-sale sign at the gate. Inside plots sit between a tier's inner edge and
 *  its ring road, outside plots between the road and the outer edge.
 *
 *  Troy, 2026-09-08: "make the plots 3x bigger each", then "have less plots
 *  and make them vary in size ... quite a bit larger, some small". Three
 *  sizes against the old 14 x 12 ground (small 2.2x, medium 4.1x, large
 *  5.8x), every edge a whole number of 3.5-yard fence panels; a band walks
 *  its ring and takes a plot wherever one clears the avenues, the lanes and
 *  every named building, then keeps an evenly spread handful
 *  (PLOT_BANDS.max), so the count stays small and the sizes alternate along
 *  the road. Price and name derive from the seat: see plotDeed(). */
const PLOT_SEG = 3.5;
export type PlotSize = 'small' | 'medium' | 'large';
export const PLOT_DIMS: Readonly<Record<PlotSize, { w: number; d: number }>> = {
  // Troy, 2026-09-09: "make the land plots 2x the current size", twice the
  // GROUND (63/30, 110/56, 160/80 panels squared, so 2.10x / 1.96x / 2.00x).
  // The growth is mostly along the ring on purpose: a tier only offers ~39 yd
  // of usable depth between its inner cliff and the ring road's kerb, so a plot
  // deeper than 10 panels (35 yd) would spill onto the road or over the edge.
  small: { w: 9 * PLOT_SEG, d: 7 * PLOT_SEG },
  medium: { w: 11 * PLOT_SEG, d: 10 * PLOT_SEG },
  large: { w: 16 * PLOT_SEG, d: 10 * PLOT_SEG },
};
export interface Plot {
  r: number;
  phi: number;
  size: PlotSize;
  /** Along the ring (tangent) and radial extents, yards. */
  w: number;
  d: number;
}
/** Room left between neighbouring plots on a band, yards. */
const PLOT_GAP = 6;
const PLOT_BANDS: readonly { r: number; cycle: readonly PlotSize[]; max: number }[] = [
  { r: 118, cycle: ['large', 'small'], max: 3 }, // trading ring, inside the road
  { r: 170, cycle: ['large', 'medium'], max: 5 }, // trading ring, outside the road (corners clear the rim crest at 190)
  { r: 213, cycle: ['medium', 'small', 'large'], max: 6 }, // low wards, inside the road (clears the bank's toe at 195)
  // Toward the quay: smalls only now that the curtain wall stands at 274,   // the band between the road kerb (241) and the wall is 33 yd, and a medium
  // plot is 35 deep.
  { r: 258, cycle: ['small'], max: 4 },
];
/** Everything a plot must stay off, as a world point plus a clearance radius. */
function plotKeepOuts(): { x: number; z: number; rho: number }[] {
  const out: { x: number; z: number; rho: number }[] = [];
  const at = (seat: { r: number; phi: number }, rho: number): void => {
    const c = pol(seat.r, seat.phi);
    out.push({ x: c.x, z: c.z, rho });
  };
  at(BANK, 17);
  at(TAVERN, 17);
  at(SMITHY, 14);
  at(MARKET_PAVILION, 21);
  at(HALL, 21);
  at(TAVERN_B, 26);
  at(MARKET_PLAZA, MARKET_PLAZA.radius + 3);
  at(ROW_SQUARE, ROW_SQUARE.radius + 3);
  at(RING_MONUMENT, 9);
  at(STABLES, 13);
  at(YARD, YARD.radius + 4);
  for (const h of [...ROW_HOUSES, ...LOW_HOUSES, ...MORE_HOUSES]) at(h, 11);
  for (const row of STALL_ROWS) at(row, row.count * 4 + 5);
  for (const w of WHARFS) at({ r: 272, phi: w.phi }, 14);
  const wiz = pol(MARKET_PLAZA.r + 8, MARKET_PLAZA.phi + 0.08);
  out.push({ x: wiz.x, z: wiz.z, rho: 7 });
  return out;
}
function plotClear(
  plot: Plot,
  keepOuts: readonly { x: number; z: number; rho: number }[],
): boolean {
  for (const av of RING_AVENUES) {
    if (
      Math.abs(bearingDelta(plot.phi, av)) * plot.r <
      plot.w / 2 + RING_AVENUE_HALF_W + RING_STAIR_HALF_W + 2
    )
      return false;
  }
  for (const ln of RING_LANES) {
    if (Math.abs(bearingDelta(plot.phi, ln)) * plot.r < plot.w / 2 + RING_LANE_HALF_W + 4)
      return false;
  }
  const c = pol(plot.r, plot.phi);
  for (const k of keepOuts) {
    const dx = k.x - c.x;
    const dz = k.z - c.z;
    const along = dx * Math.cos(plot.phi) - dz * Math.sin(plot.phi);
    const radial = dx * Math.sin(plot.phi) + dz * Math.cos(plot.phi);
    if (Math.abs(along) < plot.w / 2 + k.rho && Math.abs(radial) < plot.d / 2 + k.rho) return false;
  }
  return true;
}
function plotBand(
  band: { r: number; cycle: readonly PlotSize[]; max: number },
  keepOuts: readonly { x: number; z: number; rho: number }[],
): Plot[] {
  const found: Plot[] = [];
  let phi = -Math.PI;
  let n = 0;
  while (phi < Math.PI) {
    const size = band.cycle[n % band.cycle.length];
    const { w, d } = PLOT_DIMS[size];
    const half = (w / 2 + PLOT_GAP / 2) / band.r;
    const plot: Plot = { r: band.r, phi: phi + half, size, w, d };
    if (plot.phi > Math.PI) break;
    if (plotClear(plot, keepOuts)) {
      found.push(plot);
      n++;
      phi += 2 * half;
    } else {
      phi += 0.04;
    }
  }
  if (found.length <= band.max) return found;
  // keep an even spread of the clear slots, not the first few from the west
  const keep: Plot[] = [];
  for (let i = 0; i < band.max; i++)
    keep.push(found[Math.floor(((i + 0.5) * found.length) / band.max)]);
  return keep;
}
function buildPlots(): { middle: Plot[]; outer: Plot[] } {
  const keepOuts = plotKeepOuts();
  const all = PLOT_BANDS.map((b) => plotBand(b, keepOuts));
  return { middle: [...all[0], ...all[1]], outer: [...all[2], ...all[3]] };
}
const PLOTS = buildPlots();
const MIDDLE_PLOTS: readonly Plot[] = PLOTS.middle;
const OUTER_PLOTS: readonly Plot[] = PLOTS.outer;
/** Every plot on the island, for the tests, the sign roster and the deeds. */
export const RING_PLOTS: readonly Plot[] = [...MIDDLE_PLOTS, ...OUTER_PLOTS];
/** Fence panels round one plot: both long sides less the gate, both short sides. */
export function plotFencePanels(plot: Plot): number {
  const nT = Math.round(plot.w / PLOT_SEG);
  const nR = Math.round(plot.d / PLOT_SEG);
  return 2 * nT - plotGateWidth(nT) + 2 * nR;
}
function plotGateWidth(nT: number): number {
  return nT >= 8 ? 3 : 2;
}
/** The gate opening in a plot's road-side fence: which panels are left out,
 *  and where the gap's centre sits along the ring (yards from the plot's
 *  centre). The gap is NOT centred when the panel count and the gate width
 *  have different parities, so the sign seats read this rather than assuming
 *  symmetry, a sign placed on the assumption stood in the fence. */
export function plotGate(plot: Plot): { first: number; count: number; centre: number } {
  const nT = Math.round(plot.w / PLOT_SEG);
  const count = plotGateWidth(nT);
  const first = Math.floor((nT - count) / 2);
  return { first, count, centre: -plot.w / 2 + (first + count / 2) * PLOT_SEG };
}

/** A plot's deed: the name on the sign and the price on it, in copper. The
 *  price grows with the ground and with closeness to the Warden's Seat (Troy:
 *  "cost in gold based on its location and size, closer to the centre
 *  increases the value"): 0.22 gold per square yard, times 1.0 at the quay
 *  rising to 1.8 at the crown's foot, rounded to whole fives of gold. */
export interface PlotDeed {
  id: string;
  name: string;
  size: PlotSize;
  w: number;
  d: number;
  priceCopper: number;
  r: number;
  phi: number;
}
const GOLD_COPPER = 10_000;
export function plotPrice(plot: Pick<Plot, 'r' | 'w' | 'd'>): number {
  const area = plot.w * plot.d;
  const centre = 1 + 0.8 * ((RING_R - plot.r) / (RING_R - RING_CROWN.r1));
  return Math.round((area * 0.22 * centre) / 5) * 5 * GOLD_COPPER;
}
function plotQuarter(plot: Plot): string {
  const north = Math.cos(plot.phi) >= 0;
  const east = Math.sin(plot.phi) >= 0;
  if (plot.r < RING_OUTER.r0)
    return plot.r < RING_MIDDLE.roadR ? (north ? 'Wardens’ Row' : 'Glass Market') : 'Trading Ring';
  return east ? 'Tidewharf' : 'Gullhaven';
}
export const RING_PLOT_DEEDS: readonly PlotDeed[] = (() => {
  const perQuarter = new Map<string, number>();
  return RING_PLOTS.map((plot, i) => {
    const quarter = plotQuarter(plot);
    const n = (perQuarter.get(quarter) ?? 0) + 1;
    perQuarter.set(quarter, n);
    return {
      id: `plot_${i + 1}`,
      name: `${quarter} Lot ${n}`,
      size: plot.size,
      w: plot.w,
      d: plot.d,
      priceCopper: plotPrice(plot),
      r: plot.r,
      phi: plot.phi,
    };
  });
})();
/** Where a plot's for-sale sign stands: IN its own gate opening, a stride
 *  inside the fence line, with the board hanging across the gap so it reads
 *  face-on from the road.
 *
 *  It stands inside the plot on purpose. The first cut seated it out on the
 *  verge and one sign came down on a dockside crate (Troy, 2026-09-08): the
 *  verge carries the city's own clutter, while a plot's interior is empty by
 *  construction (plotClear keeps every building off it), so the gateway is
 *  the one spot on the ring that cannot collide with anything. */
export interface PlotSignSeat {
  deedId: string;
  x: number;
  z: number;
  rotY: number;
}
function plotRoadSide(plot: Plot): number {
  const roadR = plot.r < RING_OUTER.r0 ? RING_MIDDLE.roadR : RING_OUTER.roadR;
  return plot.r < roadR ? 1 : -1; // +1 = the road lies outward
}
/** How far inside the fence line the post stands, yards. */
const PLOT_SIGN_INSET = 0.7;
/** Distance from the post to the hung board's centre (dg_plot_sign.py). */
const PLOT_SIGN_BOARD_REACH = 1.56;
export const RING_PLOT_SIGNS: readonly PlotSignSeat[] = RING_PLOTS.map((plot, i) => {
  const c = pol(plot.r, plot.phi);
  const tx = Math.cos(plot.phi);
  const tz = -Math.sin(plot.phi);
  const nx = Math.sin(plot.phi);
  const nz = Math.cos(plot.phi);
  const roadSide = plotRoadSide(plot);
  // The post stands inside the gate opening; the arm reaches back across the
  // gap (model front = local -z, so rotY = faceBearing(arm bearing)), which
  // points the board's faces radially, at the road, and at the plot. The
  // board's own centre lands on the gap's centre, so it reads through the gate
  // and every fence panel keeps its distance (the test asserts 1.6 yd).
  const gate = plotGate(plot);
  const along = gate.centre + PLOT_SIGN_BOARD_REACH;
  const radial = plot.d / 2 - PLOT_SIGN_INSET;
  return {
    deedId: RING_PLOT_DEEDS[i].id,
    x: c.x + nx * roadSide * radial + tx * along,
    z: c.z + nz * roadSide * radial + tz * along,
    rotY: faceBearing(plot.phi - Math.PI / 2),
  };
});

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------
function ringOfStamps(
  out: HeightStamp[],
  ringR: number,
  discR: number,
  y: number,
  falloff: 'flat' | 'smooth',
  skip?: (phi: number) => boolean,
): void {
  const n = Math.max(6, Math.ceil((Math.PI * 2 * ringR) / (discR * 0.78)));
  for (let i = 0; i < n; i++) {
    const phi = (i / n) * Math.PI * 2 - Math.PI;
    if (skip && skip(phi)) continue;
    const p = pol(ringR, phi);
    out.push({ x: p.x, z: p.z, radius: discR, delta: y, falloff, mode: 'level' });
  }
}

/** How a tier's rim is shaped. Per tier, because the island is fully built
 *  out: the crown can spill 5yd onto the Trading Ring, the middle only 3
 *  before it reaches the Low Wards' inner plot band, and the quay keeps its
 *  hard harbour edge. `in` eats the tier's own plateau, `out` its neighbour's.
 *
 *  Troy, 2026-09-09: "increase the topo of these levels so its smooth and not
 *  jaggy ... make them nice and smooth but still keep the levels." Two faults
 *  made the old rim, and this fixes both:
 *   - PLAN. A tier was a RING OF DISCS, and the union of circles scalloped its
 *     edge in and out by ~1.7yd every 17yd of arc. That is the row of stone
 *     columns in his screenshot, and no amount of smoothing hides it: a tier
 *     is now ONE concentric disc, so its edge is an exact circle.
 *   - SECTION. 'flat' falloff dropped all 14-16yd between two terrain samples,
 *     so the mesh had a single vertical quad per cell and sawtoothed along the
 *     edge. The drop is now a smootherstep cone laid as concentric discs
 *     RIM_BANK_STEP apart, well under the terrain grid, so it meshes as a
 *     smooth bank with a rounded crest and toe while still reading as a step.
 */
export const RIM_BANK: Readonly<Record<'crown' | 'middle', { in: number; out: number }>> = {
  // Which SIDE a bank eats is forced by what is already built, and the two
  // tiers answer opposite ways. The crown can only give ground inward (the
  // Trading Ring's inner plot band comes within half a yard of the crown's
  // foot), so its wall moved in to make room. The middle can only give ground
  // outward (its own outer plot band is hard against the ring road on one side
  // and the rim on the other), so the Low Wards' inner band and road moved out.
  crown: { in: 8, out: 0 },
  middle: { in: 0, out: 5 },
};
/** Where the four skybeacons stand on the crown's shoulders. Inside the crown
 *  wall, which moved in to clear the rim bank, at the old 88 the wall grew
 *  straight through them (tests/tidehold_ring_city "never grows through
 *  another placement"). The light seats read this too, so the glow cannot
 *  drift away from the prop. */
const TH_BEACON_R = 79;

/** Radial spacing of the bank's discs. Finer than the terrain grid on purpose:
 *  every mesh vertex across the bank then lands on its own height. */
const RIM_BANK_STEP = 0.3;

/** The bank's own profile: a rounded lip, a straight face, a rounded toe.
 *
 *  Not smootherstep, which was the first cut, easing the WHOLE run makes the
 *  middle of the face 1.9x steeper than the average, and with only six yards to
 *  spend on the middle rim that put a 2.6yd step back into a half-yard sample.
 *  Easing just the ends holds the peak at 1/(1-e) of the average (1.4x at
 *  e = 0.3) while still meeting both plateaus without a crease. */
function bankProfile(t: number): number {
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const e = 0.3; // eased fraction at each end
  const m = 1 / (1 - e); // the straight face's slope, so the whole run sums to 1
  if (c < e) return (m * c * c) / (2 * e);
  if (c > 1 - e) return 1 - (m * (1 - c) * (1 - c)) / (2 * e);
  return m * (c - e / 2);
}

/** One tier as an exact circular plateau at `y` whose rim banks down to
 *  `yBelow`. Discs go OUTER FIRST: a level stamp sets everything inside its
 *  radius, so each smaller disc overwrites the middle of the last and the
 *  plateau, pushed last, wins inside the crest. */
function tierWithBank(
  out: HeightStamp[],
  r1: number,
  y: number,
  yBelow: number,
  bank: { in: number; out: number },
): void {
  const crest = r1 - bank.in;
  const foot = r1 + bank.out;
  const n = Math.max(2, Math.round((foot - crest) / RIM_BANK_STEP));
  for (let i = n; i >= 1; i--) {
    const t = i / n; // 1 at the foot, 0 at the crest
    out.push({
      x: RING_CX,
      z: RING_CZ,
      radius: crest + t * (foot - crest),
      delta: y + (yBelow - y) * bankProfile(t),
      falloff: 'flat',
      mode: 'level',
    });
  }
  out.push({ x: RING_CX, z: RING_CZ, radius: crest, delta: y, falloff: 'flat', mode: 'level' });
}

/** Fill the annulus [r0, r1] with flat level discs at height y. The
 *  outermost ring of discs ends exactly at r1, so the tier's edge is a clean
 *  step down to whatever lies outside it. */
function annulus(out: HeightStamp[], r0: number, r1: number, y: number, discR: number): void {
  const step = discR * 0.78;
  let r = r1 - discR;
  const inner = Math.max(0, r0 - discR * 0.5);
  while (r >= inner) {
    if (r <= discR * 0.6) {
      out.push({
        x: RING_CX,
        z: RING_CZ,
        radius: discR + r,
        delta: y,
        falloff: 'flat',
        mode: 'level',
      });
      break;
    }
    ringOfStamps(out, r, discR, y, 'flat');
    r -= step;
  }
}

/** rampW (citadel.ts) for a climb along ANY bearing: one level plateau per
 *  tread from the foot F toward the head, shoulders first then flat bands,
 *  so the flight's stone stands on level ground and the lane rim is exact. */
function rampAlong(
  out: HeightStamp[],
  fx: number,
  fz: number,
  dirPhi: number,
  halfW: number,
  run: number,
  y0: number,
  y1: number,
): void {
  const rise = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.abs(rise) / TH_RAMP_STEP));
  const tread = run / steps;
  const r = Math.max(tread, 3) * 1.1;
  const rimR = halfW * 1.1;
  const across = Math.max(1, Math.ceil((2 * rimR) / (r * 0.78)));
  const dx = Math.sin(dirPhi);
  const dz = Math.cos(dirPhi);
  const nx = Math.cos(dirPhi);
  const nz = -Math.sin(dirPhi);
  const at = (i: number, side: number): { x: number; z: number } => {
    const along = (run * i) / steps + r;
    return { x: fx + dx * along + nx * side, z: fz + dz * along + nz * side };
  };
  const yAt = (i: number): number => y0 + (rise * i) / steps;
  // Shoulders every other tread, and one pair AT the head at the head's own
  // height: a shoulder a riser short of the summit would sag the upper tier
  // for a dozen yards past the flight.
  const shoulderSteps: number[] = [];
  for (let i = 0; i <= steps; i += 2) shoulderSteps.push(i);
  if (shoulderSteps[shoulderSteps.length - 1] !== steps) shoulderSteps.push(steps);
  for (const i of shoulderSteps) {
    for (const side of [-1, 1]) {
      const p = at(i, side * rimR);
      out.push({ x: p.x, z: p.z, radius: 14, delta: yAt(i), falloff: 'smooth', mode: 'level' });
    }
  }
  for (let i = 0; i <= steps; i++) {
    for (let k = 0; k <= across; k++) {
      const p = at(i, -rimR + (2 * rimR * k) / across);
      out.push({ x: p.x, z: p.z, radius: r, delta: yAt(i), falloff: 'flat', mode: 'level' });
    }
  }
}

/** One flight of stairs between two tiers on an avenue: foot on the lower
 *  tier just outside the edge, head on the upper tier just inside it. */
interface Flight {
  fx: number;
  fz: number;
  dirPhi: number;
  run: number;
  y0: number;
  y1: number;
}
function tierFlights(): Flight[] {
  const out: Flight[] = [];
  for (const phi of RING_AVENUES) {
    for (let i = 0; i < RING_TIERS.length - 1; i++) {
      const lo = RING_TIERS[i];
      const hiT = RING_TIERS[i + 1];
      const edge = hiT.r1; // = lo.r0
      const f = pol(edge + 16, phi);
      out.push({
        fx: f.x,
        fz: f.z,
        dirPhi: phi + Math.PI,
        run: RING_STAIR_RUN,
        y0: lo.y,
        y1: hiT.y,
      });
    }
  }
  // The Tideway's arena end: from the terrace (0) up to the deck (6), climbing
  // north along the avenue that leaves the plaza.
  out.push({
    fx: DEEPGLASS_CENTER.x,
    fz: ARENA_TERRACE_R - 28,
    dirPhi: 0,
    run: 26,
    y0: 0,
    y1: BRIDGE_DECK_Y,
  });
  return out;
}

/** Ice tables in the sea round the island, clear of the bridges and wharfs. */
const RING_BERGS: readonly { r: number; phi: number; radius: number; spireH: number }[] = [
  { r: 318, phi: 0.35, radius: 9, spireH: 11 },
  { r: 332, phi: 0.95, radius: 8, spireH: 9 },
  { r: 322, phi: 2.0, radius: 10, spireH: 12 },
  { r: 336, phi: 2.85, radius: 8, spireH: 10 },
  { r: 320, phi: -0.4, radius: 9, spireH: 11 },
  { r: 334, phi: -1.05, radius: 8, spireH: 9 },
  { r: 326, phi: -2.0, radius: 10, spireH: 12 },
  { r: 338, phi: -2.85, radius: 7, spireH: 8 },
  { r: 356, phi: 0.0, radius: 11, spireH: 13 },
  { r: 350, phi: 1.3, radius: 8, spireH: 9 },
  { r: 350, phi: -1.3, radius: 8, spireH: 9 },
];

export function ringTerrain(): HeightStamp[] {
  const out: HeightStamp[] = [];
  // ---- the sea: everything from the quay out to the far shores, and the
  // strait between the arena and the island. Stamped FIRST so every tier disc
  // cuts its plateau out of open water.
  for (const [ringR, discR] of [
    [312, 34],
    [340, 40],
    [372, 44],
    [410, 48],
    [452, 52],
    [500, 56],
  ] as const) {
    ringOfStamps(out, ringR, discR, SEA_Y, 'flat', (phi) => {
      // Never touch the arena terrace or the far-shore ranges' feet.
      const p = pol(ringR, phi);
      const fromArena = Math.hypot(p.x - DEEPGLASS_CENTER.x, p.z - DEEPGLASS_CENTER.z);
      if (fromArena < ARENA_TERRACE_R + discR + 4) return true;
      if (Math.abs(p.x) > 372) return true; // the flank ranges keep their toes
      return p.z > 860; // the backing range keeps its foot
    });
  }
  // ---- the shallow shelf the quay drops onto: a smooth ring that eases from
  // the quay wall down to the shelf, then the deep water beyond.
  ringOfStamps(out, RING_R + 14, 26, SHORE_SHELF_Y, 'smooth');
  // ---- the tiers, outer first: each inner tier overrides the rim of the one
  // below it, so the tier edge is exactly its r1.
  // The quay keeps a hard edge, it is a harbour wall standing in water, and
  // the docks, the bridge landings and the curtain wall are all seated on it,   // but it is one disc now, so the edge is a true circle instead of scallops.
  out.push({
    x: RING_CX,
    z: RING_CZ,
    radius: RING_OUTER.r1,
    delta: RING_OUTER.y,
    falloff: 'flat',
    mode: 'level',
  });
  tierWithBank(out, RING_MIDDLE.r1, RING_MIDDLE.y, RING_OUTER.y, RIM_BANK.middle);
  tierWithBank(out, RING_CROWN.r1, RING_CROWN.y, RING_MIDDLE.y, RIM_BANK.crown);
  // ---- the arena terrace, re-asserted over the sea discs that reach it.
  out.push({
    x: DEEPGLASS_CENTER.x,
    z: DEEPGLASS_CENTER.z,
    radius: ARENA_TERRACE_R,
    delta: 0,
    falloff: 'flat',
    mode: 'level',
  });
  out.push({
    x: DEEPGLASS_CENTER.x,
    z: DEEPGLASS_CENTER.z,
    radius: ARENA_PLAZA_R,
    delta: ARENA_PLAZA_LIFT,
    falloff: 'flat',
    mode: 'level',
  });
  // ---- the stair lanes: stepped plateaus through every tier edge.
  for (const f of tierFlights()) {
    rampAlong(out, f.fx, f.fz, f.dirPhi, RING_STAIR_HALF_W, f.run, f.y0, f.y1);
  }
  // ---- the beacon terraces the east and west spans land on.
  for (const side of [-1, 1]) {
    out.push({
      x: side * BEACON_TERRACE_X,
      z: RING_CZ,
      radius: BEACON_TERRACE_R,
      delta: BRIDGE_DECK_Y,
      falloff: 'flat',
      mode: 'level',
    });
    out.push({
      x: side * (BEACON_TERRACE_X + 22),
      z: RING_CZ,
      radius: BEACON_TERRACE_R - 6,
      delta: BRIDGE_DECK_Y,
      falloff: 'flat',
      mode: 'level',
    });
  }
  // ---- ice tables.
  for (const b of RING_BERGS) {
    const p = pol(b.r, b.phi);
    out.push({
      x: p.x,
      z: p.z,
      radius: b.radius * 1.9,
      delta: TH_WATER_Y - 14,
      falloff: 'smooth',
      mode: 'level',
    });
    out.push({
      x: p.x,
      z: p.z,
      radius: b.radius,
      delta: TH_WATER_Y + 1.6,
      falloff: 'flat',
      mode: 'level',
    });
  }
  return out;
}

/** Declared water: the whole sea round the island and the strait, in discs
 *  (waterLevelAt reads -Infinity outside a declared body). */
export function ringLakes(): { x: number; z: number; radius: number }[] {
  const out: { x: number; z: number; radius: number }[] = [];
  for (const [ringR, discR] of [
    [316, 44],
    [370, 60],
    [440, 70],
    [520, 80],
  ] as const) {
    const n = Math.ceil((Math.PI * 2 * ringR) / (discR * 1.1));
    for (let i = 0; i < n; i++) {
      const p = pol(ringR, (i / n) * Math.PI * 2);
      out.push({ x: p.x, z: p.z, radius: discR });
    }
  }
  // the strait south of the island, both sides of the Tideway
  for (const x of [-150, -75, 0, 75, 150]) out.push({ x, z: 165, radius: 60 });
  return out;
}

/** Nothing rails the ring city off: the bridges carry their own parapets. */
export function ringBlockers(): NonNullable<WorldContent['blockers']> {
  return [];
}

// ---------------------------------------------------------------------------
// Stairs: one solid stepped block + one sloped floor per flight
// ---------------------------------------------------------------------------
function flightRotY(dirPhi: number): number {
  // A placement rotated by rotY maps local +z to world (sin rotY, cos rotY);
  // the block climbs along its local +z, so rotY IS the climb bearing.
  return dirPhi;
}

function flightPieces(f: Flight): { block: PlacedAsset; floor: ColliderVolume } {
  const rise = f.y1 - f.y0;
  const n = Math.max(1, Math.ceil(Math.abs(rise) / TH_RAMP_STEP));
  const riser = rise / n;
  const tread = f.run / n;
  const mid = {
    x: f.fx + Math.sin(f.dirPhi) * (f.run / 2),
    z: f.fz + Math.cos(f.dirPhi) * (f.run / 2),
  };
  const block = stairBlock(0, RING_STAIR_HALF_W, -f.run / 2, f.run / 2, f.y0, n, riser, tread);
  block.x = mid.x;
  block.z = mid.z;
  block.rotY = flightRotY(f.dirPhi);
  // The sloped floor the body walks. world.ts applies a plane's tilt in WORLD
  // axes after its yaw (a yawed plane's rotX still tilts about world x), so a
  // north/south flight pitches about x and an east/west flight rolls about z,
  // both unyawed, with the slant length on the axis the climb runs along.
  // The line sits half a riser plus the stair lift over the tread tops
  // (citadel.ts stairLineOffset).
  const dx = Math.sin(f.dirPhi);
  const dz = Math.cos(f.dirPhi);
  const slant = Math.hypot(f.run, rise);
  const grade = Math.atan2(rise, f.run);
  const alongZ = Math.abs(dz) >= Math.abs(dx);
  const floor: ColliderVolume = {
    kind: 'plane',
    x: mid.x,
    z: mid.z,
    rotY: 0,
    sizeX: alongZ ? RING_STAIR_HALF_W * 2 : slant,
    sizeY: (f.y0 + f.y1) / 2 + riser / 2 + 0.08,
    sizeZ: alongZ ? slant : RING_STAIR_HALF_W * 2,
    detached: true,
    groundY: 0,
  };
  // world.ts: the floor DROPS toward local +z for positive rotX, and RISES
  // toward +x for positive rotZ (floor = base + dx * tan rotZ).
  if (alongZ) floor.rotX = -Math.sign(dz) * grade;
  else floor.rotZ = Math.sign(dx) * grade;
  return { block, floor };
}

export function ringColliderVolumes(): ColliderVolume[] {
  return tierFlights().map((f) => flightPieces(f).floor);
}

// ---------------------------------------------------------------------------
// Placements
// ---------------------------------------------------------------------------
type Out = PlacedAsset[];

/** A wall run along an arc of the circle, module by module. The module index
 *  runs across the whole arc: laying one module per wallRunW call restarted its
 *  counter every time, so every module came out a PILLAR and no plain wall
 *  panel was ever placed. */
function wallArc(out: Out, r: number, phi0: number, phi1: number, heightYd: number): void {
  const len = Math.abs(phi1 - phi0) * r;
  const modules = Math.max(1, Math.round(len / heightYd));
  for (let i = 0; i < modules; i++) {
    const a = phi0 + ((phi1 - phi0) * i) / modules;
    const b = phi0 + ((phi1 - phi0) * (i + 1)) / modules;
    const pa = pol(r, a);
    const pb = pol(r, b);
    wallRunW(out, pa.x, pa.z, pb.x, pb.z, heightYd, { pillarEvery: 4, startIndex: i });
  }
}

/** Bearing brought into (-PI, PI]. */
function normBearing(a: number): number {
  let b = a;
  while (b > Math.PI) b -= Math.PI * 2;
  while (b <= -Math.PI) b += Math.PI * 2;
  return b;
}

/**
 * A curtain wall right round the ring at radius `r`, left open at each bearing
 * in `gates` (a `gateYd`-wide gap, measured along the ring).
 *
 * The gates are SORTED before the walk. RING_AVENUES descends (PI, PI/2, 0,
 * -PI/2), so pairing each entry with the next one wrapped every arc the long
 * way round the circle: the crown's rampart was laid four times over, ~120
 * modules where 30 belong, every one of them sitting inside its neighbours
 * (Troy, 2026-09-09: "make sure the walls are not overlapping they are right
 * now"). Sorted, consecutive arcs tile the circle exactly once.
 */
interface WallGate {
  phi: number;
  /** Opening measured along the ring, yards. */
  widthYd: number;
}
function ringWall(out: Out, r: number, heightYd: number, gates: readonly WallGate[]): void {
  const sorted = gates
    .map((g) => ({ phi: normBearing(g.phi), half: g.widthYd / 2 / r }))
    .sort((a, b) => a.phi - b.phi);
  for (let i = 0; i < sorted.length; i++) {
    const next =
      i + 1 < sorted.length
        ? sorted[i + 1]
        : { phi: sorted[0].phi + Math.PI * 2, half: sorted[0].half };
    const a = sorted[i].phi + sorted[i].half;
    const b = next.phi - next.half;
    if (b - a < heightYd / r) continue; // no room for even one module
    wallArc(out, r, a, b, heightYd);
  }
}

/** The crown's rampart: a wall round the crown rim, open at the four gates. */
function crownWalls(out: Out): void {
  const gap = 0.19;
  // Four yards inside the bank's crest, on flat ground: the rim is a slope now.
  const r = RING_CROWN.r1 - RIM_BANK.crown.in - 4;
  // The south gate is the wide one: its two gate towers stand INSIDE the mouth,
  // so the wall has to start beyond them or it grows through their stonework.
  ringWall(
    out,
    r,
    H.innerCurtain,
    RING_AVENUES.map((phi) => ({
      phi,
      widthYd: Math.abs(normBearing(phi - Math.PI)) < 1e-6 ? 62 : gap * 2 * r,
    })),
  );
  // Gate towers flank the south gate; the tower houses hold the east and west.
  for (const side of [-1, 1]) {
    const p = pol(r, Math.PI + side * (gap + 0.05));
    placeW(out, 'deepglass/warden_tower', p.x, p.z, H.keepTower, {
      collide: foot('deepglass/warden_tower', H.keepTower).w * 0.42,
    });
  }
  // Past the bank's foot, not on its face: the crown rim is a slope now
  // (RIM_BANK.crown), and r + 6 stood these two tower houses half way down it.
  const spireR = RING_CROWN.r1 + RIM_BANK.crown.out + 3;
  const east = pol(spireR, Math.PI / 2 + gap + 0.08);
  placeW(out, 'deepglass/warden_tower_spire', east.x, east.z, 24.1, {
    rotY: faceBearing(Math.PI / 2 + Math.PI),
    collide: 4,
  });
  const west = pol(spireR, -Math.PI / 2 - gap - 0.08);
  placeW(out, 'deepglass/warden_tower_spire_c', west.x, west.z, 20, {
    rotY: faceBearing(-Math.PI / 2 + Math.PI),
    collide: 4,
  });
}

/**
 * The Low Wards' curtain: one wall right round the outer tier, evenly spaced,
 * replacing the two stubs that used to sit either side of the south bridgehead
 * (Troy, 2026-09-09: "evenly distribute the walls around the 3rd ring").
 *
 * It stands at 274, three yards inside the last solid ground, the shelf runs
 * flat to ~277 and the sea cliff starts at 279, and opens at the four avenues
 * (the Tide Gate south, the two bridges east and west, the north road) plus
 * every wharf, so the quays stay reachable from inside.
 */
// 276 (was 274): the Low Wards now carry the Trading Ring's rim bank as well
// as both plot bands, and the quay band needed the two yards.
const OUTER_WALL_R = 276;
function outerWalls(out: Out): void {
  // Each pair of wharfs shares ONE harbour mouth: they sit 0.35 rad apart with
  // the quay's dock platforms between them, all of it on the wall's own line.
  const harbour = [2.325, -2.325].map((phi) => ({ phi, widthYd: 130 }));
  ringWall(out, OUTER_WALL_R, H.curtain, [
    ...RING_AVENUES.map((phi) => ({ phi, widthYd: 30 })),
    ...harbour,
  ]);
}

function crown(out: Out): void {
  const c = pol(CASTLE.r, CASTLE.phi);
  // Castle B (bl_castle_b.py): the WoW-style walled keep that replaced the
  // first keep on 2026-09-10, nine round towers, a gatehouse, a great hall
  // with two wings. Same seat and facing, so nothing else on the crown moved.
  placeW(out, 'tidehold/castle_b', c.x, c.z, AUTHORED.castle_b, {
    rotY: 0,
    collide: 3,
    fireEffects: TH_CASTLE_B_FLAMES,
  });
  const h = pol(HALL.r, HALL.phi);
  placeW(out, 'tidehold/hall', h.x, h.z, AUTHORED.hall, {
    rotY: HALL.phi,
    collide: 3,
    fireEffects: TH_HALL_FLAMES,
  });
  const b = pol(BELL_TOWER.r, BELL_TOWER.phi);
  placeW(out, 'props/bell_tower', b.x, b.z, 14, { collide: 2.2 });
  // crystals and spires flank the south gate inside the rampart
  for (const side of [-1, 1]) {
    const p = pol(84, Math.PI + side * 0.3);
    placeW(out, 'props/crystal_amethyst_cluster', p.x, p.z, H.crystal, { collide: 2.4 });
    const s = pol(72, Math.PI + side * 0.42);
    placeW(out, 'props/frostveil_ice_spire', s.x, s.z, H.spire, { rotY: side * 0.7 });
  }
  // the four skybeacons on the crown's shoulders
  for (const phi of RING_LANES) {
    const p = pol(TH_BEACON_R, phi);
    placeW(out, 'props/tidehold_skybeacon', p.x, p.z, H.beacon, { collide: 6 });
  }
  crownWalls(out);
}

function middle(out: Out): void {
  const m = pol(MARKET_PAVILION.r, MARKET_PAVILION.phi);
  placeW(out, 'tidehold/market', m.x, m.z, AUTHORED.market, {
    rotY: MARKET_PAVILION.phi,
    collide: 2.5,
  });
  const bk = pol(BANK.r, BANK.phi);
  placeW(out, 'tidehold/bank', bk.x, bk.z, AUTHORED.bank, {
    rotY: BANK.phi,
    collide: 2.5,
    fireEffects: TH_BANK_FLAMES,
  });
  const chest = pol(BANK.r - 14, BANK.phi + 0.06);
  placeW(out, 'props/banker_chest', chest.x, chest.z, 1.9, {
    rotY: BANK.phi + Math.PI,
    collide: 1.1,
  });
  const tv = pol(TAVERN.r, TAVERN.phi);
  placeW(out, 'tidehold/tavern', tv.x, tv.z, AUTHORED.tavern, {
    rotY: TAVERN.phi,
    collide: 2.5,
    fireEffects: TH_TAVERN_FLAMES,
  });
  const sm = pol(SMITHY.r, SMITHY.phi);
  placeW(out, 'tidehold/smithy', sm.x, sm.z, AUTHORED.smithy, { rotY: SMITHY.phi, collide: 2.5 });
  for (const hs of ROW_HOUSES) {
    const p = pol(hs.r, hs.phi);
    placeW(out, hs.id, p.x, p.z, AUTHORED[hs.id.split('/')[1] as keyof typeof AUTHORED], {
      rotY: hs.inside ? hs.phi + Math.PI : hs.phi,
      collide: 2.5,
    });
  }
  // Baldemar's Square: the Realm Builder monument at the Glass Market
  // crossroads, facing south down the avenue toward the Tideway. Its yaw is
  // TH_MONUMENT's, the same seat the interaction entity spawns on.
  const mon = pol(RING_MONUMENT.r, RING_MONUMENT.phi);
  placeW(out, 'props/eastbrook_realm_builder_monument', mon.x, mon.z, TH_MONUMENT.height, {
    rotY: TH_MONUMENT.rotY,
    collide: TH_MONUMENT.collide,
  });
  // Wardens' Garden: flower beds fenced at the corners, on the north avenue.
  const sq = pol(ROW_SQUARE.r, ROW_SQUARE.phi);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    placeW(out, 'props/flower_bed_round', sq.x + Math.cos(a) * 9, sq.z + Math.sin(a) * 9, 0.9, {});
  }
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    placeW(out, 'props/garden_iron_fence', sq.x + sx * 15, sq.z + sz * 12, 1.6, {
      rotY: sz < 0 ? 0 : Math.PI,
      collide: 1.8,
      custom: true,
      square: true,
    });
  }
  // The Glass Market: stalls and stands round the south plaza, the notice
  // board where the avenue enters it.
  const plaza = pol(MARKET_PLAZA.r, MARKET_PLAZA.phi);
  const stallSlots: readonly [number, number, string][] = [
    [-18, -14, 'props/eastbrook_market_stall'],
    [18, -14, 'props/eastbrook_market_stall'],
    [-18, 14, 'props/eastbrook_market_stall'],
    [18, 14, 'props/eastbrook_market_stall'],
    [-26, 0, 'props/eastbrook_market_stall'],
    [26, 0, 'props/eastbrook_market_stall'],
    [-12, -22, 'props/market_stand_1'],
    [12, -22, 'props/market_stand_2'],
    [-12, 22, 'props/market_stand_1'],
    [12, 22, 'props/market_stand_2'],
    [-24, -8, 'props/market_stand_1'],
    [24, 8, 'props/market_stand_2'],
  ];
  for (const [dx, dz, id] of stallSlots) {
    const x = plaza.x + dx;
    const z = plaza.z + dz;
    placeW(out, id, x, z, id.includes('stall') ? 4.2 : 2.6, {
      rotY: Math.atan2(plaza.x - x, plaza.z - z),
      collide: 1.6,
      custom: true,
      square: true,
    });
  }
  const nb = pol(MARKET_PLAZA.r + 30, MARKET_PLAZA.phi - 0.1);
  placeW(out, 'props/eastbrook_noticeboard', nb.x, nb.z, 3.4, { rotY: Math.PI, collide: 0.9 });
  // smithy yard clutter
  for (let i = 0; i < 3; i++) {
    const p = pol(SMITHY.r - 16, SMITHY.phi + 0.02 + i * 0.03);
    placeW(out, i === 1 ? 'props/barrel' : 'props/crate_wooden', p.x, p.z, 1.2, {
      rotY: i * 0.7,
      collide: 0.5,
    });
  }
}

function outer(out: Out): void {
  for (const hs of LOW_HOUSES) {
    const p = pol(hs.r, hs.phi);
    placeW(out, hs.id, p.x, p.z, AUTHORED[hs.id.split('/')[1] as keyof typeof AUTHORED], {
      rotY: hs.phi + Math.PI,
      collide: 2.5,
    });
  }
  // Saltside: the stables and the drill yard.
  const st = pol(STABLES.r, STABLES.phi);
  placeW(out, 'biome/hexb_stables', st.x, st.z, H.stables, {
    rotY: STABLES.phi + Math.PI,
    collide: foot('biome/hexb_stables', H.stables).w * 0.4,
  });
  const yard = pol(YARD.r, YARD.phi);
  const yardItems: readonly [string, number, number, number][] = [
    ['biome/hex_target', -9, -8, 2.2],
    ['biome/hex_target', -9, 8, 2.2],
    ['biome/hex_target', 9, -8, 2.2],
    ['biome/hex_target', 9, 8, 2.2],
    ['biome/hex_weaponrack', -4, -12, 2.0],
    ['biome/hex_weaponrack', 0, -12, 2.0],
    ['biome/hex_weaponrack', 4, -12, 2.0],
    ['biome/hex_weaponrack', -4, 12, 2.0],
    ['biome/hex_weaponrack', 0, 12, 2.0],
    ['biome/hex_weaponrack', 4, 12, 2.0],
    ['biome/hex_haybale', -12, -2, 1.3],
    ['biome/hex_haybale', -12, 2, 1.3],
    ['biome/hex_haybale', 12, -2, 1.3],
    ['biome/hex_haybale', 12, 2, 1.3],
    ['biome/hex_trough', 0, -4, 1.0],
    ['biome/hex_trough', 0, 4, 1.0],
  ];
  for (const [id, dx, dz, h] of yardItems) {
    placeW(out, id, yard.x + dx, yard.z + dz, h, { rotY: YARD.phi, collide: 0.6, custom: true });
  }
  // The wharfs: quay pieces along the rim, ships moored off them, and the
  // clutter of a working harbour.
  for (const w of WHARFS) {
    const p = pol(WHARF_R, w.phi);
    placeW(out, 'biome/hexb_docks', p.x, p.z, 12, {
      rotY: w.phi,
      collide: foot('biome/hexb_docks', 12).w * 0.35,
    });
  }
  for (const s of SHIPS) {
    const p = pol(s.r, s.phi);
    placeW(out, 'biome/hex_ship_blue', p.x, p.z, s.h, {
      rotY: s.phi + s.twist,
      collide: 5,
      seatY: TH_WATER_Y - 3,
    });
  }
  for (let i = 0; i < 3; i++) {
    const p = pol(RING_R - 6, 2.32 + i * 0.05);
    placeW(out, 'props/dock_platform', p.x, p.z, 1.4, { rotY: 2.32 });
  }
  const clutter: readonly [string, number, number, number][] = [
    ['props/barrel', 262, 2.1, 1.2],
    ['props/barrel', 264, 2.13, 1.2],
    ['props/barrel', 262, 2.16, 1.2],
    ['props/barrel', 266, 2.4, 1.2],
    ['props/barrel', 268, 2.43, 1.2],
    ['props/barrel', 262, -2.1, 1.2],
    ['props/barrel', 264, -2.13, 1.2],
    ['props/barrel', 266, -2.4, 1.2],
    ['props/barrel', 268, -2.43, 1.2],
    ['props/crate_wooden', 260, 2.25, 1.3],
    ['props/crate_wooden', 263, 2.28, 1.3],
    ['props/crate_wooden', 260, -2.25, 1.3],
    ['props/crate_wooden', 263, -2.28, 1.3],
    ['props/farmcrate_apple', 258, -2.35, 1.0],
    ['props/farmcrate_apple', 260, -2.37, 1.0],
    ['props/farmcrate_apple', 262, -2.39, 1.0],
    ['props/farmcrate_apple', 258, 2.6, 1.0],
    ['props/farmcrate_apple', 260, 2.62, 1.0],
    ['props/farmcrate_apple', 262, 2.64, 1.0],
    ['biome/hex_sack', 259, 2.45, 1.0],
    ['biome/hex_sack', 261, -2.47, 1.0],
    ['biome/hex_barrel', 265, 2.2, 1.2],
    ['biome/hex_barrel', 265, -2.2, 1.2],
    ['biome/hex_crate_big', 266, 2.55, 1.8],
    ['biome/hex_crate_open', 268, 2.58, 1.2],
    ['biome/hex_lumber', 270, -2.55, 1.6],
    ['biome/hex_wheelbarrow', 268, -2.6, 1.4],
    ['biome/hex_anchor', 267, 2.0, 6], // inside the curtain wall (which stands at 274)
  ];
  for (const [id, r, phi, h] of clutter) {
    const p = pol(r, phi);
    placeW(out, id, p.x, p.z, h, {
      rotY: phi + (r % 2) * 0.4,
      collide: id.includes('anchor') ? 0 : 0.5,
    });
  }
  // Gullhaven's fish market: the small stalls of the poor quarter.
  const fish = pol(232, -2.32);
  const stalls: readonly [number, number, string][] = [
    [-9, -6, 'props/eastbrook_market_stall'],
    [9, -6, 'props/eastbrook_market_stall'],
    [-9, 6, 'props/eastbrook_market_stall'],
    [9, 6, 'props/eastbrook_market_stall'],
    [0, -12, 'props/market_stand_1'],
    [0, 12, 'props/market_stand_2'],
  ];
  for (const [dx, dz, id] of stalls) {
    const x = fish.x + dx;
    const z = fish.z + dz;
    placeW(out, id, x, z, id.includes('stall') ? 4.2 : 2.6, {
      rotY: Math.atan2(fish.x - x, fish.z - z),
      collide: 1.6,
      custom: true,
      square: true,
    });
  }
  // A pair of stalls on the Tidewharf side too.
  for (const dphi of [-0.05, 0.05]) {
    const p = pol(232, 2.32 + dphi);
    placeW(out, 'props/eastbrook_market_stall', p.x, p.z, 4.2, {
      rotY: 2.32 + Math.PI,
      collide: 1.6,
      custom: true,
      square: true,
    });
  }
  outerWalls(out);
}

/** Every house plot fenced with the garden iron fence, a gate gap left on the
 *  side that faces the plot's ring road. Segments are 3.5 yd (the fence's
 *  4-unit run at 1.925 tall): four along each tangent side, three along each
 *  radial side starting from the back corner, so the only open corner is at
 *  the gate. */
function plotFences(out: Out): void {
  const SEG = PLOT_SEG;
  const FENCE_H = (SEG / 4) * 2.2;
  const fence = (x: number, z: number, rotY: number): void => {
    placeW(out, 'props/garden_iron_fence', x, z, FENCE_H, { rotY, collide: 1.2 });
  };
  const roadOf = (plot: Plot): number =>
    plot.r < RING_OUTER.r0 ? RING_MIDDLE.roadR : RING_OUTER.roadR;
  for (const plot of RING_PLOTS) {
    const c = pol(plot.r, plot.phi);
    const tx = Math.cos(plot.phi);
    const tz = -Math.sin(plot.phi);
    const nx = Math.sin(plot.phi);
    const nz = Math.cos(plot.phi);
    const roadSide = plot.r < roadOf(plot) ? 1 : -1; // +1 = the road lies outward
    const nT = Math.round(plot.w / SEG);
    const nR = Math.round(plot.d / SEG);
    const { first: gate0, count: gateN } = plotGate(plot);
    for (const side of [-1, 1]) {
      // tangent side at +-d/2 along the radial: the gate gap faces the road
      const gate = side === roadSide;
      for (let k = 0; k < nT; k++) {
        if (gate && k >= gate0 && k < gate0 + gateN) continue;
        const a = -plot.w / 2 + SEG * (k + 0.5);
        fence(
          c.x + nx * side * (plot.d / 2) + tx * a,
          c.z + nz * side * (plot.d / 2) + tz * a,
          plot.phi,
        );
      }
      // radial side at +-w/2 along the tangent, laid from the back corner
      for (let k = 0; k < nR; k++) {
        const a = -roadSide * (plot.d / 2) + roadSide * SEG * (k + 0.5);
        fence(
          c.x + tx * side * (plot.w / 2) + nx * a,
          c.z + tz * side * (plot.w / 2) + nz * a,
          plot.phi + Math.PI / 2,
        );
      }
    }
  }
  // The for-sale sign at every gate (dg_plot_sign.py, authored 2.58 yd tall;
  // the click target is the sim's plot-sign entity on the same seat, plots.ts).
  for (const sign of RING_PLOT_SIGNS) {
    // 2.2 = TARGET_H, i.e. placement scale 1: the sign is authored at its
    // final 2.48 yd (asset_scale targetHeightFor returns its max dim), so any
    // other height here silently rescales the art away from its collision.
    placeW(out, 'props/plot_sign', sign.x, sign.z, 2.2, { rotY: sign.rotY, collide: 0.5 });
  }
}

function lowWardInn(out: Out): void {
  const p = pol(TAVERN_B.r, TAVERN_B.phi);
  placeW(out, 'tidehold/tavern_b', p.x, p.z, AUTHORED.tavern_b, {
    rotY: TAVERN_B.phi + Math.PI, // inside the ring road: the porch faces out to it
    collide: 3,
    fireEffects: TH_TAVERN_B_FLAMES,
  });
}

function moreHouses(out: Out): void {
  for (const hs of MORE_HOUSES) {
    const p = pol(hs.r, hs.phi);
    placeW(out, hs.id, p.x, p.z, AUTHORED[hs.id.split('/')[1] as keyof typeof AUTHORED], {
      rotY: hs.inside ? hs.phi + Math.PI : hs.phi,
      collide: 2.5,
    });
  }
  for (const row of STALL_ROWS) {
    const road = row.r < RING_OUTER.r0 ? RING_MIDDLE.roadR : RING_OUTER.roadR;
    const facing = row.r < road ? row.phi + Math.PI : row.phi; // front to the road
    for (let k = 0; k < row.count; k++) {
      const dphi = ((k - (row.count - 1) / 2) * 6.5) / row.r;
      const p = pol(row.r, row.phi + dphi);
      const id = row.stand
        ? k % 2 === 0
          ? 'props/market_stand_1'
          : 'props/market_stand_2'
        : 'props/eastbrook_market_stall';
      placeW(out, id, p.x, p.z, row.stand ? 2.6 : 4.2, {
        rotY: facing,
        collide: 1.6,
        custom: true,
        square: true,
      });
    }
  }
}

/** Crystal lamps: both sides of every ring road and avenue, a ring round the
 *  crown plaza, and the two beacon terraces. */
function lamps(out: Out): void {
  // A road lamp and a plot's for-sale sign both want the verge, and the plot
  // bands moved onto the roads' shoulders when the tier rims were banked. The
  // sign is the one a player walks up to and clicks, so the lamp yields.
  const lamp = (x: number, z: number, rotY: number): void => {
    for (const sign of RING_PLOT_SIGNS) {
      if (Math.hypot(sign.x - x, sign.z - z) < 3) return;
    }
    // The crown plaza's lamp ring (r 47) passes through Castle B's hall: the
    // keep is 67 yd wide now and the ring was laid for the old one.
    const keep = pol(CASTLE.r, CASTLE.phi);
    if (Math.abs(x - keep.x) < 34 && z > keep.z - 33 && z < keep.z + 27) return;
    placeW(out, 'props/streetlamp_veiled_crystal', x, z, H.lamp, {
      rotY,
      collide: 0.6,
      custom: true,
    });
  };
  for (const tier of [RING_OUTER, RING_MIDDLE]) {
    for (const side of [-1, 1]) {
      const r = tier.roadR + side * (RING_ROAD_HALF_W + 1.2);
      const n = Math.ceil((Math.PI * 2 * r) / 34);
      for (let i = 0; i < n; i++) {
        const phi = (i / n) * Math.PI * 2;
        // leave the avenue mouths and lane mouths clear
        if (RING_AVENUES.some((a) => Math.abs(bearingDelta(phi, a)) * r < RING_AVENUE_HALF_W + 3))
          continue;
        if (RING_LANES.some((a) => Math.abs(bearingDelta(phi, a)) * r < RING_LANE_HALF_W + 2))
          continue;
        const p = pol(r, phi);
        lamp(p.x, p.z, side < 0 ? phi + Math.PI : phi);
      }
    }
  }
  for (const phi of RING_AVENUES) {
    for (let r = 46; r <= RING_R - 8; r += 24) {
      // skip the stair lanes and the ring roads
      if (RING_TIERS.some((t) => t.r1 < RING_R && Math.abs(r - t.r1) < 22)) continue;
      if ([RING_OUTER, RING_MIDDLE].some((t) => Math.abs(r - t.roadR) < RING_ROAD_HALF_W + 3))
        continue;
      for (const side of [-1, 1]) {
        const nx = Math.cos(phi);
        const nz = -Math.sin(phi);
        const c = pol(r, phi);
        lamp(
          c.x + nx * side * (RING_AVENUE_HALF_W + 1.2),
          c.z + nz * side * (RING_AVENUE_HALF_W + 1.2),
          phi + (side < 0 ? Math.PI / 2 : -Math.PI / 2),
        );
      }
    }
  }
  for (let i = 0; i < 12; i++) {
    const phi = (i / 12) * Math.PI * 2;
    if (RING_AVENUES.some((a) => Math.abs(bearingDelta(phi, a)) < 0.12)) continue;
    const p = pol(82, phi);
    lamp(p.x, p.z, phi);
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      lamp(side * BEACON_TERRACE_X + Math.cos(a) * 20, RING_CZ + Math.sin(a) * 20, a);
    }
  }
}

/** The three Warden bridges. Modules tile along their local X; every deck is
 *  level with the outer ring and the piers sink to the seabed. */
function bridges(out: Out): void {
  const pattern = [
    'lamp',
    'deck',
    'deck',
    'pylon',
    'deck',
    'deck',
    'pylon',
    'deck',
    'deck',
    'lamp',
  ];
  // The kit is authored in yards (asset_scale.ts BRIDGE_KIT_MAX_DIM keeps it
  // at scale 1), so these bypass hi(): a module IS a 12 yd square deck.
  const module = (kind: string, x: number, z: number, rotY: number): void => {
    out.push({
      path: `/models/deepglass/bridge_${kind}.glb`,
      x,
      z,
      rotY,
      scale: 1,
      collideRadius: 6,
      detached: true,
      groundY: BRIDGE_DECK_Y - BRIDGE_PIER_DROP,
    });
  };
  // The Tideway, south: local X along world z.
  for (let k = 0; k < TIDEWAY_MODULES; k++) {
    module(
      pattern[k % pattern.length],
      DEEPGLASS_CENTER.x,
      TIDEWAY_Z0 + k * BRIDGE_MODULE,
      -Math.PI / 2,
    );
  }
  // The east and west spans.
  for (const side of [-1, 1]) {
    for (let k = 0; k < SPAN_MODULES; k++) {
      const kind = k === 0 || k === SPAN_MODULES - 1 ? 'lamp' : k === 4 ? 'pylon' : 'deck';
      module(kind, side * (SPAN_X0 + k * BRIDGE_MODULE), RING_CZ, 0);
    }
  }
  // Ice on the strait and under the spans: the arena approach's dressing.
  for (const b of RING_BERGS) {
    const p = pol(b.r, b.phi);
    placeW(out, 'props/frostveil_ice_spire', p.x, p.z, b.spireH, {
      rotY: b.phi * 1.7,
      seatY: TH_WATER_Y + 1.6,
    });
    placeW(out, 'props/frostveil_ice_spire', p.x + 3, p.z - 2, b.spireH * 0.6, {
      rotY: b.phi * 2.3,
      seatY: TH_WATER_Y + 1.6,
    });
  }
  for (let k = 0; k < 8; k++) {
    const side = k % 2 === 0 ? -1 : 1;
    const z = 120 + k * 12;
    placeW(out, 'props/frostveil_ice_spire', side * 22, z, 8 + (k % 3) * 2, {
      rotY: k * 0.9,
      seatY: TH_WATER_Y - 1,
    });
    if (k % 2 === 0) {
      placeW(out, 'props/crystal_amethyst_cluster', side * 30, z + 6, 6 + (k % 3), {
        seatY: TH_WATER_Y - 2,
      });
    }
  }
  for (const side of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      const x = side * (SPAN_X0 + 12 + k * 18);
      const z = RING_CZ + (k % 2 === 0 ? -20 : 20);
      placeW(out, 'props/frostveil_ice_spire', x, z, 7 + (k % 2) * 3, {
        rotY: k * 1.1,
        seatY: TH_WATER_Y - 1,
      });
      if (k % 2 === 1)
        placeW(out, 'props/crystal_amethyst_cluster', x + 6, z + side * 8, 5 + k, {
          seatY: TH_WATER_Y - 2,
        });
    }
  }
  // Crystal clusters at every bridgehead and both beacon terraces.
  for (const p of [
    pol(RING_R - 12, Math.PI + 0.1),
    pol(RING_R - 12, Math.PI - 0.1),
    pol(RING_R - 12, Math.PI / 2 + 0.1),
    pol(RING_R - 12, -Math.PI / 2 - 0.1),
  ]) {
    placeW(out, 'props/crystal_amethyst_cluster', p.x, p.z, H.crystal * 0.8, { collide: 2 });
  }
  for (const side of [-1, 1]) {
    placeW(
      out,
      'props/crystal_amethyst_cluster',
      side * (BEACON_TERRACE_X + 10),
      RING_CZ,
      H.crystal,
      { collide: 2.4 },
    );
    placeW(
      out,
      'props/frostveil_ice_spire',
      side * (BEACON_TERRACE_X + 14),
      RING_CZ + 10,
      H.spire,
      {},
    );
    placeW(
      out,
      'props/frostveil_ice_spire',
      side * (BEACON_TERRACE_X + 14),
      RING_CZ - 10,
      H.spire * 0.8,
      {},
    );
  }
}

/** Every asset id the city may use: exactly Troy's 2026-09-07 palette (the
 *  bank arrives whole rather than as its 168 exploded pieces; colliders and
 *  the inline stair blocks are added by the document adapter). A placement
 *  outside this list is a bug, so ringPlacements() throws on one. */
export const ASSET_PALETTE: ReadonlySet<string> = new Set([
  'props/plot_sign',
  'props/streetlamp_veiled_crystal',
  'props/frostveil_ice_spire',
  'deepglass/warden_wall',
  'deepglass/warden_wall_pillar',
  'props/crystal_amethyst_cluster',
  'props/barrel',
  'props/eastbrook_market_stall',
  'deepglass/bridge_deck',
  'deepglass/bridge_lamp',
  'deepglass/bridge_pylon',
  'biome/hex_weaponrack',
  'props/farmcrate_apple',
  'props/crate_wooden',
  'props/flower_bed_round',
  'biome/hex_haybale',
  'biome/hex_target',
  'biome/hexb_docks',
  'props/garden_iron_fence',
  'props/tidehold_skybeacon',
  'biome/hex_ship_blue',
  'props/dock_platform',
  'props/market_stand_1',
  'props/market_stand_2',
  'biome/hex_barrel',
  'biome/hex_sack',
  'biome/hex_trough',
  'deepglass/warden_tower',
  'tidehold/house_a',
  'tidehold/house_b',
  'tidehold/house_c',
  'tidehold/house_d',
  'tidehold/house_e',
  'biome/hex_anchor',
  'biome/hex_crate_big',
  'biome/hex_crate_open',
  'biome/hex_lumber',
  'biome/hex_wheelbarrow',
  'biome/hexb_stables',
  'deepglass/warden_tower_spire',
  'deepglass/warden_tower_spire_c',
  'props/banker_chest',
  'props/bell_tower',
  'props/eastbrook_noticeboard',
  'props/eastbrook_realm_builder_monument',
  'tidehold/castle',
  'tidehold/castle_b',
  'tidehold/hall',
  'tidehold/market',
  'tidehold/smithy',
  'tidehold/tavern',
  'tidehold/tavern_b',
  'tidehold/bank',
]);

export function ringPlacements(): PlacedAsset[] {
  const out: PlacedAsset[] = [];
  crown(out);
  middle(out);
  outer(out);
  moreHouses(out);
  lowWardInn(out);
  plotFences(out);
  lamps(out);
  bridges(out);
  for (const p of out) {
    const id = p.path.replace(/^\/models\//, '').replace(/\.glb$/, '');
    if (!ASSET_PALETTE.has(id))
      throw new Error(`ring city: ${id} is not in the placed-asset palette`);
  }
  // the stair blocks (inline built models, MODEL_PATH) ride the same list
  for (const f of tierFlights()) out.push(flightPieces(f).block);
  return out;
}

// ---------------------------------------------------------------------------
// Lights, sounds, names, grass, paint
// ---------------------------------------------------------------------------
export function ringLights(): NonNullable<WorldContent['lights']> {
  const spots: [number, number, number, number, number, number?][] = [];
  const at = (
    p: { x: number; z: number },
    y: number,
    color: number,
    range: number,
    intensity?: number,
  ): void => {
    spots.push([p.x, p.z, y, color, range, intensity]);
  };
  at(pol(0, 0), 12, TH_LAMP_COLOR, 60, 2.8); // the crown plaza
  at(pol(CASTLE.r, CASTLE.phi), 9, TH_HEARTH_COLOR, 46); // the castle's braziers
  at(pol(HALL.r, HALL.phi), 8, TH_HEARTH_COLOR, 40);
  at(pol(MARKET_PLAZA.r, MARKET_PLAZA.phi), 9, TH_LAMP_COLOR, 56, 2.6); // the Glass Market
  at(pol(ROW_SQUARE.r, ROW_SQUARE.phi), 9, TH_LAMP_COLOR, 50); // Wardens' Garden
  // (the tavern and smithy hearths are lit by their own fire emitters: the
  // document caps lights at 24 and the arena spends eight of them)
  at(pol(RING_R - 10, Math.PI), 10, TH_LAMP_COLOR, 60, 3); // the Tide Gate
  at(pol(WHARF_R - 20, 2.3), 8, TH_LAMP_COLOR, 50); // the Tidewharf
  at(pol(WHARF_R - 20, -2.3), 8, TH_LAMP_COLOR, 50); // Gullhaven
  at(pol(RING_R - 10, Math.PI / 2), 10, TH_LAMP_COLOR, 52); // the span heads
  at(pol(RING_R - 10, -Math.PI / 2), 10, TH_LAMP_COLOR, 52);
  at({ x: BEACON_TERRACE_X, z: RING_CZ }, 22, TH_LAMP_COLOR, 62, 3);
  at({ x: -BEACON_TERRACE_X, z: RING_CZ }, 22, TH_LAMP_COLOR, 62, 3);
  for (const phi of RING_LANES) at(pol(TH_BEACON_R, phi), 34, TH_LAMP_COLOR, 58, 2.6); // the skybeacons
  return spots.map(([x, z, y, color, range, intensity]) => ({
    x,
    z,
    y,
    color,
    intensity: intensity ?? 2.1,
    range,
  }));
}

export function ringPointSounds(): NonNullable<WorldContent['pointSounds']> {
  const market = pol(MARKET_PLAZA.r, MARKET_PLAZA.phi);
  const crown = pol(0, 0);
  const wharfE = pol(WHARF_R - 24, 2.3);
  const wharfW = pol(WHARF_R - 24, -2.3);
  const row = pol(ROW_SQUARE.r, ROW_SQUARE.phi);
  return [
    { x: market.x, z: market.z, y: 3, sound: 'amb_town', radius: 120, volume: 0.55 },
    { x: crown.x, z: crown.z, y: 3, sound: 'amb_town', radius: 90, volume: 0.35 },
    { x: row.x, z: row.z, y: 3, sound: 'amb_town', radius: 80, volume: 0.3 },
    { x: wharfE.x, z: wharfE.z, y: 3, sound: 'amb_water', radius: 90, volume: 0.45 },
    { x: wharfW.x, z: wharfW.z, y: 3, sound: 'amb_water', radius: 90, volume: 0.45 },
  ];
}

/** Named districts. Locations are axis-aligned boxes, so each ring quarter is
 *  the box round its sector; the crown and the landmarks are exact. */
export function ringLocations(): NonNullable<WorldContent['locations']> {
  const out: NonNullable<WorldContent['locations']> = [];
  const sector = (name: string, r0: number, r1: number, phi0: number, phi1: number): void => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const n = 24;
    for (let i = 0; i <= n; i++) {
      const phi = phi0 + ((phi1 - phi0) * i) / n;
      for (const r of [r0, r1]) {
        const p = pol(r, phi);
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      }
    }
    out.push({ name, minX, maxX, minZ, maxZ });
  };
  const box = (name: string, p: { x: number; z: number }, w: number, d: number): void => {
    out.push({ name, minX: p.x - w / 2, maxX: p.x + w / 2, minZ: p.z - d / 2, maxZ: p.z + d / 2 });
  };
  // Landmarks first: the sim reports the first location that contains a point.
  box('Wardenhold', pol(CASTLE.r, CASTLE.phi), 78, 72); // the keep: seat of Warden Cassia Deepglass
  box('Vigil Hall', pol(HALL.r, HALL.phi), 26, 36); // the wardens' hall
  box('The Glass Exchange', pol(MARKET_PAVILION.r, MARKET_PAVILION.phi), 36, 22); // the market pavilion
  box("Tide's Coffer", pol(BANK.r, BANK.phi), 28, 24); // the bank
  box('The Gilded Gull', pol(TAVERN.r, TAVERN.phi), 28, 24); // the tavern
  box('The Anchor & Antler', pol(TAVERN_B.r, TAVERN_B.phi), 44, 34); // the Low Wards' inn
  box("Brine's Forge", pol(SMITHY.r, SMITHY.phi), 22, 18); // the smithy
  box("Baldemar's Square", pol(RING_MONUMENT.r, RING_MONUMENT.phi), 30, 30); // the monument at the market crossroads
  box('Wardens’ Garden', pol(ROW_SQUARE.r, ROW_SQUARE.phi), 44, 44); // the fenced flower garden
  box('The Fishwives’ Court', pol(232, -2.32), 34, 34); // Gullhaven's stall market
  box('The Drill Yard', pol(YARD.r, YARD.phi), 36, 36);
  // The crown.
  out.push({
    name: 'The Warden’s Seat',
    minX: RING_CX - RING_CROWN.r1,
    maxX: RING_CX + RING_CROWN.r1,
    minZ: RING_CZ - RING_CROWN.r1,
    maxZ: RING_CZ + RING_CROWN.r1,
  });
  // The trading ring, four quarters.
  const m0 = RING_MIDDLE.r0;
  const m1 = RING_MIDDLE.r1;
  sector('Wardens’ Row', m0, m1, -Math.PI / 4, Math.PI / 4);
  sector('Coppersmiths’ Circle', m0, m1, Math.PI / 4, (3 * Math.PI) / 4);
  sector('The Glass Market', m0, m1, (3 * Math.PI) / 4, (5 * Math.PI) / 4);
  sector('Lantern Terrace', m0, m1, -(3 * Math.PI) / 4, -Math.PI / 4);
  // The low wards, six quarters round the rim.
  const o0 = RING_OUTER.r0;
  const o1 = RING_OUTER.r1 + 8;
  sector('The Kelp Rows', o0, o1, -Math.PI / 6, Math.PI / 6);
  sector('Ropewalk', o0, o1, Math.PI / 6, Math.PI / 2 + 0.25);
  sector('The Tidewharf', o0, o1, Math.PI / 2 + 0.25, Math.PI - 0.45);
  sector('Brinegate', o0, o1, Math.PI - 0.45, Math.PI + 0.45);
  sector('Gullhaven', o0, o1, -Math.PI + 0.45, -Math.PI / 2 - 0.25);
  sector('Saltside', o0, o1, -Math.PI / 2 - 0.25, -Math.PI / 6);
  // The bridges and their landings.
  out.push({
    name: 'The Tideway',
    minX: -9,
    maxX: 9,
    minZ: ARENA_TERRACE_R - 30,
    maxZ: RING_CZ - RING_R + 4,
  });
  out.push({
    name: 'The West Span',
    minX: -(SPAN_X0 + SPAN_MODULES * BRIDGE_MODULE),
    maxX: -RING_R + 2,
    minZ: RING_CZ - 8,
    maxZ: RING_CZ + 8,
  });
  out.push({
    name: 'The East Span',
    minX: RING_R - 2,
    maxX: SPAN_X0 + SPAN_MODULES * BRIDGE_MODULE,
    minZ: RING_CZ - 8,
    maxZ: RING_CZ + 8,
  });
  for (const side of [-1, 1] as const) {
    out.push({
      name: side < 0 ? 'Westlight Terrace' : 'Eastlight Terrace',
      minX: side * BEACON_TERRACE_X - BEACON_TERRACE_R,
      maxX: side * BEACON_TERRACE_X + BEACON_TERRACE_R,
      minZ: RING_CZ - BEACON_TERRACE_R,
      maxZ: RING_CZ + BEACON_TERRACE_R,
    });
  }
  // The arena grounds: the terrace round the bell, and the black water round it.
  out.push({
    name: 'Bellwater Terrace',
    minX: DEEPGLASS_CENTER.x - ARENA_TERRACE_R,
    maxX: DEEPGLASS_CENTER.x + ARENA_TERRACE_R,
    minZ: DEEPGLASS_CENTER.z - ARENA_TERRACE_R,
    maxZ: DEEPGLASS_CENTER.z + ARENA_TERRACE_R,
  });
  out.push({
    name: 'The Bellwater',
    minX: -220,
    maxX: 220,
    minZ: -240,
    maxZ: RING_CZ - RING_R - 6,
  });
  return out;
}

export function ringGrassClear(): NonNullable<WorldContent['grassClear']> {
  const out: { x: number; z: number; r: number }[] = [];
  // the whole island, ring by ring
  for (let r = 0; r <= RING_R + 10; r += 30) {
    const n = Math.max(1, Math.ceil((Math.PI * 2 * r) / 30));
    for (let i = 0; i < n; i++) {
      const p = pol(r, (i / n) * Math.PI * 2);
      out.push({ x: p.x, z: p.z, r: 26 });
    }
  }
  for (let k = 0; k <= TIDEWAY_MODULES; k++)
    out.push({ x: 0, z: TIDEWAY_Z0 + k * BRIDGE_MODULE, r: 13 });
  for (const side of [-1, 1]) {
    for (let k = 0; k <= SPAN_MODULES; k++)
      out.push({ x: side * (SPAN_X0 + k * BRIDGE_MODULE), z: RING_CZ, r: 13 });
    out.push({ x: side * BEACON_TERRACE_X, z: RING_CZ, r: BEACON_TERRACE_R });
  }
  return out;
}

/** The plot swatch: bare earth a player will build on. */
const PAINT_PLOT = 209;
const RING_SWATCHES: CustomPaintSwatch[] = [
  ...TH_SWATCHES,
  {
    id: PAINT_PLOT,
    color: 0x6f6252,
    label: 'House Plot',
    textureSha: 'builtin:Ground101',
    tileSize: 6,
    light: 0.08,
    saved: true,
  },
];

function nearPlot(x: number, z: number, plots: readonly Plot[]): boolean {
  for (const pl of plots) {
    const c = pol(pl.r, pl.phi);
    // plot axes: along the ring (tangent) and radial
    const dx = x - c.x;
    const dz = z - c.z;
    const along = dx * Math.cos(pl.phi) - dz * Math.sin(pl.phi);
    const radial = dx * Math.sin(pl.phi) + dz * Math.cos(pl.phi);
    if (Math.abs(along) <= pl.w / 2 && Math.abs(radial) <= pl.d / 2) return true;
  }
  return false;
}

function ringPaintAt(x: number, z: number): number {
  const { r, phi } = polar(x, z);
  // The arena terrace is a paved esplanade; the strait and the sea are unpainted.
  const fromArena = Math.hypot(x - DEEPGLASS_CENTER.x, z - DEEPGLASS_CENTER.z);
  if (fromArena <= ARENA_TERRACE_R - 1) return PAINT_PLAZA;
  // Beacon terraces.
  for (const side of [-1, 1]) {
    const d = Math.hypot(x - side * BEACON_TERRACE_X, z - RING_CZ);
    if (d <= BEACON_TERRACE_R) return d > BEACON_TERRACE_R - 8 ? PAINT_FROST : PAINT_PLAZA;
  }
  if (r > RING_R + 2) {
    for (const b of RING_BERGS) {
      const p = pol(b.r, b.phi);
      if (Math.hypot(x - p.x, z - p.z) <= b.radius + 2) return PAINT_FROST;
    }
    return 255;
  }
  // The rim of every tier is a frost lip; the quay edge is sea cliff.
  if (r > RING_R - 5) return PAINT_CLIFF;
  const tier = RING_TIERS.find((t) => r >= t.r0 && r < t.r1) as RingTier;
  const onAvenue = RING_AVENUES.some(
    (a) => Math.abs(bearingDelta(phi, a)) * r <= RING_AVENUE_HALF_W,
  );
  const onLane =
    tier.id !== 'crown' &&
    RING_LANES.some((a) => Math.abs(bearingDelta(phi, a)) * r <= RING_LANE_HALF_W);
  const onRoad = tier.roadR > 0 && Math.abs(r - tier.roadR) <= RING_ROAD_HALF_W;
  if (onAvenue || onRoad || onLane) return PAINT_STREET;
  if (tier.id === 'crown') {
    if (r <= 82) return PAINT_KEEP;
    return PAINT_WARD;
  }
  const market = pol(MARKET_PLAZA.r, MARKET_PLAZA.phi);
  if (Math.hypot(x - market.x, z - market.z) <= MARKET_PLAZA.radius) return PAINT_PLAZA;
  const square = pol(ROW_SQUARE.r, ROW_SQUARE.phi);
  if (Math.hypot(x - square.x, z - square.z) <= ROW_SQUARE.radius) return PAINT_GARDEN;
  const yard = pol(YARD.r, YARD.phi);
  if (Math.hypot(x - yard.x, z - yard.z) <= YARD.radius) return PAINT_YARD;
  const fish = pol(232, -2.32);
  if (Math.hypot(x - fish.x, z - fish.z) <= 18) return PAINT_PLAZA;
  if (nearPlot(x, z, tier.id === 'middle' ? MIDDLE_PLOTS : OUTER_PLOTS)) return PAINT_PLOT;
  if (tier.id === 'outer') {
    // the wharf quarters are gravel out to the quay
    if (
      r >= 262 &&
      (Math.abs(bearingDelta(phi, 2.32)) < 0.45 || Math.abs(bearingDelta(phi, -2.32)) < 0.45)
    ) {
      return PAINT_GRAVEL;
    }
  }
  if (r < tier.r0 + 5) return PAINT_FROST;
  return PAINT_WARD;
}

const RING_PAINT_CELL = 5;

export function ringBiomePaint(): BiomePaint {
  const x0 = -460;
  const x1 = 460;
  const z0 = -250;
  const z1 = 1000;
  const cols = Math.ceil((x1 - x0) / RING_PAINT_CELL);
  const rows = Math.ceil((z1 - z0) / RING_PAINT_CELL);
  const ids: number[] = [];
  for (let row = 0; row < rows; row++) {
    const z = z0 + (row + 0.5) * RING_PAINT_CELL;
    for (let c = 0; c < cols; c++) ids.push(ringPaintAt(x0 + (c + 0.5) * RING_PAINT_CELL, z));
  }
  return {
    cell: RING_PAINT_CELL,
    cols,
    rows,
    originX: x0,
    originZ: z0,
    ids,
    custom: RING_SWATCHES,
  };
}

/** Where the city's own point of interest sits (the map pin), and where the
 *  portal wizard stands: in the Glass Market, where the south avenue meets the
 *  ring road. */
export const RING_POI = pol(0, 0);
export const RING_WIZARD_POS = pol(MARKET_PLAZA.r + 8, MARKET_PLAZA.phi + 0.08);
/** The Realm Builder monument's seat in Baldemar's Square (the crossroads). */
export const RING_MONUMENT_POS = pol(RING_MONUMENT.r, RING_MONUMENT.phi);
