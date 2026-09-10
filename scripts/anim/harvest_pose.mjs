import { createPlantedStance } from './planted_stance.mjs';

export function createHarvestStance(root, idle) {
  const marks = [
    [0, 0, 0],
    [0.075, 0.055, -9],
    [0.15, 0.025, 8],
    [0.245, 0.05, 10],
    [0.32, 0.022, -9],
    [0.42, 0.075, -4],
    [0.49, 0.035, 0],
    [0.53, 0.035, 0],
    [0.6, 0.006, 2],
    [0.72, 0, 0],
  ];
  return createPlantedStance(root, idle, marks);
}
