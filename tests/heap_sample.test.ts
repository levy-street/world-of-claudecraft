// The used JS heap in MB for the hitch tracker's per-frame sample
// (src/render/heap_sample.ts): Chrome's performance.memory in MB, 0 (unknown)
// everywhere else, and 0 for anything that is not a positive byte count.
import { afterEach, describe, expect, it } from 'vitest';
import { usedJsHeapMb } from '../src/render/heap_sample';

const BYTES_PER_MB = 1048576;
const setMemory = (memory: unknown): void => {
  (performance as unknown as { memory?: unknown }).memory = memory;
};

afterEach(() => {
  delete (performance as unknown as { memory?: unknown }).memory;
});

describe('usedJsHeapMb', () => {
  it('reads 0 when performance.memory is absent (every non-Chrome host)', () => {
    delete (performance as unknown as { memory?: unknown }).memory;
    expect(usedJsHeapMb()).toBe(0);
  });

  it('converts usedJSHeapSize bytes to MB', () => {
    setMemory({ usedJSHeapSize: 3 * BYTES_PER_MB });
    expect(usedJsHeapMb()).toBe(3);
    setMemory({ usedJSHeapSize: 1.5 * BYTES_PER_MB });
    expect(usedJsHeapMb()).toBe(1.5);
    setMemory({ usedJSHeapSize: 262144000 });
    expect(usedJsHeapMb()).toBe(250);
  });

  it('reads 0 for a missing, non-numeric, zero or negative size', () => {
    setMemory({});
    expect(usedJsHeapMb()).toBe(0);
    setMemory({ usedJSHeapSize: '3145728' });
    expect(usedJsHeapMb()).toBe(0);
    setMemory({ usedJSHeapSize: 0 });
    expect(usedJsHeapMb()).toBe(0);
    setMemory({ usedJSHeapSize: -BYTES_PER_MB });
    expect(usedJsHeapMb()).toBe(0);
    setMemory({ usedJSHeapSize: Number.NaN });
    expect(usedJsHeapMb()).toBe(0);
  });
});
