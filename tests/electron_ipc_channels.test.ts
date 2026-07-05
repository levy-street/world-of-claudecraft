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
        'desktop-update-install',
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
    expect([...subscribed].sort()).toEqual(['desktop-login-code', 'desktop-update-event']);
    for (const channel of subscribed) {
      expect(pushed, `nothing pushes subscribed channel ${channel}`).toContain(channel);
    }
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
    ]) {
      expect(preload, `preload is missing bridge method ${method}`).toContain(`${method}:`);
    }
  });
});
