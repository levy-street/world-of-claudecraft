import { describe, expect, it, vi } from 'vitest';
import {
  handlePickedEntity,
  type PickInteractionHud,
  type PickInteractionWorld,
} from '../src/game/interactions';
import { entityViewIsAdmitted, entityViewShouldDrop } from '../src/render/entity_view_policy_core';
import { makeQuestObjectGate } from '../src/render/quest_object_gate_core';
import {
  INVESTIGATION_CLUES,
  INVESTIGATION_NPC_IDS,
  INVESTIGATION_QUEST_ID,
  INVESTIGATION_VARIANTS,
} from '../src/sim/content/world_quest_investigation';
import type { Entity, WorldQuestProgress } from '../src/sim/types';
import { investigationDisguiseHidden } from '../src/sim/world_quest_investigation_visibility';
import { worldQuestPuzzleVariantForCycle } from '../src/sim/world_quest_rotation';

const guard = (id: number): Entity =>
  ({ id, kind: 'npc', templateId: 'infiltrator_orin', pos: { x: 0, y: 0, z: 0 } }) as Entity;
const progress = (): WorldQuestProgress => ({
  questId: INVESTIGATION_QUEST_ID,
  state: 'active',
  count: 0,
  investigation: { heard: 15, clues: 3, cleared: 0, mobId: 42 },
});

describe('personal investigation disguise visibility', () => {
  it('hides exactly the revealed culprit for each variant, never the shared entity or other investigators', () => {
    const variants = new Set<number>();
    for (const cycle of Array.from({ length: 60 }, (_, index) => `wq3_${index}`)) {
      const variant = worldQuestPuzzleVariantForCycle(cycle, INVESTIGATION_VARIANTS.length);
      variants.add(variant);
      const world = {
        worldQuestCycle: cycle,
        worldQuestLog: new Map([[INVESTIGATION_QUEST_ID, progress()]]),
      };
      const other = {
        worldQuestCycle: cycle,
        worldQuestLog: new Map<string, WorldQuestProgress>(),
      };
      for (const [index, id] of INVESTIGATION_NPC_IDS.entries()) {
        const entity = guard(id);
        const original = structuredClone(entity);
        expect(investigationDisguiseHidden(entity, world)).toBe(
          index === INVESTIGATION_VARIANTS[variant].culprit + 1,
        );
        expect(investigationDisguiseHidden(entity, other)).toBe(false);
        expect(entity).toEqual(original);
      }
    }
    expect(variants.size).toBe(INVESTIGATION_VARIANTS.length);
  });

  it('restores admission after reset or completion, including selected NPC views', () => {
    const cycle = 'wq3_0';
    const variant = worldQuestPuzzleVariantForCycle(cycle, INVESTIGATION_VARIANTS.length);
    const entity = guard(INVESTIGATION_NPC_IDS[INVESTIGATION_VARIANTS[variant].culprit + 1]);
    const entry = progress();
    const world = {
      worldQuestCycle: cycle,
      worldQuestLog: new Map([[INVESTIGATION_QUEST_ID, entry]]),
    };
    const gate = makeQuestObjectGate({}, world);
    const questLog = new Map();
    const player = { ...guard(1), kind: 'player', targetId: entity.id } as Entity;
    expect(entityViewIsAdmitted(entity, questLog, gate)).toBe(false);
    expect(entityViewShouldDrop(entity, player, questLog, gate, 10000)).toBe(true);
    delete entry.investigation?.mobId;
    expect(entityViewIsAdmitted(entity, questLog, gate)).toBe(true);
    entry.investigation = { heard: 15, clues: 3, cleared: 0, mobId: 42 };
    // A closed case empties the whole post for its investigator: every guard,
    // the sergeant and both records; the next rotation (no log entry) restores it.
    entry.state = 'completed';
    expect(entityViewShouldDrop(entity, player, questLog, gate, 10000)).toBe(true);
    for (const id of INVESTIGATION_NPC_IDS)
      expect(investigationDisguiseHidden({ id, kind: 'npc' }, world)).toBe(true);
    for (const clue of INVESTIGATION_CLUES)
      expect(investigationDisguiseHidden({ id: clue.entityId, kind: 'object' }, world)).toBe(true);
    expect(investigationDisguiseHidden({ id: 5, kind: 'npc' }, world)).toBe(false);
    world.worldQuestLog.clear();
    expect(investigationDisguiseHidden({ id: INVESTIGATION_NPC_IDS[0], kind: 'npc' }, world)).toBe(
      false,
    );
    world.worldQuestLog.set(INVESTIGATION_QUEST_ID, entry);
    entry.state = 'active';
    expect(makeQuestObjectGate({ showAllQuestObjects: true }, world)(entity, questLog)).toBe(false);
  });

  it('blocks stale click picks before targeting or opening dialogue', () => {
    const cycle = 'wq3_0';
    const variant = worldQuestPuzzleVariantForCycle(cycle, INVESTIGATION_VARIANTS.length);
    const entity = guard(INVESTIGATION_NPC_IDS[INVESTIGATION_VARIANTS[variant].culprit + 1]);
    const target = vi.fn(),
      dialog = vi.fn();
    const world = {
      worldQuestCycle: cycle,
      worldQuestLog: new Map([[INVESTIGATION_QUEST_ID, progress()]]),
      entities: new Map([[entity.id, entity]]),
      questLog: new Map(),
      targetEntity: target,
    } as unknown as PickInteractionWorld;
    const hud = { openQuestDialog: dialog } as unknown as PickInteractionHud;
    for (const button of [0, 2])
      expect(handlePickedEntity(world, hud, entity.id, button, 0, 0)).toBe(false);
    expect(target).not.toHaveBeenCalled();
    expect(dialog).not.toHaveBeenCalled();
  });
});
