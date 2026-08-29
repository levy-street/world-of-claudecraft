// The Materials Vault pure view-core (src/ui/vault_view.ts): the DOM-free
// model builder, the row click decision, the deposit-all prediction replay,
// the summary-key arms, and the withdraw shortfall explanation. Driven with
// BOTH Sim-shaped and ClientWorld-shaped inputs where they differ (the mirror
// adopts the wire object BY REFERENCE and can carry a dormant own '__proto__'
// stock key; the Sim hands out boundary clones): the core must not care.
//
// Capacity and price literals here are WIRE fixture values, not imports of the
// sim ladder: the whole point (pinned by the no-client-price source scan at
// the bottom) is that the core renders what the wire says, so a fixture that
// disagrees with the compiled ladder still renders the fixture.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VAULT_UPGRADE_PRICES } from '../src/sim/materials_vault';
import type { InvSlot } from '../src/sim/types';
import {
  buildVaultView,
  hasVaultDepositable,
  predictVaultDepositAll,
  vaultDepositAllSummaryKey,
  vaultRowAction,
  vaultWithdrawFit,
  vaultWithdrawNotice,
} from '../src/ui/vault_view';
import type { VaultInfo } from '../src/world_api';

// The item-facts lookup (BankItemLookup): quality only. The fixture table
// deliberately omits 'mystery_id' so unknown-id rows are exercised.
const LOOKUP_TABLE: Record<string, { quality?: string }> = {
  copper_ore: { quality: 'common' },
  ashwood_log: { quality: 'common' },
  frost_lotus: { quality: 'rare' },
};
const lookup = (id: string) => LOOKUP_TABLE[id];

const MATERIALS: ReadonlySet<string> = new Set(['copper_ore', 'ashwood_log', 'frost_lotus']);

function vinfo(
  stock: Record<string, number>,
  upgrades = 1,
  perMaterialCap = 40,
  nextUpgradeCost: number | null = 50000,
  special: InvSlot[] = [],
): VaultInfo {
  return { stock, special, upgrades, perMaterialCap, nextUpgradeCost };
}

function slot(itemId: string, count: number, extra: Partial<InvSlot> = {}): InvSlot {
  return { itemId, count, ...extra };
}

describe('buildVaultView', () => {
  it('null info (away from a banker) is the away state', () => {
    expect(buildVaultView(null, lookup)).toEqual({ kind: 'away' });
  });

  it('the locked rung-0 wire shape renders the unlock offer FROM THE WIRE PRICE', () => {
    // The exact shape tests/vault_wire.test.ts pins for a locked vault near a
    // banker; the 20000 is the wire's number, not a client table's.
    const model = buildVaultView(vinfo({}, 0, 0, 20000), lookup);
    expect(model).toEqual({ kind: 'locked', unlockCost: 20000, unlockCap: 40 });
    // A DIFFERENT wire price renders that price: the core echoes the server.
    const tuned = buildVaultView(vinfo({}, 0, 0, 123456), lookup);
    expect(tuned.kind).toBe('locked');
    if (tuned.kind === 'locked') expect(tuned.unlockCost).toBe(123456);
  });

  it('an empty unlocked vault is the empty state with the wire cap', () => {
    const model = buildVaultView(vinfo({}, 1, 40, 50000), lookup);
    if (model.kind !== 'vault') throw new Error(`expected vault, got ${model.kind}`);
    expect(model.empty).toBe(true);
    expect(model.rows).toEqual([]);
    expect(model.perMaterialCap).toBe(40);
    expect(model.upgrade).toEqual({
      currentUpgrades: 1,
      nextCost: 50000,
      maxed: false,
      nextCap: 80,
    });
  });

  it('rows come out in the deterministic base-adjacent order whatever the stock key order was', () => {
    // Postgres jsonb reorders keys online while the offline Sim keeps local
    // order; the core imposes the one order both hosts agree on. All-base
    // stocks keep plain itemId order (this arm is byte-identical to the
    // pre-QA alphabetical pin).
    const model = buildVaultView(vinfo({ frost_lotus: 2, ashwood_log: 4, copper_ore: 6 }), lookup);
    if (model.kind !== 'vault') throw new Error('expected vault');
    expect(model.rows.map((r) => r.itemId)).toEqual(['ashwood_log', 'copper_ore', 'frost_lotus']);
    expect(model.rows.map((r) => r.count)).toEqual([4, 6, 2]);
    expect(model.rows.map((r) => [r.canChooseQuantity, r.partialMax])).toEqual([
      [true, 4],
      [true, 6],
      [true, 2],
    ]);
    expect(model.rows.every((r) => r.cap === 40)).toBe(true);
    expect(model.empty).toBe(false);
  });

  it('puts partial-withdraw eligibility and its maximum in the row model', () => {
    const model = buildVaultView(vinfo({ ashwood_log: 1, copper_ore: 7 }), lookup);
    if (model.kind !== 'vault') throw new Error('expected vault');
    expect(
      model.rows.map(({ itemId, canChooseQuantity, partialMax }) => ({
        itemId,
        canChooseQuantity,
        partialMax,
      })),
    ).toEqual([
      { itemId: 'ashwood_log', canChooseQuantity: false, partialMax: null },
      { itemId: 'copper_ore', canChooseQuantity: true, partialMax: 7 },
    ]);
  });

  it('discriminates pooled and exact special rows, shares their cap, and clones identity fields', () => {
    const signed = slot('copper_ore', 2, { instance: { signer: 'Ada' } });
    const recipe = slot('copper_ore', 3, { craftedRecipeId: 'smelt_copper' });
    const unknown = slot('future_material', 1, { instance: { signer: 'Rin' } });
    const model = buildVaultView(
      vinfo({ copper_ore: 35 }, 1, 40, 50000, [recipe, signed, unknown]),
      lookup,
    );
    if (model.kind !== 'vault') throw new Error('expected vault');

    const copper = model.rows.filter((row) => row.itemId === 'copper_ore');
    expect(copper.map((row) => row.kind)).toEqual(['pooled', 'special', 'special']);
    expect(copper.every((row) => row.storedTotal === 40 && row.atCap)).toBe(true);
    const signedRow = copper.find(
      (row) => row.kind === 'special' && row.instance?.signer === 'Ada',
    );
    const recipeRow = copper.find(
      (row) => row.kind === 'special' && row.craftedRecipeId === 'smelt_copper',
    );
    expect(signedRow).toMatchObject({
      kind: 'special',
      count: 2,
      canChooseQuantity: false,
      partialMax: null,
      specialRef: { index: 1, instance: { signer: 'Ada' } },
    });
    expect(recipeRow).toMatchObject({
      kind: 'special',
      count: 3,
      canChooseQuantity: true,
      partialMax: 3,
      specialRef: { index: 0, craftedRecipeId: 'smelt_copper' },
    });
    expect(model.rows.find((row) => row.itemId === 'future_material')).toMatchObject({
      kind: 'special',
      known: false,
    });

    expect(signed.instance).toBeDefined();
    if (signed.instance) signed.instance.signer = 'Mutated after build';
    expect(signedRow?.kind === 'special' ? signedRow.instance?.signer : null).toBe('Ada');
    expect(signedRow?.kind === 'special' ? signedRow.specialRef.instance?.signer : null).toBe(
      'Ada',
    );
  });

  it('keeps duplicate special rows separately addressable by their snapshot indices', () => {
    const copy = (): InvSlot => slot('copper_ore', 1, { instance: { signer: 'Ada' } });
    const model = buildVaultView(vinfo({}, 1, 40, 50000, [copy(), copy()]), lookup);
    if (model.kind !== 'vault') throw new Error('expected vault');
    expect(model.rows.map((row) => (row.kind === 'special' ? row.specialRef.index : null))).toEqual(
      [0, 1],
    );
  });

  it('a fine grade sorts BESIDE its base (base first) and carries the fine flag (PIN MOVED)', () => {
    // PIN MOVED (Phase 04 QA, the v0.36.0 merge-drift repair): the release
    // made fine-beside-base the every-container rule (compareBagStacks in
    // src/sim/inventory_sort.ts; bank_filter and bag_filter both consume it),
    // and the vault pane sorted by bare itemId, which scatters
    // fine_copper_ore to the f-block away from copper_ore. The fixture is
    // chosen so the two orders DIFFER: bare itemId order would be
    // copper_ore, dry_kindling, fine_copper_ore.
    const model = buildVaultView(
      vinfo({ fine_copper_ore: 2, dry_kindling: 1, copper_ore: 3 }),
      lookup,
    );
    if (model.kind !== 'vault') throw new Error('expected vault');
    expect(model.rows.map((r) => r.itemId)).toEqual([
      'copper_ore',
      'fine_copper_ore',
      'dry_kindling',
    ]);
    expect(model.rows.map((r) => r.fine)).toEqual([false, true, false]);
  });

  it('at-cap and over-cap rows carry their flags; over-cap is TOLERATED, never truncated', () => {
    const model = buildVaultView(
      vinfo({ copper_ore: 40, ashwood_log: 90, frost_lotus: 39 }),
      lookup,
    );
    if (model.kind !== 'vault') throw new Error('expected vault');
    const [log, ore, lotus] = model.rows;
    expect(ore).toMatchObject({ itemId: 'copper_ore', atCap: true, overCap: false });
    // The tolerated legacy over-stock renders its REAL count (90 of 40).
    expect(log).toMatchObject({ itemId: 'ashwood_log', count: 90, atCap: true, overCap: true });
    expect(lotus).toMatchObject({ itemId: 'frost_lotus', atCap: false, overCap: false });
  });

  it('a dormant unknown id still renders as a row (recoverable stock), unknown-flagged', () => {
    const model = buildVaultView(vinfo({ mystery_id: 3 }), lookup);
    if (model.kind !== 'vault') throw new Error('expected vault');
    expect(model.rows).toHaveLength(1);
    expect(model.rows[0]).toMatchObject({
      itemId: 'mystery_id',
      count: 3,
      known: false,
      qualityKey: 'common',
    });
  });

  it('a dormant own __proto__ stock key becomes an ordinary row and pollutes no prototype', () => {
    // ClientWorld-shaped input: the mirror adopts the WIRE object by
    // reference, and a tolerated save can carry this key as own data.
    const stock = JSON.parse('{"__proto__": 5, "copper_ore": 1}') as Record<string, number>;
    const model = buildVaultView(vinfo(stock), lookup);
    if (model.kind !== 'vault') throw new Error('expected vault');
    expect(model.rows.map((r) => r.itemId)).toEqual(['__proto__', 'copper_ore']);
    expect(({} as Record<string, unknown>).copper_ore).toBeUndefined();
    // The fix-round N1 arm: an UNguarded baseMaterialFor answered
    // Object.prototype for this key (a bare keyed read walks the chain), so
    // the hostile row wore the fine mark and sorted under the coerced
    // "[object Object]" group. The hasOwn guard keeps it an ordinary
    // non-fine row in plain string order (which the toEqual above pins).
    expect(model.rows[0]?.fine).toBe(false);
  });

  it('the exhausted ladder is maxed with no next cap and no next price', () => {
    const model = buildVaultView(vinfo({ copper_ore: 1 }, 5, 200, null), lookup);
    if (model.kind !== 'vault') throw new Error('expected vault');
    expect(model.upgrade).toEqual({
      currentUpgrades: 5,
      nextCost: null,
      maxed: true,
      nextCap: null,
    });
    expect(model.perMaterialCap).toBe(200);
  });
});

describe('vaultRowAction', () => {
  it('plain click withdraws; shift on a multi-count row splits; shift on one withdraws', () => {
    expect(vaultRowAction(5, false)).toEqual({ kind: 'withdraw' });
    expect(vaultRowAction(5, true)).toEqual({ kind: 'withdrawPartial', max: 5 });
    expect(vaultRowAction(1, true)).toEqual({ kind: 'withdraw' });
    expect(vaultRowAction(0, false)).toEqual({ kind: 'none' });
  });
});

describe('predictVaultDepositAll (the click-time replay of the sim sweep)', () => {
  it('a locked vault predicts nothing', () => {
    const inv = [slot('copper_ore', 5)];
    expect(predictVaultDepositAll(inv, vinfo({}, 0, 0), MATERIALS)).toEqual({
      stacks: 0,
      items: 0,
      full: false,
    });
  });

  it('mirrors the sim: per-material headroom clamp, DESCENDING, skip set intact', () => {
    // Two copper stacks (idx 0 and 3): headroom 30 takes the HIGHER-indexed 20
    // whole, then the exact special stacks, then 7 of the first (partial ->
    // full). Identity/provenance are preserved by the sim but are eligible for
    // this sweep; only the non-material stays carried.
    const inv = [
      slot('copper_ore', 20),
      slot('rusty_dagger', 1),
      slot('copper_ore', 3, { instance: { signer: 'Ana' } as InvSlot['instance'] }),
      slot('copper_ore', 20),
      slot('ashwood_log', 4, { craftedRecipeId: 'recipe_x' }),
      slot('ashwood_log', 2),
    ];
    const p = predictVaultDepositAll(inv, vinfo({ copper_ore: 10 }, 1, 40), MATERIALS);
    // Whole stacks: copper idx 3 + signed idx 2 + both log rows = 4 stacks;
    // items: 20 + 3 + 4 + 2 + 7 = 36; full: the partial final fill.
    expect(p).toEqual({ stacks: 4, items: 36, full: true });
  });

  it('counts existing special stock against the shared cap and never splits an instance', () => {
    const info = vinfo({ copper_ore: 30 }, 1, 40, 50000, [
      slot('copper_ore', 8, { craftedRecipeId: 'smelt_copper' }),
    ]);
    const inv = [slot('copper_ore', 5, { instance: { signer: 'Ada' } })];
    expect(predictVaultDepositAll(inv, info, MATERIALS)).toEqual({
      stacks: 0,
      items: 0,
      full: true,
    });
  });

  it('a corrupt degenerate carried count is skipped by the shared predicate', () => {
    // The replay must mirror the sim's degenerate-count guard exactly (one
    // exported predicate feeds both), or a tampered save would show a summary
    // for stock the sweep refuses to touch, or worse, predict a destruction.
    const inv = [slot('copper_ore', -3), slot('copper_ore', 0), slot('copper_ore', Number.NaN)];
    expect(predictVaultDepositAll(inv, vinfo({ copper_ore: 10 }), MATERIALS)).toEqual({
      stacks: 0,
      items: 0,
      full: false,
    });
    expect(hasVaultDepositable(inv, MATERIALS)).toBe(false);
  });

  it('a past-precision or fractional carried count is skipped by the same arm', () => {
    // The mint class the sim refuses (the decrement would be a float no-op):
    // the prediction must refuse it identically, or the summary would claim a
    // deposit the sweep never makes. The shared predicate's MAX_SAFE_INTEGER
    // arm covers both sides in one place.
    const inv = [
      slot('copper_ore', 1e21),
      slot('copper_ore', Number.POSITIVE_INFINITY),
      slot('copper_ore', 2.5), // fractional: the delayed-destruction arm
    ];
    expect(predictVaultDepositAll(inv, vinfo({}, 1, 40), MATERIALS)).toEqual({
      stacks: 0,
      items: 0,
      full: false,
    });
    expect(hasVaultDepositable(inv, MATERIALS)).toBe(false);
  });

  it('a material already at its ceiling flags full with zero movement', () => {
    const inv = [slot('copper_ore', 5)];
    expect(predictVaultDepositAll(inv, vinfo({ copper_ore: 40 }, 1, 40), MATERIALS)).toEqual({
      stacks: 0,
      items: 0,
      full: true,
    });
  });

  it('does NOT mutate the snapshot it replays (inventory or stock)', () => {
    const inv = [slot('copper_ore', 5)];
    const info = vinfo({ copper_ore: 1 });
    predictVaultDepositAll(inv, info, MATERIALS);
    expect(inv[0].count).toBe(5);
    expect(info.stock).toEqual({ copper_ore: 1 });
  });

  it('a dormant own __proto__ stock row is headroom data, not a prototype write', () => {
    const stock = JSON.parse('{"__proto__": 40}') as Record<string, number>;
    const materials = new Set(['__proto__']);
    // The dormant row is AT cap: nothing moves and nothing lands on
    // Object.prototype (the Map-not-spread rule in the core).
    const p = predictVaultDepositAll([slot('__proto__', 3)], vinfo(stock, 1, 40), materials);
    expect(p).toEqual({ stacks: 0, items: 0, full: true });
    // The equality ABOVE is the decisive arm: a plain-record `held` built by
    // keyed ASSIGNMENT would send the row into the __proto__ setter, read
    // `have` back off the inherited accessor, and produce
    // { stacks: 1, items: NaN, full: false }. There is no residue to assert
    // separately (the setter swallows a non-object value without landing
    // anything on Object.prototype), so no second assertion exists here.
  });
});

describe('hasVaultDepositable (the button enable)', () => {
  it('true for a plain material stack; ignores headroom by design', () => {
    expect(hasVaultDepositable([slot('copper_ore', 1)], MATERIALS)).toBe(true);
  });
  it('accepts identity/provenance materials and still rejects non-materials', () => {
    expect(hasVaultDepositable([slot('rusty_dagger', 1)], MATERIALS)).toBe(false);
    expect(
      hasVaultDepositable(
        [slot('copper_ore', 1, { instance: { signer: 'A' } as InvSlot['instance'] })],
        MATERIALS,
      ),
    ).toBe(true);
    expect(hasVaultDepositable([slot('copper_ore', 1, { craftedRecipeId: 'r' })], MATERIALS)).toBe(
      true,
    );
  });
});

describe('vaultDepositAllSummaryKey', () => {
  it('exactly one of three arms: none / full / done', () => {
    expect(vaultDepositAllSummaryKey({ items: 0, full: true })).toBe(
      'hudChrome.bank.vaultDepositAllNone',
    );
    expect(vaultDepositAllSummaryKey({ items: 0, full: false })).toBe(
      'hudChrome.bank.vaultDepositAllNone',
    );
    expect(vaultDepositAllSummaryKey({ items: 3, full: true })).toBe(
      'hudChrome.bank.vaultDepositAllFull',
    );
    expect(vaultDepositAllSummaryKey({ items: 3, full: false })).toBe(
      'hudChrome.bank.vaultDepositAllDone',
    );
  });
});

describe('vaultWithdrawFit + vaultWithdrawNotice (the shortfall explanation)', () => {
  it('fit is pool-aware: a socketed materials satchel keeps a withdraw alive past the flat total', () => {
    // The discriminating fixture for the two-pool migration (vault_view.ts
    // vaultWithdrawFit): 17 gear slots sit OVER the 16-slot general pool
    // after a satchel swap, and 11 full ore stacks leave one materials slot.
    // The old flat pooled-total model reads 28 used of 28 and answers 0; the
    // two-pool gate finds the free materials slot, so one fresh stack (20)
    // of a different material still fits. Without the satchel there is no
    // headroom anywhere, pinning that the pools derive from the bags
    // argument rather than any precomputed scalar.
    const gear: InvSlot[] = Array.from({ length: 17 }, (_, i) => slot(`gear_${i}`, 1));
    const ore: InvSlot[] = Array.from({ length: 11 }, () => slot('copper_ore', 20));
    const inv = [...gear, ...ore];
    expect(
      vaultWithdrawFit(inv, ['foragers_haversack', null, null, null], 'silverleaf_herb', 40),
    ).toBe(20);
    expect(vaultWithdrawFit(inv, [null, null, null, null], 'silverleaf_herb', 40)).toBe(0);
  });

  it('fit is the sim countFit answer over the click-time snapshot', () => {
    // One backpack-only rig: no bags equipped resolves to the base capacity,
    // and an inventory already holding a partial stack can absorb into it.
    // 16 base slots, 14 distinct 1-stack gear fillers + a 15/20 copper stack
    // = 15 used: one free slot + 5 stack headroom = 25 fit for a 40 ask.
    const gear: InvSlot[] = Array.from({ length: 14 }, (_, i) => slot(`gear_${i}`, 1));
    const inv = [...gear, slot('copper_ore', 15)];
    const fit = vaultWithdrawFit(inv, [null, null, null, null], 'copper_ore', 40);
    // countFit models stacking exactly (stackSize 20): 5 into the open stack,
    // 20 into the one free slot.
    expect(fit).toBe(25);
  });

  it('passes identity/provenance into countFit and keeps instances all-or-nothing', () => {
    const inv = Array.from({ length: 15 }, (_, i) => slot(`gear_${i}`, 1));
    const bags = [null, null, null, null];
    expect(vaultWithdrawFit(inv, bags, 'copper_ore', 30, { signer: 'Ada' }, 'smelt_copper')).toBe(
      0,
    );
    expect(vaultWithdrawFit(inv, bags, 'copper_ore', 30, undefined, 'smelt_copper')).toBe(20);
  });

  it('notice arms: silent when all fits, silent when NOTHING fits, short otherwise', () => {
    expect(vaultWithdrawNotice(40, 40)).toEqual({ kind: 'none' });
    expect(vaultWithdrawNotice(41, 40)).toEqual({ kind: 'none' });
    // Zero fit: the sim emits its own bags-full line; a second client line
    // would double-speak (the recorded resolution of the phase 01 open call).
    expect(vaultWithdrawNotice(0, 40)).toEqual({ kind: 'none' });
    expect(vaultWithdrawNotice(25, 40)).toEqual({ kind: 'short', fit: 25 });
  });
});

describe('no client-side price constant (source scan)', () => {
  it('no vault-price blast-radius module reads VAULT_UPGRADE_PRICES or any rung literal', () => {
    // The acceptance grep, pinned: every displayed price comes from the wire
    // snapshot. The two ladder-GEOMETRY constants (base cap / step) are the
    // BANK_EXPANSION_SLOTS precedent and stay allowed. Comments are stripped
    // so a mention in prose cannot trip it, nor mask a real import. The
    // literal arm loops the REAL exported table (an absence check against
    // live values, not a self-comparison), so a fifth rung added later is
    // scanned without anyone editing this test; bank_window.ts joins the
    // list because its repaint signature reads the wire price and is the
    // third module a hardcoded rung could plausibly land in.
    for (const rel of [
      '../src/ui/vault_view.ts',
      '../src/ui/vault_window.ts',
      '../src/ui/bank_window.ts',
      // Same reason bank_window.ts is here, followed to where the code went: phase 17
      // moved the bonus footer and the rung purchase flow into these siblings, and an
      // all-negative ban stays green over a file that no longer holds the subject.
      '../src/ui/bank_bonus_view.ts',
      '../src/ui/bank_rung_purchase_core.ts',
    ]) {
      const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      expect(src, `${rel} must not read the price table`).not.toContain('VAULT_UPGRADE_PRICES');
      for (const price of VAULT_UPGRADE_PRICES) {
        // Digit-bounded, not a substring: '20000' is a substring of '200000',
        // and bank_window.ts is a wide coordinator where an unrelated future
        // literal (a timeout, a byte budget) must not red a PRICE claim.
        expect(src, `${rel} must not hardcode rung price ${price}`).not.toMatch(
          new RegExp(`(?<![0-9])${price}(?![0-9])`),
        );
      }
    }
    // The loop above walks the live ladder: prove it saw the whole table.
    expect(VAULT_UPGRADE_PRICES.length).toBe(5);
  });
});
