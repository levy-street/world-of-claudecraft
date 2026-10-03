// The fog scene state's own predicates (src/render/interior_light_rig.ts):
// what a state means for the sky dome, beside the type that names every state.

import { describe, expect, it } from 'vitest';
import { type FogSceneState, isOpenAirFogState } from '../src/render/interior_light_rig';

describe('isOpenAirFogState', () => {
  it('shows the sky dome over the overworld and the Thornhollow hollow only', () => {
    // The open-air dungeon fields (the Wildheart Basin among them) carry their
    // own sky dome inside the interior, so the world dome hides there.
    const openAir: FogSceneState[] = ['outdoor', 'hoardValley', 'battleground'];
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
      'wildheartBasin',
      'hollowCrypt',
      'drownedTemple',
      'gravewyrmSanctum',
    ];
    for (const state of openAir) expect(isOpenAirFogState(state), state).toBe(true);
    for (const state of covered) expect(isOpenAirFogState(state), state).toBe(false);
  });
});
