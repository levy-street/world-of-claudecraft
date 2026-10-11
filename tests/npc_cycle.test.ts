import { describe, expect, it } from 'vitest';
import {
  type CycleEntity,
  nearbyNpcs,
  nextNpcTarget,
  nextNpcTargetForWorld,
} from '../src/game/npc_cycle';

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

it('skips the revealed disguise for its investigator and restores it after completion', () => {
  const progress = {
    questId: 'wq_mirefen_infiltrator',
    state: 'active' as 'active' | 'completed',
    count: 0,
    investigation: { heard: 15, clues: 3, cleared: 0, mobId: 90 },
  };
  const world = {
    // A cycle whose story names Orin (2146900022): variant 0 of the rotation.
    worldQuestCycle: 'wq3_0',
    worldQuestLog: new Map([[progress.questId, progress]]),
  };
  const people = [npc(2146900022, 1), npc(2146900021, 2)];
  expect(nextNpcTarget(people, origin, null, 1, 40, world)).toBe(2146900021);
  expect(nextNpcTarget(people, origin, 2146900022, -1, 40, world)).toBe(2146900021);
  // A closed case empties the post for its investigator; the next rotation
  // (no log entry) brings everyone back.
  progress.state = 'completed';
  expect(nextNpcTarget(people, origin, null, 1, 40, world)).toBeNull();
  world.worldQuestLog.clear();
  expect(nextNpcTarget(people, origin, null, 1, 40, world)).toBe(2146900022);
});

describe('nextNpcTargetForWorld', () => {
  it('cycles from the world player exactly as nextNpcTarget does with the same inputs', () => {
    const list = [npc(1, 5), npc(2, 10), npc(3, 30)];
    const entities = new Map(list.map((e) => [e.id, e]));
    for (const targetId of [null, 1, 2, 3]) {
      for (const step of [1, -1] as const) {
        const world = { entities, player: { pos: origin, targetId } };
        expect(nextNpcTargetForWorld(world, step)).toBe(
          nextNpcTarget(list, origin, targetId, step),
        );
      }
    }
  });
});
