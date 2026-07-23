import { describe, expect, it } from 'vitest';
import { AMBERFALL_QUEST_ORDER, AMBERFALL_QUESTS } from '../src/sim/content/amberfall';
import { DRAKELANDS_QUEST_ORDER, DRAKELANDS_QUESTS } from '../src/sim/content/drakelands';
import { EVERGARDEN_QUEST_ORDER, EVERGARDEN_QUESTS } from '../src/sim/content/evergarden';
import { FARSHORE_QUEST_ORDER, FARSHORE_QUESTS } from '../src/sim/content/farshore';
import { FROSTVEIL_QUEST_ORDER, FROSTVEIL_QUESTS } from '../src/sim/content/frostveil';
import { GALECREST_QUEST_ORDER, GALECREST_QUESTS } from '../src/sim/content/galecrest';
import { NIGHTBLOOM_QUEST_ORDER, NIGHTBLOOM_QUESTS } from '../src/sim/content/nightbloom';
import { PALMREACH_QUEST_ORDER, PALMREACH_QUESTS } from '../src/sim/content/palmreach';
import { WILLOWFEN_QUEST_ORDER, WILLOWFEN_QUESTS } from '../src/sim/content/willowfen';
import { WRAITHWOOD_QUEST_ORDER, WRAITHWOOD_QUESTS } from '../src/sim/content/wraithwood';
import { GROUND_OBJECTS, ITEMS, MOBS, NPCS, QUESTS } from '../src/sim/data';
import type { QuestDef } from '../src/sim/types';

const NEW_REALM_ARCS: {
  name: string;
  order: readonly string[];
  quests: Record<string, QuestDef>;
}[] = [
  { name: 'Drakelands', order: DRAKELANDS_QUEST_ORDER, quests: DRAKELANDS_QUESTS },
  { name: 'Frostveil', order: FROSTVEIL_QUEST_ORDER, quests: FROSTVEIL_QUESTS },
  { name: 'Amberfall', order: AMBERFALL_QUEST_ORDER, quests: AMBERFALL_QUESTS },
  { name: 'Willowfen', order: WILLOWFEN_QUEST_ORDER, quests: WILLOWFEN_QUESTS },
  { name: 'Nightbloom', order: NIGHTBLOOM_QUEST_ORDER, quests: NIGHTBLOOM_QUESTS },
  { name: 'Wraithwood', order: WRAITHWOOD_QUEST_ORDER, quests: WRAITHWOOD_QUESTS },
  { name: 'Galecrest', order: GALECREST_QUEST_ORDER, quests: GALECREST_QUESTS },
  { name: 'Palmreach', order: PALMREACH_QUEST_ORDER, quests: PALMREACH_QUESTS },
  { name: 'Evergarden', order: EVERGARDEN_QUEST_ORDER, quests: EVERGARDEN_QUESTS },
  { name: 'Farshore', order: FARSHORE_QUEST_ORDER, quests: FARSHORE_QUESTS },
];

describe('new realm quest arcs', () => {
  it.each(NEW_REALM_ARCS)('$name has a connected, varied three-quest arc', ({ order, quests }) => {
    expect(order).toHaveLength(3);
    expect(new Set(order)).toEqual(new Set(Object.keys(quests)));

    order.forEach((questId, index) => {
      const quest = quests[questId];
      expect(quest.objectives.length).toBeGreaterThan(0);
      expect(quest).toBe(QUESTS[questId]);
      expect(quest.requiresQuest).toBe(index === 0 ? undefined : order[index - 1]);
      expect(NPCS[quest.giverNpcId]?.questIds).toContain(questId);
      expect(NPCS[quest.turnInNpcId]?.questIds).toContain(questId);

      for (const objective of quest.objectives) {
        if (objective.type === 'kill') {
          expect(MOBS[objective.targetMobId]).toBeTruthy();
        } else if (objective.type === 'interact') {
          if (objective.targetNpcId) expect(NPCS[objective.targetNpcId]).toBeTruthy();
          if (objective.targetObjectItemId) {
            expect(ITEMS[objective.targetObjectItemId]?.kind).toBe('quest');
            expect(
              GROUND_OBJECTS.some(
                (object) =>
                  object.itemId === objective.targetObjectItemId && object.positions.length > 0,
              ),
            ).toBe(true);
          }
        } else if (objective.type === 'escort') {
          expect(NPCS[objective.targetNpcId]).toBeTruthy();
          expect(objective.path.length).toBeGreaterThanOrEqual(4);
          expect(objective.ambushes.length).toBeGreaterThanOrEqual(2);
          for (const ambush of objective.ambushes) {
            expect(MOBS[ambush.mobId]).toBeTruthy();
            expect(ambush.atWaypoint).toBeGreaterThan(0);
            expect(ambush.atWaypoint).toBeLessThan(objective.path.length);
          }
        }
      }
    });

    const middleQuest = quests[order[1]];
    expect(
      middleQuest.objectives.some(
        (objective) => objective.type === 'interact' || objective.type === 'escort',
      ),
    ).toBe(true);
    const finale = quests[order[order.length - 1]];
    const boss = finale.objectives.find((objective) => objective.type === 'kill');
    expect(boss?.type).toBe('kill');
    if (boss?.type === 'kill') {
      expect(MOBS[boss.targetMobId]?.elite || MOBS[boss.targetMobId]?.rare).toBe(true);
      expect(boss.count).toBe(1);
    }
  });

  it('uses every authored landmark only once within its exploration quest', () => {
    for (const { order, quests } of NEW_REALM_ARCS) {
      for (const questId of order) {
        const objectIds = quests[questId].objectives.flatMap((objective) =>
          objective.type === 'interact' && objective.targetObjectItemId
            ? [objective.targetObjectItemId]
            : [],
        );
        expect(new Set(objectIds).size).toBe(objectIds.length);
      }
    }
  });
});
