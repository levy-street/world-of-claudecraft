import { describe, expect, it } from 'vitest';
import { getActiveWorldContent, QUESTS, ZONES, zoneAt } from '../src/sim/data';
import {
  AVAILABLE_QUEST_DISTANCE_BUCKET,
  AVAILABLE_QUEST_LIMIT,
  availableQuestOffers,
  bucketAvailableQuestDistance,
} from '../src/ui/hud/quest/available_quests_view';

// Menu consolidation step 8: the World Map rail's "Available Nearby" list moved
// to the Quest Log's Available group. The rule is unchanged; the offer now also
// carries its giver's position for the group's Show on Map.

/** A zone with at least `n` quest givers inside its bounds. */
function zoneWithGivers(n: number) {
  const npcs = Object.values(getActiveWorldContent().npcs).filter((npc) => npc.questIds.length > 0);
  for (const zone of ZONES) {
    const inside = npcs.filter(
      (npc) =>
        npc.pos.x >= (zone.xMin ?? Number.NEGATIVE_INFINITY) &&
        npc.pos.x < (zone.xMax ?? Number.POSITIVE_INFINITY) &&
        npc.pos.z >= zone.zMin &&
        npc.pos.z < zone.zMax,
    );
    if (inside.length >= n) return { zone, givers: inside };
  }
  throw new Error('no zone with enough quest givers');
}

const world = (x: number, z: number, available: (questId: string) => boolean) => ({
  player: { pos: { x, y: 0, z } },
  questState: (questId: string) => (available(questId) ? 'available' : 'locked'),
});

describe('availableQuestOffers', () => {
  it('lists only quests that read available, nearest giver first, capped at the limit', () => {
    const { zone, givers } = zoneWithGivers(2);
    const origin = givers[0].pos;
    const offers = availableQuestOffers(world(origin.x, origin.z, () => true) as never, zone);
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.length).toBeLessThanOrEqual(AVAILABLE_QUEST_LIMIT);
    for (let i = 1; i < offers.length; i++) {
      expect(offers[i].distance).toBeGreaterThanOrEqual(offers[i - 1].distance);
    }
    for (const offer of offers) {
      expect(QUESTS[offer.questId]).toBeDefined();
      expect(offer.zoneId).toBe(zone.id);
      expect(zoneAt(offer.x, offer.z).id).toBe(zone.id);
    }
  });

  it('carries the giver position and the quest minimum level', () => {
    const { zone, givers } = zoneWithGivers(1);
    const giver = givers[0];
    const questId = giver.questIds[0];
    const offers = availableQuestOffers(
      world(giver.pos.x, giver.pos.z, (id) => id === questId) as never,
      zone,
    );
    expect(offers).toEqual([
      {
        questId,
        zoneId: zone.id,
        distance: 0,
        minLevel: QUESTS[questId].minLevel ?? null,
        x: giver.pos.x,
        z: giver.pos.z,
      },
    ]);
  });

  it('lists nothing when no quest in the zone reads available', () => {
    const { zone, givers } = zoneWithGivers(1);
    expect(
      availableQuestOffers(world(givers[0].pos.x, givers[0].pos.z, () => false) as never, zone),
    ).toEqual([]);
  });

  it('respects an explicit limit', () => {
    const { zone, givers } = zoneWithGivers(2);
    const offers = availableQuestOffers(
      world(givers[0].pos.x, givers[0].pos.z, () => true) as never,
      zone,
      1,
    );
    expect(offers).toHaveLength(1);
  });
});

describe('bucketAvailableQuestDistance', () => {
  it('rounds to the bucket so a walking player does not move the rendered yards', () => {
    expect(AVAILABLE_QUEST_DISTANCE_BUCKET).toBe(10);
    expect(bucketAvailableQuestDistance(0)).toBe(0);
    expect(bucketAvailableQuestDistance(14.9)).toBe(10);
    expect(bucketAvailableQuestDistance(15)).toBe(20);
    expect(bucketAvailableQuestDistance(41)).toBe(40);
  });
});
