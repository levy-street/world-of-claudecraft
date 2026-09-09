// Load-boundary pins for the bind-on-pickup party trade window
// (ItemInstancePayload.partyTrade) through the REAL persistence path:
// serializeCharacter -> addPlayer({ state }) -> serializeCharacter. A
// hand-edited or migration-corrupt marker must never crash a character load
// (the clone that runs before the sanitizer has to be total), must drop
// ATOMICALLY (never a partial `{ untilMs }` residue riding every autosave),
// and a legacy or rollback-written marker on a WORN payload is stripped at
// load through the same shared helper the equip bridge uses, so a later
// unequip can never resurrect the window. Pure marker semantics:
// tests/bop_trade_window.test.ts; the sanitizer's own arms:
// tests/item_instance_load.test.ts; the live trade path:
// tests/bop_party_trade.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type CharacterState, Sim } from '../src/sim/sim';
import type { ItemInstancePayload } from '../src/sim/types';
import { expectDefined } from './helpers/defined';
import { EMPTY_TEST_WORLD } from './sim_shared';

const HELM = 'slagbreaker_helmet'; // soulbound epic helmet (a real equippable id)
const VALID_UNTIL_MS = 7_200_000;

function makeSim() {
  return new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true, world: EMPTY_TEST_WORLD });
}

/** A real serialized character to graft malformed container rows onto. */
function baseState(): CharacterState {
  const sim = makeSim();
  const pid = sim.addPlayer('warrior', 'Loader');
  return expectDefined(sim.serializeCharacter(pid));
}

/** The exact shape that crashed Sim.addPlayer: `eligible` is not iterable, so
 *  the pre-sanitizer deep clone threw before validation could drop it. */
function malformedMarkerPayload(): ItemInstancePayload {
  return {
    partyTrade: { untilMs: VALID_UNTIL_MS, eligible: 5 },
  } as unknown as ItemInstancePayload;
}

function validMarkerPayload(): ItemInstancePayload {
  return {
    partyTrade: {
      untilMs: VALID_UNTIL_MS,
      eligible: ['Alice', 'Bob'],
      eligibleIds: [11, 22],
    },
  };
}

function loadState(state: CharacterState): { sim: Sim; pid: number } {
  const sim = makeSim();
  const pid = sim.addPlayer('warrior', 'Loader', { state });
  return { sim, pid };
}

function loadAndResave(state: CharacterState): CharacterState {
  const { sim, pid } = loadState(state);
  return expectDefined(sim.serializeCharacter(pid));
}

beforeEach(() => {
  // The junk drops below legitimately fire the one aggregated dev-channel
  // warn per load (warnDroppedInstanceKeys); keep the test output quiet.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

/** Every persisted character container that can carry an instance payload,
 *  each with its own graft point (the load-to-save coverage the fix owes). */
const PAYLOAD_CONTAINERS: ReadonlyArray<{
  name: string;
  inject: (state: CharacterState, instance: ItemInstancePayload) => void;
}> = [
  {
    name: 'bags (inventory)',
    inject: (state, instance) => {
      state.inventory.push({ itemId: HELM, count: 1, instance });
    },
  },
  {
    name: 'equipment (equipmentInstance)',
    inject: (state, instance) => {
      state.equipment.helmet = HELM;
      state.equipmentInstance = { ...(state.equipmentInstance ?? {}), helmet: instance };
    },
  },
  {
    name: 'vendor buyback',
    inject: (state, instance) => {
      state.vendorBuyback = [...(state.vendorBuyback ?? []), { itemId: HELM, count: 1, instance }];
    },
  },
  {
    name: 'bank inventory',
    inject: (state, instance) => {
      const bank = expectDefined(state.bank);
      bank.inventory = [...bank.inventory, { itemId: HELM, count: 1, instance }];
    },
  },
  {
    name: 'materials vault special slots',
    inject: (state, instance) => {
      const vault = expectDefined(state.vault);
      vault.special = [...(vault.special ?? []), { itemId: HELM, count: 1, instance }];
    },
  },
];

describe('malformed persisted partyTrade never crashes character load (every container)', () => {
  for (const { name, inject } of PAYLOAD_CONTAINERS) {
    it(`a non-iterable eligible list in ${name} loads without throwing and saves clean`, () => {
      const state = baseState();
      inject(state, malformedMarkerPayload());
      const saved = loadAndResave(state);
      const json = JSON.stringify(saved);
      expect(json).not.toContain('partyTrade');
      expect(json).not.toContain('untilMs');
    });
  }

  it('the bag item itself survives the marker drop (drop the junk, never the item)', () => {
    const state = baseState();
    state.inventory.push({ itemId: HELM, count: 1, instance: malformedMarkerPayload() });
    const saved = loadAndResave(state);
    const slot = expectDefined(saved.inventory.find((s) => s.itemId === HELM));
    expect(slot.count).toBe(1);
    expect(slot.instance).toBeUndefined();
  });

  it('a sibling payload field outlives the dropped marker (every junk key drops alone)', () => {
    const state = baseState();
    state.inventory.push({
      itemId: HELM,
      count: 1,
      instance: { signer: 'Ana', ...malformedMarkerPayload() },
    });
    const saved = loadAndResave(state);
    const slot = expectDefined(saved.inventory.find((s) => s.itemId === HELM));
    expect(slot.instance).toEqual({ signer: 'Ana' });
  });

  it('a marker missing its eligible list drops whole: no { untilMs } residue survives', () => {
    const state = baseState();
    state.inventory.push({
      itemId: HELM,
      count: 1,
      instance: { partyTrade: { untilMs: VALID_UNTIL_MS } } as unknown as ItemInstancePayload,
    });
    const saved = loadAndResave(state);
    const json = JSON.stringify(saved);
    expect(json).not.toContain('partyTrade');
    expect(json).not.toContain('untilMs');
  });

  it('an oversized eligible list drops the whole marker, never a partial residue', () => {
    const state = baseState();
    state.inventory.push({
      itemId: HELM,
      count: 1,
      instance: {
        partyTrade: {
          untilMs: VALID_UNTIL_MS,
          eligible: Array.from({ length: 200 }, (_, i) => `Bogus${i}`.padEnd(30, 'y')),
        },
      },
    });
    const saved = loadAndResave(state);
    const json = JSON.stringify(saved);
    expect(json).not.toContain('partyTrade');
    expect(json).not.toContain('untilMs');
  });

  it('a legal window in bags round-trips intact (the drop arms never over-reach)', () => {
    const state = baseState();
    const instance = validMarkerPayload();
    state.inventory.push({ itemId: HELM, count: 1, instance });
    const saved = loadAndResave(state);
    const slot = expectDefined(saved.inventory.find((s) => s.itemId === HELM));
    expect(slot.instance?.partyTrade).toEqual(instance.partyTrade);
  });
});

describe('a legacy equipped partyTrade marker is stripped at load (worn payloads never carry it)', () => {
  it('strips the marker but keeps the rest of the worn payload, and unequip returns a window-free copy', () => {
    const state = baseState();
    state.equipment.helmet = HELM;
    state.equipmentInstance = { helmet: { signer: 'Ana', ...validMarkerPayload() } };
    const { sim, pid } = loadState(state);
    const meta = expectDefined(sim.meta(pid));
    expect(meta.equipmentInstance.helmet).toEqual({ signer: 'Ana' });

    sim.unequipItem('helmet', pid);
    const benched = expectDefined(meta.inventory.find((s) => s.itemId === HELM));
    expect(benched.instance?.partyTrade).toBeUndefined();
    expect(benched.instance?.signer).toBe('Ana');
  });

  it('a marker-only worn payload strips to no payload at all (an empty {} would strand the row)', () => {
    const state = baseState();
    state.equipment.helmet = HELM;
    state.equipmentInstance = { helmet: validMarkerPayload() };
    const { sim, pid } = loadState(state);
    const meta = expectDefined(sim.meta(pid));
    expect(meta.equipmentInstance.helmet).toBeUndefined();

    sim.unequipItem('helmet', pid);
    const benched = expectDefined(meta.inventory.find((s) => s.itemId === HELM));
    expect(benched.instance).toBeUndefined();
  });
});
