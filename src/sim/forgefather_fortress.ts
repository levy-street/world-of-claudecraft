// The Forgefather's Isle fortress AND the Last Keep rebuild on its pad:
// the owner's hand-placed exterior passes (baked from the /placer
// drakelands_exterior exports: the isle fortress with its strait bridge,
// gatehouse, dragon fountains, waterside quay, and walled sea pool on
// 2026-08-28; the keep's walled grounds, temple court, training yard,
// plazas, boardwalk, and road-gate on 2026-08-30). ONE world-space table
// drives BOTH the renderer
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
  { key: 'tower_base', x: 501.3, y: 0.9, z: 2207.9, ry: 225 * DEG, scale: 10 },
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
  { key: 'fountain_base', x: 497.6, y: 1.5, z: 2208.6, ry: 270 * DEG, scale: 8 },
  { key: 'tower_pillar', x: 498.8, y: -2.25, z: 2205.35, ry: 0, scale: 4 },
  { key: 'tower_pillar', x: 497.8, y: -2.25, z: 2206.35, ry: 0, scale: 4 },
  { key: 'tower_pillar', x: 497.8, y: -2.25, z: 2208.35, ry: 0, scale: 4 },
  { key: 'tower_pillar', x: 497.8, y: -2.25, z: 2210.35, ry: 0, scale: 4 },
  { key: 'fortress_wall', x: 497.4, y: -2.75, z: 2204.7, ry: 225 * DEG, scale: 4 },
  { key: 'cannon', x: 501.05, y: 10.65, z: 2207.9, ry: 135 * DEG, scale: 5 },
  { key: 'fortress_wall', x: 495.9, y: -2.75, z: 2207.45, ry: 270 * DEG, scale: 4 },
  { key: 'fortress_wall', x: 495.9, y: -2.75, z: 2209.45, ry: 270 * DEG, scale: 4 },
  { key: 'fortress_wall', x: 497.4, y: -2.75, z: 2212.45, ry: 315 * DEG, scale: 4 },
  { key: 'dragon_pillar', x: 484.55, y: -2, z: 2200.7, ry: 135 * DEG, scale: 8 },
  { key: 'tower_pillar', x: 448.75, y: -3.7, z: 2190.55, ry: 225 * DEG, scale: 5 },
  { key: 'bridge_floor', x: 444.1, y: -2.25, z: 2183.75, ry: 0, scale: 8 },
  { key: 'bridge_rail', x: 447.65, y: -1.65, z: 2183.85, ry: 90 * DEG, scale: 6 },
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
  // ---------------------------------------------------------------------
  // The Last Keep rebuild (the owner's second placer pass, 2026-08-30):
  // the walled grounds on the keep-site pad west of the fortress. The long
  // west wall and training yard, the raised temple court holding the
  // keep castle_door (the dungeon door: see the_last_keep in
  // content/dungeons.ts and the castle_door arm in render/door_portal.ts),
  // the paved plazas, the western boardwalk, and the triple-gate house at
  // the dune-fork road's terminus. The third pass below re-sat four of
  // this pass's south-wall pieces in place.
  // ---------------------------------------------------------------------
  { key: 'fortress_wall', x: 493.9, y: 2, z: 2179, ry: 90 * DEG, scale: 5 },
  { key: 'fortress_wall', x: 493.9, y: 2, z: 2174.75, ry: 90 * DEG, scale: 5 },
  { key: 'fortress_wall', x: 493.9, y: 2, z: 2170.5, ry: 90 * DEG, scale: 5 },
  { key: 'fortress_wall', x: 493.9, y: 2, z: 2166.25, ry: 90 * DEG, scale: 5 },
  { key: 'fortress_wall', x: 493.9, y: 2, z: 2162, ry: 90 * DEG, scale: 5 },
  { key: 'fortress_wall', x: 493.9, y: 2, z: 2157.75, ry: 90 * DEG, scale: 5 },
  { key: 'fortress_wall', x: 493.9, y: 2, z: 2153.5, ry: 90 * DEG, scale: 5 },
  { key: 'bridge_floor', x: 490.95, y: 4.5, z: 2176.65, ry: 270 * DEG, scale: 9 },
  { key: 'bridge_floor', x: 490.95, y: 4.5, z: 2159.65, ry: 270 * DEG, scale: 9 },
  { key: 'bridge_floor', x: 485.7, y: 4.5, z: 2159.65, ry: 270 * DEG, scale: 9 },
  { key: 'bridge_floor', x: 485.7, y: 4.5, z: 2176.65, ry: 270 * DEG, scale: 9 },
  { key: 'bridge_floor', x: 480.45, y: 4.5, z: 2176.65, ry: 270 * DEG, scale: 9 },
  { key: 'bridge_floor', x: 480.45, y: 4.5, z: 2168.15, ry: 270 * DEG, scale: 9 },
  { key: 'bridge_floor', x: 480.45, y: 4.5, z: 2159.65, ry: 270 * DEG, scale: 9 },
  { key: 'building_base', x: 489.85, y: 5.75, z: 2160.9, ry: 180 * DEG, scale: 8 },
  { key: 'building_base', x: 489.85, y: 5.75, z: 2175.9, ry: 0, scale: 8 },
  { key: 'building_base_roof', x: 488.95, y: 5.25, z: 2168.35, ry: 270 * DEG, scale: 11 },
  { key: 'building_base_roof', x: 486.1, y: 5.75, z: 2168.3, ry: 270 * DEG, scale: 11 },
  { key: 'building_base', x: 486.85, y: 5.75, z: 2160.9, ry: 180 * DEG, scale: 8 },
  { key: 'building_base', x: 487.35, y: 5.75, z: 2175.9, ry: 0, scale: 8 },
  { key: 'square_wall', x: 488.45, y: 5, z: 2178.95, ry: 0, scale: 4 },
  { key: 'square_wall', x: 488.2, y: 5, z: 2157.95, ry: 180 * DEG, scale: 4 },
  { key: 'tower_pillar', x: 485.75, y: 6.25, z: 2165.7, ry: 45 * DEG, scale: 8 },
  { key: 'tower_pillar', x: 490.75, y: 6, z: 2170.7, ry: 135 * DEG, scale: 8 },
  { key: 'tower_pillar', x: 487.75, y: 7.5, z: 2168.2, ry: 135 * DEG, scale: 9 },
  { key: 'tower_pillar', x: 484.75, y: 6.5, z: 2168.2, ry: 90 * DEG, scale: 7 },
  { key: 'tower_pillar', x: 488.75, y: 5.5, z: 2165.45, ry: 135 * DEG, scale: 6 },
  { key: 'tower_pillar', x: 491, y: 5.75, z: 2167.7, ry: 90 * DEG, scale: 7 },
  { key: 'tower_base', x: 484.2, y: 4.5, z: 2162.6, ry: 135 * DEG, scale: 8 },
  { key: 'tower_base', x: 483.95, y: 4.75, z: 2174.1, ry: 30 * DEG, scale: 8 },
  { key: 'dragon_pillar', x: 483.95, y: 12.25, z: 2162.6, ry: 270 * DEG, scale: 5 },
  { key: 'dragon_pillar', x: 483.95, y: 12.5, z: 2174.1, ry: 270 * DEG, scale: 5 },
  { key: 'dragon_pillar', x: 487.7, y: 16, z: 2168.35, ry: 270 * DEG, scale: 5 },
  { key: 'castle_door', x: 480.7, y: 5.75, z: 2168.1, ry: 270 * DEG, scale: 9 },
  { key: 'dragon_statue', x: 481.45, y: 5.75, z: 2158.6, ry: 255 * DEG, scale: 5 },
  { key: 'dragon_statue', x: 481.95, y: 5.75, z: 2177.6, ry: 300 * DEG, scale: 5 },
  { key: 'dragon_statue', x: 484.45, y: 13, z: 2168.35, ry: 270 * DEG, scale: 4 },
  { key: 'tower_pillar', x: 485.75, y: 6.25, z: 2170.95, ry: 105 * DEG, scale: 6 },
  { key: 'staircase', x: 468.95, y: 0.75, z: 2168.15, ry: 180 * DEG, scale: 8 },
  { key: 'fence', x: 471.6, y: 5.75, z: 2161.5, ry: 90 * DEG, scale: 8 },
  { key: 'fence', x: 471.85, y: 5.5, z: 2159, ry: 90 * DEG, scale: 8 },
  { key: 'fence', x: 472.35, y: 5.5, z: 2174.75, ry: 90 * DEG, scale: 8 },
  { key: 'fence', x: 472.1, y: 5.5, z: 2176.75, ry: 90 * DEG, scale: 8 },
  { key: 'fortress_wall', x: 493.9, y: 2, z: 2145, ry: 90 * DEG, scale: 5 },
  { key: 'fence', x: 490, y: 2, z: 2142.6, ry: 180 * DEG, scale: 8 },
  { key: 'fence', x: 482.75, y: 2, z: 2142.6, ry: 180 * DEG, scale: 8 },
  { key: 'fence', x: 477.1, y: 2, z: 2144.75, ry: 270 * DEG, scale: 6 },
  { key: 'tower_pillar', x: 493.7, y: 2, z: 2142.4, ry: 315 * DEG, scale: 4 },
  { key: 'tower_pillar', x: 478.45, y: 2, z: 2142.4, ry: 345 * DEG, scale: 4 },
  { key: 'staircase', x: 474.7, y: -1, z: 2144.65, ry: 90 * DEG, scale: 7 },
  { key: 'fortress_wall', x: 493.9, y: 2, z: 2149.25, ry: 90 * DEG, scale: 5 },
  { key: 'bridge_floor', x: 490.95, y: 2, z: 2151.4, ry: 270 * DEG, scale: 9 },
  { key: 'bridge_floor', x: 485.7, y: 2, z: 2151.4, ry: 270 * DEG, scale: 9 },
  { key: 'bridge_floor', x: 480.2, y: 2, z: 2151.4, ry: 270 * DEG, scale: 9 },
  { key: 'bridge_floor', x: 491.2, y: 2, z: 2147.15, ry: 270 * DEG, scale: 9 },
  { key: 'bridge_floor', x: 485.7, y: 2, z: 2147.15, ry: 270 * DEG, scale: 9 },
  { key: 'bridge_floor', x: 480.2, y: 2, z: 2147.15, ry: 270 * DEG, scale: 9 },
  { key: 'shield_rack', x: 491.2, y: 3.25, z: 2145.2, ry: 315 * DEG, scale: 4 },
  { key: 'weapon_rack', x: 490.3, y: 3.25, z: 2153.3, ry: 180 * DEG, scale: 4 },
  { key: 'dummy', x: 488.05, y: 3.75, z: 2149.05, ry: 135 * DEG, scale: 3 },
  { key: 'dummy', x: 482.55, y: 3.75, z: 2144.05, ry: 0, scale: 3 },
  { key: 'dragon_statue', x: 478.55, y: 5.75, z: 2142.55, ry: 225 * DEG, scale: 2 },
  { key: 'dragon_statue', x: 493.55, y: 5.75, z: 2142.55, ry: 150 * DEG, scale: 2 },
  { key: 'street_lamp', x: 492.45, y: 3.25, z: 2144, ry: 0, scale: 0.5 },
  { key: 'street_lamp', x: 478.45, y: 3.25, z: 2144.25, ry: 0, scale: 0.5 },
  { key: 'street_lamp', x: 465.8, y: 2, z: 2164.8, ry: 0, scale: 1 },
  { key: 'street_lamp', x: 465.55, y: 2, z: 2171.3, ry: 0, scale: 1 },
  { key: 'street_lamp', x: 486.1, y: 2, z: 2151.5, ry: 0, scale: 1 },
  { key: 'street_lamp', x: 472.05, y: 2, z: 2143.8, ry: 0, scale: 1 },
  { key: 'bridge_floor', x: 474.7, y: 4.5, z: 2176.65, ry: 270 * DEG, scale: 9 },
  { key: 'bridge_floor', x: 474.7, y: 4.5, z: 2168.15, ry: 270 * DEG, scale: 9 },
  { key: 'bridge_floor', x: 474.7, y: 4.5, z: 2159.65, ry: 270 * DEG, scale: 9 },
  { key: 'fence', x: 475.6, y: 5.5, z: 2181, ry: 180 * DEG, scale: 8 },
  { key: 'fence', x: 489.85, y: 5.5, z: 2181, ry: 180 * DEG, scale: 8 },
  { key: 'fence', x: 483.35, y: 5.5, z: 2181, ry: 180 * DEG, scale: 8 },
  { key: 'bridge_floor', x: 474.7, y: 2, z: 2151.4, ry: 270 * DEG, scale: 9 },
  { key: 'fence', x: 471.6, y: 2, z: 2151.5, ry: 270 * DEG, scale: 8 },
  { key: 'fortress_wall', x: 470.7, y: 2, z: 2161.45, ry: 270 * DEG, scale: 5 },
  { key: 'fortress_wall', x: 470.7, y: 2, z: 2156.95, ry: 270 * DEG, scale: 5 },
  { key: 'fortress_wall', x: 467.95, y: 2, z: 2164.45, ry: 180 * DEG, scale: 5 },
  { key: 'tower_pillar', x: 470.05, y: 2, z: 2163.05, ry: 45 * DEG, scale: 5 },
  { key: 'fortress_wall', x: 467.7, y: 2, z: 2171.7, ry: 0, scale: 5 },
  { key: 'fortress_wall', x: 471.2, y: 2, z: 2179.45, ry: 270 * DEG, scale: 5 },
  { key: 'fortress_wall', x: 471.2, y: 2, z: 2174.95, ry: 270 * DEG, scale: 5 },
  { key: 'tower_pillar', x: 477.95, y: 3.25, z: 2154.45, ry: 330 * DEG, scale: 5 },
  { key: 'fortress_wall', x: 474.6, y: 2, z: 2154.9, ry: 180 * DEG, scale: 5 },
  { key: 'fence', x: 489.6, y: 5.5, z: 2155.4, ry: 180 * DEG, scale: 8 },
  { key: 'fence', x: 475.35, y: 5.5, z: 2155.4, ry: 180 * DEG, scale: 8 },
  { key: 'tower_pillar', x: 486.95, y: 3.25, z: 2154.45, ry: 315 * DEG, scale: 5 },
  { key: 'fortress_wall', x: 490.35, y: 2, z: 2154.9, ry: 180 * DEG, scale: 5 },
  { key: 'staircase', x: 482.6, y: 2, z: 2152.5, ry: 90 * DEG, scale: 7 },
  { key: 'tower_pillar', x: 485.95, y: 3.25, z: 2153.2, ry: 315 * DEG, scale: 4 },
  { key: 'tower_pillar', x: 485.95, y: 3.25, z: 2151.7, ry: 330 * DEG, scale: 3 },
  { key: 'tower_pillar', x: 478.95, y: 3.25, z: 2153.2, ry: 15 * DEG, scale: 4 },
  { key: 'tower_pillar', x: 478.95, y: 3.25, z: 2151.7, ry: 15 * DEG, scale: 3 },
  { key: 'street_lamp', x: 479.1, y: 2, z: 2151.5, ry: 0, scale: 1 },
  { key: 'shield_rack', x: 474.45, y: 3.25, z: 2153, ry: 180 * DEG, scale: 4 },
  { key: 'fence', x: 471.4, y: 2, z: 2146.15, ry: 270 * DEG, scale: 6 },
  { key: 'stone_floor', x: 467.05, y: 1.5, z: 2177.95, ry: 0, scale: 10 },
  { key: 'stone_floor', x: 467.05, y: 1.5, z: 2168.7, ry: 0, scale: 10 },
  { key: 'stone_floor', x: 467.05, y: 1.5, z: 2159.45, ry: 0, scale: 10 },
  { key: 'stone_floor', x: 467.05, y: 1.5, z: 2150.2, ry: 0, scale: 10 },
  { key: 'stone_floor', x: 467.05, y: 1.5, z: 2140.95, ry: 0, scale: 10 },
  { key: 'stone_floor', x: 476.55, y: 1.5, z: 2140.95, ry: 0, scale: 10 },
  { key: 'stone_floor', x: 486.05, y: 1.5, z: 2140.95, ry: 0, scale: 10 },
  { key: 'stone_floor', x: 457.7, y: 1.5, z: 2177.9, ry: 0, scale: 10 },
  { key: 'stone_floor', x: 448.2, y: 1.5, z: 2177.9, ry: 0, scale: 10 },
  { key: 'stone_floor', x: 438.95, y: 1.5, z: 2177.9, ry: 0, scale: 10 },
  { key: 'stone_floor', x: 438.95, y: 1.5, z: 2168.65, ry: 0, scale: 10 },
  { key: 'stone_floor', x: 448.2, y: 1.5, z: 2168.65, ry: 0, scale: 10 },
  { key: 'stone_floor', x: 457.7, y: 1.5, z: 2168.65, ry: 0, scale: 10 },
  { key: 'stone_floor', x: 438.95, y: 1.5, z: 2159.4, ry: 0, scale: 10 },
  { key: 'stone_floor', x: 438.95, y: 1.5, z: 2150.15, ry: 0, scale: 10 },
  { key: 'stone_floor', x: 448.2, y: 1.5, z: 2159.4, ry: 0, scale: 10 },
  { key: 'stone_floor', x: 457.7, y: 1.5, z: 2159.4, ry: 0, scale: 10 },
  { key: 'bridge_floor', x: 436, y: 2, z: 2178.1, ry: 270 * DEG, scale: 10 },
  { key: 'bridge_floor', x: 430, y: 2, z: 2178.1, ry: 270 * DEG, scale: 10 },
  { key: 'bridge_floor', x: 430, y: 2, z: 2168.85, ry: 270 * DEG, scale: 10 },
  { key: 'bridge_floor', x: 436, y: 2, z: 2168.85, ry: 270 * DEG, scale: 10 },
  { key: 'bridge_floor', x: 436, y: 2, z: 2159.6, ry: 270 * DEG, scale: 10 },
  { key: 'bridge_floor', x: 430, y: 2, z: 2159.6, ry: 270 * DEG, scale: 10 },
  { key: 'bridge_floor', x: 430, y: 2, z: 2150.35, ry: 270 * DEG, scale: 10 },
  { key: 'bridge_floor', x: 436, y: 2, z: 2150.35, ry: 270 * DEG, scale: 10 },
  { key: 'bridge_floor', x: 442, y: 2, z: 2150.35, ry: 270 * DEG, scale: 10 },
  { key: 'staircase', x: 441.95, y: -0.25, z: 2157.15, ry: 270 * DEG, scale: 6 },
  { key: 'fortress_wall', x: 426.45, y: 3, z: 2179.2, ry: 270 * DEG, scale: 8 },
  { key: 'fortress_wall', x: 426.45, y: 3, z: 2171.7, ry: 270 * DEG, scale: 8 },
  { key: 'fortress_wall', x: 426.45, y: 3, z: 2164.2, ry: 270 * DEG, scale: 8 },
  { key: 'fortress_wall', x: 426.45, y: 10, z: 2157.7, ry: 270 * DEG, scale: 6 },
  { key: 'tower_pillar', x: 426.3, y: 1.9, z: 2162.6, ry: 75 * DEG, scale: 9 },
  { key: 'tower_pillar', x: 426.3, y: 1.9, z: 2146.35, ry: 105 * DEG, scale: 9 },
  { key: 'fortress_wall', x: 426.45, y: 10, z: 2150.7, ry: 270 * DEG, scale: 6 },
  { key: 'gate_gear', x: 426.5, y: 10, z: 2153.8, ry: 270 * DEG, scale: 5 },
  { key: 'fortress_wall', x: 426.95, y: 10, z: 2154.45, ry: 90 * DEG, scale: 6 },
  { key: 'gate', x: 426.75, y: 6.75, z: 2149.8, ry: 270 * DEG, scale: 9 },
  { key: 'gate', x: 426.75, y: 6.75, z: 2154.3, ry: 270 * DEG, scale: 9 },
  { key: 'gate', x: 426.75, y: 6.75, z: 2158.8, ry: 270 * DEG, scale: 9 },
  { key: 'gate_gear', x: 427.5, y: 10, z: 2153.8, ry: 90 * DEG, scale: 5 },
  { key: 'gear_wall_rusty', x: 426.7, y: 11, z: 2157.6, ry: 90 * DEG, scale: 5 },
  { key: 'gear_wall_rusty', x: 426.7, y: 11, z: 2150.6, ry: 90 * DEG, scale: 5 },
  { key: 'fortress_wall', x: 431.9, y: 3, z: 2145.1, ry: 180 * DEG, scale: 8 },
  // ---------------------------------------------------------------------
  // The third placer pass (2026-08-30, later): the rampart walk over the
  // training yard with its two-flight climb, the barracks house by the
  // west boardwalk, the inner east row against the quay wall with its
  // fence-lined rim, the north strand stair down to the strait bridges,
  // and the first Wyrmwatch rebuild wave (tavern row, stables and yard,
  // church with its gravestone garden, signpost). Appended verbatim.
  // The fourth pass re-sat the east rim promenade decks flush with the
  // plaza (1.75 to 1.5) and lifted the west plaza stair seat a quarter.
  // ---------------------------------------------------------------------
  { key: 'fortress_wall', x: 439.15, y: 3, z: 2145.1, ry: 180 * DEG, scale: 8 },
  { key: 'tower_pillar', x: 443.3, y: 1.9, z: 2145.35, ry: 135 * DEG, scale: 9 },
  { key: 'fortress_wall', x: 445.4, y: 3, z: 2150.35, ry: 90 * DEG, scale: 8 },
  { key: 'tower_pillar', x: 459.65, y: 1.9, z: 2153.85, ry: 195 * DEG, scale: 9 },
  { key: 'fortress_wall', x: 449.15, y: 2, z: 2154.35, ry: 180 * DEG, scale: 8 },
  { key: 'fortress_wall', x: 456.65, y: 2, z: 2154.35, ry: 180 * DEG, scale: 8 },
  { key: 'fortress_wall', x: 461.65, y: 2, z: 2149.35, ry: 270 * DEG, scale: 8 },
  { key: 'fortress_wall', x: 461.65, y: 2, z: 2141.85, ry: 270 * DEG, scale: 8 },
  { key: 'tower_pillar', x: 462.9, y: 1.9, z: 2136.6, ry: 195 * DEG, scale: 9 },
  { key: 'fortress_wall', x: 468.65, y: 2, z: 2136.1, ry: 180 * DEG, scale: 8 },
  { key: 'fortress_wall', x: 476.15, y: 2, z: 2136.1, ry: 180 * DEG, scale: 8 },
  { key: 'fortress_wall', x: 483.65, y: 2, z: 2136.1, ry: 180 * DEG, scale: 8 },
  { key: 'tower_pillar', x: 487.4, y: 2, z: 2137.2, ry: 120 * DEG, scale: 8 },
  { key: 'tower_pillar', x: 489.4, y: 2, z: 2139.2, ry: 120 * DEG, scale: 7 },
  { key: 'tower_pillar', x: 490.4, y: 2, z: 2141.2, ry: 120 * DEG, scale: 6 },
  { key: 'fortress_wall', x: 430.35, y: 2, z: 2183.5, ry: 0, scale: 9 },
  { key: 'fortress_wall', x: 462.2, y: 7.05, z: 2151.35, ry: 270 * DEG, scale: 4 },
  { key: 'fortress_wall', x: 462.2, y: 7.05, z: 2147.6, ry: 270 * DEG, scale: 4 },
  { key: 'fortress_wall', x: 462.2, y: 7.05, z: 2143.85, ry: 270 * DEG, scale: 4 },
  { key: 'fortress_wall', x: 462.2, y: 7.05, z: 2140.1, ry: 270 * DEG, scale: 4 },
  { key: 'bridge_floor', x: 464, y: 7.05, z: 2151.5, ry: 90 * DEG, scale: 5 },
  { key: 'bridge_floor', x: 464, y: 7.05, z: 2146.75, ry: 90 * DEG, scale: 5 },
  { key: 'bridge_floor', x: 464, y: 7.05, z: 2142, ry: 90 * DEG, scale: 5 },
  { key: 'bridge_floor', x: 464, y: 7.05, z: 2156.25, ry: 90 * DEG, scale: 5 },
  { key: 'bridge_floor', x: 460.25, y: 7.05, z: 2157.25, ry: 180 * DEG, scale: 5 },
  { key: 'bridge_floor', x: 455.5, y: 7.05, z: 2157.25, ry: 180 * DEG, scale: 5 },
  { key: 'bridge_floor', x: 450.75, y: 7.05, z: 2157.25, ry: 180 * DEG, scale: 5 },
  { key: 'staircase', x: 455, y: 2.3, z: 2163.6, ry: 0, scale: 5 },
  { key: 'staircase', x: 450.25, y: 5.3, z: 2160.35, ry: 270 * DEG, scale: 4 },
  { key: 'bridge_floor', x: 450.75, y: 4.8, z: 2163.5, ry: 180 * DEG, scale: 5 },
  { key: 'fortress_wall', x: 447.9, y: 2, z: 2159.35, ry: 270 * DEG, scale: 8 },
  { key: 'fortress_wall', x: 450.4, y: 2, z: 2165.35, ry: 0, scale: 5 },
  { key: 'tower_pillar', x: 453, y: 2.3, z: 2159.75, ry: 270 * DEG, scale: 4 },
  { key: 'tower_pillar', x: 453, y: 6.3, z: 2159.75, ry: 270 * DEG, scale: 4 },
  { key: 'tower_pillar', x: 452.75, y: 2.3, z: 2161, ry: 270 * DEG, scale: 3 },
  { key: 'tower_pillar', x: 452.75, y: 5.3, z: 2161, ry: 270 * DEG, scale: 3 },
  { key: 'fortress_wall', x: 447.2, y: 7.05, z: 2155.35, ry: 180 * DEG, scale: 4 },
  { key: 'fortress_wall', x: 450.95, y: 7.05, z: 2155.35, ry: 180 * DEG, scale: 4 },
  { key: 'fortress_wall', x: 454.7, y: 7.05, z: 2155.35, ry: 180 * DEG, scale: 4 },
  { key: 'tower_pillar', x: 463.05, y: 2.3, z: 2138.8, ry: 255 * DEG, scale: 7 },
  { key: 'fence', x: 465.55, y: 7.55, z: 2142.55, ry: 270 * DEG, scale: 6 },
  { key: 'fence', x: 465.55, y: 7.55, z: 2148.55, ry: 270 * DEG, scale: 6 },
  { key: 'fence', x: 465.55, y: 7.55, z: 2154.55, ry: 270 * DEG, scale: 6 },
  { key: 'fence', x: 463.05, y: 7.55, z: 2158.8, ry: 180 * DEG, scale: 6 },
  { key: 'fence', x: 457.05, y: 7.55, z: 2158.8, ry: 180 * DEG, scale: 6 },
  { key: 'tower_pillar', x: 465, y: 7.8, z: 2139.8, ry: 150 * DEG, scale: 3 },
  { key: 'tower_pillar', x: 466, y: 7.8, z: 2158.05, ry: 225 * DEG, scale: 3 },
  { key: 'fortress_wall', x: 458.45, y: 7.05, z: 2155.35, ry: 180 * DEG, scale: 4 },
  { key: 'tower_pillar', x: 462, y: 7.8, z: 2155.05, ry: 225 * DEG, scale: 3 },
  { key: 'tower_pillar', x: 469.4, y: 1.95, z: 2173.15, ry: 105 * DEG, scale: 5 },
  { key: 'tower_pillar', x: 447.3, y: 1.95, z: 2164.05, ry: 105 * DEG, scale: 5 },
  { key: 'barracks', x: 433.25, y: 3.3, z: 2177.55, ry: 180 * DEG, scale: 12 },
  { key: 'tavern_sign', x: 440.1, y: 5.8, z: 2178.3, ry: 180 * DEG, scale: 4 },
  { key: 'fence', x: 439.35, y: 2.3, z: 2178.3, ry: 90 * DEG, scale: 8 },
  { key: 'fence', x: 439.35, y: 2.3, z: 2170.55, ry: 90 * DEG, scale: 8 },
  { key: 'fence', x: 439.35, y: 2.3, z: 2162.55, ry: 90 * DEG, scale: 8 },
  { key: 'staircase', x: 443.85, y: -2.45, z: 2185.9, ry: 270 * DEG, scale: 8 },
  { key: 'tower_pillar', x: 457.1, y: 2.3, z: 2181.4, ry: 0, scale: 8 },
  { key: 'tower_pillar', x: 455.1, y: 2.3, z: 2180.15, ry: 15 * DEG, scale: 6 },
  { key: 'tower_pillar', x: 459.1, y: 2.3, z: 2180.15, ry: 345 * DEG, scale: 6 },
  { key: 'tower_pillar', x: 457.1, y: 2.3, z: 2178.9, ry: 0, scale: 5 },
  { key: 'tower_middle', x: 457, y: 10.05, z: 2181.2, ry: 270 * DEG, scale: 6 },
  { key: 'fortress_wall', x: 450.85, y: 2.3, z: 2182.7, ry: 180 * DEG, scale: 8 },
  { key: 'fortress_wall', x: 458.35, y: 2.3, z: 2182.7, ry: 180 * DEG, scale: 8 },
  { key: 'fortress_wall', x: 473.6, y: 2.05, z: 2182.1, ry: 0, scale: 5 },
  { key: 'fortress_wall', x: 478.35, y: 2.05, z: 2182.1, ry: 0, scale: 5 },
  { key: 'fortress_wall', x: 483.1, y: 2.05, z: 2182.1, ry: 0, scale: 5 },
  { key: 'fortress_wall', x: 487.85, y: 2.05, z: 2182.1, ry: 0, scale: 5 },
  { key: 'tower_pillar', x: 490.55, y: 0, z: 2180.5, ry: 195 * DEG, scale: 8 },
  { key: 'tower_pillar', x: 493.55, y: 0, z: 2178.5, ry: 240 * DEG, scale: 7 },
  { key: 'tower_pillar', x: 492.8, y: 0, z: 2181.5, ry: 225 * DEG, scale: 6 },
  { key: 'bridge_floor', x: 464.7, y: 1.5, z: 2184.2, ry: 0, scale: 5 },
  { key: 'bridge_floor', x: 469.45, y: 1.5, z: 2184.2, ry: 0, scale: 5 },
  { key: 'bridge_floor', x: 474.2, y: 1.5, z: 2184.2, ry: 0, scale: 5 },
  { key: 'bridge_floor', x: 478.95, y: 1.5, z: 2184.2, ry: 0, scale: 5 },
  { key: 'bridge_floor', x: 483.7, y: 1.5, z: 2184.2, ry: 0, scale: 5 },
  { key: 'bridge_floor', x: 488.45, y: 1.5, z: 2184.2, ry: 0, scale: 5 },
  { key: 'bridge_floor', x: 493.2, y: 1.5, z: 2184.2, ry: 0, scale: 5 },
  { key: 'bridge_floor', x: 497.95, y: 1.5, z: 2184.2, ry: 180 * DEG, scale: 5 },
  { key: 'bridge_floor', x: 497.95, y: 1.5, z: 2181.2, ry: 180 * DEG, scale: 5 },
  { key: 'bridge_floor', x: 497.95, y: 1.5, z: 2178.2, ry: 180 * DEG, scale: 5 },
  { key: 'bridge_floor', x: 497.95, y: 1.5, z: 2175.2, ry: 180 * DEG, scale: 5 },
  { key: 'bridge_floor', x: 497.95, y: 1.5, z: 2172.2, ry: 180 * DEG, scale: 5 },
  { key: 'bridge_floor', x: 497.95, y: 1.5, z: 2169.2, ry: 180 * DEG, scale: 5 },
  { key: 'bridge_floor', x: 497.95, y: 1.5, z: 2166.2, ry: 180 * DEG, scale: 5 },
  { key: 'bridge_floor', x: 497.95, y: 1.5, z: 2163.2, ry: 180 * DEG, scale: 5 },
  { key: 'bridge_floor', x: 497.95, y: 1.5, z: 2160.2, ry: 180 * DEG, scale: 5 },
  { key: 'tower_pillar', x: 495.4, y: 0, z: 2158.4, ry: 90 * DEG, scale: 9 },
  { key: 'tower_pillar', x: 498.4, y: -5, z: 2155.9, ry: 90 * DEG, scale: 9 },
  { key: 'tower_pillar', x: 499.4, y: -0.75, z: 2159.15, ry: 90 * DEG, scale: 8 },
  { key: 'tower_pillar', x: 499.4, y: -8, z: 2159.15, ry: 90 * DEG, scale: 8 },
  { key: 'building_base', x: 493.5, y: 2.25, z: 2163.7, ry: 90 * DEG, scale: 7 },
  { key: 'building_base', x: 493.5, y: 2.25, z: 2179.7, ry: 90 * DEG, scale: 7 },
  { key: 'building_base', x: 493, y: 2.25, z: 2171.7, ry: 90 * DEG, scale: 8 },
  { key: 'tower_pillar', x: 494.6, y: 0, z: 2175.7, ry: 255 * DEG, scale: 6 },
  { key: 'tower_pillar', x: 494.6, y: 0, z: 2167.2, ry: 255 * DEG, scale: 6 },
  { key: 'bridge_pillar', x: 498.85, y: -6.25, z: 2172.2, ry: 180 * DEG, scale: 8 },
  { key: 'bridge_pillar', x: 498.85, y: -6.25, z: 2166.2, ry: 180 * DEG, scale: 8 },
  { key: 'bridge_pillar', x: 498.85, y: -6.25, z: 2178.2, ry: 180 * DEG, scale: 8 },
  { key: 'bridge_pillar', x: 498.85, y: -6.25, z: 2184.2, ry: 180 * DEG, scale: 8 },
  { key: 'fence', x: 500.15, y: 2.25, z: 2161.6, ry: 90 * DEG, scale: 4 },
  { key: 'fence', x: 500.15, y: 2.25, z: 2165.6, ry: 90 * DEG, scale: 4 },
  { key: 'fence', x: 500.15, y: 2.25, z: 2169.6, ry: 90 * DEG, scale: 4 },
  { key: 'fence', x: 500.15, y: 2.25, z: 2173.6, ry: 90 * DEG, scale: 4 },
  { key: 'fence', x: 500.15, y: 2.25, z: 2177.6, ry: 90 * DEG, scale: 4 },
  { key: 'fence', x: 500.15, y: 2.25, z: 2181.6, ry: 90 * DEG, scale: 4 },
  { key: 'dragon_statue', x: 500.1, y: 2, z: 2184.5, ry: 60 * DEG, scale: 5 },
  { key: 'fence', x: 498.15, y: 2.25, z: 2185.85, ry: 0, scale: 4 },
  { key: 'fence', x: 494.15, y: 2.25, z: 2185.85, ry: 0, scale: 4 },
  { key: 'fence', x: 490.15, y: 2.25, z: 2185.85, ry: 0, scale: 4 },
  { key: 'fence', x: 486.15, y: 2.25, z: 2185.85, ry: 0, scale: 4 },
  { key: 'fence', x: 482.15, y: 2.25, z: 2185.85, ry: 0, scale: 4 },
  { key: 'fence', x: 478.15, y: 2.25, z: 2185.85, ry: 0, scale: 4 },
  { key: 'fence', x: 474.15, y: 2.25, z: 2185.85, ry: 0, scale: 4 },
  { key: 'fence', x: 470.15, y: 2.25, z: 2185.85, ry: 0, scale: 4 },
  { key: 'fence', x: 466.15, y: 2.25, z: 2185.85, ry: 0, scale: 4 },
  { key: 'tower_pillar', x: 461.1, y: -0.75, z: 2183.35, ry: 345 * DEG, scale: 8 },
  { key: 'tower_pillar', x: 463.1, y: -3, z: 2184.85, ry: 0, scale: 7 },
  { key: 'building_1', x: 421.15, y: 3.5, z: 1898.3, ry: 270 * DEG, scale: 11 },
  { key: 'building_2', x: 412.9, y: 4.75, z: 1880.55, ry: 225 * DEG, scale: 11 },
  { key: 'building_base', x: 405.9, y: 2.75, z: 1919.3, ry: 195 * DEG, scale: 10 },
  { key: 'stables', x: 423.6, y: 3.15, z: 1917.6, ry: 225 * DEG, scale: 10 },
  { key: 'horse_head', x: 421.35, y: 7.15, z: 1915.35, ry: 225 * DEG, scale: 2 },
  { key: 'fence', x: 428.6, y: 2.9, z: 1911.35, ry: 240 * DEG, scale: 5 },
  { key: 'fence', x: 429.8, y: 2.9, z: 1906.4, ry: 270 * DEG, scale: 5 },
  { key: 'fence', x: 417.3, y: 2.9, z: 1921.65, ry: 195 * DEG, scale: 5 },
  { key: 'building_2', x: 407.85, y: 3.15, z: 1919.35, ry: 105 * DEG, scale: 10 },
  { key: 'tavern_sign', x: 410.6, y: 4.15, z: 1915.35, ry: 195 * DEG, scale: 3 },
  { key: 'building_base_roof', x: 377.15, y: 5.2, z: 1875.6, ry: 60 * DEG, scale: 12 },
  { key: 'church', x: 391.15, y: 5.45, z: 1868.6, ry: 285 * DEG, scale: 12 },
  { key: 'building_base', x: 390.9, y: 4.7, z: 1867.6, ry: 195 * DEG, scale: 8 },
  { key: 'dragon_statue', x: 391.65, y: 11.7, z: 1870.1, ry: 15 * DEG, scale: 6 },
  { key: 'gravestone_2', x: 370.6, y: 3.55, z: 1886.1, ry: 75 * DEG, scale: 3 },
  { key: 'gravestone_2', x: 376.6, y: 3.55, z: 1886.1, ry: 60 * DEG, scale: 3 },
  { key: 'gravestone_3', x: 373.6, y: 3, z: 1888.75, ry: 105 * DEG, scale: 4 },
  { key: 'signpost', x: 405.9, y: 3.2, z: 1903.6, ry: 90 * DEG, scale: 8 },
  { key: 'building_2', x: 386, y: 3.2, z: 1902.4, ry: 15 * DEG, scale: 11 },
  { key: 'gravestone_2', x: 390.6, y: 4.6, z: 1882.2, ry: 45 * DEG, scale: 3 },
  { key: 'gravestone_2', x: 392.6, y: 4.6, z: 1878.7, ry: 15 * DEG, scale: 3 },
  { key: 'gravestone_3', x: 394.6, y: 4.85, z: 1880.7, ry: 0, scale: 3 },
  // ---------------------------------------------------------------------
  // The fourth placer pass (2026-08-31): the east-court pavers behind the
  // keep, a cannon emplacement on the east rim pillar, and the two strand
  // gate pillars by the northwest stair mouth.
  // ---------------------------------------------------------------------
  { key: 'stone_floor', x: 475.35, y: 1.55, z: 2178.6, ry: 0, scale: 8 },
  { key: 'stone_floor', x: 482.35, y: 1.55, z: 2178.6, ry: 0, scale: 8 },
  { key: 'stone_floor', x: 490.35, y: 1.55, z: 2178.6, ry: 0, scale: 8 },
  { key: 'stone_floor', x: 491.35, y: 1.55, z: 2171.6, ry: 0, scale: 8 },
  { key: 'stone_floor', x: 491.35, y: 1.55, z: 2161.6, ry: 0, scale: 8 },
  { key: 'tower_pillar', x: 492.7, y: 2.5, z: 2180.6, ry: 90 * DEG, scale: 7 },
  { key: 'cannon', x: 492.7, y: 9.25, z: 2180.6, ry: 45 * DEG, scale: 3 },
  { key: 'tower_pillar', x: 437.6, y: 0.3, z: 2183.9, ry: 180 * DEG, scale: 8 },
  { key: 'tower_pillar', x: 434.6, y: 0.3, z: 2183.9, ry: 180 * DEG, scale: 9 },
  // ---------------------------------------------------------------------
  // The fifth placer pass (2026-09-01): the west approach plaza outside the
  // triple gate with its dune stair and stables, three dragon-head drinking
  // fountains (yard gate, south wall, strand mouth), the gate pillar
  // finials, and a guardhouse on the volcano fortress east terrace. One
  // exact-duplicate approach paver from the export is baked once. The two
  // gate drum pillars re-aim (rot 75 and 105) and the outer yard stair
  // re-seats a quarter up.
  // ---------------------------------------------------------------------
  { key: 'stone_floor', x: 423.45, y: 1.9, z: 2151.25, ry: 0, scale: 8 },
  { key: 'stone_floor', x: 423.45, y: 1.9, z: 2158.75, ry: 0, scale: 8 },
  { key: 'staircase', x: 423.4, y: -2.1, z: 2154.9, ry: 180 * DEG, scale: 9 },
  { key: 'stone_floor', x: 423.45, y: 1.9, z: 2166.25, ry: 0, scale: 8 },
  { key: 'stone_floor', x: 423.45, y: 1.9, z: 2173.75, ry: 0, scale: 8 },
  { key: 'stone_floor', x: 423.45, y: 1.9, z: 2181.25, ry: 0, scale: 8 },
  { key: 'stables', x: 423.3, y: 1.8, z: 2176.35, ry: 270 * DEG, scale: 8 },
  { key: 'horse_head', x: 420.5, y: 4.95, z: 2176.3, ry: 270 * DEG, scale: 2 },
  { key: 'dragon_head', x: 435.35, y: 4, z: 2142.9, ry: 90 * DEG, scale: 6 },
  { key: 'fountain_base', x: 435.35, y: 2, z: 2142.4, ry: 180 * DEG, scale: 9 },
  { key: 'dragon_head', x: 476.15, y: 3.75, z: 2134.2, ry: 90 * DEG, scale: 6 },
  { key: 'fountain_base', x: 476.15, y: 2, z: 2133.7, ry: 180 * DEG, scale: 9 },
  { key: 'tower_pillar', x: 426.3, y: 10.4, z: 2146.35, ry: 105 * DEG, scale: 6 },
  { key: 'tower_pillar', x: 426.3, y: 10.4, z: 2162.35, ry: 75 * DEG, scale: 6 },
  { key: 'dragon_head', x: 454.55, y: 3.75, z: 2185.3, ry: 270 * DEG, scale: 6 },
  { key: 'fountain_base', x: 454.8, y: 2, z: 2185.8, ry: 0, scale: 9 },
  { key: 'building_base', x: 517.55, y: 6.1, z: 2214.25, ry: 90 * DEG, scale: 9 },
  { key: 'tower_pillar', x: 516.15, y: 2.6, z: 2209.2, ry: 225 * DEG, scale: 5 },
  { key: 'tower_pillar', x: 522.15, y: 2.1, z: 2217.2, ry: 225 * DEG, scale: 5 },
  // ---------------------------------------------------------------------
  // The sixth placer pass (2026-09-03): the summit walk pillars by the
  // volcano tower, the training yard chapel raised on its hall, two
  // churchyard graves on the south lawn, and the Wyrmwatch well.
  // ---------------------------------------------------------------------
  { key: 'tower_pillar', x: 506.5, y: 13.55, z: 2242.4, ry: 270 * DEG, scale: 4 },
  { key: 'tower_pillar', x: 506.5, y: 13.05, z: 2240.4, ry: 270 * DEG, scale: 4 },
  { key: 'tower_pillar', x: 498.5, y: 7.3, z: 2241.9, ry: 90 * DEG, scale: 9 },
  { key: 'building_1', x: 451.9, y: 2, z: 2146, ry: 180 * DEG, scale: 12 },
  { key: 'church', x: 451.65, y: 6.75, z: 2146, ry: 90 * DEG, scale: 12 },
  { key: 'gravestone_3', x: 457.4, y: 1.75, z: 2136.5, ry: 240 * DEG, scale: 5 },
  { key: 'gravestone_2', x: 443.9, y: 1.5, z: 2140.25, ry: 150 * DEG, scale: 4 },
  { key: 'well_pump', x: 403.7, y: 4.3, z: 1898.9, ry: 45 * DEG, scale: 4 },
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

/** Every standable deck plate's FULL (uncropped) footprint rect and top,
 *  derived once from the table: the support query below reads these. */
const FORTRESS_PLATE_RECTS: readonly {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  top: number;
}[] = FORGEFATHER_FORTRESS_PLACEMENTS.filter((p) => FORTRESS_STANDABLE_KEYS.has(p.key)).map((p) => {
  const native = IGNIVAR_PROP_NATIVE[p.key];
  const cos = Math.abs(Math.cos(p.ry));
  const halfX = ((cos * native.len + (1 - cos) * native.dep) * p.scale) / 2;
  const halfZ = (((1 - cos) * native.len + cos * native.dep) * p.scale) / 2;
  return {
    x0: p.x - halfX,
    x1: p.x + halfX,
    z0: p.z - halfZ,
    z1: p.z + halfZ,
    top: p.y + native.hei * p.scale,
  };
});

/** The highest deck-plate top under a placement's collider footprint, or
 *  -Infinity when no plate intersects it. This is the piece's floor when it
 *  stands on a deck instead of the dirt (the fence-on-a-bridge rule); the
 *  footprint is the ROTATED collider's axis-aligned bounds so a rail whose
 *  center hangs just past a plate edge still finds the plate it rests on. */
export function fortressDeckTopUnder(placement: IgnivarPropPlacement): number {
  const native = IGNIVAR_PROP_NATIVE[placement.key];
  const footprint = IGNIVAR_PROP_COLLIDER_FOOTPRINT[placement.key] ?? 1;
  const hw = (native.len * placement.scale * footprint) / 2;
  const hd = (native.dep * placement.scale * footprint) / 2;
  const c = Math.abs(Math.cos(placement.ry));
  const s = Math.abs(Math.sin(placement.ry));
  const halfX = hw * c + hd * s;
  const halfZ = hw * s + hd * c;
  let best = -Infinity;
  for (const rect of FORTRESS_PLATE_RECTS) {
    if (
      placement.x + halfX <= rect.x0 ||
      placement.x - halfX >= rect.x1 ||
      placement.z + halfZ <= rect.z0 ||
      placement.z - halfZ >= rect.z1
    )
      continue;
    // only a plate at or below the piece's seat can be its floor
    if (rect.top <= placement.y + 0.75 && rect.top > best) best = rect.top;
  }
  return best;
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
      // The plate blocks only from its slab down-face up: `passUnderY` lets a
      // mover with height walk BENEATH an elevated deck (the balcony walk over
      // the training yard), while a ground-level paver's underside sits at the
      // dirt and the clause stays inert. Mobs (height-less) still see a
      // full-height solid, keeping pathfinding out of the undercrofts.
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
          passUnderY: placement.y,
        });
      continue;
    }
    if (IGNIVAR_NON_COLLIDING_PROPS.has(placement.key)) continue;
    // A solid's floor is the higher of the terrain and any deck plate under
    // its footprint: a fence or parapet STANDING ON an elevated deck (the
    // balcony rails, the court fences) is grounded furniture there, not an
    // aerial stack member, so it blocks the walk along its deck. A piece
    // seated on a deck ABOVE the terrain lane carries its base as passUnderY,
    // so the walkers passing beneath the deck pass beneath its furniture too.
    // Pieces grounded on the terrain itself classify exactly as before.
    const terrain = terrainHeight(placement.x, placement.z, seed);
    const ground = Math.max(terrain, fortressDeckTopUnder(placement));
    if (placement.y > ground + GROUND_STAND_TOLERANCE) continue;
    // Fully interred pieces (the summit foundation shaft) never collide: a
    // full-height OBB has no top, so a buried mass would otherwise blanket
    // the walkable ground above it.
    if (placement.y + native.hei * placement.scale < ground + 0.5) continue;
    const deckSeated = placement.y > terrain + GROUND_STAND_TOLERANCE;
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
        ...(deckSeated ? { passUnderY: placement.y } : {}),
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
      ...(deckSeated ? { passUnderY: placement.y } : {}),
    });
  }
  return colliders;
}
