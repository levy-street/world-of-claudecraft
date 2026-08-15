// The shared instanced-transfer rules for the anonymous exchange pipes
// (src/sim/item_instance_transfer.ts): the pipe lock predicate, the public
// display trim, the payload-matching escrow removal, and the persisted-escrow
// sanitizer. The trim allowlist is cross-pinned to the eqi wire's projection
// (server/game.ts identityFields), the enchant_apply_view.test.ts precedent:
// widen both or neither.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canGrantCopies } from '../src/sim/bags';
import {
  countMatchingUnlocked,
  grantCopies,
  holdsMatchingLocked,
  isTransferLockedInstance,
  publicInstanceView,
  removeMatchingInstance,
  sanitizeEscrowSlot,
} from '../src/sim/item_instance_transfer';
import type { PlayerMeta } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { InvSlot, ItemInstancePayload } from '../src/sim/types';

describe('isTransferLockedInstance', () => {
  it('locks armed (bindOnTrade) and bound (boundTo) copies; nothing else', () => {
    expect(isTransferLockedInstance(undefined)).toBe(false);
    expect(isTransferLockedInstance({})).toBe(false);
    expect(isTransferLockedInstance({ signer: 'A' })).toBe(false);
    expect(isTransferLockedInstance({ enchant: 'e', rolled: { stats: { str: 1 } } })).toBe(false);
    expect(isTransferLockedInstance({ charges: { zap: 1 } })).toBe(false);
    expect(isTransferLockedInstance({ bindOnTrade: true })).toBe(true);
    expect(isTransferLockedInstance({ boundTo: 7 })).toBe(true);
    expect(isTransferLockedInstance({ bindOnTrade: true, boundTo: 7 })).toBe(true);
    // boundTo: 0 is a real pid and still a lock (undefined is the only unlock).
    expect(isTransferLockedInstance({ boundTo: 0 })).toBe(true);
  });
});

describe('publicInstanceView: the display trim', () => {
  it('projects exactly signer/enchant/rolled and drops the rest', () => {
    const full: ItemInstancePayload = {
      signer: 'Ayla',
      enchant: 'ench_stat_str',
      rolled: { quality: 'epic', stats: { str: 2 }, masterwork: true },
      charges: { zap: 3 },
      bindOnTrade: true,
      boundTo: 12,
    };
    expect(publicInstanceView(full)).toEqual({
      signer: 'Ayla',
      enchant: 'ench_stat_str',
      rolled: { quality: 'epic', stats: { str: 2 }, masterwork: true },
    });
  });

  it('never aliases the live rolled maps into the projection', () => {
    const live: ItemInstancePayload = { rolled: { stats: { str: 2 } } };
    const pub = publicInstanceView(live);
    pub.rolled!.stats!.str = 99;
    expect(live.rolled!.stats!.str).toBe(2);
  });

  it('matches the eqi wire allowlist in server/game.ts: widen both or neither', () => {
    // Source-scrape the eqi projection loop (the enchant_apply_view.test.ts
    // pin) and assert this module projects the identical key set.
    const game = readFileSync(new URL('../server/game.ts', import.meta.url), 'utf8');
    const projected = [...game.matchAll(/pub\.(\w+) = inst\.(\w+);/g)].map((m) => m[1]);
    expect(projected.sort()).toEqual(['enchant', 'rolled', 'signer']);
    const transfer = readFileSync(
      new URL('../src/sim/item_instance_transfer.ts', import.meta.url),
      'utf8',
    );
    const trimmed = [...transfer.matchAll(/pub\.(\w+) = /g)].map((m) => m[1]);
    expect([...new Set(trimmed)].sort()).toEqual(['enchant', 'rolled', 'signer']);
    for (const banned of ['boundTo', 'bindOnTrade', 'charges']) {
      expect(transfer.includes(`pub.${banned}`), `${banned} must never project`).toBe(false);
    }
  });
});

function fakeCtx(inventory: InvSlot[]): { ctx: SimContext; hookFired: () => number } {
  let fired = 0;
  const meta = { entityId: 1, inventory } as unknown as PlayerMeta;
  const ctx = {
    resolve: () => ({ meta, e: { id: 1 } }),
    onInventoryChangedForQuests: () => {
      fired += 1;
    },
  } as unknown as SimContext;
  return { ctx, hookFired: () => fired };
}

const SIGNED: ItemInstancePayload = { signer: 'Ayla' };

describe('countMatchingUnlocked / holdsMatchingLocked', () => {
  it('counts only structurally-equal unlocked units and flags locked matches', () => {
    const meta = {
      inventory: [
        { itemId: 'hide', count: 2, instance: { signer: 'Ayla' } },
        { itemId: 'hide', count: 1, instance: { signer: 'Belle' } },
        { itemId: 'hide', count: 1, instance: { signer: 'Ayla', boundTo: 7 } },
        { itemId: 'hide', count: 5 },
        { itemId: 'scale', count: 1, instance: { signer: 'Ayla' } },
      ],
    } as unknown as PlayerMeta;
    expect(countMatchingUnlocked(meta, 'hide', SIGNED)).toBe(2);
    expect(holdsMatchingLocked(meta, 'hide', SIGNED)).toBe(false);
    expect(holdsMatchingLocked(meta, 'hide', { signer: 'Ayla', boundTo: 7 })).toBe(true);
    expect(countMatchingUnlocked(meta, 'hide', { signer: 'Ayla', boundTo: 7 })).toBe(0);
  });
});

describe('removeMatchingInstance', () => {
  it('consumes the highest-index equal unlocked copy and returns the SLOT payload', () => {
    const low = { itemId: 'hide', count: 1, instance: { signer: 'Ayla' } };
    const high = {
      itemId: 'hide',
      count: 1,
      instance: { signer: 'Ayla' },
      craftedRecipeId: 'recipe_hide',
    };
    const inventory: InvSlot[] = [low, { itemId: 'hide', count: 3 }, high];
    const { ctx, hookFired } = fakeCtx(inventory);
    const got = removeMatchingInstance(ctx, 'hide', SIGNED, 1);
    // The final unit of a fully-consumed slot returns the ORIGINAL object.
    expect(got?.instance).toBe(high.instance);
    // Both provenance channels come out, not just the payload: an escrowed copy
    // can be instanced AND crafted at once.
    expect(got?.craftedRecipeId).toBe('recipe_hide');
    expect(inventory).toHaveLength(2);
    expect(inventory).toContain(low);
    expect(hookFired()).toBe(1);
  });

  it('clones the payload out of a surviving stack (never aliases it)', () => {
    const stack = { itemId: 'hide', count: 2, instance: { signer: 'Ayla' } };
    const inventory: InvSlot[] = [stack];
    const { ctx } = fakeCtx(inventory);
    const got = removeMatchingInstance(ctx, 'hide', SIGNED, 1);
    expect(got?.instance).toEqual(SIGNED);
    expect(got?.instance).not.toBe(stack.instance);
    expect(got?.craftedRecipeId).toBeUndefined();
    expect(stack.count).toBe(1);
  });

  it('never consumes a locked or unequal copy and reports null untouched', () => {
    const inventory: InvSlot[] = [
      { itemId: 'hide', count: 1, instance: { signer: 'Ayla', boundTo: 7 } },
      { itemId: 'hide', count: 1, instance: { signer: 'Belle' } },
      { itemId: 'hide', count: 4 },
    ];
    const { ctx, hookFired } = fakeCtx(inventory);
    expect(removeMatchingInstance(ctx, 'hide', SIGNED, 1)).toBeNull();
    expect(inventory).toHaveLength(3);
    expect(hookFired()).toBe(0);
  });
});

describe('canGrantCopies / grantCopies: the shared exchange-pipe pair', () => {
  it('capacity: plain-stack room is not instanced room, and the reverse', () => {
    const inventory: InvSlot[] = [{ itemId: 'pristine_hide', count: 1 }];
    // One free slot short: the plain stack tops up, the instanced copy needs
    // its own slot.
    expect(canGrantCopies(inventory, 1, 'pristine_hide', 1)).toBe(true);
    expect(canGrantCopies(inventory, 1, 'pristine_hide', 1, SIGNED)).toBe(false);
    const signedStack: InvSlot[] = [
      { itemId: 'pristine_hide', count: 1, instance: { signer: 'Ayla' } },
    ];
    expect(canGrantCopies(signedStack, 1, 'pristine_hide', 1, SIGNED)).toBe(true);
    expect(canGrantCopies(signedStack, 1, 'pristine_hide', 1)).toBe(false);
  });

  // #2605 review (Rubsey/OSSBrain): canGrantCopies must model the same
  // craftedRecipeId bucketing grantCopies grants with, or a pre-check can see
  // room in an existing marker-free stack the real grant (addStacked, keyed
  // on the marker) cannot merge into, overfilling the recipient's bags past
  // the modelled cap.
  it('capacity: a marker-free stack is not room for a crafted-provenance grant, and the reverse', () => {
    const plainStack: InvSlot[] = [{ itemId: 'pristine_hide', count: 1 }];
    // One free slot short: the plain stack tops up for a marker-free grant,
    // but a crafted-marker grant of the same itemId cannot merge into it and
    // needs its own fresh slot.
    expect(canGrantCopies(plainStack, 1, 'pristine_hide', 1)).toBe(true);
    expect(canGrantCopies(plainStack, 1, 'pristine_hide', 1, undefined, 'recipe_x')).toBe(false);
    const craftedStack: InvSlot[] = [
      { itemId: 'pristine_hide', count: 1, craftedRecipeId: 'recipe_x' },
    ];
    expect(canGrantCopies(craftedStack, 1, 'pristine_hide', 1, undefined, 'recipe_x')).toBe(true);
    expect(canGrantCopies(craftedStack, 1, 'pristine_hide', 1)).toBe(false);
  });

  it('grant forwards craftedRecipeId on BOTH arms, not just the plain one', () => {
    // The instanced arm used to drop the marker on the "one or the other, never
    // both" reading. A row can be instanced AND crafted (a masterwork proc, a
    // crafted piece enchanted while worn), so the opts the grant passes to
    // addItemInstance must carry it, exactly as the plain arm's addItem opts do.
    // Pinned on the shared grant itself, matching the removeMatchingInstance
    // contract test above: the live market/mail rows exercise it end to end,
    // but this is the seam both pipes claim through.
    const calls: { kind: string; craftedRecipeId?: string }[] = [];
    const ctx = {
      addItem: (
        _itemId: string,
        _count: number,
        _pid?: number,
        opts?: { craftedRecipeId?: string },
      ) => {
        calls.push({ kind: 'plain', craftedRecipeId: opts?.craftedRecipeId });
      },
      addItemInstance: (
        _itemId: string,
        _instance: ItemInstancePayload,
        _pid?: number,
        _count?: number,
        opts?: { craftedRecipeId?: string },
      ) => {
        calls.push({ kind: 'instanced', craftedRecipeId: opts?.craftedRecipeId });
      },
    } as unknown as SimContext;

    grantCopies(ctx, 1, 'pristine_hide', 2, undefined, 'recipe_hide');
    grantCopies(ctx, 1, 'pristine_hide', 1, { signer: 'Ayla' }, 'recipe_hide');
    expect(calls).toEqual([
      { kind: 'plain', craftedRecipeId: 'recipe_hide' },
      { kind: 'instanced', craftedRecipeId: 'recipe_hide' },
    ]);

    // A marker-free grant stays marker-free on both arms (no undefined key is
    // invented, and no marker is fabricated).
    calls.length = 0;
    grantCopies(ctx, 1, 'pristine_hide', 1);
    grantCopies(ctx, 1, 'pristine_hide', 1, { signer: 'Ayla' });
    expect(calls).toEqual([
      { kind: 'plain', craftedRecipeId: undefined },
      { kind: 'instanced', craftedRecipeId: undefined },
    ]);
  });

  it('grant routes instanced copies through addItemInstance with a DEEP CLONE', () => {
    const calls: { kind: string; instance?: ItemInstancePayload }[] = [];
    const ctx = {
      addItem: (_itemId: string, _count: number, _pid?: number) => {
        calls.push({ kind: 'plain' });
      },
      addItemInstance: (
        _itemId: string,
        instance: ItemInstancePayload,
        _pid?: number,
        _count?: number,
      ) => {
        calls.push({ kind: 'instanced', instance });
      },
    } as unknown as SimContext;
    grantCopies(ctx, 1, 'pristine_hide', 3);
    expect(calls).toEqual([{ kind: 'plain' }]);
    // The clone claim: a surviving source row (a future instanced house
    // listing, which never depletes) must never alias the granted payload.
    const source: ItemInstancePayload = { signer: 'Ayla', rolled: { stats: { agi: 2 } } };
    grantCopies(ctx, 1, 'pristine_hide', 1, source);
    const granted = calls[1].instance;
    expect(granted).toEqual(source);
    expect(granted).not.toBe(source);
    granted!.rolled!.stats!.agi = 99;
    expect(source.rolled!.stats!.agi).toBe(2);
  });
});

describe('sanitizeEscrowSlot', () => {
  it('clamps counts, deep-clones payloads, and drops a malformed instance', () => {
    const raw = { itemId: 'hide', count: 7, instance: { signer: 'Ayla' } };
    const clean = sanitizeEscrowSlot(raw, 20);
    expect(clean).toEqual(raw);
    expect(clean.instance).not.toBe(raw.instance);
    expect(sanitizeEscrowSlot({ itemId: 'hide', count: 7, instance: { signer: 'A' } }, 1)).toEqual({
      itemId: 'hide',
      count: 1,
      instance: { signer: 'A' },
    });
    expect(sanitizeEscrowSlot({ itemId: 'hide', count: 0 }, 20)).toEqual({
      itemId: 'hide',
      count: 1,
    });
    expect(sanitizeEscrowSlot({ itemId: 'hide', count: 2, instance: 'evil' as never }, 20)).toEqual(
      { itemId: 'hide', count: 2 },
    );
  });

  it('runs the shared payload bound: an oversized signer drops instead of riding the book', () => {
    // The phase 18 whole-branch review: the two escrow books were the only
    // persisted instance loads outside item_instance_load's bound, and a
    // book row can persist forever with no login to self-heal it.
    const dropped: string[] = [];
    const clean = sanitizeEscrowSlot(
      { itemId: 'hide', count: 1, instance: { signer: 'x'.repeat(5000) } },
      20,
      dropped,
    );
    expect(clean).toEqual({ itemId: 'hide', count: 1 });
    expect(dropped).toEqual(['hide.signer', 'hide.payload']);
  });

  it('drops a clone-mangled ARRAY instance whole (typeof [] passes the object guard)', () => {
    const dropped: string[] = [];
    const clean = sanitizeEscrowSlot(
      { itemId: 'hide', count: 3, instance: [1, 2, 3] as never },
      20,
      dropped,
    );
    expect(clean).toEqual({ itemId: 'hide', count: 3 });
    expect(dropped).toEqual(['hide.payload']);
  });

  it('a legal payload passes the bound byte-identical, so the escrow arm changes nothing legal', () => {
    const raw = {
      itemId: 'hide',
      count: 1,
      instance: { signer: 'Ayla', rolled: { quality: 'fine', stats: { agi: 2 } } },
    };
    const dropped: string[] = [];
    const clean = sanitizeEscrowSlot(raw, 20, dropped);
    expect(clean).toEqual(raw);
    expect(dropped).toEqual([]);
  });
});
