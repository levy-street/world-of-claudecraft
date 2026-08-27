// The DEFAULT shell argument of attachWocMarketExchange on a real desktop
// boot: NATIVE_APP/DESKTOP_APP come from the live constants and the bridge
// from desktopBridge() reading globalThis.wocDesktop. The sibling suite
// (tests/woc_market_wiring.test.ts) mocks NATIVE_APP=true, which returns at
// the gate's first line, so nothing there proves the default arm actually
// wires the live bridge: a default of `bridge: null` would silently kill the
// Exchange on every real website desktop install while that suite stays
// green. This file mocks a DESKTOP shell instead and drives the default arm
// through a stubbed preload bridge, both verdicts.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/client_origin', () => ({ NATIVE_APP: false, DESKTOP_APP: true }));
vi.mock('../src/net/woc_market_sdk', () => ({
  WocMarketClient: class {
    constructor(readonly cfg: unknown) {}
  },
}));

import { attachWocMarketExchange } from '../src/game/woc_market_wiring';
import type { WocMarketHooks } from '../src/ui/woc_market_window';

// desktopBridge() (src/runtime.ts) requires the login trio before it returns
// the bridge at all; wocExchangeSupported rides alongside like the real
// preload exposes it.
function stubDesktopBridge(supported: () => Promise<boolean>): void {
  (globalThis as { wocDesktop?: unknown }).wocDesktop = {
    openBrowserLogin: async () => undefined,
    takeLoginCode: async () => null,
    onLoginCode: () => () => undefined,
    wocExchangeSupported: supported,
  };
}

function makeDeps() {
  const attached: WocMarketHooks[] = [];
  return {
    attached,
    deps: {
      hud: {
        attachWocMarket: (hooks: WocMarketHooks) => {
          attached.push(hooks);
        },
      },
      api: { token: 'tok-1' as string | null, base: 'https://api.example.test' },
      online: { characterId: 41 },
      wallet: {
        linkedPubkey: () => null,
        load: async () => ({
          signAndSendTransactionBase64: async () => 'sig',
          signMessageBase58: async () => 'msgsig',
        }),
        desktopAuthorize: null,
      },
    },
  };
}

describe('woc_market_wiring: the default shell arm on a desktop boot', () => {
  afterEach(() => {
    (globalThis as { wocDesktop?: unknown }).wocDesktop = undefined;
  });

  it('reads the live bridge probe and attaches on a true verdict', async () => {
    let probes = 0;
    stubDesktopBridge(async () => {
      probes++;
      return true;
    });
    const rig = makeDeps();
    await expect(attachWocMarketExchange(rig.deps)).resolves.toBe(true);
    expect(probes).toBe(1);
    expect(rig.attached.length).toBe(1);
  });

  it('refuses on a false verdict from the same live bridge', async () => {
    stubDesktopBridge(async () => false);
    const rig = makeDeps();
    await expect(attachWocMarketExchange(rig.deps)).resolves.toBe(false);
    expect(rig.attached).toEqual([]);
  });

  it('fails closed when the shell exposes no bridge at all', async () => {
    const rig = makeDeps();
    await expect(attachWocMarketExchange(rig.deps)).resolves.toBe(false);
    expect(rig.attached).toEqual([]);
  });
});
