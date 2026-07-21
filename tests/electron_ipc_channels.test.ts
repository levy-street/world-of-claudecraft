import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Pin the preload <-> main IPC channel-name contract by scanning the sources:
// electron/*.cjs live outside tsc, so a rename on one side would otherwise
// only surface as a silent no-op (or a rejected invoke) at runtime.
const repoRoot = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');

const preload = read('electron/preload.cjs');
const mainSide = read('electron/main.cjs') + read('electron/updater.cjs');

const matches = (source: string, re: RegExp): Set<string> => {
  const found = new Set<string>();
  for (const m of source.matchAll(re)) found.add(m[1]);
  return found;
};

describe('electron IPC channel contract (preload <-> main)', () => {
  it('every preload invoke has a main-side ipcMain.handle', () => {
    const invoked = matches(preload, /ipcRenderer\.invoke\('([^']+)'/g);
    const handled = matches(mainSide, /ipcMain\.handle\('([^']+)'/g);
    expect([...invoked].sort()).toEqual(
      expect.arrayContaining([
        'desktop-login-open-browser',
        'desktop-login-take-code',
        'desktop-set-strings',
        'desktop-steam-capability',
        'desktop-steam-link-settled',
        'desktop-steam-link-ticket',
        'desktop-update-install',
        'desktop-wallet-capability',
        'desktop-wallet-open-browser',
        'desktop-wallet-take-code',
      ]),
    );
    for (const channel of invoked) {
      expect(handled, `no ipcMain.handle for invoked channel ${channel}`).toContain(channel);
    }
  });

  it('every preload send has a main-side ipcMain.on', () => {
    const sent = matches(preload, /ipcRenderer\.send\('([^']+)'/g);
    const listened = matches(mainSide, /ipcMain\.on\('([^']+)'/g);
    expect([...sent]).toContain('desktop-renderer-error');
    for (const channel of sent) {
      expect(listened, `no ipcMain.on for sent channel ${channel}`).toContain(channel);
    }
  });

  it('every preload subscription has a main-side webContents.send', () => {
    const subscribed = matches(preload, /ipcRenderer\.on\('([^']+)'/g);
    const pushed = matches(mainSide, /webContents\.send\('([^']+)'/g);
    expect([...subscribed].sort()).toEqual([
      'desktop-login-code',
      'desktop-update-event',
      'desktop-wallet-handoff-code',
    ]);
    for (const channel of subscribed) {
      expect(pushed, `nothing pushes subscribed channel ${channel}`).toContain(channel);
    }
  });

  it('every ipcMain.handle body checks the trusted-sender gate FIRST', () => {
    // A handler without the sender gate would answer IPC from any frame that
    // somehow runs in the window (the deny-by-default posture's last line).
    // Scan both registration sites: main.cjs handlers call trustedSender(...),
    // the updater's injected gate is named isTrusted(...). The check must
    // appear within the first statement's reach of the callback body.
    const registrations = mainSide.split(/ipcMain\.handle\(/).slice(1);
    expect(registrations.length).toBeGreaterThanOrEqual(5);
    for (const body of registrations) {
      const head = body.slice(0, 200);
      expect(
        /trustedSender\(|isTrusted\(/.test(head),
        `an ipcMain.handle body does not gate on the trusted sender: ${head.split('\n')[0]}`,
      ).toBe(true);
    }
  });

  it('the steam-link-settled handler body cancels the live auth ticket', () => {
    // The channel existing is not enough: the settle signal exists ONLY so the
    // shell CancelAuthTickets the live handle promptly (Valve's contract), so
    // the handler body must actually reach steamShell.cancelLinkTicket.
    const main = read('electron/main.cjs');
    const start = main.indexOf("ipcMain.handle('desktop-steam-link-settled'");
    expect(start).toBeGreaterThan(-1);
    const body = main.slice(start, main.indexOf('});', start));
    expect(body).toContain('steamShell.cancelLinkTicket()');
  });

  it('reports whether the external wallet authorization page actually opened', () => {
    const main = read('electron/main.cjs');
    const start = main.indexOf("ipcMain.handle('desktop-wallet-open-browser'");
    expect(start).toBeGreaterThan(-1);
    const body = main.slice(start, main.indexOf('});', start));
    expect(body).toContain('await openDesktopWalletHandoff(code)');
  });

  it('activates the macOS app when the browser returns a wallet handoff', () => {
    const main = read('electron/main.cjs');
    const start = main.indexOf('function deliverWalletHandoffCode');
    expect(start).toBeGreaterThan(-1);
    const body = main.slice(start, main.indexOf('\n}', start));
    expect(body).toContain('app.focus({ steal: true })');
  });

  it('the bridge methods the client feature-checks exist in the preload', () => {
    for (const method of [
      'openBrowserLogin',
      'takeLoginCode',
      'onLoginCode',
      'setShellStrings',
      'reportRendererError',
      'onUpdateEvent',
      'installUpdate',
      'steamLinkTicket',
      'steamLinkSupported',
      'steamLinkSettled',
      'walletConnectionSupported',
      'openWalletBrowser',
      'takeWalletHandoffCode',
      'onWalletHandoffCode',
    ]) {
      expect(preload, `preload is missing bridge method ${method}`).toContain(`${method}:`);
    }
  });
});
