// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchDevicePixelRatio } from '../src/render/dpr_watch';

// A resolution media query matches exactly one ratio, so the whole contract is
// the re-arm: every fired query must be replaced by one built at the NEW
// devicePixelRatio, or the watch goes deaf after a single display change.
// happy-dom has no matchMedia, so the queries are stubbed and inspected.

interface FakeQuery {
  media: string;
  listeners: Array<() => void>;
  removed: number;
  addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: string, listener: () => void): void;
}

const originalMatchMedia = window.matchMedia;
const originalDpr = window.devicePixelRatio;

function installMatchMedia(): FakeQuery[] {
  const queries: FakeQuery[] = [];
  const matchMedia = (media: string): FakeQuery => {
    const query: FakeQuery = {
      media,
      listeners: [],
      removed: 0,
      addEventListener(type, listener, options): void {
        if (type !== 'change') return;
        const wrapped = (): void => {
          if (options?.once) {
            const at = query.listeners.indexOf(wrapped);
            if (at >= 0) query.listeners.splice(at, 1);
          }
          listener();
        };
        // Keep the original around so removeEventListener can find it, exactly
        // as the platform matches listeners by identity.
        (wrapped as unknown as { original: () => void }).original = listener;
        query.listeners.push(wrapped);
      },
      removeEventListener(type, listener): void {
        if (type !== 'change') return;
        const at = query.listeners.findIndex(
          (entry) => (entry as unknown as { original: () => void }).original === listener,
        );
        if (at >= 0) {
          query.listeners.splice(at, 1);
          query.removed += 1;
        }
      },
    };
    queries.push(query);
    return query;
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: matchMedia,
  });
  return queries;
}

function setDpr(value: number): void {
  Object.defineProperty(window, 'devicePixelRatio', {
    configurable: true,
    writable: true,
    value,
  });
}

function fire(query: FakeQuery): void {
  for (const listener of [...query.listeners]) listener();
}

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
  setDpr(originalDpr);
});

describe('watchDevicePixelRatio', () => {
  it('arms a query at the current ratio and re-arms at the new one on a change', () => {
    setDpr(1);
    const queries = installMatchMedia();
    const onChange = vi.fn();
    watchDevicePixelRatio(onChange);
    expect(queries).toHaveLength(1);
    expect(queries[0].media).toBe('(resolution: 1dppx)');
    expect(onChange).not.toHaveBeenCalled();

    setDpr(2);
    fire(queries[0]);
    expect(onChange).toHaveBeenCalledTimes(1);
    // The re-arm is the load-bearing half: a second query, built at 2dppx.
    expect(queries).toHaveLength(2);
    expect(queries[1].media).toBe('(resolution: 2dppx)');

    setDpr(1.5);
    fire(queries[1]);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(queries).toHaveLength(3);
    expect(queries[2].media).toBe('(resolution: 1.5dppx)');
  });

  it('stops firing after unsubscribe, and arms nothing further', () => {
    setDpr(2);
    const queries = installMatchMedia();
    const onChange = vi.fn();
    const unsubscribe = watchDevicePixelRatio(onChange);
    unsubscribe();
    expect(queries[0].removed).toBe(1);

    setDpr(3);
    fire(queries[0]);
    expect(onChange).not.toHaveBeenCalled();
    expect(queries).toHaveLength(1);
  });

  it('re-arms even when onChange throws, so one bad notify cannot end the watch', () => {
    // The re-arm happens BEFORE the notify for exactly this reason: the media
    // query listener is a one-shot, so a throw after an un-re-armed fire would
    // leave the session deaf to every later display change.
    setDpr(1);
    const queries = installMatchMedia();
    let calls = 0;
    const onChange = (): void => {
      calls += 1;
      throw new Error('resizeViewport blew up');
    };
    watchDevicePixelRatio(onChange);

    setDpr(2);
    expect(() => fire(queries[0])).toThrow('resizeViewport blew up');
    expect(calls).toBe(1);
    expect(queries).toHaveLength(2);
    expect(queries[1].media).toBe('(resolution: 2dppx)');

    // The watch is still live: the next change is still observed.
    setDpr(3);
    expect(() => fire(queries[1])).toThrow('resizeViewport blew up');
    expect(calls).toBe(2);
    expect(queries).toHaveLength(3);
    expect(queries[2].media).toBe('(resolution: 3dppx)');
  });

  it('warns once on an addListener-only host and degrades to a dead watch', () => {
    // The degrade-only contract: legacy addListener-only MediaQueryLists
    // (pre-2020 WebKit) get no watch and no fallback path, matching the
    // pre-watch world, but the dead arm must be VISIBLE. One warn per
    // session, however many watchers hit it, and the returned unsubscribe
    // stays a safe no-op.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setDpr(2);
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: () => ({
        media: '(resolution: 2dppx)',
        addListener: () => {},
        removeListener: () => {},
      }),
    });
    const onChange = vi.fn();
    const unsubscribe = watchDevicePixelRatio(onChange);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('addListener-only');
    watchDevicePixelRatio(vi.fn());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(() => unsubscribe()).not.toThrow();
    expect(onChange).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('is a no-op without matchMedia, and its unsubscribe is safe to call', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    const onChange = vi.fn();
    const unsubscribe = watchDevicePixelRatio(onChange);
    expect(typeof unsubscribe).toBe('function');
    expect(() => unsubscribe()).not.toThrow();
    expect(onChange).not.toHaveBeenCalled();
  });
});
