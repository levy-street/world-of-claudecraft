// The $WOC Exchange's wrapped-DESKTOP-shell browser hand-off
// (src/ui/woc_market_link.ts): the URL resolution, the confirm-first
// contract (mirroring tests/wiki_link.test.ts), and the pure toggle-button
// decision Hud.toggleWocMarket() switches on. The confirm dialog itself is
// Hud.confirmDialog (injected), so what the confirm-first suite pins is that
// nothing opens before OK, that a dismissal opens nothing, and that the
// resolved URL is what gets opened.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CANONICAL_WOC_MARKET_URL,
  promptWocMarketBrowserVisit,
  resolveWocMarketUrl,
  wocMarketToggleAction,
} from '../src/ui/woc_market_link';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveWocMarketUrl', () => {
  it('stays same-origin (the playable client, not the marketing root) on any http(s) deploy', () => {
    expect(resolveWocMarketUrl({ origin: 'https://dev.worldofclaudecraft.com' })).toBe(
      'https://dev.worldofclaudecraft.com/play',
    );
    expect(resolveWocMarketUrl({ origin: 'https://worldofclaudecraft.com' })).toBe(
      'https://worldofclaudecraft.com/play',
    );
    expect(resolveWocMarketUrl({ origin: 'http://localhost:5173' })).toBe(
      'http://localhost:5173/play',
    );
  });

  it('falls back to the canonical URL when there is no site origin to serve /play', () => {
    // The packaged Electron shell loads app://worldofclaudecraft, not the
    // live site: not an http(s) origin.
    expect(resolveWocMarketUrl({ origin: 'app://worldofclaudecraft' })).toBe(
      CANONICAL_WOC_MARKET_URL,
    );
    expect(resolveWocMarketUrl({ origin: '' })).toBe(CANONICAL_WOC_MARKET_URL);
  });

  it('pins the canonical URL to its literal (the playable client, not the marketing root)', () => {
    expect(CANONICAL_WOC_MARKET_URL).toBe('https://worldofclaudecraft.com/play');
  });
});

describe('wocMarketToggleAction', () => {
  it('takes the browser hand-off whenever browserOnly is set, even alongside hooks', () => {
    expect(wocMarketToggleAction({ browserOnly: true, hasHooks: false })).toBe('handoff');
    // Fail toward NOT silently stranding the money surface open: a future
    // caller that somehow attached both must never let the real window win.
    expect(wocMarketToggleAction({ browserOnly: true, hasHooks: true })).toBe('handoff');
  });

  it('opens the real window only when hooks are attached and browserOnly is not set', () => {
    expect(wocMarketToggleAction({ browserOnly: false, hasHooks: true })).toBe('toggle');
  });

  it('does nothing before either attach path has run', () => {
    expect(wocMarketToggleAction({ browserOnly: false, hasHooks: false })).toBe('none');
  });
});

describe('promptWocMarketBrowserVisit', () => {
  it('asks with the Exchange hand-off copy and opens the resolved URL only on OK', () => {
    vi.stubGlobal('location', { origin: 'https://dev.worldofclaudecraft.com' });
    const openUrl = vi.fn();
    const confirm = vi.fn();
    promptWocMarketBrowserVisit({ confirm, openUrl });

    expect(confirm).toHaveBeenCalledTimes(1);
    const [title, body, okText, cancelText, onOk] = confirm.mock.calls[0];
    expect(title).toBe('Open the $WOC Exchange in your browser?');
    expect(body).toBe(
      'The $WOC Exchange runs on the browser version of World of ClaudeCraft only. This opens World of ClaudeCraft in your browser, where you can sign in and open the Exchange; the game keeps running here.',
    );
    expect(okText).toBe('Open in Browser');
    expect(cancelText).toBe('Cancel');

    // Nothing opens before the player chooses.
    expect(openUrl).not.toHaveBeenCalled();
    (onOk as () => void)();
    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith('https://dev.worldofclaudecraft.com/play');
  });

  it('a dismissed dialog (onOk never fired) opens nothing', () => {
    const openUrl = vi.fn();
    promptWocMarketBrowserVisit({ confirm: () => {}, openUrl });
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('uses the canonical URL when no browser origin exists (plain Node)', () => {
    const openUrl = vi.fn();
    const confirm = vi.fn();
    promptWocMarketBrowserVisit({ confirm, openUrl });
    (confirm.mock.calls[0][4] as () => void)();
    expect(openUrl).toHaveBeenCalledWith(CANONICAL_WOC_MARKET_URL);
  });
});

// The launcher's HUD wiring ($('#mm-wocmarket')?.addEventListener) is
// optional-chained, so a dropped id in either entry document would silently
// disarm the button with every suite green. Pin the ids in BOTH entries plus
// the desktop and mobile bindings so removal fails here instead of shipping a
// dead control.
describe('$WOC Exchange launcher wiring pins', () => {
  const entries = ['index.html', 'play.html'] as const;

  it('both entry documents carry the desktop micro button and the mobile More-tray twin', () => {
    for (const file of entries) {
      const html = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      expect(html, `${file} lost #mm-wocmarket`).toContain('id="mm-wocmarket"');
      expect(html, `${file} lost #mobile-wocmarket`).toContain('id="mobile-wocmarket"');
      expect(html, `${file} lost #mm-wocmarket's icon hook`).toMatch(
        /id="mm-wocmarket"[^>]*data-icon="market"/,
      );
      // The mobile twin degrades to its .mobile-label text, but pin the icon
      // hook too (the #mm-discord pin in client_shell.test.ts precedent).
      expect(html, `${file} lost #mobile-wocmarket's icon hook`).toMatch(
        /id="mobile-wocmarket"[^>]*data-icon="market"/,
      );
    }
  });

  it('Hud binds the desktop micro button to the shared toggle (real window or browser hand-off)', () => {
    const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    expect(hud).toContain(
      "$('#mm-wocmarket')?.addEventListener('click', () => this.toggleWocMarket());",
    );
  });

  it('the mobile More-tray twin routes to the same toggle via onWocMarket', () => {
    // This is the ONLY path Capacitor's mobile tray uses to reach
    // toggleWocMarket (src/main.ts wires onWocMarket to hud.toggleWocMarket).
    const mobileControls = readFileSync(
      new URL('../src/game/mobile_controls.ts', import.meta.url),
      'utf8',
    );
    expect(mobileControls).toContain(
      "this.bindButton('mobile-wocmarket', () => this.callbacks.onWocMarket());",
    );
  });
});

// The Hud-side reveal/hide flags are exercised end to end via
// wocMarketToggleAction above (the actual decision logic lives there now),
// but the two attach methods still assign the flags directly, so pin the two
// invariants a source scan can actually catch: a later real attach clears any
// earlier browser-only state (never stranding the real Exchange unopenable
// behind it), and the browser-only path never touches the real hooks field
// (the $WOC trade arm gates on it, src/ui/hud/woc_trade/woc_trade_controller.ts).
describe('$WOC Exchange Hud attach invariants', () => {
  it('attachWocMarket clears any earlier browser-only notice', () => {
    const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    const attachWocMarket = hud.slice(
      hud.indexOf('attachWocMarket(hooks: WocMarketHooks): void {'),
      hud.indexOf('attachWocMarketBrowserOnlyNotice(): void {'),
    );
    expect(attachWocMarket).toContain('this.wocMarketBrowserOnly = false;');
  });

  it('attachWocMarketBrowserOnlyNotice never assigns the real hooks field', () => {
    const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    const attachNotice = hud.slice(
      hud.indexOf('attachWocMarketBrowserOnlyNotice(): void {'),
      hud.indexOf('private revealWocMarketLauncher(): void {'),
    );
    expect(attachNotice).not.toContain('this.wocMarketHooks =');
  });
});
