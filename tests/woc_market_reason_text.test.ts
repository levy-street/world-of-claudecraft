// The screened payment-verdict vocabulary's player copy
// (src/ui/woc_market_reason_text.ts): word-to-text, with a generic fallback in
// each direction so an unlearned service word never leaks a machine token.

import { describe, expect, it } from 'vitest';
import { wocPaymentPendingText, wocSettlementFailText } from '../src/ui/woc_market_reason_text';

describe('wocPaymentPendingText', () => {
  it('distinguishes the three pending kinds by name', () => {
    expect(wocPaymentPendingText('awaiting_finality')).toBe(
      'Payment seen on the ledger. Waiting for final confirmation.',
    );
    expect(wocPaymentPendingText('not_yet_visible')).toBe(
      'No payment is visible on the ledger yet. It can take a moment to appear.',
    );
    expect(wocPaymentPendingText('service_unavailable')).toBe(
      'The payment service is unreachable. Your payment stays recorded and will be re-checked.',
    );
  });

  it('answers the generic line for anything else, never the raw word', () => {
    const generic = 'Your payment is submitted and awaiting confirmation.';
    expect(wocPaymentPendingText('other')).toBe(generic);
    expect(wocPaymentPendingText('dev_chain_unknown_memo')).toBe(generic);
    expect(wocPaymentPendingText(null)).toBe(generic);
    expect(wocPaymentPendingText(undefined)).toBe(generic);
    // The exact toBe pins above are the decisive assertions: a raw word can
    // never appear in a string pinned byte-for-byte to the generic copy.
  });
});

describe('wocSettlementFailText', () => {
  it('explains the four verifier verdicts by name', () => {
    expect(wocSettlementFailText('burn_missing')).toBe(
      'The payment did not include the required token burn.',
    );
    expect(wocSettlementFailText('burn_mismatch')).toBe(
      'The payment burned the wrong token amount.',
    );
    expect(wocSettlementFailText('burn_authority_mismatch')).toBe(
      'The token burn came from a wallet this purchase did not name.',
    );
    expect(wocSettlementFailText('unexpected_credit')).toBe(
      'The transaction paid a wallet outside this purchase.',
    );
  });

  it('answers the generic line for any other word and null for no reason', () => {
    // NON-CAUSAL on purpose: the fallback covers a heterogeneous set
    // (expiries, chain failures, releases), so it must not assert a cause
    // the wire does not support ("did not match" accused late payers).
    const generic = 'This payment could not be completed.';
    expect(wocSettlementFailText('leg_mismatch')).toBe(generic);
    expect(wocSettlementFailText('other')).toBe(generic);
    expect(wocSettlementFailText(null)).toBeNull();
    expect(wocSettlementFailText(undefined)).toBeNull();
  });
});

describe('the maps stay inside the server wire vocabularies', () => {
  // A mapped word outside the screened vocabulary can never fire (the screen
  // collapses it to 'other' before the client sees it), so it is a dead key;
  // and the words deliberately LEFT generic should be a visible, pinned set
  // rather than silent fallthrough. Importing the server constants makes a
  // vocabulary change red here, where the copy decision lives.
  it('every mapped word is a member of its wire vocabulary', async () => {
    const rules = await import('../server/woc_market_rules');
    const { WOC_MARKET_REASON_TEXT_KEYS } = await import('../src/ui/woc_market_reason_text');
    for (const word of Object.keys(WOC_MARKET_REASON_TEXT_KEYS.pending)) {
      expect(rules.WOC_MARKET_WIRE_PENDING_REASONS, `pending map: ${word}`).toContain(word);
    }
    for (const word of Object.keys(WOC_MARKET_REASON_TEXT_KEYS.fail)) {
      expect(rules.WOC_MARKET_WIRE_FAIL_REASONS, `fail map: ${word}`).toContain(word);
    }
  });

  it('pins the deliberately-generic remainder so vocabulary growth is visible', async () => {
    const rules = await import('../server/woc_market_rules');
    const { WOC_MARKET_REASON_TEXT_KEYS } = await import('../src/ui/woc_market_reason_text');
    const mapped = new Set(Object.keys(WOC_MARKET_REASON_TEXT_KEYS.fail));
    const generic = [...rules.WOC_MARKET_WIRE_FAIL_REASONS].filter((w) => !mapped.has(w)).sort();
    expect(generic).toEqual([
      'bad_signature',
      'expired',
      'forfeited',
      'invalid_signature',
      'leg_mismatch',
      'memo_mismatch',
      'payer_debit_mismatch',
      'payer_mismatch',
      'refused',
      'rejected',
      'signature_already_settled',
      'signature_conflict',
      'signature_did_not_match_quote',
      'unknown_reference',
      'window_elapsed',
    ]);
  });

  it('pins the PENDING remainder too: today every pending word has copy', async () => {
    // The twin of the fail-remainder pin. All three pending words are mapped,
    // so the remainder is EMPTY, and pinning that emptiness is the point: a
    // fourth pending word (the likelier vocabulary to grow, since pending
    // words gate the anti-snipe extension) must land here as a copy decision,
    // not silently render the generic line.
    const rules = await import('../server/woc_market_rules');
    const { WOC_MARKET_REASON_TEXT_KEYS } = await import('../src/ui/woc_market_reason_text');
    const mapped = new Set(Object.keys(WOC_MARKET_REASON_TEXT_KEYS.pending));
    const generic = [...rules.WOC_MARKET_WIRE_PENDING_REASONS].filter((w) => !mapped.has(w)).sort();
    expect(generic).toEqual([]);
  });
});

describe('the bond-flavored pending voice', () => {
  it('every bond-pending word is a wire vocabulary member too', async () => {
    const rules = await import('../server/woc_market_rules');
    const { WOC_MARKET_REASON_TEXT_KEYS } = await import('../src/ui/woc_market_reason_text');
    for (const word of Object.keys(WOC_MARKET_REASON_TEXT_KEYS.bondPending)) {
      expect(rules.WOC_MARKET_WIRE_PENDING_REASONS, `bond map: ${word}`).toContain(word);
    }
  });

  it('names the BOND, and never collapses into the payment voice', async () => {
    const { wocBondPendingText, wocPaymentPendingText } = await import(
      '../src/ui/woc_market_reason_text'
    );
    for (const word of ['awaiting_finality', 'not_yet_visible', 'service_unavailable', null]) {
      const bond = wocBondPendingText(word);
      expect(bond, String(word)).not.toBe(wocPaymentPendingText(word));
      expect(bond.toLowerCase(), String(word)).toContain('bond');
    }
    // Unknown words take the bond generic, not the payment generic.
    expect(wocBondPendingText('future_word').toLowerCase()).toContain('bond');
  });
});

describe('the five common non-forensic fail reasons explain themselves', () => {
  it('each renders its own sentence, distinct from the generic and from each other', async () => {
    const { wocSettlementFailText } = await import('../src/ui/woc_market_reason_text');
    const words = [
      'quote_expired',
      'transaction_failed',
      'refunded',
      'superseded',
      'confirming_overdue',
    ];
    const lines = words.map((w) => wocSettlementFailText(w));
    const generic = wocSettlementFailText('some_unknown_word');
    for (const [i, line] of lines.entries()) {
      expect(line, words[i]).not.toBe(generic);
    }
    expect(new Set(lines).size, 'five distinct sentences').toBe(5);
  });
});
