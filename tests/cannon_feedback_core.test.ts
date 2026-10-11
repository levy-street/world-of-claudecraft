import { expect, it } from 'vitest';
import { createCannonEncounter } from '../src/sim/minigames/cannon_encounter';
import type { VehicleSession } from '../src/sim/types';
import { CannonFeedbackCursor } from '../src/ui/hud/vehicle/cannon_feedback_core';

it('consumes new cues once, skips reconnect history and resets on exit or new attempt', () => {
  const cursor = new CannonFeedbackCursor();
  const s: VehicleSession = {
    kind: 'cannon',
    stationId: 'north_watch_cannon',
    cycle: 'wq3_8',
    origin: { x: 0, y: 0, z: 0 },
    encounter: createCannonEncounter(),
  };
  s.encounter.tick = 100;
  s.encounter.feedback = [{ id: 1, tick: 100, kind: 'shot', x: 0, z: 0 }];
  expect(cursor.consume(s)).toEqual([]);
  s.encounter.feedback.push({ id: 2, tick: 101, kind: 'barrel', x: 0, z: 0 });
  s.encounter.tick++;
  expect(cursor.consume(s).map((e) => e.kind)).toEqual(['barrel']);
  expect(cursor.consume(s)).toEqual([]);
  cursor.consume(null);
  expect(cursor.consume(s)).toEqual([]);
  s.encounter.tick = 0;
  expect(cursor.consume(s)).toEqual([]);
});
