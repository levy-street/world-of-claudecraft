// Shared setup for admin Svelte component tests. Imported (not auto-loaded) at the top
// of each tests/admin/*.test.ts file, which also carries a
// `// @vitest-environment happy-dom` (default) or `// @vitest-environment jsdom`
// (exception list; see docs/local-gate-perf/experiment-log.md Phase 5) docblock.
// Scoping a DOM env + this setup per file keeps Node-environment sim/server tests
// on their fast default environment (no global setupFiles change beyond the shared
// localStorage polyfill in tests/jsdom_local_storage_setup.ts).
//
// Provides the jest-dom matchers (toBeInTheDocument, etc.) and unmounts every
// rendered component after each test so the DOM document stays clean between cases.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/svelte';
import { afterEach, beforeEach } from 'vitest';

const storage = globalThis.localStorage as Partial<Storage> | undefined;
if (
  !storage ||
  typeof storage.clear !== 'function' ||
  typeof storage.getItem !== 'function' ||
  typeof storage.setItem !== 'function'
) {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    } satisfies Storage,
  });
}

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());
