import { describe, expect, it, vi } from 'vitest';
import { addVaultRewardToCharacterState } from '../server/vault_reward_state';
import { bagPools } from '../src/sim/bags';
import {
  BANK_MAX_BONUS_SLOTS,
  BANK_PURCHASED_SLOTS_MAX,
  bankPools,
  emptyBankState,
} from '../src/sim/bank';
import { openTreasureCasket } from '../src/sim/clue_casket';
import { HEROIC_MARK_CURRENCY_ID } from '../src/sim/content/dungeon_difficulty';
import { BUILTIN_WORLD, ITEMS } from '../src/sim/data';
import { openEmissaryCache } from '../src/sim/emissary_cache';
import { absorbLegacyHeroicMarkSlots, creditHeroicMarks } from '../src/sim/heroic_marks';
import { grantHoardReward } from '../src/sim/rift/hoard_reward_grant';
import { Sim } from '../src/sim/sim';
import { expectDefined } from './helpers/defined';

const MARK = HEROIC_MARK_CURRENCY_ID;
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

describe('Heroic Marks reject overflowing credits without losing their carriers', () => {
  it.each([
    [MAX, 1],
    [0, MAX + 1],
  ])('refuses balance %s plus amount %s before credit', (balance, amount) => {
    const holder = { heroicMarks: balance };
    expect(() => creditHeroicMarks(holder, amount)).toThrow(/overflow/);
    expect(holder.heroicMarks).toBe(balance);
  });

  it('preflights all legacy slots before removing any bag or bank stock', () => {
    const holder = {
      heroicMarks: MAX - 2,
      inventory: [{ itemId: MARK, count: 2 }],
      bank: { inventory: [{ itemId: MARK, count: 1 }] },
    };
    const before = structuredClone(holder);
    expect(() => absorbLegacyHeroicMarkSlots(holder)).toThrow(/overflow/);
    expect(holder).toEqual(before);
  });

  it('rejects a direct hub credit before receipts or discovery changes', () => {
    const { sim, pid, meta } = rig();
    meta.heroicMarks = MAX;
    const before = sim.serializeCharacter(pid);
    sim.drainEvents();
    expect(() => sim.addItem(MARK, 1, pid)).toThrow(/overflow/);
    expect(sim.serializeCharacter(pid)).toEqual(before);
    expect(sim.drainEvents()).toEqual([]);
  });

  it.each(['cache', 'casket'] as const)(
    'keeps the %s and every payout unchanged before overflowing',
    (kind) => {
      const { sim, pid, meta } = rig();
      const itemId = kind === 'cache' ? 'emissary_cache' : 'treasure_casket';
      sim.addItem(itemId, 1, pid);
      meta.heroicMarks = MAX;
      const before = sim.serializeCharacter(pid);
      const consume = vi.fn(() => undefined);
      sim.drainEvents();
      expect(() =>
        kind === 'cache'
          ? openEmissaryCache(sim.ctx, meta, consume)
          : openTreasureCasket(sim.ctx, meta, sim.player, consume),
      ).toThrow(/overflow/);
      expect(consume).not.toHaveBeenCalled();
      expect(sim.serializeCharacter(pid)).toEqual(before);
      expect(sim.drainEvents()).toEqual([]);
    },
  );

  it('defers overflowing earned hoard marks while preserving the rest of the parcel', () => {
    const { sim, pid, meta } = rig();
    meta.heroicMarks = MAX - 1;
    const copper = meta.copper;
    sim.drainEvents();
    expect(
      grantHoardReward(
        sim.ctx,
        pid,
        'rare',
        {
          items: [
            { itemId: 'thorium_ore', count: 3 },
            { itemId: MARK, count: 2 },
          ],
          copper: 42,
          capped: false,
        },
        false,
      ),
    ).toBe(true);
    expect(meta.heroicMarks).toBe(MAX - 1);
    expect(sim.countItem('thorium_ore', pid)).toBe(3);
    expect(meta.copper).toBe(copper + 42);
    // Guest payout caps were removed; overflow still preserves the earned parcel.
    expect(meta.vaultGuestPayouts).toBe(0);
    expect(meta.clueCasketsOpened).toBe(1);
    expect(
      sim.serializeMail().mail.find((m) => m.letterId === 'heroic_marks_reward')?.items,
    ).toEqual([{ itemId: MARK, count: 2 }]);
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({ type: 'treasureVaultLooted' }),
    );
  });

  it('preflights the sum of offline claim credits before any state mutation', () => {
    const { sim, pid } = rig();
    const state = expectDefined(sim.serializeCharacter(pid));
    state.heroicMarks = MAX - 1;
    const before = structuredClone(state);
    expect(() =>
      addVaultRewardToCharacterState(state, {
        characterId: 7,
        recipientName: 'Synthetic',
        items: [
          { itemId: 'thorium_ore', count: 3 },
          { itemId: MARK, count: 1 },
          { itemId: MARK, count: 1 },
        ],
        copper: 42,
        mailDueAt: '2026-10-19T00:00:00Z',
      }),
    ).toThrow(/overflow/);
    expect(state).toEqual(before);
  });

  it('retains the entire mail parcel, coin and read state on overflowing take', () => {
    const { sim, pid, meta } = rig();
    sim.postOffice.mailHeroicMarks(pid, MARK, 3);
    const book = sim.postOffice.serializeMail();
    const parcel = expectDefined(
      book.mail.find((m) => m.items.some((slot) => slot.itemId === MARK)),
    );
    parcel.items.unshift({ itemId: 'thorium_ore', count: 4 });
    parcel.copper = 42;
    sim.postOffice.loadMail(book);
    for (let i = 0; i < 20 * 120; i++) sim.tick();
    const box = expectDefined(sim.entities.get(sim.postOffice.mailboxIds[0]));
    sim.player.pos = { ...box.pos };
    sim.player.prevPos = { ...box.pos };
    sim.rebucket(sim.player);
    meta.heroicMarks = MAX;
    const letter = expectDefined(
      sim.mailInfoFor(pid)?.messages.find((m) => m.items.some((s) => s.itemId === MARK)),
    );
    const beforeLetter = structuredClone(letter);
    const before = sim.serializeCharacter(pid);
    sim.drainEvents();
    expect(() => sim.mailTake(letter.id, pid)).toThrow(/overflow/);
    expect(sim.mailInfoFor(pid)?.messages.find((m) => m.id === letter.id)).toEqual(beforeLetter);
    expect(sim.serializeCharacter(pid)).toEqual(before);
    expect(sim.drainEvents()).toEqual([]);
  });
});

describe('Heroic Marks preserve supported large balances', () => {
  it.each([2 ** 31, MAX])(
    'folds maximum legal bag/bank occupancy exactly once at balance %s',
    (balance) => {
      const { sim, pid } = rig();
      const state = expectDefined(sim.serializeCharacter(pid));
      const largestGeneralBag = Object.values(ITEMS)
        .filter((item) => item.kind === 'bag' && !item.materialsOnly)
        .sort((a, b) => (b.bagSlots ?? 0) - (a.bagSlots ?? 0))[0].id;
      state.bags = Array(4).fill(largestGeneralBag);
      const carried = bagPools(state.bags).general;
      const bank: ReturnType<typeof emptyBankState> = {
        ...emptyBankState(),
        inventory: [],
        purchasedSlots: BANK_PURCHASED_SLOTS_MAX,
        bonusSlots: BANK_MAX_BONUS_SLOTS,
        unlockedSockets: 4,
        socketBags: Array(4).fill(largestGeneralBag),
      };
      state.bank = bank;
      const banked = bankPools(bank).general;
      state.inventory = Array.from({ length: carried }, () => ({ itemId: MARK, count: 20 }));
      bank.inventory = Array.from({ length: banked }, () => ({ itemId: MARK, count: 20 }));
      state.heroicMarks = balance - (carried + banked) * 20;
      const loaded = rig().sim;
      const loadedPid = loaded.addPlayer('warrior', 'Migrated', { state });
      expect(expectDefined(loaded.meta(loadedPid)).heroicMarks).toBe(balance);
      const saved = expectDefined(loaded.serializeCharacter(loadedPid));
      expect(saved.inventory).toEqual([]);
      expect(saved.bank?.inventory).toEqual([]);
      const again = rig().sim;
      const againPid = again.addPlayer('warrior', 'Migrated', { state: saved });
      expect(expectDefined(again.meta(againPid)).heroicMarks).toBe(balance);
    },
  );

  it.each([2 ** 31, MAX])('credits an offline claim and reloads exactly at %s', (balance) => {
    const { sim, pid } = rig();
    const state = expectDefined(sim.serializeCharacter(pid));
    state.heroicMarks = balance - 3;
    addVaultRewardToCharacterState(state, {
      characterId: 7,
      recipientName: 'Synthetic',
      items: [{ itemId: MARK, count: 3 }],
      copper: 0,
      mailDueAt: '2026-10-19T00:00:00Z',
    });
    const loaded = rig().sim;
    const loadedPid = loaded.addPlayer('warrior', 'Claimed', { state });
    expect(expectDefined(loaded.meta(loadedPid)).heroicMarks).toBe(balance);
    expect(expectDefined(loaded.serializeCharacter(loadedPid)).heroicMarks).toBe(balance);
  });
});
