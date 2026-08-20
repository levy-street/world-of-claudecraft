// The fog scene state's own predicates (src/render/interior_light_rig.ts):
// what a state means for the sky dome, beside the type that names every state.

import { describe, expect, it } from 'vitest';
import { type FogSceneState, isOpenAirFogState } from '../src/render/interior_light_rig';

describe('isOpenAirFogState', () => {
  it('shows the sky dome over the overworld, the Wildheart field and the Thornhollow hollow only', () => {
    const openAir: FogSceneState[] = ['outdoor', 'wildheartField', 'battleground'];
    const covered: FogSceneState[] = [
      'dungeon',
      'temple',
      'nythraxis',
      'delve',
      'yumiMaze',
      'underwater',
      'rift',
      'practice',
      'lastkeep',
      'dawnhold',
    ];
    for (const state of openAir) expect(isOpenAirFogState(state), state).toBe(true);
    for (const state of covered) expect(isOpenAirFogState(state), state).toBe(false);
  });
});
