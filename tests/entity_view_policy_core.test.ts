import { describe, expect, it } from 'vitest';
import {
  entityViewCandidatePriority,
  entityViewDistanceSq,
  entityViewIsAdmitted,
  entityViewShouldDrop,
  isPersistentPortalObject,
  viewBuildClass,
} from '../src/render/entity_view_policy_core';
import type { QuestObjectGate } from '../src/render/quest_object_gate_core';
import type { Entity, QuestProgress } from '../src/sim/types';

function entity(id: number, kind: Entity['kind'], overrides: Partial<Entity> = {}): Entity {
  return {
    id,
    kind,
    templateId: '',
    hostile: false,
    lootable: false,
    targetId: null,
    pos: { x: 0, y: 0, z: 0 },
    ...overrides,
  } as Entity;
}

describe('entity view candidate priority', () => {
  const player = entity(1, 'player', { targetId: 2 });

  it('keeps required, combat, landmark, and ordinary tiers in renderer order', () => {
    expect(entityViewCandidatePriority(player, player, 0)).toBe(-100);
    expect(entityViewCandidatePriority(entity(2, 'object'), player, 0)).toBe(-90);
    expect(entityViewCandidatePriority(entity(3, 'mob', { hostile: true }), player, 35 ** 2)).toBe(
      0,
    );
    expect(entityViewCandidatePriority(entity(4, 'npc'), player, 45 ** 2)).toBe(1);
    expect(
      entityViewCandidatePriority(entity(5, 'object', { templateId: 'mailbox' }), player, 1),
    ).toBe(0.5);
    expect(entityViewCandidatePriority(entity(6, 'object', { lootable: true }), player, 1)).toBe(2);
    expect(entityViewCandidatePriority(entity(7, 'player'), player, 1)).toBe(3);
    expect(entityViewCandidatePriority(entity(8, 'mob', { hostile: true }), player, 36 ** 2)).toBe(
      4,
    );
    expect(entityViewCandidatePriority(entity(9, 'mob'), player, 1)).toBe(5);
    expect(entityViewCandidatePriority(entity(10, 'npc'), player, 46 ** 2)).toBe(6);
    expect(entityViewCandidatePriority(entity(11, 'object'), player, 1)).toBe(7);
  });

  it('keeps persistent dungeon portals in the interactive object tier', () => {
    for (const templateId of ['dungeon_door', 'dungeon_exit']) {
      const portal = entity(3, 'object', { templateId });
      expect(isPersistentPortalObject(portal)).toBe(true);
      expect(entityViewCandidatePriority(portal, player, 10_000)).toBe(2);
    }
    expect(isPersistentPortalObject(entity(3, 'object', { templateId: 'mailbox' }))).toBe(false);
  });
});

describe('entity view distance', () => {
  it('uses the XZ plane and ignores elevation', () => {
    const a = entity(1, 'player', { pos: { x: 3, y: 100, z: 4 } });
    const b = entity(2, 'mob', { pos: { x: 0, y: -100, z: 0 } });
    expect(entityViewDistanceSq(a, b)).toBe(25);
  });
});

describe('entity view retirement', () => {
  const player = entity(1, 'player', { targetId: 2 });
  const questLog = new Map<string, QuestProgress>();
  const showAll: QuestObjectGate = () => false;

  it('drops missing, quest-hidden, and distant ordinary entities', () => {
    const hidden: QuestObjectGate = (candidate) => candidate.id === 3;
    expect(entityViewShouldDrop(undefined, player, questLog, showAll, 100)).toBe(true);
    expect(entityViewShouldDrop(entity(3, 'object'), player, questLog, hidden, 100)).toBe(true);
    expect(
      entityViewShouldDrop(
        entity(4, 'object', { pos: { x: 11, y: 0, z: 0 } }),
        player,
        questLog,
        showAll,
        100,
      ),
    ).toBe(true);
  });

  it('retains nearby, required, and persistent portal views', () => {
    expect(
      entityViewShouldDrop(
        entity(3, 'object', { pos: { x: 10, y: 0, z: 0 } }),
        player,
        questLog,
        showAll,
        100,
      ),
    ).toBe(false);
    expect(
      entityViewShouldDrop(
        entity(1, 'player', { pos: { x: 100, y: 0, z: 0 } }),
        player,
        questLog,
        showAll,
        100,
      ),
    ).toBe(false);
    expect(
      entityViewShouldDrop(
        entity(2, 'mob', { pos: { x: 100, y: 0, z: 0 } }),
        player,
        questLog,
        showAll,
        100,
      ),
    ).toBe(false);
    for (const templateId of ['dungeon_door', 'dungeon_exit']) {
      expect(
        entityViewShouldDrop(
          entity(3, 'object', { templateId, pos: { x: 100, y: 0, z: 0 } }),
          player,
          questLog,
          showAll,
          100,
        ),
      ).toBe(false);
    }
  });
});

describe('entity view admission', () => {
  const questLog = new Map<string, QuestProgress>();

  it('uses the quest visibility gate before a view enters the lifecycle', () => {
    const hidden = entity(2, 'object', { objectItemId: 'supply_crate' });
    const visible = entity(3, 'mob');
    const hideCollectable: QuestObjectGate = (candidate) => candidate.id === hidden.id;

    expect(entityViewIsAdmitted(hidden, questLog, hideCollectable)).toBe(false);
    expect(entityViewIsAdmitted(visible, questLog, hideCollectable)).toBe(true);
  });

  // A dead mob's corpseTimer (60s by default) is independent of its
  // respawnTimer, which for a self-scheduled rare/elite can run far longer
  // (Grix the Tunnelking: 15 to 30 minutes). Without this, a decayed corpse
  // keeps its view (a rendered, unclickable body) for the whole gap.
  it('drops a decayed corpse even though nothing hides it and it is not quest-gated', () => {
    const alwaysShow: QuestObjectGate = () => false;
    const decayedCorpse = entity(4, 'mob', { dead: true, corpseTimer: 0 });
    const freshCorpse = entity(5, 'mob', { dead: true, corpseTimer: 12 });
    const liveMob = entity(6, 'mob', { dead: false, corpseTimer: 0 });

    expect(entityViewIsAdmitted(decayedCorpse, questLog, alwaysShow)).toBe(false);
    expect(entityViewIsAdmitted(freshCorpse, questLog, alwaysShow)).toBe(true);
    expect(entityViewIsAdmitted(liveMob, questLog, alwaysShow)).toBe(true);
  });

  it('never drops a decayed-looking dead PLAYER: the corpse rule is mob-only', () => {
    const alwaysShow: QuestObjectGate = () => false;
    const deadPlayer = entity(7, 'player', { dead: true, corpseTimer: 0 });
    expect(entityViewIsAdmitted(deadPlayer, questLog, alwaysShow)).toBe(true);
  });
});

describe('entity view retirement drops a decayed corpse even when nearby', () => {
  const player = entity(1, 'player', { targetId: 2 });
  const questLog = new Map<string, QuestProgress>();
  const showAll: QuestObjectGate = () => false;

  it('retires a decayed corpse inside the destroy radius, unlike a fresh one', () => {
    const decayed = entity(5, 'mob', {
      dead: true,
      corpseTimer: 0,
      pos: { x: 1, y: 0, z: 0 },
    });
    const fresh = entity(6, 'mob', { dead: true, corpseTimer: 30, pos: { x: 1, y: 0, z: 0 } });
    expect(entityViewShouldDrop(decayed, player, questLog, showAll, 100)).toBe(true);
    expect(entityViewShouldDrop(fresh, player, questLog, showAll, 100)).toBe(false);
  });
});

describe('view build class', () => {
  it('names the local player before anything else, then the body kind', () => {
    expect(viewBuildClass(entity(7, 'player'), 7, { modularLook: { race: 'human' } })).toBe('self');
    expect(viewBuildClass(entity(8, 'player'), 7, { modularLook: { race: 'human' } })).toBe(
      'composed',
    );
    expect(viewBuildClass(entity(9, 'mob'), 7, { modularLook: null })).toBe('rig');
  });

  it('classes visual-less builds by entity kind', () => {
    expect(viewBuildClass(entity(10, 'object'), 7, null)).toBe('object');
    expect(viewBuildClass(entity(11, 'mob'), 7, null)).toBe('other');
  });
});
