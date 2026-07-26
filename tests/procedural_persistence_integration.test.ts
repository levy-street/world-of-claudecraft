import { describe, expect, it } from 'vitest';
import { sanitizeBankState } from '../src/sim/bank';
import { generateProceduralItem } from '../src/sim/loot/procedural';
import { cloneProceduralPayload } from '../src/sim/procedural_item';
import { type CharacterState, Sim } from '../src/sim/sim';
import type { InvSlot, ItemInstancePayload } from '../src/sim/types';

const BASE_ID = 'gravecaller_ring';
const UID = 'pi1:persist:7001';

type InspectableSim = Sim & {
  players: Map<number, { inventory: InvSlot[] }>;
};

function generated(uid = UID, seed = 701): ItemInstancePayload {
  return generateProceduralItem({
    seed,
    uid,
    context: {
      source: 'dungeon',
      sourceEntityId: 40,
      sourceSpawnSequence: 2,
      lootSlotIndex: 0,
    },
    basePoolId: 'initial_dungeon_boss',
    rarityTableId: 'initial_dungeon_boss',
    sourceItemLevel: 20,
    forcedBaseId: BASE_ID,
    forcedRarity: 'magic',
  }).instance;
}
function raidForgedGenerated(uid = 'pi1:persist:7002', seed = 702): ItemInstancePayload {
  const instance = generateProceduralItem({
    seed,
    uid,
    context: {
      source: 'raid',
      sourceEntityId: 41,
      sourceSpawnSequence: 3,
      lootSlotIndex: 0,
      sourceTemplateId: 'nythraxis_scourge_of_thornpeak',
      sourceTags: ['raid', 'heroic', 'boss'],
    },
    basePoolId: 'nythraxis_raid',
    rarityTableId: 'nythraxis_raid_heroic',
    sourceItemLevel: 22,
    forcedBaseId: BASE_ID,
    forcedRarity: 'legendary',
    forcedItemLevel: 36,
    forcedLegendaryPowerId: 'dawnward_signet',
    personalLootClass: 'paladin',
    legendaryMagnitudeFloor: 0.5,
    raidForgedLegendary: true,
  }).instance;
  if (!instance.procedural) throw new Error('missing Raid-forged fixture');
  instance.procedural.reforgeCount = 7;
  return instance;
}

function freshState(): CharacterState {
  const sim = new Sim({ seed: 90, playerClass: 'mage', noPlayer: true });
  const pid = sim.addPlayer('mage', 'Persist');
  const state = sim.serializeCharacter(pid);
  if (!state) throw new Error('failed to create state');
  return structuredClone(state);
}

function load(state: CharacterState): InspectableSim {
  const sim = new Sim({ seed: 90, playerClass: 'mage', noPlayer: true }) as InspectableSim;
  sim.addPlayer('mage', 'Persist', { state });
  return sim;
}

describe('procedural persistence boundaries', () => {
  it('reconstructs a valid bank instance without aliasing the persisted object', () => {
    const source = generated();
    const bank = sanitizeBankState({
      inventory: [{ itemId: BASE_ID, count: 1, instance: source }],
      purchasedSlots: 0,
      bonusSlots: 0,
    });
    const hydrated = bank.inventory[0].instance;

    expect(hydrated).toEqual(source);
    expect(hydrated).not.toBe(source);
    expect(hydrated?.procedural).not.toBe(source.procedural);
    expect(hydrated?.procedural?.affixes[0]).not.toBe(source.procedural?.affixes[0]);
  });

  it('round-trips Raid-forged metadata while leaving an older procedural copy unchanged', () => {
    const state = freshState();
    const legacy = generated('pi1:persist:7003', 703);
    const ascendant = raidForgedGenerated();
    state.inventory.push(
      { itemId: BASE_ID, count: 1, instance: legacy },
      { itemId: BASE_ID, count: 1, instance: ascendant },
    );

    const sim = load(state);
    const meta = [...sim.players.values()][0];
    const loadedLegacy = meta.inventory.find(
      (slot) => slot.instance?.procedural?.uid === 'pi1:persist:7003',
    )?.instance?.procedural;
    const loadedAscendant = meta.inventory.find(
      (slot) => slot.instance?.procedural?.uid === 'pi1:persist:7002',
    )?.instance?.procedural;

    expect(loadedLegacy).toEqual(legacy.procedural);
    expect(loadedLegacy?.raidForged).toBeUndefined();
    expect(loadedLegacy?.reforgeCount).toBeUndefined();
    expect(loadedAscendant).toEqual(ascendant.procedural);
    expect(loadedAscendant).toMatchObject({
      raidForged: true,
      reforgeCount: 7,
      legendaryPowerId: 'dawnward_signet',
      itemLevel: 36,
    });
  });

  it('rejects a corrupt procedural payload in carried inventory', () => {
    const state = freshState();
    const bad = structuredClone(generated());
    if (!bad.procedural) throw new Error('missing procedural fixture');
    bad.procedural.seed = 0;
    state.inventory.push({ itemId: BASE_ID, count: 1, instance: bad });

    expect(() => load(state)).toThrow('Invalid persisted item instance at inventory');
  });

  it('rejects a procedural base/container mismatch in the bank', () => {
    expect(() =>
      sanitizeBankState({
        inventory: [
          {
            itemId: 'iron_broadsword',
            count: 1,
            instance: generated(),
          },
        ],
      }),
    ).toThrow('procedural base does not match container item id');
  });

  it('rejects duplicate UIDs across inventory and bank during load', () => {
    const state = freshState();
    const first = generated();
    state.inventory.push({ itemId: BASE_ID, count: 1, instance: first });
    state.bank = {
      inventory: [
        {
          itemId: BASE_ID,
          count: 1,
          instance: cloneProceduralPayload(first),
        },
      ],
      purchasedSlots: 0,
      bonusSlots: 0,
    };

    expect(() => load(state)).toThrow(`Duplicate procedural item UID in character state: ${UID}`);
  });

  it('rejects duplicate UIDs across equipment and inventory during load', () => {
    const state = freshState();
    const first = generated();
    state.equipment.ring1 = BASE_ID;
    state.equipmentInstance = { ring1: first };
    state.inventory.push({
      itemId: BASE_ID,
      count: 1,
      instance: cloneProceduralPayload(first),
    });

    expect(() => load(state)).toThrow(`Duplicate procedural item UID in character state: ${UID}`);
  });

  it('rejects a duplicate UID at the authoritative grant hub', () => {
    const sim = new Sim({
      seed: 90,
      playerClass: 'mage',
      noPlayer: true,
    }) as InspectableSim;
    const pid = sim.addPlayer('mage', 'Persist');
    const first = generated();
    sim.addItemInstance(BASE_ID, first, pid);

    expect(() => sim.addItemInstance(BASE_ID, cloneProceduralPayload(first), pid)).toThrow(
      `Duplicate procedural item UID at grant: ${UID}`,
    );
    const meta = sim.players.get(pid);
    expect(meta?.inventory.filter((slot) => slot.instance?.procedural?.uid === UID)).toHaveLength(
      1,
    );
  });

  it('rejects a multi-count grant because every procedural copy needs a UID', () => {
    const sim = new Sim({ seed: 90, playerClass: 'mage', noPlayer: true });
    const pid = sim.addPlayer('mage', 'Persist');
    expect(() => sim.addItemInstance(BASE_ID, generated(), pid, 2)).toThrow(
      'exactly one unique copy',
    );
  });

  it('checks UID uniqueness again at the save boundary', () => {
    const sim = new Sim({
      seed: 90,
      playerClass: 'mage',
      noPlayer: true,
    }) as InspectableSim;
    const pid = sim.addPlayer('mage', 'Persist');
    const first = generated();
    sim.addItemInstance(BASE_ID, first, pid);
    const meta = sim.players.get(pid);
    if (!meta) throw new Error('missing player');
    meta.inventory.push({
      itemId: BASE_ID,
      count: 1,
      instance: cloneProceduralPayload(first),
    });

    expect(() => sim.serializeCharacter(pid)).toThrow(
      `Duplicate procedural item UID in character state: ${UID}`,
    );
  });
});
