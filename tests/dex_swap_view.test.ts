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
