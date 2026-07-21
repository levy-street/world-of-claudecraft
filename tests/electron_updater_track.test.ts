import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initUpdater } from '../electron/updater.cjs';

// Behavioral pins for the updater's track wiring (issue 1537: a production
// install must never download an update baked for another API backend). Uses
// initUpdater's injected-autoUpdater test seam; everything else the module
// touches is a plain fake, so this runs in Node with no electron.

const PROD = 'https://worldofclaudecraft.com';
const DEV = 'https://dev.worldofclaudecraft.com';

type Handler = (info: unknown) => void;

function makeFakeAutoUpdater() {
  const handlers = new Map<string, Handler>();
  return {
    logger: null as unknown,
    autoDownload: true,
    autoInstallOnAppQuit: false,
    allowDowngrade: undefined as boolean | undefined,
    channelSets: [] as string[],
    _channel: undefined as string | undefined,
    // Mirror the real electron-updater trap: assigning channel silently
    // re-enables downgrades, which initUpdater must undo.
    set channel(value: string) {
      this._channel = value;
      this.channelSets.push(value);
      this.allowDowngrade = true;
    },
    get channel(): string | undefined {
      return this._channel;
    },
    on(event: string, handler: Handler) {
      handlers.set(event, handler);
      return this;
    },
    emit(event: string, info: unknown) {
      handlers.get(event)?.(info);
    },
    checkForUpdates: vi.fn(() => Promise.resolve(null)),
    downloadUpdate: vi.fn(() => Promise.resolve([])),
    quitAndInstall: vi.fn(),
  };
}

function makeDeps(autoUpdater: ReturnType<typeof makeFakeAutoUpdater>, apiOrigin: string) {
  const sent: unknown[] = [];
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const win = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (_channel: string, payload: unknown) => sent.push(payload),
    },
  };
  const deps = {
    ipcMain: { handle: vi.fn() },
    log,
    getWindow: () => win,
    isTrusted: () => true,
    isPackaged: true,
    apiOrigin,
    updateChannel: 'latest',
    autoUpdater,
  };
  return { deps, sent, log };
}

describe('initUpdater track wiring', () => {
  beforeEach(() => {
    // initUpdater arms process-lifetime check timers; keep them inert.
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads its own-origin channel and undoes the channel-setter downgrade flip', () => {
    const fake = makeFakeAutoUpdater();
    const { deps } = makeDeps(fake, PROD);
    expect(initUpdater(deps)).toBe(fake);
    expect(fake.channelSets).toEqual(['latest']);
    // The real setter flips allowDowngrade to true; initUpdater must reset it.
    expect(fake.allowDowngrade).toBe(false);
    // Downloads wait for the origin guard; installs still apply on quit.
    expect(fake.autoDownload).toBe(false);
    expect(fake.autoInstallOnAppQuit).toBe(true);
  });

  it('downloads and toasts a matching-origin update', () => {
    const fake = makeFakeAutoUpdater();
    const { deps, sent } = makeDeps(fake, PROD);
    initUpdater(deps);
    fake.emit('update-available', { version: '0.23.0', wocApiOrigin: PROD });
    expect(fake.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([{ type: 'available', version: '0.23.0' }]);
  });

  it('accepts a pre-split feed file with no origin stamp', () => {
    const fake = makeFakeAutoUpdater();
    const { deps, sent } = makeDeps(fake, PROD);
    initUpdater(deps);
    fake.emit('update-available', { version: '0.23.0' });
    expect(fake.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([{ type: 'available', version: '0.23.0' }]);
  });

  it('REFUSES a cross-origin update: no download, no toast, loud log', () => {
    const fake = makeFakeAutoUpdater();
    const { deps, sent, log } = makeDeps(fake, PROD);
    initUpdater(deps);
    fake.emit('update-available', { version: '0.23.1', wocApiOrigin: DEV });
    expect(fake.downloadUpdate).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
    expect(log.error).toHaveBeenCalledTimes(1);
    const [message, detail] = log.error.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toContain('REFUSED');
    expect(detail).toMatchObject({
      version: '0.23.1',
      offeredOrigin: DEV,
      expectedOrigin: PROD,
    });
  });

  it('leaves the channel untouched when none is resolved (legacy default feed)', () => {
    const fake = makeFakeAutoUpdater();
    const { deps } = makeDeps(fake, PROD);
    initUpdater({ ...deps, updateChannel: undefined });
    expect(fake.channelSets).toEqual([]);
  });

  it('logs and survives a failed download (no unhandled rejection)', async () => {
    const fake = makeFakeAutoUpdater();
    fake.downloadUpdate = vi.fn(() => Promise.reject(new Error('feed host down')));
    const { deps, log } = makeDeps(fake, PROD);
    initUpdater(deps);
    fake.emit('update-available', { version: '0.23.0', wocApiOrigin: PROD });
    // Let the rejected downloadUpdate() promise settle through its .catch.
    await Promise.resolve();
    await Promise.resolve();
    expect(log.warn).toHaveBeenCalledWith('[updater] download failed', 'feed host down');
  });
});

describe('main.cjs updater wiring pin', () => {
  it('passes apiOrigin and the resolved updateChannel into initUpdater', () => {
    // main.cjs is the electron entry and cannot run under vitest, so pin the
    // wiring textually: dropping either argument would silently break the
    // origin guard (undefined own origin refuses every stamped update). The
    // match runs to the call's own `});` closer (a nested `})` mid-args, e.g.
    // an arrow body, cannot end it), so growing the arg list stays matched.
    const source = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
    const call = source.match(/initUpdater\(\{[\s\S]*?\n\s*\}\);/)?.[0] ?? '';
    expect(call).toContain('apiOrigin');
    expect(call).toContain('updateChannel: desktopConfig.updateChannel');
  });
});
