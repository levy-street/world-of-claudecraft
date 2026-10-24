import { describe, expect, it, vi } from 'vitest';
import {
  installWebGLContextRelease,
  markPageDisposable,
  registerPageTeardown,
  releaseTrackedWebGLContexts,
  retirePageAndClose,
  retirePageAndReplace,
  runPageTeardowns,
  trackWebGLContext,
} from '../src/render/context_release';

function fakeHolder() {
  return { forceContextLoss: vi.fn(), dispose: vi.fn() };
}

describe('context_release', () => {
  it('force-loses then disposes every tracked context and clears the set', () => {
    releaseTrackedWebGLContexts(); // reset shared module state
    const a = fakeHolder();
    const b = fakeHolder();
    trackWebGLContext(a);
    trackWebGLContext(b);

    releaseTrackedWebGLContexts();

    expect(a.forceContextLoss).toHaveBeenCalledTimes(1);
    expect(a.dispose).toHaveBeenCalledTimes(1);
    expect(b.forceContextLoss).toHaveBeenCalledTimes(1);
    expect(b.dispose).toHaveBeenCalledTimes(1);

    // Cleared: a second release does not touch the already-released holders.
    releaseTrackedWebGLContexts();
    expect(a.forceContextLoss).toHaveBeenCalledTimes(1);
  });

  it('untracks a holder so it is not released after dispose-early', () => {
    releaseTrackedWebGLContexts();
    const a = fakeHolder();
    const untrack = trackWebGLContext(a);
    untrack();

    releaseTrackedWebGLContexts();

    expect(a.forceContextLoss).not.toHaveBeenCalled();
    expect(a.dispose).not.toHaveBeenCalled();
  });

  it('normalizes nullable WebGL info logs for Three r165', () => {
    releaseTrackedWebGLContexts();
    const rawProgramLog = vi.fn((): string | null => null);
    const rawShaderLog = vi.fn((): string | null => null);
    const context = {
      getProgramInfoLog: rawProgramLog,
      getShaderInfoLog: rawShaderLog,
    } as unknown as WebGLRenderingContext;
    const holder = {
      ...fakeHolder(),
      getContext: () => context,
    };

    trackWebGLContext(holder);

    expect(context.getProgramInfoLog({} as WebGLProgram)).toBe('');
    expect(context.getShaderInfoLog({} as WebGLShader)).toBe('');
    expect(rawProgramLog).toHaveBeenCalledTimes(1);
    expect(rawShaderLog).toHaveBeenCalledTimes(1);
  });

  it('swallows a failing holder so one bad context cannot block the rest', () => {
    releaseTrackedWebGLContexts();
    const bad = {
      forceContextLoss: vi.fn(() => {
        throw new Error('context already lost');
      }),
      dispose: vi.fn(() => {
        throw new Error('gone');
      }),
    };
    const good = fakeHolder();
    trackWebGLContext(bad);
    trackWebGLContext(good);

    expect(() => releaseTrackedWebGLContexts()).not.toThrow();
    expect(good.forceContextLoss).toHaveBeenCalledTimes(1);
    expect(good.dispose).toHaveBeenCalledTimes(1);
  });

  const pagehide = (persisted: boolean) => Object.assign(new Event('pagehide'), { persisted });

  it('releases tracked contexts on a real page teardown (persisted === false)', () => {
    releaseTrackedWebGLContexts();
    const target = new EventTarget();
    const a = fakeHolder();
    trackWebGLContext(a);

    installWebGLContextRelease(target);
    target.dispatchEvent(pagehide(false));

    expect(a.forceContextLoss).toHaveBeenCalledTimes(1);
    expect(a.dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps contexts when the page is frozen into the bfcache (persisted === true)', () => {
    releaseTrackedWebGLContexts();
    const target = new EventTarget();
    const a = fakeHolder();
    trackWebGLContext(a);

    installWebGLContextRelease(target);
    target.dispatchEvent(pagehide(true));

    expect(a.forceContextLoss).not.toHaveBeenCalled();
    expect(a.dispose).not.toHaveBeenCalled();
  });

  it('retires a disposable heavy page even when pagehide says it was cached', () => {
    releaseTrackedWebGLContexts();
    runPageTeardowns();
    const target = new EventTarget();
    const reload = vi.fn();
    const a = fakeHolder();
    const teardown = vi.fn();
    trackWebGLContext(a);
    registerPageTeardown(teardown);

    markPageDisposable(target, { reload });
    installWebGLContextRelease(target);
    target.dispatchEvent(pagehide(true));

    expect(a.forceContextLoss).toHaveBeenCalledTimes(1);
    expect(a.dispose).toHaveBeenCalledTimes(1);
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it('reloads a disposable page if a browser restores it from the bfcache anyway', () => {
    const target = new EventTarget();
    const reload = vi.fn();
    markPageDisposable(target, { reload });

    target.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    target.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('runs registered page teardowns and swallows a failing one', () => {
    runPageTeardowns(); // drain any prior registrations
    const good = vi.fn();
    const bad = vi.fn(() => {
      throw new Error('teardown blew up');
    });
    const other = vi.fn();
    registerPageTeardown(good);
    registerPageTeardown(bad);
    registerPageTeardown(other);

    expect(() => runPageTeardowns()).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    expect(bad).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);

    // Drained callbacks must not run again when an explicit navigation cleanup
    // is followed by the browser's pagehide event.
    runPageTeardowns();
    expect(good).toHaveBeenCalledTimes(1);
    expect(bad).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('unregisters a teardown so it no longer runs', () => {
    const fn = vi.fn();
    const off = registerPageTeardown(fn);
    off();
    runPageTeardowns();
    expect(fn).not.toHaveBeenCalled();
  });

  it('retires resources before replacing the heavy page history entry', () => {
    releaseTrackedWebGLContexts();
    runPageTeardowns();
    const order: string[] = [];
    trackWebGLContext({
      forceContextLoss: () => order.push('lose-context'),
      dispose: () => order.push('dispose-context'),
    });
    registerPageTeardown(() => order.push('teardown'));
    const target = { replace: (url: string | URL) => order.push(`replace:${url}`) };

    retirePageAndReplace('/editor.html', target);

    expect(order).toEqual(['lose-context', 'dispose-context', 'teardown', 'replace:/editor.html']);
  });

  it('retires resources before closing a disposable playtest tab', () => {
    releaseTrackedWebGLContexts();
    runPageTeardowns();
    const order: string[] = [];
    trackWebGLContext({
      forceContextLoss: () => order.push('lose-context'),
      dispose: () => order.push('dispose-context'),
    });
    registerPageTeardown(() => order.push('teardown'));

    retirePageAndClose({ close: () => order.push('close') });

    expect(order).toEqual(['lose-context', 'dispose-context', 'teardown', 'close']);
  });

  it('runs teardowns (audio close) alongside the GL release on a real teardown', () => {
    releaseTrackedWebGLContexts();
    const target = new EventTarget();
    const gl = fakeHolder();
    const audioClose = vi.fn();
    trackWebGLContext(gl);
    const off = registerPageTeardown(audioClose);

    installWebGLContextRelease(target);
    target.dispatchEvent(pagehide(false));

    expect(gl.forceContextLoss).toHaveBeenCalledTimes(1);
    expect(audioClose).toHaveBeenCalledTimes(1);
    off();
  });

  it('skips teardowns too when the page is only frozen (persisted === true)', () => {
    releaseTrackedWebGLContexts();
    const target = new EventTarget();
    const audioClose = vi.fn();
    const off = registerPageTeardown(audioClose);

    installWebGLContextRelease(target);
    target.dispatchEvent(pagehide(true));

    expect(audioClose).not.toHaveBeenCalled();
    off();
  });
});
