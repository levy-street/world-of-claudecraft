import { describe, expect, it, vi } from 'vitest';
import { addVaultRewardToCharacterState } from '../server/vault_reward_state';
import { LANTERN_SEAL_ITEM_ID } from '../src/sim/content/guild_contracts';
import { BUILTIN_WORLD } from '../src/sim/data';
import { guildContractsForWeek, onKillForGuildContracts } from '../src/sim/guild_contracts';
import {
  absorbLegacyLanternSealSlots,
  creditLanternSeals,
  spendLanternSeals,
} from '../src/sim/lantern_seals';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { expectDefined } from './helpers/defined';

const SEAL = LANTERN_SEAL_ITEM_ID;
const MAX = Number.MAX_SAFE_INTEGER;
function rig() {
  const sim = new Sim({
    seed: 31,
    playerClass: 'warrior',
    world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
  });
  const pid = sim.player.id;
  const meta = expectDefined(sim.meta(pid));
  return { sim, pid, meta };
}

describe('Lantern Seals conserve credits and legacy carriers at the scalar limit', () => {
  it.each([
    [MAX, 1],
    [0, MAX + 1],
    [0, Number.POSITIVE_INFINITY],
  ])('refuses balance %s plus amount %s without mutation', (balance, amount) => {
    const holder = { lanternSeals: balance };
    expect(() => creditLanternSeals(holder, amount)).toThrow(/overflow/);
    expect(holder.lanternSeals).toBe(balance);
  });

  it('credits an exact fit and refuses the next unit', () => {
    const holder = { lanternSeals: MAX - 3 };
    creditLanternSeals(holder, 3);
    expect(holder.lanternSeals).toBe(MAX);
    expect(() => creditLanternSeals(holder, 1)).toThrow(/overflow/);
    expect(holder.lanternSeals).toBe(MAX);
  });

  it('preflights the entire bag and bank fold before removing any stack', () => {
    const holder = {
      lanternSeals: MAX - 2,
      inventory: [{ itemId: SEAL, count: 2 }],
      bank: { inventory: [{ itemId: SEAL, count: 1 }] },
    };
    const before = structuredClone(holder);
    expect(() => absorbLegacyLanternSealSlots(holder)).toThrow(/overflow/);
    expect(holder).toEqual(before);
  });

  it('folds bag and bank stock exactly at the maximum once, then round trips', () => {
    const { sim, pid } = rig();
    const state = expectDefined(sim.serializeCharacter(pid));
    state.lanternSeals = MAX - 3;
    state.inventory = [{ itemId: SEAL, count: 2 }];
    state.bank = { ...expectDefined(state.bank), inventory: [{ itemId: SEAL, count: 1 }] };
    const loaded = rig().sim;
    const loadedPid = loaded.addPlayer('warrior', 'Migrated', { state });
    const saved = expectDefined(loaded.serializeCharacter(loadedPid));
    expect(saved.lanternSeals).toBe(MAX);
    expect(saved.inventory).toEqual([]);
    expect(saved.bank?.inventory).toEqual([]);
    const again = rig().sim;
    const againPid = again.addPlayer('warrior', 'Migrated', { state: saved });
    expect(expectDefined(again.meta(againPid)).lanternSeals).toBe(MAX);
  });

  it('rejects a hub grant before discovery, receipt or saved state changes', () => {
    const { sim, pid, meta } = rig();
    meta.lanternSeals = MAX;
    const before = sim.serializeCharacter(pid);
    sim.drainEvents();
    expect(() => sim.addItem(SEAL, 1, pid)).toThrow(/overflow/);
    expect(sim.serializeCharacter(pid)).toEqual(before);
    expect(sim.drainEvents()).toEqual([]);
  });

  it('refuses a contract before marking it paid and preserves eligibility after saving', () => {
    const { sim, pid, meta } = rig();
    const week = 'wk_0';
    sim.resetDay = '2026-09-01';
    const contract = expectDefined(guildContractsForWeek(week).find((c) => c.kind === 'boss'));
    const boss = { id: 999_999, kind: 'mob', templateId: contract.mobId } as Entity;
    meta.guildContracts = { week, done: [], lifetime: 0 };
    meta.lanternSeals = MAX;
    const grant = vi.fn();
    const before = sim.serializeCharacter(pid);
    sim.drainEvents();
    expect(() =>
      onKillForGuildContracts(sim.ctx, boss, false, [meta], [], [], grant),
    ).not.toThrow();
    expect(sim.serializeCharacter(pid)).toEqual(before);
    expect(sim.drainEvents()).toEqual([]);
    expect(grant).not.toHaveBeenCalled();

    const restored = rig().sim;
    restored.resetDay = '2026-09-01';
    const restoredPid = restored.addPlayer('warrior', 'Eligible', {
      state: expectDefined(before),
    });
    const restoredMeta = expectDefined(restored.meta(restoredPid));
    expect(spendLanternSeals(restoredMeta, contract.seals)).toBe(true);
    restored.drainEvents();
    onKillForGuildContracts(restored.ctx, boss, false, [restoredMeta], [], [], grant);
    expect(restoredMeta.lanternSeals).toBe(MAX);
    expect(restoredMeta.guildContracts?.done).toContain(contract.id);
    expect(restoredMeta.guildContracts?.lifetime).toBe(1);
    expect(restored.drainEvents()).toContainEqual(
      expect.objectContaining({ type: 'guildContractDone', contractId: contract.id }),
    );
    onKillForGuildContracts(restored.ctx, boss, false, [restoredMeta], [], [], grant);
    expect(restoredMeta.guildContracts?.lifetime).toBe(1);
  });

  it('preflights a whole offline parcel before its items or coin mutate', () => {
    const { sim, pid } = rig();
    const state = expectDefined(sim.serializeCharacter(pid));
    state.lanternSeals = MAX - 1;
    const before = structuredClone(state);
    expect(() =>
      addVaultRewardToCharacterState(state, {
        characterId: 7,
        recipientName: 'Synthetic',
        items: [
          { itemId: 'thorium_ore', count: 3 },
          { itemId: SEAL, count: 1 },
          { itemId: SEAL, count: 1 },
        ],
        copper: 42,
        mailDueAt: '2026-10-19T00:00:00Z',
      }),
    ).toThrow(/overflow/);
    expect(state).toEqual(before);
  });

  it('retains an overflowing mail parcel, including prior items, coin and read state', () => {
    const source = rig();
    // Reuse the existing test mail hook to exercise a persisted seal attachment.
    source.sim.postOffice.mailHeroicMarks(source.pid, SEAL, 1);
    const book = source.sim.serializeMail();
    const parcel = expectDefined(book.mail.find((m) => m.items.some((s) => s.itemId === SEAL)));
    parcel.items.unshift({ itemId: 'thorium_ore', count: 4 });
    parcel.items.push({ itemId: SEAL, count: 1 });
    parcel.copper = 42;
    const { sim, pid, meta } = rig();
    sim.postOffice.loadMail(book);
    for (let i = 0; i < 20 * 120; i++) sim.tick();
    const box = expectDefined(sim.entities.get(sim.postOffice.mailboxIds[0]));
    sim.player.pos = { ...box.pos };
    sim.player.prevPos = { ...box.pos };
    sim.rebucket(sim.player);
    meta.lanternSeals = MAX - 1;
    const letter = expectDefined(
      sim.mailInfoFor(pid)?.messages.find((m) => m.items.some((s) => s.itemId === SEAL)),
    );
    const beforeLetter = structuredClone(letter);
    const before = sim.serializeCharacter(pid);
    expect(sim.player.dead).toBe(false);
    expect(letter.items.filter((s) => s.itemId === SEAL).map((s) => s.count)).toEqual([1, 1]);
    sim.drainEvents();
    expect(() => sim.mailTake(letter.id, pid)).toThrow(/overflow/);
    expect(sim.mailInfoFor(pid)?.messages.find((m) => m.id === letter.id)).toEqual(beforeLetter);
    expect(sim.serializeCharacter(pid)).toEqual(before);
    expect(sim.drainEvents()).toEqual([]);

    expect(spendLanternSeals(meta, 1)).toBe(true);
    sim.mailTake(letter.id, pid);
    expect(meta.lanternSeals).toBe(MAX);
    expect(sim.countItem('thorium_ore', pid)).toBe(4);
    expect(meta.copper).toBe(expectDefined(before).copper + 42);
    expect(sim.mailInfoFor(pid)?.messages.find((m) => m.id === letter.id)?.items).toEqual([]);
  });
});
