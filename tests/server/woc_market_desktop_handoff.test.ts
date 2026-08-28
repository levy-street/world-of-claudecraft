// The woc-market -> desktop-wallet-handoff registration glue (issue #3692):
// the mapping from a quote intent / issued challenge to the store's
// authorization records, the skip arms that keep unsignable material out of
// the store, and the best-effort posture (a throwing store never fails the
// issuing call).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DesktopWalletStepUpAuthorization,
  DesktopWalletTransactionAuthorization,
} from '../../server/desktop_wallet_handoff';
import type { WocQuoteIntent } from '../../server/woc_market';
import {
  registerWocQuoteHandoff,
  registerWocStepUpHandoff,
  resetWocDesktopHandoffWarnLatches,
} from '../../server/woc_market_desktop_handoff';

beforeEach(() => {
  resetWocDesktopHandoffWarnLatches();
});

function signableIntent(over: Partial<WocQuoteIntent> = {}): WocQuoteIntent {
  return {
    ok: true,
    reference: 'WOC_ref_1',
    transactionBase64: 'AQID',
    signatureRequired: true,
    amount: { base: '123456', tokens: 12.3456 },
    seller: null,
    burn: null,
    treasury: null,
    bondCents: null,
    expiresAtMs: 9_999,
    reason: null,
    ...over,
  };
}

function recording() {
  const stepUps: Array<[number, DesktopWalletStepUpAuthorization]> = [];
  const transactions: Array<[number, DesktopWalletTransactionAuthorization]> = [];
  return {
    stepUps,
    transactions,
    registrar: {
      authorizeStepUp: (accountId: number, auth: DesktopWalletStepUpAuthorization) => {
        stepUps.push([accountId, auth]);
      },
      authorizeTransaction: (accountId: number, auth: DesktopWalletTransactionAuthorization) => {
        transactions.push([accountId, auth]);
      },
    },
  };
}

const CHALLENGE = {
  nonce: 'ab'.repeat(16),
  message: 'World of ClaudeCraft $WOC Exchange: authorize moving an item into escrow.',
  expiresAtMs: 5_000,
  signatureRequired: true,
};

describe('registerWocQuoteHandoff', () => {
  it('maps a signable quote to a woc-rail transaction authorization', () => {
    const rec = recording();
    registerWocQuoteHandoff(rec.registrar, 7, 'buyer-wallet', signableIntent());
    expect(rec.transactions).toEqual([
      [
        7,
        {
          reference: 'WOC_ref_1',
          transactionBase64: 'AQID',
          expectedAddress: 'buyer-wallet',
          rail: 'woc',
          amountBase: '123456',
          destination: null,
          expiresAtMs: 9_999,
        },
      ],
    ]);
  });

  it('registers nothing without a registrar, an ok intent, a signature need, or the legs', () => {
    const rec = recording();
    // The no-registrar arm must return BEFORE the try (a swallowed TypeError
    // would pass vacuously), so the warn spy proves the early return.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerWocQuoteHandoff(undefined, 7, 'w', signableIntent());
    registerWocStepUpHandoff(undefined, 7, 'w', CHALLENGE);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    registerWocQuoteHandoff(rec.registrar, 7, 'w', signableIntent({ ok: false }));
    registerWocQuoteHandoff(rec.registrar, 7, 'w', signableIntent({ signatureRequired: false }));
    registerWocQuoteHandoff(rec.registrar, 7, 'w', signableIntent({ reference: null }));
    registerWocQuoteHandoff(rec.registrar, 7, 'w', signableIntent({ transactionBase64: null }));
    registerWocQuoteHandoff(rec.registrar, 7, 'w', signableIntent({ expiresAtMs: null }));
    expect(rec.transactions).toEqual([]);
  });

  it('a missing amount leg registers with amountBase null', () => {
    const rec = recording();
    registerWocQuoteHandoff(rec.registrar, 7, 'w', signableIntent({ amount: null }));
    expect(rec.transactions[0][1].amountBase).toBeNull();
  });

  it('a throwing store never fails the issuing call, and the warn latches', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const throwing = {
      authorizeTransaction: () => {
        throw new Error('invalid transaction authorization');
      },
      authorizeStepUp: () => {},
    };
    try {
      expect(() => registerWocQuoteHandoff(throwing, 7, 'w', signableIntent())).not.toThrow();
      registerWocQuoteHandoff(throwing, 7, 'w', signableIntent());
      // Two failures, ONE warn: the stuck condition must not flood the log.
      expect(warn).toHaveBeenCalledOnce();
      // A success re-arms the latch, so a NEW outage logs again.
      const rec = recording();
      registerWocQuoteHandoff(rec.registrar, 7, 'w', signableIntent());
      registerWocQuoteHandoff(throwing, 7, 'w', signableIntent());
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  it('clamps a far-future service expiry to the sanity ceiling', () => {
    const rec = recording();
    const nowMs = 1_000_000;
    registerWocQuoteHandoff(
      rec.registrar,
      7,
      'w',
      signableIntent({ expiresAtMs: nowMs + 365 * 24 * 60 * 60 * 1000 }),
      nowMs,
    );
    // 10 minutes past the injected clock, never the service's year.
    expect(rec.transactions[0][1].expiresAtMs).toBe(nowMs + 10 * 60 * 1000);
    // An honest 90-second quote is never shortened.
    const rec2 = recording();
    registerWocQuoteHandoff(
      rec2.registrar,
      7,
      'w',
      signableIntent({ expiresAtMs: nowMs + 90_000 }),
      nowMs,
    );
    expect(rec2.transactions[0][1].expiresAtMs).toBe(nowMs + 90_000);
  });
});

describe('registerWocStepUpHandoff', () => {
  it('maps an issued challenge to a step-up authorization under the wallet', () => {
    const rec = recording();
    registerWocStepUpHandoff(rec.registrar, 7, 'seller-wallet', CHALLENGE);
    expect(rec.stepUps).toEqual([
      [
        7,
        {
          nonce: CHALLENGE.nonce,
          message: CHALLENGE.message,
          expectedAddress: 'seller-wallet',
          expiresAtMs: 5_000,
        },
      ],
    ]);
  });

  it('registers nothing without a registrar or for a devsig challenge', () => {
    const rec = recording();
    registerWocStepUpHandoff(undefined, 7, 'w', CHALLENGE);
    registerWocStepUpHandoff(rec.registrar, 7, 'w', { ...CHALLENGE, signatureRequired: false });
    expect(rec.stepUps).toEqual([]);
  });

  it('a throwing store never fails the issuing call (best-effort)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() =>
        registerWocStepUpHandoff(
          {
            authorizeTransaction: () => {},
            authorizeStepUp: () => {
              throw new Error('too many active wallet handoffs');
            },
          },
          7,
          'w',
          CHALLENGE,
        ),
      ).not.toThrow();
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });
});
