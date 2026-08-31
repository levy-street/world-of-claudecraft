import { describe, expect, it, vi } from 'vitest';
import {
  ExchangeOperationGate,
  payServerQuote,
  StaleExchangeOperation,
} from '../src/exchange/payment_flow';

describe('Exchange payment flow', () => {
  it('signs and sends only the server-provided transaction', async () => {
    const send = vi.fn(async () => 'chain-signature');
    await expect(
      payServerQuote({ signatureRequired: true, transactionBase64: 'server-tx' } as never, send),
    ).resolves.toBe('chain-signature');
    expect(send).toHaveBeenCalledWith('server-tx');
  });

  it('uses the existing dev signature contract only when explicitly allowed', async () => {
    const send = vi.fn();
    await expect(
      payServerQuote({ signatureRequired: false, reference: 'ref-7' } as never, send),
    ).resolves.toBe('devsig:ref-7');
    expect(send).not.toHaveBeenCalled();
  });

  it('treats an absent signatureRequired flag as requiring a wallet signature', async () => {
    await expect(payServerQuote({ transactionBase64: null } as never, vi.fn())).rejects.toThrow(
      'missing server transaction',
    );
  });

  it('rejects stale completion and overlapping mutations', () => {
    const gate = new ExchangeOperationGate();
    const first = gate.begin();
    expect(first).toBeTypeOf('number');
    expect(gate.begin()).toBeNull();
    gate.invalidate();
    expect(() => gate.assertCurrent(first as number)).toThrow(StaleExchangeOperation);
    expect(gate.begin()).toBeTypeOf('number');
  });
});
