// Heroic Marks are a currency (src/sim/heroic_marks.ts), not a bag item: the
// inventory hub credits PlayerMeta.heroicMarks, the bag capacity gates treat
// the id as costing no space, a pre-currency save folds its legacy stacks into
// the balance on load, a legacy Ravenpost parcel credits the balance on take,
// and the balance persists and mirrors to the online client.

import { describe, expect, it } from 'vitest';
import { emitActivitySelfKeys } from '../server/quest_snapshot_wire';
import { QuestWorldWireState } from '../src/net/quest_world_wire_state';
import { bagPools, canAddItem, countFit, fitsAll } from '../src/sim/bags';
import { HEROIC_MARK_CURRENCY_ID } from '../src/sim/content/dungeon_difficulty';
import { isCurrencyGrantId } from '../src/sim/currency_grants';
import { BUILTIN_WORLD } from '../src/sim/data';
import {
  absorbLegacyHeroicMarkSlots,
  creditHeroicMarks,
  sanitizeHeroicMarks,
  spendHeroicMarks,
} from '../src/sim/heroic_marks';
import { Sim } from '../src/sim/sim';
import type { SimEvent, WorldContent } from '../src/sim/types';

// Mailboxes still spawn with this fixture; ambient camps and NPCs are noise.
const QUIET_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

const makeSim = () =>
  new Sim({ seed: 31, playerClass: 'warrior', noPlayer: true, world: QUIET_WORLD });

function fillBags(sim: Sim, pid: number): void {
  const meta = sim.meta(pid)!;
  meta.inventory = Array.from({ length: sim.bagCapacity }, () => ({
    itemId: 'worn_sword',
    count: 1,
  }));
}

function bagMarks(sim: Sim, pid: number): number {
  return sim
    .meta(pid)!
    .inventory.filter((slot) => slot.itemId === HEROIC_MARK_CURRENCY_ID)
    .reduce((n, slot) => n + slot.count, 0);
}

describe('heroic marks: the pure currency helpers', () => {
  it('names exactly the heroic_mark id as a currency grant', () => {
    // The persisted save, parcel and vault-claim token: frozen to the legacy item id.
    expect(HEROIC_MARK_CURRENCY_ID).toBe('heroic_mark');
    expect(isCurrencyGrantId(HEROIC_MARK_CURRENCY_ID)).toBe(true);
    expect(isCurrencyGrantId('wyrmfall_core')).toBe(false);
    expect(isCurrencyGrantId('worn_sword')).toBe(false);
  });

  it('clamps a persisted or wire balance to a whole non-negative safe integer', () => {
    expect(sanitizeHeroicMarks(12.9)).toBe(12);
    expect(sanitizeHeroicMarks(-3)).toBe(0);
    expect(sanitizeHeroicMarks(Number.NaN)).toBe(0);
    expect(sanitizeHeroicMarks(Number.POSITIVE_INFINITY)).toBe(0);
    expect(sanitizeHeroicMarks('40')).toBe(0);
    expect(sanitizeHeroicMarks(undefined)).toBe(0);
    expect(sanitizeHeroicMarks(Number.MAX_SAFE_INTEGER * 4)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('credits only positive whole amounts, onto a live meta or a bare saved state', () => {
    const holder: { heroicMarks?: number } = {};
    creditHeroicMarks(holder, 3.7);
    creditHeroicMarks(holder, -5);
    creditHeroicMarks(holder, 0);
    expect(holder.heroicMarks).toBe(3);
  });

  it('spends only when the balance covers the cost, and never a non-positive cost', () => {
    const meta = { heroicMarks: 12 };
    expect(spendHeroicMarks(meta, 13)).toBe(false);
    expect(meta.heroicMarks).toBe(12);
    expect(spendHeroicMarks(meta, 0)).toBe(false);
    expect(spendHeroicMarks(meta, -4)).toBe(false);
    expect(meta.heroicMarks).toBe(12);
    expect(spendHeroicMarks(meta, 12)).toBe(true);
    expect(meta.heroicMarks).toBe(0);
  });

  it('folds legacy bag AND bank stacks into the balance and removes them', () => {
    const meta = {
      heroicMarks: 4,
      inventory: [
        { itemId: HEROIC_MARK_CURRENCY_ID, count: 20 },
        { itemId: 'worn_sword', count: 1 },
        { itemId: HEROIC_MARK_CURRENCY_ID, count: 7 },
      ],
      bank: {
        inventory: [
          { itemId: 'linen_scrap', count: 9 },
          { itemId: HEROIC_MARK_CURRENCY_ID, count: 5 },
        ],
      },
    };
    expect(absorbLegacyHeroicMarkSlots(meta)).toBe(32);
    expect(meta.heroicMarks).toBe(36);
    expect(meta.inventory).toEqual([{ itemId: 'worn_sword', count: 1 }]);
    expect(meta.bank.inventory).toEqual([{ itemId: 'linen_scrap', count: 9 }]);
    // Idempotent: a second pass finds nothing left to move.
    expect(absorbLegacyHeroicMarkSlots(meta)).toBe(0);
    expect(meta.heroicMarks).toBe(36);
  });
});

describe('heroic marks: bag capacity never gates a marks grant', () => {
  it('fits marks whole into full bags at every capacity gate', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Packed');
    fillBags(sim, pid);
    const meta = sim.meta(pid)!;
    const pools = bagPools(meta.bags);
    expect(sim.canAddItem('worn_sword', 1, pid)).toBe(false);
    expect(sim.canAddItem(HEROIC_MARK_CURRENCY_ID, 500, pid)).toBe(true);
    expect(canAddItem(meta.inventory, pools, HEROIC_MARK_CURRENCY_ID, 9)).toBe(true);
    expect(countFit(meta.inventory, pools, HEROIC_MARK_CURRENCY_ID, 9)).toBe(9);
  });

  it('fitsAll skips marks so they never consume a slot another add needs', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'OneSlot');
    fillBags(sim, pid);
    const meta = sim.meta(pid)!;
    meta.inventory.pop(); // exactly one free slot
    const pools = bagPools(meta.bags);
    const sword = { itemId: 'worn_sword', count: 1 };
    expect(fitsAll(meta.inventory, pools, [sword])).toBe(true);
    expect(fitsAll(meta.inventory, pools, [sword, sword])).toBe(false);
    // A payload-bearing copy keeps the slot path, so it does not fit full bags.
    const locked = { itemId: HEROIC_MARK_CURRENCY_ID, count: 1, instance: { locked: true } };
    meta.inventory.push(sword);
    expect(countFit(meta.inventory, pools, HEROIC_MARK_CURRENCY_ID, 1, locked.instance)).toBe(0);
    expect(fitsAll(meta.inventory, pools, [locked])).toBe(false);
    meta.inventory.pop();
    // Marks first: as a bag item they would have taken the last slot.
    expect(
      fitsAll(meta.inventory, pools, [{ itemId: HEROIC_MARK_CURRENCY_ID, count: 40 }, sword]),
    ).toBe(true);
  });
});

describe('heroic marks: the inventory hub credits the counter', () => {
  it('credits the balance, leaves the bags alone, and still posts the receipt line', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Earner');
    fillBags(sim, pid);
    sim.drainEvents();
    sim.addItem(HEROIC_MARK_CURRENCY_ID, 3, pid);
    expect(sim.meta(pid)!.heroicMarks).toBe(3);
    expect(sim.meta(pid)!.inventory).toHaveLength(sim.bagCapacity);
    expect(bagMarks(sim, pid)).toBe(0);
    const receipt = (sim.drainEvents() as SimEvent[]).find(
      (event) => event.type === 'loot' && event.pid === pid,
    );
    expect(receipt).toMatchObject({ type: 'loot', text: 'You receive: Heroic Mark x3.' });
  });

  it('exposes the primary player balance through the IWorld getter', () => {
    const sim = new Sim({ seed: 31, playerClass: 'warrior', world: QUIET_WORLD });
    sim.addItem(HEROIC_MARK_CURRENCY_ID, 8, sim.player.id);
    expect(sim.heroicMarks).toBe(8);
  });
});

describe('heroic marks: persistence and the legacy-save fold', () => {
  it('saves the balance and omits the field for a character with none', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Saver');
    expect('heroicMarks' in sim.serializeCharacter(pid)!).toBe(false);
    sim.addItem(HEROIC_MARK_CURRENCY_ID, 14, pid);
    const saved = sim.serializeCharacter(pid)!;
    expect(saved.heroicMarks).toBe(14);
    expect(saved.inventory.some((slot) => slot.itemId === HEROIC_MARK_CURRENCY_ID)).toBe(false);
    const sim2 = makeSim();
    const pid2 = sim2.addPlayer('warrior', 'Saver', { state: saved });
    expect(sim2.meta(pid2)!.heroicMarks).toBe(14);
  });

  it('loads a pre-currency save: bag and bank mark stacks become the balance', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Veteran');
    const legacy = sim.serializeCharacter(pid)!;
    legacy.inventory = [
      ...legacy.inventory,
      { itemId: HEROIC_MARK_CURRENCY_ID, count: 20 },
      { itemId: HEROIC_MARK_CURRENCY_ID, count: 6 },
    ];
    legacy.bank = {
      ...(legacy.bank ?? { inventory: [], purchasedSlots: 0, bonusSlots: 0 }),
      inventory: [{ itemId: HEROIC_MARK_CURRENCY_ID, count: 4 }],
    } as typeof legacy.bank;
    legacy.heroicMarks = 2; // a half-migrated blob still sums, never overwrites
    const sim2 = makeSim();
    const pid2 = sim2.addPlayer('warrior', 'Veteran', { state: legacy });
    const meta = sim2.meta(pid2)!;
    expect(meta.heroicMarks).toBe(32);
    expect(bagMarks(sim2, pid2)).toBe(0);
    expect(meta.bank.inventory.some((slot) => slot.itemId === HEROIC_MARK_CURRENCY_ID)).toBe(false);
    const resaved = sim2.serializeCharacter(pid2)!;
    expect(resaved.heroicMarks).toBe(32);
    expect(resaved.inventory.some((slot) => slot.itemId === HEROIC_MARK_CURRENCY_ID)).toBe(false);
    expect(resaved.bank?.inventory.some((slot) => slot.itemId === HEROIC_MARK_CURRENCY_ID)).toBe(
      false,
    );
  });

  it('loads a corrupt saved balance as zero', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Corrupt');
    const saved = { ...sim.serializeCharacter(pid)!, heroicMarks: -40 };
    const sim2 = makeSim();
    const pid2 = sim2.addPlayer('warrior', 'Corrupt', { state: saved });
    expect(sim2.meta(pid2)!.heroicMarks).toBe(0);
  });
});

describe('heroic marks: Ravenpost parcels credit the balance on take', () => {
  it('takes a marks parcel into the balance even with full bags, emptying the letter', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Backline');
    sim.postOffice.mailHeroicMarks(pid, HEROIC_MARK_CURRENCY_ID, 3);
    for (let i = 0; i < 20 * 120; i++) sim.tick();
    const box = sim.entities.get(sim.postOffice.mailboxIds[0])!;
    const p = sim.entities.get(pid)!;
    p.pos = { ...box.pos };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
    fillBags(sim, pid);
    const letter = sim
      .mailInfoFor(pid)
      ?.messages.find((m) => m.items.some((item) => item.itemId === HEROIC_MARK_CURRENCY_ID));
    expect(letter).toBeDefined();
    sim.mailTake(letter!.id, pid);
    expect(sim.meta(pid)!.heroicMarks).toBe(3);
    expect(bagMarks(sim, pid)).toBe(0);
    const after = sim.mailInfoFor(pid)?.messages.find((m) => m.id === letter!.id);
    expect(after?.items ?? []).toEqual([]);
  });
});

describe('heroic marks: the online mirror', () => {
  it('emits the balance as the hmarks activity self key', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Wired');
    sim.addItem(HEROIC_MARK_CURRENCY_ID, 9, pid);
    const sent = new Map<string, unknown>();
    emitActivitySelfKeys((key, value) => sent.set(key, value), sim, sim.meta(pid)!, pid);
    expect(sent.get('hmarks')).toBe(9);
  });

  it('applies hmarks through the sanitizer and keeps the mirror when the key is omitted', () => {
    const state = new QuestWorldWireState();
    expect(state.heroicMarks).toBe(0);
    // The return value is the repaint signal: true only on a real balance move.
    expect(state.applyQuestSelfSnapshot({ hmarks: 17 })).toBe(true);
    expect(state.heroicMarks).toBe(17);
    expect(state.applyQuestSelfSnapshot({})).toBe(false);
    expect(state.applyQuestSelfSnapshot({ hmarks: 17 })).toBe(false);
    expect(state.heroicMarks).toBe(17);
    expect(state.applyQuestSelfSnapshot({ hmarks: -5 })).toBe(true);
    expect(state.heroicMarks).toBe(0);
    expect(state.applyQuestSelfSnapshot({ hmarks: 'lots' })).toBe(false);
    expect(state.heroicMarks).toBe(0);
  });

  it('clears the mirrored balance on a reconnect reset', () => {
    const state = new QuestWorldWireState();
    state.applyQuestSelfSnapshot({ hmarks: 40 });
    (state as unknown as { resetQuestWorldWireState(): void }).resetQuestWorldWireState();
    expect(state.heroicMarks).toBe(0);
  });
});
