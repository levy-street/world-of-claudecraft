import { describe, expect, it, vi } from 'vitest';
import type { BrowserWalletSession } from '../src/net/wallet_handoff_browser';
import { authorizeWalletHandoff } from '../src/wallet_handoff_authorization';

function wallet(address = 'WalletAddress'): BrowserWalletSession {
  return {
    address,
    signMessage: vi.fn(async () => 'message-signature'),
    signAndSendTransaction: vi.fn(async () => 'transaction-signature'),
  };
}

describe('browser wallet handoff authorization', () => {
  it('claims, signs, and completes an account link', async () => {
    const session = wallet();
    const post = vi.fn(async (path: string) => {
      if (path === '/api/desktop-wallet/claim') {
        return { kind: 'link', nonce: 'nonce-1', message: 'Link WalletAddress' };
      }
      return {};
    });

    await authorizeWalletHandoff({
      code: 'handoff-code',
      claim: { kind: 'link' },
      wallet: session,
      post,
    });

    expect(session.signMessage).toHaveBeenCalledWith('Link WalletAddress');
    expect(post).toHaveBeenNthCalledWith(1, '/api/desktop-wallet/claim', {
      code: 'handoff-code',
      address: 'WalletAddress',
    });
    expect(post).toHaveBeenNthCalledWith(2, '/api/desktop-wallet/complete', {
      code: 'handoff-code',
      kind: 'link',
      address: 'WalletAddress',
      nonce: 'nonce-1',
      signature: 'message-signature',
    });
  });

  it('signs only the claimed transaction with the expected wallet', async () => {
    const session = wallet();
    const post = vi.fn(async () => ({}));

    await authorizeWalletHandoff({
      code: 'handoff-code',
      claim: {
        kind: 'transaction',
        transactionBase64: 'authorized-transaction',
        expectedAddress: 'WalletAddress',
      },
      wallet: session,
      post,
    });

    expect(session.signAndSendTransaction).toHaveBeenCalledWith('authorized-transaction');
    expect(post).toHaveBeenCalledWith('/api/desktop-wallet/complete', {
      code: 'handoff-code',
      kind: 'transaction',
      address: 'WalletAddress',
      signature: 'transaction-signature',
    });
  });

  it('rejects an unexpected wallet before signing a transaction', async () => {
    const session = wallet('OtherWallet');
    const post = vi.fn(async () => ({}));

    await expect(
      authorizeWalletHandoff({
        code: 'handoff-code',
        claim: {
          kind: 'transaction',
          transactionBase64: 'authorized-transaction',
          expectedAddress: 'WalletAddress',
        },
        wallet: session,
        post,
      }),
    ).rejects.toThrow('wallet does not match');
    expect(session.signAndSendTransaction).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects a malformed link challenge before asking for a signature', async () => {
    const session = wallet();
    const post = vi.fn(async () => ({ kind: 'link', nonce: 'nonce-without-message' }));

    await expect(
      authorizeWalletHandoff({
        code: 'handoff-code',
        claim: { kind: 'link' },
        wallet: session,
        post,
      }),
    ).rejects.toThrow('invalid wallet challenge');
    expect(session.signMessage).not.toHaveBeenCalled();
  });
});
