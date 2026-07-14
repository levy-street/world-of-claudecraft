import { SOLANA_MAINNET_CHAIN } from '@solana/wallet-standard-chains';
import {
  SolanaSignAndSendTransaction,
  type SolanaSignAndSendTransactionInput,
  type SolanaSignAndSendTransactionOutput,
  SolanaSignMessage,
  type SolanaSignMessageInput,
  type SolanaSignMessageOutput,
} from '@solana/wallet-standard-features';
import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount, WalletIcon } from '@wallet-standard/base';
import {
  StandardConnect,
  type StandardConnectInput,
  StandardDisconnect,
  StandardEvents,
  type StandardEventsChangeProperties,
} from '@wallet-standard/features';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ICON = 'data:image/svg+xml;base64,PHN2Zy8+' as WalletIcon;

const unregisters: Array<() => void> = [];

async function freshWalletModule(): Promise<typeof import('../src/net/wallet')> {
  vi.resetModules();
  return import('../src/net/wallet');
}

function registerWallet(wallet: Wallet): void {
  unregisters.push(getWallets().register(wallet));
}

function account(address: string, transactionSupport = true): WalletAccount {
  return {
    address,
    publicKey: new Uint8Array(32),
    chains: [SOLANA_MAINNET_CHAIN],
    features: transactionSupport
      ? [SolanaSignMessage, SolanaSignAndSendTransaction]
      : [SolanaSignMessage],
  };
}

function makeWallet(
  opts: {
    name?: string;
    address?: string;
    authorized?: boolean;
    delayConnect?: () => Promise<void>;
    modifySignedMessage?: boolean;
    transactionSupport?: boolean;
  } = {},
) {
  const walletAccount = account(
    opts.address ?? '8zcEHjvY46ETifvoNbnQ6FbsWc9XyF2KxRTkwHqPfank',
    opts.transactionSupport !== false,
  );
  let accounts: readonly WalletAccount[] = opts.authorized ? [walletAccount] : [];
  const listeners = new Set<(props: StandardEventsChangeProperties) => void>();
  const emitAccounts = () => {
    const props: StandardEventsChangeProperties = { accounts };
    for (const cb of listeners) cb(props);
  };
  const connect = vi.fn(async (_input?: StandardConnectInput) => {
    if (opts.delayConnect) await opts.delayConnect();
    accounts = [walletAccount];
    emitAccounts();
    return { accounts };
  });
  const disconnect = vi.fn(async () => {
    accounts = [];
    emitAccounts();
  });
  const signMessage = vi.fn(
    async (
      ...inputs: readonly SolanaSignMessageInput[]
    ): Promise<readonly SolanaSignMessageOutput[]> => {
      return inputs.map((input) => ({
        signedMessage: opts.modifySignedMessage ? new Uint8Array([9, 9, 9]) : input.message,
        signature: new Uint8Array([1, 2, 3, 4]),
      }));
    },
  );
  const signAndSendTransaction = vi.fn(
    async (
      ...inputs: readonly SolanaSignAndSendTransactionInput[]
    ): Promise<readonly SolanaSignAndSendTransactionOutput[]> =>
      inputs.map(() => ({ signature: new Uint8Array([4, 3, 2, 1]) })),
  );
  const features: Record<string, unknown> = {
    [StandardConnect]: { version: '1.0.0', connect },
    [StandardDisconnect]: { version: '1.0.0', disconnect },
    [StandardEvents]: {
      version: '1.0.0',
      on: (_event: 'change', listener: (props: StandardEventsChangeProperties) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    [SolanaSignMessage]: { version: '1.1.0', signMessage },
  };
  if (opts.transactionSupport !== false) {
    features[SolanaSignAndSendTransaction] = {
      version: '1.0.0',
      supportedTransactionVersions: ['legacy'],
      signAndSendTransaction,
    };
  }
  const wallet: Wallet = {
    version: '1.0.0',
    name: opts.name ?? 'Mock Wallet',
    icon: ICON,
    chains: [SOLANA_MAINNET_CHAIN],
    get accounts() {
      return accounts;
    },
    features: features as Wallet['features'],
  };
  return {
    wallet,
    account: walletAccount,
    connect,
    disconnect,
    signMessage,
    signAndSendTransaction,
  };
}

afterEach(() => {
  while (unregisters.length) unregisters.pop()?.();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Wallet Standard Solana adapter', () => {
  it('uses an already authorized Wallet Standard account for the current wallet', async () => {
    const mock = makeWallet({ authorized: true });
    registerWallet(mock.wallet);

    const wallet = await freshWalletModule();

    expect(wallet.currentWallet()).toEqual({
      address: mock.account.address,
      isConnected: true,
    });
  });

  it('opens the app picker and connects the selected wallet', async () => {
    const mock = makeWallet({ authorized: false, name: 'Solflare' });
    registerWallet(mock.wallet);
    const wallet = await freshWalletModule();
    const states: Array<ReturnType<typeof wallet.currentWallet>> = [];
    let optionNames: string[] = [];
    wallet.onWalletChange((state) => states.push(state));
    wallet.setWalletPicker(async (options) => {
      optionNames = options.map((option) => option.name);
      return options[0]?.id ?? null;
    });

    await wallet.openWalletModal();

    expect(optionNames).toEqual(['Solflare']);
    expect(mock.connect).toHaveBeenCalledWith();
    expect(wallet.currentWallet()).toEqual({ address: mock.account.address, isConnected: true });
    expect(states.at(-1)).toEqual({ address: mock.account.address, isConnected: true });
  });

  it('waits for delayed wallet approval instead of treating picker close as cancellation', async () => {
    let approveConnect!: () => void;
    const approval = new Promise<void>((resolve) => {
      approveConnect = resolve;
    });
    const mock = makeWallet({ delayConnect: () => approval });
    registerWallet(mock.wallet);
    const wallet = await freshWalletModule();
    wallet.setWalletPicker(async (options) => options[0]?.id ?? null);

    const pending = wallet.openWalletModal();
    await Promise.resolve();
    expect(wallet.currentWallet()).toEqual({ address: null, isConnected: false });

    approveConnect();
    await pending;
    expect(wallet.currentWallet()).toEqual({ address: mock.account.address, isConnected: true });
  });

  it('base58-encodes exact message signatures', async () => {
    const mock = makeWallet();
    registerWallet(mock.wallet);
    const wallet = await freshWalletModule();
    wallet.setWalletPicker(async (options) => options[0]?.id ?? null);
    await wallet.openWalletModal();

    await expect(wallet.signMessageBase58('hello')).resolves.toBe('2VfUX');
    expect(mock.signMessage).toHaveBeenCalledWith({
      account: mock.account,
      message: new TextEncoder().encode('hello'),
    });
  });

  it('rejects wallets that modify the signed message', async () => {
    const mock = makeWallet({ modifySignedMessage: true });
    registerWallet(mock.wallet);
    const wallet = await freshWalletModule();
    wallet.setWalletPicker(async (options) => options[0]?.id ?? null);
    await wallet.openWalletModal();

    await expect(wallet.signMessageBase58('hello')).rejects.toThrow(/modified/i);
  });

  it('allows message signing with a wallet that cannot send transactions', async () => {
    const mock = makeWallet({ transactionSupport: false });
    registerWallet(mock.wallet);
    const wallet = await freshWalletModule();
    wallet.setWalletPicker(async (options) => options[0]?.id ?? null);
    await wallet.openWalletModal();

    await expect(wallet.signMessageBase58('hello')).resolves.toBe('2VfUX');
    expect(mock.signMessage).toHaveBeenCalledOnce();
  });

  it('asks the wallet to sign and send a service-built transaction', async () => {
    const mock = makeWallet();
    registerWallet(mock.wallet);
    const wallet = await freshWalletModule();
    wallet.setWalletPicker(async (options) => options[0]?.id ?? null);
    await wallet.openWalletModal();

    await expect(wallet.signAndSendTransactionBase64('AQID')).resolves.toBe('6wxj2');
    expect(mock.signAndSendTransaction).toHaveBeenCalledWith({
      account: mock.account,
      chain: SOLANA_MAINNET_CHAIN,
      transaction: new Uint8Array([1, 2, 3]),
      options: { preflightCommitment: 'confirmed' },
    });
  });

  it('reports when a connected wallet cannot sign and send transactions', async () => {
    const mock = makeWallet({ transactionSupport: false });
    registerWallet(mock.wallet);
    const wallet = await freshWalletModule();
    wallet.setWalletPicker(async (options) => options[0]?.id ?? null);
    await wallet.openWalletModal();

    await expect(wallet.signAndSendTransactionBase64('AQID')).rejects.toThrow(
      /cannot sign and send/i,
    );
    expect(mock.signAndSendTransaction).not.toHaveBeenCalled();
  });

  it('disconnects the browser wallet session without keeping a stale address', async () => {
    const mock = makeWallet({ authorized: true });
    registerWallet(mock.wallet);
    const wallet = await freshWalletModule();

    expect(wallet.currentWallet().address).toBe(mock.account.address);
    await wallet.disconnectWallet();

    expect(mock.disconnect).toHaveBeenCalledOnce();
    expect(wallet.currentWallet()).toEqual({ address: null, isConnected: false });
  });

  it('picks up a compatible wallet registered after initialization', async () => {
    const wallet = await freshWalletModule();
    expect(wallet.availableWallets()).toEqual([]);

    const mock = makeWallet({ name: 'Backpack' });
    registerWallet(mock.wallet);

    expect(wallet.availableWallets().map((option) => option.name)).toEqual(['Backpack']);
  });
});
