import { describe, expect, it } from 'vitest';
import { type CycleEntity, nearbyNpcs, nextNpcTarget } from '../src/game/npc_cycle';

const npc = (id: number, x: number, z = 0, over: Partial<CycleEntity> = {}): CycleEntity => ({
  id,
  kind: 'npc',
  pos: { x, z },
  ...over,
});

const origin = { x: 0, z: 0 };

describe('nearbyNpcs', () => {
  it('takes NPCs only, nearest first', () => {
    // A wolf standing closer than the quest giver must not come back from a cycle
    // whose whole job is picking someone to talk to.
    const list = nearbyNpcs(
      [npc(3, 30), { id: 9, kind: 'mob', pos: { x: 1, z: 0 } }, npc(1, 5), npc(2, 10)],
      origin,
    );
    expect(list.map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it('skips the dead and anything out of range', () => {
    const list = nearbyNpcs([npc(1, 5, 0, { dead: true }), npc(2, 500), npc(3, 8)], origin);
    expect(list.map((e) => e.id)).toEqual([3]);
  });

  it('breaks ties by id so the order holds still between presses', () => {
    // Two NPCs the same distance away must not swap places as the player stands
    // there, or a second press would go backwards.
    const list = nearbyNpcs([npc(7, 5), npc(2, 5), npc(5, 5)], origin);
    expect(list.map((e) => e.id)).toEqual([2, 5, 7]);
  });
});

describe('nextNpcTarget', () => {
  const three = [npc(1, 5), npc(2, 10), npc(3, 15)];

  it('starts at the nearest when nothing is targeted', () => {
    expect(nextNpcTarget(three, origin, null)).toBe(1);
  });

  it('steps forward and wraps', () => {
    expect(nextNpcTarget(three, origin, 1)).toBe(2);
    expect(nextNpcTarget(three, origin, 3)).toBe(1);
  });

  it('steps backward and wraps', () => {
    expect(nextNpcTarget(three, origin, 2, -1)).toBe(1);
    expect(nextNpcTarget(three, origin, 1, -1)).toBe(3);
  });

  it('lands on the nearest when the target is not an NPC at all', () => {
    // Coming off a wolf, the first press should pick somebody sensible rather
    // than treating "not in the list" as position zero by accident.
    expect(nextNpcTarget(three, origin, 99)).toBe(1);
    expect(nextNpcTarget(three, origin, 99, -1)).toBe(3);
  });

  it('answers null with nobody around', () => {
    expect(nextNpcTarget([], origin, null)).toBeNull();
  });
});
