import { afterEach, describe, expect, it, vi } from 'vitest';
import { customMapToWorldContent, newCustomMap } from '../src/editor/custom_map';
import { launchPlaytest } from '../src/editor/playtest';
import { takeEditorPlaytestRequest } from '../src/game/editor_playtest';

// Editor -> game playtest handoff. A map whose payload passes the Web Storage
// quota (Chrome: ~5.2M characters per origin; one big cave carve reaches it)
// used to fail with "storage blocked". IndexedDB carries it now; the Web
// Storage couriers stay as fallbacks.

// Web Storage with Chrome's failure mode: QuotaExceededError once the stored
// characters would pass `maxChars`.
function memStorage(maxChars = Number.POSITIVE_INFINITY) {
  const data = new Map<string, string>();
  const used = () => [...data].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (used() - (data.get(k)?.length ?? 0) + k.length + v.length > maxChars) {
        throw new DOMException('exceeded the quota', 'QuotaExceededError');
      }
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}

// The slice of IndexedDB the courier uses: open (+ upgrade), one readwrite
// transaction with clear/put/get/delete, completion after its requests.
function fakeIndexedDB() {
  const stores = new Map<string, Map<IDBValidKey, unknown>>();
  return {
    stores,
    open: () => {
      const req: Record<string, unknown> & { result?: unknown } = {};
      queueMicrotask(() => {
        const fresh = stores.size === 0;
        req.result = {
          objectStoreNames: { contains: (s: string) => stores.has(s) },
          createObjectStore: (s: string) => stores.set(s, new Map()),
          close: () => {},
          transaction: (s: string) => {
            const data = stores.get(s);
            if (!data) throw new DOMException('no store', 'NotFoundError');
            const tx: Record<string, unknown> = {};
            tx.objectStore = () => ({
              clear: () => data.clear(),
              put: (v: unknown, k: IDBValidKey) => data.set(k, v),
              delete: (k: IDBValidKey) => data.delete(k),
              get: (k: IDBValidKey) => {
                const get: Record<string, unknown> = {};
                queueMicrotask(() => {
                  get.result = data.get(k);
                  (get.onsuccess as (() => void) | undefined)?.();
                });
                return get;
              },
            });
            setTimeout(() => (tx.oncomplete as (() => void) | undefined)?.(), 0);
            return tx;
          },
        };
        if (fresh) (req.onupgradeneeded as (() => void) | undefined)?.();
        (req.onsuccess as (() => void) | undefined)?.();
      });
      return req;
    },
  };
}

const blockedIndexedDB = {
  open: () => {
    throw new DOMException('blocked', 'SecurityError');
  },
};

const OPTS = { seed: 7, playerClass: 'warrior', playerName: 'Tester' };

function stubBrowser(opts: { idb: unknown; localMax?: number; sessionMax?: number }) {
  const local = memStorage(opts.localMax);
  const session = memStorage(opts.sessionMax);
  const win = { open: vi.fn(), location: { replace: vi.fn() } };
  vi.stubGlobal('indexedDB', opts.idb);
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', session);
  vi.stubGlobal('window', win);
  vi.stubGlobal('location', { search: '' });
  return { local, session, win };
}

// What the game tab sees: the token from the URL the editor opened.
function openedToken(win: { open: ReturnType<typeof vi.fn> }): string {
  const url = String(win.open.mock.calls[0]?.[0]);
  const token = new URLSearchParams(url.split('?')[1]).get('editorPlaytest');
  if (!token) throw new Error(`no token in ${url}`);
  vi.stubGlobal('location', { search: `?editorPlaytest=${token}` });
  return token;
}

const world = () => customMapToWorldContent(newCustomMap('Big', 'big-map', 100));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('editor playtest handoff', () => {
  it('carries a payload past the Web Storage quota through IndexedDB, once', async () => {
    // Quotas far below this payload: the old courier threw QuotaExceededError.
    const { local, win } = stubBrowser({ idb: fakeIndexedDB(), localMax: 500, sessionMax: 500 });
    expect(await launchPlaytest(world(), OPTS)).toBe(true);
    expect(win.open).toHaveBeenCalledOnce();
    expect(local.data.size).toBe(0);

    openedToken(win);
    const req = await takeEditorPlaytestRequest();
    expect(req?.playerName).toBe('Tester');
    expect(req?.seed).toBe(7);
    expect(req?.content.zones.length).toBeGreaterThan(0);
    // One-shot: a refreshed playtest tab finds the transfer consumed.
    expect(await takeEditorPlaytestRequest()).toBeNull();
  });

  it('replaces an orphan left by a launch whose tab never opened', async () => {
    const idb = fakeIndexedDB();
    const { win } = stubBrowser({ idb });
    await launchPlaytest(world(), OPTS);
    await launchPlaytest(world(), OPTS);
    const second = String(win.open.mock.calls[1]?.[0]).split('editorPlaytest=')[1];
    expect([...(idb.stores.get('transfers')?.keys() ?? [])]).toEqual([second]);
  });

  it('falls back to the localStorage courier when IndexedDB is blocked', async () => {
    const { local, win } = stubBrowser({ idb: blockedIndexedDB });
    expect(await launchPlaytest(world(), OPTS)).toBe(true);
    const token = openedToken(win);
    expect(local.data.has(`woc_editor_playtest_transfer:${token}`)).toBe(true);
    expect((await takeEditorPlaytestRequest())?.playerName).toBe('Tester');
    expect(local.data.size).toBe(0);
  });

  it('reports failure when every store refuses the payload', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { win } = stubBrowser({ idb: blockedIndexedDB, localMax: 500, sessionMax: 500 });
    expect(await launchPlaytest(world(), OPTS)).toBe(false);
    expect(win.open).not.toHaveBeenCalled();
    expect(win.location.replace).not.toHaveBeenCalled();
  });

  it('keeps the ordinary boot synchronous when nothing is pending', () => {
    stubBrowser({ idb: fakeIndexedDB() });
    expect(takeEditorPlaytestRequest()).toBeNull();
  });
});
