import { expect, it } from 'vitest';
import { GLIDER_QUEST_ID, GLIDER_WIND_TUNNELS } from '../src/sim/content/world_quest_glider';
import { createGliderFlightState } from '../src/sim/minigames/glider_flight';
import type { WorldQuestProgress } from '../src/sim/types';
import { worldQuestProgressForWire } from '../src/sim/world_quest_trace_wire';

it('isolates a captured glider snapshot from later ring and wind consumption', () => {
  const glider = createGliderFlightState(false);
  glider.passedRings.push(1);
  glider.windBoosts = [GLIDER_WIND_TUNNELS[0].id];
  const progress: WorldQuestProgress = {
    questId: GLIDER_QUEST_ID,
    state: 'active',
    count: 0,
    glider,
  };
  const snapshot = worldQuestProgressForWire(progress);
  expect(snapshot.glider).toEqual(glider);
  glider.passedRings.push(2);
  glider.windBoosts.push(GLIDER_WIND_TUNNELS[1].id);
  expect(snapshot.glider?.passedRings).toEqual([1]);
  expect(snapshot.glider?.windBoosts).toEqual([GLIDER_WIND_TUNNELS[0].id]);
});
