import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { EASTBROOK_LAYOUT } from '../src/sim/eastbrook_layout';
import { createGroundObject } from '../src/sim/entity';
import { ACTIONS, applyAction, encodeObs } from '../src/sim/obs';
import { Sim } from '../src/sim/sim';
import { angleTo, dist2d, type Entity, INTERACT_RANGE, normAngle } from '../src/sim/types';

const SEED = 20_061;
const ABILITY_SLOTS = ACTIONS.length - 13;
const INTERACTABLE_START = 16 + ABILITY_SLOTS * 2 + 9 + 5 * 6;
const EMPTY_INTERACTABLE = [0, 1.5, 0, 0, 0];
const FRIENDLY_QUEST_ID = 'q_nythraxis_scourges_end';

function entityByTemplate(sim: Sim, templateId: string): Entity {
  const entity = [...sim.entities.values()].find(
    (candidate) => candidate.templateId === templateId,
  );
  if (!entity) throw new Error(`missing ${templateId} fixture`);
  return entity;
}

function mobFixtures(sim: Sim, templateId: string, count: number): Entity[] {
  const fixtures = [...sim.entities.values()].filter(
    (candidate) => candidate.kind === 'mob' && candidate.templateId === templateId,
  );
  if (fixtures.length < count) {
    throw new Error(`missing ${count} ${templateId} mob fixtures`);
  }
  return fixtures.slice(0, count);
}

function standAt(sim: Sim, point: { x: number; z: number }): Entity {
  const player = sim.player;
  player.pos = sim.groundPos(point.x, point.z);
  player.prevPos = { ...player.pos };
  player.targetId = null;
  player.facing = 0.37;
  sim.rebucket(player);
  return player;
}

function moveTo(sim: Sim, entity: Entity, point: { x: number; z: number }): void {
  entity.pos = sim.groundPos(point.x, point.z);
  entity.prevPos = { ...entity.pos };
  sim.rebucket(entity);
}

function parkOtherInteractables(sim: Sim, ...kept: Entity[]): void {
  const keptIds = new Set(kept.map((entity) => entity.id));
  for (const entity of sim.entities.values()) {
    if (entity.id === sim.player.id || keptIds.has(entity.id)) continue;
    const potential =
      (entity.kind === 'mob' && entity.lootable) ||
      (entity.kind === 'object' && entity.lootable) ||
      entity.kind === 'npc' ||
      (entity.kind === 'mob' && !entity.hostile && !entity.dead && entity.questIds.length > 0);
    if (potential) moveTo(sim, entity, { x: -100, z: 100 });
  }
}

function interactableObs(sim: Sim): number[] {
  return encodeObs(sim).slice(INTERACTABLE_START, INTERACTABLE_START + 5);
}

function expectAdvertises(sim: Sim, entity: Entity, type: number): void {
  const player = sim.player;
  const distance = dist2d(player.pos, entity.pos);
  const relativeAngle = normAngle(angleTo(player.pos, entity.pos) - player.facing);
  const observed = interactableObs(sim);
  expect(observed[0]).toBe(1);
  expect(observed[1]).toBeCloseTo(distance / 40, 12);
  expect(observed[2]).toBeCloseTo(Math.sin(relativeAngle), 12);
  expect(observed[3]).toBeCloseTo(Math.cos(relativeAngle), 12);
  expect(observed[4]).toBe(type);
}

function makeLootableCorpse(sim: Sim, corpse: Entity, point: { x: number; z: number }): void {
  corpse.dead = true;
  corpse.hp = 0;
  corpse.hostile = true;
  corpse.lootable = true;
  corpse.tappedById = sim.player.id;
  corpse.harvestClaimedBy = sim.player.id;
  corpse.loot = { copper: 17, items: [] };
  moveTo(sim, corpse, point);
}

function makeFriendlyQuestMob(sim: Sim, mob: Entity, point: { x: number; z: number }): void {
  mob.dead = false;
  mob.hp = mob.maxHp;
  mob.hostile = false;
  mob.lootable = false;
  mob.templateId = 'brother_aldric_raid';
  mob.questIds = [FRIENDLY_QUEST_ID];
  moveTo(sim, mob, point);
}

function readyFriendlyQuest(sim: Sim): void {
  sim.questLog.set(FRIENDLY_QUEST_ID, {
    questId: FRIENDLY_QUEST_ID,
    counts: [1],
    state: 'ready',
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  setActiveWorldContent(null);
});

describe('RL interactable observation parity', () => {
  it('advertises and loots the selected corpse through applyAction', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior' });
    const [corpse] = mobFixtures(sim, 'forest_wolf', 1);
    makeLootableCorpse(sim, corpse, { x: 35, z: 2 });
    parkOtherInteractables(sim, corpse);
    standAt(sim, { x: 32, z: 0 });

    expectAdvertises(sim, corpse, 0.33);
    const copperBefore = sim.copper;
    applyAction(sim, ACTIONS.indexOf('interact'));
    expect(sim.copper).toBe(copperBefore + 17);
    expect(corpse.loot).toBeNull();
    expect(corpse.lootable).toBe(false);
  });

  it('advertises and talks to a friendly quest mob through applyAction', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior' });
    const [questMob] = mobFixtures(sim, 'forest_wolf', 1);
    makeFriendlyQuestMob(sim, questMob, { x: 29, z: 3 });
    readyFriendlyQuest(sim);
    parkOtherInteractables(sim, questMob);
    standAt(sim, { x: 32, z: 0 });

    const copperBefore = sim.copper;
    expect(sim.questState(FRIENDLY_QUEST_ID)).toBe('ready');
    expectAdvertises(sim, questMob, 1);
    applyAction(sim, ACTIONS.indexOf('interact'));
    expect(sim.questLog.has(FRIENDLY_QUEST_ID)).toBe(false);
    expect(sim.questsDone.has(FRIENDLY_QUEST_ID)).toBe(true);
    expect(sim.copper).toBe(copperBefore + 25_000);
  });

  it('preserves corpse, object, then quest priority across observation and action', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior' });
    const [corpse, questMob] = mobFixtures(sim, 'forest_wolf', 2);
    makeLootableCorpse(sim, corpse, { x: 36, z: 0 });
    makeFriendlyQuestMob(sim, questMob, { x: 32, z: 1 });
    readyFriendlyQuest(sim);
    const object = createGroundObject(
      sim.nextId++,
      'wolf_fang',
      'Priority Wolf Fang',
      sim.groundPos(34, 0),
    );
    sim.addEntity(object);
    parkOtherInteractables(sim, corpse, object, questMob);
    standAt(sim, { x: 32, z: 0 });

    expectAdvertises(sim, corpse, 0.33);
    applyAction(sim, ACTIONS.indexOf('interact'));
    expect(corpse.lootable).toBe(false);
    expect(object.lootable).toBe(true);
    expect(sim.questState(FRIENDLY_QUEST_ID)).toBe('ready');

    expectAdvertises(sim, object, 0.66);
    applyAction(sim, ACTIONS.indexOf('interact'));
    expect(object.lootable).toBe(false);
    expect(sim.questState(FRIENDLY_QUEST_ID)).toBe('ready');

    expectAdvertises(sim, questMob, 1);
    applyAction(sim, ACTIONS.indexOf('interact'));
    expect(sim.questLog.has(FRIENDLY_QUEST_ID)).toBe(false);
    expect(sim.questsDone.has(FRIENDLY_QUEST_ID)).toBe(true);
  });

  it('uses spatial traversal order for equal-distance object ties across cells', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior' });
    const right = entityByTemplate(sim, 'ground_supply_crate');
    right.templateId = 'ground_wolf_fang';
    right.objectItemId = 'wolf_fang';
    moveTo(sim, right, { x: 33, z: 0 });

    const left = createGroundObject(
      sim.nextId++,
      'wolf_fang',
      'Left Wolf Fang',
      sim.groundPos(31, 0),
    );
    sim.addEntity(left);
    parkOtherInteractables(sim, right, left);
    standAt(sim, { x: 32, z: 0 });

    const insertionOrder = [...sim.entities.keys()];
    expect(insertionOrder.indexOf(right.id)).toBeLessThan(insertionOrder.indexOf(left.id));
    expectAdvertises(sim, left, 0.66);

    sim.drainEvents();
    applyAction(sim, ACTIONS.indexOf('interact'));
    expect(left.lootable).toBe(false);
    expect(right.lootable).toBe(true);
  });

  it('keeps board action, event, and observation bound after an active-world swap', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior' });
    const board = entityByTemplate(sim, 'noticeboard_eastbrook');
    parkOtherInteractables(sim, board);

    setActiveWorldContent({
      ...BUILTIN_WORLD,
      services: { ...BUILTIN_WORLD.services, noticeboards: [] },
    });

    standAt(sim, { x: board.pos.x + 3.5, z: board.pos.z });
    expectAdvertises(sim, board, 0.66);
    sim.drainEvents();
    applyAction(sim, ACTIONS.indexOf('interact'));
    expect(sim.drainEvents()).toEqual([
      {
        type: 'noticeboard',
        noticeboardId: 'noticeboard_eastbrook',
        state: 'empty',
        pid: sim.player.id,
      },
    ]);

    standAt(sim, { x: board.pos.x + 4.5, z: board.pos.z });
    expect(interactableObs(sim)).toEqual(EMPTY_INTERACTABLE);
    sim.drainEvents();
    applyAction(sim, ACTIONS.indexOf('interact'));
    expect(sim.drainEvents()).toEqual([]);
  });

  it('advertises Tinker when the shipped board is 4.5 yards away and Tinker is 4.8', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior' });
    const board = entityByTemplate(sim, 'noticeboard_eastbrook');
    const tinker = entityByTemplate(sim, 'tinker_gizzel');
    const player = standAt(sim, {
      x: 5.667054662450036,
      z: -9.214736474221478,
    });

    expect(board.pos.x).toBe(EASTBROOK_LAYOUT.services.noticeboard.position.x);
    expect(board.pos.z).toBe(EASTBROOK_LAYOUT.services.noticeboard.position.z);
    expect(dist2d(player.pos, board.pos)).toBeCloseTo(4.5, 12);
    expect(dist2d(player.pos, tinker.pos)).toBeCloseTo(4.8, 12);
    expectAdvertises(sim, tinker, 1);

    const talkToNpc = vi.spyOn(sim, 'talkToNpc');
    sim.interact();
    expect(talkToNpc).toHaveBeenCalledWith(tinker.id, player.id);
  });

  it.each([
    [4 - 0.001, true],
    [4, true],
    [4 + 0.001, false],
  ] as const)('uses the board authored radius at distance %s', (distance, advertised) => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior' });
    const board = entityByTemplate(sim, 'noticeboard_eastbrook');
    parkOtherInteractables(sim, board);
    standAt(sim, { x: board.pos.x + distance, z: board.pos.z });

    if (advertised) expectAdvertises(sim, board, 0.66);
    else expect(interactableObs(sim)).toEqual(EMPTY_INTERACTABLE);
  });

  it('keeps a generic lootable object actionable inside its five-yard range', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior' });
    const object = [...sim.entities.values()].find(
      (candidate) => candidate.kind === 'object' && candidate.templateId === 'ground_supply_crate',
    );
    if (!object) throw new Error('missing generic ground-object fixture');
    parkOtherInteractables(sim, object);
    moveTo(sim, object, { x: 0, z: 0 });

    standAt(sim, { x: INTERACT_RANGE - 0.5, z: 0 });
    expectAdvertises(sim, object, 0.66);

    // The proximity selector initializes its best squared distance to 5^2 and
    // replaces it only for a strictly nearer object.
    standAt(sim, { x: INTERACT_RANGE, z: 0 });
    expect(interactableObs(sim)).toEqual(EMPTY_INTERACTABLE);

    standAt(sim, { x: INTERACT_RANGE + 0.001, z: 0 });
    expect(interactableObs(sim)).toEqual(EMPTY_INTERACTABLE);
  });
});
