// The pure body pick behind the Professions window's "Harvest a body" entry:
// which corpse the explicit examine opens the choice popup for. Never sends
// anything; it only names a body. Driven over an IWorld-shaped stub.

import { describe, expect, it } from 'vitest';
import { HARVEST_BODY_RANGE, pickHarvestBody } from '../src/game/harvest_body_pick';
import { LOOT_FFA_DELAY } from '../src/sim/loot/loot_ffa';
import { type Entity, INTERACT_RANGE } from '../src/sim/types';

const ME = 1;
const STRANGER = 9;

function corpse(id: number, x: number, overrides: Partial<Entity> = {}): Entity {
  return {
    id,
    kind: 'mob',
    // forest_wolf carries mapped componentTags: harvestable while unclaimed.
    templateId: 'forest_wolf',
    pos: { x, y: 0, z: 0 },
    ownerId: null,
    dead: true,
    lootable: true,
    corpseTimer: 60,
    loot: null,
    tappedById: null,
    lootFfaTimer: Number.POSITIVE_INFINITY,
    harvestClaimedBy: null,
    ...overrides,
  } as Entity;
}

function world(bodies: Entity[], over: { dead?: boolean; targetId?: number | null } = {}) {
  const player = {
    id: ME,
    kind: 'player',
    pos: { x: 0, y: 0, z: 0 },
    dead: over.dead ?? false,
    targetId: over.targetId ?? null,
  } as Entity;
  return {
    player,
    playerId: ME,
    partyInfo: null,
    entities: new Map<number, Entity>([
      [player.id, player],
      ...bodies.map((b): [number, Entity] => [b.id, b]),
    ]),
  };
}

describe('pickHarvestBody', () => {
  it('names the nearest body with an open harvest, ties broken by the lower id', () => {
    expect(pickHarvestBody(world([corpse(5, 4), corpse(2, 2)]))).toBe(2);
    expect(pickHarvestBody(world([corpse(7, 3), corpse(4, 3)]))).toBe(4);
    expect(pickHarvestBody(world([corpse(4, 3), corpse(7, 3)]))).toBe(4);
  });

  it('prefers the targeted body when it is eligible and within reach', () => {
    const w = world([corpse(2, 1), corpse(5, INTERACT_RANGE)], { targetId: 5 });
    expect(pickHarvestBody(w)).toBe(5);
  });

  it('falls back to the nearest body when the target is out of reach or already claimed', () => {
    const far = world([corpse(2, 1), corpse(5, INTERACT_RANGE + 0.5)], { targetId: 5 });
    expect(pickHarvestBody(far)).toBe(2);
    const claimed = world([corpse(2, 1), corpse(5, 3, { harvestClaimedBy: STRANGER })], {
      targetId: 5,
    });
    expect(pickHarvestBody(claimed)).toBe(2);
  });

  // The reach is the SIM'S harvest gate, never the popup's wider close range.
  // Picking at the popup range named bodies in the band between the two, opened
  // the choice on them, and left Harvest toasting "Too far away." on every
  // press: this entry is the only keyboard/pad/touch route to a harvest, so a
  // body it names has to be one harvestCorpse would accept.
  it('reaches exactly the sim harvest range and no further', () => {
    expect(pickHarvestBody(world([corpse(2, INTERACT_RANGE)]))).toBe(2);
    expect(pickHarvestBody(world([corpse(2, INTERACT_RANGE + 0.01)]))).toBeNull();
  });

  it('refuses a body past harvest range even while the popup would still hold it', () => {
    // The band the mismatch lived in: inside the popup's reach, outside the
    // sim's. Empty on both arms, so nothing names a body that cannot be taken.
    expect(HARVEST_BODY_RANGE).toBeGreaterThan(INTERACT_RANGE);
    const between = (INTERACT_RANGE + HARVEST_BODY_RANGE) / 2;
    expect(pickHarvestBody(world([corpse(2, between)]))).toBeNull();
    expect(pickHarvestBody(world([corpse(2, HARVEST_BODY_RANGE)]))).toBeNull();
    // Targeting one does not buy it a pass either, and an in-range body still wins.
    expect(pickHarvestBody(world([corpse(2, between)], { targetId: 2 }))).toBeNull();
    const withNear = world([corpse(2, between), corpse(5, INTERACT_RANGE)], { targetId: 2 });
    expect(pickHarvestBody(withNear)).toBe(5);
  });

  it('names nothing when no body in reach still has its harvest', () => {
    expect(pickHarvestBody(world([]))).toBeNull();
    expect(pickHarvestBody(world([corpse(2, 1, { harvestClaimedBy: ME })]))).toBeNull();
    // A loot-only template: nothing to harvest, whatever loot it holds.
    expect(
      pickHarvestBody(
        world([corpse(2, 1, { templateId: 'test', loot: { copper: 5, items: [] } })]),
      ),
    ).toBeNull();
    // An owned pet body and an expired body are never bodies to harvest.
    expect(pickHarvestBody(world([corpse(2, 1, { ownerId: STRANGER })]))).toBeNull();
    expect(pickHarvestBody(world([corpse(2, 1, { corpseTimer: 0 })]))).toBeNull();
  });

  it("still names a stranger's owner-locked kill while its harvest is open", () => {
    const locked = corpse(2, 1, {
      tappedById: STRANGER,
      lootFfaTimer: LOOT_FFA_DELAY,
      loot: { copper: 5, items: [] },
    });
    expect(pickHarvestBody(world([locked]))).toBe(2);
  });

  it('names nothing for a dead viewer', () => {
    expect(pickHarvestBody(world([corpse(2, 1)], { dead: true }))).toBeNull();
  });
});
