import { describe, expect, it } from 'vitest';
import {
  deserializeSolanaTransaction,
  parseAppKitAccountState,
  walletConnectRuntimeOptions,
} from '../src/net/wallet_connect';

const LEGACY_TRANSACTION_BASE64 =
  'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const V0_TRANSACTION_BASE64 =
  'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAQAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

describe('Reown AppKit Solana adapter', () => {
  it('uses the direct QR pairing view without Wallet Standard registration in the desktop app', () => {
    expect(walletConnectRuntimeOptions('app:')).toEqual({
      registerWalletStandard: false,
      modalView: 'ConnectingWalletConnectBasic',
      allWallets: 'HIDE',
      enableWalletGuide: false,
    });
  });

  it('keeps the wallet discovery view for normal web origins', () => {
    expect(walletConnectRuntimeOptions('https:')).toEqual({
      registerWalletStandard: false,
      modalView: 'Connect',
      allWallets: 'SHOW',
      enableWalletGuide: true,
    });
  });

  it('extracts the public address and chain from the active Solana account', () => {
    expect(
      parseAppKitAccountState(
        {
          isConnected: true,
          allAccounts: [{ namespace: 'solana', address: 'WalletPublicKey' }],
        },
        'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      ),
    ).toEqual({
      chain: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      address: 'WalletPublicKey',
    });
  });

  it('ignores disconnected and non-Solana accounts', () => {
    expect(
      parseAppKitAccountState(
        {
          isConnected: false,
          allAccounts: [{ namespace: 'solana', address: 'WalletPublicKey' }],
        },
        'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      ),
    ).toEqual({ chain: null, address: null });
    expect(
      parseAppKitAccountState(
        {
          isConnected: true,
          allAccounts: [{ namespace: 'eip155', address: '0x123' }],
        },
        'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      ),
    ).toEqual({ chain: null, address: null });
  });

  it('deserializes legacy transactions from the service base64 payload', () => {
    expect('version' in deserializeSolanaTransaction(LEGACY_TRANSACTION_BASE64)).toBe(false);
  });

  it('deserializes versioned transactions from the service base64 payload', () => {
    expect('version' in deserializeSolanaTransaction(V0_TRANSACTION_BASE64)).toBe(true);
  });
});
