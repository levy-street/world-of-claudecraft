// The Exchange Vault (server/woc_market_held.ts): the pure rules and the
// service ladders over typed fakes. The coordinator-side arms (walletless
// listing intake, Vault buy-now intake, the delivery credit) are proven
// end to end in woc_market_service.test.ts.

import { describe, expect, it } from 'vitest';
import type { WocSettlementRow } from '../../server/woc_market';
import {
  ACCOUNT_PROOF_REFUSALS,
  HELD_QUOTE_REFUSED,
  heldCovers,
  heldPayRef,
  heldPayReverseRef,
  heldSaleRef,
  heldSignature,
  heldTokens,
  heldWithdrawRef,
  heldWithdrawReverseRef,
  isHeldBase,
  isHeldSignature,
  WOC_HELD_TOKEN_DECIMALS,
  type WocMarketHeldDeps,
  WocMarketHeldService,
  wocHeldWalletFromEnv,
} from '../../server/woc_market_held';
import { FakeWocMarketHeldDb } from './helpers/fake_woc_market_held_db';

const CUSTODY = 'CustodyWallet1111111111111111111111111111111';
const BUYER = 7;
const NOW = 1_700_000_000_000;

describe('the pure rules', () => {
  it('accepts only non-negative decimal base units', () => {
    expect(isHeldBase('0')).toBe(true);
    expect(isHeldBase('123456789012345678901234567890')).toBe(true);
    expect(isHeldBase('-5')).toBe(false);
    expect(isHeldBase('1.5')).toBe(false);
    expect(isHeldBase('')).toBe(false);
    expect(isHeldBase(5)).toBe(false);
    expect(isHeldBase(null)).toBe(false);
  });

  it('converts base units to display tokens at the mint decimals, exact figures untouched', () => {
    expect(WOC_HELD_TOKEN_DECIMALS).toBe(9);
    expect(heldTokens('1000000000')).toBe(1);
    expect(heldTokens('1500000000')).toBe(1.5);
    expect(heldTokens('0')).toBe(0);
    expect(heldTokens('junk')).toBe(0);
  });

  it('compares cover as big integers, never as floats', () => {
    expect(heldCovers('100000000000000000000', '99999999999999999999')).toBe(true);
    expect(heldCovers('99999999999999999999', '100000000000000000000')).toBe(false);
    expect(heldCovers('5', '5')).toBe(true);
    expect(heldCovers('x', '5')).toBe(false);
  });

  it('mints one ref per money movement, keyed on the settlement or a nonce', () => {
    expect(heldSaleRef(12)).toBe('held:sale:12');
    expect(heldPayRef(12)).toBe('held:pay:12');
    expect(heldPayReverseRef(12)).toBe('held:pay_reverse:12');
    expect(heldWithdrawRef(7, 'n1')).toBe('held:withdraw:7:n1');
    expect(heldWithdrawReverseRef('held:withdraw:7:n1')).toBe('held:withdraw:7:n1:reverse');
    expect(heldSignature('ref-1')).toBe('held:ref-1');
    expect(isHeldSignature('held:ref-1')).toBe(true);
    // A base58 signature can never carry ':'.
    expect(isHeldSignature('5KQwrPbwdL6PhXujxW37FSSu3XpP2fbz8nUq4t6ZfgH')).toBe(false);
    expect(isHeldSignature(null)).toBe(false);
  });

  it('maps every wallet re-auth outcome to its own woc_market refusal', () => {
    expect(ACCOUNT_PROOF_REFUSALS['wallet.reauth_required']).toBe('account_proof_required');
    expect(ACCOUNT_PROOF_REFUSALS['wallet.reauth_two_factor']).toBe('account_proof_two_factor');
    expect(ACCOUNT_PROOF_REFUSALS['wallet.reauth_no_password']).toBe('account_proof_no_password');
    expect(ACCOUNT_PROOF_REFUSALS['wallet.reauth_bad_password']).toBe('account_proof_invalid');
    expect(ACCOUNT_PROOF_REFUSALS['wallet.reauth_bad_two_factor']).toBe('account_proof_invalid');
    expect(ACCOUNT_PROOF_REFUSALS['wallet.reauth_bad_signature']).toBe('account_proof_invalid');
    expect(ACCOUNT_PROOF_REFUSALS['auth.too_many_failed_attempts']).toBe('account_proof_throttled');
  });

  it('reads the custody wallet from the env, blank meaning off', () => {
    expect(wocHeldWalletFromEnv({})).toBeNull();
    expect(wocHeldWalletFromEnv({ WOC_MARKET_HELD_WALLET: '  ' })).toBeNull();
    expect(wocHeldWalletFromEnv({ WOC_MARKET_HELD_WALLET: ` ${CUSTODY} ` })).toBe(CUSTODY);
  });

  it('the refused quote is a frozen, honest unavailability', () => {
    expect(HELD_QUOTE_REFUSED.ok).toBe(false);
    expect(HELD_QUOTE_REFUSED.reason).toBe('held_disabled');
    expect(HELD_QUOTE_REFUSED.signatureRequired).toBe(true);
    expect(Object.isFrozen(HELD_QUOTE_REFUSED)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The service over fakes
// ---------------------------------------------------------------------------

function settlement(over: Partial<WocSettlementRow> = {}): WocSettlementRow {
  return {
    id: 9,
    listingId: 3,
    bidId: null,
    attempt: 0,
    buyerAccount: BUYER,
    buyerCharacter: 55,
    buyerName: 'Buyer',
    buyerWallet: CUSTODY,
    amountCents: 500,
    state: 'offered',
    quoteReference: 'q-1',
    quoteExpiresAtMs: NOW + 60_000,
    txSignature: null,
    failReason: null,
    settledAmountBase: '500000000000',
    sellerLegBase: '450000000000',
    deadlineAtMs: NOW + 600_000,
    createdAtMs: NOW - 1_000,
    ...over,
  };
}

interface Rig {
  service: WocMarketHeldService;
  db: FakeWocMarketHeldDb;
  rows: Map<number, WocSettlementRow>;
  transitions: string[];
  delivered: number;
  settleHeld: { settled: boolean; pending: boolean; reason: string | null };
  withdrawal: { done: boolean; reason: string | null };
  wallets: Map<number, string>;
  proof: { ok: true } | { ok: false; code: 'wallet.reauth_bad_password' };
}

function rig(over: Partial<WocMarketHeldDeps> = {}): Rig {
  const rows = new Map<number, WocSettlementRow>();
  const db = new FakeWocMarketHeldDb((id) => rows.get(id)?.state ?? null);
  const state: Rig = {
    service: undefined as unknown as WocMarketHeldService,
    db,
    rows,
    transitions: [],
    delivered: 0,
    settleHeld: { settled: true, pending: false, reason: null },
    withdrawal: { done: true, reason: null },
    wallets: new Map(),
    proof: { ok: true },
  };
  state.service = new WocMarketHeldService({
    db,
    market: {
      settlementById: async (id) => rows.get(id) ?? null,
      submitSettlementSignature: async (id, signature) => {
        const row = rows.get(id);
        if (!row || row.state !== 'offered') return 'not_offered';
        rows.set(id, { ...row, state: 'confirming', txSignature: signature });
        return 'ok';
      },
      transitionSettlement: async (id, from, to, reason) => {
        const row = rows.get(id);
        if (!row || !from.includes(row.state)) return false;
        rows.set(id, { ...row, state: to, failReason: reason ?? row.failReason });
        state.transitions.push(`${row.state}->${to}`);
        return true;
      },
    },
    economy: {
      estimate: async (usdCents) => ({
        available: true,
        usdCents,
        amount: { base: String(usdCents * 1_000_000_000), tokens: usdCents },
        asOfMs: NOW,
        split: null,
      }),
      settleHeld: async () => state.settleHeld,
      heldWithdrawal: async () => state.withdrawal,
    },
    verifiedWallet: async (account) => state.wallets.get(account) ?? null,
    accountProof: async () => state.proof,
    custodyWallet: CUSTODY,
    now: () => NOW,
    deliverNow: async () => {
      state.delivered++;
    },
    nonce: () => 'n1',
    ...over,
  });
  return state;
}

describe('readout and guards', () => {
  it('reports the balance, the display tokens, and whether a cash-out is possible', async () => {
    const r = rig();
    await r.db.post({ account: BUYER, ref: 'seed', kind: 'sale', deltaBase: '2500000000' });
    expect(await r.service.readout(BUYER)).toMatchObject({
      enabled: true,
      base: '2500000000',
      tokens: 2.5,
      canWithdraw: false, // no wallet linked
    });
    r.wallets.set(BUYER, 'wallet-b');
    expect((await r.service.readout(BUYER)).canWithdraw).toBe(true);
    expect((await r.service.readout(99)).canWithdraw).toBe(false); // empty
  });

  it('is off without a custody wallet: every arm refuses, balances stay readable', async () => {
    const r = rig({ custodyWallet: null });
    await r.db.post({ account: BUYER, ref: 'seed', kind: 'sale', deltaBase: '5' });
    expect(r.service.enabled()).toBe(false);
    expect((await r.service.readout(BUYER)).base).toBe('5');
    expect(await r.service.guardCover(BUYER, 1)).toEqual({ ok: false, reason: 'held_disabled' });
    expect(await r.service.confirmFromHeld(BUYER, 9)).toEqual({
      ok: false,
      reason: 'held_disabled',
    });
    expect(await r.service.withdraw(BUYER)).toEqual({ ok: false, reason: 'held_disabled' });
    // A walletless listing needs the Vault: without it the honest answer is
    // the old one, link a wallet.
    expect(await r.service.guardAccountProof(BUYER, {})).toEqual({
      ok: false,
      reason: 'wallet_required',
    });
  });

  it('guardCover compares the balance to the live estimate', async () => {
    const r = rig();
    await r.db.post({ account: BUYER, ref: 'seed', kind: 'sale', deltaBase: '5000000000000' });
    expect(await r.service.guardCover(BUYER, 5000)).toBeNull();
    expect(await r.service.guardCover(BUYER, 5001)).toEqual({
      ok: false,
      reason: 'held_insufficient',
    });
  });

  it('guardAccountProof maps the re-auth verdict onto the market refusals', async () => {
    const r = rig();
    expect(await r.service.guardAccountProof(BUYER, { password: 'pw' })).toBeNull();
    r.proof = { ok: false, code: 'wallet.reauth_bad_password' };
    expect(await r.service.guardAccountProof(BUYER, { password: 'no' })).toEqual({
      ok: false,
      reason: 'account_proof_invalid',
    });
  });
});

describe('confirmFromHeld: charge first, then settle from custody', () => {
  it('charges the quoted amount, records the held signature, and confirms on a settled verdict', async () => {
    const r = rig();
    r.rows.set(9, settlement());
    await r.db.post({ account: BUYER, ref: 'seed', kind: 'sale', deltaBase: '600000000000' });
    const out = await r.service.confirmFromHeld(BUYER, 9);
    expect(out).toEqual({ ok: true, state: 'confirmed' });
    expect(await r.db.balance(BUYER)).toBe('100000000000');
    expect(r.rows.get(9)).toMatchObject({ state: 'confirmed', txSignature: 'held:q-1' });
    expect(r.transitions).toEqual(['confirming->confirmed']);
    expect(r.delivered).toBe(1);
    expect(r.db.rows.map((e) => e.ref)).toEqual(['seed', 'held:pay:9']);
  });

  it('refuses held_insufficient before touching the row when the balance is short', async () => {
    const r = rig();
    r.rows.set(9, settlement());
    await r.db.post({ account: BUYER, ref: 'seed', kind: 'sale', deltaBase: '1' });
    expect(await r.service.confirmFromHeld(BUYER, 9)).toEqual({
      ok: false,
      reason: 'held_insufficient',
    });
    expect(r.rows.get(9)?.state).toBe('offered');
    expect(await r.db.balance(BUYER)).toBe('1');
  });

  it('returns the charge and fails the row on a refused verdict', async () => {
    const r = rig();
    r.settleHeld = { settled: false, pending: false, reason: 'custody_short' };
    r.rows.set(9, settlement());
    await r.db.post({ account: BUYER, ref: 'seed', kind: 'sale', deltaBase: '600000000000' });
    expect(await r.service.confirmFromHeld(BUYER, 9)).toEqual({
      ok: false,
      reason: 'confirm_failed',
    });
    expect(r.rows.get(9)).toMatchObject({ state: 'failed', failReason: 'custody_short' });
    expect(await r.db.balance(BUYER)).toBe('600000000000');
    expect(r.db.rows.map((e) => e.kind)).toEqual(['sale', 'pay', 'pay_reverse']);
  });

  it('leaves the row confirming on a pending verdict, and the sweep arm returns the charge if it later fails', async () => {
    const r = rig();
    r.settleHeld = { settled: false, pending: true, reason: 'awaiting_finality' };
    r.rows.set(9, settlement());
    await r.db.post({ account: BUYER, ref: 'seed', kind: 'sale', deltaBase: '600000000000' });
    expect(await r.service.confirmFromHeld(BUYER, 9)).toEqual({
      ok: true,
      state: 'confirming',
      reason: 'awaiting_finality',
    });
    expect(await r.db.balance(BUYER)).toBe('100000000000');
    // Nothing to reverse while it is still deciding.
    expect(await r.service.reverseFailedPayments()).toBe(0);
    // The poll fails it: the next pass returns the money, once.
    r.rows.set(9, { ...(r.rows.get(9) as WocSettlementRow), state: 'failed' });
    expect(await r.service.reverseFailedPayments()).toBe(1);
    expect(await r.service.reverseFailedPayments()).toBe(0);
    expect(await r.db.balance(BUYER)).toBe('600000000000');
  });

  it('answers the outcome on a retry after the recording, never a second charge', async () => {
    const r = rig();
    r.rows.set(9, settlement({ state: 'delivering', txSignature: 'held:q-1' }));
    expect(await r.service.confirmFromHeld(BUYER, 9)).toEqual({ ok: true, state: 'delivering' });
    expect(r.db.rows).toHaveLength(0);
  });

  it("refuses a row that is not a Vault claim, not the caller's, missing, or expired", async () => {
    const r = rig();
    r.rows.set(9, settlement({ buyerWallet: 'wallet-b' }));
    expect(await r.service.confirmFromHeld(BUYER, 9)).toEqual({ ok: false, reason: 'not_active' });
    r.rows.set(9, settlement({ buyerAccount: 8 }));
    expect(await r.service.confirmFromHeld(BUYER, 9)).toEqual({ ok: false, reason: 'not_yours' });
    expect(await r.service.confirmFromHeld(BUYER, 10)).toEqual({ ok: false, reason: 'not_found' });
    r.rows.set(9, settlement({ quoteExpiresAtMs: NOW }));
    expect(await r.service.confirmFromHeld(BUYER, 9)).toEqual({
      ok: false,
      reason: 'quote_expired',
    });
    r.rows.set(9, settlement({ settledAmountBase: null }));
    expect(await r.service.confirmFromHeld(BUYER, 9)).toEqual({
      ok: false,
      reason: 'quote_unavailable',
    });
  });
});

describe('withdraw: the whole balance to the linked wallet', () => {
  it('charges, asks the service, and answers the figure moved', async () => {
    const r = rig();
    r.wallets.set(BUYER, 'wallet-b');
    await r.db.post({ account: BUYER, ref: 'seed', kind: 'sale', deltaBase: '2500000000' });
    expect(await r.service.withdraw(BUYER)).toEqual({
      ok: true,
      base: '2500000000',
      tokens: 2.5,
      wallet: 'wallet-b',
    });
    expect(await r.db.balance(BUYER)).toBe('0');
    expect(r.db.rows.at(-1)).toMatchObject({ ref: 'held:withdraw:7:n1', kind: 'withdraw' });
  });

  it('needs a wallet and a balance', async () => {
    const r = rig();
    expect(await r.service.withdraw(BUYER)).toEqual({ ok: false, reason: 'wallet_required' });
    r.wallets.set(BUYER, 'wallet-b');
    expect(await r.service.withdraw(BUYER)).toEqual({ ok: false, reason: 'held_empty' });
  });

  it('returns the balance when the service refuses', async () => {
    const r = rig();
    r.wallets.set(BUYER, 'wallet-b');
    r.withdrawal = { done: false, reason: 'rail_down' };
    await r.db.post({ account: BUYER, ref: 'seed', kind: 'sale', deltaBase: '2500000000' });
    expect(await r.service.withdraw(BUYER)).toEqual({
      ok: false,
      reason: 'held_withdraw_failed',
    });
    expect(await r.db.balance(BUYER)).toBe('2500000000');
    expect(r.db.rows.map((e) => e.kind)).toEqual(['sale', 'withdraw', 'withdraw_reverse']);
  });
});
