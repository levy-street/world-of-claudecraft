import { describe, expect, it } from 'vitest';
import { bagCapacity } from '../src/sim/bags';
import { BUILTIN_WORLD } from '../src/sim/data';
import type { MaterialSourceTransferSelection } from '../src/sim/material_source_transfer_selection';
import {
  canonicalMaterialComposition,
  type MaterialComposition,
  type MaterialSource,
  materialSourceKey,
} from '../src/sim/material_sources';
import { captureMaterialStackSelection } from '../src/sim/material_stack_selection';
import { Sim } from '../src/sim/sim';
import type { Entity, InvSlot, WorldContent } from '../src/sim/types';

const ORE = 'copper_ore';
const OTHER_ORE = 'iron_ore';
const GUILD_ID = 71;
const BANKER_ID = 'bursar_fernando';

const ANA: MaterialSource = { gatherer: { kind: 'character', id: 11, name: 'Ana' } };
const BRU: MaterialSource = { gatherer: { kind: 'character', id: 22, name: 'Bru' } };
const UNRECORDED: MaterialSource = {};
const ANA_KEY = materialSourceKey(ANA);
const BRU_KEY = materialSourceKey(BRU);
const UNRECORDED_KEY = materialSourceKey(UNRECORDED);

const STORAGE_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: { [BANKER_ID]: BUILTIN_WORLD.npcs[BANKER_ID] },
  groundObjects: [],
};

type Storage = 'personal bank' | 'guild bank' | 'vault';
type Direction = 'deposit' | 'withdraw';

function composition(
  rows: readonly { source: MaterialSource; count: number }[],
): MaterialComposition {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const built = canonicalMaterialComposition(rows, total);
  if (!built.ok) throw new Error(`invalid test composition: ${built.error}`);
  return built.value;
}

function mixedStack(): InvSlot {
  return {
    itemId: ORE,
    count: 6,
    materialSources: composition([
      { source: ANA, count: 3 },
      { source: BRU, count: 2 },
      { source: UNRECORDED, count: 1 },
    ]),
  };
}

function metaOf(sim: Sim) {
  const meta = sim.meta(sim.playerId);
  if (!meta) throw new Error('missing player meta');
  return meta;
}

function guildBookOf(sim: Sim) {
  const book = sim.guildBanks.get(GUILD_ID);
  if (!book) throw new Error('missing guild bank');
  return book;
}

function atBanker(storage: Storage): Sim {
  const sim = new Sim({
    seed: 73,
    playerClass: 'warrior',
    autoEquip: false,
    world: STORAGE_WORLD,
  });
  const banker = [...sim.entities.values()].find(
    (entity): entity is Entity => entity.kind === 'npc' && entity.templateId === BANKER_ID,
  );
  if (!banker) throw new Error('banker did not spawn');
  sim.player.pos = { ...banker.pos };
  sim.player.prevPos = { ...banker.pos };
  sim.rebucket(sim.player);
  const meta = metaOf(sim);
  meta.inventory = [];
  meta.vault.upgrades = 1;
  if (storage === 'guild bank') {
    sim.setPlayerGuildMembership(sim.playerId, { guildId: GUILD_ID, rank: 'officer' });
    sim.loadGuildBank(GUILD_ID, { treasury: 0, inventory: [], purchasedSlots: 24 });
  }
  return sim;
}

function bucketCounts(slots: readonly InvSlot[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const slot of slots) {
    if (slot.itemId !== ORE) continue;
    for (const entry of slot.materialSources ?? []) {
      const key = materialSourceKey(entry.source);
      out[key] = (out[key] ?? 0) + entry.count;
    }
  }
  return out;
}

function total(slots: readonly InvSlot[]): number {
  return slots.filter((slot) => slot.itemId === ORE).reduce((sum, slot) => sum + slot.count, 0);
}

interface Rig {
  readonly storage: Storage;
  readonly direction: Direction;
  readonly sim: Sim;
  readonly source: () => InvSlot[];
  readonly destination: () => InvSlot[];
  readonly run: (count: number | undefined, selection: MaterialSourceTransferSelection) => void;
}

function rigFor(storage: Storage, direction: Direction): Rig {
  const sim = atBanker(storage);
  const meta = metaOf(sim);
  const source = mixedStack();
  if (direction === 'deposit') meta.inventory = [source];
  else if (storage === 'personal bank') meta.bank.inventory = [source];
  else if (storage === 'guild bank') guildBookOf(sim).inventory = [source];
  else meta.vault.special = [source];

  const sourceSlots = (): InvSlot[] => {
    if (direction === 'deposit') return meta.inventory;
    if (storage === 'personal bank') return meta.bank.inventory;
    if (storage === 'guild bank') return guildBookOf(sim).inventory;
    return meta.vault.special;
  };
  const destinationSlots = (): InvSlot[] => {
    if (direction === 'withdraw') return meta.inventory;
    if (storage === 'personal bank') return meta.bank.inventory;
    if (storage === 'guild bank') return guildBookOf(sim).inventory;
    return meta.vault.special;
  };
  const run = (count: number | undefined, selection: MaterialSourceTransferSelection): void => {
    if (storage === 'personal bank') {
      if (direction === 'deposit') sim.bankDeposit(0, count, selection, sim.playerId);
      else sim.bankWithdraw(0, count, selection, sim.playerId);
      return;
    }
    if (storage === 'guild bank') {
      if (direction === 'deposit') sim.guildBankDepositFor(sim.playerId, 0, count, selection);
      else sim.guildBankWithdrawFor(sim.playerId, 0, count, selection);
      return;
    }
    if (direction === 'deposit') sim.vaultDeposit(0, count, selection, sim.playerId);
    else sim.vaultWithdraw(ORE, count, { index: 0, selection }, sim.playerId);
  };
  return { storage, direction, sim, source: sourceSlots, destination: destinationSlots, run };
}

function selectBru(rig: Rig): MaterialSourceTransferSelection {
  const slots = rig.source();
  const target = captureMaterialStackSelection(slots, ORE, 0);
  if (!target) throw new Error('failed to capture source stack');
  const sourceIndex = slots[0].materialSources?.findIndex(
    (entry) => materialSourceKey(entry.source) === BRU_KEY,
  );
  if (sourceIndex === undefined || sourceIndex < 0) throw new Error('missing Bru source');
  return { itemId: ORE, target, quantities: [{ sourceIndex, count: 2 }] };
}

function stateOf(rig: Rig): string {
  return JSON.stringify({ source: rig.source(), destination: rig.destination() });
}

const CASES = [
  ['personal bank', 'deposit'],
  ['personal bank', 'withdraw'],
  ['guild bank', 'deposit'],
  ['guild bank', 'withdraw'],
  ['vault', 'deposit'],
  ['vault', 'withdraw'],
] as const satisfies readonly (readonly [Storage, Direction])[];

describe.each(CASES)('%s %s material source selection', (storage, direction) => {
  it.each([
    { label: 'omitted count', count: undefined },
    { label: 'explicit count', count: 2 },
  ])('moves only the selected descriptor with $label', ({ count }) => {
    const rig = rigFor(storage, direction);
    rig.run(count, selectBru(rig));

    expect(bucketCounts(rig.source())).toEqual({ [UNRECORDED_KEY]: 1, [ANA_KEY]: 3 });
    expect(bucketCounts(rig.destination())).toEqual({ [BRU_KEY]: 2 });
    expect(total(rig.source())).toBe(4);
    expect(total(rig.destination())).toBe(2);
    expect(total(rig.source()) + total(rig.destination())).toBe(6);
  });

  it.each(['composition change', 'source reorder', 'same-item row shift'] as const)(
    'refuses a stale same-item stack after a %s',
    (mutation) => {
      const rig = rigFor(storage, direction);
      const selection = selectBru(rig);
      const slot = rig.source()[0];
      if (mutation === 'composition change') {
        slot.materialSources = composition([
          { source: ANA, count: 2 },
          { source: BRU, count: 3 },
          { source: UNRECORDED, count: 1 },
        ]);
      } else if (mutation === 'source reorder') {
        slot.materialSources = [...(slot.materialSources ?? [])].reverse();
      } else {
        rig.source().unshift(mixedStack());
      }
      const before = stateOf(rig);

      rig.run(undefined, selection);

      expect(stateOf(rig)).toBe(before);
    },
  );

  it('refuses the full selected quantity when destination capacity is short', () => {
    const rig = rigFor(storage, direction);
    const selection = selectBru(rig);
    const meta = metaOf(rig.sim);
    if (direction === 'withdraw') {
      meta.inventory = Array.from({ length: bagCapacity(meta.bags) }, () => ({
        itemId: OTHER_ORE,
        count: 20,
      }));
    } else if (storage === 'personal bank') {
      const capacity = rig.sim.bankInfoFor(rig.sim.playerId)?.capacity;
      if (capacity === undefined) throw new Error('missing personal-bank info');
      meta.bank.inventory = Array.from({ length: capacity }, () => ({
        itemId: OTHER_ORE,
        count: 20,
      }));
    } else if (storage === 'guild bank') {
      guildBookOf(rig.sim).inventory = Array.from({ length: 24 }, () => ({
        itemId: OTHER_ORE,
        count: 20,
      }));
    } else {
      meta.vault.stock[ORE] = 39;
    }
    const before = JSON.stringify({
      inventory: meta.inventory,
      bank: meta.bank.inventory,
      guild: storage === 'guild bank' ? guildBookOf(rig.sim).inventory : null,
      vault: meta.vault,
    });

    rig.run(2, selection);

    expect(
      JSON.stringify({
        inventory: meta.inventory,
        bank: meta.bank.inventory,
        guild: storage === 'guild bank' ? guildBookOf(rig.sim).inventory : null,
        vault: meta.vault,
      }),
    ).toBe(before);
  });
});
