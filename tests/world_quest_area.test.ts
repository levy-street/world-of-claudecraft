// The shared world quest area rule (src/sim/world_quest_area.ts): a ring for
// every objective, plus the whole zone for a kill quest, and never the instance
// plane, whose positions zoneAt folds back onto overworld bands.
import { describe, expect, it } from 'vitest';
import {
  DUNGEONS,
  instanceOrigin,
  WORLD_QUESTS,
  WORLD_QUESTS_BY_ID,
  zoneAt,
} from '../src/sim/data';
import { positionInWorldQuestArea } from '../src/sim/world_quest_area';

const ring = { x: 10, z: 20, radius: 5 };

describe('world quest area', () => {
  it('keeps a ring quest to its ring, even inside its zone', () => {
    const zoneId = zoneAt(10, 20).id;
    const quest = {
      zoneId,
      area: ring,
      objective: { type: 'interact', targetObjectItemId: 'x' } as const,
    };
    expect(positionInWorldQuestArea({ x: 10, z: 25 }, quest)).toBe(true);
    expect(positionInWorldQuestArea({ x: 10, z: 25.01 }, quest)).toBe(false);
  });

  it('extends a kill quest to its whole zone, and stops at the zone edge', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_evergarden_watch;
    const far = { x: 200, z: 720 };
    expect(zoneAt(far.x, far.z).id).toBe(quest.zoneId);
    expect(Math.hypot(far.x - quest.area.x, far.z - quest.area.z)).toBeGreaterThan(
      quest.area.radius,
    );
    expect(positionInWorldQuestArea(far, quest)).toBe(true);
    const outside = { x: 600, z: 995 };
    expect(zoneAt(outside.x, outside.z).id).not.toBe(quest.zoneId);
    expect(positionInWorldQuestArea(outside, quest)).toBe(false);
  });

  it('keeps the part of a kill ring that crosses its zone border', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_mirefen_prowlers;
    const { x, z, radius } = quest.area;
    let crossing: { x: number; z: number } | null = null;
    for (let a = 0; a < 360 && !crossing; a += 5) {
      const p = {
        x: x + Math.cos((a * Math.PI) / 180) * (radius - 1),
        z: z + Math.sin((a * Math.PI) / 180) * (radius - 1),
      };
      if (zoneAt(p.x, p.z).id !== quest.zoneId) crossing = p;
    }
    if (!crossing) throw new Error('fixture: the prowler ring no longer crosses its zone');
    expect(positionInWorldQuestArea(crossing, quest)).toBe(true);
  });

  it('never places an instance position in any kill quest area', () => {
    const kills = WORLD_QUESTS.filter((quest) => quest.objective.type === 'kill');
    for (let index = 0; index < Object.keys(DUNGEONS).length; index++) {
      for (let slot = 0; slot < 24; slot++) {
        const origin = instanceOrigin(index, slot);
        for (const quest of kills) {
          expect(positionInWorldQuestArea(origin, quest), `${quest.id} at ${index}:${slot}`).toBe(
            false,
          );
        }
      }
    }
  });
});
