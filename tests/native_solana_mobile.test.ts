import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  connectNativeSolanaWallet,
  createNativeSolanaWalletClient,
  nativeSolanaMobileBridge,
  normalizeSolanaMobileCapabilities,
  signNativeSolanaMessage,
} from '../src/net/native_solana_mobile';

const originalWindow = globalThis.window;

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  });
});

function installPlugin(plugin: Record<string, unknown>): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { Capacitor: { Plugins: { NativeSolanaMobile: plugin } } },
  });
}

describe('native Solana Mobile bridge', () => {
  it('normalizes unknown or incomplete capability values to fail closed', () => {
    expect(normalizeSolanaMobileCapabilities(null)).toEqual({
      distribution: 'unknown',
      device: 'unknown',
      mwaAvailable: false,
    });
    expect(
      normalizeSolanaMobileCapabilities({
        distribution: 'invalid' as never,
        device: 'seeker',
        mwaAvailable: true,
      }),
    ).toEqual({
      distribution: 'unknown',
      device: 'seeker',
      mwaAvailable: true,
    });
  });

  it('returns fail-closed capabilities when the native plugin is absent', async () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

    await expect(nativeSolanaMobileBridge.solanaMobileCapabilities?.()).resolves.toEqual({
      distribution: 'unknown',
      device: 'unknown',
      mwaAvailable: false,
    });
  });

  it('passes normalized capabilities from a complete native plugin', async () => {
    installPlugin({
      getCapabilities: vi.fn(async () => ({
        distribution: 'solana-dapp-store',
        device: 'seeker',
        mwaAvailable: true,
      })),
      current: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      signMessage: vi.fn(),
      signAndSendTransaction: vi.fn(),
    });

    await expect(nativeSolanaMobileBridge.solanaMobileCapabilities?.()).resolves.toEqual({
      distribution: 'solana-dapp-store',
      device: 'seeker',
      mwaAvailable: true,
    });
  });

  it('rejects malformed wallet results instead of treating them as verified', async () => {
    installPlugin({
      getCapabilities: vi.fn(),
      current: vi.fn(),
      connect: vi.fn(async () => ({ address: '' })),
      disconnect: vi.fn(),
      signMessage: vi.fn(async () => ({ signature: null })),
      signAndSendTransaction: vi.fn(),
    });

    await expect(connectNativeSolanaWallet()).rejects.toThrow('no address');
    await expect(signNativeSolanaMessage('challenge')).rejects.toThrow('no signature');
  });

  it('restores, connects, and clears the native wallet state through one client seam', async () => {
    const current = vi.fn(async () => ({ address: 'restored' }));
    const connect = vi.fn(async () => ({ address: 'connected' }));
    const disconnect = vi.fn(async () => undefined);
    installPlugin({
      getCapabilities: vi.fn(),
      current,
      connect,
      disconnect,
      signMessage: vi.fn(),
      signAndSendTransaction: vi.fn(),
    });
    const client = createNativeSolanaWalletClient();
    const changes: (string | null)[] = [];
    client.onChange((state) => changes.push(state.address));

    await expect(client.current()).resolves.toEqual({
      address: 'restored',
      isConnected: true,
    });
    await expect(client.connect()).resolves.toEqual({
      address: 'connected',
      isConnected: true,
    });
    await client.disconnect();

    expect(changes).toEqual(['connected', null]);
  });
});
