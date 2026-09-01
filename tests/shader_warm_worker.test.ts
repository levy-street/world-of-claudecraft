// The shader warm worker's message host (src/render/shader_warm_worker.ts):
// what it answers on init, and how a lost context reaches the client. The
// pacing itself is the pure scheduler's (tests/shader_warm_worker_core.test.ts);
// this suite only drives the worker scope, on a stubbed OffscreenCanvas and a
// stubbed WebGL2 context, because a real one needs a browser.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShaderWarmWorkerMessage } from '../src/render/shader_warm_protocol';

/** Only the extension the worker's own contract turns on a decision:
 *  KHR_parallel_shader_compile picks polling over a blocking resolve. */
const GRANTED = ['KHR_parallel_shader_compile'];

interface CanvasStub {
  listeners: Map<string, (() => void)[]>;
  emit(type: string): void;
}

const posted: ShaderWarmWorkerMessage[] = [];
let canvases: CanvasStub[] = [];
/** What the stub context answers the tick's own poll, flipped by the cases
 *  that model a driver dropping the context without dispatching the event. */
let contextIsLost = false;

function glStub() {
  return {
    RENDERER: 0x1f01,
    getExtension: (name: string) => (GRANTED.includes(name) ? { name } : null),
    getParameter: () => 'Stub Adapter',
    isContextLost: () => contextIsLost,
  };
}

function installWorkerScope(): void {
  const scope = globalThis as Record<string, unknown>;
  scope.postMessage = (message: ShaderWarmWorkerMessage) => {
    posted.push(message);
  };
  scope.OffscreenCanvas = class {
    listeners = new Map<string, (() => void)[]>();
    constructor(
      readonly width: number,
      readonly height: number,
    ) {
      canvases.push(this as unknown as CanvasStub);
    }
    getContext(id: string) {
      return id === 'webgl2' ? glStub() : null;
    }
    addEventListener(type: string, cb: () => void) {
      const list = this.listeners.get(type) ?? [];
      list.push(cb);
      this.listeners.set(type, list);
    }
    emit(type: string) {
      for (const cb of this.listeners.get(type) ?? []) cb();
    }
  };
}

/** Load the worker module fresh (its state is module-scoped) and hand back its
 *  message entry point. */
async function loadWorker(): Promise<(message: unknown) => void> {
  installWorkerScope();
  await import('../src/render/shader_warm_worker');
  const onmessage = (globalThis as { onmessage?: (event: unknown) => void }).onmessage;
  if (!onmessage) throw new Error('the worker installed no message handler');
  return (message: unknown) => onmessage({ data: message });
}

function init(send: (message: unknown) => void): void {
  send({ kind: 'init', contextAttributes: null, extensions: GRANTED, maxWindow: 2, retain: 4 });
}

/** One request, which is all it takes to make the worker schedule a tick. */
function warmOne(id: number) {
  return {
    kind: 'warm',
    sources: [{ id, vertex: 'v', fragment: 'f', index0Attribute: 'p', priority: 0 }],
  };
}

/** Comfortably past the worker's own poll period, so one advance runs the tick
 *  a request schedules. */
const TICK_WINDOW_MS = 50;

beforeEach(() => {
  posted.length = 0;
  canvases = [];
  contextIsLost = false;
  // The worker's state is module-scoped and its handler installs at import.
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  const scope = globalThis as Record<string, unknown>;
  scope.postMessage = undefined;
  scope.OffscreenCanvas = undefined;
  scope.onmessage = null;
});

describe('the shader warm worker scope', () => {
  it('takes the game context contract and answers ready with its adapter', async () => {
    const send = await loadWorker();
    init(send);
    expect(posted).toEqual([
      {
        kind: 'ready',
        ok: true,
        reason: null,
        extensions: GRANTED,
        adapter: 'Stub Adapter',
      },
    ]);
  });

  it('refuses a context whose extension set is not the game context own', async () => {
    const send = await loadWorker();
    send({
      kind: 'init',
      contextAttributes: null,
      extensions: [...GRANTED, 'EXT_color_buffer_float'],
      maxWindow: 2,
      retain: 4,
    });
    expect(posted).toEqual([
      {
        kind: 'ready',
        ok: false,
        reason: 'extension-mismatch',
        extensions: GRANTED,
        adapter: '',
      },
    ]);
  });

  it('reports a context lost while idle at once, without waiting for a request', async () => {
    // Idle, the worker schedules no tick at all, so the loss used to be noticed
    // only when the next gate's request arrived: that gate held for a context
    // that was already dead. The canvas event is what makes the client retire
    // the worker on the spot instead.
    const send = await loadWorker();
    init(send);
    posted.length = 0;
    canvases[0].emit('webglcontextlost');
    expect(posted).toEqual([{ kind: 'lost' }]);

    // And nothing is taken for the dead context afterwards.
    send({ kind: 'warm', sources: [{ id: 1, vertex: 'v', fragment: 'f', index0Attribute: 'p' }] });
    expect(posted).toEqual([{ kind: 'lost' }, { kind: 'failed', id: 1, reason: 'not-ready' }]);
  });

  it('reports the loss once, whichever notices it first', async () => {
    const send = await loadWorker();
    init(send);
    posted.length = 0;
    canvases[0].emit('webglcontextlost');
    canvases[0].emit('webglcontextlost');
    expect(posted.filter((message) => message.kind === 'lost')).toHaveLength(1);
  });

  it('notices a loss the canvas never announced, on the tick own poll', async () => {
    // The other arm of the same report: a driver that drops the context without
    // dispatching the event leaves the canvas silent, and only the poll the tick
    // runs before it settles anything can say so. What is queued fails as a
    // context loss rather than waiting out its deadline.
    vi.useFakeTimers();
    const send = await loadWorker();
    init(send);
    posted.length = 0;
    contextIsLost = true;
    send(warmOne(7));
    vi.advanceTimersByTime(TICK_WINDOW_MS);
    expect(posted).toEqual([{ kind: 'failed', id: 7, reason: 'context-lost' }, { kind: 'lost' }]);
  });

  it('adds nothing when the canvas announces the loss the poll already reported', async () => {
    // The reverse order of the pair above: the poll speaks first, and the event
    // the driver dispatches afterwards must not report the loss a second time
    // (the client retires the worker on the first one).
    vi.useFakeTimers();
    const send = await loadWorker();
    init(send);
    posted.length = 0;
    contextIsLost = true;
    send(warmOne(7));
    vi.advanceTimersByTime(TICK_WINDOW_MS);
    canvases[0].emit('webglcontextlost');
    expect(posted.filter((message) => message.kind === 'lost')).toHaveLength(1);
  });
});
