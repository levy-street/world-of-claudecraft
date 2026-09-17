import { createPlantedStance } from './planted_stance.mjs';

export function createHarvestStance(root, idle) {
  const marks = [
    [0, 0, 0],
    [0.09, 0.065, -12],
    [0.15, 0.025, 8],
    [0.265, 0.06, 13],
    [0.32, 0.022, -9],
    [0.44, 0.095, -6],
    [0.49, 0.035, 0],
    [0.53, 0.035, 0],
    [0.585, 0.004, 3],
    [0.72, 0, 0],
  ];
  return createPlantedStance(root, idle, marks);
}
