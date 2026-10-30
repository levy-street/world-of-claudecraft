// Ground dressing SPOTS: where the bushes, ferns and mushrooms stand, on a
// deterministic hash grid. Moved verbatim out of foliage.ts (the monolith
// ratchet), which keeps the meshes, tints and sprites built from these spots.
// The grass ring shares the placement filters exported here (tooSteep, the
// stable yard and harbor-deck gates).

import { STABLE_PADDOCK } from '../sim/content/mounts';
import { getActiveWorldContent, WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_Z } from '../sim/data';
import { onFerryPier } from '../sim/ferry_piers';
import { galeDeckSurface } from '../sim/gale_harbor';
import type { BiomeId } from '../sim/types';
import {
  roadDistance,
  terrainCutAtHeight,
  terrainHeight,
  WATER_LEVEL,
  zoneBiomeAt,
} from '../sim/world';
import { hashAt, insideDressingExclusion, insideHighwatchGuildGround } from './foliage_core';
import { parterreBushSpots } from './garden_parterre_core';
import { GFX } from './gfx';
import { meadowBushSpots } from './meadow_bush_core';

export type DressKind = 'bush' | 'bushFlowers' | 'fern' | 'mushroom';

export interface DressingSpot {
  x: number;
  z: number;
  kind: DressKind;
  scale: number;
  /** authored bloom tint (parterre roses); unset spots pick by biome hash */
  bloomTint?: number;
}

// grass/dressing refuse cliff faces (mirrors ROCK_SLOPE_START in terrain.ts)
const GRASS_MAX_SLOPE = 0.62;
const GRASS_SLOPE_EPS = 1.2;

const DRESS_STEP_HIGH = 12;
const DRESS_STEP_LOW = 10;
const DRESS_DENSITY: Record<BiomeId, number> = {
  vale: 0.26,
  marsh: 0.26,
  peaks: 0.15,
  beach: 0.1,
  desert: 0.07,
  volcano: 0.05,
  cave: 0.08,
  dusk: 0.24,
  ember: 0.18,
  frost: 0.08,
  amber: 0.34,
  fen: 0.8,
  night: 0.32,
  haunt: 0.3,
  jungle: 0.5,
  garden: 0.4,
  gale: 0.32,
};
const DRESS_DENSITY_LOW_SCALE = 1.24;
const DRESS_LOW_SCALE_BOOST = 1.08;

// The denser step, the 1.24 density scale and the 1.08 spot boost are the same
// compensation art direction as the fatter lowPlus grass cards (a fuller ground
// read for weak fragment-bound GPUs), so they ride GFX.denseDressing: lowPlus
// plus the leanFoliage MEDIUM session (weak integrated GPU), whose lean model
// set earns the same compensation. A plain low session takes medium-parity
// dressing density; leanFoliage alone keeps only the LIGHTER lean knobs
// (model set, variants, deco filter, tint softening).
export function dressStep(): number {
  return GFX.denseDressing ? DRESS_STEP_LOW : DRESS_STEP_HIGH;
}

function dressKindFor(biome: BiomeId, r: number): DressKind {
  if (biome === 'vale') {
    if (r < 0.36) return 'bush';
    if (r < 0.46) return 'bushFlowers';
    if (r < 0.8) return 'fern';
    return 'mushroom';
  }
  if (biome === 'marsh') {
    if (r < 0.3) return 'bush';
    if (r < 0.62) return 'fern';
    return 'mushroom';
  }
  if (biome === 'beach' || biome === 'desert') return 'bush';
  if (biome === 'cave') return r < 0.5 ? 'mushroom' : 'fern';
  if (biome === 'volcano') return 'bush';
  if (biome === 'dusk') {
    // glade floor: ferns and flowering bushes carry the ground cover. No
    // dressing mushrooms here: the biome tint turned them neon pink and they
    // clashed with the realm_flora glow mushrooms (user pass, 2026-07).
    if (r < 0.16) return 'bush';
    if (r < 0.4) return 'bushFlowers';
    return 'fern';
  }
  if (biome === 'fen') {
    // the fen floor blooms: flowering hedges everywhere, mushrooms thick in
    // the damp, plain bushes almost absent
    if (r < 0.08) return 'bush';
    if (r < 0.48) return 'bushFlowers';
    if (r < 0.72) return 'fern';
    return 'mushroom';
  }
  if (biome === 'amber') {
    // the gold meadows flower white: bloom hedges lead, ferns fill
    if (r < 0.1) return 'bush';
    if (r < 0.52) return 'bushFlowers';
    if (r < 0.86) return 'fern';
    return 'mushroom';
  }
  if (biome === 'night') {
    // the realm's namesake: luminous bloom hedges dominate the moon meadows,
    // mushrooms fill the dark corners
    if (r < 0.08) return 'bush';
    if (r < 0.56) return 'bushFlowers';
    if (r < 0.76) return 'fern';
    return 'mushroom';
  }
  if (biome === 'haunt') {
    // nothing flowers here: brambles, ferns, and mushrooms in the leaf rot
    if (r < 0.24) return 'bush';
    if (r < 0.6) return 'fern';
    return 'mushroom';
  }
  if (biome === 'jungle') {
    // the understory is the realm: ferns wall the paths, blooms burst
    // through, mushrooms keep to the deep shade
    if (r < 0.16) return 'bush';
    if (r < 0.38) return 'bushFlowers';
    if (r < 0.88) return 'fern';
    return 'mushroom';
  }
  if (biome === 'garden') {
    // rose beds everywhere the gardener's hand once reached
    if (r < 0.12) return 'bush';
    if (r < 0.52) return 'bushFlowers';
    if (r < 0.82) return 'fern';
    return 'mushroom';
  }
  if (biome === 'gale') {
    // wind-flattened scrub and thrift clinging to the downs
    if (r < 0.3) return 'bush';
    if (r < 0.62) return 'bushFlowers';
    if (r < 0.9) return 'fern';
    return 'mushroom';
  }
  return r < 0.62 ? 'bush' : 'fern';
}

const DRESS_SCALE: Record<DressKind, [number, number]> = {
  bush: [0.9, 0.7],
  bushFlowers: [0.9, 0.7],
  fern: [0.85, 0.6],
  mushroom: [0.9, 0.8],
};

// The Galecrest stable paddock is a worked dirt yard: no grass, flowers, or
// scrub inside the fences, while the downs immediately around it bloom hard
// (the flower fields ringing the yard).
export function inStableYard(x: number, z: number): boolean {
  return (
    x > STABLE_PADDOCK.x1 - 1.5 &&
    x < STABLE_PADDOCK.x2 + 1.5 &&
    z > STABLE_PADDOCK.z1 - 1.5 &&
    z < STABLE_PADDOCK.z2 + 1.5
  );
}

export function stableMeadowBand(x: number, z: number): boolean {
  const dx = Math.max(STABLE_PADDOCK.x1 - x, 0, x - STABLE_PADDOCK.x2);
  const dz = Math.max(STABLE_PADDOCK.z1 - z, 0, z - STABLE_PADDOCK.z2);
  const dist = Math.hypot(dx, dz);
  return dist > 1.5 && dist <= 18;
}

// nothing sprouts up through Wickharbor's boardwalk and pier planks, nor the
// far ferry piers' roots
export function onHarborDeck(x: number, z: number, seed: number): boolean {
  const at = (sx: number, sz: number) => terrainHeight(sx, sz, seed);
  return galeDeckSurface(x, z, at, WATER_LEVEL) !== -Infinity || onFerryPier(x, z, at);
}

export function tooSteep(x: number, z: number, seed: number): boolean {
  const hx =
    terrainHeight(x + GRASS_SLOPE_EPS, z, seed) - terrainHeight(x - GRASS_SLOPE_EPS, z, seed);
  const hz =
    terrainHeight(x, z + GRASS_SLOPE_EPS, seed) - terrainHeight(x, z - GRASS_SLOPE_EPS, seed);
  return Math.hypot(hx, hz) / (2 * GRASS_SLOPE_EPS) > GRASS_MAX_SLOPE;
}

export function generateDressing(seed: number): DressingSpot[] {
  const out: DressingSpot[] = [];
  const activeContent = getActiveWorldContent();
  // The render-side twin of sim/ground_dressing.ts generateGroundDressing, and
  // it needs that module's decorationsMode gate for the same reason: the
  // editor's "make foliage editable" converts BOTH scatters into placements
  // and then sets decorationsMode 'empty'. Only the sim copy honoured it, so
  // the drawn bushes and ferns stayed behind as uneditable ghosts of the
  // placements now sitting on top of them.
  if (activeContent.decorationsMode === 'empty') return out;
  const xHalf = WORLD_MAX_X - 16;
  const step = dressStep();
  const scaleBoost = GFX.denseDressing ? DRESS_LOW_SCALE_BOOST : 1;
  for (let gx = -xHalf; gx < xHalf; gx += step) {
    for (let gz = WORLD_MIN_Z + 16; gz < WORLD_MAX_Z - 16; gz += step) {
      const r = hashAt(gx, gz, 41);
      const biome = zoneBiomeAt(gx, gz);
      // the Evergarden takes NO random dressing: every bush there belongs to
      // an authored parterre arrangement (appended after this scatter loop)
      if (biome === 'garden') continue;
      const density = DRESS_DENSITY[biome] * (GFX.denseDressing ? DRESS_DENSITY_LOW_SCALE : 1);
      if (r > density) continue;
      const x = gx + (hashAt(gx, gz, 42) - 0.5) * step;
      const z = gz + (hashAt(gx, gz, 43) - 0.5) * step;
      if (insideDressingExclusion(activeContent.zones, activeContent.camps, x, z)) continue;
      // the Highwatch guild's model brings its own floors, porch and yard: no scrub through them
      if (insideHighwatchGuildGround(x, z)) continue;
      if (roadDistance(x, z) < 4) continue;
      const dressH = terrainHeight(x, z, seed);
      if (dressH < WATER_LEVEL + 1.2) continue;
      if (terrainCutAtHeight(x, z, dressH)) continue;
      if (tooSteep(x, z, seed)) continue;
      // no scrub in the worked stable yard or up through the harbor decks
      if (biome === 'gale' && (inStableYard(x, z) || onHarborDeck(x, z, seed))) continue;
      // the fen's floor dressing grows in CLUMPED patches, not an even
      // scatter: a coarse cell gate keeps most cells bare and the density
      // boost below packs the surviving patches tight
      if (biome === 'fen' && hashAt(Math.floor(x / 16), Math.floor(z / 16), 97) > 0.4) continue;
      const kind = dressKindFor(biome, hashAt(gx, gz, 44));
      const [sMin, sRange] = DRESS_SCALE[kind];
      out.push({ x, z, kind, scale: (sMin + hashAt(gx, gz, 45) * sRange) * scaleBoost });
    }
  }
  // Eastbrook's clustered undergrowth along verges, wall bases, rocks and tree
  // feet (meadow_bush_core.ts): the same spots on every tier, drawn by the
  // bucket meshes the scatter above already fills (instances, no draw call)
  for (const spot of meadowBushSpots(seed, activeContent)) {
    out.push({ x: spot.x, z: spot.z, kind: spot.kind, scale: spot.scale });
  }
  // the Evergarden's clipped hedges and rose centerpieces, laid out by the
  // parterre plan instead of the hash scatter above
  out.push(...parterreBushSpots(seed));
  return out;
}
