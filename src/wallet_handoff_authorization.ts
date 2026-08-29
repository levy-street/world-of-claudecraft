import type { BrowserWalletSession } from './net/wallet_handoff_browser';

export type WalletHandoffClaim =
  | { kind: 'link'; address?: string; nonce?: string; message?: string }
  | { kind: 'transaction'; transactionBase64: string; expectedAddress: string }
  | { kind: 'stepup'; message: string; expectedAddress: string };

export type WalletHandoffPost = (path: string, body: Record<string, unknown>) => Promise<unknown>;

/** The body-copy key for the chooser card, one per handoff kind. Extracted
 *  pure so the branch is unit-testable (the page module boots on import):
 *  a step-up moves no funds, and showing it the payment copy in the external
 *  browser is exactly the mistake this pins against. */
export function walletHandoffBodyKey(
  kind: WalletHandoffClaim['kind'],
): 'wallet.browser.linkBody' | 'wallet.browser.stepUpBody' | 'wallet.browser.paymentBody' {
  if (kind === 'link') return 'wallet.browser.linkBody';
  if (kind === 'stepup') return 'wallet.browser.stepUpBody';
  return 'wallet.browser.paymentBody';
}

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

  // Transaction and step-up both bind to the linked wallet the server
  // registered; the signable bytes/message came from the CLAIM (the server's
  // own store), never from the desktop renderer.
  if (wallet.address !== claim.expectedAddress) throw new Error('wallet does not match');
  if (claim.kind === 'stepup') {
    const signature = await wallet.signMessage(claim.message);
    await post('/api/desktop-wallet/complete', {
      code,
      kind: 'stepup',
      address: wallet.address,
      signature,
    });
    return;
  }
  const signature = await wallet.signAndSendTransaction(claim.transactionBase64);
  await post('/api/desktop-wallet/complete', {
    code,
    kind: 'transaction',
    address: wallet.address,
    signature,
  });
}
