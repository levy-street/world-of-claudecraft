import { describe, expect, it, vi } from 'vitest';
import { objectDisplayName } from '../src/render/entity_labels';
import {
  IGNIVAR_HERALD_CORE_OBJECT_ID,
  IGNIVAR_LORE_OBJECTS,
  IGNIVAR_LORE_QUEST_IDS,
  IGNIVAR_MAELIN_NPC_ID,
  IGNIVAR_RAID_LORE_QUEST_ORDER,
  IGNIVAR_RECORD_IDS,
} from '../src/sim/content/ignivar_raid_lore';
import { ITEMS, MOBS, NPCS, QUESTS } from '../src/sim/data';
import { createGroundObject, createMob } from '../src/sim/entity';
import { IGNIVAR_RAID_ARENA_ID } from '../src/sim/ignivar_raid_ids';
import {
  IGNIVAR_CORE_SHIELDED_TEXT,
  IGNIVAR_LORE_TEXT_BY_OBJECT_ID,
  interactIgnivarRaidLore,
} from '../src/sim/ignivar_raid_lore';
import { enterDungeon } from '../src/sim/instances/dungeons';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { type Entity, IGNIVAR_BOSS_ID } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import { localizeSimAuraName, localizeSimText } from '../src/ui/sim_i18n';
import { worldEntityText } from '../src/ui/world_entity_i18n';

describe('Ignivar raid lore content', () => {
  it('pins the persistent quest and record identifiers literally', () => {
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
    expect(IGNIVAR_HERALD_CORE_OBJECT_ID).toBe('ignivar_herald_core');
  });

  it('keeps the ordered chain on one dynamic, non-overworld archivist', () => {
    const maelin = NPCS[IGNIVAR_MAELIN_NPC_ID];
    expect(maelin).toMatchObject({
      id: IGNIVAR_MAELIN_NPC_ID,
      name: 'Archivist Maelin Emberward',
      dynamic: true,
      questIds: IGNIVAR_RAID_LORE_QUEST_ORDER,
    });

    expect(IGNIVAR_RAID_LORE_QUEST_ORDER).toEqual([
      IGNIVAR_LORE_QUEST_IDS.echoesInIron,
      IGNIVAR_LORE_QUEST_IDS.heraldsHeart,
      IGNIVAR_LORE_QUEST_IDS.forgefather,
    ]);
    expect(QUESTS[IGNIVAR_LORE_QUEST_IDS.echoesInIron].requiresQuest).toBeUndefined();
    expect(QUESTS[IGNIVAR_LORE_QUEST_IDS.heraldsHeart].requiresQuest).toBe(
      IGNIVAR_LORE_QUEST_IDS.echoesInIron,
    );
    expect(QUESTS[IGNIVAR_LORE_QUEST_IDS.forgefather].requiresQuest).toBe(
      IGNIVAR_LORE_QUEST_IDS.heraldsHeart,
    );

    for (const questId of IGNIVAR_RAID_LORE_QUEST_ORDER) {
      expect(QUESTS[questId]).toMatchObject({
        giverNpcId: IGNIVAR_MAELIN_NPC_ID,
        turnInNpcId: IGNIVAR_MAELIN_NPC_ID,
        shareable: false,
        minLevel: 20,
        suggestedPlayers: 10,
        xpReward: 0,
        copperReward: 0,
        itemRewards: {},
      });
    }
  });

  it('requires all three records, all three automata, Ignivar and Varkhul in order', () => {
    expect(QUESTS[IGNIVAR_LORE_QUEST_IDS.echoesInIron].objectives).toEqual([
      expect.objectContaining({
        type: 'interact',
        targetObjectItemId: IGNIVAR_RECORD_IDS.firstTempering,
      }),
      expect.objectContaining({
        type: 'interact',
        targetObjectItemId: IGNIVAR_RECORD_IDS.livingMetal,
      }),
      expect.objectContaining({
        type: 'interact',
        targetObjectItemId: IGNIVAR_RECORD_IDS.heraldKey,
      }),
      expect.objectContaining({ type: 'kill', targetMobId: 'ignivar_ember_sentinel' }),
      expect.objectContaining({ type: 'kill', targetMobId: 'ignivar_crucible_warden' }),
      expect.objectContaining({ type: 'kill', targetMobId: 'ignivar_cinder_artificer' }),
    ]);
    expect(QUESTS[IGNIVAR_LORE_QUEST_IDS.heraldsHeart].objectives).toEqual([
      expect.objectContaining({ type: 'kill', targetMobId: IGNIVAR_BOSS_ID }),
      expect.objectContaining({
        type: 'interact',
        targetObjectItemId: IGNIVAR_HERALD_CORE_OBJECT_ID,
      }),
    ]);
    expect(QUESTS[IGNIVAR_LORE_QUEST_IDS.forgefather].objectives).toEqual([
      expect.objectContaining({
        type: 'kill',
        targetMobId: 'varkhul_forgefather_of_the_last_flame',
      }),
    ]);
    expect(Object.keys(IGNIVAR_LORE_OBJECTS)).toEqual([
      ...Object.values(IGNIVAR_RECORD_IDS),
      IGNIVAR_HERALD_CORE_OBJECT_ID,
    ]);
  });

  it('emits lore before the generic quest-object path grants record credit', () => {
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
    expect(progress.counts[0]).toBe(1);
    expect(record.lootable).toBe(true);

    const loreIndex = sim.events.findIndex(
      (event: { type: string; text?: string }) =>
        event.type === 'log' &&
        event.text === IGNIVAR_LORE_TEXT_BY_OBJECT_ID[IGNIVAR_RECORD_IDS.firstTempering],
    );
    const creditIndex = sim.events.findIndex(
      (event: { type: string; questId?: string }) =>
        event.type === 'questProgress' && event.questId === quest.id,
    );
    expect(loreIndex).toBeGreaterThanOrEqual(0);
    expect(creditIndex).toBeGreaterThan(loreIndex);
  });

  it('localizes all four lore nameplates without making the interactOnly props items', () => {
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

  it("refuses the core and its quest credit while this claim's Ignivar is alive", () => {
    const core = createGroundObject(10, IGNIVAR_HERALD_CORE_OBJECT_ID, 'Core', {
      x: 100,
      y: 0,
      z: 10,
    });
    const boss = createMob(11, MOBS[IGNIVAR_BOSS_ID], 20, { x: 100, y: 0, z: 0 });
    const emit = vi.fn();
    const error = vi.fn();
    const ctx = {
      entities: new Map([
        [core.id, core],
        [boss.id, boss],
      ]),
      emit,
      error,
      instanceClaimIdAt: () => 7,
    } as unknown as SimContext;

    expect(interactIgnivarRaidLore(ctx, core, { entityId: 5 } as PlayerMeta)).toEqual({
      handled: true,
      allowQuestCredit: false,
    });
    expect(error).toHaveBeenCalledWith(5, IGNIVAR_CORE_SHIELDED_TEXT);
    expect(emit).not.toHaveBeenCalled();

    boss.dead = true;
    expect(interactIgnivarRaidLore(ctx, core, { entityId: 5 } as PlayerMeta)).toEqual({
      handled: true,
      allowQuestCredit: true,
    });
    expect(emit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'log',
        text: IGNIVAR_LORE_TEXT_BY_OBJECT_ID[IGNIVAR_HERALD_CORE_OBJECT_ID],
        pid: 5,
      }),
    );
  });

  it('gates Herald Core credit through the real dungeon interaction path', () => {
    const sim = new Sim({ seed: 93, playerClass: 'warrior', devCommands: true });
    expect(enterDungeon(sim.ctx, IGNIVAR_RAID_ARENA_ID, sim.player.id, true)).toBe(true);
    const instance = sim.instances.find((entry) => entry.dungeonId === IGNIVAR_RAID_ARENA_ID);
    if (!instance) throw new Error('Ignivar arena did not claim an instance');
    const core = instance.objectIds
      .map((id) => sim.entities.get(id))
      .find((entity) => entity?.objectItemId === IGNIVAR_HERALD_CORE_OBJECT_ID);
    const boss = instance.mobIds
      .map((id) => sim.entities.get(id))
      .find((entity) => entity?.templateId === IGNIVAR_BOSS_ID);
    if (!core || !boss) throw new Error('Ignivar arena lore fixtures did not spawn');
    const quest = QUESTS[IGNIVAR_LORE_QUEST_IDS.heraldsHeart];
    const progress = {
      questId: quest.id,
      counts: quest.objectives.map(() => 0),
      state: 'active' as const,
    };
    const meta = sim.players.get(sim.player.id);
    if (!meta) throw new Error('Test player was not registered');
    meta.questLog.set(quest.id, progress);
    sim.player.pos = { ...core.pos };
    sim.player.prevPos = { ...core.pos };
    sim.rebucket(sim.player);

    expect(sim.pickUpObject(core.id, sim.player.id)).toBe(true);
    expect(progress.counts[1]).toBe(0);

    boss.dead = true;
    expect(sim.pickUpObject(core.id, sim.player.id)).toBe(true);
    expect(progress.counts[1]).toBe(1);
  });

  it('registers every lore line and new entity in the English localization sources', () => {
    for (const text of Object.values(IGNIVAR_LORE_TEXT_BY_OBJECT_ID)) {
      expect(localizeSimText(text), text).not.toBeNull();
    }
    expect(localizeSimText(IGNIVAR_CORE_SHIELDED_TEXT)).not.toBeNull();
    expect(localizeSimText('The forge gate is sealed to you.')).not.toBeNull();
    for (const mechanic of [
      "Maker's Brand",
      'Living Blueprint',
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
    expect(worldEntityText.en.entities.quests[IGNIVAR_LORE_QUEST_IDS.echoesInIron].title).toBe(
      'Echoes in Iron',
    );
    expect(worldEntityText.en.entities.mobs.varkhul_forgefather_of_the_last_flame.name).toBe(
      'Varkhul, Forgefather of the Last Flame',
    );
  });
});
