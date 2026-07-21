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
    disconnectError?: Error;
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
    if (opts.disconnectError) throw opts.disconnectError;
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
  vi.doUnmock('../src/net/mobile_wallet_deeplink');
  vi.doUnmock('../src/net/wallet_connect');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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

  it('lets the wallet manager disconnect the current browser wallet session', async () => {
    const mock = makeWallet({ authorized: true });
    registerWallet(mock.wallet);
    const wallet = await freshWalletModule();
    wallet.setWalletPicker(async () => ({ action: 'disconnect' }));

    await wallet.openWalletModal();

    expect(mock.disconnect).toHaveBeenCalledOnce();
    expect(wallet.currentWallet()).toEqual({ address: null, isConnected: false });
  });

  it('lets the wallet manager disconnect a WalletConnect session', async () => {
    const disconnect = vi.fn(async () => {});
    const listeners = new Set<(state: { address: string | null }) => void>();
    vi.doMock('../src/net/wallet_connect', () => ({
      createWalletConnectClient: vi.fn(async () => ({
        current: () => ({ address: null }),
        connect: async () => ({ address: 'WalletConnectAddress' }),
        disconnect,
        signMessageBase58: vi.fn(),
        signAndSendTransactionBase64: vi.fn(),
        onChange: (listener: (state: { address: string | null }) => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      })),
    }));
    const wallet = await freshWalletModule();
    const states: Array<ReturnType<typeof wallet.currentWallet>> = [];
    wallet.configureWalletConnect('project-id');
    wallet.onWalletChange((state) => states.push(state));
    wallet.setWalletPicker(async (options) => options[0]?.id ?? null);
    await wallet.openWalletModal();
    expect(wallet.currentWallet()).toEqual({
      address: 'WalletConnectAddress',
      isConnected: true,
    });

    wallet.setWalletPicker(async () => ({ action: 'disconnect' }));
    await wallet.openWalletModal();

    expect(disconnect).toHaveBeenCalledOnce();
    expect(wallet.currentWallet()).toEqual({ address: null, isConnected: false });
    expect(states.at(-1)).toEqual({ address: null, isConnected: false });
  });

  it('opens the sole WalletConnect option directly instead of showing a duplicate picker', async () => {
    const connect = vi.fn(async () => ({ address: 'WalletConnectAddress' }));
    vi.doMock('../src/net/wallet_connect', () => ({
      createWalletConnectClient: vi.fn(async () => ({
        current: () => ({ address: null }),
        connect,
        disconnect: vi.fn(async () => {}),
        signMessageBase58: vi.fn(),
        signAndSendTransactionBase64: vi.fn(),
        onChange: () => () => {},
      })),
    }));
    const wallet = await freshWalletModule();
    const picker = vi.fn(async () => null);
    wallet.configureWalletConnect('project-id');
    wallet.setWalletPicker(picker);

    await wallet.openWalletModal();

    expect(picker).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledOnce();
    expect(wallet.currentWallet()).toEqual({
      address: 'WalletConnectAddress',
      isConnected: true,
    });
  });

  it('shows Phantom and Solflare app handoffs instead of a generic Reown option on iOS web', async () => {
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
      maxTouchPoints: 5,
    });
    const mobileConnect = vi.fn(async () => ({
      address: 'MobileWalletAddress',
      chain: 'solana:mainnet',
    }));
    const createMobileWalletClient = vi.fn(async () => ({
      current: () => ({ address: null, chain: null }),
      connect: mobileConnect,
      disconnect: vi.fn(async () => {}),
      signMessageBase58: vi.fn(),
      signAndSendTransactionBase64: vi.fn(),
      onChange: () => () => {},
    }));
    vi.doMock('../src/net/mobile_wallet_deeplink', () => ({ createMobileWalletClient }));
    const wallet = await freshWalletModule();
    wallet.configureWalletConnect('project-id');
    let optionNames: string[] = [];
    let pickerMode = '';
    wallet.setWalletPicker(async (options, _selected, mode) => {
      optionNames = options.map((option) => option.name);
      pickerMode = mode;
      return options[0]?.id ?? null;
    });

    await wallet.openWalletModal();

    expect(optionNames).toEqual(['Phantom', 'Solflare']);
    expect(pickerMode).toBe('mobile');
    expect(mobileConnect).toHaveBeenCalledOnce();
    expect(createMobileWalletClient).toHaveBeenCalledWith('phantom', undefined);
    expect(wallet.currentWallet()).toEqual({ address: 'MobileWalletAddress', isConnected: true });
  });

  it('keeps direct iOS handoffs when Reown is not configured', async () => {
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
      maxTouchPoints: 5,
    });
    const wallet = await freshWalletModule();

    expect(wallet.availableWallets().map((option) => option.name)).toEqual(['Phantom', 'Solflare']);
  });

  it('does not offer wallet handoffs inside an installed iOS web app', async () => {
    const injected = makeWallet({ authorized: true, name: 'Phantom' });
    registerWallet(injected.wallet);
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
      platform: 'iPhone',
      maxTouchPoints: 5,
      standalone: true,
    });
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: true }),
    });
    const wallet = await freshWalletModule();
    wallet.configureWalletConnect('project-id');
    let optionNames: string[] = [];
    let pickerMode = '';
    wallet.setWalletPicker(async (options, _selected, mode) => {
      optionNames = options.map((option) => option.name);
      pickerMode = mode;
      return null;
    });

    await expect(wallet.openWalletModal()).rejects.toSatisfy(wallet.isWalletSelectionCancelled);

    expect(optionNames).toEqual([]);
    expect(pickerMode).toBe('standalone');
    expect(injected.connect).not.toHaveBeenCalled();
    expect(wallet.currentWallet()).toEqual({ address: null, isConnected: false });
  });

  it('preserves the current wallet when the manager is cancelled', async () => {
    const mock = makeWallet({ authorized: true });
    registerWallet(mock.wallet);
    const wallet = await freshWalletModule();
    const modalStates: boolean[] = [];
    wallet.onWalletModalChange((open) => modalStates.push(open));
    wallet.setWalletPicker(async () => null);

    await expect(wallet.openWalletModal()).rejects.toSatisfy(wallet.isWalletSelectionCancelled);

    expect(mock.disconnect).not.toHaveBeenCalled();
    expect(wallet.currentWallet().address).toBe(mock.account.address);
    expect(modalStates).toEqual([false, true, false]);
  });

  it('closes the manager when its picker rejects', async () => {
    const mock = makeWallet({ authorized: true });
    registerWallet(mock.wallet);
    const wallet = await freshWalletModule();
    const modalStates: boolean[] = [];
    wallet.onWalletModalChange((open) => modalStates.push(open));
    wallet.setWalletPicker(async () => {
      throw new Error('picker failed');
    });

    await expect(wallet.openWalletModal()).rejects.toThrow('picker failed');

    expect(wallet.currentWallet().address).toBe(mock.account.address);
    expect(modalStates).toEqual([false, true, false]);
  });

  it('keeps local state disconnected when the provider disconnect reports an error', async () => {
    const mock = makeWallet({ authorized: true, disconnectError: new Error('provider failed') });
    registerWallet(mock.wallet);
    const wallet = await freshWalletModule();
    wallet.setWalletPicker(async () => ({ action: 'disconnect' }));

    await expect(wallet.openWalletModal()).rejects.toThrow('provider failed');

    expect(mock.disconnect).toHaveBeenCalledOnce();
    expect(wallet.currentWallet()).toEqual({ address: null, isConnected: false });
  });

  it('routes WOC balance reads through the configured desktop API origin', async () => {
    vi.stubEnv('VITE_DESKTOP_API_ORIGIN', 'http://127.0.0.1:9876');
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 Electron/43.0.0',
      platform: 'MacIntel',
      maxTouchPoints: 0,
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ balance: 42 }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    vi.resetModules();
    const wallet = await import('../src/net/wallet');

    await expect(wallet.fetchWocBalance('DesktopWallet', true)).resolves.toBe(42);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:9876/api/woc/balance?owner=DesktopWallet&fresh=1',
    );
  });

  it('picks up a compatible wallet registered after initialization', async () => {
    const wallet = await freshWalletModule();
    expect(wallet.availableWallets()).toEqual([]);

    const mock = makeWallet({ name: 'Backpack' });
    registerWallet(mock.wallet);

    expect(wallet.availableWallets().map((option) => option.name)).toEqual(['Backpack']);
  });
});
