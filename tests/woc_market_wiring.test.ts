// The $WOC Exchange attach composition (src/game/woc_market_wiring.ts): the
// browser-web-only gate, the live wiring of every hook, and the main.ts
// firewall (main.ts carries one call, never the client construction or the
// hook object). A gate that quietly attached inside a wrapped shell would ship
// the exchange to the platforms the PRD keeps fail-closed.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stripComments } from './helpers/strip_comments';

// The default shell flags are the live constants; mock them TRUE so the
// default-argument arm proves it reads them (a hardcoded { false, false }
// default would attach here and fail the pin below).
vi.mock('../src/client_origin', () => ({ NATIVE_APP: true, DESKTOP_APP: false }));

type ClientCfg = { token(): string | null; base?: string };
const constructed: { cfg: ClientCfg }[] = [];
vi.mock('../src/net/woc_market_sdk', () => ({
  WocMarketClient: class {
    constructor(readonly cfg: ClientCfg) {
      constructed.push(this);
    }
  },
}));

import { attachWocMarketExchange, wocMarketAttachAllowed } from '../src/game/woc_market_wiring';
import type { WocMarketHooks } from '../src/ui/woc_market_window';

const WEB = { nativeApp: false, desktopApp: false };

function makeDeps() {
  const attached: WocMarketHooks[] = [];
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
    },
    api,
    online,
    wallet: {
      linkedPubkey: () => linked,
      load: async () => {
        loads++;
        return walletModule;
      },
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
  };
}

describe('woc_market_wiring: the browser-web-only gate', () => {
  beforeEach(() => {
    constructed.length = 0;
  });

  it('allows only the plain browser web shell', () => {
    expect(wocMarketAttachAllowed(WEB)).toBe(true);
    expect(wocMarketAttachAllowed({ nativeApp: true, desktopApp: false })).toBe(false);
    expect(wocMarketAttachAllowed({ nativeApp: false, desktopApp: true })).toBe(false);
    expect(wocMarketAttachAllowed({ nativeApp: true, desktopApp: true })).toBe(false);
  });

  it('attaches nothing inside a native or desktop shell (fail-closed, per dimension)', () => {
    for (const shell of [
      { nativeApp: true, desktopApp: false },
      { nativeApp: false, desktopApp: true },
      { nativeApp: true, desktopApp: true },
    ]) {
      const rig = makeDeps();
      expect(attachWocMarketExchange(rig.deps, shell)).toBe(false);
      expect(rig.attached).toEqual([]);
      // Fail-closed means no client is even built for a wrapped shell.
      expect(constructed).toEqual([]);
    }
  });

  it('reads the live shell constants when no shell is injected', () => {
    // client_origin is mocked NATIVE_APP=true above: the default arm must
    // refuse, proving the default is wired to the constants.
    const rig = makeDeps();
    expect(attachWocMarketExchange(rig.deps)).toBe(false);
    expect(rig.attached).toEqual([]);
  });
});

describe('woc_market_wiring: the hook composition on browser web', () => {
  beforeEach(() => {
    constructed.length = 0;
  });

  it('attaches exactly once and builds the client over the live token and the base', () => {
    const rig = makeDeps();
    expect(attachWocMarketExchange(rig.deps, WEB)).toBe(true);
    expect(rig.attached.length).toBe(1);
    expect(constructed.length).toBe(1);
    expect(rig.attached[0].client).toBe(constructed[0]);
    // The token is a getter over the live session (a re-login swaps it), the
    // base is captured once, the same as the inline wiring it replaced.
    expect(constructed[0].cfg.token()).toBe('tok-1');
    rig.api.token = 'tok-2';
    expect(constructed[0].cfg.token()).toBe('tok-2');
    expect(constructed[0].cfg.base).toBe('https://api.example.test');
  });

  it('routes characterId and walletLinked live, and signs through the lazily loaded wallet', async () => {
    const rig = makeDeps();
    attachWocMarketExchange(rig.deps, WEB);
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
    await expect(hooks.signAndSendTransactionBase64('AQID')).resolves.toBe('sig:AQID');
    expect(rig.loads()).toBe(1);
    expect(rig.signCalls).toEqual(['AQID']);
  });

  it('signs step-up messages through the SAME lazy bridge, still zero loads at attach', async () => {
    const rig = makeDeps();
    attachWocMarketExchange(rig.deps, WEB);
    const hooks = rig.attached[0];
    // The step-up signer must not eagerly load the bridge either.
    expect(rig.loads()).toBe(0);
    await expect(hooks.signMessageBase58('challenge text')).resolves.toBe('msgsig:challenge text');
    expect(rig.loads()).toBe(1);
    expect(rig.messageSignCalls).toEqual(['challenge text']);
    // Both signers delegate through the same wallet.load() seam (the real
    // loader memoizes the dynamic import; the rig counts delegations).
    await hooks.signAndSendTransactionBase64('AQID');
    expect(rig.loads()).toBe(2);
  });
});

describe('woc_market_wiring: main.ts stays a firewall', () => {
  it('main.ts carries one attachWocMarketExchange call and no inline exchange wiring', () => {
    const main = stripComments(readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'));
    expect(main.match(/attachWocMarketExchange\(/g)?.length).toBe(1);
    expect(main).toContain("from './game/woc_market_wiring'");
    // The pieces the module now owns must not creep back into the coordinator:
    // the client construction, the direct hook attach, and the shell gate.
    expect(main).not.toContain('WocMarketClient');
    expect(main).not.toContain('hud.attachWocMarket(');
    expect(main).not.toContain('woc_market_sdk');
  });
});
