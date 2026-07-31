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
    const high = { itemId: 'hide', count: 1, instance: { signer: 'Ayla' } };
    const inventory: InvSlot[] = [low, { itemId: 'hide', count: 3 }, high];
    const { ctx, hookFired } = fakeCtx(inventory);
    const got = removeMatchingInstance(ctx, 'hide', SIGNED, 1);
    // The final unit of a fully-consumed slot returns the ORIGINAL object.
    expect(got).toBe(high.instance);
    expect(inventory).toHaveLength(2);
    expect(inventory).toContain(low);
    expect(hookFired()).toBe(1);
  });

  it('clones the payload out of a surviving stack (never aliases it)', () => {
    const stack = { itemId: 'hide', count: 2, instance: { signer: 'Ayla' } };
    const inventory: InvSlot[] = [stack];
    const { ctx } = fakeCtx(inventory);
    const got = removeMatchingInstance(ctx, 'hide', SIGNED, 1);
    expect(got).toEqual(SIGNED);
    expect(got).not.toBe(stack.instance);
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
});
