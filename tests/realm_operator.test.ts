// Unit coverage for the realm operator panel's pure logic (#475): base-unit ->
// whole-token formatting, the server-error-code -> localized-message mapping, and
// the numeric-tier -> word resolver. The DOM rendering + the wallet/quote/confirm
// flow are exercised end to end in the browser (screenshots in docs/screenshots);
// these tests pin the parts that decide what a player actually reads on failure,
// which a screenshot cannot prove.

import { describe, it, expect } from 'vitest';
import { ApiError } from '../src/net/online';
import { ERR_KEYS, messageForError, formatTokens, tierWord } from '../src/ui/realm_operator';
import { t, formatNumber } from '../src/ui/i18n';

describe('formatTokens', () => {
  it('reduces base units to whole tokens at the mint decimals', () => {
    expect(formatTokens('10000000', 6)).toBe('10'); // bronze 1% of a 1e9 supply
    expect(formatTokens('50000000', 6)).toBe('50');
    expect(formatTokens('100000000', 6)).toBe('100');
    expect(formatTokens('0', 6)).toBe('0');
  });

  it('groups large amounts through the locale formatter (not a bare number)', () => {
    // 1e9-token supply at 6dp = 1e15 base units; 10% = 1e14 base = 1e8 tokens.
    expect(formatTokens('100000000000000', 6)).toBe(formatNumber(100_000_000));
  });

  it('floors sub-token dust rather than rounding up', () => {
    // 10 tokens + 999999 base-unit dust (just under one more token) still reads 10.
    expect(formatTokens('10999999', 6)).toBe('10');
  });

  it('handles a zero-decimal mint', () => {
    expect(formatTokens('1234', 0)).toBe(formatNumber(1234));
  });
});

describe('messageForError', () => {
  it('maps a known server error code to its localized message', () => {
    expect(messageForError(new ApiError('realm_name_taken', 409))).toBe(t('realmOp.err.realm_name_taken'));
    expect(messageForError(new ApiError('stake_below_minimum', 400))).toBe(t('realmOp.err.stake_below_minimum'));
    expect(messageForError(new ApiError('timelock_not_elapsed', 409))).toBe(t('realmOp.err.timelock_not_elapsed'));
    expect(messageForError(new ApiError('wrong_payer', 400))).toBe(t('realmOp.err.wrong_payer'));
  });

  it('maps the two literal route messages (not codes) too', () => {
    expect(messageForError(new ApiError('link a wallet first', 400))).toBe(t('realmOp.err.link_wallet'));
    expect(messageForError(new ApiError('too many requests, slow down', 429))).toBe(t('realmOp.err.rate_limited'));
  });

  it('falls back to a generic message for an unmapped server code', () => {
    expect(messageForError(new ApiError('some_new_code', 500))).toBe(t('realmOp.err.generic'));
  });

  it('recognizes the wallet-mismatch sentinel from the host', () => {
    expect(messageForError(new Error('wallet_mismatch'))).toBe(t('realmOp.err.wallet_mismatch'));
  });

  it('shows a wallet-layer Error message verbatim (already English by design)', () => {
    expect(messageForError(new Error('User rejected the request.'))).toBe('User rejected the request.');
  });

  it('is generic for a non-Error throw', () => {
    expect(messageForError('weird')).toBe(t('realmOp.err.generic'));
    expect(messageForError(undefined)).toBe(t('realmOp.err.generic'));
  });
});

describe('ERR_KEYS server-code coverage', () => {
  // Every error code the server can put on the wire for the realm routes must
  // have a mapping; a new code without one would silently render as generic.
  const SERVER_CODES = [
    // prepareProvisionQuote + the quote route
    'invalid_realm_name', 'realm_name_not_allowed', 'realm_name_taken', 'realm_cap_reached',
    'stake_below_minimum', 'supply_unavailable', 'invalid_amount', 'link a wallet first',
    // confirmProvisionQuote + verifyStakeLock
    'quote_not_found', 'not_your_quote', 'quote_expired', 'stake_already_recorded',
    'tx_not_finalized', 'tx_failed', 'token_2022', 'wrong_vault_amount', 'wrong_payer',
    // decommission + release
    'not_realm_owner', 'realm_not_found', 'realm_not_active', 'realm_not_decommissioning',
    'timelock_not_elapsed', 'stake_not_released_onchain',
    // buy/quote ongoing-$WOC-bond precheck
    'bond_required',
    // route-level rate limit
    'too many requests, slow down',
  ];

  it('maps every server-emitted code', () => {
    const missing = SERVER_CODES.filter((c) => !(c in ERR_KEYS));
    expect(missing).toEqual([]);
  });

  it('every mapping points at a realmOp.err.* key that resolves', () => {
    for (const key of Object.values(ERR_KEYS)) {
      expect(key.startsWith('realmOp.err.')).toBe(true);
      expect(typeof t(key)).toBe('string');
      expect(t(key).length).toBeGreaterThan(0);
    }
  });
});

describe('tierWord', () => {
  it('names the three stake tiers', () => {
    expect(tierWord(1)).toBe(t('realmOp.tier.bronze'));
    expect(tierWord(2)).toBe(t('realmOp.tier.silver'));
    expect(tierWord(3)).toBe(t('realmOp.tier.gold'));
  });

  it('falls back to the formatted number for the env/none tier', () => {
    expect(tierWord(0)).toBe(formatNumber(0));
  });
});
