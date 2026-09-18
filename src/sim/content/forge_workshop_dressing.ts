import { hexBuildingBox } from '../hex_building_dims';
import type { ZonePropsDef } from '../types';

/** Wyrmwatch blacksmith building and workshop dressing. */
export const FORGE_WORKSHOP_DRESSING: NonNullable<ZonePropsDef['decorProps']> = [
  {
    key: 'hexrBlacksmith',
    // Shifted (+9, -11) off the release's Wyrmwatch building_1, which stands
    // on the old smithy footprint.
    x: 435,
    z: 1891,
    rot: -Math.PI / 2,
    scale: 7,
    r: 5,
    h: 7,
    ...(hexBuildingBox('hexrBlacksmith', 7) ?? {}),
  },
  { key: 'hexSack', x: 430.5, z: 1885.5, rot: 0.4, scale: 5, terrainCalm: false },
  { key: 'hexSack', x: 431.2, z: 1886.0, rot: -0.3, scale: 4.5, terrainCalm: false },
];
