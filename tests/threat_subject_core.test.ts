// Which mob the Threat tab is about. The rule this pins is the fix for two
// player reports that turned out to be one bug: the tab "stops updating", and
// someone below you on the meter steals aggro while the mob is still on you.
// Both came from the encounter latching its threat subject to the first/biggest
// mob it ever saw and never letting go, including after that mob died.

import { describe, expect, it } from 'vitest';
import { resolveThreatSubject, type ThreatSubjectMob } from '../src/ui/threat_subject_core';

const mob = (id: number, over: Partial<ThreatSubjectMob> = {}): ThreatSubjectMob => ({
  id,
  kind: 'mob',
  dead: false,
  maxHp: 500,
  threat: new Map([[1, 100]]),
  ...over,
});

const PARTY = new Set([1, 2]);

const resolve = (
  entities: ThreatSubjectMob[],
  over: {
    playerTargetId?: number | null;
    trackedPids?: ReadonlySet<number>;
    fallbackMobId?: number | null;
  } = {},
) =>
  resolveThreatSubject({
    entities,
    playerTargetId: over.playerTargetId ?? null,
    trackedPids: over.trackedPids ?? PARTY,
    fallbackMobId: over.fallbackMobId ?? null,
  });

describe('threat subject', () => {
  it('follows the mob the player has targeted', () => {
    // A threat meter is about what you are looking at, even when a bigger mob is
    // also engaged.
    expect(resolve([mob(10, { maxHp: 9000 }), mob(11)], { playerTargetId: 11 })).toBe(11);
  });

  it('releases a mob the moment it dies, instead of freezing on the corpse', () => {
    // The reported "it stops updating": the old latch kept pointing at the dead
    // mob, whose hate table is gone, for the rest of the fight.
    const dead = mob(10, { dead: true, maxHp: 9000 });
    const alive = mob(11);
    expect(resolve([dead, alive], { fallbackMobId: 10 })).toBe(11);
  });

  it('moves to a second mob of the SAME size', () => {
    // The old `maxHp > biggestMobHp` latch never fired for an equal-sized mob,
    // so every same-type trash pull stayed pinned to whichever one was hit
    // first. Here the first is dead and the identical second is live.
    const first = mob(10, { dead: true });
    const second = mob(11, { maxHp: 500 });
    expect(resolve([first, second], { fallbackMobId: 10 })).toBe(11);
  });

  it('prefers the biggest engaged mob, so a boss outranks its adds', () => {
    expect(resolve([mob(10), mob(11, { maxHp: 9000 }), mob(12)])).toBe(11);
  });

  it('breaks a size tie on the lowest id so the choice cannot flicker', () => {
    expect(resolve([mob(12), mob(10), mob(11)])).toBe(10);
    expect(resolve([mob(10), mob(12), mob(11)])).toBe(10);
  });

  it('ignores a mob fighting someone else entirely', () => {
    const stranger = mob(10, { threat: new Map([[99, 500]]) });
    expect(resolve([stranger])).toBeNull();
  });

  it('counts a mob that has only ever seen the party PET', () => {
    // A pet can be the only member of the group on a mob's table.
    const onPet = mob(10, { threat: new Map([[3, 500]]) });
    expect(resolve([onPet], { trackedPids: new Set([1, 2, 3]) })).toBe(10);
  });

  it('ignores an untouched mob standing nearby, even when targeted', () => {
    const idle = mob(10, { threat: new Map() });
    expect(resolve([idle], { playerTargetId: 10 })).toBeNull();
  });

  it('skips non-mob entities', () => {
    const player = mob(10, { kind: 'player' });
    expect(resolve([player])).toBeNull();
  });

  it('falls back to the latched encounter mob only when nothing is live', () => {
    // This is what keeps a finished fight reviewable in the history pages; the
    // panel labels those bars as damage, never as hate.
    expect(resolve([], { fallbackMobId: 51 })).toBe(51);
    expect(resolve([])).toBeNull();
  });
});
