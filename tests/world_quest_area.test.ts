// The shared world quest area rule (src/sim/world_quest_area.ts): a ring for
// every objective, plus the whole zone for a kill quest, and never the instance
// plane, whose positions zoneAt folds back onto overworld bands.
import { describe, expect, it } from 'vitest';
import {
  DUNGEONS,
  INSTANCE_SLOT_COUNT,
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
    expect(zoneAt(10, 25.01).id).toBe(zoneId);
    expect(positionInWorldQuestArea({ x: 10, z: 25.01 }, quest)).toBe(false);
  });

  it('keeps an investigation (which also takes kill credit) to its ring', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_mirefen_infiltrator;
    expect(quest.objective.type).toBe('investigation');
    const { x, z, radius } = quest.area;
    const beyond = [0, 90, 180, 270]
      .map((a) => ({
        x: x + Math.cos((a * Math.PI) / 180) * (radius + 10),
        z: z + Math.sin((a * Math.PI) / 180) * (radius + 10),
      }))
      .find((p) => zoneAt(p.x, p.z).id === quest.zoneId);
    if (!beyond) throw new Error('fixture: no in-zone point beyond the investigation ring');
    expect(positionInWorldQuestArea(beyond, quest)).toBe(false);
  });

  it('extends a kill quest to its whole zone, and stops at the zone edge', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_evergarden_watch;
    const far = { x: 200, z: 720 };
    expect(zoneAt(far.x, far.z).id).toBe(quest.zoneId);
    expect(Math.hypot(far.x - quest.area.x, far.z - quest.area.z)).toBeGreaterThan(
      quest.area.radius,
    );
    expect(positionInWorldQuestArea(far, quest)).toBe(true);
    // Off the map east of it, and in Wraithwood (the real zone to its north,
    // sharing its x band).
    for (const outside of [
      { x: 600, z: 995 },
      { x: 360, z: 1300 },
    ]) {
      expect(zoneAt(outside.x, outside.z).id).not.toBe(quest.zoneId);
      expect(positionInWorldQuestArea(outside, quest)).toBe(false);
    }
    expect(zoneAt(360, 1300).id).toBe('wraithwood');
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
    // Positive control: zoneAt alone does fold instance origins onto zones that
    // hold a hunt, so the bounds guard is what keeps them out.
    const huntZones = new Set(kills.map((quest) => quest.zoneId));
    const origin0 = instanceOrigin(0, 0);
    expect(huntZones.has(zoneAt(origin0.x, origin0.z).id)).toBe(true);
    for (let index = 0; index < Object.keys(DUNGEONS).length; index++) {
      for (let slot = 0; slot < INSTANCE_SLOT_COUNT; slot++) {
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
