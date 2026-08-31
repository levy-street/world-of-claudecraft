import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PoolCapacity } from '../src/sim/bag_pools';
import { bankCapacity, bankPools } from '../src/sim/bank';
// Aliased: this file already declares a small synthetic `ITEMS` for the buildBankView
// tests, so the real merged table (needed for the real-Sim replay) comes in renamed.
import { ITEMS as REAL_ITEMS } from '../src/sim/data';
import { MATERIAL_ITEM_IDS } from '../src/sim/material_taxonomy';
import { Sim } from '../src/sim/sim';
import type { Entity, InvSlot, ItemDef, SimEvent } from '../src/sim/types';
import type { ItemLookup } from '../src/ui/bag_filter';
import {
  BANK_NEAR_FULL_FRACTION,
  type BankItemLookup,
  bankPoolsOf,
  bankSlotAction,
  buildBankView,
  depositAllSummaryKey,
  hasDepositableMaterials,
  hasOpenBankSocket,
  planDepositAllMaterials,
} from '../src/ui/bank_view';
import type { BankInfo } from '../src/world_api';

// The bank core maps the proximity-gated BankInfo snapshot (null away from a
// banker) to a flat render model (capacity / ordered slots / empty pad / buy
// panel) and decides the slot click action (whole withdraw vs the shift
// split-stack prompt, which an instanced slot suppresses). These tests pin the
// grid model, the over-capacity clamp, the buy ladder, the click matrix, and the
// ClientWorld-vs-Sim parity (the same snapshot drives an identical model whether
// read off a Sim or a JSON-mirrored ClientWorld).

// Only the quality is looked up; a quality-less item and an unknown id both fall
// back to 'common'.
const ITEMS: Record<string, { quality?: string }> = {
  sword: { quality: 'rare' },
  potion: { quality: 'common' },
  bread: {}, // quality-less -> 'common'
  signed_blade: { quality: 'epic' },
};
const lookup: BankItemLookup = (id) => ITEMS[id];

function bankInfo(over: Partial<BankInfo> = {}): BankInfo {
  return {
    slots: [],
    capacity: 24,
    purchasedSlots: 0,
    bonusSlots: 0,
    nextExpansionCost: 500,
    bonusSources: [],
    socketsUnlocked: 0,
    socketBags: [null, null, null, null],
    nextSocketCost: 1000000,
    generalCapacity: 24,
    materialsCapacity: 0,
    generalUsed: 0,
    materialsUsed: 0,
    ...over,
  };
}

describe('buildBankView', () => {
  it('reports away from a null (no banker in reach) snapshot', () => {
    expect(buildBankView(null, lookup)).toEqual({ kind: 'away' });
  });

  it('reports an empty bank with a full empty pad', () => {
    const view = buildBankView(bankInfo({ capacity: 24 }), lookup);
    expect(view.kind).toBe('bank');
    if (view.kind !== 'bank') throw new Error('expected bank');
    expect(view.empty).toBe(true);
    expect(view.slots).toEqual([]);
    expect(view.capacity.used).toBe(0);
    expect(view.emptyCells).toBe(24); // emptyCells === capacity for an empty bank
  });

  it('passes the per-copy instance payload through to the slot model (tooltip lines)', () => {
    const instance = { signer: 'Anna', rolled: { masterwork: true, stats: { str: 2 } } };
    const slots: InvSlot[] = [
      { itemId: 'sword', count: 1, instance },
      { itemId: 'potion', count: 5 },
    ];
    const view = buildBankView(bankInfo({ slots, capacity: 24 }), lookup);
    if (view.kind !== 'bank') throw new Error('expected bank');
    expect(view.slots[0].instance).toBe(instance);
    expect(view.slots[1].instance).toBeUndefined();
  });

  it('projects the occupied grid preserving order, count display, and quality', () => {
    const slots: InvSlot[] = [
      { itemId: 'sword', count: 1 }, // count 1 -> showCount false, quality rare
      { itemId: 'potion', count: 5 }, // count > 1 -> showCount true, quality common
      { itemId: 'bread', count: 3 }, // quality-less -> 'common'
    ];
    const view = buildBankView(bankInfo({ slots, capacity: 24 }), lookup);
    if (view.kind !== 'bank') throw new Error('expected bank');
    expect(view.empty).toBe(false);
    expect(view.slots.map((s) => s.slotIndex)).toEqual([0, 1, 2]);
    expect(view.slots.map((s) => s.itemId)).toEqual(['sword', 'potion', 'bread']);
    expect(view.slots[0]).toEqual({
      slotIndex: 0,
      itemId: 'sword',
      count: 1,
      showCount: false,
      qualityKey: 'rare',
    });
    expect(view.slots[1].showCount).toBe(true);
    expect(view.slots[1].qualityKey).toBe('common');
    expect(view.slots[2].showCount).toBe(true);
    expect(view.slots[2].qualityKey).toBe('common'); // quality-less falls back
  });

  it('pins the capacity counter (a 37/48 fixture)', () => {
    const slots: InvSlot[] = Array.from({ length: 37 }, () => ({ itemId: 'potion', count: 1 }));
    const view = buildBankView(
      bankInfo({ slots, capacity: 48, purchasedSlots: 18, bonusSlots: 6 }),
      lookup,
    );
    if (view.kind !== 'bank') throw new Error('expected bank');
    expect(view.capacity).toEqual({ used: 37, total: 48, purchasedSlots: 18, bonusSlots: 6 });
    expect(view.emptyCells).toBe(11); // 48 - 37
  });

  it('clamps the empty pad to 0 on an over-capacity (legacy/tampered) save', () => {
    const slots: InvSlot[] = Array.from({ length: 50 }, () => ({ itemId: 'potion', count: 1 }));
    const view = buildBankView(bankInfo({ slots, capacity: 48 }), lookup);
    if (view.kind !== 'bank') throw new Error('expected bank');
    expect(view.capacity.used).toBe(50);
    expect(view.emptyCells).toBe(0); // never negative
  });

  it('threads a mid-ladder expansion cost into the buy panel', () => {
    const view = buildBankView(bankInfo({ nextExpansionCost: 2500 }), lookup);
    if (view.kind !== 'bank') throw new Error('expected bank');
    expect(view.buy).toEqual({ nextCost: 2500, blockSlots: 6, maxed: false });
  });

  it('reports maxed when there is no next expansion', () => {
    const view = buildBankView(bankInfo({ nextExpansionCost: null }), lookup);
    if (view.kind !== 'bank') throw new Error('expected bank');
    expect(view.buy.nextCost).toBe(null);
    expect(view.buy.maxed).toBe(true);
    expect(view.buy.blockSlots).toBe(6);
  });
});

describe('buildBankView: the footer capacity meter (phase 08)', () => {
  const filled = (n: number): InvSlot[] =>
    Array.from({ length: n }, () => ({ itemId: 'potion', count: 1 }));
  const meterOf = (over: Partial<BankInfo>) => {
    const view = buildBankView(bankInfo(over), lookup);
    if (view.kind !== 'bank') throw new Error('expected bank');
    return view.meter;
  };

  it('pins the near-full threshold constant literally', () => {
    expect(BANK_NEAR_FULL_FRACTION).toBe(0.85);
  });

  it('models an empty bank: zero fractions (never NaN), no flags, no materials', () => {
    expect(meterOf({ capacity: 24, generalCapacity: 24 })).toEqual({
      used: 0,
      total: 24,
      general: { used: 0, capacity: 24, fraction: 0, over: false },
      materials: { used: 0, capacity: 0, fraction: 0, over: false },
      showMaterials: false,
      nearFull: false,
      over: false,
    });
  });

  it('a zero-capacity pool reads fraction 0, never NaN (the divide guard)', () => {
    const meter = meterOf({ capacity: 0, generalCapacity: 0, slots: [] });
    expect(meter.general.fraction).toBe(0);
    expect(meter.materials.fraction).toBe(0);
  });

  it('one slot used: the display pair and the general fraction move together', () => {
    const meter = meterOf({ slots: filled(1), capacity: 24, generalCapacity: 24, generalUsed: 1 });
    expect(meter.used).toBe(1);
    expect(meter.total).toBe(24);
    expect(meter.general.fraction).toBe(1 / 24);
    expect(meter.nearFull).toBe(false);
    expect(meter.over).toBe(false);
  });

  it('just below the threshold (general 40/48) is NOT near-full', () => {
    const meter = meterOf({
      slots: filled(40),
      capacity: 48,
      generalCapacity: 48,
      generalUsed: 40,
    });
    expect(meter.general.fraction).toBeLessThan(BANK_NEAR_FULL_FRACTION);
    expect(meter.nearFull).toBe(false);
  });

  it('EXACTLY at the threshold (general 34/40) IS near-full (>=, not >)', () => {
    const meter = meterOf({
      slots: filled(34),
      capacity: 40,
      generalCapacity: 40,
      generalUsed: 34,
    });
    expect(meter.general.fraction).toBe(BANK_NEAR_FULL_FRACTION);
    expect(meter.nearFull).toBe(true);
  });

  it('just above the threshold (general 35/40) is near-full', () => {
    expect(
      meterOf({ slots: filled(35), capacity: 40, generalCapacity: 40, generalUsed: 35 }).nearFull,
    ).toBe(true);
  });

  it('exactly full: fraction 1, near-full, but NOT over', () => {
    const meter = meterOf({
      slots: filled(24),
      capacity: 24,
      generalCapacity: 24,
      generalUsed: 24,
    });
    expect(meter.general.fraction).toBe(1);
    expect(meter.nearFull).toBe(true);
    expect(meter.over).toBe(false);
    expect(meter.general.over).toBe(false);
  });

  it('over capacity (used > total): the fraction stays honest past 1 and over is set', () => {
    const meter = meterOf({
      slots: filled(26),
      capacity: 24,
      generalCapacity: 24,
      generalUsed: 26,
    });
    expect(meter.used).toBe(26);
    expect(meter.general.fraction).toBeGreaterThan(1); // UNCLAMPED: the painter clamps only the drawn width
    expect(meter.over).toBe(true);
    expect(meter.general.over).toBe(true);
    expect(meter.nearFull).toBe(true);
  });

  it('a maxed ladder still carries the meter (the footer keeps the readout)', () => {
    const view = buildBankView(bankInfo({ nextExpansionCost: null }), lookup);
    if (view.kind !== 'bank') throw new Error('expected bank');
    expect(view.buy.maxed).toBe(true);
    expect(view.meter.total).toBe(24);
  });

  it('bonus slots ride the total: meter.total is the summed wire capacity', () => {
    const meter = meterOf({ capacity: 30, bonusSlots: 6, generalCapacity: 30 });
    expect(meter.total).toBe(30);
  });

  it('materials usage ALONE shows the materials segment (stranded after an unsocket)', () => {
    const meter = meterOf({
      slots: filled(2),
      capacity: 24,
      generalCapacity: 24,
      materialsCapacity: 0,
      generalUsed: 0,
      materialsUsed: 2,
    });
    expect(meter.showMaterials).toBe(true);
    expect(meter.materials.over).toBe(true); // 2 used against a 0 budget: tolerated, honest
  });

  it('TRUTH PIN: near-full keys on the GENERAL pool while the naive total lies calm', () => {
    // Materials-only satchels socketed: general 18/20 (90 percent, non-material
    // deposits are about to refuse) while the OVERALL 20/36 sits well under the
    // threshold. A meter keyed on the naive total would stay quiet here.
    const meter = meterOf({
      slots: filled(20),
      capacity: 36,
      generalCapacity: 20,
      materialsCapacity: 16,
      generalUsed: 18,
      materialsUsed: 2,
    });
    expect(meter.used / meter.total).toBeLessThan(BANK_NEAR_FULL_FRACTION);
    expect(meter.nearFull).toBe(true);
    expect(meter.showMaterials).toBe(true);
  });

  it('the converse: materials nearly full with a roomy general pool is NOT near-full', () => {
    // Kills the swap mutants both ways: keying on the materials fraction
    // (15/16 = 0.9375) or the overall would each read differently from the
    // general pool's honest 4/20.
    const meter = meterOf({
      slots: filled(19),
      capacity: 36,
      generalCapacity: 20,
      materialsCapacity: 16,
      generalUsed: 4,
      materialsUsed: 15,
    });
    expect(meter.materials.fraction).toBeGreaterThan(BANK_NEAR_FULL_FRACTION);
    expect(meter.nearFull).toBe(false);
    expect(meter.showMaterials).toBe(true);
  });
});

describe('the displayed price comes from BankInfo off the wire (no client price ladder)', () => {
  // The phase 09 tunables rule: the sim's BANK_EXPANSION_PRICES /
  // BANK_SOCKET_PRICES ladders must never leak into the bank UI. The only
  // prices the view or painter touch are BankInfo.nextExpansionCost /
  // nextSocketCost, shipped by the server, so a server-side retune reaches
  // every client without a bundle update. bank_view.ts legitimately imports
  // BANK_EXPANSION_SLOTS from '../sim/bank' (a block SIZE, not a price); the
  // scan bans only price ladders.
  const uiSource = (relPath: string): string =>
    readFileSync(fileURLToPath(new URL(`../${relPath}`, import.meta.url)), 'utf8');

  it.each([
    'src/ui/bank_view.ts',
    'src/ui/bank_window.ts',
    // Phase 17 moved the bonus footer and the rung purchase flow out of the painter.
    // An ALL-NEGATIVE ban cannot notice its subject leaving the corpus, so the two
    // new modules join the list in the same change the code did.
    'src/ui/bank_bonus_view.ts',
    'src/ui/bank_rung_purchase_core.ts',
    'src/ui/bank_buy_prompt.ts',
    'src/ui/bags_view.ts',
    'src/ui/bags_window.ts',
    'src/ui/guild_bank_window.ts',
    'src/ui/vault_window.ts',
  ])('%s references no price ladder', (relPath) => {
    const src = uiSource(relPath);
    expect(src).not.toMatch(/BANK_(EXPANSION|SOCKET)_PRICES/);
    for (const m of src.matchAll(
      /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'\.\.\/sim\/(?:bank|bank_sockets)'/g,
    )) {
      expect(m[1]).not.toMatch(/PRICES/);
    }
  });

  it('liveness anchor: the banned ladder names still exist in the sim', () => {
    // Without this the whole-file ban is a never-present-token pin: a sim-side
    // rename of the ladders would silently disarm it (the scan would hunt
    // names nothing declares). A rename now reds HERE, forcing the ban regex
    // to move with it. (Path liveness is inherent: uiSource throws on a
    // renamed scan target.)
    const simBank = uiSource('src/sim/bank.ts');
    expect(simBank).toMatch(/export const BANK_EXPANSION_PRICES/);
    expect(simBank).toMatch(/export const BANK_SOCKET_PRICES/);
  });

  it('positive control: the import matcher sees the sanctioned bank import', () => {
    // Without this, a rewritten import style (namespace import, a re-export)
    // would let the per-import scan above go vacuously green; the whole-file
    // ladder-name ban still holds either way.
    const src = uiSource('src/ui/bank_view.ts');
    const imports = [
      ...src.matchAll(
        /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'\.\.\/sim\/(?:bank|bank_sockets)'/g,
      ),
    ];
    expect(imports.length).toBeGreaterThanOrEqual(1);
    expect(imports.map((m) => m[1]).join(',')).toContain('BANK_EXPANSION_SLOTS');
  });
});

describe('buildBankView: the bag-socket row (phase 07)', () => {
  // The socket lookup needs the bag facts too; the grid lookup above stays
  // quality-only, so this describe carries its own.
  const socketLookup: BankItemLookup = (id) =>
    (
      ({
        linen_pouch: { quality: 'common', kind: 'bag', bagSlots: 6 },
        burlap_pouch: { quality: 'common', kind: 'bag', bagSlots: 8, materialsOnly: true },
        fine_satchel: { quality: 'rare', kind: 'bag', bagSlots: 12, materialsOnly: true },
      }) as Record<
        string,
        { quality?: string; kind?: string; bagSlots?: number; materialsOnly?: boolean }
      >
    )[id];

  it('projects locked cells with the wire price ONLY on the next unlock', () => {
    const view = buildBankView(
      bankInfo({ socketsUnlocked: 1, nextSocketCost: 2000000 }),
      socketLookup,
    );
    if (view.kind !== 'bank') throw new Error('expected bank');
    expect(view.sockets).toEqual([
      { kind: 'empty', socket: 0 },
      { kind: 'locked', socket: 1, unlockCost: 2000000 },
      { kind: 'locked', socket: 2, unlockCost: null },
      { kind: 'locked', socket: 3, unlockCost: null },
    ]);
  });

  it('projects a filled cell with its slot count, pool, and quality', () => {
    const view = buildBankView(
      bankInfo({
        socketsUnlocked: 2,
        socketBags: ['linen_pouch', 'fine_satchel', null, null],
        nextSocketCost: 3500000,
      }),
      socketLookup,
    );
    if (view.kind !== 'bank') throw new Error('expected bank');
    expect(view.sockets[0]).toEqual({
      kind: 'filled',
      socket: 0,
      itemId: 'linen_pouch',
      slots: 6,
      slotsLineKey: 'itemUi.tooltip.bagSlots',
      qualityKey: 'common',
    });
    expect(view.sockets[1]).toEqual({
      kind: 'filled',
      socket: 1,
      itemId: 'fine_satchel',
      slots: 12,
      // The shared bagSlotsLineKey decision: a materials-only satchel names
      // the materials pool, since that is what its slots actually buy.
      slotsLineKey: 'itemUi.tooltip.bagSlotsMaterials',
      qualityKey: 'rare',
    });
    // Socket 2 is the NEXT unlock (index === socketsUnlocked), so it carries
    // the wire price; socket 3 is a later rung with no honest price yet.
    expect(view.sockets[2]).toEqual({ kind: 'locked', socket: 2, unlockCost: 3500000 });
    expect(view.sockets[3]).toEqual({ kind: 'locked', socket: 3, unlockCost: null });
  });

  it('a fully unlocked row carries no locked cell and a null nextSocketCost never leaks a price', () => {
    const view = buildBankView(
      bankInfo({ socketsUnlocked: 4, nextSocketCost: null }),
      socketLookup,
    );
    if (view.kind !== 'bank') throw new Error('expected bank');
    expect(view.sockets.map((c) => c.kind)).toEqual(['empty', 'empty', 'empty', 'empty']);
  });

  it('an unknown socketed id renders as a zero-slot general bag, never vanishing (R34)', () => {
    const view = buildBankView(
      bankInfo({ socketsUnlocked: 1, socketBags: ['ghost_bag', null, null, null] }),
      socketLookup,
    );
    if (view.kind !== 'bank') throw new Error('expected bank');
    expect(view.sockets[0]).toEqual({
      kind: 'filled',
      socket: 0,
      itemId: 'ghost_bag',
      slots: 0,
      slotsLineKey: 'itemUi.tooltip.bagSlots',
      qualityKey: 'common',
    });
  });
});

describe('bankPoolsOf and hasOpenBankSocket', () => {
  it('bankPoolsOf reads the wire split verbatim', () => {
    expect(bankPoolsOf(bankInfo({ generalCapacity: 30, materialsCapacity: 8 }))).toEqual({
      general: 30,
      materials: 8,
    });
  });

  it('hasOpenBankSocket is true only for an EMPTY socket inside the unlocked prefix', () => {
    expect(hasOpenBankSocket(bankInfo({ socketsUnlocked: 1 }))).toBe(true);
    // No sockets unlocked: the empty cells past the prefix do not count.
    expect(hasOpenBankSocket(bankInfo({ socketsUnlocked: 0 }))).toBe(false);
    // Every unlocked socket filled: no destination, the click deposits instead.
    expect(
      hasOpenBankSocket(bankInfo({ socketsUnlocked: 2, socketBags: ['a', 'b', null, null] })),
    ).toBe(false);
    // ...and freeing one of them re-arms the socket click.
    expect(
      hasOpenBankSocket(bankInfo({ socketsUnlocked: 2, socketBags: ['a', null, null, null] })),
    ).toBe(true);
  });

  it('tolerates thin fakes: null, undefined, and a socket-less mirror all read false', () => {
    expect(hasOpenBankSocket(null)).toBe(false);
    expect(hasOpenBankSocket(undefined)).toBe(false);
    expect(hasOpenBankSocket({} as Parameters<typeof hasOpenBankSocket>[0])).toBe(false);
  });
});

describe('buildBankView: bonus projection', () => {
  it('hides the bonus footer offline (bonusSources [] -> show false, empty rows)', () => {
    const view = buildBankView(bankInfo({ bonusSources: [], bonusSlots: 0 }), lookup);
    if (view.kind !== 'bank') throw new Error('expected bank');
    expect(view.bonus).toEqual({ show: false, total: 0, rows: [] });
  });

  it('projects earned and unearned link rows, deriving earned from slots > 0', () => {
    const view = buildBankView(
      bankInfo({
        bonusSlots: 2,
        bonusSources: [
          { id: 'email', slots: 2, maxSlots: 2 }, // earned
          { id: 'discord', slots: 0, maxSlots: 2 }, // unearned
          { id: 'wallet', slots: 0, maxSlots: 2 }, // unearned
        ],
      }),
      lookup,
    );
    if (view.kind !== 'bank') throw new Error('expected bank');
    expect(view.bonus.show).toBe(true);
    expect(view.bonus.total).toBe(2); // === info.bonusSlots
    expect(view.bonus.rows).toEqual([
      { id: 'email', slots: 2, maxSlots: 2, earned: true, count: undefined, cap: undefined },
      { id: 'discord', slots: 0, maxSlots: 2, earned: false, count: undefined, cap: undefined },
      { id: 'wallet', slots: 0, maxSlots: 2, earned: false, count: undefined, cap: undefined },
    ]);
  });

  it('carries referral count/cap through verbatim and marks it earned once slots > 0', () => {
    const view = buildBankView(
      bankInfo({
        bonusSlots: 4,
        bonusSources: [{ id: 'referral', slots: 4, maxSlots: 10, count: 2, cap: 5 }],
      }),
      lookup,
    );
    if (view.kind !== 'bank') throw new Error('expected bank');
    expect(view.bonus.rows[0]).toEqual({
      id: 'referral',
      slots: 4,
      maxSlots: 10,
      earned: true,
      count: 2,
      cap: 5,
    });
  });

  it('derives earned false at exactly slots 0 (the decisive per-row negative)', () => {
    const view = buildBankView(
      bankInfo({ bonusSlots: 0, bonusSources: [{ id: 'email', slots: 0, maxSlots: 2 }] }),
      lookup,
    );
    if (view.kind !== 'bank') throw new Error('expected bank');
    expect(view.bonus.rows[0].earned).toBe(false);
    expect(view.bonus.total).toBe(0);
  });

  it('preserves an unknown future source id in the projection (the painter skips it)', () => {
    // The projection stays shape-stable for a source the client does not yet know
    // (X, Twitch): the row rides through untouched; the painter is what drops it.
    const view = buildBankView(
      bankInfo({ bonusSlots: 2, bonusSources: [{ id: 'twitch', slots: 2, maxSlots: 2 }] }),
      lookup,
    );
    if (view.kind !== 'bank') throw new Error('expected bank');
    expect(view.bonus.rows[0]).toEqual({
      id: 'twitch',
      slots: 2,
      maxSlots: 2,
      earned: true,
      count: undefined,
      cap: undefined,
    });
  });
});

describe('bankSlotAction', () => {
  it('plain-clicks a whole withdraw', () => {
    expect(bankSlotAction({ itemId: 'sword', count: 1 }, 0, false)).toEqual({
      kind: 'withdraw',
      slotIndex: 0,
    });
  });

  it('shift + a multi-count fungible opens the split-stack prompt with max = count', () => {
    expect(bankSlotAction({ itemId: 'potion', count: 5 }, 2, true)).toEqual({
      kind: 'withdrawPartial',
      slotIndex: 2,
      max: 5,
    });
  });

  it('shift + a single-count stack is a whole withdraw (nothing to split)', () => {
    expect(bankSlotAction({ itemId: 'sword', count: 1 }, 1, true)).toEqual({
      kind: 'withdraw',
      slotIndex: 1,
    });
  });

  it('shift + an instanced slot withdraws whole regardless of count', () => {
    // count 2 is deliberate: it proves the instance guard, not the count, routes
    // this to a whole withdraw (the sim never splits a per-instance payload).
    const slot: InvSlot = { itemId: 'signed_blade', count: 2, instance: { signer: 'Fernando' } };
    expect(bankSlotAction(slot, 3, true)).toEqual({ kind: 'withdraw', slotIndex: 3 });
  });

  it('is a no-op on an empty cell (undefined slot)', () => {
    expect(bankSlotAction(undefined, 4, false)).toEqual({ kind: 'none' });
  });
});

describe('ClientWorld-vs-Sim parity', () => {
  // The Sim exposes its cloned bank snapshot directly; a ClientWorld mirrors it
  // from a server snapshot (a JSON round-trip). Drive the model from both a
  // Sim-shaped snapshot (with an instanced payload and nonzero bonusSlots) and its
  // JSON mirror, and assert identical output.
  it('yields identical models from a Sim-shaped and a mirror-shaped snapshot', () => {
    const simInfo: BankInfo = {
      slots: [
        { itemId: 'sword', count: 1 },
        { itemId: 'potion', count: 12 },
        {
          itemId: 'signed_blade',
          count: 1,
          instance: { signer: 'Fernando', rolled: { quality: 'epic', stats: { ap: 5 } } },
        },
      ],
      capacity: 36,
      purchasedSlots: 6,
      bonusSlots: 6,
      nextExpansionCost: 2500,
      bonusSources: [
        { id: 'email', slots: 2, maxSlots: 2 },
        { id: 'referral', slots: 4, maxSlots: 10, count: 2, cap: 5 },
      ],
      socketsUnlocked: 1,
      socketBags: ['wayfarers_backpack', null, null, null],
      nextSocketCost: 2000000,
      generalCapacity: 36,
      materialsCapacity: 0,
      generalUsed: 3,
      materialsUsed: 0,
    };
    const cliInfo = JSON.parse(JSON.stringify(simInfo)) as BankInfo;
    expect(buildBankView(simInfo, lookup)).toEqual(buildBankView(cliInfo, lookup));
    // The bonusSources fixture projects identically on both hosts (the referral row
    // keeps its count/cap; the link row has neither).
    const model = buildBankView(simInfo, lookup);
    if (model.kind !== 'bank') throw new Error('expected bank');
    expect(model.bonus).toEqual({
      show: true,
      total: 6,
      rows: [
        { id: 'email', slots: 2, maxSlots: 2, earned: true, count: undefined, cap: undefined },
        { id: 'referral', slots: 4, maxSlots: 10, earned: true, count: 2, cap: 5 },
      ],
    });
  });

  it('a split pool four rides both snapshot shapes into IDENTICAL meter models', () => {
    // The phase 08 wire fields: both hosts ship the same pool four, and the
    // meter must come out equal whether read off a Sim clone or the JSON
    // mirror. The expectation is a fresh literal, never the model itself.
    const simInfo = bankInfo({
      slots: Array.from({ length: 20 }, () => ({ itemId: 'potion', count: 1 })),
      capacity: 36,
      generalCapacity: 20,
      materialsCapacity: 16,
      generalUsed: 18,
      materialsUsed: 2,
    });
    const cliInfo = JSON.parse(JSON.stringify(simInfo)) as BankInfo;
    expect(buildBankView(simInfo, lookup)).toEqual(buildBankView(cliInfo, lookup));
    const model = buildBankView(cliInfo, lookup);
    if (model.kind !== 'bank') throw new Error('expected bank');
    expect(model.meter).toEqual({
      used: 20,
      total: 36,
      general: { used: 18, capacity: 20, fraction: 0.9, over: false },
      materials: { used: 2, capacity: 16, fraction: 0.125, over: false },
      showMaterials: true,
      nearFull: true,
      over: false,
    });
  });
});

// planDepositAllMaterials simulates each candidate deposit on deep clones via the sim's
// OWN moveBetweenContainers, so the plan is whatever the server will do. These tests pin
// the selection (materials only, never quest, unknown-id skipped), the DESCENDING order
// (so a splice never invalidates a later index), the whole-stack-or-skip rule with the
// `full` flag, and prove the plan replays cleanly against a REAL Sim.
describe('planDepositAllMaterials: selection and order (synthetic lookup)', () => {
  // Selection is honest-taxonomy set membership on REAL ids (phase 19,
  // src/sim/material_taxonomy.ts), so the material fixtures are real catalog
  // ids behind a synthetic lookup (a made-up id can never plan). The stacking
  // math inside moveBetweenContainers reads the live ITEMS table; every
  // fixture id here is distinct, so each stack still needs one free bank slot
  // (capacity is effectively a slot count here).
  const KINDS: Record<string, string> = {
    copper_ore: 'junk',
    iron_ore: 'junk',
    rough_hide: 'junk',
    game_meat: 'junk',
    simple_fishing_pole: 'tool',
    gear: 'weapon',
    quest1: 'quest',
  };
  const lookup: ItemLookup = (id) => (KINDS[id] ? ({ id, kind: KINDS[id] } as ItemDef) : undefined);
  // A socket-less bank's split: everything general (what bankPoolsOf yields
  // for a BankInfo with no materials satchel socketed).
  const flat = (general: number): PoolCapacity => ({ general, materials: 0 });

  it('plans only materials, descending, each as a whole-stack send; a tool never plans', () => {
    const inv: InvSlot[] = [
      { itemId: 'gear', count: 1 }, // 0 weapon: skip
      { itemId: 'copper_ore', count: 5 }, // 1 material
      { itemId: 'quest1', count: 1 }, // 2 quest: skip
      { itemId: 'iron_ore', count: 3 }, // 3 material
      { itemId: 'ghost', count: 1 }, // 4 unknown: skip
      { itemId: 'simple_fishing_pole', count: 1 }, // 5 tool: skip (phase 19 narrowing)
      { itemId: 'rough_hide', count: 2 }, // 6 material
    ];
    const plan = planDepositAllMaterials(inv, [], flat(24), lookup);
    expect(plan.sends).toEqual([
      { slot: 6, count: 2 },
      { slot: 3, count: 3 },
      { slot: 1, count: 5 },
    ]);
    expect(plan.stacks).toBe(3);
    expect(plan.full).toBe(false);
  });

  it('never plans a quest item and never mutates the inputs', () => {
    const inv: InvSlot[] = [
      { itemId: 'quest1', count: 2 },
      { itemId: 'copper_ore', count: 1 },
    ];
    const bank: InvSlot[] = [];
    const plan = planDepositAllMaterials(inv, bank, flat(24), lookup);
    expect(plan.sends).toEqual([{ slot: 1, count: 1 }]);
    expect(inv).toEqual([
      { itemId: 'quest1', count: 2 },
      { itemId: 'copper_ore', count: 1 },
    ]);
    expect(bank).toEqual([]);
  });

  it('plans an instanced material as a whole-stack send', () => {
    const inv: InvSlot[] = [{ itemId: 'copper_ore', count: 2, instance: { signer: 'X' } }];
    const plan = planDepositAllMaterials(inv, [], flat(24), lookup);
    expect(plan.sends).toEqual([{ slot: 0, count: 2 }]);
    expect(plan.full).toBe(false);
  });

  it('stops as the bank fills: only the fitting stacks are sent and full is set', () => {
    const inv: InvSlot[] = [
      { itemId: 'copper_ore', count: 1 },
      { itemId: 'iron_ore', count: 1 },
      { itemId: 'rough_hide', count: 1 },
      { itemId: 'game_meat', count: 1 },
    ];
    // Two free bank slots for four distinct materials: the two highest indices fit.
    const plan = planDepositAllMaterials(inv, [], flat(2), lookup);
    expect(plan.sends).toEqual([
      { slot: 3, count: 1 },
      { slot: 2, count: 1 },
    ]);
    expect(plan.stacks).toBe(2);
    expect(plan.full).toBe(true);
  });

  it('plans nothing (and is not full) when there are no materials', () => {
    const inv: InvSlot[] = [
      { itemId: 'gear', count: 1 },
      { itemId: 'quest1', count: 1 },
    ];
    expect(planDepositAllMaterials(inv, [], flat(24), lookup)).toEqual({
      sends: [],
      stacks: 0,
      full: false,
    });
  });

  it('plans nothing when the bags hold only a tool (not full: nothing was refused for room)', () => {
    const inv: InvSlot[] = [{ itemId: 'simple_fishing_pole', count: 1 }];
    expect(planDepositAllMaterials(inv, [], flat(24), lookup)).toEqual({
      sends: [],
      stacks: 0,
      full: false,
    });
  });

  it('the quest belt is live: a quest-kind def is skipped even when its id is in the taxonomy', () => {
    // Contrived on purpose: no real catalog id is both quest-kind and a set
    // member (the set filters to kind junk), so this lookup dresses a member
    // id in a quest kind to prove the plan's own guard acts rather than
    // free-riding on the taxonomy. The button gate has no such belt by
    // design: it answers from the taxonomy alone, and the second assertion
    // pins that asymmetry.
    const questLookup: ItemLookup = (id) =>
      id === 'copper_ore' ? ({ id, kind: 'quest' } as ItemDef) : lookup(id);
    const inv: InvSlot[] = [{ itemId: 'copper_ore', count: 3 }];
    expect(planDepositAllMaterials(inv, [], flat(24), questLookup)).toEqual({
      sends: [],
      stacks: 0,
      full: false,
    });
    expect(hasDepositableMaterials(inv, questLookup)).toBe(true);
  });

  it('reports the bank already full: nothing sent but full is set', () => {
    const inv: InvSlot[] = [{ itemId: 'copper_ore', count: 1 }];
    const plan = planDepositAllMaterials(inv, [{ itemId: 'gear', count: 1 }], flat(1), lookup);
    expect(plan).toEqual({ sends: [], stacks: 0, full: true });
  });

  it('consumes the two-pool split, not a flat total: the socket-aware precheck pin', () => {
    // The discriminating state is an OVER-OCCUPIED general pool (4 banked gear
    // past a 2-slot general budget: exactly the tolerated over-capacity a
    // socket swap or unsocket leaves) beside a 3-slot materials pool. The
    // honest split clamps per pool: materials keep their own 3-slot headroom
    // untouched by the gear overflow, so 3 of the 4 materials plan and the
    // fourth sets `full`. A flat-total revert (generalOnlyPools of the summed
    // 5) reads 5 - 4 = 1 free and plans only ONE, so this arm reds on any
    // un-splitting of the precheck while agreeing with the sim's own
    // freePoolSlots clamp (the #2139 one-free-slot-answer rule).
    const gear: InvSlot[] = Array.from({ length: 4 }, () => ({ itemId: 'gear', count: 1 }));
    const mats: InvSlot[] = [
      { itemId: 'copper_ore', count: 1 },
      { itemId: 'iron_ore', count: 1 },
      { itemId: 'rough_hide', count: 1 },
      { itemId: 'game_meat', count: 1 },
    ];
    const pools: PoolCapacity = { general: 2, materials: 3 };
    const plan = planDepositAllMaterials(mats, gear, pools, lookup);
    expect(plan.stacks).toBe(3);
    expect(plan.full).toBe(true);
    const flatRevert = planDepositAllMaterials(mats, gear, flat(5), lookup);
    expect(flatRevert.stacks).toBe(1); // the wrong answer the split exists to avoid
  });

  it('hasDepositableMaterials is true only when an honest material stack is present', () => {
    expect(hasDepositableMaterials([{ itemId: 'copper_ore', count: 1 }], lookup)).toBe(true);
    // The flip that motivated phase 19: a tool no longer enables the button.
    expect(hasDepositableMaterials([{ itemId: 'simple_fishing_pole', count: 1 }], lookup)).toBe(
      false,
    );
    expect(
      hasDepositableMaterials(
        [
          { itemId: 'gear', count: 1 },
          { itemId: 'quest1', count: 1 },
        ],
        lookup,
      ),
    ).toBe(false);
    expect(hasDepositableMaterials([{ itemId: 'ghost', count: 1 }], lookup)).toBe(false);
    expect(hasDepositableMaterials([], lookup)).toBe(false);
  });
});

describe('depositAllSummaryKey: the three-arm summary selection', () => {
  it('picks None when nothing moved (materials existed but none fit)', () => {
    expect(depositAllSummaryKey({ stacks: 0, full: true })).toBe('hudChrome.bank.depositAllNone');
  });

  it('picks Full when some stacks moved but at least one did not fit', () => {
    expect(depositAllSummaryKey({ stacks: 3, full: true })).toBe('hudChrome.bank.depositAllFull');
  });

  it('picks Done when every material stack fit', () => {
    expect(depositAllSummaryKey({ stacks: 3, full: false })).toBe('hudChrome.bank.depositAllDone');
  });
});

describe('planDepositAllMaterials: replays cleanly against a real Sim', () => {
  const BANKER = 'bursar_fernando';
  function bankerEntity(sim: Sim): Entity {
    for (const e of sim.entities.values()) {
      if (e.kind === 'npc' && e.templateId === BANKER) return e;
    }
    throw new Error('banker not spawned');
  }
  function moveToBanker(sim: Sim): void {
    const p = sim.entities.get(sim.playerId);
    if (!p) throw new Error('missing player');
    p.pos = { ...bankerEntity(sim).pos };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
  }
  function metaOf(sim: Sim) {
    const m = sim.meta(sim.playerId);
    if (!m) throw new Error('missing meta');
    return m;
  }
  // Distinct real honest-material ids (amber_hide and stag_antler, the old
  // fixtures, are quality-poor grey trash the phase 19 narrowing ruled out) so
  // each material occupies its own bank slot.
  const MATS = ['wolf_fang', 'rough_hide', 'spider_leg', 'game_meat'] as const;
  const GEAR = Object.values(REAL_ITEMS)
    .filter((d) => d.kind === 'weapon' || d.kind === 'armor')
    .map((d) => d.id);

  it('confirms the fixtures are honest materials: in the taxonomy, junk-kind, never poor', () => {
    for (const id of MATS) {
      const def = REAL_ITEMS[id];
      expect(MATERIAL_ITEM_IDS.has(id), id).toBe(true);
      expect(def?.kind, `${id} is ${def?.kind}`).toBe('junk');
      expect(def?.quality, `${id} is quality poor`).not.toBe('poor');
    }
  });

  it('deposits every planned stack with zero refusal when the bank has room', () => {
    const sim = new Sim({ seed: 11, playerClass: 'warrior', autoEquip: false });
    moveToBanker(sim);
    const m = metaOf(sim);
    m.inventory.length = 0;
    m.inventory.push(
      { itemId: MATS[0], count: 3 },
      { itemId: 'boar_hide', count: 1 }, // a quest item: must be skipped
      { itemId: MATS[1], count: 2 },
      { itemId: MATS[2], count: 5 },
    );
    m.bank.inventory.length = 0;
    const plan = planDepositAllMaterials(
      m.inventory,
      m.bank.inventory,
      bankPools(m.bank),
      (id) => REAL_ITEMS[id],
    );
    expect(plan.stacks).toBe(3);
    expect(plan.full).toBe(false);
    sim.drainEvents();
    const errors: SimEvent[] = [];
    for (const send of plan.sends) {
      sim.bankDeposit(send.slot, send.count);
      for (const ev of sim.drainEvents()) if (ev.type === 'error') errors.push(ev);
    }
    expect(errors).toEqual([]);
    // All three materials landed; the quest item stayed in the bags.
    expect(m.bank.inventory.map((s) => s.itemId).sort()).toEqual([...MATS.slice(0, 3)].sort());
    expect(m.inventory.map((s) => s.itemId)).toEqual(['boar_hide']);
  });

  it('moves an instanced (signed) material whole through the real sim, never merging it', () => {
    // #1145 corpse harvest stamps rare+ materials with an instance payload; the
    // deposit-all plan must carry such a slot through the real sim.bankDeposit as
    // one indivisible unit that never merges into a plain stack of the same id.
    const sim = new Sim({ seed: 13, playerClass: 'warrior', autoEquip: false });
    moveToBanker(sim);
    const m = metaOf(sim);
    m.inventory.length = 0;
    m.inventory.push(
      { itemId: MATS[0], count: 4 }, // plain fungible stack of the SAME id
      { itemId: MATS[0], count: 1, instance: { signer: 'Bankwyn' } }, // signed copy
    );
    m.bank.inventory.length = 0;
    const plan = planDepositAllMaterials(
      m.inventory,
      m.bank.inventory,
      bankPools(m.bank),
      (id) => REAL_ITEMS[id],
    );
    expect(plan.stacks).toBe(2);
    expect(plan.full).toBe(false);
    sim.drainEvents();
    const errors: SimEvent[] = [];
    for (const send of plan.sends) {
      sim.bankDeposit(send.slot, send.count);
      for (const ev of sim.drainEvents()) if (ev.type === 'error') errors.push(ev);
    }
    expect(errors).toEqual([]);
    expect(m.inventory).toEqual([]);
    // Two separate bank slots: the signed copy keeps its payload and count 1.
    const banked = m.bank.inventory.filter((s) => s.itemId === MATS[0]);
    expect(banked).toHaveLength(2);
    const signed = banked.find((s) => s.instance);
    expect(signed?.count).toBe(1);
    expect(signed?.instance).toEqual({ signer: 'Bankwyn' });
    expect(banked.find((s) => !s.instance)?.count).toBe(4);
  });

  it('replays a mid-run-full plan exactly: only the fitting stacks deposit, none refuse', () => {
    const sim = new Sim({ seed: 12, playerClass: 'warrior', autoEquip: false });
    moveToBanker(sim);
    const m = metaOf(sim);
    m.inventory.length = 0;
    m.inventory.push(
      { itemId: MATS[0], count: 3 }, // 0
      { itemId: MATS[1], count: 2 }, // 1
      { itemId: MATS[2], count: 5 }, // 2
      { itemId: MATS[3], count: 1 }, // 3
    );
    // Pre-fill the bank so only 2 of the 4 materials fit (24 - 22 = 2 free slots).
    m.bank.inventory.length = 0;
    for (let i = 0; i < 22; i++) m.bank.inventory.push({ itemId: GEAR[i], count: 1 });
    m.bank.purchasedSlots = 0;
    m.bank.bonusSlots = 0;
    const cap = bankCapacity(m.bank);
    expect(cap).toBe(24);
    const plan = planDepositAllMaterials(
      m.inventory,
      m.bank.inventory,
      bankPools(m.bank),
      (id) => REAL_ITEMS[id],
    );
    expect(plan.stacks).toBe(2);
    expect(plan.full).toBe(true);
    expect(plan.sends).toEqual([
      { slot: 3, count: 1 },
      { slot: 2, count: 5 },
    ]);
    sim.drainEvents();
    const errors: SimEvent[] = [];
    for (const send of plan.sends) {
      sim.bankDeposit(send.slot, send.count);
      for (const ev of sim.drainEvents()) if (ev.type === 'error') errors.push(ev);
    }
    expect(errors).toEqual([]);
    expect(m.bank.inventory.length).toBe(24); // filled exactly, no overflow
    expect(m.bank.inventory.some((s) => s.itemId === MATS[3])).toBe(true);
    expect(m.bank.inventory.some((s) => s.itemId === MATS[2])).toBe(true);
    // The two that did not fit remain in the bags.
    expect(m.inventory.some((s) => s.itemId === MATS[0])).toBe(true);
    expect(m.inventory.some((s) => s.itemId === MATS[1])).toBe(true);
  });
});

// Phase 19 acceptance (docs/design/professions-tuning-packet-review.md): the
// deposit-all sweep narrows to the honest taxonomy while the sim's per-item
// self-storage path deliberately does not.
describe('deposit-all narrows to the honest taxonomy (phase 19)', () => {
  const BANKER = 'bursar_fernando';
  function moveToBanker(sim: Sim): void {
    const p = sim.entities.get(sim.playerId);
    if (!p) throw new Error('missing player');
    for (const e of sim.entities.values()) {
      if (e.kind === 'npc' && e.templateId === BANKER) {
        p.pos = { ...e.pos };
        p.prevPos = { ...p.pos };
        sim.rebucket(p);
        return;
      }
    }
    throw new Error('banker not spawned');
  }
  function metaOf(sim: Sim) {
    const m = sim.meta(sim.playerId);
    if (!m) throw new Error('missing meta');
    return m;
  }
  const realLookup = (id: string) => REAL_ITEMS[id];

  // One representative of every included source class...
  const INCLUDED = [
    'iron_ore', // node yield
    'fine_copper_ore', // fine grade
    'rough_hide', // harvest component
    'pristine_hide', // pristine specimen
    'bone_fragments', // salvage return
    'spider_leg', // mob-drop reagent
    'arcanite_bar', // vendor staple (Q6: in)
    'raw_river_perch', // raw fishing catch (junk cooking reagent: in)
  ] as const;
  // ...and of every excluded class the settlement ruled on.
  const EXCLUDED = [
    'simple_fishing_pole', // gathering implement (kind tool)
    'gatherers_cache', // charm (kind tool by deliberate authoring)
    'amber_hide', // grey vendor trash (Q3: out)
    'guardian_core', // non-poor junk oddment (Q4: out)
    'boar_hide', // quest item
    'linen_pouch', // bag item
    'reins_valorsteed', // mount item
    'event_skin_token', // cosmetic token (kind tool, use skinSelect)
    'worn_sword', // equipment (kind weapon)
  ] as const;

  it('confirms every fixture id is real and classified as intended', () => {
    // An unknown id is ALSO skipped by the plan, so a typo in EXCLUDED would
    // pass the exclusion arms vacuously; this arm makes that impossible.
    for (const id of [...INCLUDED, ...EXCLUDED]) {
      expect(REAL_ITEMS[id], `${id} has no ITEMS def`).toBeTruthy();
    }
    for (const id of INCLUDED) expect(MATERIAL_ITEM_IDS.has(id), id).toBe(true);
    for (const id of EXCLUDED) expect(MATERIAL_ITEM_IDS.has(id), id).toBe(false);
    // Each EXCLUDED fixture must keep representing its ruled class: a content
    // re-authoring that changed a kind would silently hollow out the replay's
    // per-class coverage while the behavior assertions stayed green.
    const EXCLUDED_CLASS: Record<(typeof EXCLUDED)[number], { kind: string; quality?: string }> = {
      simple_fishing_pole: { kind: 'tool' },
      gatherers_cache: { kind: 'tool' },
      amber_hide: { kind: 'junk', quality: 'poor' },
      guardian_core: { kind: 'junk' },
      boar_hide: { kind: 'quest' },
      linen_pouch: { kind: 'bag' },
      reins_valorsteed: { kind: 'mount' },
      event_skin_token: { kind: 'tool' },
      worn_sword: { kind: 'weapon' },
    };
    for (const id of EXCLUDED) {
      const want = EXCLUDED_CLASS[id];
      expect(REAL_ITEMS[id]?.kind, id).toBe(want.kind);
      if (want.quality) expect(REAL_ITEMS[id]?.quality, id).toBe(want.quality);
    }
  });

  it('plans exactly the included classes and replays against a real Sim with zero errors', () => {
    const sim = new Sim({ seed: 17, playerClass: 'warrior', autoEquip: false });
    moveToBanker(sim);
    const m = metaOf(sim);
    m.inventory.length = 0;
    for (const itemId of EXCLUDED) m.inventory.push({ itemId, count: 1 });
    for (const itemId of INCLUDED) m.inventory.push({ itemId, count: 1 });
    m.bank.inventory.length = 0;
    const plan = planDepositAllMaterials(
      m.inventory,
      m.bank.inventory,
      bankPools(m.bank),
      realLookup,
    );
    expect(plan.stacks).toBe(INCLUDED.length);
    expect(plan.full).toBe(false);
    sim.drainEvents();
    const errors: SimEvent[] = [];
    for (const send of plan.sends) {
      sim.bankDeposit(send.slot, send.count);
      for (const ev of sim.drainEvents()) if (ev.type === 'error') errors.push(ev);
    }
    expect(errors).toEqual([]);
    expect(m.bank.inventory.map((s) => s.itemId).sort()).toEqual([...INCLUDED].sort());
    expect(m.inventory.map((s) => s.itemId).sort()).toEqual([...EXCLUDED].sort());
  });

  it('disables the button over a bag of only excluded classes, enables on one material', () => {
    const excludedOnly: InvSlot[] = EXCLUDED.map((itemId) => ({ itemId, count: 1 }));
    expect(hasDepositableMaterials(excludedOnly, realLookup)).toBe(false);
    expect(
      hasDepositableMaterials([...excludedOnly, { itemId: 'iron_ore', count: 1 }], realLookup),
    ).toBe(true);
  });

  it('a kind-tool item and grey trash still deposit through the per-item path', () => {
    // The overreach guard: the sim's any-non-quest self-storage behavior is
    // deliberate and phase 19 must not narrow it; only the SWEEP narrows.
    const sim = new Sim({ seed: 19, playerClass: 'warrior', autoEquip: false });
    moveToBanker(sim);
    const m = metaOf(sim);
    m.inventory.length = 0;
    m.inventory.push({ itemId: 'simple_fishing_pole', count: 1 });
    m.inventory.push({ itemId: 'amber_hide', count: 2 });
    m.bank.inventory.length = 0;
    sim.drainEvents();
    sim.bankDeposit(1, 2); // descending, like the sweep replay
    sim.bankDeposit(0, 1);
    const errors = sim.drainEvents().filter((ev) => ev.type === 'error');
    expect(errors).toEqual([]);
    expect(m.bank.inventory.map((s) => s.itemId).sort()).toEqual([
      'amber_hide',
      'simple_fishing_pole',
    ]);
    expect(m.inventory).toEqual([]);
  });
});
