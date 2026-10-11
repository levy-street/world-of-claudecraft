// The character-select read-only $WOC Exchange attach composition
// (src/game/charselect_woc_market_wiring.ts): the SAME platform gate the
// real Exchange uses (wocMarketAttachAllowed), a plain WocMarketClient built
// off the account's REST session (no wallet signer, no characterId), and the
// attach callback fired exactly once on success, never on a denied shell.

import { beforeEach, describe, expect, it, vi } from 'vitest';

type ClientCfg = { token(): string | null; base?: string };
const constructed: { cfg: ClientCfg }[] = [];
vi.mock('../src/net/woc_market_sdk', () => ({
  WocMarketClient: class {
    constructor(readonly cfg: ClientCfg) {
      constructed.push(this);
    }
  },
}));

import { attachCharselectWocMarket } from '../src/game/charselect_woc_market_wiring';
import type { WocMarketShell } from '../src/game/woc_market_wiring';

const WEB: WocMarketShell = { nativeApp: false, desktopApp: false, bridge: null };
const NATIVE_DENIED: WocMarketShell = { nativeApp: true, desktopApp: false, bridge: null };
function desktopShell(supported: boolean): WocMarketShell {
  return {
    nativeApp: false,
    desktopApp: true,
    bridge: { wocExchangeSupported: async () => supported },
  };
}

beforeEach(() => {
  constructed.length = 0;
});

describe('attachCharselectWocMarket', () => {
  it('attaches a read-only client on browser web, off the account token', async () => {
    const attach = vi.fn();
    const ok = await attachCharselectWocMarket(
      { api: { token: 'tok', base: 'https://x.example' }, attach },
      WEB,
    );
    expect(ok).toBe(true);
    expect(attach).toHaveBeenCalledTimes(1);
    expect(constructed).toHaveLength(1);
    const [built] = constructed as [{ cfg: ClientCfg }];
    expect(built.cfg.token()).toBe('tok');
    expect(built.cfg.base).toBe('https://x.example');
  });

  it('attaches on a website-distributed desktop shell', async () => {
    const attach = vi.fn();
    const ok = await attachCharselectWocMarket(
      { api: { token: null, base: '' }, attach },
      desktopShell(true),
    );
    expect(ok).toBe(true);
    expect(attach).toHaveBeenCalledTimes(1);
  });

  it('never attaches, and never constructs a client, on a denied shell', async () => {
    const attach = vi.fn();
    for (const shell of [NATIVE_DENIED, desktopShell(false)]) {
      const ok = await attachCharselectWocMarket({ api: { token: null, base: '' }, attach }, shell);
      expect(ok).toBe(false);
    }
    expect(attach).not.toHaveBeenCalled();
    expect(constructed).toHaveLength(0);
  });

  it('`token` reads the LIVE value at request time, not a snapshot taken at attach', async () => {
    const attach = vi.fn();
    let live: string | null = 'first';
    await attachCharselectWocMarket(
      {
        api: {
          get token() {
            return live;
          },
          base: '',
        },
        attach,
      },
      WEB,
    );
    const [built] = constructed as [{ cfg: ClientCfg }];
    expect(built.cfg.token()).toBe('first');
    live = 'second';
    expect(built.cfg.token()).toBe('second');
  });
});
