import { describe, expect, it } from 'vitest';
import type { OnchainEvent } from '../../server/onchain_activity';
import {
  formatAmount,
  formatUsd,
  renderRealmLine,
  validateOnchainEvent,
} from '../../server/onchain_feed';

const SIG = 'a'.repeat(64);

// No em dash, en dash, or emoji may reach realm chat (the repo copy rule); the
// server pre-push floor scans source, but the runtime line is built from data, so
// this guard asserts the rendered output stays ASCII.
const BANNED = /[\u2013\u2014\u2015\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]|\uFE0F/u;

function ev(over: Partial<OnchainEvent> = {}): OnchainEvent {
  return {
    kind: 'burn',
    token: 'WOC',
    amountUi: 25000,
    usd: 4.38,
    actor: 'Logan',
    item: null,
    sig: SIG,
    blockMs: 1_784_462_593_000,
    network: 'mainnet',
    totalBurnedUi: 442072,
    ...over,
  };
}

describe('validateOnchainEvent', () => {
  it('accepts a well-formed burn body and normalizes it', () => {
    const out = validateOnchainEvent({
      kind: 'burn',
      token: 'WOC',
      amountUi: 25000,
      usd: 4.38,
      actor: 'Logan',
      sig: SIG,
      blockMs: 1_784_462_593_000,
      network: 'mainnet',
      totalBurnedUi: 442072,
      junk: 'ignored',
    });
    expect(out).not.toBeNull();
    expect(out?.kind).toBe('burn');
    expect(out?.item).toBeNull();
    expect(out?.network).toBe('mainnet');
  });

  it('defaults network to mainnet and tolerates a missing usd/blockMs', () => {
    const out = validateOnchainEvent({ kind: 'sale', token: 'WOC', amountUi: 5000, sig: SIG });
    expect(out?.network).toBe('mainnet');
    expect(out?.usd).toBeNull();
    expect(out?.blockMs).toBe(0);
  });

  it('rejects bad kind, token, amount, and short signatures (fail-closed)', () => {
    expect(validateOnchainEvent(null)).toBeNull();
    expect(validateOnchainEvent({ kind: 'mint', token: 'WOC', amountUi: 1, sig: SIG })).toBeNull();
    expect(validateOnchainEvent({ kind: 'burn', token: 'ETH', amountUi: 1, sig: SIG })).toBeNull();
    expect(validateOnchainEvent({ kind: 'burn', token: 'WOC', amountUi: -1, sig: SIG })).toBeNull();
    expect(
      validateOnchainEvent({ kind: 'burn', token: 'WOC', amountUi: Number.NaN, sig: SIG }),
    ).toBeNull();
    expect(
      validateOnchainEvent({ kind: 'burn', token: 'WOC', amountUi: 1, sig: 'short' }),
    ).toBeNull();
  });
});

describe('renderRealmLine', () => {
  it('renders a burn line with USD and running total', () => {
    expect(renderRealmLine(ev())).toBe(
      '[WOC] Burned 25,000 WOC ($4.38). Total burned 442,072 WOC.',
    );
  });

  it('omits USD when the price was unavailable, and total when absent', () => {
    expect(renderRealmLine(ev({ usd: null, totalBurnedUi: null }))).toBe(
      '[WOC] Burned 25,000 WOC.',
    );
  });

  it('renders a sale line with the item name and token', () => {
    expect(
      renderRealmLine(ev({ kind: 'sale', item: 'Cloaked in Infinity', amountUi: 250000 })),
    ).toBe('[WOC] Cloaked in Infinity sold for 250,000 WOC ($4.38).');
  });

  it('renders a Claudium line across rails', () => {
    expect(
      renderRealmLine(
        ev({ kind: 'claudium', token: 'USDC', item: '500 Claudium', amountUi: 5, usd: 5 }),
      ),
    ).toBe('[WOC] 500 Claudium bought with 5 USDC ($5.00).');
  });

  it('stays ASCII for every kind (no emoji or long dashes reach chat)', () => {
    for (const kind of ['burn', 'sale', 'claudium'] as const) {
      expect(BANNED.test(renderRealmLine(ev({ kind })))).toBe(false);
    }
    expect(BANNED.test('[WOC] Burned 25,000 WOC ($4.38).')).toBe(false);
  });
});

describe('formatters', () => {
  it('formatAmount groups thousands and rounds', () => {
    expect(formatAmount(25000)).toBe('25,000');
    expect(formatAmount(1234567)).toBe('1,234,567');
    expect(formatAmount(12.345)).toBe('12.35');
  });

  it('formatUsd uses two decimals below 1000 and whole above', () => {
    expect(formatUsd(4.38)).toBe('$4.38');
    expect(formatUsd(12500)).toBe('$12,500');
  });
});
