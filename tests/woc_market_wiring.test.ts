// The $WOC Exchange attach composition (src/game/woc_market_wiring.ts): the
// distribution-aware shell gate (browser web, verified Seeker Solana-store
// Android, plus the website-distributed desktop shell; everything else
// fail-closed), the live wiring of every hook, the wrapped-shell browser
// hand-off notice, and the main.ts firewall (main.ts carries one call, never
// the client construction or the hook object). A gate that quietly attached
// inside a forbidden store shell would ship the exchange to platforms whose
// terms of service forbid it, while a denied desktop shell that stayed silent
// instead of revealing the hand-off notice would look like a bug.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { wocExchangeSupported } from '../electron/desktop_config.cjs';
import { stripComments } from './helpers/strip_comments';

// The default shell flags are the live constants; mock them TRUE so the
// default-argument arm proves it reads them (a hardcoded { false, false }
// default would attach here and fail the pin below).
vi.mock('../src/client_origin', () => ({ NATIVE_APP: true, DESKTOP_APP: false }));
vi.mock('../src/net/native_solana_mobile', () => ({
  nativeSolanaMobileBridge: {
    solanaMobileCapabilities: async () => ({
      distribution: 'solana-dapp-store',
      device: 'seeker',
      mwaAvailable: true,
    }),
  },
}));

type ClientCfg = { token(): string | null; base?: string };
const constructed: { cfg: ClientCfg }[] = [];
vi.mock('../src/net/woc_market_sdk', () => ({
  WocMarketClient: class {
    constructor(readonly cfg: ClientCfg) {
      constructed.push(this);
    }
  },
}));

import {
  attachWocMarketExchange,
  type WocMarketShell,
  type WocMarketWiringDeps,
  wocMarketAttachAllowed,
  wocMarketBrowserHandoffAllowed,
} from '../src/game/woc_market_wiring';
import type { WocMarketHooks } from '../src/ui/woc_market_window';

const WEB: WocMarketShell = { nativeApp: false, desktopApp: false, bridge: null };

/** A desktop shell whose bridge probe answers `supported`. */
function desktopShell(supported: boolean): WocMarketShell {
  return {
    nativeApp: false,
    desktopApp: true,
    bridge: { wocExchangeSupported: async () => supported },
  };
}

function nativeShell(
  distribution: 'solana-dapp-store' | 'google-play' | 'unknown',
  device: 'seeker' | 'other' | 'unknown',
  mwaAvailable: boolean,
): WocMarketShell {
  return {
    nativeApp: true,
    desktopApp: false,
    bridge: null,
    mobileBridge: {
      solanaMobileCapabilities: async () => ({ distribution, device, mwaAvailable }),
    },
  };
}

/** A desktop shell wired to the REAL electron decision for one distribution
 *  stamp, exactly as electron/main.cjs answers the desktop-exchange-capability
 *  IPC from its packaged stamp. */
function stampedDesktopShell(distribution: string): WocMarketShell {
  return {
    nativeApp: false,
    desktopApp: true,
    bridge: {
      wocExchangeSupported: async () =>
        wocExchangeSupported({
          packagedMetadata: { wocDesktop: { distribution } },
          isPackaged: true,
        }),
    },
  };
}

function makeDeps() {
  const attached: WocMarketHooks[] = [];
  let browserOnlyNotices = 0;
  const api = { token: 'tok-1' as string | null, base: 'https://api.example.test' };
  const online = { characterId: 41 };
  let linked: string | null = null;
  const signCalls: string[] = [];
  const messageSignCalls: string[] = [];
  let loads = 0;
  const walletModule = {
    signAndSendTransactionBase64: async (transactionBase64: string) => {
      signCalls.push(transactionBase64);
      return `sig:${transactionBase64}`;
    },
    signMessageBase58: async (message: string) => {
      messageSignCalls.push(message);
      return `msgsig:${message}`;
    },
  };
  const deps = {
    hud: {
      attachWocMarket: (hooks: WocMarketHooks) => {
        attached.push(hooks);
      },
      attachWocMarketBrowserOnlyNotice: () => {
        browserOnlyNotices++;
      },
    },
    api,
    online,
    wallet: {
      linkedPubkey: () => linked,
      load: async () => {
        loads++;
        return walletModule;
      },
      // Browser web: no desktop external-browser signer.
      desktopAuthorize: null as WocMarketWiringDeps['wallet']['desktopAuthorize'],
    },
  };
  return {
    deps,
    attached,
    api,
    online,
    setLinked: (value: string | null) => {
      linked = value;
    },
    signCalls,
    messageSignCalls,
    loads: () => loads,
    browserOnlyNotices: () => browserOnlyNotices,
  };
}

describe('woc_market_wiring: the distribution-aware shell gate', () => {
  beforeEach(() => {
    constructed.length = 0;
  });

  it('allows the plain browser web shell without consulting any bridge', async () => {
    let probes = 0;
    const shell: WocMarketShell = {
      nativeApp: false,
      desktopApp: false,
      bridge: {
        wocExchangeSupported: async () => {
          probes++;
          return false;
        },
      },
    };
    await expect(wocMarketAttachAllowed(WEB)).resolves.toBe(true);
    await expect(wocMarketAttachAllowed(shell)).resolves.toBe(true);
    expect(probes).toBe(0);
  });

  it('offers the browser hand-off on the wrapped DESKTOP shell only, never native', () => {
    // Capacitor native (even alongside a desktop flag) gets neither the real
    // Exchange nor the hand-off launcher: steering a mobile-app-store build
    // to an external real-money marketplace is the anti-steering shape those
    // stores restrict (docs/prd/woc/marketplace.md "Platforms, realms,
    // configuration"), and that has not had its own counsel review.
    expect(wocMarketBrowserHandoffAllowed(WEB)).toBe(false);
    expect(
      wocMarketBrowserHandoffAllowed({ nativeApp: true, desktopApp: false, bridge: null }),
    ).toBe(false);
    expect(
      wocMarketBrowserHandoffAllowed({ nativeApp: false, desktopApp: true, bridge: null }),
    ).toBe(true);
    expect(
      wocMarketBrowserHandoffAllowed({ nativeApp: true, desktopApp: true, bridge: null }),
    ).toBe(false);
  });

  it('allows only a Seeker running the Solana dApp Store Android build', async () => {
    await expect(
      wocMarketAttachAllowed(nativeShell('solana-dapp-store', 'seeker', true)),
    ).resolves.toBe(true);
    for (const shell of [
      nativeShell('google-play', 'seeker', true),
      nativeShell('solana-dapp-store', 'other', true),
      nativeShell('solana-dapp-store', 'seeker', false),
      nativeShell('unknown', 'unknown', false),
    ]) {
      await expect(wocMarketAttachAllowed(shell)).resolves.toBe(false);
    }
  });

  it('ignores the desktop bridge on Capacitor native builds', async () => {
    const shell: WocMarketShell = {
      nativeApp: true,
      desktopApp: false,
      bridge: { wocExchangeSupported: async () => true },
    };
    await expect(wocMarketAttachAllowed(shell)).resolves.toBe(false);
  });

  it('fails closed for iOS or a native capability probe failure', async () => {
    await expect(
      wocMarketAttachAllowed({ nativeApp: true, desktopApp: false, bridge: null }),
    ).resolves.toBe(false);
    await expect(
      wocMarketAttachAllowed({
        nativeApp: true,
        desktopApp: false,
        bridge: null,
        mobileBridge: {
          solanaMobileCapabilities: async () => {
            throw new Error('native bridge unavailable');
          },
        },
      }),
    ).resolves.toBe(false);
  });

  it('allows the desktop shell only on a true bridge verdict', async () => {
    await expect(wocMarketAttachAllowed(desktopShell(true))).resolves.toBe(true);
    await expect(wocMarketAttachAllowed(desktopShell(false))).resolves.toBe(false);
  });

  it('fails closed on a desktop shell with no bridge, no probe method, or a failing probe', async () => {
    await expect(
      wocMarketAttachAllowed({ nativeApp: false, desktopApp: true, bridge: null }),
    ).resolves.toBe(false);
    // An older installed shell that predates the probe: method absent.
    await expect(
      wocMarketAttachAllowed({ nativeApp: false, desktopApp: true, bridge: {} }),
    ).resolves.toBe(false);
    await expect(
      wocMarketAttachAllowed({
        nativeApp: false,
        desktopApp: true,
        bridge: {
          wocExchangeSupported: async () => {
            throw new Error('ipc unavailable');
          },
        },
      }),
    ).resolves.toBe(false);
    // A tampered probe answering a non-boolean truthy value is not `true`.
    await expect(
      wocMarketAttachAllowed({
        nativeApp: false,
        desktopApp: true,
        bridge: {
          wocExchangeSupported: (async () => 'website') as unknown as () => Promise<boolean>,
        },
      }),
    ).resolves.toBe(false);
  });

  it('pins the four distribution outcomes through the real shell decision', async () => {
    // website desktop attaches; steam, epic, and an unknown stamp never do.
    const rigWebsite = makeDeps();
    await expect(
      attachWocMarketExchange(rigWebsite.deps, stampedDesktopShell('website')),
    ).resolves.toBe(true);
    expect(rigWebsite.attached.length).toBe(1);
    for (const distribution of ['steam', 'epic', 'not-a-channel']) {
      const rig = makeDeps();
      expect(await attachWocMarketExchange(rig.deps, stampedDesktopShell(distribution))).toBe(
        false,
      );
      expect(rig.attached).toEqual([]);
    }
    // An absent stamp on a packaged build is a store build too.
    const rigUnstamped = makeDeps();
    const unstamped: WocMarketShell = {
      nativeApp: false,
      desktopApp: true,
      bridge: {
        wocExchangeSupported: async () =>
          wocExchangeSupported({ packagedMetadata: null, isPackaged: true }),
      },
    };
    expect(await attachWocMarketExchange(rigUnstamped.deps, unstamped)).toBe(false);
    expect(rigUnstamped.attached).toEqual([]);
  });

  it('attaches nothing inside a refused shell (fail-closed, per dimension)', async () => {
    for (const shell of [
      { nativeApp: true, desktopApp: false, bridge: null },
      { nativeApp: false, desktopApp: true, bridge: null },
      { nativeApp: true, desktopApp: true, bridge: null },
      desktopShell(false),
    ]) {
      const rig = makeDeps();
      expect(await attachWocMarketExchange(rig.deps, shell)).toBe(false);
      expect(rig.attached).toEqual([]);
      // Fail-closed means no client is even built for a refused shell.
      expect(constructed).toEqual([]);
    }
  });

  it('reveals the browser hand-off launcher for a denied desktop shell only', async () => {
    const desktopOnly = makeDeps();
    await attachWocMarketExchange(desktopOnly.deps, {
      nativeApp: false,
      desktopApp: true,
      bridge: null,
    });
    // A wrapped-DESKTOP-shell player sees WHY the icon is there instead of it
    // simply being absent (src/ui/woc_market_link.ts).
    expect(desktopOnly.browserOnlyNotices()).toBe(1);

    for (const shell of [
      { nativeApp: true, desktopApp: false, bridge: null },
      { nativeApp: true, desktopApp: true, bridge: null },
    ]) {
      const nativeRig = makeDeps();
      await attachWocMarketExchange(nativeRig.deps, shell);
      // Capacitor native stays exactly as silent as before this fix: no
      // launcher, no explanation, no hand-off.
      expect(nativeRig.browserOnlyNotices()).toBe(0);
    }
  });

  it('reads the live shell constants when no shell is injected', async () => {
    // client_origin is mocked NATIVE_APP=true and the native bridge is a
    // verified Seeker above: the default arm must attach, proving production
    // wires both live inputs rather than only supporting injected test shells.
    const rig = makeDeps();
    await expect(attachWocMarketExchange(rig.deps)).resolves.toBe(true);
    expect(rig.attached.length).toBe(1);
    expect(constructed.length).toBe(1);
    expect(rig.browserOnlyNotices()).toBe(0);
  });
});

describe('woc_market_wiring: the hook composition on allowed shells', () => {
  beforeEach(() => {
    constructed.length = 0;
  });

  it('attaches exactly once and builds the client over the live token and the base', async () => {
    const rig = makeDeps();
    expect(await attachWocMarketExchange(rig.deps, WEB)).toBe(true);
    expect(rig.attached.length).toBe(1);
    expect(constructed.length).toBe(1);
    // The browser build gets the real Exchange, never the browser-hand-off notice.
    expect(rig.browserOnlyNotices()).toBe(0);
    expect(rig.attached[0].client).toBe(constructed[0]);
    // The token is a getter over the live session (a re-login swaps it), the
    // base is captured once, the same as the inline wiring it replaced.
    expect(constructed[0].cfg.token()).toBe('tok-1');
    rig.api.token = 'tok-2';
    expect(constructed[0].cfg.token()).toBe('tok-2');
    expect(constructed[0].cfg.base).toBe('https://api.example.test');
  });

  it('composes the same hooks on the website-distributed desktop shell', async () => {
    const rig = makeDeps();
    expect(await attachWocMarketExchange(rig.deps, stampedDesktopShell('website'))).toBe(true);
    expect(rig.attached.length).toBe(1);
    expect(constructed.length).toBe(1);
    expect(rig.attached[0].client).toBe(constructed[0]);
    expect(rig.attached[0].characterId()).toBe(41);
  });

  it('routes characterId and walletLinked live, and signs through the lazily loaded wallet', async () => {
    const rig = makeDeps();
    await attachWocMarketExchange(rig.deps, WEB);
    const hooks = rig.attached[0];
    expect(hooks.characterId()).toBe(41);
    rig.online.characterId = 42;
    expect(hooks.characterId()).toBe(42);
    expect(hooks.walletLinked()).toBe(false);
    rig.setLinked('WaLLet111111111111111111111111111111111111');
    expect(hooks.walletLinked()).toBe(true);
    // The wallet bridge loads on first sign, never at attach time (attach runs
    // on the boot path; the bridge is a lazy chunk).
    expect(rig.loads()).toBe(0);
    await expect(hooks.signAndSendTransactionBase64('AQID', 'WOC_ref_1')).resolves.toBe('sig:AQID');
    expect(rig.loads()).toBe(1);
    expect(rig.signCalls).toEqual(['AQID']);
  });

  it('signs step-up messages through the SAME lazy bridge, still zero loads at attach', async () => {
    const rig = makeDeps();
    await attachWocMarketExchange(rig.deps, WEB);
    const hooks = rig.attached[0];
    // The step-up signer must not eagerly load the bridge either.
    expect(rig.loads()).toBe(0);
    await expect(hooks.signMessageBase58('challenge text', 'ab'.repeat(16))).resolves.toBe(
      'msgsig:challenge text',
    );
    expect(rig.loads()).toBe(1);
    expect(rig.messageSignCalls).toEqual(['challenge text']);
    // Both signers delegate through the same wallet.load() seam (the real
    // loader memoizes the dynamic import; the rig counts delegations).
    await hooks.signAndSendTransactionBase64('AQID', 'WOC_ref_1');
    expect(rig.loads()).toBe(2);
  });
});

describe('woc_market_wiring: the desktop external-browser signer arm', () => {
  const NONCE = 'ab'.repeat(16);
  const LINKED = 'WaLLet111111111111111111111111111111111111';

  function desktopRig(results?: {
    transaction?: { kind: string; address: string; signature: string };
    stepup?: { kind: string; address: string; signature: string };
  }) {
    const rig = makeDeps();
    const actions: unknown[] = [];
    rig.setLinked(LINKED);
    rig.deps.wallet.desktopAuthorize = (async (action: { kind: string }) => {
      actions.push(action);
      if (action.kind === 'transaction') {
        return results?.transaction ?? { kind: 'transaction', address: LINKED, signature: 'txsig' };
      }
      return results?.stepup ?? { kind: 'stepup', address: LINKED, signature: 'msgsig' };
    }) as WocMarketWiringDeps['wallet']['desktopAuthorize'];
    return { ...rig, actions };
  }

  it('routes the payment signer through the handoff by quote reference, never the bytes', async () => {
    const rig = desktopRig();
    await attachWocMarketExchange(rig.deps, stampedDesktopShell('website'));
    const hooks = rig.attached[0];
    await expect(hooks.signAndSendTransactionBase64('AQID', 'WOC_ref_1')).resolves.toBe('txsig');
    expect(rig.actions).toEqual([
      { kind: 'transaction', reference: 'WOC_ref_1', expectedAddress: LINKED },
    ]);
    // The in-renderer wallet is never loaded on the desktop arm.
    expect(rig.loads()).toBe(0);
    expect(rig.signCalls).toEqual([]);
  });

  it('routes the step-up signer through the handoff by challenge nonce', async () => {
    const rig = desktopRig();
    await attachWocMarketExchange(rig.deps, stampedDesktopShell('website'));
    const hooks = rig.attached[0];
    await expect(hooks.signMessageBase58('challenge text', NONCE)).resolves.toBe('msgsig');
    expect(rig.actions).toEqual([{ kind: 'stepup', nonce: NONCE, expectedAddress: LINKED }]);
    expect(rig.loads()).toBe(0);
    expect(rig.messageSignCalls).toEqual([]);
  });

  it('refuses to sign without a linked wallet or a server reference/nonce', async () => {
    const rig = desktopRig();
    await attachWocMarketExchange(rig.deps, stampedDesktopShell('website'));
    const hooks = rig.attached[0];
    rig.setLinked(null);
    await expect(hooks.signAndSendTransactionBase64('AQID', 'WOC_ref_1')).rejects.toThrow(
      'connect a wallet first',
    );
    await expect(hooks.signMessageBase58('challenge', NONCE)).rejects.toThrow(
      'connect a wallet first',
    );
    rig.setLinked(LINKED);
    await expect(hooks.signAndSendTransactionBase64('AQID', null)).rejects.toThrow(
      'server returned an invalid wallet authorization',
    );
    await expect(hooks.signMessageBase58('challenge', '')).rejects.toThrow(
      'server returned an invalid wallet authorization',
    );
    expect(rig.actions).toEqual([]);
  });

  it('refuses a handoff result of the wrong kind (classified, per signer)', async () => {
    const rig = desktopRig({
      transaction: { kind: 'link', address: LINKED, signature: 'x' },
      stepup: { kind: 'transaction', address: LINKED, signature: 'x' },
    });
    await attachWocMarketExchange(rig.deps, stampedDesktopShell('website'));
    const hooks = rig.attached[0];
    await expect(hooks.signAndSendTransactionBase64('AQID', 'WOC_ref_1')).rejects.toThrow(
      'wallet returned an invalid transaction authorization',
    );
    await expect(hooks.signMessageBase58('challenge', NONCE)).rejects.toThrow(
      'wallet returned an invalid step-up authorization',
    );
  });

  it('falls back to the in-renderer wallet when no desktop signer is wired', async () => {
    const rig = makeDeps();
    rig.setLinked(LINKED);
    await attachWocMarketExchange(rig.deps, WEB);
    const hooks = rig.attached[0];
    await expect(hooks.signAndSendTransactionBase64('AQID', 'WOC_ref_1')).resolves.toBe('sig:AQID');
    await expect(hooks.signMessageBase58('challenge', NONCE)).resolves.toBe('msgsig:challenge');
    expect(rig.loads()).toBe(2);
  });
});

describe('woc_market_wiring: main.ts stays a firewall', () => {
  it('main.ts carries one attachWocMarketExchange call and no inline exchange wiring', () => {
    const main = stripComments(readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'));
    expect(main.match(/attachWocMarketExchange\(/g)?.length).toBe(1);
    expect(main).toContain("from './game/woc_market_wiring'");
    // The attach is a promise now: the call must keep its catch so a wiring
    // failure logs instead of dying as a silent unhandled rejection. The span
    // is bounded to the statement ([^;] cannot cross the call's semicolon), so
    // an unrelated `}).catch(` added later in main.ts cannot satisfy the pin
    // with the attach's own catch removed; and the handler must LOG, not
    // swallow, so the warn line is pinned too.
    expect(main).toMatch(/attachWocMarketExchange\(\{[^;]*?\}\)\.catch\(/);
    expect(main).toContain("console.warn('[woc] exchange attach failed'");
    // The desktop signer arm is wired from the live handoff availability
    // probe at the attach site; a dropped wire would strand website desktop
    // on the in-renderer wallet, which throws at first sign there.
    expect(main).toMatch(
      /desktopAuthorize: desktopWalletBrowserHandoffAvailable\(\)\s*\?\s*wocDesktopAuthorize\s*:\s*null/,
    );
    // The pieces the module now owns must not creep back into the coordinator:
    // the client construction, the direct hook attach, and the shell gate.
    expect(main).not.toContain('WocMarketClient');
    expect(main).not.toContain('hud.attachWocMarket(');
    expect(main).not.toContain('woc_market_sdk');
  });

  it('lets confirmed payments bypass the ordinary on-demand balance throttle', () => {
    const main = stripComments(readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'));
    expect(main).toContain('refreshWocBalance: (force) => refreshWocBalanceOnDemand(force)');
    expect(main).toContain('function refreshWocBalanceOnDemand(force = false)');
    expect(main).toContain('const request = wocBalanceRefreshOrder.start()');
    expect(main).toContain('!wocBalanceRefreshOrder.claim(request)');
    expect(main).toMatch(
      /if \(\s*!force &&\s*address === lastOnDemandRefreshAddress &&\s*now - lastOnDemandRefreshAt < ON_DEMAND_REFRESH_THROTTLE_MS\s*\)/,
    );
  });
});
