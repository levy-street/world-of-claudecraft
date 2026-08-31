import { describe, expect, it } from 'vitest';
import { objectDisplayName } from '../src/render/entity_labels';
import {
  IGNIVAR_LORE_OBJECTS,
  IGNIVAR_LORE_QUEST_IDS,
  IGNIVAR_MAELIN_NPC_ID,
  IGNIVAR_MAELIN_PROJECTION_NPC_ID,
  IGNIVAR_RAID_LORE_QUEST_ORDER,
  IGNIVAR_RECORD_IDS,
} from '../src/sim/content/ignivar_raid_lore';
import { DUNGEONS, ITEMS, NPCS, QUESTS } from '../src/sim/data';
import { createGroundObject } from '../src/sim/entity';
import {
  IGNIVAR_CRUCIBLE_WARDEN_ID,
  IGNIVAR_EMBER_SENTINEL_ID,
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_RAID_ARENA_ID,
  IGNIVAR_SECOND_WING_ID,
  VARKHUL_BOSS_ID,
} from '../src/sim/ignivar_raid_ids';
import {
  IGNIVAR_LORE_TEXT_BY_OBJECT_ID,
  IGNIVAR_RAID_NARRATIVE_TEXT_BY_TEMPLATE,
} from '../src/sim/ignivar_raid_lore';
import { enterDungeon, instanceOriginOf } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import { type Entity, IGNIVAR_BOSS_ID } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import { localizeSimAuraName, localizeSimText } from '../src/ui/sim_i18n';
import { worldEntityText } from '../src/ui/world_entity_i18n';

describe('Ignivar raid lore content', () => {
  it('pins the persistent quest, record, and checkpoint identifiers literally', () => {
    expect(IGNIVAR_LORE_QUEST_IDS).toEqual({
      echoesInIron: 'q_ignivar_echoes_in_iron',
      heraldsHeart: 'q_ignivar_heralds_heart',
      forgefather: 'q_ignivar_the_forgefather',
    });
    expect(IGNIVAR_RECORD_IDS).toEqual({
      firstTempering: 'ignivar_record_first_tempering',
      livingMetal: 'ignivar_record_living_metal',
      heraldKey: 'ignivar_record_herald_key',
    });
    expect(IGNIVAR_MAELIN_PROJECTION_NPC_ID).toBe('archivist_maelin_ember_projection');
  });

  it('hands the ordered chain forward from Maelin to her ember projection', () => {
    expect(NPCS[IGNIVAR_MAELIN_NPC_ID]).toMatchObject({
      id: IGNIVAR_MAELIN_NPC_ID,
      name: 'Archivist Maelin Emberward',
      dynamic: true,
      questIds: [IGNIVAR_LORE_QUEST_IDS.echoesInIron],
    });
    expect(NPCS[IGNIVAR_MAELIN_PROJECTION_NPC_ID]).toMatchObject({
      id: IGNIVAR_MAELIN_PROJECTION_NPC_ID,
      name: "Maelin's Ember Projection",
      title: 'Ember Projection',
      dynamic: true,
      questIds: IGNIVAR_RAID_LORE_QUEST_ORDER,
    });

    expect(IGNIVAR_RAID_LORE_QUEST_ORDER).toEqual([
      IGNIVAR_LORE_QUEST_IDS.echoesInIron,
      IGNIVAR_LORE_QUEST_IDS.heraldsHeart,
      IGNIVAR_LORE_QUEST_IDS.forgefather,
    ]);
    expect(QUESTS[IGNIVAR_LORE_QUEST_IDS.echoesInIron]).toMatchObject({
      giverNpcId: IGNIVAR_MAELIN_NPC_ID,
      turnInNpcId: IGNIVAR_MAELIN_PROJECTION_NPC_ID,
    });
    expect(QUESTS[IGNIVAR_LORE_QUEST_IDS.heraldsHeart]).toMatchObject({
      giverNpcId: IGNIVAR_MAELIN_PROJECTION_NPC_ID,
      turnInNpcId: IGNIVAR_MAELIN_PROJECTION_NPC_ID,
      requiresQuest: IGNIVAR_LORE_QUEST_IDS.echoesInIron,
    });
    expect(QUESTS[IGNIVAR_LORE_QUEST_IDS.forgefather]).toMatchObject({
      giverNpcId: IGNIVAR_MAELIN_PROJECTION_NPC_ID,
      turnInNpcId: IGNIVAR_MAELIN_PROJECTION_NPC_ID,
      requiresQuest: IGNIVAR_LORE_QUEST_IDS.heraldsHeart,
    });

    for (const questId of IGNIVAR_RAID_LORE_QUEST_ORDER) {
      expect(QUESTS[questId]).toMatchObject({
        shareable: false,
        minLevel: 20,
        suggestedPlayers: 10,
        xpReward: 0,
        copperReward: 0,
        itemRewards: {},
      });
    }
  });

  it('uses three forward combat chapters with no required object interaction', () => {
    expect(QUESTS[IGNIVAR_LORE_QUEST_IDS.echoesInIron]).toMatchObject({
      rev: 1,
      objectives: [
        { type: 'kill', targetMobId: IGNIVAR_EMBER_SENTINEL_ID, count: 2 },
        { type: 'kill', targetMobId: IGNIVAR_CRUCIBLE_WARDEN_ID, count: 2 },
      ],
    });
    expect(QUESTS[IGNIVAR_LORE_QUEST_IDS.heraldsHeart]).toMatchObject({
      rev: 1,
      objectives: [{ type: 'kill', targetMobId: IGNIVAR_BOSS_ID, count: 1 }],
    });
    expect(QUESTS[IGNIVAR_LORE_QUEST_IDS.forgefather].objectives).toEqual([
      expect.objectContaining({ type: 'kill', targetMobId: VARKHUL_BOSS_ID, count: 1 }),
    ]);
    for (const questId of IGNIVAR_RAID_LORE_QUEST_ORDER) {
      expect(QUESTS[questId].objectives.every((objective) => objective.type === 'kill')).toBe(true);
    }
    expect(Object.keys(IGNIVAR_LORE_OBJECTS)).toEqual(Object.values(IGNIVAR_RECORD_IDS));
  });

  it('places one real archivist at the entrance and projections at every forward checkpoint', () => {
    expect(DUNGEONS[IGNIVAR_FORGE_APPROACH_ID].npcs).toEqual([
      { npcId: IGNIVAR_MAELIN_NPC_ID, x: 0, z: -47 },
      { npcId: IGNIVAR_MAELIN_PROJECTION_NPC_ID, x: 0, z: 48 },
      // The sigil-redemption vendor beside the entrance (content/ignivar_loot.ts).
      { npcId: 'crucible_quartermaster', x: 6, z: -47 },
    ]);
    expect(DUNGEONS[IGNIVAR_RAID_ARENA_ID].npcs).toEqual([
      { npcId: IGNIVAR_MAELIN_PROJECTION_NPC_ID, x: 10, z: 24, facing: Math.PI },
    ]);
    expect(DUNGEONS[IGNIVAR_SECOND_WING_ID].npcs).toEqual([
      { npcId: IGNIVAR_MAELIN_PROJECTION_NPC_ID, x: 14, z: 31 },
    ]);
  });

  it('seats the arena projection between the north pillars facing south', () => {
    const sim = new Sim({ seed: 96, playerClass: 'warrior', devCommands: true });
    expect(enterDungeon(sim.ctx, IGNIVAR_RAID_ARENA_ID, sim.player.id, true)).toBe(true);
    const instance = sim.instances.find((entry) => entry.dungeonId === IGNIVAR_RAID_ARENA_ID);
    if (!instance) throw new Error('Ignivar arena did not claim an instance');
    const origin = instanceOriginOf(instance);
    const projection = instance.npcIds
      .map((id) => sim.entities.get(id))
      .find((entity): entity is Entity => entity?.templateId === IGNIVAR_MAELIN_PROJECTION_NPC_ID);
    if (!projection) throw new Error('Maelin projection did not spawn in the arena');
    // Facing south (Math.PI = -z) between the north pillar row.
    expect(projection.pos.x - origin.x).toBeCloseTo(10, 3);
    expect(projection.pos.z - origin.z).toBeCloseTo(24, 3);
    expect(projection.facing).toBe(Math.PI);
  });

  it('keeps records readable as optional lore without granting quest credit', () => {
    const sim = new Sim({ seed: 91, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Archivist');
    const player = sim.entities.get(pid) as Entity;
    player.pos = { x: 20, y: terrainHeight(20, 20, sim.cfg.seed), z: 20 };
    player.prevPos = { ...player.pos };
    sim.rebucket(player);

    const quest = QUESTS[IGNIVAR_LORE_QUEST_IDS.echoesInIron];
    const progress = {
      questId: quest.id,
      counts: quest.objectives.map(() => 0),
      state: 'active' as const,
      rev: quest.rev,
    };
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('Test player was not registered');
    meta.questLog.set(quest.id, progress);
    const record = createGroundObject(
      sim.nextId++,
      IGNIVAR_RECORD_IDS.firstTempering,
      IGNIVAR_LORE_OBJECTS[IGNIVAR_RECORD_IDS.firstTempering].name,
      { x: 20, y: terrainHeight(20, 21, sim.cfg.seed), z: 21 },
    );
    sim.addEntity(record);
    sim.events = [];

    expect(sim.pickUpObject(record.id, pid)).toBe(true);
    expect(progress.counts).toEqual([0, 0]);
    expect(record.lootable).toBe(true);
    expect(sim.events).toContainEqual(
      expect.objectContaining({
        type: 'log',
        text: IGNIVAR_LORE_TEXT_BY_OBJECT_ID[IGNIVAR_RECORD_IDS.firstTempering],
      }),
    );
    expect(
      sim.events.some(
        (event: { type: string; questId?: string }) =>
          event.type === 'questProgress' && event.questId === quest.id,
      ),
    ).toBe(false);
  });

  it('localizes all three optional lore nameplates without making them items', () => {
    const sim = new Sim({ seed: 92, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Reader');
    const player = sim.entities.get(pid) as Entity;
    player.pos = { x: 30, y: terrainHeight(30, 30, sim.cfg.seed), z: 30 };
    player.prevPos = { ...player.pos };
    sim.rebucket(player);

    for (const [objectId, descriptor] of Object.entries(IGNIVAR_LORE_OBJECTS)) {
      expect(ITEMS[objectId], `${objectId} must not require inventory icon art`).toBeUndefined();
      const object = createGroundObject(sim.nextId++, objectId, descriptor.name, {
        x: 30,
        y: terrainHeight(30, 31, sim.cfg.seed),
        z: 31,
      });
      sim.addEntity(object);

      expect(objectDisplayName(object), objectId).toBe(descriptor.name);
      expect(localizeSimText(descriptor.name), objectId).toBe(descriptor.name);
      expect(sim.pickUpObject(object.id, pid), objectId).toBe(true);
      expect(sim.countItem(objectId, pid), `${objectId} entered inventory`).toBe(0);
      expect(sim.entities.get(object.id), `${objectId} was consumed`).toBe(object);
    }
  });

  it('reveals each automaton memory only when the final construct of that type dies', () => {
    const sim = new Sim({ seed: 93, playerClass: 'warrior', devCommands: true });
    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, sim.player.id, true)).toBe(true);
    const instance = sim.instances.find((entry) => entry.dungeonId === IGNIVAR_FORGE_APPROACH_ID);
    if (!instance) throw new Error('Ignivar approach did not claim an instance');

    for (const templateId of [IGNIVAR_EMBER_SENTINEL_ID, IGNIVAR_CRUCIBLE_WARDEN_ID] as const) {
      const mobs = instance.mobIds
        .map((id) => sim.entities.get(id))
        .filter((entity): entity is Entity => entity?.templateId === templateId);
      // The memory reveal is keyed on the LAST construct of a type dying, so drive
      // it off the actual pack count rather than a fixed pair.
      expect(mobs.length).toBeGreaterThanOrEqual(2);
      sim.events = [];

      // Every kill before the last of its type is silent.
      for (let index = 0; index < mobs.length - 1; index++) {
        sim.ctx.handleDeath(mobs[index], sim.player);
        expect(
          sim.events.some(
            (event: { type: string; text?: string }) =>
              event.type === 'log' &&
              event.text === IGNIVAR_RAID_NARRATIVE_TEXT_BY_TEMPLATE[templateId],
          ),
        ).toBe(false);
      }

      sim.ctx.handleDeath(mobs[mobs.length - 1], sim.player);
      expect(
        sim.events.filter(
          (event: { type: string; text?: string }) =>
            event.type === 'log' &&
            event.text === IGNIVAR_RAID_NARRATIVE_TEXT_BY_TEMPLATE[templateId],
        ),
      ).toHaveLength(1);
    }
  });

  it('completes the Herald chapter from Ignivar death with no core interaction', () => {
    const sim = new Sim({ seed: 94, playerClass: 'warrior', devCommands: true });
    expect(enterDungeon(sim.ctx, IGNIVAR_RAID_ARENA_ID, sim.player.id, true)).toBe(true);
    const instance = sim.instances.find((entry) => entry.dungeonId === IGNIVAR_RAID_ARENA_ID);
    if (!instance) throw new Error('Ignivar arena did not claim an instance');
    expect(
      instance.objectIds
        .map((id) => sim.entities.get(id))
        .some((entity) => entity?.objectItemId === 'ignivar_herald_core'),
    ).toBe(false);
    const boss = instance.mobIds
      .map((id) => sim.entities.get(id))
      .find((entity): entity is Entity => entity?.templateId === IGNIVAR_BOSS_ID);
    if (!boss) throw new Error('Ignivar did not spawn');

    const quest = QUESTS[IGNIVAR_LORE_QUEST_IDS.heraldsHeart];
    const progress = {
      questId: quest.id,
      counts: [0],
      state: 'active' as const,
      rev: quest.rev,
    };
    const meta = sim.players.get(sim.player.id);
    if (!meta) throw new Error('Test player was not registered');
    meta.questLog.set(quest.id, progress);
    sim.player.pos = { ...boss.pos };
    sim.player.prevPos = { ...boss.pos };
    sim.rebucket(sim.player);
    boss.tappedById = sim.player.id;
    sim.events = [];

    sim.ctx.handleDeath(boss, sim.player);

    expect(progress.counts).toEqual([1]);
    expect(progress.state).toBe('ready');
    expect(sim.events).toContainEqual(
      expect.objectContaining({
        type: 'log',
        text: IGNIVAR_RAID_NARRATIVE_TEXT_BY_TEMPLATE[IGNIVAR_BOSS_ID],
      }),
    );
  });

  it('completes the Forgefather chapter and closes the story when Varkhul dies', () => {
    const sim = new Sim({ seed: 95, playerClass: 'warrior', devCommands: true });
    expect(enterDungeon(sim.ctx, IGNIVAR_SECOND_WING_ID, sim.player.id, true)).toBe(true);
    const instance = sim.instances.find((entry) => entry.dungeonId === IGNIVAR_SECOND_WING_ID);
    if (!instance) throw new Error('Inner Crucible did not claim an instance');
    const boss = instance.mobIds
      .map((id) => sim.entities.get(id))
      .find((entity): entity is Entity => entity?.templateId === VARKHUL_BOSS_ID);
    if (!boss) throw new Error('Varkhul did not spawn');

    const quest = QUESTS[IGNIVAR_LORE_QUEST_IDS.forgefather];
    const progress = {
      questId: quest.id,
      counts: [0],
      state: 'active' as const,
      rev: quest.rev,
    };
    const meta = sim.players.get(sim.player.id);
    if (!meta) throw new Error('Test player was not registered');
    meta.questLog.set(quest.id, progress);
    sim.player.pos = { ...boss.pos };
    sim.player.prevPos = { ...boss.pos };
    sim.rebucket(sim.player);
    boss.tappedById = sim.player.id;
    sim.events = [];

    sim.ctx.handleDeath(boss, sim.player);

    expect(progress.counts).toEqual([1]);
    expect(progress.state).toBe('ready');
    expect(sim.events).toContainEqual(
      expect.objectContaining({
        type: 'log',
        text: IGNIVAR_RAID_NARRATIVE_TEXT_BY_TEMPLATE[VARKHUL_BOSS_ID],
      }),
    );
  });

  it('registers every lore line and new entity in the English localization sources', () => {
    for (const text of [
      ...Object.values(IGNIVAR_LORE_TEXT_BY_OBJECT_ID),
      ...Object.values(IGNIVAR_RAID_NARRATIVE_TEXT_BY_TEMPLATE),
    ]) {
      expect(localizeSimText(text), text).not.toBeNull();
    }
    expect(localizeSimText('The forge gate is sealed to you.')).not.toBeNull();
    for (const mechanic of [
      "Maker's Brand",
      'Cinder Orbs',
      'Red-hot Metal',
      'Red-hot Metal Barrier',
      'Forgestorm',
      "Anvil's Decree",
      "The Master's Assembly",
      'Crucible Guard',
      'Masterpiece Unbound',
      'Living Forge',
    ]) {
      expect(localizeSimAuraName(mechanic), mechanic).not.toBeNull();
    }

    expect(worldEntityText.en.entities.npcs[IGNIVAR_MAELIN_NPC_ID].name).toBe(
      'Archivist Maelin Emberward',
    );
    expect(worldEntityText.en.entities.npcs[IGNIVAR_MAELIN_PROJECTION_NPC_ID].name).toBe(
      "Maelin's Ember Projection",
    );
    expect(worldEntityText.en.entities.quests[IGNIVAR_LORE_QUEST_IDS.echoesInIron].title).toBe(
      'Echoes in Iron',
    );
    expect(worldEntityText.en.entities.mobs.varkhul_forgefather_of_the_last_flame.name).toBe(
      'Varkhul, Forgefather of the Last Flame',
    );
  });
});
