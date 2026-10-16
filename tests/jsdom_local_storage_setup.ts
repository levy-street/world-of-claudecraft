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
//
// It must also still resolve AFTER a DOM environment is torn down. Vitest
// deletes the environment's globals when a test file ends, happy-dom's own
// ProgressEvent with them, and a model load the file started and never awaited
// (a portrait fetching its character's files through the virtual server in
// vite.config.ts) can deliver one more chunk after that: FileLoader's
// `new ProgressEvent(...)` then throws a ReferenceError inside a promise
// callback nobody catches, and the unhandled rejection fails the whole run
// although every test passed. A fallback one step up the global's prototype
// chain is what such a late read resolves; the environment's own class shadows
// it for as long as the environment exists.
// (tests/progress_event_after_teardown.test.ts)

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

const MemoryProgressEvent =
  globalThis.ProgressEvent ??
  class extends Event implements ProgressEvent {
    readonly lengthComputable: boolean;
    readonly loaded: number;
    readonly total: number;

    constructor(type: string, init: ProgressEventInit = {}) {
      super(type, init);
      this.lengthComputable = init.lengthComputable ?? false;
      this.loaded = init.loaded ?? 0;
      this.total = init.total ?? 0;
    }
  };

if (typeof globalThis.ProgressEvent === 'undefined') {
  Object.defineProperty(globalThis, 'ProgressEvent', {
    value: MemoryProgressEvent,
    configurable: true,
    enumerable: true,
  });
}

/** What a read still in flight constructs once its DOM environment is gone. It extends
 *  nothing: the DOM's Event class leaves with the environment too. */
class LateProgressEvent {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;

  constructor(
    readonly type: string,
    init: ProgressEventInit = {},
  ) {
    this.lengthComputable = init.lengthComputable ?? false;
    this.loaded = init.loaded ?? 0;
    this.total = init.total ?? 0;
  }
}

// Node's global object has a prototype of its own between itself and Object.prototype:
// a property there is seen as a global only where no own property shadows it. Never on
// Object.prototype itself, which every object would inherit it from.
const globalFallbacks: object | null = Object.getPrototypeOf(globalThis);
if (
  globalFallbacks &&
  globalFallbacks !== Object.prototype &&
  !Object.hasOwn(globalFallbacks, 'ProgressEvent')
) {
  Object.defineProperty(globalFallbacks, 'ProgressEvent', {
    value: LateProgressEvent,
    configurable: true,
    writable: true,
    enumerable: false,
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
