import { describe, expect, it } from 'vitest';
import { diffGuildBankOp } from '../server/bank_ledger';
import { journalGuildBookSources } from '../server/guild_bank_source_journal';
import { moveBetweenContainers } from '../src/sim/bank';
import { ITEMS } from '../src/sim/data';
import {
  applyGuildBankDeltasTo,
  type GuildBankOpDelta,
  revertGuildBankDeltasTo,
} from '../src/sim/guild_bank';
import { extractTradableCopy } from '../src/sim/inventory_extract';
import { countMatchingUnlocked, grantCopies } from '../src/sim/item_instance_transfer';
import { planMaterialMailAttachments } from '../src/sim/mail/material_attachment_plan';
import type { PlayerMeta } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { pinnedTradeUnits } from '../src/sim/social/trade_offer_sources';
import type { InvSlot, ItemInstancePayload } from '../src/sim/types';
import type { GuildBankInfo } from '../src/world_api';

const POTION = 'minor_healing_potion';
const mixed = (): InvSlot => ({
  itemId: POTION,
  count: 3,
  craftedRecipeId: 'recipe_minor_healing_potion',
  materialSources: [
    { source: { signer: 'Ana' }, count: 1 },
    { source: { signer: 'Bru' }, count: 2 },
  ],
});

describe('crafted consumable custody', () => {
  it('projects only new potion sources into guild replay while leaving material audits unchanged', async () => {
    const legacy: InvSlot = {
      itemId: POTION,
      count: 2,
      instance: { signer: 'Bru' },
      craftedRecipeId: mixed().craftedRecipeId,
    };
    const info = (slots: InvSlot[]): GuildBankInfo => ({
      treasury: 0,
      slots,
      capacity: 24,
      purchasedSlots: 24,
      nextExpansionPrice: 25_000,
      canEdit: true,
    });
    const delta = diffGuildBankOp('deposit', info([legacy]), info([mixed()]));
    expect(delta).toEqual([
      {
        itemId: POTION,
        count: 1,
        instance: null,
        craftedRecipeId: mixed().craftedRecipeId,
        copperDelta: 0,
        purchasedSlotsBefore: 24,
        purchasedSlotsAfter: 24,
        materialSources: [{ source: { signer: 'Ana' }, count: 1 }],
      },
    ]);
    const replay = delta.map((row) => ({ ...row, op: 'deposit' as const })) as GuildBankOpDelta[];
    const book = { treasury: 0, inventory: [legacy], purchasedSlots: 24 };
    expect(applyGuildBankDeltasTo(book, replay)).toBeNull();
    expect(book.inventory).toEqual([mixed()]);
    revertGuildBankDeltasTo(book, replay);
    expect(book.inventory).toEqual([
      {
        itemId: POTION,
        count: 2,
        craftedRecipeId: mixed().craftedRecipeId,
        materialSources: [{ source: { signer: 'Bru' }, count: 2 }],
      },
    ]);
    expect(
      await journalGuildBookSources(
        {
          query: async () => {
            throw new Error('consumables must not expand material journal writes');
          },
        },
        [{ guildId: 5, before: [legacy], after: [mixed()] }],
      ),
    ).toEqual({ writes: [], anchorsCreated: 0, movementRows: 0, unchangedContainers: 1 });
  });

  it('keeps unknown nested payload data independent across escrow re-grants', () => {
    const instance = { futureEffect: { level: 4 } } as ItemInstancePayload & {
      futureEffect: { level: number };
    };
    let received: ItemInstancePayload | undefined;
    const ctx = {
      addItemInstance: (_itemId: string, payload: ItemInstancePayload) => {
        received = payload;
      },
    } as unknown as SimContext;
    grantCopies(ctx, 1, POTION, 1, instance, 'recipe_minor_healing_potion', [
      { source: { signer: 'Ana' }, count: 1 },
    ]);
    instance.futureEffect.level = 7;
    expect(received).toEqual({ futureEffect: { level: 4 } });
  });

  it('does not put potions in material-only capacity or mutate a rejected move', () => {
    const source = [mixed()];
    const destination: InvSlot[] = [];
    expect(moveBetweenContainers(source, 0, 1, destination, { general: 0, materials: 20 })).toEqual(
      { moved: 0, refusal: 'no_fit', noFitCause: 'space' },
    );
    expect(source).toEqual([mixed()]);
    expect(destination).toEqual([]);
  });

  it('splits a bank deposit and restores the exact signer composition on withdrawal', () => {
    const bags = [mixed()];
    const bank: InvSlot[] = [];
    const pools = { general: 1, materials: 0 };
    expect(moveBetweenContainers(bags, 0, 1, bank, pools)).toEqual({ moved: 1 });
    expect(bank[0].materialSources).toEqual([{ source: { signer: 'Ana' }, count: 1 }]);
    expect(bags[0].materialSources).toEqual([{ source: { signer: 'Bru' }, count: 2 }]);
    expect(moveBetweenContainers(bank, 0, undefined, bags, pools)).toEqual({ moved: 1 });
    expect(bags).toEqual([mixed()]);
  });

  it('plans mail against the mixed pool without losing crafted markers or changing the source', () => {
    const inventory = [mixed()];
    const result = planMaterialMailAttachments(inventory, [{ itemId: POTION, count: 3 }]);
    expect(result).toEqual({
      ok: true,
      value: { inventory: [], rowsByAttachment: [[mixed()]] },
    });
    expect(inventory).toEqual([mixed()]);
  });

  it('keeps legacy bulk signed mail and refuses overlapping requests atomically', () => {
    const inventory: InvSlot[] = [{ itemId: POTION, count: 2, instance: { signer: 'Ana' } }];
    const result = planMaterialMailAttachments(inventory, [
      { itemId: POTION, count: 2, instance: { signer: 'Ana' } },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value.rowsByAttachment[0]?.[0].materialSources).toEqual([
        { source: { signer: 'Ana' }, count: 2 },
      ]);
    expect(
      planMaterialMailAttachments(inventory, [
        { itemId: POTION, count: 2 },
        { itemId: POTION, count: 1, instance: { signer: 'Ana' } },
      ]),
    ).toEqual({ ok: false, error: 'insufficient' });
    expect(inventory[0].count).toBe(2);
  });

  it.each([{ boundTo: 7 }, { bindOnTrade: true }, { locked: true }])(
    'refuses restricted mixed potion sources in mail and escrow: %j',
    (instance) => {
      const inventory: InvSlot[] = [{ ...mixed(), instance }];
      expect(planMaterialMailAttachments(inventory, [{ itemId: POTION, count: 1 }])).toEqual({
        ok: false,
        error: 'insufficient',
      });
      expect(extractTradableCopy(inventory, { index: 0, itemId: POTION }, ITEMS[POTION]).ok).toBe(
        false,
      );
      expect(inventory).toEqual([{ ...mixed(), instance }]);
    },
  );

  it('replays and rolls back exact guild-bank source deltas', () => {
    const book = { treasury: 0, inventory: [mixed()], purchasedSlots: 24 };
    const delta: GuildBankOpDelta = {
      op: 'withdraw',
      itemId: POTION,
      count: 1,
      instance: null,
      craftedRecipeId: mixed().craftedRecipeId,
      materialSources: [{ source: { signer: 'Bru' }, count: -1 }],
      copperDelta: 0,
      purchasedSlotsBefore: 24,
      purchasedSlotsAfter: 24,
    };
    expect(applyGuildBankDeltasTo(book, [delta])).toBeNull();
    expect(book.inventory[0].materialSources).toEqual([
      { source: { signer: 'Ana' }, count: 1 },
      { source: { signer: 'Bru' }, count: 1 },
    ]);
    revertGuildBankDeltasTo(book, [delta]);
    expect(book.inventory).toEqual([mixed()]);
  });

  it('pins the offered signer and refuses to substitute another crafter', () => {
    const inventory = [mixed()];
    const request = {
      inventory,
      itemId: POTION,
      craftedRecipeId: mixed().craftedRecipeId,
      sources: [{ source: { signer: 'Ana' }, count: 1 }],
      skip: () => false,
    };
    const units = pinnedTradeUnits(request);
    expect(units?.[0].materialSources).toEqual(request.sources);
    expect(pinnedTradeUnits(request)).toBeNull();
    expect(inventory[0].count).toBe(2);
    expect(countMatchingUnlocked({ inventory } as PlayerMeta, POTION, { signer: 'Bru' })).toBe(2);
  });

  it('extracts one exact escrow unit while conserving the remaining sources', () => {
    const inventory = [mixed()];
    const result = extractTradableCopy(inventory, { index: 0, itemId: POTION }, ITEMS[POTION]);
    expect(result).toEqual({
      ok: true,
      extracted: {
        ...mixed(),
        count: 1,
        materialSources: [{ source: { signer: 'Ana' }, count: 1 }],
      },
    });
    expect(inventory[0].materialSources).toEqual([{ source: { signer: 'Bru' }, count: 2 }]);
  });
});
