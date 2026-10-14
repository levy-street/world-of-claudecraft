// Node 22+ ships an experimental `localStorage` global gated behind
// `--localstorage-file`; without that flag the global still exists (as a
// getter that resolves to `undefined`) instead of being absent. Vitest's
// jsdom and happy-dom environments only install their own working Storage
// implementation for globals that are NOT already present on globalThis, so
// on a plain `node`/`vitest` invocation Node's broken global wins and both
// `window.localStorage` and `globalThis.localStorage` resolve to `undefined`
// in every DOM-environment test. Replace them with a small in-memory
// Storage-compatible polyfill whenever that happens, so tests get a real
// localStorage/sessionStorage regardless of the Node version running them.
// Storage setup is a no-op on pure Node environment files (no `window`). The
// ProgressEvent shim is global because Three's FileLoader may instantiate it
// from a Node-environment test before jsdom exists.

function isUsableStorage(storage: unknown): storage is Storage {
  return (
    typeof storage === 'object' &&
    storage !== null &&
    typeof (storage as Storage).clear === 'function'
  );
}

function makeMemoryStorage(): Storage {
  const data = new Map<string, string>();
  const storage: Storage = {
    getItem: (key: string) => (data.has(key) ? (data.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  };
  return storage;
}

function ensureUsable(key: 'localStorage' | 'sessionStorage'): void {
  const win = window as unknown as Record<string, unknown>;
  const glob = globalThis as unknown as Record<string, unknown>;
  // window and globalThis must share ONE Storage instance: code may read via
  // either spelling, and a per-target polyfill would silently desync them.
  const shared = isUsableStorage(win[key]) ? (win[key] as Storage) : makeMemoryStorage();
  for (const target of [window, globalThis] as const) {
    Object.defineProperty(target, key, { value: shared, configurable: true, enumerable: true });
  }
}

class FallbackProgressEvent extends Event implements ProgressEvent {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;

  constructor(type: string, init: ProgressEventInit = {}) {
    super(type, init);
    this.lengthComputable = init.lengthComputable ?? false;
    this.loaded = init.loaded ?? 0;
    this.total = init.total ?? 0;
  }
}

const MemoryProgressEvent = globalThis.ProgressEvent ?? FallbackProgressEvent;

if (typeof globalThis.ProgressEvent === 'undefined') {
  Object.defineProperty(globalThis, 'ProgressEvent', {
    value: MemoryProgressEvent,
    configurable: true,
    enumerable: true,
  });
}

// A happy-dom file gets ProgressEvent from happy-dom itself, so the shim above
// is skipped, and the environment's teardown then DELETES that global. A model
// preload still streaming at that point (Three's FileLoader reads a GLB the
// virtual server in vite.config.ts serves from public/ and builds a
// ProgressEvent per chunk) threw `ProgressEvent is not defined` as an unhandled
// rejection after the file's tests had all passed, failing the CI shard at
// random. A fallback on the global object's PROTOTYPE survives that delete
// (an unqualified name resolves through the global's prototype chain) without
// shadowing the environment's own class while a test runs.
const globalProto = Object.getPrototypeOf(globalThis) as object | null;
if (globalProto && !Object.hasOwn(globalProto, 'ProgressEvent')) {
  Object.defineProperty(globalProto, 'ProgressEvent', {
    value: FallbackProgressEvent,
    configurable: true,
    writable: true,
  });
}

if (typeof window !== 'undefined') {
  ensureUsable('localStorage');
  ensureUsable('sessionStorage');

  if (typeof window.ProgressEvent === 'undefined') {
    Object.defineProperty(window, 'ProgressEvent', {
      value: MemoryProgressEvent,
      configurable: true,
      enumerable: true,
    });
  }
}
