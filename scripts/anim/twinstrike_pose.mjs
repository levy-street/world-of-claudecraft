import { createPlantedStance } from './planted_stance.mjs';

/** Two opposing compressions with a lighter recovery than the rage finisher. */
export function createTwinstrikeStance(root, idle) {
  return createPlantedStance(root, idle, [
    [0, 0, 0],
    [0.085, 0.045, -10],
    [0.15, 0.024, 8],
    [0.172, 0.024, 8],
    [0.26, 0.046, 9],
    [0.34, 0.027, -10],
    [0.36, 0.027, -10],
    [0.51, 0.014, -4],
    [0.66, 0, 0],
  ]);
}
