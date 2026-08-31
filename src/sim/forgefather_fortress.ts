// The Forgefather's Isle fortress: the owner's hand-placed exterior pass
// (baked from the /placer drakelands_exterior export, 2026-08-28, complete
// with the strait bridge, gatehouse, dragon fountains, waterside quay, and
// the walled sea pool). ONE world-space table drives BOTH the renderer
// (composed into the ember zone features) and the overworld colliders
// below, the interior dressing doctrine carried outside: a piece's
// physical footprint IS its visible silhouette. Placements are absolute
// world coordinates, verbatim from the owner's export. The staircases are
// walk-over props carried by the FORGEFATHER_STAIR_RAMPS walkable-lift
// surfaces (src/sim/content/ember_coast.ts, the Last Keep castle-ramp
// idiom): re-derive those bands and the under-banks whenever a staircase
// row moves.
import type { Collider } from './colliders';
import { FORGEFATHER_STAIR_RAMPS } from './content/ember_coast';
import {
  IGNIVAR_NON_COLLIDING_PROPS,
  IGNIVAR_PROP_COLLIDER_FOOTPRINT,
  IGNIVAR_PROP_NATIVE,
  type IgnivarEnvPropKey,
  type IgnivarPropPlacement,
} from './ignivar_props';
import type { PlacedStreetlamp } from './streetlamp_layout';
import { terrainHeight } from './world';

const DEG = Math.PI / 180;

export const FORGEFATHER_FORTRESS_PLACEMENTS: readonly IgnivarPropPlacement[] = [
  { key: 'tower_base', x: 502.95, y: 17.05, z: 2249.3, ry: 180 * DEG, scale: 11 },
  { key: 'tower_pillar', x: 503.05, y: 26.75, z: 2249.75, ry: 315 * DEG, scale: 12 },
  { key: 'tower_middle', x: 503.05, y: 38, z: 2249.75, ry: 315 * DEG, scale: 9 },
  { key: 'tower_top', x: 503.05, y: 45.95, z: 2249.9, ry: 225 * DEG, scale: 8 },
  { key: 'tower_base', x: 503.05, y: -2, z: 2249.4, ry: 270 * DEG, scale: 20 },
  { key: 'staircase', x: 503.05, y: 14.45, z: 2241.4, ry: 90 * DEG, scale: 6 },
  { key: 'stone_floor', x: 504.3, y: 14.7, z: 2241.15, ry: 270 * DEG, scale: 8 },
  { key: 'staircase', x: 503.35, y: 11.45, z: 2234.15, ry: 90 * DEG, scale: 6 },
  { key: 'stone_floor', x: 504.05, y: 11, z: 2228.7, ry: 180 * DEG, scale: 8 },
  { key: 'dragon_pillar', x: 506.7, y: 13.65, z: 2245.05, ry: 180 * DEG, scale: 8 },
  { key: 'dragon_pillar', x: 506.95, y: 10.9, z: 2235.3, ry: 180 * DEG, scale: 8 },
  { key: 'dragon_pillar', x: 499.95, y: 10.9, z: 2235.3, ry: 180 * DEG, scale: 8 },
  { key: 'dragon_pillar', x: 499.7, y: 13.65, z: 2245.05, ry: 180 * DEG, scale: 8 },
  { key: 'fortress_wall', x: 499.2, y: 7.4, z: 2240.3, ry: 270 * DEG, scale: 9 },
  { key: 'fortress_wall', x: 507.7, y: 7.4, z: 2240.3, ry: 90 * DEG, scale: 9 },
  { key: 'fortress_wall', x: 508.2, y: 6.65, z: 2229.05, ry: 90 * DEG, scale: 9 },
  { key: 'fortress_wall', x: 499.45, y: 6.65, z: 2229.05, ry: 270 * DEG, scale: 9 },
  { key: 'staircase', x: 504.1, y: 6.45, z: 2221.4, ry: 90 * DEG, scale: 9 },
  { key: 'fortress_wall', x: 499.45, y: 2.9, z: 2221.05, ry: 270 * DEG, scale: 9 },
  { key: 'stone_floor', x: 511, y: 6.3, z: 2222.7, ry: 0, scale: 8 },
  { key: 'stone_floor', x: 510.9, y: 6.3, z: 2214.9, ry: 0, scale: 8 },
  { key: 'stone_floor', x: 503.4, y: 6.3, z: 2214.9, ry: 0, scale: 8 },
  { key: 'tower_base', x: 509, y: 6.3, z: 2222.7, ry: 90 * DEG, scale: 6 },
  { key: 'tower_pillar', x: 509, y: 12.05, z: 2222.45, ry: 315 * DEG, scale: 6 },
  { key: 'cannon', x: 509, y: 17.8, z: 2222.45, ry: 120 * DEG, scale: 4 },
  { key: 'fortress_wall', x: 514.45, y: 6.75, z: 2224.2, ry: 90 * DEG, scale: 4 },
  { key: 'fortress_wall', x: 514.45, y: 6.75, z: 2220.7, ry: 90 * DEG, scale: 4 },
  { key: 'fortress_wall', x: 514.45, y: 6.75, z: 2216.95, ry: 90 * DEG, scale: 4 },
  { key: 'fortress_wall', x: 514.45, y: 6.75, z: 2213.2, ry: 90 * DEG, scale: 4 },
  { key: 'fortress_wall', x: 512.2, y: 6.75, z: 2225.2, ry: 180 * DEG, scale: 4 },
  { key: 'lava_pillar', x: 512.2, y: 6.6, z: 2223, ry: 135 * DEG, scale: 8 },
  { key: 'staircase', x: 507.8, y: 1.2, z: 2207.2, ry: 90 * DEG, scale: 9 },
  { key: 'tower_base', x: 513.6, y: 1.3, z: 2210.15, ry: 165 * DEG, scale: 8 },
  { key: 'cannon', x: 513.6, y: 9.05, z: 2210.4, ry: 135 * DEG, scale: 4 },
  { key: 'stone_floor', x: 520.2, y: 2, z: 2209.95, ry: 270 * DEG, scale: 8 },
  { key: 'stone_floor', x: 512.7, y: 2, z: 2209.95, ry: 270 * DEG, scale: 8 },
  { key: 'stone_floor', x: 520.2, y: 2, z: 2202.95, ry: 270 * DEG, scale: 8 },
  { key: 'stone_floor', x: 512.7, y: 2, z: 2202.95, ry: 270 * DEG, scale: 8 },
  { key: 'stone_floor', x: 505.2, y: 2, z: 2202.95, ry: 270 * DEG, scale: 8 },
  { key: 'stone_floor', x: 505.2, y: 2, z: 2195.2, ry: 270 * DEG, scale: 8 },
  { key: 'stone_floor', x: 512.7, y: 2, z: 2195.2, ry: 270 * DEG, scale: 8 },
  { key: 'stone_floor', x: 520.2, y: 2, z: 2195.2, ry: 270 * DEG, scale: 8 },
  { key: 'fortress_wall', x: 522.2, y: 2, z: 2212.7, ry: 120 * DEG, scale: 6 },
  { key: 'fortress_wall', x: 519.2, y: 2, z: 2208.95, ry: 150 * DEG, scale: 6 },
  { key: 'fortress_wall', x: 514.2, y: 2, z: 2206.95, ry: 180 * DEG, scale: 6 },
  { key: 'fortress_wall', x: 523.7, y: 2, z: 2217.7, ry: 90 * DEG, scale: 6 },
  { key: 'tower_pillar', x: 516.95, y: 0, z: 2221.8, ry: 135 * DEG, scale: 14 },
  { key: 'fortress_wall', x: 523.7, y: 2, z: 2212.2, ry: 90 * DEG, scale: 6 },
  { key: 'fortress_wall', x: 523.7, y: 2, z: 2206.95, ry: 90 * DEG, scale: 6 },
  { key: 'fortress_wall', x: 523.7, y: 2, z: 2201.7, ry: 90 * DEG, scale: 6 },
  { key: 'fortress_wall', x: 523.7, y: 2, z: 2196.45, ry: 90 * DEG, scale: 6 },
  { key: 'fortress_wall', x: 519.7, y: 2, z: 2191.45, ry: 180 * DEG, scale: 6 },
  { key: 'tower_pillar', x: 522.6, y: 2, z: 2193, ry: 45 * DEG, scale: 6 },
  { key: 'fortress_wall', x: 514.2, y: 2, z: 2191.45, ry: 180 * DEG, scale: 6 },
  { key: 'fortress_wall', x: 508.7, y: 2, z: 2191.45, ry: 180 * DEG, scale: 6 },
  { key: 'fortress_wall', x: 503.2, y: 2, z: 2191.45, ry: 180 * DEG, scale: 6 },
  { key: 'fortress_wall', x: 499.7, y: 4, z: 2213.7, ry: 270 * DEG, scale: 7 },
  { key: 'staircase', x: 497.05, y: -3.05, z: 2200.45, ry: 180 * DEG, scale: 9 },
  { key: 'fortress_wall', x: 498.95, y: -1, z: 2213.95, ry: 270 * DEG, scale: 10 },
  { key: 'fortress_wall', x: 500.45, y: 2, z: 2194.45, ry: 270 * DEG, scale: 6 },
  { key: 'stone_floor', x: 497.1, y: -2.5, z: 2207.75, ry: 90 * DEG, scale: 8 },
  { key: 'stone_floor', x: 489.35, y: -2.5, z: 2207.75, ry: 90 * DEG, scale: 8 },
  { key: 'stone_floor', x: 489.35, y: -2.5, z: 2200.25, ry: 90 * DEG, scale: 8 },
  { key: 'fortress_wall', x: 498.95, y: -1, z: 2223.2, ry: 270 * DEG, scale: 10 },
  { key: 'fortress_wall', x: 498.4, y: 5.8, z: 2229.3, ry: 270 * DEG, scale: 8 },
  { key: 'fortress_wall', x: 498.4, y: 5.8, z: 2236.8, ry: 270 * DEG, scale: 8 },
  { key: 'tower_pillar', x: 499.4, y: 6.35, z: 2245.7, ry: 90 * DEG, scale: 8 },
  { key: 'tower_pillar', x: 499.4, y: -1.4, z: 2245.7, ry: 90 * DEG, scale: 8 },
  { key: 'fortress_wall', x: 493.3, y: -7.25, z: 2243.5, ry: 270 * DEG, scale: 12 },
  { key: 'fortress_wall', x: 495.3, y: -7.25, z: 2254.25, ry: 300 * DEG, scale: 12 },
  { key: 'fortress_wall', x: 503.3, y: -7.25, z: 2259.75, ry: 0, scale: 12 },
  { key: 'fortress_wall', x: 512.3, y: -7.25, z: 2255.75, ry: 45 * DEG, scale: 12 },
  { key: 'fortress_wall', x: 516.05, y: -7.25, z: 2246.25, ry: 90 * DEG, scale: 12 },
  { key: 'stone_floor', x: 508.3, y: -2.25, z: 2249.25, ry: 90 * DEG, scale: 10 },
  { key: 'fortress_wall', x: 507.7, y: 6.75, z: 2220.2, ry: 90 * DEG, scale: 4 },
  { key: 'tower_pillar', x: 521.95, y: -4.75, z: 2220.8, ry: 135 * DEG, scale: 11 },
  { key: 'tower_pillar', x: 521.2, y: 3, z: 2221.3, ry: 180 * DEG, scale: 8 },
  { key: 'tower_base', x: 520.8, y: -8, z: 2191.5, ry: 315 * DEG, scale: 11 },
  { key: 'tower_base', x: 502.55, y: -8, z: 2191.5, ry: 315 * DEG, scale: 11 },
  { key: 'fortress_wall', x: 510.9, y: -8, z: 2189.9, ry: 180 * DEG, scale: 14 },
  { key: 'tower_pillar', x: 501.1, y: -5.5, z: 2195.75, ry: 315 * DEG, scale: 8 },
  { key: 'fortress_wall', x: 497.6, y: -4.75, z: 2196.25, ry: 180 * DEG, scale: 8 },
  { key: 'bridge_floor', x: 489.1, y: -2.75, z: 2193, ry: 0, scale: 8 },
  { key: 'bridge_floor', x: 481.6, y: -2.75, z: 2193, ry: 0, scale: 8 },
  { key: 'bridge_floor', x: 474.1, y: -2.75, z: 2193, ry: 0, scale: 8 },
  { key: 'bridge_floor', x: 466.6, y: -2.75, z: 2193, ry: 0, scale: 8 },
  { key: 'bridge_floor', x: 459.1, y: -2.75, z: 2193, ry: 0, scale: 8 },
  { key: 'bridge_floor', x: 451.6, y: -2.75, z: 2193, ry: 0, scale: 8 },
  { key: 'bridge_floor', x: 444.1, y: -2.75, z: 2193, ry: 0, scale: 8 },
  { key: 'bridge_floor', x: 436.35, y: -2.75, z: 2193, ry: 0, scale: 8 },
  { key: 'bridge_floor', x: 444.1, y: -2.75, z: 2188.25, ry: 0, scale: 8 },
  { key: 'bridge_floor', x: 436.6, y: -2.75, z: 2188.25, ry: 0, scale: 8 },
  { key: 'bridge_floor', x: 489.1, y: -2.75, z: 2197.75, ry: 0, scale: 8 },
  { key: 'tower_pillar', x: 493.9, y: -8, z: 2192.85, ry: 45 * DEG, scale: 8 },
  { key: 'tower_pillar', x: 491.9, y: -8, z: 2191.85, ry: 0, scale: 7 },
  { key: 'bridge_rail', x: 490.15, y: -1.65, z: 2191.1, ry: 0, scale: 6 },
  { key: 'bridge_rail', x: 485.4, y: -1.65, z: 2191.1, ry: 0, scale: 6 },
  { key: 'bridge_rail', x: 480.65, y: -1.65, z: 2191.1, ry: 0, scale: 6 },
  { key: 'bridge_rail', x: 475.9, y: -1.65, z: 2191.1, ry: 0, scale: 6 },
  { key: 'bridge_rail', x: 471.15, y: -1.65, z: 2191.1, ry: 0, scale: 6 },
  { key: 'bridge_rail', x: 466.4, y: -1.65, z: 2191.1, ry: 0, scale: 6 },
  { key: 'bridge_rail', x: 461.65, y: -1.65, z: 2191.1, ry: 0, scale: 6 },
  { key: 'bridge_rail', x: 456.65, y: -1.65, z: 2190.85, ry: 0, scale: 6 },
  { key: 'bridge_rail', x: 451.9, y: -1.65, z: 2190.85, ry: 0, scale: 6 },
  { key: 'bridge_rail', x: 447.65, y: -1.65, z: 2188.6, ry: 90 * DEG, scale: 6 },
  { key: 'bridge_floor', x: 481.6, y: -2.75, z: 2197.75, ry: 0, scale: 8 },
  { key: 'bridge_floor', x: 474.1, y: -2.75, z: 2197.75, ry: 0, scale: 8 },
  { key: 'bridge_floor', x: 466.6, y: -2.75, z: 2197.75, ry: 0, scale: 8 },
  { key: 'bridge_floor', x: 459.1, y: -2.75, z: 2197.75, ry: 0, scale: 8 },
  { key: 'bridge_floor', x: 451.6, y: -2.75, z: 2197.75, ry: 0, scale: 8 },
  { key: 'bridge_floor', x: 444.1, y: -2.75, z: 2197.75, ry: 0, scale: 8 },
  { key: 'bridge_rail', x: 451.9, y: -1.65, z: 2199.85, ry: 0, scale: 6 },
  { key: 'bridge_rail', x: 456.4, y: -1.65, z: 2199.85, ry: 0, scale: 6 },
  { key: 'bridge_rail', x: 461.15, y: -1.65, z: 2199.85, ry: 0, scale: 6 },
  { key: 'bridge_rail', x: 465.9, y: -1.65, z: 2199.85, ry: 0, scale: 6 },
  { key: 'bridge_rail', x: 470.65, y: -1.65, z: 2199.85, ry: 0, scale: 6 },
  { key: 'bridge_rail', x: 475.4, y: -1.65, z: 2199.85, ry: 0, scale: 6 },
  { key: 'bridge_rail', x: 480.15, y: -1.65, z: 2199.85, ry: 0, scale: 6 },
  { key: 'bridge_pillar', x: 481.6, y: -8, z: 2191.5, ry: 285 * DEG, scale: 6 },
  { key: 'bridge_pillar', x: 471.85, y: -8, z: 2191.5, ry: 285 * DEG, scale: 6 },
  { key: 'bridge_pillar', x: 462.35, y: -8, z: 2191.5, ry: 285 * DEG, scale: 6 },
  { key: 'bridge_pillar', x: 452.1, y: -8, z: 2191.5, ry: 285 * DEG, scale: 6 },
  { key: 'bridge_pillar', x: 451.6, y: -8, z: 2199.5, ry: 270 * DEG, scale: 6 },
  { key: 'bridge_pillar', x: 461.1, y: -8, z: 2199.5, ry: 270 * DEG, scale: 6 },
  { key: 'bridge_pillar', x: 470.6, y: -8, z: 2199.5, ry: 270 * DEG, scale: 6 },
  { key: 'bridge_pillar', x: 480.6, y: -8, z: 2199.5, ry: 270 * DEG, scale: 6 },
  { key: 'fortress_wall', x: 500.8, y: 5.95, z: 2194.4, ry: 270 * DEG, scale: 6 },
  { key: 'fortress_wall', x: 500.8, y: 1.7, z: 2207.4, ry: 270 * DEG, scale: 7 },
  { key: 'fortress_wall', x: 500.8, y: 5.95, z: 2207.15, ry: 270 * DEG, scale: 6 },
  { key: 'fortress_wall', x: 501.05, y: 9.95, z: 2197.65, ry: 270 * DEG, scale: 4 },
  { key: 'fortress_wall', x: 501.05, y: 9.95, z: 2203.65, ry: 270 * DEG, scale: 4 },
  { key: 'fortress_wall', x: 501.05, y: 9.95, z: 2200.65, ry: 90 * DEG, scale: 4 },
  { key: 'gate', x: 501.1, y: 6.25, z: 2198.45, ry: 90 * DEG, scale: 8 },
  { key: 'gate', x: 501.1, y: 6.25, z: 2202.45, ry: 90 * DEG, scale: 8 },
  { key: 'gate_gear', x: 500.85, y: 9.25, z: 2200.6, ry: 270 * DEG, scale: 4 },
  { key: 'dragon_head', x: 498.85, y: 3.5, z: 2194.1, ry: 180 * DEG, scale: 4 },
  { key: 'fountain_base', x: 498.85, y: 1.5, z: 2194.1, ry: 270 * DEG, scale: 8 },
  { key: 'dragon_head', x: 511.1, y: 1.75, z: 2189.6, ry: 90 * DEG, scale: 4 },
  { key: 'fountain_base', x: 511.1, y: 0, z: 2188.85, ry: 180 * DEG, scale: 8 },
  { key: 'dragon_head', x: 497.85, y: 4, z: 2208.35, ry: 180 * DEG, scale: 4 },
  { key: 'tower_pillar', x: 498.8, y: -2.25, z: 2205.35, ry: 0, scale: 4 },
  { key: 'tower_pillar', x: 497.8, y: -2.25, z: 2206.35, ry: 0, scale: 4 },
  { key: 'tower_pillar', x: 497.8, y: -2.25, z: 2208.35, ry: 0, scale: 4 },
  { key: 'tower_pillar', x: 497.8, y: -2.25, z: 2210.35, ry: 0, scale: 4 },
  { key: 'fortress_wall', x: 497.4, y: -2.75, z: 2204.7, ry: 225 * DEG, scale: 4 },
  { key: 'fortress_wall', x: 495.9, y: -2.75, z: 2207.45, ry: 270 * DEG, scale: 4 },
  { key: 'fortress_wall', x: 495.9, y: -2.75, z: 2209.45, ry: 270 * DEG, scale: 4 },
  { key: 'fortress_wall', x: 497.4, y: -2.75, z: 2212.45, ry: 315 * DEG, scale: 4 },
  { key: 'dragon_pillar', x: 484.55, y: -2, z: 2200.7, ry: 135 * DEG, scale: 8 },
  { key: 'tower_pillar', x: 448.75, y: -3.7, z: 2190.55, ry: 225 * DEG, scale: 5 },
  { key: 'bridge_floor', x: 444.1, y: -2.25, z: 2183.75, ry: 0, scale: 8 },
  { key: 'bridge_rail', x: 447.65, y: -1.65, z: 2183.85, ry: 90 * DEG, scale: 6 },
  { key: 'tower_base', x: 501.3, y: 0.9, z: 2207.9, ry: 225 * DEG, scale: 10 },
  { key: 'fountain_base', x: 497.6, y: 1.5, z: 2208.6, ry: 270 * DEG, scale: 8 },
  { key: 'cannon', x: 501.05, y: 10.65, z: 2207.9, ry: 135 * DEG, scale: 5 },
  { key: 'street_lamp', x: 502.5, y: 2.6, z: 2204.7, ry: 180 * DEG, scale: 1 },
  { key: 'street_lamp', x: 512.25, y: 2.6, z: 2205.2, ry: 180 * DEG, scale: 1 },
  { key: 'street_lamp', x: 522, y: 2.6, z: 2211.95, ry: 180 * DEG, scale: 1 },
  { key: 'street_lamp', x: 522, y: 2.6, z: 2195.2, ry: 180 * DEG, scale: 1 },
  { key: 'dragon_head', x: 503.8, y: 3.35, z: 2192.8, ry: 270 * DEG, scale: 3 },
  { key: 'fountain_base', x: 503.8, y: 2.6, z: 2193.05, ry: 0, scale: 5 },
  { key: 'fountain_base', x: 518.8, y: 2.6, z: 2193.05, ry: 0, scale: 5 },
  { key: 'dragon_head', x: 518.8, y: 3.35, z: 2192.8, ry: 270 * DEG, scale: 3 },
  { key: 'street_lamp', x: 501.75, y: 2.6, z: 2195.7, ry: 180 * DEG, scale: 1 },
  { key: 'steam_pipes', x: 511.3, y: 2.6, z: 2191.8, ry: 0, scale: 4 },
  { key: 'industrial_pipe', x: 508.3, y: 2.6, z: 2191.8, ry: 0, scale: 3 },
  { key: 'industrial_pipe', x: 514.3, y: 2.6, z: 2191.8, ry: 0, scale: 3 },
  { key: 'gate_gear', x: 501.6, y: 9.25, z: 2200.6, ry: 90 * DEG, scale: 4 },
  { key: 'gear_wall_rusty', x: 501.3, y: 10.35, z: 2198.05, ry: 90 * DEG, scale: 3 },
  { key: 'gear_wall_rusty', x: 501.3, y: 10.35, z: 2203.3, ry: 90 * DEG, scale: 3 },
  { key: 'street_lamp', x: 513.25, y: 6.9, z: 2212.35, ry: 180 * DEG, scale: 1 },
  { key: 'street_lamp', x: 508.5, y: 5.65, z: 2218.35, ry: 180 * DEG, scale: 1 },
  { key: 'tower_pillar', x: 507.1, y: 9.85, z: 2232.6, ry: 225 * DEG, scale: 4 },
  { key: 'fortress_wall', x: 508.2, y: 11.95, z: 2240.5, ry: 90 * DEG, scale: 8 },
  { key: 'fortress_wall', x: 499.95, y: 11.95, z: 2240.25, ry: 270 * DEG, scale: 8 },
  { key: 'street_lamp', x: 499.3, y: 10.65, z: 2225.35, ry: 180 * DEG, scale: 1 },
  { key: 'street_lamp', x: 507.3, y: 10.65, z: 2225.35, ry: 180 * DEG, scale: 1 },
  { key: 'street_lamp', x: 507.3, y: 14.9, z: 2237.1, ry: 180 * DEG, scale: 1 },
  { key: 'street_lamp', x: 499.8, y: 14.9, z: 2237.1, ry: 180 * DEG, scale: 1 },
  { key: 'street_lamp', x: 500.25, y: 5.65, z: 2211.6, ry: 180 * DEG, scale: 1 },
  { key: 'chain_link', x: 501.35, y: 7.6, z: 2194.5, ry: 90 * DEG, scale: 4 },
  { key: 'chain_hanging', x: 501.6, y: 2.6, z: 2192.5, ry: 90 * DEG, scale: 8 },
  { key: 'tower_pillar', x: 493.9, y: -3.5, z: 2195.5, ry: 45 * DEG, scale: 5 },
  { key: 'street_lamp', x: 493.7, y: -2.6, z: 2195.6, ry: 180 * DEG, scale: 1 },
  { key: 'dungeon_entrance', x: 502.9, y: 17.7, z: 2244.7, ry: 180 * DEG, scale: 10 },
];

/** How far above the local ground a piece's base may sit and still count as
 *  GROUND-STANDING (collides). Higher pieces are aerial members of a stacked
 *  assembly (upper tower sections, wall-top cannons): no body can reach
 *  their span, so they carry no collider. */
const GROUND_STAND_TOLERANCE = 2.5;

/** Deck pieces walked ON: each emits a STANDABLE platform collider at its
 *  own surface height (the parkour moveTopY lane), whatever hangs beneath.
 *  This is what carries a body across the strait bridge instead of into
 *  the water under it. */
export const FORTRESS_STANDABLE_KEYS: ReadonlySet<IgnivarEnvPropKey> = new Set([
  'bridge_floor',
  'stone_floor',
]);

interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Subtract `cut` from each rect, returning the up-to-four remainder
 *  strips per rect. Everything here is axis-aligned (every stone_floor and
 *  bridge_floor sits at a multiple of 90 degrees), so plain rectangle
 *  arithmetic is exact. */
function subtractRect(rects: Rect[], cut: Rect): Rect[] {
  const out: Rect[] = [];
  for (const r of rects) {
    const ix0 = Math.max(r.x0, cut.x0);
    const ix1 = Math.min(r.x1, cut.x1);
    const iz0 = Math.max(r.z0, cut.z0);
    const iz1 = Math.min(r.z1, cut.z1);
    if (ix0 >= ix1 || iz0 >= iz1) {
      out.push(r);
      continue;
    }
    if (r.z0 < iz0) out.push({ x0: r.x0, x1: r.x1, z0: r.z0, z1: iz0 });
    if (iz1 < r.z1) out.push({ x0: r.x0, x1: r.x1, z0: iz1, z1: r.z1 });
    if (r.x0 < ix0) out.push({ x0: r.x0, x1: ix0, z0: iz0, z1: iz1 });
    if (ix1 < r.x1) out.push({ x0: ix1, x1: r.x1, z0: iz0, z1: iz1 });
  }
  return out;
}

/** A floor plate's standable footprint, cropped where a stair-ramp band
 *  rises more than a comfortable step above the plate's top: the movement
 *  kernel never lifts a platform-carried body onto terrain climbing
 *  overhead, so a plate left standable under a rising flight would carry
 *  walkers INSIDE the ramp mass (the owner slid the landing plate under
 *  the keep stair; the flight rises straight through it). */
function croppedPlateRects(aabb: Rect, top: number): Rect[] {
  let rects: Rect[] = [aabb];
  for (const band of FORGEFATHER_STAIR_RAMPS) {
    const rise = band.h1 - band.h0;
    const limit = top + 0.5;
    // The along-axis interval where the band's surface exceeds the limit.
    let lo = Math.min(band.a0, band.a1);
    let hi = Math.max(band.a0, band.a1);
    if (Math.max(band.h0, band.h1) <= limit) continue;
    if (Math.min(band.h0, band.h1) < limit) {
      const tCross = (limit - band.h0) / rise;
      const aCross = band.a0 + (band.a1 - band.a0) * tCross;
      if (band.h1 > band.h0) {
        if (band.a1 > band.a0) lo = Math.max(lo, aCross);
        else hi = Math.min(hi, aCross);
      } else if (band.a1 > band.a0) hi = Math.min(hi, aCross);
      else lo = Math.max(lo, aCross);
    }
    if (lo >= hi) continue;
    const cut: Rect =
      band.axis === 'z'
        ? { x0: band.b0, x1: band.b1, z0: lo, z1: hi }
        : { x0: lo, x1: hi, z0: band.b0, z1: band.b1 };
    rects = subtractRect(rects, cut);
  }
  return rects;
}

/** The round tower pieces collide as CIRCLES at their drum radius: a
 *  square OBB overhangs a cylinder's wall by 41% at the corners, and the
 *  two bailey-flanking towers' squares pinched that stair's corridor to
 *  0.34yd, parking every climb at a tread face. Radius is the mean of the
 *  two footprint axes' halves (the drum, buttress trim averaged in). */
export const FORTRESS_CYLINDRICAL_KEYS: ReadonlySet<IgnivarEnvPropKey> = new Set([
  'tower_base',
  'tower_middle',
  'tower_pillar',
]);

/** The owner's hand-placed fortress lamps, as streetlamp SITES: the placer
 *  key 'street_lamp' bakes into the SAME pipeline the town lamps ride
 *  (colliders.ts appends these to streetlampPlacements), so each fortress
 *  lamp gets the Drakelands brazier fixture, its real night light, and its
 *  post collider exactly like a road lamp. The env-prop paths skip the key
 *  (walk-over in the dressing sense; the render skips it too). */
export function forgefatherStreetlampSites(): PlacedStreetlamp[] {
  return FORGEFATHER_FORTRESS_PLACEMENTS.filter((p) => p.key === 'street_lamp').map((p) => ({
    x: p.x,
    y: p.y,
    z: p.z,
    roadYaw: p.ry,
    areaId: 'drakelands',
    style: 'drakelands_brazier',
    authored: true,
  }));
}

/** Colliders for the baked pass, in world space: standable platform OBBs
 *  for the deck pieces and the staircase treads, full-height blocker OBBs
 *  for every ground-standing solid (the ignivarPropColliders derivation,
 *  ground-aware because exterior terrain is not a flat interior floor). */
export function forgefatherFortressColliders(seed: number): Collider[] {
  const colliders: Collider[] = [];
  for (const placement of FORGEFATHER_FORTRESS_PLACEMENTS) {
    const native = IGNIVAR_PROP_NATIVE[placement.key];
    const footprint = IGNIVAR_PROP_COLLIDER_FOOTPRINT[placement.key] ?? 1;
    if (FORTRESS_STANDABLE_KEYS.has(placement.key)) {
      const top = placement.y + native.hei * placement.scale;
      // Every deck sits at a multiple of 90 degrees, so its footprint is an
      // axis-aligned rectangle: crop it around any stair-ramp band rising
      // through it, then emit each remainder strip as its own platform.
      const cos = Math.abs(Math.cos(placement.ry));
      const halfX = ((cos * native.len + (1 - cos) * native.dep) * placement.scale) / 2;
      const halfZ = (((1 - cos) * native.len + cos * native.dep) * placement.scale) / 2;
      const aabb: Rect = {
        x0: placement.x - halfX,
        x1: placement.x + halfX,
        z0: placement.z - halfZ,
        z1: placement.z + halfZ,
      };
      for (const rect of croppedPlateRects(aabb, top))
        colliders.push({
          type: 'obb',
          x: (rect.x0 + rect.x1) / 2,
          z: (rect.z0 + rect.z1) / 2,
          hw: (rect.x1 - rect.x0) / 2,
          hd: (rect.z1 - rect.z0) / 2,
          rot: 0,
          moveTopY: top,
          cameraTopY: top,
          standable: true,
        });
      continue;
    }
    if (IGNIVAR_NON_COLLIDING_PROPS.has(placement.key)) continue;
    const ground = terrainHeight(placement.x, placement.z, seed);
    if (placement.y > ground + GROUND_STAND_TOLERANCE) continue;
    // Fully interred pieces (the summit foundation shaft) never collide: a
    // full-height OBB has no top, so a buried mass would otherwise blanket
    // the walkable ground above it.
    if (placement.y + native.hei * placement.scale < ground + 0.5) continue;
    // Every solid carries its real top as a movement top (the parkour
    // pass-over lane): a wall or tower stays a wall to anyone below it,
    // while a bridge support whose cap pokes just past the deck it holds
    // no longer walls the walkers crossing ABOVE it.
    const top = placement.y + native.hei * placement.scale;
    if (FORTRESS_CYLINDRICAL_KEYS.has(placement.key)) {
      colliders.push({
        type: 'circle',
        x: placement.x,
        z: placement.z,
        r: ((native.len + native.dep) * placement.scale * footprint) / 4,
        moveTopY: top,
        cameraTopY: top,
      });
      continue;
    }
    colliders.push({
      type: 'obb',
      x: placement.x,
      z: placement.z,
      hw: (native.len * placement.scale * footprint) / 2,
      hd: (native.dep * placement.scale * footprint) / 2,
      rot: placement.ry,
      moveTopY: top,
      cameraTopY: top,
    });
  }
  return colliders;
}
