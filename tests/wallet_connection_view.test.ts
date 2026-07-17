import { describe, expect, it } from 'vitest';
import { resolveWalletCapability } from '../src/net/wallet_capability';
import { buildWalletConnectionView } from '../src/ui/wallet_connection_view';

describe('wallet host capability', () => {
  it('enables website and mobile web but not Capacitor native', async () => {
    await expect(
      resolveWalletCapability({
        disabled: false,
        nativeApp: false,
        desktopApp: false,
        bridge: null,
      }),
    ).resolves.toBe(true);
    await expect(
      resolveWalletCapability({
        disabled: false,
        nativeApp: true,
        desktopApp: false,
        bridge: null,
      }),
    ).resolves.toBe(false);
  });

  it('trusts the Electron distribution probe and fails closed on old shells', async () => {
    await expect(
      resolveWalletCapability({
        disabled: false,
        nativeApp: false,
        desktopApp: true,
        bridge: { walletConnectionSupported: async () => true },
      }),
    ).resolves.toBe(true);
    await expect(
      resolveWalletCapability({ disabled: false, nativeApp: false, desktopApp: true, bridge: {} }),
    ).resolves.toBe(false);
  });

  it('keeps the Steam desktop bridge wallet flow disabled', async () => {
    await expect(
      resolveWalletCapability({
        disabled: false,
        nativeApp: false,
        desktopApp: true,
        bridge: { walletConnectionSupported: async () => false },
      }),
    ).resolves.toBe(false);
  });

  it('honors the wallet kill switch and fails closed when the bridge throws', async () => {
    await expect(
      resolveWalletCapability({
        disabled: true,
        nativeApp: false,
        desktopApp: false,
        bridge: null,
      }),
    ).resolves.toBe(false);
    await expect(
      resolveWalletCapability({
        disabled: false,
        nativeApp: false,
        desktopApp: true,
        bridge: {
          walletConnectionSupported: async () => {
            throw new Error('bridge unavailable');
          },
        },
      }),
    ).resolves.toBe(false);
  });
});

describe('wallet connection view', () => {
  it('distinguishes an account link from a live signing connection', () => {
    expect(
      buildWalletConnectionView({
        enabled: true,
        linkedAddress: 'linked',
        connectedAddress: null,
        linkedBalance: 120,
        connectedBalance: null,
      }),
    ).toMatchObject({
      kind: 'linked_disconnected',
      action: 'reconnect',
      balance: 120,
      balanceVerified: true,
    });
  });

  it('treats a linked wallet as usable when the desktop browser signer is available', () => {
    expect(
      buildWalletConnectionView({
        enabled: true,
        linkedAddress: 'linked',
        connectedAddress: null,
        linkedBalance: 120,
        connectedBalance: null,
        externalSignerAvailable: true,
      }),
    ).toMatchObject({
      kind: 'linked_connected',
      connectedAddress: 'linked',
      action: 'manage',
      balance: 120,
      balanceVerified: true,
    });
  });

  it('requires the exact linked wallet when another wallet is connected', () => {
    expect(
      buildWalletConnectionView({
        enabled: true,
        linkedAddress: 'linked',
        connectedAddress: 'other',
        linkedBalance: 50,
        connectedBalance: 900,
      }),
    ).toMatchObject({ kind: 'mismatched', action: 'verify', balance: 50 });
  });

  it('offers verification after an unlinked wallet connects', () => {
    expect(
      buildWalletConnectionView({
        enabled: true,
        linkedAddress: null,
        connectedAddress: 'new',
        linkedBalance: null,
        connectedBalance: 25,
      }),
    ).toMatchObject({
      kind: 'connected_unlinked',
      action: 'verify',
      balance: 25,
      balanceVerified: false,
    });
  });
});
