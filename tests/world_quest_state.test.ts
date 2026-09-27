import { describe, expect, it } from 'vitest';
import {
  recordPersonalGliderTime,
  sanitizeGliderRecords,
} from '../src/sim/glider_personal_records';
import { gliderScoreboardId } from '../src/sim/glider_scoreboards';
import { Sim } from '../src/sim/sim';
import { takeWorldQuestDeliveryCargo } from '../src/sim/world_quest_delivery';
import { freshWorldQuestRotationCache, rotationBindings } from '../src/sim/world_quest_state';

describe('world quest coordinator adapters', () => {
  it('bounds personal records and preserves daily and lifetime best times independently', () => {
    const course = 'galecrest_windrider_slalom';
    const daily = gliderScoreboardId(course, 'daily')!;
    const lifetime = gliderScoreboardId(course, 'lifetime')!;
    const records = sanitizeGliderRecords({
      unknown: { metric: 1, medal: 'gold', day: '2026-09-23' },
    });
    expect(records).toEqual({});
    expect(
      sanitizeGliderRecords({
        glider_downs_v1_lifetime: { metric: 40, medal: 'gold', day: '2026-09-23' },
      }),
    ).toEqual({});
    recordPersonalGliderTime(records, course, '2026-09-23', 60, 'silver');
    recordPersonalGliderTime(records, course, '2026-09-24', 70, 'bronze');
    recordPersonalGliderTime(records, course, '2026-09-23', 50, 'gold');
    expect(records[daily]).toEqual({ metric: 70, medal: 'bronze', day: '2026-09-24' });
    expect(records[lifetime].metric).toBe(50);
    recordPersonalGliderTime(records, course, '2026-09-24', NaN, 'gold');
    expect(Object.keys(records)).toHaveLength(2);
    const clean = sanitizeGliderRecords({
      ...records,
      [daily]: { ...records[daily], extra: 'discard' },
    });
    expect(clean).toEqual(records);
    expect(clean[daily]).not.toBe(records[daily]);
    expect(sanitizeGliderRecords({ [daily]: { metric: -1, medal: 'gold', day: 'bad' } })).toEqual(
      {},
    );
  });

  it('keeps the reset-day view live while reusing the same-day rotation', () => {
    const cache = freshWorldQuestRotationCache();
    const host = { resetDay: '2026-09-06' };
    const bound = rotationBindings(cache, host);
    const initial = bound.currentWorldQuestRotation();
    expect(bound.currentWorldQuestRotation()).toBe(initial);
    host.resetDay = '2026-09-07';
    expect(bound.currentWorldQuestRotation()).not.toBe(initial);
    expect(bound.currentWorldQuestRotation().cycle).not.toBe(initial.cycle);
  });

  it('drops only the requested player cargo and ignores missing players', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    const other = sim.addPlayer('mage', 'Other');
    takeWorldQuestDeliveryCargo(sim.ctx, sim.player);
    expect(sim.dropWorldQuestDeliveryCargo(987654)).toBe(false);
    expect(sim.dropWorldQuestDeliveryCargo(other)).toBe(false);
    expect(sim.dropWorldQuestDeliveryCargo()).toBe(true);
    expect(sim.dropWorldQuestDeliveryCargo()).toBe(false);
  });
});
