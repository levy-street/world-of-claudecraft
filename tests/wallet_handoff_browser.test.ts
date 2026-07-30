import { SOLANA_MAINNET_CHAIN } from '@solana/wallet-standard-chains';
import { SolanaSignAndSendTransaction, SolanaSignMessage } from '@solana/wallet-standard-features';
import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount, WalletIcon } from '@wallet-standard/base';
import { StandardConnect } from '@wallet-standard/features';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserWalletOptions, connectBrowserWallet } from '../src/net/wallet_handoff_browser';

const ICON = 'data:image/svg+xml;base64,PHN2Zy8+' as WalletIcon;
const unregisters: Array<() => void> = [];

function registerWallet(name: string, transactionSupport: boolean): void {
  const features = transactionSupport
    ? [SolanaSignMessage, SolanaSignAndSendTransaction]
    : [SolanaSignMessage];
  const account: WalletAccount = {
    address: `${name}Address`,
    publicKey: new Uint8Array(32),
    chains: [SOLANA_MAINNET_CHAIN],
    features: features as WalletAccount['features'],
  };
  const connect = vi.fn(async () => ({ accounts: [account] }));
  const walletFeatures: Record<string, unknown> = {
    [StandardConnect]: { version: '1.0.0', connect },
    [SolanaSignMessage]: { version: '1.1.0', signMessage: vi.fn() },
  };
  if (transactionSupport) {
    walletFeatures[SolanaSignAndSendTransaction] = {
      version: '1.0.0',
      supportedTransactionVersions: ['legacy'],
      signAndSendTransaction: vi.fn(),
    };
  }
  const wallet: Wallet = {
    version: '1.0.0',
    name,
    icon: ICON,
    chains: [SOLANA_MAINNET_CHAIN],
    accounts: [account],
    features: walletFeatures as Wallet['features'],
  };
  unregisters.push(getWallets().register(wallet));
}

function registerSplitFeatureWallet(name: string): void {
  const account = (suffix: string, features: WalletAccount['features']): WalletAccount => ({
    address: `${name}${suffix}`,
    publicKey: new Uint8Array(32),
    chains: [SOLANA_MAINNET_CHAIN],
    features,
  });
  const wallet: Wallet = {
    version: '1.0.0',
    name,
    icon: ICON,
    chains: [SOLANA_MAINNET_CHAIN],
    accounts: [
      account('Message', [SolanaSignMessage]),
      account('Transaction', [SolanaSignAndSendTransaction]),
    ],
    features: {
      [StandardConnect]: { version: '1.0.0', connect: vi.fn() },
      [SolanaSignMessage]: { version: '1.1.0', signMessage: vi.fn() },
      [SolanaSignAndSendTransaction]: {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy'],
        signAndSendTransaction: vi.fn(),
      },
    },
  };
  unregisters.push(getWallets().register(wallet));
}

afterEach(() => {
  while (unregisters.length) unregisters.pop()?.();
});

describe('desktop browser wallet handoff options', () => {
  it('offers message-only wallets for linking but not for Claudium transactions', () => {
    registerWallet('Message Wallet', false);
    registerWallet('Transaction Wallet', true);

    expect(browserWalletOptions('link').map((wallet) => wallet.name)).toEqual([
      'Message Wallet',
      'Transaction Wallet',
    ]);
    expect(browserWalletOptions('transaction').map((wallet) => wallet.name)).toEqual([
      'Transaction Wallet',
    ]);
  });

  it('rejects a message-only account before transaction authorization begins', async () => {
    registerWallet('Message Wallet', false);

    await expect(connectBrowserWallet('Message Wallet', 'transaction')).rejects.toThrow(
      'wallet extension is not available',
    );
  });

  it('does not offer a multi-account wallet when no account supports both requirements', () => {
    registerSplitFeatureWallet('Split Wallet');

    expect(browserWalletOptions('link').map((wallet) => wallet.name)).toContain('Split Wallet');
    expect(browserWalletOptions('transaction').map((wallet) => wallet.name)).not.toContain(
      'Split Wallet',
    );
  });
});
