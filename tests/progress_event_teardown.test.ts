// @vitest-environment happy-dom
// tests/jsdom_local_storage_setup.ts keeps a ProgressEvent reachable after a
// DOM environment's teardown deletes its globals. Three's FileLoader builds one
// per streamed chunk of a model preload, and a stream still reading when a
// happy-dom file ended threw `ProgressEvent is not defined` as an unhandled
// rejection that failed the CI shard after every test had passed (the
// char_window suites, at random). This simulates that teardown.
import { describe, expect, it } from 'vitest';

describe('ProgressEvent after a DOM environment tears down', () => {
  it('still resolves by bare name once the environment global is deleted', () => {
    const glob = globalThis as unknown as Record<string, unknown>;
    const own = Object.getOwnPropertyDescriptor(globalThis, 'ProgressEvent');
    // While the test runs the environment's own class is the one in use.
    expect(own).toBeDefined();
    try {
      delete glob.ProgressEvent;
      expect(Object.hasOwn(globalThis, 'ProgressEvent')).toBe(false);
      // The bare identifier, exactly as three.core.js spells it.
      const event = new ProgressEvent('progress', {
        lengthComputable: true,
        loaded: 3,
        total: 9,
      });
      expect(event.type).toBe('progress');
      expect([event.lengthComputable, event.loaded, event.total]).toEqual([true, 3, 9]);
    } finally {
      if (own) Object.defineProperty(globalThis, 'ProgressEvent', own);
    }
  });
});
