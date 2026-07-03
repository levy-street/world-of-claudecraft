import { afterEach, describe, expect, it, vi } from 'vitest';
import { CALL_TIMEOUT_MS, EditorApiError, listMyMaps } from '../src/editor/net';
import { editorErrorKey } from '../src/editor/server_errors_core';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('net call timeout (stuck-saving guard)', () => {
  it('aborts a stalled request and surfaces the timeout code', async () => {
    vi.useFakeTimers();
    // A fetch that never resolves until its abort signal fires.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_path: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      ),
    );
    let err: unknown = null;
    const done = listMyMaps().catch((e) => {
      err = e;
    });
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS + 1);
    await done;
    expect(err).toBeInstanceOf(EditorApiError);
    expect((err as EditorApiError).code).toBe('timeout');
    expect((err as EditorApiError).status).toBe(0);
  });

  it('a non-abort transport failure still maps to the network code (null)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('connection refused'))),
    );
    let err: unknown = null;
    await listMyMaps().catch((e) => {
      err = e;
    });
    expect(err).toBeInstanceOf(EditorApiError);
    expect((err as EditorApiError).code).toBeNull();
  });

  it('the timeout code maps to its own t() key', () => {
    expect(editorErrorKey('timeout')).toBe('editor.serverError.timeout');
    expect(editorErrorKey('timeout', 0)).toBe('editor.serverError.timeout');
    expect(editorErrorKey(null)).toBe('editor.serverError.network');
  });
});
