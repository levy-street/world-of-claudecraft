import { describe, expect, it } from 'vitest';
import { buildClaudiumView, type ClaudiumViewInput } from '../src/ui/claudium_view';

// The pure Claudium view core is DOM/i18n/net-free, so it drives directly here.
// Two states matter: a funded state (service on) and the service-off disabled
// state (balance null). The core recomputes NOTHING; it only projects the
// service payloads into render rows + per-rail availability.

const funded: ClaudiumViewInput = {
  balance: 1250,
  skus: [
    { sku: 's1', usd: 1, claudium: 100 },
    { sku: 's10', usd: 10, claudium: 1000 },
    { sku: 's100', usd: 100, claudium: 10000 },
  ],
  nativeRails: { sol: true, woc: true },
  walletBalances: { solLamports: '2000000000', wocBaseUnits: '20000000' },
  nativePrices: [
    { sku: 's1', solAmountBase: '10000000', wocAmountBase: '1000000' },
    { sku: 's10', solAmountBase: '100000000', wocAmountBase: '10000000' },
    { sku: 's100', solAmountBase: '10000000000', wocAmountBase: '100000000' },
  ],
};

describe('buildClaudiumView disabled state (service off)', () => {
  it('renders a clean empty state when balance is null, not an error', () => {
    const view = buildClaudiumView({
      balance: null,
      skus: [],
    });
    expect(view.disabled).toBe(true);
    expect(view.hasBalance).toBe(false);
    expect(view.balance).toBeNull();
    expect(view.buyRows).toEqual([]);
    expect(view.rails).toEqual({ stripe: false, sol: false, woc: false });
    expect(view.buyDisabled).toBe(true);
  });

  it('stays disabled even if skus/price somehow arrive with a null balance', () => {
    // A null balance is authoritative: the service is off, so nothing transacts.
    const view = buildClaudiumView({
      balance: null,
      skus: [{ sku: 's1', usd: 1, claudium: 100 }],
    });
    expect(view.disabled).toBe(true);
    expect(view.buyRows).toEqual([]);
    expect(view.buyDisabled).toBe(true);
  });
});

describe('buildClaudiumView funded state (service on)', () => {
  it('maps the SKU ladder verbatim into buy rows', () => {
    const view = buildClaudiumView(funded);
    expect(view.disabled).toBe(false);
    expect(view.hasBalance).toBe(true);
    expect(view.balance).toBe(1250);
    expect(view.buyRows).toEqual([
      {
        sku: 's1',
        usd: 1,
        claudium: 100,
        stripeConfigured: true,
        solAffordable: true,
        wocAffordable: true,
        solAmountBase: '10000000',
        wocAmountBase: '1000000',
      },
      {
        sku: 's10',
        usd: 10,
        claudium: 1000,
        stripeConfigured: true,
        solAffordable: true,
        wocAffordable: true,
        solAmountBase: '100000000',
        wocAmountBase: '10000000',
      },
      {
        sku: 's100',
        usd: 100,
        claudium: 10000,
        stripeConfigured: true,
        solAffordable: false,
        wocAffordable: false,
        solAmountBase: '10000000000',
        wocAmountBase: '100000000',
      },
    ]);
  });

  it('enables both native rails when the service exposes priced SKU quotes', () => {
    const view = buildClaudiumView(funded);
    expect(view.rails).toEqual({ stripe: true, sol: true, woc: true });
    expect(view.buyDisabled).toBe(false);
  });

  it('keeps unconfigured Stripe SKU rows visible but unavailable on the Stripe rail', () => {
    const view = buildClaudiumView({
      ...funded,
      skus: [
        { sku: 's1', usd: 1, claudium: 100, stripeConfigured: false },
        { sku: 's10', usd: 10, claudium: 1000, stripeConfigured: false },
      ],
    });
    expect(view.buyRows).toEqual([
      {
        sku: 's1',
        usd: 1,
        claudium: 100,
        stripeConfigured: false,
        solAffordable: true,
        wocAffordable: true,
        solAmountBase: '10000000',
        wocAmountBase: '1000000',
      },
      {
        sku: 's10',
        usd: 10,
        claudium: 1000,
        stripeConfigured: false,
        solAffordable: true,
        wocAffordable: true,
        solAmountBase: '100000000',
        wocAmountBase: '10000000',
      },
    ]);
    expect(view.rails).toEqual({ stripe: false, sol: true, woc: true });
    expect(view.buyDisabled).toBe(false);
  });

  it('marks native SKU rows unaffordable when the connected wallet balance is too low', () => {
    const view = buildClaudiumView({
      ...funded,
      walletBalances: { solLamports: '9999999', wocBaseUnits: '999999' },
    });
    expect(view.buyRows[0].solAffordable).toBe(false);
    expect(view.buyRows[0].wocAffordable).toBe(false);
  });

  it('disables native rails when the service reports them unavailable', () => {
    const view = buildClaudiumView({
      ...funded,
      nativeRails: { sol: false, woc: false },
    });
    expect(view.rails).toEqual({ stripe: true, sol: false, woc: false });
    // Stripe still works, so buying is not disabled.
    expect(view.buyDisabled).toBe(false);
  });

  it('disables both rails when there are no skus (stripe needs a rung, woc needs both)', () => {
    const view = buildClaudiumView({ ...funded, skus: [] });
    expect(view.rails).toEqual({ stripe: false, sol: false, woc: false });
    expect(view.buyDisabled).toBe(true);
    // A zero balance is still a funded (known) state, distinct from the null/off state.
  });

  it('treats a zero balance as a known funded state, not the disabled state', () => {
    const view = buildClaudiumView({ ...funded, balance: 0 });
    expect(view.disabled).toBe(false);
    expect(view.hasBalance).toBe(true);
    expect(view.balance).toBe(0);
  });
});

describe('buildClaudiumView is a pure projection', () => {
  it('returns identical structure for identical input (no hidden state)', () => {
    expect(buildClaudiumView(funded)).toEqual(buildClaudiumView(funded));
  });
});
