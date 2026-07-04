import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { questGateQuestId, questObjectVisibleTo } from '../src/sim/quest_object_visibility';
import type { Entity, QuestProgress } from '../src/sim/types';

// The function only reads e.kind and e.objectItemId, so a minimal cast is safe.
function objectEntity(objectItemId: string | null): Entity {
  return { kind: 'object', objectItemId } as unknown as Entity;
}
function mobEntity(): Entity {
  return { kind: 'mob', objectItemId: null } as unknown as Entity;
}
function log(entries: QuestProgress[]): Map<string, QuestProgress> {
  return new Map(entries.map((q) => [q.questId, q]));
}

const GATE_ITEM = 'gravecaller_sigil';
const GATE_QUEST = 'q_whispers';

describe('questGateQuestId', () => {
  it('confirms the fixture item is a real quest collectible', () => {
    expect(ITEMS[GATE_ITEM]?.questId).toBe(GATE_QUEST);
  });

  it('returns the gating quest id for a quest ground object', () => {
    expect(questGateQuestId(objectEntity(GATE_ITEM))).toBe(GATE_QUEST);
  });

  it('returns null for a non-object entity', () => {
    expect(questGateQuestId(mobEntity())).toBeNull();
  });

  it('returns null for an object with no objectItemId', () => {
    expect(questGateQuestId(objectEntity(null))).toBeNull();
  });

  it('returns null for an object whose item has no questId', () => {
    // an id absent from ITEMS is not quest-gated
    expect(questGateQuestId(objectEntity('not_a_real_item'))).toBeNull();
  });
});

describe('questObjectVisibleTo', () => {
  it('shows a non-gated object to anyone', () => {
    expect(questObjectVisibleTo(new Map(), objectEntity(null))).toBe(true);
    expect(questObjectVisibleTo(new Map(), mobEntity())).toBe(true);
  });

  it('hides a quest object from a player not on the quest', () => {
    expect(questObjectVisibleTo(new Map(), objectEntity(GATE_ITEM))).toBe(false);
  });

  it('shows a quest object while the quest is active', () => {
    const l = log([{ questId: GATE_QUEST, counts: [0], state: 'active' }]);
    expect(questObjectVisibleTo(l, objectEntity(GATE_ITEM))).toBe(true);
  });

  it('shows a quest object while the quest is ready', () => {
    const l = log([{ questId: GATE_QUEST, counts: [3], state: 'ready' }]);
    expect(questObjectVisibleTo(l, objectEntity(GATE_ITEM))).toBe(true);
  });

  it('keeps showing a quest object once enough is collected but before turn-in', () => {
    // Rationale: nearby world spawns must not vanish mid-farm; visible until
    // the quest is turned in, independent of collected count.
    const l = log([{ questId: GATE_QUEST, counts: [99], state: 'active' }]);
    expect(questObjectVisibleTo(l, objectEntity(GATE_ITEM))).toBe(true);
  });

  it('hides a quest object once the quest is done', () => {
    const l = log([{ questId: GATE_QUEST, counts: [3], state: 'done' }]);
    expect(questObjectVisibleTo(l, objectEntity(GATE_ITEM))).toBe(false);
  });
});
