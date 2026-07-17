import { beforeEach, describe, expect, it, vi } from 'vitest';

const appKitState = vi.hoisted(() => ({
  account: { isConnected: false, allAccounts: [] as Array<Record<string, string>> },
  chain: 'solana:mainnet',
  open: false,
  accountListener: null as (() => void) | null,
  networkListener: null as (() => void) | null,
  stateListener: null as ((state: { open: boolean }) => void) | null,
}));

const provider = vi.hoisted(() => ({
  signMessage: vi.fn(async () => new Uint8Array([1, 2, 3])),
  signAndSendTransaction: vi.fn(async () => 'chain-signature'),
}));

const appKit = vi.hoisted(() => ({
  getAccount: vi.fn(() => appKitState.account),
  getCaipNetwork: vi.fn(() => ({ caipNetworkId: appKitState.chain })),
  subscribeAccount: vi.fn((listener: () => void) => {
    appKitState.accountListener = listener;
    return () => {};
  }),
  subscribeNetwork: vi.fn((listener: () => void) => {
    appKitState.networkListener = listener;
    return () => {};
  }),
  subscribeState: vi.fn((listener: (state: { open: boolean }) => void) => {
    appKitState.stateListener = listener;
    return () => {};
  }),
  open: vi.fn(async () => {
    appKitState.open = true;
    appKitState.stateListener?.({ open: true });
  }),
  isOpen: vi.fn(() => appKitState.open),
  disconnect: vi.fn(async () => {
    appKitState.account = { isConnected: false, allAccounts: [] };
  }),
  getProvider: vi.fn(() => provider),
}));

vi.mock('@reown/appkit', () => ({ createAppKit: vi.fn(() => appKit) }));
vi.mock('@reown/appkit-adapter-solana', () => ({
  SolanaAdapter: class SolanaAdapter {},
}));
vi.mock('@reown/appkit/networks', () => ({
  solana: { id: 'solana:mainnet', name: 'Solana' },
}));

import { createWalletConnectClient } from '../src/net/wallet_connect';

describe('Reown AppKit connection lifecycle', () => {
  beforeEach(() => {
    appKitState.account = { isConnected: false, allAccounts: [] };
    appKitState.chain = 'solana:mainnet';
    appKitState.open = false;
    appKitState.accountListener = null;
    appKitState.networkListener = null;
    appKitState.stateListener = null;
    vi.clearAllMocks();
  });

  it('waits for the Solana account event and disconnects the active session', async () => {
    const client = await createWalletConnectClient('project-id');
    const connection = client.connect();
    await vi.waitFor(() => expect(appKit.open).toHaveBeenCalledOnce());

    appKitState.account = {
      isConnected: true,
      allAccounts: [{ namespace: 'solana', address: 'ConnectedWallet' }],
    };
    appKitState.accountListener?.();

    await expect(connection).resolves.toEqual({
      address: 'ConnectedWallet',
      chain: 'solana:mainnet',
    });
    expect(client.current()).toEqual({
      address: 'ConnectedWallet',
      chain: 'solana:mainnet',
    });

    await client.disconnect();
    expect(appKit.disconnect).toHaveBeenCalledWith('solana');
    expect(client.current()).toEqual({ address: null, chain: null });
  });

  it('cancels and clears an incomplete pairing when the modal closes', async () => {
    const client = await createWalletConnectClient('project-id');
    const connection = client.connect();
    await vi.waitFor(() => expect(appKit.open).toHaveBeenCalledOnce());

    appKitState.open = false;
    const rejection = expect(connection).rejects.toMatchObject({
      name: 'WalletConnectionCancelled',
    });
    appKitState.stateListener?.({ open: false });

    await rejection;
    expect(appKit.disconnect).toHaveBeenCalledWith('solana');
  });

  it('uses the connected Solana provider for message and transaction signatures', async () => {
    appKitState.account = {
      isConnected: true,
      allAccounts: [{ namespace: 'solana', address: 'ConnectedWallet' }],
    };
    const client = await createWalletConnectClient('project-id');
    // Minimal unsigned legacy transaction. Keeping the fixture as bytes avoids teaching
    // the security scanner that tests may import an unapproved wallet-drain toolkit.
    const encoded =
      'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

    await expect(client.signMessageBase58('Link this wallet')).resolves.toBe('Ldp');
    await expect(client.signAndSendTransactionBase64(encoded)).resolves.toBe('chain-signature');
    expect(provider.signMessage).toHaveBeenCalledWith(new TextEncoder().encode('Link this wallet'));
    expect(provider.signAndSendTransaction).toHaveBeenCalledWith(expect.any(Object), {
      preflightCommitment: 'confirmed',
    });
  });
});
