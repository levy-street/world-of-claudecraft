// View-core tests for the Trading Bots window (src/ui/trading_bots_view.ts).
//
// The core is DOM-free and clock-injected, so these drive it directly: screen
// derivation from the status aggregate, the seq-guarded op state machine
// (stale completions never apply), the rate-limit cooldown math, the exact
// bigint deposit-bounds validation (min/max boundaries inclusive, malformed
// text rejected), param clamping, and the signed PnL display derivations.

import { describe, expect, it } from 'vitest';
import {
  amountWithinBounds,
  beginOp,
  clampParam,
  clearElapsedCooldown,
  cooldownRemainingSeconds,
  createTradingBotsOpState,
  depositBoundsText,
  ERR_RATE_LIMITED,
  effectiveParams,
  isCoolingDown,
  isKnownSkuId,
  isOpInFlight,
  isRentalExpired,
  isVaultEmpty,
  mintDecimals,
  opConfirming,
  opDone,
  opFailed,
  opRateLimited,
  opSigning,
  rentalDaysLeft,
  resetOp,
  screenForStatus,
  signedPercentText,
  signedWocText,
  skuForId,
  type TradingBotSku,
  type TradingBotsConfig,
  type TradingBotsStatus,
  validateDeposit,
  visibleSkus,
} from '../src/ui/trading_bots_view';

const GRID_SKU: TradingBotSku = {
  id: 'grid',
  priceWocBaseUnits: '250000000000',
  priceClaudium: 900,
  minDepositSol: '100000000', // 0.1 SOL at 9 decimals
  maxDepositSol: '5000000000', // 5 SOL
  minDepositWoc: '5000000000', // 5000 WOC at 6 decimals
  maxDepositWoc: '250000000000', // 250000 WOC
  params: [
    { key: 'gridSpacingBps', min: 10, max: 500, step: 5, default: 50 },
    { key: 'orderSizeBps', min: 100, max: 2500, step: 100, default: 500 },
  ],
};

const CONFIG: TradingBotsConfig = {
  enabled: true,
  wocMint: '3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth',
  wocDecimals: 6,
  solDecimals: 9,
  claudiumEnabled: true,
  skus: [GRID_SKU, { ...GRID_SKU, id: 'dca' }, { ...GRID_SKU, id: 'experimental_v9' }],
};

const STATUS: TradingBotsStatus = {
  subscription: { skuId: 'grid', activeUntilMs: 2_000_000 },
  claudiumBalance: 1200,
  vault: { sol: '1000000000', woc: '52000000000' },
  bot: { state: 'running', params: { gridSpacingBps: 75 } },
  trades: [],
  pnl: { periodDays: 30, wocBaseUnits: '1200000000', bps: 230 },
};

describe('catalog visibility', () => {
  it('renders only the SKU ids this build has strings for', () => {
    expect(visibleSkus(CONFIG).map((sku) => sku.id)).toEqual(['grid', 'dca']);
    expect(isKnownSkuId('momentum')).toBe(true);
    expect(isKnownSkuId('experimental_v9')).toBe(false);
  });

  it('resolves a SKU by id from the config, unknown ids included', () => {
    expect(skuForId(CONFIG, 'grid')).toBe(GRID_SKU);
    expect(skuForId(CONFIG, 'experimental_v9')?.id).toBe('experimental_v9');
    expect(skuForId(CONFIG, 'missing')).toBeNull();
  });

  it('mintDecimals resolves the WOC leg vs the SOL leg by exact mint match', () => {
    expect(mintDecimals(CONFIG, CONFIG.wocMint)).toBe(6);
    expect(mintDecimals(CONFIG, 'So11111111111111111111111111111111111111112')).toBe(9);
    // A near-miss mint string is the SOL leg, never a fuzzy WOC match.
    expect(mintDecimals(CONFIG, `${CONFIG.wocMint} `)).toBe(9);
  });
});

describe('screen derivation', () => {
  it('lands on the catalog with no status or no subscription', () => {
    expect(screenForStatus(null)).toBe('catalog');
    expect(screenForStatus({ ...STATUS, subscription: null })).toBe('catalog');
  });

  it('lands on fund while the vault is empty, dashboard once funded', () => {
    expect(screenForStatus({ ...STATUS, vault: null })).toBe('fund');
    expect(screenForStatus({ ...STATUS, vault: { sol: '0', woc: '0' } })).toBe('fund');
    expect(screenForStatus(STATUS)).toBe('dashboard');
    // Either funded leg alone is enough to leave the funding screen.
    expect(screenForStatus({ ...STATUS, vault: { sol: '0', woc: '1' } })).toBe('dashboard');
    expect(screenForStatus({ ...STATUS, vault: { sol: '1', woc: '0' } })).toBe('dashboard');
  });

  it('treats a malformed vault leg as zero, never NaN', () => {
    expect(isVaultEmpty({ sol: 'not-digits', woc: '' })).toBe(true);
  });
});

describe('op state machine', () => {
  it('walks the wallet-op path requesting -> signing -> confirming -> done', () => {
    let state = beginOp(createTradingBotsOpState(), 'deposit');
    const seq = state.seq;
    expect(state.phase).toBe('requesting');
    expect(state.kind).toBe('deposit');
    expect(isOpInFlight(state)).toBe(true);
    state = opSigning(state, seq);
    expect(state.phase).toBe('signing');
    state = opConfirming(state, seq);
    expect(state.phase).toBe('confirming');
    state = opDone(state, seq);
    expect(state.phase).toBe('done');
    expect(isOpInFlight(state)).toBe(false);
  });

  it('completes a single-call op straight from requesting', () => {
    let state = beginOp(createTradingBotsOpState(), 'control');
    state = opDone(state, state.seq);
    expect(state.phase).toBe('done');
  });

  it('ignores stale completions after a reset or a newer op', () => {
    const first = beginOp(createTradingBotsOpState(), 'subscribe');
    const staleSeq = first.seq;
    const second = beginOp(resetOp(first), 'withdraw');
    expect(opDone(second, staleSeq)).toBe(second);
    expect(opFailed(second, staleSeq, 'trading_bots.vault_busy')).toBe(second);
    expect(opSigning(second, staleSeq)).toBe(second);
  });

  it('records a failure code from any in-flight phase', () => {
    let state = beginOp(createTradingBotsOpState(), 'deposit');
    state = opSigning(state, state.seq);
    state = opFailed(state, state.seq, 'errSignFailed');
    expect(state.phase).toBe('error');
    expect(state.errorCode).toBe('errSignFailed');
  });

  it('resetOp keeps the seq monotonic so dead completions stay dead', () => {
    const started = beginOp(createTradingBotsOpState(), 'deposit');
    const reset = resetOp(started);
    expect(reset.seq).toBeGreaterThan(started.seq);
    expect(reset.phase).toBe('idle');
  });
});

describe('rate-limit cooldown', () => {
  it('enters the cooldown error with the retryAfterMs anchor', () => {
    const now = 100_000;
    let state = beginOp(createTradingBotsOpState(), 'subscribe');
    state = opRateLimited(state, state.seq, 5_400, now);
    expect(state.phase).toBe('error');
    expect(state.errorCode).toBe(ERR_RATE_LIMITED);
    expect(isCoolingDown(state, now)).toBe(true);
    expect(cooldownRemainingSeconds(state, now)).toBe(6);
    expect(cooldownRemainingSeconds(state, now + 5_400)).toBe(0);
  });

  it('falls back to a 60s cooldown without a usable retryAfterMs', () => {
    const now = 0;
    let state = beginOp(createTradingBotsOpState(), 'deposit');
    state = opRateLimited(state, state.seq, Number.NaN, now);
    expect(cooldownRemainingSeconds(state, now)).toBe(60);
  });

  it('clearElapsedCooldown resets only once the clock passed the anchor', () => {
    const now = 0;
    let state = beginOp(createTradingBotsOpState(), 'deposit');
    state = opRateLimited(state, state.seq, 1_000, now);
    expect(clearElapsedCooldown(state, now + 500)).toBe(state);
    const cleared = clearElapsedCooldown(state, now + 1_001);
    expect(cleared.phase).toBe('idle');
    expect(cleared.cooldownUntilMs).toBeNull();
  });
});

describe('deposit validation (exact bigint bounds)', () => {
  it('accepts both legs on their exact min and max boundaries', () => {
    const atMin = validateDeposit(GRID_SKU, CONFIG, '0.1', '5000');
    expect(atMin).toEqual({
      ok: true,
      solBaseUnits: '100000000',
      wocBaseUnits: '5000000000',
    });
    const atMax = validateDeposit(GRID_SKU, CONFIG, '5', '250000');
    expect(atMax.ok).toBe(true);
  });

  it('rejects one base unit under the min and over the max', () => {
    expect(validateDeposit(GRID_SKU, CONFIG, '0.099999999', '5000')).toEqual({
      ok: false,
      field: 'sol',
      reason: 'out_of_bounds',
    });
    expect(validateDeposit(GRID_SKU, CONFIG, '5.000000001', '5000')).toEqual({
      ok: false,
      field: 'sol',
      reason: 'out_of_bounds',
    });
    expect(validateDeposit(GRID_SKU, CONFIG, '1', '250000.000001')).toEqual({
      ok: false,
      field: 'woc',
      reason: 'out_of_bounds',
    });
  });

  it('rejects malformed, empty, zero, and over-precise amounts as invalid', () => {
    for (const bad of ['', 'abc', '1.2.3', '0', '0.0000000001']) {
      expect(validateDeposit(GRID_SKU, CONFIG, bad, '5000')).toEqual({
        ok: false,
        field: 'sol',
        reason: 'invalid',
      });
    }
    expect(validateDeposit(GRID_SKU, CONFIG, '1', 'nope')).toEqual({
      ok: false,
      field: 'woc',
      reason: 'invalid',
    });
  });

  it('amountWithinBounds is exact digit-string math, no float rounding', () => {
    expect(amountWithinBounds('99999999999999999999', '1', '99999999999999999999')).toBe(true);
    expect(amountWithinBounds('100000000000000000000', '1', '99999999999999999999')).toBe(false);
    expect(amountWithinBounds('x', '1', '2')).toBe(false);
  });

  it('depositBoundsText renders exact decimal bounds for the hint line', () => {
    expect(depositBoundsText(GRID_SKU.minDepositSol, GRID_SKU.maxDepositSol, 9)).toEqual({
      min: '0.1',
      max: '5',
    });
    expect(depositBoundsText('bad', '1', 9)).toBeNull();
  });
});

describe('strategy params', () => {
  it('clamps into bounds and snaps to the step', () => {
    const spec = GRID_SKU.params[0];
    expect(clampParam(spec, 52)).toBe(50);
    expect(clampParam(spec, 53)).toBe(55);
    expect(clampParam(spec, -100)).toBe(10);
    expect(clampParam(spec, 9_999)).toBe(500);
    expect(clampParam(spec, Number.NaN)).toBe(spec.default);
  });

  it('effectiveParams overlays the bot values over the spec defaults', () => {
    expect(effectiveParams(GRID_SKU, STATUS.bot)).toEqual({
      gridSpacingBps: 75,
      orderSizeBps: 500,
    });
    expect(effectiveParams(GRID_SKU, null)).toEqual({ gridSpacingBps: 50, orderSizeBps: 500 });
  });
});

describe('display derivations', () => {
  it('signedPercentText renders exact signed percents from bps', () => {
    expect(signedPercentText(230)).toBe('+2.3');
    expect(signedPercentText(-5)).toBe('-0.05');
    expect(signedPercentText(0)).toBe('0');
    expect(signedPercentText(10_000)).toBe('+100');
    expect(signedPercentText(1.5)).toBeNull();
  });

  it('signedWocText renders the signed exact $WOC delta', () => {
    expect(signedWocText('1200000000', 6)).toBe('+1200');
    expect(signedWocText('-500000', 6)).toBe('-0.5');
    expect(signedWocText('0', 6)).toBe('0');
    expect(signedWocText('junk', 6)).toBeNull();
  });

  it('rental time derivations use the injected clock only', () => {
    const sub = { skuId: 'grid', activeUntilMs: 10 * 86_400_000 };
    expect(rentalDaysLeft(sub, 0)).toBe(10);
    expect(rentalDaysLeft(sub, 9.5 * 86_400_000)).toBe(1);
    expect(rentalDaysLeft(sub, 11 * 86_400_000)).toBe(0);
    expect(isRentalExpired(sub, 10 * 86_400_000)).toBe(true);
    expect(isRentalExpired(sub, 10 * 86_400_000 - 1)).toBe(false);
  });
});
