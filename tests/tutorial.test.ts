import { describe, expect, it } from 'vitest';
import { computeTutorialStep, isFreshCharacter, type TutorialSnapshot } from '../src/ui/tutorial';
import type { IWorld } from '../src/world_api';
import { QUESTS, ZONES } from '../src/sim/data';

// The overlay's rendering is DOM-bound, but the step progression is a pure
// function over observed IWorld state — that's what we pin here.
const base: TutorialSnapshot = {
  moved: false,
  nearGiver: false,
  questActive: false,
  questReady: false,
  questDone: false,
};

describe('computeTutorialStep', () => {
  it('starts on move for a fresh, motionless character', () => {
    expect(computeTutorialStep(base)).toBe('move');
  });

  it('advances to seek once the player has moved', () => {
    expect(computeTutorialStep({ ...base, moved: true })).toBe('seek');
  });

  it('advances to talk when standing by the giver', () => {
    expect(computeTutorialStep({ ...base, moved: true, nearGiver: true })).toBe('talk');
  });

  it('advances to slay once the quest is accepted', () => {
    expect(computeTutorialStep({ ...base, moved: true, questActive: true })).toBe('slay');
  });

  it('advances to return when objectives are complete', () => {
    expect(computeTutorialStep({ ...base, questActive: true, questReady: true })).toBe('return');
  });

  it('reaches done after the quest is turned in', () => {
    expect(computeTutorialStep({ ...base, questDone: true })).toBe('done');
  });

  it('keeps guiding to slay even while standing on the giver mid-hunt', () => {
    // nearGiver must not pull the player back to "talk" once the quest is live.
    expect(computeTutorialStep({ ...base, moved: true, nearGiver: true, questActive: true })).toBe('slay');
  });

  it('treats a turned-in quest as done regardless of position', () => {
    expect(computeTutorialStep({ moved: true, nearGiver: true, questActive: true, questReady: true, questDone: true })).toBe('done');
  });
});

// isFreshCharacter is the engage gate, and the online pre-snapshot race it
// guards against is the highest-value missing coverage (see review #729).
describe('isFreshCharacter', () => {
  // Minimal IWorld stub — only the fields the gate reads.
  const world = (over: Partial<IWorld> & { playerLevel?: number; playerId?: number; playerEntId?: number }): IWorld => ({
    playerId: over.playerId ?? 7,
    player: { id: over.playerEntId ?? 7, level: over.playerLevel ?? 1 } as any,
    questsDone: new Set<string>(),
    questLog: new Map(),
    ...over,
  } as unknown as IWorld);

  it('is true for a genuine fresh character (ids match, level 1, no quests)', () => {
    expect(isFreshCharacter(world({ playerId: 7, playerEntId: 7 }))).toBe(true);
  });

  it('is false for a returning veteran (level > 1)', () => {
    expect(isFreshCharacter(world({ playerLevel: 12 }))).toBe(false);
  });

  it('rejects the online post-hello placeholder window (playerId real, player.id still -1)', () => {
    expect(isFreshCharacter(world({ playerId: 7, playerEntId: -1 }))).toBe(false);
  });

  it('rejects the pre-hello window (both ids -1)', () => {
    expect(isFreshCharacter(world({ playerId: -1, playerEntId: -1 }))).toBe(false);
  });

  it('is false once the player has any quest history', () => {
    expect(isFreshCharacter(world({ questsDone: new Set(['q_wolves']) }))).toBe(false);
    expect(isFreshCharacter(world({ questLog: new Map([['q_wolves', { counts: [0] } as any]]) }))).toBe(false);
  });
});

// Pin the content derivation so a future rename of the starter quest/giver/mob
// fails CI instead of silently breaking onboarding (review #729, finding 3).
describe('starter content derivation', () => {
  it('resolves a starter quest with a giver and a kill objective', () => {
    const questId = ZONES[0]?.welcomeQuestId;
    expect(questId).toBeTruthy();
    const def = QUESTS[questId!];
    expect(def).toBeTruthy();
    expect(def.giverNpcId).toBeTruthy();
    expect(def.objectives.find((o) => o.type === 'kill')?.targetMobId).toBeTruthy();
  });
});
