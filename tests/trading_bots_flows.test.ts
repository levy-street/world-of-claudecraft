// Flow tests for the Trading Bots orchestration core
// (src/ui/trading_bots_flows_core.ts).
//
// These drive the REAL flow functions end to end with a fake host (recording
// every op transition, notice, paint, and refresh) and fake async ops
// (recording every endpoint call), so every button path in the window is an
// executed code path: rent in WOC (request -> sign -> confirm -> done) and in
// Claudium (single call), the malformed-payment-leg rejection, deposit with
// exact-bounds validation, withdraw in BOTH custody shapes, control, the
// no-wallet refusals, the in-flight and cooldown refusals, every error tag
// (rate limit with and without retryAfterMs, coded API, wallet-feature,
// wallet decline), and the exact onFundsMoved contract.

import { describe, expect, it } from 'vitest';
import {
  applyOpFailure,
  controlFlow,
  depositFlow,
  ERR_API,
  ERR_NO_WALLET,
  ERR_SIGN_FAILED,
  ERR_WALLET_FEATURE,
  isCodedError,
  rateLimitRetryMs,
  rentFlow,
  type TradingBotsFlowHost,
  type TradingBotsFlowOps,
  type TradingBotsSubscribeResult,
  type TradingBotsWithdrawResult,
  withdrawFlow,
} from '../src/ui/trading_bots_flows_core';
import {
  createTradingBotsOpState,
  ERR_RATE_LIMITED,
  type TradingBotSku,
  type TradingBotsConfig,
  type TradingBotsOpState,
} from '../src/ui/trading_bots_view';

const OWNER = '11111111111111111111111111111111';

const GRID_SKU: TradingBotSku = {
  id: 'grid',
  priceWocBaseUnits: '250000000000',
  priceClaudium: 900,
  minDepositSol: '100000000',
  maxDepositSol: '5000000000',
  minDepositWoc: '5000000000',
  maxDepositWoc: '250000000000',
  params: [{ key: 'gridSpacingBps', min: 10, max: 500, step: 5, default: 50 }],
};

const CONFIG: TradingBotsConfig = {
  enabled: true,
  wocMint: '3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth',
  wocDecimals: 6,
  solDecimals: 9,
  claudiumEnabled: true,
  skus: [GRID_SKU],
};

// The recording fake host: real op-state container, everything else recorded.
interface FakeHost extends TradingBotsFlowHost {
  op: TradingBotsOpState;
  phases: string[];
  notices: (string | null)[];
  paints: number;
  fieldInvalid: number;
  refreshes: number;
  fundsMoved: number;
  lastApiError: unknown;
}

function makeHost(
  overrides: Partial<Pick<FakeHost, 'walletAddress' | 'isWalletFeatureUnsupported' | 'now'>> = {},
): FakeHost {
  const host: FakeHost = {
    op: createTradingBotsOpState(),
    phases: [],
    notices: [],
    paints: 0,
    fieldInvalid: 0,
    refreshes: 0,
    fundsMoved: 0,
    lastApiError: null,
    getOp: () => host.op,
    setOp: (op) => {
      host.op = op;
      host.phases.push(op.phase);
    },
    setNotice: (tag) => {
      host.notices.push(tag);
    },
    setLastApiError: (err) => {
      host.lastApiError = err;
    },
    paintPanel: () => {
      host.paints += 1;
    },
    onFieldInvalid: () => {
      host.fieldInvalid += 1;
    },
    refreshStatus: async () => {
      host.refreshes += 1;
    },
    walletAddress: () => OWNER,
    isWalletFeatureUnsupported: () => false,
    onFundsMoved: () => {
      host.fundsMoved += 1;
    },
    now: () => 1_000_000,
    ...overrides,
  };
  return host;
}

// The recording fake ops: every endpoint resolves from injected answers and
// records its exact arguments.
interface OpsLog {
  calls: Array<{ name: string; args: unknown[] }>;
}

function makeOps(
  answers: {
    subscribe?: TradingBotsSubscribeResult | Error;
    confirmSubscribe?: unknown | Error;
    deposit?: { depositId: string; depositTransaction: string } | Error;
    confirmDeposit?: unknown | Error;
    withdraw?: TradingBotsWithdrawResult | Error;
    control?: unknown | Error;
    signAndSend?: string | Error;
  } = {},
): TradingBotsFlowOps & OpsLog {
  const calls: OpsLog['calls'] = [];
  const answer = <T>(name: string, value: T | Error | undefined, fallback: T): Promise<T> => {
    if (value instanceof Error) return Promise.reject(value);
    return Promise.resolve(value === undefined ? fallback : value);
  };
  return {
    calls,
    subscribe(skuId, payWith, userPublicKey) {
      calls.push({ name: 'subscribe', args: [skuId, payWith, userPublicKey] });
      return answer('subscribe', answers.subscribe, {
        paymentId: 'pay_1',
        paymentTransaction: 'dHgtcGF5',
      });
    },
    confirmSubscribe(paymentId, signature) {
      calls.push({ name: 'confirmSubscribe', args: [paymentId, signature] });
      return answer('confirmSubscribe', answers.confirmSubscribe, {});
    },
    deposit(solAmount, wocAmount, userPublicKey) {
      calls.push({ name: 'deposit', args: [solAmount, wocAmount, userPublicKey] });
      return answer('deposit', answers.deposit, {
        depositId: 'dep_1',
        depositTransaction: 'dHgtZGVw',
      });
    },
    confirmDeposit(depositId, signature) {
      calls.push({ name: 'confirmDeposit', args: [depositId, signature] });
      return answer('confirmDeposit', answers.confirmDeposit, {});
    },
    withdraw(userPublicKey) {
      calls.push({ name: 'withdraw', args: [userPublicKey] });
      return answer('withdraw', answers.withdraw, { withdrawTransaction: 'dHgtd2Q=' });
    },
    control(action, params) {
      calls.push({ name: 'control', args: [action, params] });
      return answer('control', answers.control, {});
    },
    signAndSend(txBase64) {
      calls.push({ name: 'signAndSend', args: [txBase64] });
      return answer('signAndSend', answers.signAndSend, 'sig_base58');
    },
  };
}

const codedError = (code: string, params?: Record<string, unknown>) =>
  Object.assign(new Error(`coded ${code}`), { code, params });

describe('rentFlow', () => {
  it('WOC path walks subscribe -> sign -> confirm -> done and refreshes', async () => {
    const host = makeHost();
    const ops = makeOps();
    await rentFlow(host, ops, 'grid', 'woc');
    expect(host.phases).toEqual(['requesting', 'signing', 'confirming', 'done']);
    expect(ops.calls.map((c) => c.name)).toEqual(['subscribe', 'signAndSend', 'confirmSubscribe']);
    expect(ops.calls[0].args).toEqual(['grid', 'woc', OWNER]);
    expect(ops.calls[1].args).toEqual(['dHgtcGF5']);
    expect(ops.calls[2].args).toEqual(['pay_1', 'sig_base58']);
    expect(host.notices).toEqual([null, 'subscribed']);
    expect(host.refreshes).toBe(1);
    expect(host.fundsMoved).toBe(0);
  });

  it('Claudium path is a single call: no signing, no confirm', async () => {
    const host = makeHost();
    const ops = makeOps({ subscribe: { subscription: { skuId: 'grid' } } });
    await rentFlow(host, ops, 'grid', 'claudium');
    expect(host.phases).toEqual(['requesting', 'done']);
    expect(ops.calls.map((c) => c.name)).toEqual(['subscribe']);
    expect(ops.calls[0].args).toEqual(['grid', 'claudium', OWNER]);
    expect(host.refreshes).toBe(1);
  });

  it('a malformed WOC payment leg is an error, never signed', async () => {
    const host = makeHost();
    const ops = makeOps({ subscribe: { paymentId: 'pay_1' } });
    await rentFlow(host, ops, 'grid', 'woc');
    expect(host.op.phase).toBe('error');
    expect(host.op.errorCode).toBe(ERR_SIGN_FAILED);
    expect(ops.calls.map((c) => c.name)).toEqual(['subscribe']);
    expect(host.refreshes).toBe(0);
  });

  it('refuses a WOC rental with no connected wallet, zero endpoint calls', async () => {
    const host = makeHost({ walletAddress: () => null });
    const ops = makeOps();
    await rentFlow(host, ops, 'grid', 'woc');
    expect(host.op.phase).toBe('error');
    expect(host.op.errorCode).toBe(ERR_NO_WALLET);
    expect(ops.calls).toEqual([]);
  });

  it('a Claudium rental needs no wallet', async () => {
    const host = makeHost({ walletAddress: () => null });
    const ops = makeOps({ subscribe: { subscription: {} } });
    await rentFlow(host, ops, 'grid', 'claudium');
    expect(host.op.phase).toBe('done');
    expect(ops.calls[0].args).toEqual(['grid', 'claudium', null]);
  });

  it('refuses while another op is in flight and while cooling down', async () => {
    const inFlight = makeHost();
    inFlight.op = { ...inFlight.op, phase: 'requesting', kind: 'deposit' };
    const ops1 = makeOps();
    await rentFlow(inFlight, ops1, 'grid', 'woc');
    expect(ops1.calls).toEqual([]);

    const cooling = makeHost();
    cooling.op = { ...cooling.op, cooldownUntilMs: cooling.now() + 5_000 };
    const ops2 = makeOps();
    await rentFlow(cooling, ops2, 'grid', 'woc');
    expect(ops2.calls).toEqual([]);
  });

  it('a wallet decline during signing lands on ERR_SIGN_FAILED', async () => {
    const host = makeHost();
    const ops = makeOps({ signAndSend: new Error('declined in wallet') });
    await rentFlow(host, ops, 'grid', 'woc');
    expect(host.op.phase).toBe('error');
    expect(host.op.errorCode).toBe(ERR_SIGN_FAILED);
    expect(host.lastApiError).toBeInstanceOf(Error);
  });
});

describe('depositFlow', () => {
  it('validates, deposits, signs, confirms, moves funds, refreshes', async () => {
    const host = makeHost();
    const ops = makeOps();
    await depositFlow(host, ops, GRID_SKU, CONFIG, '0.5', '10000');
    expect(host.phases).toEqual(['requesting', 'signing', 'confirming', 'done']);
    expect(ops.calls.map((c) => c.name)).toEqual(['deposit', 'signAndSend', 'confirmDeposit']);
    // Exact base units forwarded: 0.5 SOL at 9 decimals, 10000 WOC at 6.
    expect(ops.calls[0].args).toEqual(['500000000', '10000000000', OWNER]);
    expect(ops.calls[2].args).toEqual(['dep_1', 'sig_base58']);
    expect(host.fundsMoved).toBe(1);
    expect(host.refreshes).toBe(1);
  });

  it('an out-of-bounds or malformed amount paints the field error, zero calls', async () => {
    for (const [sol, woc] of [
      ['0.099999999', '10000'],
      ['1', '250000.000001'],
      ['abc', '10000'],
      ['1', ''],
    ]) {
      const host = makeHost();
      const ops = makeOps();
      await depositFlow(host, ops, GRID_SKU, CONFIG, sol, woc);
      expect(host.fieldInvalid).toBe(1);
      expect(host.phases).toEqual([]);
      expect(ops.calls).toEqual([]);
    }
  });

  it('refuses with no connected wallet after validation passes', async () => {
    const host = makeHost({ walletAddress: () => null });
    const ops = makeOps();
    await depositFlow(host, ops, GRID_SKU, CONFIG, '0.5', '10000');
    expect(host.op.errorCode).toBe(ERR_NO_WALLET);
    expect(ops.calls).toEqual([]);
  });

  it('a coded API failure on confirm keeps funds-moved uncalled', async () => {
    const host = makeHost();
    const ops = makeOps({ confirmDeposit: codedError('trading_bots.payment_unverified') });
    await depositFlow(host, ops, GRID_SKU, CONFIG, '0.5', '10000');
    expect(host.op.phase).toBe('error');
    expect(host.op.errorCode).toBe(ERR_API);
    expect(host.fundsMoved).toBe(0);
    expect(host.refreshes).toBe(0);
  });

  it('the typed wallet-feature error gets its own tag', async () => {
    const featureErr = new Error('no signAndSend feature');
    const host = makeHost({ isWalletFeatureUnsupported: (err) => err === featureErr });
    const ops = makeOps({ signAndSend: featureErr });
    await depositFlow(host, ops, GRID_SKU, CONFIG, '0.5', '10000');
    expect(host.op.errorCode).toBe(ERR_WALLET_FEATURE);
  });
});

describe('withdrawFlow', () => {
  it('owner-transaction custody shape: withdraw -> sign -> done', async () => {
    const host = makeHost();
    const ops = makeOps();
    await withdrawFlow(host, ops);
    expect(host.phases).toEqual(['requesting', 'signing', 'done']);
    expect(ops.calls.map((c) => c.name)).toEqual(['withdraw', 'signAndSend']);
    expect(ops.calls[0].args).toEqual([OWNER]);
    expect(host.notices).toEqual([null, 'withdrawPending']);
    expect(host.fundsMoved).toBe(1);
    expect(host.refreshes).toBe(1);
  });

  it('service-signed custody shape: no transaction means no signing leg', async () => {
    const host = makeHost();
    const ops = makeOps({ withdraw: {} });
    await withdrawFlow(host, ops);
    expect(host.phases).toEqual(['requesting', 'done']);
    expect(ops.calls.map((c) => c.name)).toEqual(['withdraw']);
    expect(host.fundsMoved).toBe(1);
  });

  it('refuses with no connected wallet', async () => {
    const host = makeHost({ walletAddress: () => null });
    const ops = makeOps();
    await withdrawFlow(host, ops);
    expect(host.op.errorCode).toBe(ERR_NO_WALLET);
    expect(ops.calls).toEqual([]);
  });

  it('a vault_busy coded refusal maps to ERR_API and moves no funds', async () => {
    const host = makeHost();
    const ops = makeOps({ withdraw: codedError('trading_bots.vault_busy') });
    await withdrawFlow(host, ops);
    expect(host.op.errorCode).toBe(ERR_API);
    expect(host.fundsMoved).toBe(0);
  });
});

describe('controlFlow', () => {
  it('start, pause, and update_params each forward exactly one call', async () => {
    for (const [action, params] of [
      ['start', undefined],
      ['pause', undefined],
      ['update_params', { gridSpacingBps: 75 }],
    ] as const) {
      const host = makeHost();
      const ops = makeOps();
      await controlFlow(host, ops, action, params);
      expect(host.phases).toEqual(['requesting', 'done']);
      expect(ops.calls).toEqual([{ name: 'control', args: [action, params] }]);
      expect(host.refreshes).toBe(1);
      expect(host.fundsMoved).toBe(0);
    }
  });

  it('a subscription_expired refusal surfaces as a coded API error', async () => {
    const host = makeHost();
    const ops = makeOps({ control: codedError('trading_bots.subscription_expired') });
    await controlFlow(host, ops, 'start');
    expect(host.op.phase).toBe('error');
    expect(host.op.errorCode).toBe(ERR_API);
  });
});

describe('failure mapping', () => {
  it('a coded rate limit enters the cooldown with the exact retryAfterMs', async () => {
    const host = makeHost();
    const ops = makeOps({
      subscribe: codedError('trading_bots.rate_limited', { retryAfterMs: 5_400 }),
    });
    await rentFlow(host, ops, 'grid', 'woc');
    expect(host.op.phase).toBe('error');
    expect(host.op.errorCode).toBe(ERR_RATE_LIMITED);
    expect(host.op.cooldownUntilMs).toBe(host.now() + 5_400);
  });

  it('a rate limit without a usable retryAfterMs falls back to 60s', async () => {
    const host = makeHost();
    const ops = makeOps({ control: codedError('trading_bots.rate_limited') });
    await controlFlow(host, ops, 'pause');
    expect(host.op.cooldownUntilMs).toBe(host.now() + 60_000);
  });

  it('a stale-seq failure cannot overwrite a newer op', () => {
    const host = makeHost();
    // Op 1 starts, then the window resets and op 2 starts before op 1 fails.
    host.setOp({ ...host.op, phase: 'requesting', kind: 'subscribe', seq: 1 });
    const staleSeq = 1;
    host.setOp({ ...host.op, phase: 'requesting', kind: 'control', seq: 2 });
    applyOpFailure(host, staleSeq, codedError('trading_bots.vault_busy'));
    // The op state is untouched by the stale completion (still op 2 in flight);
    // only the diagnostic error capture and a repaint happened.
    expect(host.op.seq).toBe(2);
    expect(host.op.phase).toBe('requesting');
  });

  it('rateLimitRetryMs reads only the trading_bots.rate_limited code', () => {
    expect(rateLimitRetryMs(codedError('trading_bots.rate_limited', { retryAfterMs: 250 }))).toBe(
      250,
    );
    expect(rateLimitRetryMs(codedError('trading_bots.rate_limited', { retryAfterMs: -1 }))).toBe(
      60_000,
    );
    expect(rateLimitRetryMs(codedError('dex_swap.rate_limited', { retryAfterMs: 250 }))).toBeNull();
    expect(rateLimitRetryMs(new Error('plain'))).toBeNull();
    expect(rateLimitRetryMs(null)).toBeNull();
  });

  it('isCodedError requires a non-empty string code', () => {
    expect(isCodedError(codedError('trading_bots.disabled'))).toBe(true);
    expect(isCodedError(Object.assign(new Error('x'), { code: '' }))).toBe(false);
    expect(isCodedError(new Error('x'))).toBe(false);
    expect(isCodedError(null)).toBe(false);
    expect(isCodedError('string')).toBe(false);
  });
});
