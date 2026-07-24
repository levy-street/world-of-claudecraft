import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { generateProceduralItem } from '../src/sim/loot/procedural';
import type { ProceduralRarity } from '../src/sim/procedural_item';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity, ItemInstancePayload, LootSlot, SimEvent } from '../src/sim/types';

const BASE_ID = 'gravecaller_ring';

function exactInstance(
  uidNumber: number,
  rarity: Extract<ProceduralRarity, 'common' | 'magic' | 'rare' | 'epic'>,
): ItemInstancePayload {
  return generateProceduralItem({
    seed: 50_000 + uidNumber,
    uid: `pi1:transport:${uidNumber}`,
    context: {
      source: 'dungeon',
      sourceEntityId: 9000,
      sourceSpawnSequence: 3,
      lootSlotIndex: uidNumber % 100,
    },
    basePoolId: 'initial_dungeon_boss',
    rarityTableId: 'initial_dungeon_boss',
    sourceItemLevel: 20,
    forcedBaseId: BASE_ID,
    forcedRarity: rarity,
  }).instance;
}

function makePlayers(count: 1 | 2 | 3 = 1) {
  const sim = new Sim({ seed: 2121, playerClass: 'warrior', noPlayer: true });
  const ids = [
    sim.addPlayer('warrior', 'Aster'),
    ...(count >= 2 ? [sim.addPlayer('mage', 'Briar')] : []),
    ...(count >= 3 ? [sim.addPlayer('rogue', 'Cinder')] : []),
  ];
  if (ids.length > 1) {
    for (const pid of ids.slice(1)) {
      sim.partyInvite(pid, ids[0]);
      sim.partyAccept(pid);
    }
  }
  for (const pid of ids) {
    const player = sim.entities.get(pid);
    if (!player) throw new Error(`missing player entity ${pid}`);
    player.pos = { x: 0, y: 0, z: 0 };
    player.prevPos = { ...player.pos };
  }
  return { sim, ids };
}

function corpse(sim: Sim, tapper: number, recipients: number[], items: LootSlot[]): Entity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, { x: 0, y: 0, z: 2 });
  mob.dead = true;
  mob.lootable = true;
  mob.tappedById = tapper;
  mob.lootRecipientIds = recipients;
  mob.loot = { copper: 0, items };
  sim.entities.set(mob.id, mob);
  return mob;
}

function meta(sim: Sim, pid: number): PlayerMeta {
  const value = sim.ctx.players.get(pid);
  if (!value) throw new Error(`missing player ${pid}`);
  return value;
}

function heldInstance(sim: Sim, pid: number, uid: string): ItemInstancePayload | undefined {
  return meta(sim, pid).inventory.find((slot) => slot.instance?.procedural?.uid === uid)?.instance;
}

function eventOf<T extends SimEvent['type']>(sim: Sim, type: T): Extract<SimEvent, { type: T }> {
  const event = sim.events.find((candidate) => candidate.type === type);
  if (!event) throw new Error(`expected ${type} event`);
  return event as Extract<SimEvent, { type: T }>;
}

describe('procedural loot exact-instance transport', () => {
  it('preserves the instance through a direct shared corpse pickup', () => {
    const {
      sim,
      ids: [a],
    } = makePlayers();
    const instance = exactInstance(1001, 'rare');
    const uid = instance.procedural?.uid;
    if (!uid) throw new Error('missing fixture UID');
    const mob = corpse(sim, a, [a], [{ itemId: BASE_ID, count: 1, instance }]);

    expect(sim.lootCorpse(mob.id, a)).toBe(true);
    expect(heldInstance(sim, a, uid)).toEqual(instance);
    expect(heldInstance(sim, a, uid)).not.toBe(instance);
  });

  it('preserves the instance through an open-to-all corpse pickup', () => {
    const {
      sim,
      ids: [a],
    } = makePlayers();
    const instance = exactInstance(1002, 'magic');
    const uid = instance.procedural?.uid;
    if (!uid) throw new Error('missing fixture UID');
    const mob = corpse(
      sim,
      999_999,
      [],
      [{ itemId: BASE_ID, count: 1, instance, openToAll: true }],
    );

    expect(sim.lootCorpse(mob.id, a)).toBe(true);
    expect(heldInstance(sim, a, uid)).toEqual(instance);
  });

  it('preserves the instance through personal corpse loot', () => {
    const {
      sim,
      ids: [a],
    } = makePlayers();
    const instance = exactInstance(1003, 'epic');
    const uid = instance.procedural?.uid;
    if (!uid) throw new Error('missing fixture UID');
    const mob = corpse(
      sim,
      999_999,
      [],
      [{ itemId: BASE_ID, count: 1, instance, personalFor: [a] }],
    );

    expect(sim.lootCorpse(mob.id, a)).toBe(true);
    expect(heldInstance(sim, a, uid)).toEqual(instance);
  });

  it('preserves a Common instance through round-robin', () => {
    const {
      sim,
      ids: [a, b],
    } = makePlayers(2);
    const instance = exactInstance(1004, 'common');
    const uid = instance.procedural?.uid;
    if (!uid) throw new Error('missing fixture UID');
    const mob = corpse(sim, a, [a, b], [{ itemId: BASE_ID, count: 1, instance }]);

    expect(sim.lootCorpse(mob.id, a)).toBe(true);
    expect([heldInstance(sim, a, uid), heldInstance(sim, b, uid)].filter(Boolean)).toHaveLength(1);
  });

  it('uses rolled rarity for need/greed and gives clients only the public rolled view', () => {
    const {
      sim,
      ids: [a, b],
    } = makePlayers(2);
    const instance = exactInstance(1005, 'rare');
    const uid = instance.procedural?.uid;
    if (!uid) throw new Error('missing fixture UID');
    const mob = corpse(sim, a, [a, b], [{ itemId: BASE_ID, count: 1, instance }]);
    sim.events.length = 0;

    expect(sim.lootCorpse(mob.id, a)).toBe(true);
    const prompt = eventOf(sim, 'lootRoll');
    expect(prompt.quality).toBe('rare');
    expect(prompt.instance?.procedural?.rarity).toBe('rare');
    expect(prompt.instance?.procedural).not.toHaveProperty('uid');
    expect(prompt.instance?.procedural).not.toHaveProperty('seed');
    expect(sim.activeLootRolls(a)[0].instance).toEqual(prompt.instance);

    sim.submitLootRoll(prompt.rollId, 'need', a);
    sim.submitLootRoll(prompt.rollId, 'pass', b);
    expect(heldInstance(sim, a, uid)).toEqual(instance);
    expect(heldInstance(sim, b, uid)).toBeUndefined();
  });

  it('returns the same instance to the corpse when everyone passes', () => {
    const {
      sim,
      ids: [a, b],
    } = makePlayers(2);
    const instance = exactInstance(1006, 'magic');
    const uid = instance.procedural?.uid;
    if (!uid) throw new Error('missing fixture UID');
    const mob = corpse(sim, a, [a, b], [{ itemId: BASE_ID, count: 1, instance }]);
    sim.events.length = 0;

    sim.lootCorpse(mob.id, a);
    const rollId = eventOf(sim, 'lootRoll').rollId;
    sim.submitLootRoll(rollId, 'pass', a);
    sim.submitLootRoll(rollId, 'pass', b);

    const returned = mob.loot?.items.find((slot) => slot.instance?.procedural?.uid === uid);
    expect(returned).toMatchObject({ itemId: BASE_ID, count: 1, openToAll: true });
    expect(returned?.instance).toEqual(instance);
    expect(sim.lootCorpse(mob.id, b)).toBe(true);
    expect(heldInstance(sim, b, uid)).toEqual(instance);
  });

  it('uses rolled rarity for master-loot threshold and preserves the assigned copy', () => {
    const {
      sim,
      ids: [a, b],
    } = makePlayers(2);
    const instance = exactInstance(1007, 'rare');
    const uid = instance.procedural?.uid;
    if (!uid) throw new Error('missing fixture UID');
    const mob = corpse(sim, a, [a, b], [{ itemId: BASE_ID, count: 1, instance }]);
    sim.setPartyLootMaster(true, 0, 'rare', a);
    sim.events.length = 0;

    sim.lootCorpse(mob.id, a);
    const prompt = eventOf(sim, 'masterLoot');
    expect(prompt.quality).toBe('rare');
    expect(prompt.instance?.procedural?.rarity).toBe('rare');
    sim.assignMasterLoot(prompt.rollId, [b], a);

    expect(heldInstance(sim, b, uid)).toEqual(instance);
    expect(heldInstance(sim, a, uid)).toBeUndefined();
  });

  it('rejects a corrupt procedural personal slot shared by multiple recipients', () => {
    const {
      sim,
      ids: [a, b],
    } = makePlayers(2);
    const instance = exactInstance(1008, 'rare');
    const mob = corpse(
      sim,
      999_999,
      [],
      [{ itemId: BASE_ID, count: 1, instance, personalFor: [a, b] }],
    );

    expect(() => sim.lootCorpse(mob.id, a)).toThrow(
      'A procedural personal-loot slot must have exactly one recipient',
    );
    expect(meta(sim, a).inventory.some((slot) => slot.instance?.procedural)).toBe(false);
    expect(meta(sim, b).inventory.some((slot) => slot.instance?.procedural)).toBe(false);
  });
});
