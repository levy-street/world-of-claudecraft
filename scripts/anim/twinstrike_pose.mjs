import { createPlantedStance } from './planted_stance.mjs';

/** Two opposing compressions with a lighter recovery than the rage finisher. */
export function createTwinstrikeStance(root, idle) {
  return createPlantedStance(root, idle, [
    [0, 0, 0],
    [0.085, 0.055, -13],
    [0.15, 0.024, 8],
    [0.172, 0.024, 8],
    [0.26, 0.062, 14],
    [0.34, 0.027, -10],
    [0.36, 0.027, -10],
    [0.44, 0.048, -16],
    [0.54, 0.018, -5],
    [0.66, 0, 0],
  ]);
}
