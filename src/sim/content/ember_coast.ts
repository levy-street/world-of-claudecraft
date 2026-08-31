import type { HeightStamp } from '../types';

// The Drakelands' coast tables: the metaball land lobes and carved bays
// world.ts's ember coast applier builds its landness fields from (see the
// banner comment above applyEmberCoast there). Data-as-code, extracted from
// world.ts under the monolith ratchet; edit values here, the field math
// stays in world.ts.
//
// The landmass: a gatewood shore fused to the causeway landing, widening
// into the desert body, then a broad volcanic belt spanning the far north
// (the Drakemaw range doubles as the sealed wall's footing where it meets
// land; over the flanks the range simply runs into the sea).
// The isle's own land lobes, named so the ground-colour override below and
// the land-lobe table share ONE set of discs (a by-value copy drifted the
// moment either table moved).
const FORGEFATHER_ISLE_LOBES = [
  { x: 512, z: 2220, r: 32 }, // the isle's body, grown grand
  { x: 509, z: 2250, r: 21 }, // ...its north shoulder (the summit's footing,
  // wide enough that the high tiers' rims run out on dry ground)
  { x: 514, z: 2192, r: 16 }, // ...its south shoulder (the south strand)
  { x: 524, z: 2216, r: 12 }, // ...the east beach ramp (bank gradient)
  { x: 520, z: 2240, r: 12 }, // ...the northeast beach ramp (bank gradient)
  { x: 500, z: 2210, r: 15 }, // ...the west shoulder, stretched so the
  // bridgehead beach climbs gently out of the strait (bank gradient)
  { x: 498, z: 2232, r: 12 }, // ...the northwest beach ramp (bank gradient)
] as const;

export const EMBER_LAND_LOBES = [
  { x: 404, z: 1825, r: 40 }, // the causeway landing, fused across the border
  { x: 404, z: 1858, r: 52 }, // the Wyrmgate shore and Wyrmwatch
  { x: 360, z: 1900, r: 70 }, // the Gatewood
  { x: 450, z: 1920, r: 55 }, // eastern gatewood shore
  { x: 455, z: 1995, r: 55 }, // the Last Spring headland
  { x: 290, z: 1940, r: 60 }, // western gatewood shore
  { x: 380, z: 2030, r: 90 }, // the drying midlands
  { x: 280, z: 2080, r: 65 }, // Mirage Hollow's dune shelf
  { x: 262, z: 2020, r: 46 }, // ...its southern shoulder under the dune road
  { x: 274, z: 2170, r: 48 }, // ...and the shelf road's western shoulder
  { x: 470, z: 2070, r: 70 }, // eastern dunes
  { x: 465, z: 2150, r: 60 }, // Trollmoot's rise
  { x: 405, z: 2170, r: 55 }, // the dune saddle carrying the Trollmoot fork
  { x: 340, z: 2160, r: 85 }, // the Cinder Dunes' heart
  { x: 420, z: 2260, r: 80 }, // approach to the Drakemaw
  { x: 360, z: 2238, r: 45 }, // the saddle carrying the Snowline road
  { x: 290, z: 2250, r: 75 }, // the Bloodglass shelf
  { x: 360, z: 2355, r: 95 }, // the Drakemaw belt
  { x: 490, z: 2330, r: 60 }, // eastern volcanic spur
  { x: 220, z: 2340, r: 55 }, // western volcanic spur
  { x: 450, z: 2400, r: 70 }, // the rim belt, wide under the sealed range
  { x: 270, z: 2400, r: 70 },
  { x: 360, z: 2410, r: 80 },
  { x: 242, z: 2080, r: 42 }, // the Snowline crossing's waste-side shoulder
  { x: 208, z: 2080, r: 40 }, // ...carried to the column border
  { x: 216, z: 1930, r: 44 }, // the Snowline's waste-side shoulder
  { x: 236, z: 1972, r: 46 }, // ...rising onto the dune shelf road
  { x: 376, z: 1952, r: 42 }, // the town road's western shoulder
  { x: 242, z: 1858, r: 46 }, // the cap's shore joining the Gatewood...
  { x: 264, z: 1908, r: 44 }, // ...so no channel runs behind it to the sound
  { x: 492, z: 2390, r: 48 }, // the Goldmelt Water's east cap, waste side
  // The Forgefather's Isle: the Ignivar raid entrance rises off the
  // Trollmoot coast (high x renders WEST on the world map), a terraced
  // volcanic islet the owner's bridge asset will span from the mainland
  // (docs/design/ignivar-entrance/plan.md). The fortress tier plateaus
  // are stamped by FORGEFATHER_ISLE_TERRAIN_EDITS below; the isle rows
  // live in FORGEFATHER_ISLE_LOBES (above) because the ground-colour
  // override reuses the same discs.
  ...FORGEFATHER_ISLE_LOBES,
] as const;
// The isle's ground-colour override rides the SAME discs as its land lobes:
// the isle is bare volcanic rock, never desert sand, so the fortress reads
// against dark ground and the street lamps' night wash (which multiplies
// against albedo) dims with it. All three colour tiers (near splat mesh,
// far vista, map plate) consult this ONE weight so the isle cannot be rock
// in the world and gold on the map.
const ISLE_ROCK_DISCS = FORGEFATHER_ISLE_LOBES;
const ISLE_ROCK_FEATHER = 6;

/** 1 on the Forgefather's Isle proper, feathering to 0 a few yards past the
 *  lobe rims (the strait keeps the mainland's sand untouched). */
export function forgefatherIsleRockWeight(x: number, z: number): number {
  if (x < 476 || x > 544 || z < 2168 || z > 2280) return 0;
  let w = 0;
  for (const d of ISLE_ROCK_DISCS) {
    const t = 1 - (Math.hypot(x - d.x, z - d.z) - d.r) / ISLE_ROCK_FEATHER;
    if (t > w) w = t;
  }
  return w < 0 ? 0 : w > 1 ? 1 : w;
}

export const EMBER_BAYS = [
  { x: 195, z: 1980, r: 50 }, // the west bight
  // the east reach, drawn north of its old eye so its suppression frees
  // the Forgefather's Isle water while still carving the coast above
  { x: 538, z: 2162, r: 46 },
  { x: 205, z: 2230, r: 40 }, // a western cove under the spur
  // the Forgefather's Strait, widened for the grand isle: the Trollmoot
  // coast pulls further inland (the two eyes) so open water rings every
  // face and the owner's bridge earns its length
  { x: 478, z: 2210, r: 24 },
  { x: 478, z: 2242, r: 14 },
] as const;

/** Shared staircase geometry, measured from the shipped GLB: the flight
 *  spans the first 87.5% of the model's length, then a flat top landing.
 *  Walking rides the FORGEFATHER_STAIR_RAMPS lift surfaces below; the
 *  stamp under-banks sculpt the RAW heightfield beneath each band so the
 *  memo-based movement gates (which never see the lifts) stay calm and no
 *  raw ground ever rises above a flight. */
export const STAIR_LANDING_START = 0.875; // the landing begins at this length fraction
const RAMP_STEP = 0.75; // stamp spacing along the climb

/** The Forgefather stair ramps: the Last Keep castle's walkable-lift idiom
 *  (castle_layout.ts CASTLE_RAMPS) under the six placed staircases. Each
 *  row is an axis-aligned band carrying an ABSOLUTE walk surface: a linear
 *  flight from the lower court's RAW ground level at the stair's bottom
 *  end up to the upper court's at the landing start, then level across the
 *  landing. Ground-level ends make the lift CONTINUOUS with the terrain
 *  (no wall at a ramp mouth, the castle rule); the floor plates, 0.64
 *  above their court ground, hand walkers on and off mid-band through the
 *  ordinary collider step. groundHeight folds the
 *  surface in as a max (src/sim/walk_lifts.ts): the ramp is what the feet
 *  climb, the staircase prop is what the eye sees, and the render terrain
 *  never knows, so no rock can show through a flight at any LOD. Bands
 *  inset 0.1 inside the stair width so the lift's sheer sides hide within
 *  the stone. Derived from the staircase rows in
 *  src/sim/forgefather_fortress.ts; re-derive when one moves. */
interface StairRampBand {
  /** Lead-ins and tapers are under-plate connective segments: raw court
   *  ground may legitimately sit at or above them (the floor plates carry
   *  the walker there); they exist purely for groundHeight continuity. */
  link?: true;
  /** 'z' bands run along z at a fixed x range; 'x' bands along x. */
  axis: 'x' | 'z';
  b0: number; // across-band bounds
  b1: number;
  a0: number; // along the climb: this segment's start...
  a1: number; // ...and end (either order)
  h0: number; // ABSOLUTE surface height at a0...
  h1: number; // ...and at a1
}
export const FORGEFATHER_STAIR_RAMPS: readonly StairRampBand[] = [
  // Each stair carries four segments (three where the top joins bare
  // terrain): a short LEAD-IN rising from the court's raw ground to its
  // floor-plate top, the FLIGHT from plate top to plate top (ending 1.2yd
  // before the upper plate's edge so the hand-off step stays inside
  // MAX_STEP_HEIGHT), a LEVEL run over the top landing, and a TAPER back
  // down to the upper court's raw ground. The lead-ins and tapers sit
  // under the courts' floor slabs (the plates carry the walker there), so
  // they are invisible: their only job is groundHeight continuity, since
  // the terrain wall gate refuses any abrupt ground jump.
  // the bailey stair: forecourt (plates 2.64) up to the middle court (6.94)
  { link: true, axis: 'z', b0: 503.58, b1: 512.02, a0: 2201.3, a1: 2202.7, h0: 2.0, h1: 2.64 },
  { axis: 'z', b0: 503.58, b1: 512.02, a0: 2202.7, a1: 2209.7, h0: 2.64, h1: 6.94 },
  { axis: 'z', b0: 503.58, b1: 512.02, a0: 2209.7, a1: 2211.7, h0: 6.94, h1: 6.94 },
  { link: true, axis: 'z', b0: 503.58, b1: 512.02, a0: 2211.7, a1: 2213.1, h0: 6.94, h1: 6.3 },
  // the court stair: middle court (6.94) up to tier three (11.64)
  { link: true, axis: 'z', b0: 499.88, b1: 508.32, a0: 2215.5, a1: 2216.9, h0: 6.3, h1: 6.94 },
  { axis: 'z', b0: 499.88, b1: 508.32, a0: 2216.9, a1: 2223.5, h0: 6.94, h1: 11.64 },
  { axis: 'z', b0: 499.88, b1: 508.32, a0: 2223.5, a1: 2225.9, h0: 11.64, h1: 11.64 },
  { link: true, axis: 'z', b0: 499.88, b1: 508.32, a0: 2225.9, a1: 2227.3, h0: 11.64, h1: 11.0 },
  // the upper stair: tier three (11.64) up to the landing court (15.34)
  { link: true, axis: 'z', b0: 500.57, b1: 506.13, a0: 2229.75, a1: 2231.15, h0: 11.0, h1: 11.64 },
  { axis: 'z', b0: 500.57, b1: 506.13, a0: 2231.15, a1: 2235.95, h0: 11.64, h1: 15.34 },
  { axis: 'z', b0: 500.57, b1: 506.13, a0: 2235.95, a1: 2237.15, h0: 15.34, h1: 15.34 },
  { link: true, axis: 'z', b0: 500.57, b1: 506.13, a0: 2237.15, a1: 2238.55, h0: 15.34, h1: 14.7 },
  // the keep stair: landing court (15.34) up to the summit flat (19.0,
  // bare terrain: the summit pads take over past the band)
  // (The keep flight tops at 18.85, a hair UNDER its landing mesh at
  // 18.89, so feet ride the stone and the summit pads' raw ground stays
  // hidden beneath the landing.)
  { link: true, axis: 'z', b0: 500.27, b1: 505.83, a0: 2237.0, a1: 2238.4, h0: 14.7, h1: 15.34 },
  { axis: 'z', b0: 500.27, b1: 505.83, a0: 2238.4, a1: 2243.65, h0: 15.34, h1: 18.85 },
  { axis: 'z', b0: 500.27, b1: 505.83, a0: 2243.65, a1: 2244.4, h0: 18.85, h1: 18.85 },
  // the quay stair: waterside quay (plates -1.86) up through the gate (2.64)
  { link: true, axis: 'x', b0: 2196.23, b1: 2204.67, a0: 491.15, a1: 492.55, h0: -2.5, h1: -1.86 },
  { axis: 'x', b0: 2196.23, b1: 2204.67, a0: 492.55, a1: 500.0, h0: -1.86, h1: 2.64 },
  { axis: 'x', b0: 2196.23, b1: 2204.67, a0: 500.0, a1: 501.55, h0: 2.64, h1: 2.64 },
  { link: true, axis: 'x', b0: 2196.23, b1: 2204.67, a0: 501.55, a1: 502.95, h0: 2.64, h1: 2.0 },
];

/** No wild scatter on the fortress's graded grounds (the Last Keep rule):
 *  decorationAt refuses these discs, so a seed re-roll can never seat a
 *  boulder in a court or across a stair flight. The shores outside keep
 *  their natural stones. */
const FORGEFATHER_SCATTER_CLEAR = [
  { x: 508, z: 2205, r: 20 }, // the lower works: quay, gate, forecourt, courts
  { x: 505, z: 2237, r: 16 }, // the upper works: tiers, landing court, keep
] as const;

export function forgefatherScatterExcluded(x: number, z: number): boolean {
  for (const disc of FORGEFATHER_SCATTER_CLEAR) {
    if (Math.hypot(x - disc.x, z - disc.z) < disc.r) return true;
  }
  return false;
}

/** The absolute stair-ramp surface at a point, or -Infinity outside every
 *  band (the walk_lifts max then leaves the ground untouched). */
export function forgefatherStairSurface(x: number, z: number): number {
  let abs = Number.NEGATIVE_INFINITY;
  for (const ramp of FORGEFATHER_STAIR_RAMPS) {
    const along = ramp.axis === 'z' ? z : x;
    const across = ramp.axis === 'z' ? x : z;
    if (across < ramp.b0 || across > ramp.b1) continue;
    const lo = Math.min(ramp.a0, ramp.a1);
    const hi = Math.max(ramp.a0, ramp.a1);
    if (along < lo || along > hi) continue;
    const t = (along - ramp.a0) / (ramp.a1 - ramp.a0);
    abs = Math.max(abs, ramp.h0 + (ramp.h1 - ramp.h0) * t);
  }
  return abs;
}

interface StairRampSpec {
  x: number; // the staircase placement's centre...
  z: number;
  ryDeg: number; // ...its yaw in degrees...
  scale: number;
  h0: number; // the ramp band's surface at the bottom end...
  h1: number; // ...and from the landing start on (the court ground levels)
  clear: number; // bank target depth under the ramp line, pre-bias: the
  // level-stamp cascade settles a marching bank ABOVE its targets by
  // roughly a third of the stamp radius times the grade
  lanes: readonly number[]; // lateral lane offsets covering the stair width
  radius: number;
}

function stairRampStamps(spec: StairRampSpec): HeightStamp[] {
  const rad = (spec.ryDeg * Math.PI) / 180;
  const ux = -Math.cos(rad); // climb direction, bottom end toward the top
  const uz = Math.sin(rad);
  const bottomX = spec.x - (ux * spec.scale) / 2;
  const bottomZ = spec.z - (uz * spec.scale) / 2;
  const landingD = spec.scale * STAIR_LANDING_START;
  const round = (value: number) => Math.round(value * 100) / 100;
  // The march starts under the lead-in (d < 0), so the RAW ground beneath
  // the mouth is calmed too: the steepness memo never sees the lifts, and
  // rough natural ground under a lead band strips control right where
  // walkers step onto the flight.
  const start = -1.2;
  const steps = Math.ceil((landingD - start) / RAMP_STEP);
  const out: HeightStamp[] = [];
  for (let i = 0; i <= steps; i++) {
    const d = start + ((landingD - start) * i) / steps;
    const line = spec.h0 + (spec.h1 - spec.h0) * (d / landingD);
    const delta = round(Math.max(line - spec.clear, spec.h0 - 0.45));
    for (const lane of spec.lanes)
      out.push({
        x: round(bottomX + ux * d - uz * lane),
        z: round(bottomZ + uz * d + ux * lane),
        radius: spec.radius,
        delta,
        falloff: 'smooth',
        mode: 'level',
      });
  }
  return out;
}

/** The Forgefather's Isle fortress tiers: flat build plateaus with smooth
 *  approach ramps (the quay-pad idiom, stacked). Each tier's centre drifts
 *  north of the one below, so every tier keeps a broad south-facing
 *  crescent of flat ground and the mountain climbs away from the strait:
 *  bridgehead onto tier one, switchbacks up the south faces. Applied over
 *  the isle lobes; the raid entrance slice furnishes them. */
export const FORGEFATHER_ISLE_TERRAIN_EDITS: HeightStamp[] = [
  // The five fortress tiers first...
  { x: 513, z: 2206, radius: 22, delta: 2, falloff: 'smooth', mode: 'level' },
  { x: 513, z: 2206, radius: 16, delta: 2, falloff: 'flat', mode: 'level' },
  { x: 510, z: 2220, radius: 18, delta: 6.5, falloff: 'smooth', mode: 'level' },
  { x: 510, z: 2220, radius: 12, delta: 6.5, falloff: 'flat', mode: 'level' },
  { x: 507, z: 2232, radius: 13.5, delta: 11, falloff: 'smooth', mode: 'level' },
  { x: 507, z: 2232, radius: 8.5, delta: 11, falloff: 'flat', mode: 'level' },
  { x: 505, z: 2242, radius: 9.5, delta: 15, falloff: 'smooth', mode: 'level' },
  { x: 505, z: 2242, radius: 5.5, delta: 15, falloff: 'flat', mode: 'level' },
  { x: 503, z: 2250, radius: 6, delta: 19, falloff: 'smooth', mode: 'level' },
  { x: 503, z: 2250, radius: 3, delta: 19, falloff: 'flat', mode: 'level' },
  // ...then the shore landings LAST, so they carve authoritatively into
  // the tier flanks (stamps apply in array order; an earlier landing was
  // silently re-lifted by the tier rims above it). Each levels its shore
  // band to a low dry terrace (3.3 over the waterline, above the coast
  // sweep's shore-rooted band), so climbs start from exempt ground.
  { x: 499, z: 2203, radius: 18, delta: -1, falloff: 'smooth', mode: 'level' }, // bridgehead
  { x: 514, z: 2239, radius: 7, delta: 7, falloff: 'smooth', mode: 'level' }, // upper east shelf
  { x: 517, z: 2232, radius: 9, delta: 3.5, falloff: 'smooth', mode: 'level' }, // east mid shelf
  { x: 521, z: 2239, radius: 10, delta: -1, falloff: 'smooth', mode: 'level' }, // northeast landing
  { x: 514, z: 2249, radius: 8, delta: -1, falloff: 'smooth', mode: 'level' }, // north landing
  // The fortress courts (the owner's baked pass,
  // src/sim/forgefather_fortress.ts): ground leveled flush under the placed
  // floor plates. The tier-one and south-bailey floors already sit on their
  // tiers' own flats.
  // The middle court's pair sits SOUTH-SHRUNK on purpose: its old r13/r9
  // discs at (508, 2219) applied after the tier-three stamps and re-leveled
  // tier three's ground under the court plates down toward 6.3, digging a
  // 3-5yd trench that hard-stuck a walker standing on the plates above it
  // (the movement kernel's steepness and terrain-wall gates read the RAW
  // heightfield even under a platform-stander).
  { x: 508, z: 2216.5, radius: 11, delta: 6.3, falloff: 'smooth', mode: 'level' }, // middle court
  { x: 508, z: 2216.5, radius: 7, delta: 6.3, falloff: 'flat', mode: 'level' },
  { x: 504.3, z: 2241.2, radius: 8, delta: 14.7, falloff: 'smooth', mode: 'level' }, // upper landing
  { x: 504.3, z: 2241.2, radius: 5, delta: 14.7, falloff: 'flat', mode: 'level' },
  // ...and the stair under-banks: walking rides the FORGEFATHER_STAIR_RAMPS
  // lift surfaces, but the movement kernel's steepness memo and downhill
  // arm still read the RAW heightfield, so the ground beneath every flight
  // must stay calm (under the climb gate) and below the walking line. Each
  // bank tracks its ramp band's own line, `clear` under it pre-bias.
  // the bailey stair
  ...stairRampStamps({
    x: 507.8,
    z: 2207.2,
    ryDeg: 90,
    scale: 9,
    h0: 2.64,
    h1: 6.94,
    clear: 2.1,
    lanes: [-2.7, 2.7, 0],
    radius: 3.2,
  }),
  // the court stair
  ...stairRampStamps({
    x: 504.1,
    z: 2221.4,
    ryDeg: 90,
    scale: 9,
    h0: 6.94,
    h1: 11.64,
    clear: 2.1,
    lanes: [-2.7, 2.7, 0],
    radius: 3.2,
  }),
  // the upper stair
  ...stairRampStamps({
    x: 503.35,
    z: 2234.15,
    ryDeg: 90,
    scale: 6,
    h0: 11.64,
    h1: 15.34,
    clear: 1.6,
    lanes: [-2.4, 2.4, 0],
    radius: 2.8,
  }),
  // the keep stair
  ...stairRampStamps({
    x: 503.05,
    z: 2241.4,
    ryDeg: 90,
    scale: 6,
    h0: 15.34,
    h1: 19.0,
    clear: 1.6,
    lanes: [-2.4, 2.4, 0],
    radius: 2.8,
  }),
  // the quay stair
  ...stairRampStamps({
    x: 497.05,
    z: 2200.45,
    ryDeg: 180,
    scale: 9,
    h0: -1.86,
    h1: 2.64,
    clear: 2.1,
    lanes: [-2.7, 2.7, 0],
    radius: 3.2,
  }),
  // ...and the mainland dune apron: it eases the dune crest the owner's
  // shore deck emerges from.
  { x: 443.8, z: 2178.5, radius: 2.5, delta: 1.55, falloff: 'smooth', mode: 'level' },
  // ...plus the summit pads: the raw ground grades from the keep flight's
  // bank up onto the summit flat with no step past the terrain-wall gate,
  // because the movement kernel reads the raw heightfield even while the
  // body stands on the landing platform above it.
  // (Levelled to the owner's dungeon_entrance facade base, y 17.7: ground
  // above the facade base read as a gold mound inside the open archway.
  // Everything past the door is inside the keep drum's collider, so
  // nothing walks this ground, and the walkers on the landing above ride
  // the lift a full carry clearance over it.)
  { x: 503.05, z: 2245.1, radius: 2.4, delta: 17.7, falloff: 'smooth', mode: 'level' },
  { x: 503.1, z: 2246.2, radius: 2.8, delta: 17.7, falloff: 'smooth', mode: 'level' },
  { x: 503.1, z: 2247.8, radius: 2.8, delta: 17.7, falloff: 'smooth', mode: 'level' },
  // The keep flight's under-tread pit (owner request): the staircase model
  // has open risers, and raw ground riding only 0.7yd under the tread line
  // showed through the gaps as torch-lit bumps. Each disc levels the bank
  // about 1.5yd under its stretch of the flight line, deep enough to read
  // as shadow; walkers ride the FORGEFATHER_STAIR_RAMPS lift the whole
  // way, so a deeper bank only widens their carry clearance.
  { x: 503.05, z: 2239.2, radius: 2.9, delta: 14.2, falloff: 'smooth', mode: 'level' },
  { x: 503.05, z: 2240.4, radius: 2.9, delta: 15.0, falloff: 'smooth', mode: 'level' },
  { x: 503.05, z: 2241.6, radius: 2.9, delta: 15.8, falloff: 'smooth', mode: 'level' },
  { x: 503.05, z: 2242.8, radius: 2.9, delta: 16.6, falloff: 'smooth', mode: 'level' },
  { x: 503.05, z: 2243.9, radius: 2.7, delta: 17.3, falloff: 'smooth', mode: 'level' },
  // Stuck-pocket escapes (found by the movement flood scan): the middle
  // court's north-wall strip and the alley between the summit flank and
  // the sea-ring wall each get a walkable way back out. (The old gate
  // passage leveler retired with the ramp-band redesign: its dig sat right
  // at the bailey mouth and read as a freeze cell.)
  // ...the tier-three plate's west rim calmed (a raw remnant slope under
  // the plate edge read steep to the memo within the carry clearance)...
  { x: 500.8, z: 2226.2, radius: 2.2, delta: 10.6, falloff: 'smooth', mode: 'level' },
  // ...the north-wall strip's channel notch graded flat, so the walk east
  // onto the shelf ladder never crosses a steepness-gated cell...
  { x: 511.5, z: 2227.2, radius: 2, delta: 6.4, falloff: 'smooth', mode: 'level' },
  { x: 512.8, z: 2227.2, radius: 2, delta: 6.7, falloff: 'smooth', mode: 'level' },
  { x: 513.3, z: 2227.6, radius: 2.2, delta: 6.8, falloff: 'smooth', mode: 'level' },
  { x: 514.3, z: 2229.4, radius: 2.2, delta: 7.2, falloff: 'smooth', mode: 'level' },
  { x: 514.3, z: 2231.4, radius: 2.2, delta: 7.1, falloff: 'smooth', mode: 'level' },
  { x: 512.4, z: 2246, radius: 2.6, delta: -1.15, falloff: 'smooth', mode: 'level' },
  { x: 512.4, z: 2250, radius: 2.6, delta: -1.1, falloff: 'smooth', mode: 'level' },
  { x: 519.5, z: 2236.5, radius: 2.4, delta: 1.2, falloff: 'smooth', mode: 'level' },
  { x: 518.5, z: 2234, radius: 2.4, delta: 2.5, falloff: 'smooth', mode: 'level' },
  { x: 516, z: 2244.8, radius: 2.2, delta: 3.2, falloff: 'smooth', mode: 'level' },
  // Deck-edge understamps: wherever a walk deck floats within half a yard
  // of steep raw ground, the kernel's steep-strip can fire while the deck
  // pins the body (the freeze-spot rule in the walkability gate). Sinking
  // the roofed ground under those edges past the platform-carry clearance
  // hands the stander the kernel's deck exemption; every dip is under a
  // deck plate, invisible.
  { x: 449.5, z: 2198.6, radius: 2, delta: -2.3, falloff: 'smooth', mode: 'level' },
  { x: 450.2, z: 2200.2, radius: 1.8, delta: -2.4, falloff: 'smooth', mode: 'level' },
  { x: 497, z: 2208.5, radius: 2.2, delta: -2.6, falloff: 'smooth', mode: 'level' },
  { x: 507, z: 2244, radius: 1.8, delta: 14.6, falloff: 'smooth', mode: 'level' },
  { x: 507.3, z: 2254, radius: 1.8, delta: -2.2, falloff: 'smooth', mode: 'level' },
  // ...and the sea-pool postern: the walled pool and its keep-side alley
  // are droppable-into by design (off the summit flank), and their one
  // walkable way out runs south along the keep's east face. The flood
  // scan found the exits sealed by single just-over-limit steps; these
  // levelers open them (the pool's swimmers escape through the alley).
  { x: 513, z: 2241.0, radius: 2.2, delta: 4.6, falloff: 'smooth', mode: 'level' },
  { x: 513, z: 2242.2, radius: 2.2, delta: 3.8, falloff: 'smooth', mode: 'level' },
  { x: 513, z: 2243.4, radius: 2.2, delta: 3.0, falloff: 'smooth', mode: 'level' },
  { x: 513, z: 2244.6, radius: 2.2, delta: 2.2, falloff: 'smooth', mode: 'level' },
  { x: 513, z: 2245.8, radius: 2.2, delta: 1.4, falloff: 'smooth', mode: 'level' },
  { x: 513, z: 2247.0, radius: 2.2, delta: 0.6, falloff: 'smooth', mode: 'level' },
  { x: 513, z: 2248.2, radius: 2.2, delta: -0.2, falloff: 'smooth', mode: 'level' },
  { x: 513, z: 2249.4, radius: 2.2, delta: -1.0, falloff: 'smooth', mode: 'level' },
  // ...and the northwest slot between the west ring wall and the flank
  // fills to a dead-end balcony shelf (a 12 yd deep two-cell slot has no
  // walkable ladder; terrain is the answer): FLAT stamps hold the shelf
  // sag-free between the walls, the smooth ladder grades its south
  // approach down from the rim, and the only way out is the way in.
  { x: 496, z: 2247, radius: 3, delta: 6.7, falloff: 'flat', mode: 'level' },
  { x: 496, z: 2251.5, radius: 3, delta: 6.5, falloff: 'flat', mode: 'level' },
  { x: 496, z: 2242.5, radius: 3, delta: 7.1, falloff: 'flat', mode: 'level' },
  { x: 496, z: 2237, radius: 2.4, delta: 8.3, falloff: 'smooth', mode: 'level' },
  { x: 496, z: 2238.5, radius: 2.4, delta: 7.9, falloff: 'smooth', mode: 'level' },
  { x: 496, z: 2240, radius: 2.4, delta: 7.5, falloff: 'smooth', mode: 'level' },
];
