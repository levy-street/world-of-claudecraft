import type { BrowserWalletSession } from './net/wallet_handoff_browser';

export type WalletHandoffClaim =
  | { kind: 'link'; address?: string; nonce?: string; message?: string }
  | { kind: 'transaction'; transactionBase64: string; expectedAddress: string };

export type WalletHandoffPost = (path: string, body: Record<string, unknown>) => Promise<unknown>;

/** Complete one browser wallet authorization without trusting renderer-supplied payment bytes. */
export async function authorizeWalletHandoff(input: {
  code: string;
  claim: WalletHandoffClaim;
  wallet: BrowserWalletSession;
  post: WalletHandoffPost;
}): Promise<void> {
  const { code, claim, wallet, post } = input;
  if (claim.kind === 'link') {
    const challenge = (await post('/api/desktop-wallet/claim', {
      code,
      address: wallet.address,
    })) as WalletHandoffClaim;
    if (
      challenge.kind !== 'link' ||
      typeof challenge.message !== 'string' ||
      typeof challenge.nonce !== 'string'
    ) {
      throw new Error('invalid wallet challenge');
    }
    const signature = await wallet.signMessage(challenge.message);
    await post('/api/desktop-wallet/complete', {
      code,
      kind: 'link',
      address: wallet.address,
      nonce: challenge.nonce,
      signature,
    });
    return;
  }

  if (wallet.address !== claim.expectedAddress) throw new Error('wallet does not match');
  const signature = await wallet.signAndSendTransaction(claim.transactionBase64);
  await post('/api/desktop-wallet/complete', {
    code,
    kind: 'transaction',
    address: wallet.address,
    signature,
  });
}
