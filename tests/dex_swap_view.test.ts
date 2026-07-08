// Unit tests for the pure Buy $WOC view-core (src/ui/dex_swap_view.ts): the
// state machine (including stale-quote refusal + the seq guard against stale
// async completions), the exact base-unit <-> decimal display math (no float
// drift on integer amounts), and the price-impact / minimum-received model
// derived from a Jupiter quoteResponse. Time is injected everywhere: no test
// touches a clock.

import { describe, expect, it } from 'vitest';
import {
  beginQuote,
  beginSign,
  buildQuoteModel,
  canSign,
  createDexSwapState,
  type DexSwapConfig,
  type DexSwapQuote,
  effectiveSlippageBps,
  formatBaseUnits,
  isQuoteStale,
  parseAmountToBaseUnits,
  priceImpactPercentText,
  QUOTE_TTL_MS,
  quoteFailed,
  quoteReceived,
  resetDexSwap,
  signFailed,
  signSent,
} from '../src/ui/dex_swap_view';

const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const WOC = '3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth';

const CONFIG: DexSwapConfig = {
  enabled: true,
  wocMint: WOC,
  wocDecimals: 6,
  inputs: [
    { mint: SOL, symbol: 'SOL', decimals: 9 },
    { mint: USDC, symbol: 'USDC', decimals: 6 },
  ],
  maxSlippageBps: 500,
};

const QUOTE: DexSwapQuote = {
  inputMint: SOL,
  inAmount: '1500000000',
  outputMint: WOC,
  outAmount: '52340000000',
  otherAmountThreshold: '51816600000',
  priceImpactPct: '0.0012',
  slippageBps: 100,
};

describe('dex swap view: state machine', () => {
  it('walks idle -> quoting -> quoted -> signing -> sent', () => {
    let s = createDexSwapState();
    expect(s.phase).toBe('idle');
    s = beginQuote(s);
    expect(s.phase).toBe('quoting');
    const quoteSeq = s.seq;
    s = quoteReceived(s, quoteSeq, QUOTE, 1000);
    expect(s.phase).toBe('quoted');
    expect(s.quote).toEqual(QUOTE);
    const attempt = beginSign(s, 2000);
    expect(attempt.ok).toBe(true);
    if (!attempt.ok) return;
    s = attempt.state;
    expect(s.phase).toBe('signing');
    s = signSent(s, s.seq, 'sig123');
    expect(s.phase).toBe('sent');
    expect(s.signature).toBe('sig123');
  });

  it('routes quote and sign failures into the error phase with the caller tag', () => {
    let s = beginQuote(createDexSwapState());
    s = quoteFailed(s, s.seq, 'api');
    expect(s.phase).toBe('error');
    expect(s.errorCode).toBe('api');

    let t = beginQuote(createDexSwapState());
    t = quoteReceived(t, t.seq, QUOTE, 0);
    const attempt = beginSign(t, 1);
    expect(attempt.ok).toBe(true);
    if (!attempt.ok) return;
    t = signFailed(attempt.state, attempt.state.seq, 'wallet_feature');
    expect(t.phase).toBe('error');
    expect(t.errorCode).toBe('wallet_feature');
  });

  it('refuses to sign a stale quote and demands a re-quote', () => {
    let s = beginQuote(createDexSwapState());
    s = quoteReceived(s, s.seq, QUOTE, 1000);
    // Fresh at the TTL boundary, stale one ms past it.
    expect(isQuoteStale(s, 1000 + QUOTE_TTL_MS)).toBe(false);
    expect(canSign(s, 1000 + QUOTE_TTL_MS)).toBe(true);
    expect(isQuoteStale(s, 1001 + QUOTE_TTL_MS)).toBe(true);
    expect(canSign(s, 1001 + QUOTE_TTL_MS)).toBe(false);

    const stale = beginSign(s, 1001 + QUOTE_TTL_MS);
    expect(stale).toEqual({ ok: false, reason: 'stale' });

    // The re-quote path issues a fresh quote that CAN be signed.
    s = beginQuote(s);
    s = quoteReceived(s, s.seq, QUOTE, 60_000);
    expect(canSign(s, 60_500)).toBe(true);
  });

  it('cannot sign without a quote', () => {
    expect(beginSign(createDexSwapState(), 0)).toEqual({ ok: false, reason: 'no_quote' });
    const quoting = beginQuote(createDexSwapState());
    expect(beginSign(quoting, 0)).toEqual({ ok: false, reason: 'no_quote' });
  });

  it('drops stale async completions via the seq guard', () => {
    // A quote completion from a superseded request must not apply.
    let s = beginQuote(createDexSwapState());
    const oldSeq = s.seq;
    s = beginQuote(s); // player re-quoted; oldSeq is dead
    const afterStale = quoteReceived(s, oldSeq, QUOTE, 1000);
    expect(afterStale).toBe(s);
    expect(afterStale.phase).toBe('quoting');

    // Same for a reset racing an in-flight completion.
    let t = beginQuote(createDexSwapState());
    const seq = t.seq;
    t = resetDexSwap(t);
    expect(quoteReceived(t, seq, QUOTE, 1000).phase).toBe('idle');

    // And a sign completion after reset.
    let u = beginQuote(createDexSwapState());
    u = quoteReceived(u, u.seq, QUOTE, 0);
    const attempt = beginSign(u, 1);
    if (!attempt.ok) throw new Error('expected sign to start');
    const signingSeq = attempt.state.seq;
    const reset = resetDexSwap(attempt.state);
    expect(signSent(reset, signingSeq, 'sig').phase).toBe('idle');
    expect(signFailed(reset, signingSeq, 'api').phase).toBe('idle');
  });

  it('clamps the requested slippage to the server ceiling', () => {
    expect(effectiveSlippageBps(500)).toBe(100);
    expect(effectiveSlippageBps(50)).toBe(50);
    expect(effectiveSlippageBps(1)).toBe(1);
    expect(effectiveSlippageBps(0)).toBe(1);
  });
});

describe('dex swap view: exact amount math', () => {
  it('parses typed decimal amounts to exact base units', () => {
    expect(parseAmountToBaseUnits('1', 9)).toBe('1000000000');
    expect(parseAmountToBaseUnits('0.5', 9)).toBe('500000000');
    expect(parseAmountToBaseUnits('.5', 6)).toBe('500000');
    expect(parseAmountToBaseUnits('1.5', 6)).toBe('1500000');
    expect(parseAmountToBaseUnits(' 2 ', 6)).toBe('2000000');
    // Exactness where float math would drift: 0.1 + 0.2 territory.
    expect(parseAmountToBaseUnits('0.3', 9)).toBe('300000000');
    expect(parseAmountToBaseUnits('123456789.123456789', 9)).toBe('123456789123456789');
  });

  it('rejects malformed, zero, over-precise, and oversized amounts', () => {
    for (const bad of ['', '.', 'abc', '-1', '1,5', '1e9', '0', '0.0']) {
      expect(parseAmountToBaseUnits(bad, 9)).toBeNull();
    }
    // More fractional digits than the token carries is a reject, not a round.
    expect(parseAmountToBaseUnits('0.1234567', 6)).toBeNull();
    // Past MAX_AMOUNT_DIGITS in base units.
    expect(parseAmountToBaseUnits('999999999999999999999', 0)).toBeNull();
  });

  it('formats base units exactly (1500000 at 6 decimals is "1.5")', () => {
    expect(formatBaseUnits('1500000', 6)).toBe('1.5');
    expect(formatBaseUnits('1000000', 6)).toBe('1');
    expect(formatBaseUnits('1', 6)).toBe('0.000001');
    expect(formatBaseUnits('0', 6)).toBe('0');
    expect(formatBaseUnits('52340000000', 6)).toBe('52340');
    // A value float64 cannot represent exactly stays exact as a string.
    expect(formatBaseUnits('123456789123456789123', 9)).toBe('123456789123.456789123');
    expect(formatBaseUnits('nope', 6)).toBeNull();
  });

  it('groups large integer digits through the injected formatter only', () => {
    const group = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    expect(formatBaseUnits('52340000000', 6, group)).toBe('52,340');
    expect(formatBaseUnits('1500000', 6, group)).toBe('1.5');
    // The formatter only ever sees the integer digits; the fraction is exact.
    expect(formatBaseUnits('1234567123456', 6, group)).toBe('1,234,567.123456');
  });
});

describe('dex swap view: quote model derivation', () => {
  it('derives pay / receive / minimum-received / price impact from the quote', () => {
    const model = buildQuoteModel(QUOTE, CONFIG);
    expect(model).toEqual({
      paySymbol: 'SOL',
      payAmount: '1.5',
      receiveAmount: '52340',
      minReceived: '51816.6',
      priceImpactPct: '0.12',
      slippageBps: 100,
    });
  });

  it('formats price impact readably at the edges', () => {
    expect(priceImpactPercentText({ ...QUOTE, priceImpactPct: '0' })).toBe('0');
    expect(priceImpactPercentText({ ...QUOTE, priceImpactPct: '0.00001' })).toBe('<0.01');
    expect(priceImpactPercentText({ ...QUOTE, priceImpactPct: '0.05' })).toBe('5.00');
    expect(priceImpactPercentText({ ...QUOTE, priceImpactPct: undefined })).toBeNull();
    expect(priceImpactPercentText({ ...QUOTE, priceImpactPct: 'garbage' })).toBeNull();
  });

  it('falls back to the clamped default slippage when the quote carries none', () => {
    const model = buildQuoteModel({ ...QUOTE, slippageBps: undefined }, CONFIG);
    expect(model?.slippageBps).toBe(100);
  });

  it('returns null for a quote whose mints do not match the config', () => {
    expect(buildQuoteModel({ ...QUOTE, inputMint: WOC }, CONFIG)).toBeNull();
    expect(buildQuoteModel({ ...QUOTE, outputMint: USDC }, CONFIG)).toBeNull();
    expect(buildQuoteModel({ ...QUOTE, outAmount: 'NaN' }, CONFIG)).toBeNull();
  });

  it('uses the USDC decimals for a USDC pay leg (1500000 -> 1.5)', () => {
    const usdcQuote: DexSwapQuote = {
      ...QUOTE,
      inputMint: USDC,
      inAmount: '1500000',
    };
    const model = buildQuoteModel(usdcQuote, CONFIG);
    expect(model?.paySymbol).toBe('USDC');
    expect(model?.payAmount).toBe('1.5');
  });
});

// ---------------------------------------------------------------------------
// Rework additions: fee-line derivation, the rate-limit cooldown state, and
// the re-quote debouncer (driven with vitest fake timers).
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, vi } from 'vitest';
import {
  clearElapsedCooldown,
  cooldownRemainingMs,
  cooldownRemainingSeconds,
  createDebouncer,
  ERR_RATE_LIMITED,
  feePercentText,
  isCoolingDown,
  REQUOTE_DEBOUNCE_MS,
  rateLimited,
} from '../src/ui/dex_swap_view';

const QUOTE_FIXTURE: DexSwapQuote = {
  inputMint: SOL,
  inAmount: '1000000000',
  outputMint: WOC,
  outAmount: '52340000000',
  otherAmountThreshold: '51816600000',
  priceImpactPct: '0.0012',
  slippageBps: 100,
};

describe('dex swap view: fee-line derivation', () => {
  it('renders the exact percent for a bps fee (25 -> 0.25, 100 -> 1)', () => {
    expect(feePercentText(25)).toBe('0.25');
    expect(feePercentText(100)).toBe('1');
    expect(feePercentText(1)).toBe('0.01');
    expect(feePercentText(150)).toBe('1.5');
    expect(feePercentText(10_000)).toBe('100');
  });

  it('returns null (no line) for zero, negative, fractional, or absurd fees', () => {
    expect(feePercentText(0)).toBeNull();
    expect(feePercentText(-25)).toBeNull();
    expect(feePercentText(2.5)).toBeNull();
    expect(feePercentText(10_001)).toBeNull();
    expect(feePercentText(Number.NaN)).toBeNull();
  });

  it('carries the quote-level feeBps on the state via quoteReceived', () => {
    const quoting = beginQuote(createDexSwapState());
    const quoted = quoteReceived(quoting, quoting.seq, QUOTE_FIXTURE, 1_000, 25);
    expect(quoted.quoteFeeBps).toBe(25);
    // Default (fee-less service answer) is 0: no fee line.
    const quoting2 = beginQuote(quoted);
    const quoted2 = quoteReceived(quoting2, quoting2.seq, QUOTE_FIXTURE, 2_000);
    expect(quoted2.quoteFeeBps).toBe(0);
  });
});

describe('dex swap view: rate-limit cooldown', () => {
  it('a 429 during quoting enters the cooldown error state with the anchor set', () => {
    const quoting = beginQuote(createDexSwapState());
    const state = rateLimited(quoting, quoting.seq, 5_400, 10_000);
    expect(state.phase).toBe('error');
    expect(state.errorCode).toBe(ERR_RATE_LIMITED);
    expect(state.cooldownUntilMs).toBe(15_400);
    expect(isCoolingDown(state, 10_000)).toBe(true);
    expect(cooldownRemainingMs(state, 10_000)).toBe(5_400);
    expect(cooldownRemainingSeconds(state, 10_000)).toBe(6);
  });

  it('a 429 during signing enters the same cooldown state', () => {
    const quoting = beginQuote(createDexSwapState());
    const quoted = quoteReceived(quoting, quoting.seq, QUOTE_FIXTURE, 1_000);
    const attempt = beginSign(quoted, 1_500);
    expect(attempt.ok).toBe(true);
    if (!attempt.ok) return;
    const state = rateLimited(attempt.state, attempt.state.seq, 2_000, 1_600);
    expect(state.phase).toBe('error');
    expect(state.errorCode).toBe(ERR_RATE_LIMITED);
    expect(state.cooldownUntilMs).toBe(3_600);
  });

  it('a stale seq or a settled phase ignores a late 429', () => {
    const quoting = beginQuote(createDexSwapState());
    const quoted = quoteReceived(quoting, quoting.seq, QUOTE_FIXTURE, 1_000);
    expect(rateLimited(quoted, quoted.seq, 1_000, 2_000)).toBe(quoted); // not quoting/signing
    const quoting2 = beginQuote(quoted);
    expect(rateLimited(quoting2, quoting2.seq - 1, 1_000, 2_000)).toBe(quoting2); // stale seq
  });

  it('counts down against the injected clock and unlocks exactly at the boundary', () => {
    const quoting = beginQuote(createDexSwapState());
    const state = rateLimited(quoting, quoting.seq, 3_000, 0);
    expect(isCoolingDown(state, 2_999)).toBe(true);
    expect(cooldownRemainingSeconds(state, 2_100)).toBe(1);
    expect(isCoolingDown(state, 3_000)).toBe(false);
    expect(cooldownRemainingMs(state, 9_999)).toBe(0);
  });

  it('clearElapsedCooldown resets to idle only after expiry (and bumps the seq)', () => {
    const quoting = beginQuote(createDexSwapState());
    const state = rateLimited(quoting, quoting.seq, 3_000, 0);
    expect(clearElapsedCooldown(state, 1_000)).toBe(state); // still cooling: unchanged
    const cleared = clearElapsedCooldown(state, 3_001);
    expect(cleared.phase).toBe('idle');
    expect(cleared.cooldownUntilMs).toBeNull();
    expect(cleared.seq).toBe(state.seq + 1); // in-flight completions stay dead
  });

  it('a nonsensical retryAfterMs falls back to a 60s cooldown, never zero', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const quoting = beginQuote(createDexSwapState());
      const state = rateLimited(quoting, quoting.seq, bad, 1_000);
      expect(state.cooldownUntilMs).toBe(61_000);
    }
  });

  it('beginQuote clears a previous cooldown anchor', () => {
    const quoting = beginQuote(createDexSwapState());
    const limited = rateLimited(quoting, quoting.seq, 3_000, 0);
    const again = beginQuote(limited);
    expect(again.cooldownUntilMs).toBeNull();
  });
});

describe('dex swap view: re-quote debouncer (fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires once, REQUOTE_DEBOUNCE_MS after the LAST touch (typing coalesces)', () => {
    const debouncer = createDebouncer(REQUOTE_DEBOUNCE_MS);
    let fired = 0;
    const fn = () => {
      fired += 1;
    };
    debouncer.touch(fn);
    vi.advanceTimersByTime(REQUOTE_DEBOUNCE_MS - 1);
    expect(fired).toBe(0);
    debouncer.touch(fn); // keystroke re-arms the window
    vi.advanceTimersByTime(REQUOTE_DEBOUNCE_MS - 1);
    expect(fired).toBe(0);
    vi.advanceTimersByTime(1);
    expect(fired).toBe(1);
    // Quiet afterwards: no second fire.
    vi.advanceTimersByTime(REQUOTE_DEBOUNCE_MS * 5);
    expect(fired).toBe(1);
  });

  it('ten rapid touches cost exactly one run (the quote budget is preserved)', () => {
    const debouncer = createDebouncer(REQUOTE_DEBOUNCE_MS);
    let fired = 0;
    for (let i = 0; i < 10; i++) {
      debouncer.touch(() => {
        fired += 1;
      });
      vi.advanceTimersByTime(50);
    }
    vi.advanceTimersByTime(REQUOTE_DEBOUNCE_MS);
    expect(fired).toBe(1);
  });

  it('cancel drops the pending run', () => {
    const debouncer = createDebouncer(REQUOTE_DEBOUNCE_MS);
    let fired = 0;
    debouncer.touch(() => {
      fired += 1;
    });
    debouncer.cancel();
    vi.advanceTimersByTime(REQUOTE_DEBOUNCE_MS * 2);
    expect(fired).toBe(0);
    // A fresh touch after cancel still works.
    debouncer.touch(() => {
      fired += 1;
    });
    vi.advanceTimersByTime(REQUOTE_DEBOUNCE_MS);
    expect(fired).toBe(1);
  });
});

describe('dex swap view: two quotes racing', () => {
  it('keeps only the LATEST quote when an older in-flight response lands second', () => {
    // Quote A starts, then the player re-quotes (B) while A is in flight.
    let s = beginQuote(createDexSwapState());
    const seqA = s.seq;
    s = beginQuote(s);
    const seqB = s.seq;
    expect(seqB).toBe(seqA + 1);
    // B's response lands first and wins.
    const quoteB: DexSwapQuote = { ...QUOTE_FIXTURE, outAmount: '222' };
    s = quoteReceived(s, seqB, quoteB, 2_000, 25);
    expect(s.phase).toBe('quoted');
    expect(s.quote?.outAmount).toBe('222');
    // A's slow response lands second: a no-op, B's numbers stay on screen.
    const quoteA: DexSwapQuote = { ...QUOTE_FIXTURE, outAmount: '111' };
    const after = quoteReceived(s, seqA, quoteA, 3_000, 25);
    expect(after).toBe(s);
    expect(after.quote?.outAmount).toBe('222');
    // Same for a late failure from A: it cannot clobber B's quote.
    expect(quoteFailed(s, seqA, 'api')).toBe(s);
    expect(rateLimited(s, seqA, 1_000, 3_000)).toBe(s);
  });
});
