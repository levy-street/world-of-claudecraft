// The renderer's half of the quest-collectable gate: whether THIS Renderer honours the
// sim rule at all. The rule itself (which objects are gated, and in which quest states)
// is the sim's, covered by tests/quest_gated_ground_object.test.ts.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { groundObjectPoolKey } from '../src/render/ground_object_pool';
import { makeQuestObjectGate } from '../src/render/quest_object_gate_core';
import { ITEMS } from '../src/sim/data';
import { interactObjectCreditKey } from '../src/sim/quests/interact_object_credit';
import type { Entity, QuestProgress, WorldQuestProgress } from '../src/sim/types';
import { worldQuestCycleForResetDay } from '../src/sim/world_quests';

// An overworld position (x = 0 is in no instance band): the sim rule consults the
// dungeon a collectable stands in for the interact-only exemption.
const crate = (): Entity =>
  ({
    kind: 'object',
    templateId: 'ground_supply_crate',
    objectItemId: 'supply_crate',
    pos: { x: 0, y: 0, z: 0 },
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
  it('receives the live world mirrors from the renderer integration seam', () => {
    const renderer = readFileSync('src/render/renderer.ts', 'utf8');
    expect(renderer).toContain('makeQuestObjectGate(options, this.sim)');
  });

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

  it('admits only the current personal shipwreck-salvage pieces', () => {
    const cycle = worldQuestCycleForResetDay('2026-09-06');
    const worldQuestLog = new Map<string, WorldQuestProgress>();
    const gate = makeQuestObjectGate({}, { worldQuestCycle: cycle, worldQuestLog });
    const piece = {
      ...crate(),
      id: 2_147_100_100,
      objectItemId: 'wreckfield_flotsam_crate',
      pos: { x: 277, y: 0, z: 82 },
    };
    const rotatedOut = {
      ...piece,
      id: 2_147_100_108,
      pos: { x: 273, y: 0, z: 78 },
    };

    expect(gate(piece, new Map())).toBe(false);
    expect(gate(rotatedOut, new Map())).toBe(true);

    worldQuestLog.set('wq_farshore_salvage', {
      questId: 'wq_farshore_salvage',
      count: 1,
      state: 'active',
      puzzleVariant: 0,
      creditedObjects: [interactObjectCreditKey(0, piece.pos)],
    });
    expect(gate(piece, new Map())).toBe(true);
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
