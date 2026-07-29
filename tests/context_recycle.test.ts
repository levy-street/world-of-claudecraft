import { describe, expect, it, vi } from 'vitest';
import {
  preflightWebGL2ContextRecycle,
  type RecycledRendererContext,
  recycleWebGL2Context,
} from '../src/render/context_recycle';

function recycleFixture(
  options: {
    autoEvents?: boolean;
    initiallyLost?: boolean;
    remainsLostOnRestore?: boolean;
    swapContext?: boolean;
  } = {},
) {
  const canvas = new EventTarget() as HTMLCanvasElement;
  let lost = options.initiallyLost ?? false;
  let lossDefaultPrevented = false;
  const context = {
    getExtension: vi.fn(),
    isContextLost: vi.fn(() => lost),
  } as unknown as WebGL2RenderingContext;
  const replacement = {} as WebGL2RenderingContext;
  Object.assign(canvas, {
    getContext: vi.fn(() => (options.swapContext ? replacement : context)),
  });
  const calls: string[] = [];
  const extension = {
    loseContext: vi.fn(() => {
      calls.push('lose');
      lost = true;
      if (options.autoEvents === false) return;
      const event = new Event('webglcontextlost', { cancelable: true });
      canvas.dispatchEvent(event);
      lossDefaultPrevented = event.defaultPrevented;
    }),
    restoreContext: vi.fn(() => {
      calls.push('restore');
      if (!options.remainsLostOnRestore) lost = false;
      canvas.dispatchEvent(new Event('webglcontextrestored'));
    }),
  };
  vi.mocked(context.getExtension).mockReturnValue(extension as never);
  const recycled = { canvas, context } satisfies RecycledRendererContext;
  return {
    calls,
    canvas,
    context,
    extension,
    get lossDefaultPrevented() {
      return lossDefaultPrevented;
    },
    recycled,
  };
}

describe('recycleWebGL2Context', () => {
  it('preflights a live context with the required extension', () => {
    const fixture = recycleFixture();
    expect(() => preflightWebGL2ContextRecycle(fixture.context)).not.toThrow();
  });

  it('preflight rejects a lost context before destructive teardown', () => {
    const fixture = recycleFixture({ initiallyLost: true });
    expect(() => preflightWebGL2ContextRecycle(fixture.context)).toThrow('already lost');
  });

  it('awaits loss then restore and returns the exact same canvas and WebGL2 context', async () => {
    const fixture = recycleFixture();

    const result = recycleWebGL2Context(fixture.recycled);
    expect(fixture.calls).toEqual(['lose']);
    const restored = await result;

    expect(fixture.calls).toEqual(['lose', 'restore']);
    expect(restored).toBe(fixture.recycled);
    expect(restored.canvas).toBe(fixture.canvas);
    expect(restored.context).toBe(fixture.context);
    expect(fixture.canvas.getContext).toHaveBeenCalledWith('webgl2');
    expect(fixture.lossDefaultPrevented).toBe(true);
  });

  it('restores an already-lost context without requesting a second loss', async () => {
    const fixture = recycleFixture({ initiallyLost: true });

    await expect(recycleWebGL2Context(fixture.recycled)).resolves.toBe(fixture.recycled);

    expect(fixture.extension.loseContext).not.toHaveBeenCalled();
    expect(fixture.extension.restoreContext).toHaveBeenCalledTimes(1);
  });

  it('ignores a restore event until the requested loss has been observed', async () => {
    const fixture = recycleFixture({ autoEvents: false });
    const result = recycleWebGL2Context(fixture.recycled);

    fixture.canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(fixture.extension.restoreContext).not.toHaveBeenCalled();

    const lost = new Event('webglcontextlost', { cancelable: true });
    fixture.canvas.dispatchEvent(lost);
    await expect(result).resolves.toBe(fixture.recycled);
    expect(lost.defaultPrevented).toBe(true);
  });

  it('rejects if restoration replaces the context behind the canvas', async () => {
    const fixture = recycleFixture({ swapContext: true });

    await expect(recycleWebGL2Context(fixture.recycled)).rejects.toThrow(
      'replaced the canvas context',
    );
  });

  it('rejects a restore event while the context still reports lost', async () => {
    const fixture = recycleFixture({ remainsLostOnRestore: true });

    await expect(recycleWebGL2Context(fixture.recycled)).rejects.toThrow('still lost');
  });

  it('times out and removes both listeners before ignoring late events', async () => {
    const fixture = recycleFixture({ autoEvents: false });
    const removeListener = vi.spyOn(fixture.canvas, 'removeEventListener');
    let onTimeout!: () => void;
    const scheduler = {
      setTimeout: vi.fn((callback: () => void) => {
        onTimeout = callback;
        return 17;
      }),
      clearTimeout: vi.fn(),
    };
    const result = recycleWebGL2Context(fixture.recycled, { timeoutMs: 25, scheduler });

    onTimeout();
    await expect(result).rejects.toThrow('timed out after 25ms');
    expect(removeListener).toHaveBeenCalledWith('webglcontextlost', expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith('webglcontextrestored', expect.any(Function));
    expect(scheduler.clearTimeout).toHaveBeenCalledWith(17);

    fixture.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    fixture.canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(fixture.extension.restoreContext).not.toHaveBeenCalled();
  });

  it('fails cleanly when WEBGL_lose_context is unavailable', async () => {
    const fixture = recycleFixture();
    vi.mocked(fixture.context.getExtension).mockReturnValue(null);

    expect(() => preflightWebGL2ContextRecycle(fixture.context)).toThrow(
      'WEBGL_lose_context is required',
    );
    await expect(recycleWebGL2Context(fixture.recycled)).rejects.toThrow(
      'WEBGL_lose_context is required',
    );
  });
});
