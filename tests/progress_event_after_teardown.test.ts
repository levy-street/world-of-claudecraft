// @vitest-environment happy-dom

// A model load that outlives its DOM test file (tests/jsdom_local_storage_setup.ts): when a
// file ends, Vitest deletes the DOM environment's globals, ProgressEvent among them, while a
// body Three's FileLoader is still reading can deliver one more chunk. Its
// `new ProgressEvent('progress', ...)` then threw a ReferenceError inside a promise callback
// nobody catches, and the unhandled rejection failed a CI shard in which every test had
// passed. The per-file setup keeps a fallback one step up the global's prototype chain, so
// the name still resolves once the environment's own class is gone.

import { setTimeout as realTimeout } from 'node:timers';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Take the environment's own ProgressEvent away, as its teardown does, for one callback. */
function withoutTheEnvironmentsOwn<T>(run: () => T): T {
  const own = Object.getOwnPropertyDescriptor(globalThis, 'ProgressEvent');
  if (!own) throw new Error('the DOM environment defines no ProgressEvent of its own');
  delete (globalThis as { ProgressEvent?: unknown }).ProgressEvent;
  try {
    return run();
  } finally {
    Object.defineProperty(globalThis, 'ProgressEvent', own);
  }
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => realTimeout(resolve, ms));

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The same for a stretch of real time. */
async function withoutTheEnvironmentsOwnAsync(run: () => Promise<void>): Promise<void> {
  const own = Object.getOwnPropertyDescriptor(globalThis, 'ProgressEvent');
  if (!own) throw new Error('the DOM environment defines no ProgressEvent of its own');
  delete (globalThis as { ProgressEvent?: unknown }).ProgressEvent;
  try {
    await run();
  } finally {
    Object.defineProperty(globalThis, 'ProgressEvent', own);
  }
}

describe('ProgressEvent after a DOM environment is torn down', () => {
  it('is the environment own class while the environment exists', () => {
    expect(Object.hasOwn(globalThis, 'ProgressEvent')).toBe(true);
    const event = new ProgressEvent('progress', { lengthComputable: true, loaded: 3, total: 9 });
    expect(event).toBeInstanceOf(Event);
    expect([event.type, event.loaded, event.total]).toEqual(['progress', 3, 9]);
  });

  it('still resolves, and still constructs what FileLoader builds, once the own class is deleted', () => {
    const late = withoutTheEnvironmentsOwn(() => {
      expect(Object.hasOwn(globalThis, 'ProgressEvent')).toBe(false);
      // the bare name, exactly as three.core.js reads it
      expect(typeof ProgressEvent).toBe('function');
      return new ProgressEvent('progress', { lengthComputable: true, loaded: 3, total: 9 });
    });
    expect([late.type, late.lengthComputable, late.loaded, late.total]).toEqual([
      'progress',
      true,
      3,
      9,
    ]);
    // with no init it is the event of a read whose length is unknown
    const bare = withoutTheEnvironmentsOwn(() => new ProgressEvent('progress'));
    expect([bare.lengthComputable, bare.loaded, bare.total]).toEqual([false, 0, 0]);
  });

  it("lets Three's FileLoader finish a read whose chunk lands after the own class is gone", async () => {
    // the failure itself, end to end: a body whose first chunk arrives late (a real timer,
    // not the window's), read by the real FileLoader. Without the fallback its
    // `new ProgressEvent` throws in a promise callback nobody catches: the load never ends
    // and Vitest fails the run on the unhandled rejection.
    let reads = 0;
    const chunk = new TextEncoder().encode('late body');
    const response = {
      status: 200,
      headers: { get: () => null },
      body: {
        getReader: () => ({
          read: () =>
            new Promise((resolve) => {
              reads++;
              if (reads === 1) realTimeout(() => resolve({ done: false, value: chunk }), 40);
              else resolve({ done: true, value: undefined });
            }),
        }),
      },
    };
    vi.stubGlobal('fetch', () => Promise.resolve(response));
    const loaded = vi.fn();
    const failed = vi.fn();
    const progress = vi.fn();
    new THREE.FileLoader().load('/models/late.glb', loaded, progress, failed);
    // the read is in flight: the environment takes its class away, as at the end of a file
    await pause(5);
    expect(reads).toBe(1);
    await withoutTheEnvironmentsOwnAsync(async () => {
      await pause(120);
    });
    await vi.waitFor(() => expect(loaded).toHaveBeenCalledTimes(1));
    expect(loaded).toHaveBeenCalledWith('late body');
    expect(failed).not.toHaveBeenCalled();
    // the progress callback was handed the fallback's event for that chunk
    expect(progress).toHaveBeenCalledTimes(1);
    expect(progress.mock.calls[0][0]).toMatchObject({ type: 'progress', loaded: chunk.byteLength });
  });

  it('keeps the fallback off Object.prototype: no plain object inherits it', () => {
    expect('ProgressEvent' in {}).toBe(false);
    expect(Object.hasOwn(Object.prototype, 'ProgressEvent')).toBe(false);
    // ...and out of sight of anything that lists the global's own keys
    withoutTheEnvironmentsOwn(() => {
      expect(Object.keys(globalThis)).not.toContain('ProgressEvent');
    });
  });
});
