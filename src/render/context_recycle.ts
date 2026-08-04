export interface RecycledRendererContext {
  canvas: HTMLCanvasElement;
  context: WebGL2RenderingContext;
}

interface LoseContextExtension {
  loseContext(): void;
  restoreContext(): void;
}

interface ContextRecycleScheduler {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(id: number): void;
}

export interface ContextRecycleOptions {
  timeoutMs?: number;
  scheduler?: ContextRecycleScheduler;
}

const defaultScheduler: ContextRecycleScheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs) as unknown as number,
  clearTimeout: (id) => clearTimeout(id),
};

const DEFAULT_RECYCLE_TIMEOUT_MS = 10_000;

export function preflightWebGL2ContextRecycle(context: WebGL2RenderingContext): void {
  if (context.isContextLost()) throw new Error('Renderer WebGL2 context is already lost');
  if (!context.getExtension('WEBGL_lose_context')) {
    throw new Error('WEBGL_lose_context is required to recycle the renderer');
  }
}

/**
 * Cycle one WebGL2 context through WEBGL_lose_context without replacing its
 * canvas or obtaining a second context. The old Three wrapper must already be
 * terminally disposed before this function is called.
 */
export function recycleWebGL2Context(
  recycled: RecycledRendererContext,
  options: ContextRecycleOptions = {},
): Promise<RecycledRendererContext> {
  const { canvas, context } = recycled;
  const extension = context.getExtension('WEBGL_lose_context') as LoseContextExtension | null;
  if (!extension) {
    return Promise.reject(new Error('WEBGL_lose_context is required to recycle WebGL2'));
  }

  const scheduler = options.scheduler ?? defaultScheduler;
  const timeoutMs = options.timeoutMs ?? DEFAULT_RECYCLE_TIMEOUT_MS;
  return new Promise<RecycledRendererContext>((resolve, reject) => {
    let lossObserved = context.isContextLost();
    let settled = false;
    let timeout = 0;
    let restoreTimer: number | null = null;

    const cleanup = (): void => {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      scheduler.clearTimeout(timeout);
      if (restoreTimer !== null) scheduler.clearTimeout(restoreTimer);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onRestored = (): void => {
      if (settled) return;
      if (!lossObserved) return;
      if (context.isContextLost()) {
        fail(new Error('WebGL2 context reported restored while it was still lost'));
        return;
      }
      const restored = canvas.getContext('webgl2');
      if (restored !== context) {
        fail(new Error('WebGL2 recycle replaced the canvas context'));
        return;
      }
      settled = true;
      cleanup();
      resolve(recycled);
    };
    const requestRestore = (): void => {
      try {
        extension.restoreContext();
      } catch (error) {
        fail(error);
      }
    };
    const queueRestore = (): void => {
      if (restoreTimer !== null) return;
      // Chromium ignores restoreContext() while it is still dispatching the
      // loss event. The next task runs after preventDefault() has committed.
      restoreTimer = scheduler.setTimeout(() => {
        restoreTimer = null;
        requestRestore();
      }, 0);
    };
    const onLost = (event: Event): void => {
      event.preventDefault();
      if (lossObserved) return;
      lossObserved = true;
      queueRestore();
    };

    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    timeout = scheduler.setTimeout(
      () => fail(new Error(`WebGL2 context recycle timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );

    if (lossObserved) {
      queueRestore();
      return;
    }
    try {
      extension.loseContext();
    } catch (error) {
      fail(error);
    }
  });
}
