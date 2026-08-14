// The renderer's half of the quest-collectable gate: whether THIS Renderer honours the
// sim rule at all. The rule itself (which objects are gated, and in which quest states)
// is the sim's, covered by tests/quest_gated_ground_object.test.ts.

import { describe, expect, it } from 'vitest';
import { groundObjectPoolKey } from '../src/render/ground_object_pool';
import { makeQuestObjectGate } from '../src/render/quest_object_gate_core';
import { ITEMS } from '../src/sim/data';
import type { Entity, QuestProgress } from '../src/sim/types';

const crate = (): Entity =>
  ({
    kind: 'object',
    templateId: 'ground_supply_crate',
    objectItemId: 'supply_crate',
  }) as unknown as Entity;

const questId = (): string => {
  const id = ITEMS.supply_crate?.questId;
  if (!id) throw new Error('expected supply_crate to name its quest');
  return id;
};

const onQuest = (): Map<string, QuestProgress> => {
  const id = questId();
  return new Map([[id, { questId: id, counts: [0], state: 'active' as const }]]);
};

describe('makeQuestObjectGate', () => {
  it('withholds an off-quest collectable by default (the game viewer)', () => {
    const gate = makeQuestObjectGate({});
    expect(gate(crate(), new Map())).toBe(true);
    expect(gate(crate(), onQuest())).toBe(false);
  });

  it('shows everything when the caller opts out (the editor viewport)', () => {
    const gate = makeQuestObjectGate({ showAllQuestObjects: true });
    expect(gate(crate(), new Map())).toBe(false);
    expect(gate(crate(), onQuest())).toBe(false);
  });

  it('treats an absent flag as the game default, never as opt-out', () => {
    const gate = makeQuestObjectGate({ showAllQuestObjects: undefined });
    expect(gate(crate(), new Map())).toBe(true);
  });
});

describe('groundObjectPoolKey', () => {
  it('keys a ground object on its item id so the pool cannot drift from the build', () => {
    expect(groundObjectPoolKey(crate())).toBe('object:supply_crate');
  });

  it('refuses to pool the bespoke dungeon portals and anything with no item', () => {
    const door = { kind: 'object', templateId: 'dungeon_door', objectItemId: 'x' };
    const exit = { kind: 'object', templateId: 'dungeon_exit', objectItemId: 'x' };
    const bare = { kind: 'object', templateId: 'mailbox', objectItemId: null };
    const mob = { kind: 'mob', templateId: 'wild_boar', objectItemId: 'supply_crate' };
    for (const e of [door, exit, bare, mob]) {
      expect(groundObjectPoolKey(e as unknown as Entity)).toBeNull();
    }
  });
});
