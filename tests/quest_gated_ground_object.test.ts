// The GROUND OBJECT arm of src/sim/quest_gated_entity.ts: a collectable quest item
// lying in the world is only shown to a player whose quest actually wants it.
//
// Driven off the live content tables rather than a hand-listed set of item ids, so a
// new collectable inherits the gate and a new interact-only prop inherits the
// exemption, without this file being edited. The distinction is the whole point of the
// arm: `collect` objectives consume the object (a shiny an off-quest player can never
// take), while `interact` objectives leave it standing as scenery (huts, graves,
// monuments, moorings), so only the first kind may vanish.
//
// The mob arm and its Broodmother-egg cases stay in tests/mirefen_dedupe_objectives.ts.

import { describe, expect, it } from 'vitest';
import { GROUND_OBJECTS, ITEMS, QUESTS } from '../src/sim/data';
import {
  isQuestGatedEntityHidden,
  isQuestGatedGroundObjectHidden,
} from '../src/sim/quest_gated_entity';
import { Sim } from '../src/sim/sim';
import type { Entity, QuestProgress } from '../src/sim/types';

/** Does this authored ground object exist to be COLLECTED (as opposed to interacted with)? */
function isCollectTarget(itemId: string): boolean {
  const questId = ITEMS[itemId]?.questId;
  const quest = questId ? QUESTS[questId] : undefined;
  return !!quest && quest.objectives.some((o) => o.type === 'collect' && o.itemId === itemId);
}

const COLLECT_IDS = [...new Set(GROUND_OBJECTS.map((d) => d.itemId))].filter(isCollectTarget);
const SCENERY_IDS = [...new Set(GROUND_OBJECTS.map((d) => d.itemId))].filter(
  (id) => !isCollectTarget(id),
);

const objectEntity = (itemId: string | null): Entity =>
  ({ kind: 'object', templateId: `ground_${itemId}`, objectItemId: itemId }) as unknown as Entity;

const log = (questId: string, state: QuestProgress['state']): Map<string, QuestProgress> =>
  new Map([[questId, { questId, counts: [0, 0], state }]]);

const questOf = (itemId: string): string => {
  const questId = ITEMS[itemId]?.questId;
  if (!questId) throw new Error(`expected a questId on ${itemId}`);
  return questId;
};

describe('quest-gated ground collectables (content-wide)', () => {
  it('has both kinds of authored ground object to reason about', () => {
    // Vacuity floors: an empty it.each list registers no cases at all. Kept well under
    // the live counts so ordinary content authoring never touches this file.
    expect(COLLECT_IDS.length).toBeGreaterThanOrEqual(10);
    expect(SCENERY_IDS.length).toBeGreaterThanOrEqual(20);
    // The named exemplar of each kind, so a refactor that silently reclassified one
    // would fail here rather than passing over an empty half.
    expect(COLLECT_IDS).toContain('supply_crate');
    expect(SCENERY_IDS).toContain('murloc_hut');
  });

  it.each(COLLECT_IDS)('hides %s from a player who is not on its quest', (itemId) => {
    expect(isQuestGatedGroundObjectHidden(objectEntity(itemId), new Map())).toBe(true);
  });

  it.each(COLLECT_IDS)('shows %s while its quest is active, and again when ready', (itemId) => {
    const questId = questOf(itemId);
    expect(isQuestGatedGroundObjectHidden(objectEntity(itemId), log(questId, 'active'))).toBe(
      false,
    );
    expect(isQuestGatedGroundObjectHidden(objectEntity(itemId), log(questId, 'ready'))).toBe(false);
  });

  it.each(COLLECT_IDS)('hides %s again once its quest is turned in', (itemId) => {
    expect(isQuestGatedGroundObjectHidden(objectEntity(itemId), log(questOf(itemId), 'done'))).toBe(
      true,
    );
  });

  it.each(SCENERY_IDS)('never hides %s, an interact target that is world scenery', (itemId) => {
    expect(isQuestGatedGroundObjectHidden(objectEntity(itemId), new Map())).toBe(false);
  });

  it('never hides an object carrying no quest item at all (mailboxes, doors, portals)', () => {
    expect(isQuestGatedGroundObjectHidden(objectEntity(null), new Map())).toBe(false);
    expect(isQuestGatedGroundObjectHidden(objectEntity('not_an_item'), new Map())).toBe(false);
  });

  it('never hides a non-object entity through the object arm', () => {
    const mob = { kind: 'mob', templateId: 'spider_egg' } as unknown as Entity;
    expect(isQuestGatedGroundObjectHidden(mob, new Map())).toBe(false);
  });

  it('routes the object arm through the general predicate the click paths use', () => {
    const crate = objectEntity('supply_crate');
    const questId = questOf('supply_crate');
    expect(isQuestGatedEntityHidden(crate, new Map())).toBe(true);
    expect(isQuestGatedEntityHidden(crate, log(questId, 'active'))).toBe(false);
  });
});

describe('quest-gated ground collectables against a live world', () => {
  const makeSim = () => new Sim({ seed: 42, playerClass: 'warrior', playerName: 'Gate' });

  it('leaves the entity spawned in the sim: only the viewer hides it', () => {
    // The world is shared and the server is authoritative, so the crate must still be a
    // live entity (another player may be on the quest). The gate is a per-viewer
    // display decision, never a despawn.
    const sim = makeSim();
    const crates = [...sim.entities.values()].filter((e) => e.objectItemId === 'supply_crate');
    expect(crates.length).toBeGreaterThan(0);
    for (const crate of crates) {
      expect(isQuestGatedGroundObjectHidden(crate, sim.questLog)).toBe(true);
    }
  });

  it('reveals the crates the moment the quest is on the log, and retires them on turn-in', () => {
    const sim = makeSim();
    const crate = [...sim.entities.values()].find((e) => e.objectItemId === 'supply_crate');
    if (!crate) throw new Error('expected a spawned supply crate');
    const questId = questOf('supply_crate');

    sim.questLog.set(questId, { questId, counts: [0], state: 'active' });
    expect(isQuestGatedGroundObjectHidden(crate, sim.questLog)).toBe(false);

    sim.questLog.set(questId, { questId, counts: [6], state: 'done' });
    expect(isQuestGatedGroundObjectHidden(crate, sim.questLog)).toBe(true);
  });

  it('leaves every interact-only prop visible on a fresh character', () => {
    const sim = makeSim();
    const scenery = [...sim.entities.values()].filter(
      (e) => e.objectItemId !== null && SCENERY_IDS.includes(e.objectItemId),
    );
    expect(scenery.length).toBeGreaterThan(0);
    for (const prop of scenery) {
      expect(isQuestGatedGroundObjectHidden(prop, sim.questLog)).toBe(false);
    }
  });
});
