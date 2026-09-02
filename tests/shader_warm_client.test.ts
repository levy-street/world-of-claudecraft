// The main thread's side of the shader warm worker
// (src/render/shader_warm_client.ts): it spawns the worker once, hands it the
// game context's own contract, dedupes and routes the programs the gates ask
// for, forwards the pause signal, gives up on a worker that stops delivering,
// and reads out. Driven here through an injected spawn and an injected
// timer, so every message the host sends and every deadline it arms is a
// line in the case rather than a real Worker and a real clock.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import {
  armShaderWarm,
  disposeShaderWarm,
  holdShaderPrograms,
  noteShaderWarmFrameMs,
  noteShaderWarmHold,
  resetShaderWarmForTest,
  SHADER_WARM_READY_DEADLINE_MS,
  setShaderWarmStoredSettingSource,
  shaderWarmAvailable,
  shaderWarmDecide,
  shaderWarmSnapshot,
  storedShaderWarmSetting,
  warmShaderPrograms,
} from '../src/render/shader_warm_client';
import {
  SHADER_WARM_EXPIRED_SHARE_BREAKER,
  SHADER_WARM_HOLD_WINDOW,
  SHADER_WARM_TIMEOUT_BREAKER,
} from '../src/render/shader_warm_client_core';
import type { ShaderWarmWorkerMessage } from '../src/render/shader_warm_protocol';

let warned: string[] = [];

beforeEach(() => {
  warned = [];
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warned.push(args.map((arg) => String(arg)).join(' '));
  });
});

afterEach(() => {
  resetShaderWarmForTest();
  vi.restoreAllMocks();
});

interface FakeWorker {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<ShaderWarmWorkerMessage>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  posted: Record<string, unknown>[];
  terminations: number;
  emit(message: ShaderWarmWorkerMessage): void;
  fail(): void;
  ofKind(kind: string): Record<string, unknown>[];
  kinds(): string[];
}

function fakeWorker(): FakeWorker {
  const worker: FakeWorker = {
    posted: [],
    terminations: 0,
    onmessage: null,
    onerror: null,
    postMessage(message) {
      worker.posted.push(message as Record<string, unknown>);
    },
    terminate() {
      worker.terminations++;
    },
    emit(message) {
      worker.onmessage?.({ data: message } as MessageEvent<ShaderWarmWorkerMessage>);
    },
    fail() {
      worker.onerror?.(new Error('module load failed') as unknown as ErrorEvent);
    },
    ofKind(kind) {
      return worker.posted.filter((message) => message.kind === kind);
    },
    kinds() {
      return worker.posted.map((message) => String(message.kind));
    },
  };
  return worker;
}

/** The extensions the stub context answers for; everything else is null,
 *  the way an adapter without the extension answers. */
function contextStub(granted: string[], attributes: object | null = { antialias: false }) {
  const asked: string[] = [];
  return {
    asked,
    context: {
      getContextAttributes: () => attributes,
      getExtension: (name: string) => {
        asked.push(name);
        return granted.includes(name) ? { name } : null;
      },
    },
  };
}

const GRANTED = [
  'KHR_parallel_shader_compile',
  'WEBGL_debug_renderer_info',
  'EXT_color_buffer_float',
];

interface FakeTimer {
  ms: number;
  fire: () => void;
  cancels: number;
}

interface StartOptions {
  search?: string;
  mobile?: boolean;
  platform?: 'ios' | 'android' | 'other';
  granted?: string[];
  priority?: number;
  imminent?: boolean;
  armed?: boolean;
  now?: () => number;
}

/** Reset the client onto fake workers and a fake timer, then make the first
 *  decide, which is what spawns one. */
function start(options: StartOptions = {}) {
  const workers: FakeWorker[] = [];
  const timers: FakeTimer[] = [];
  resetShaderWarmForTest({
    search: options.search ?? '?shaderwarm=reveal',
    mobile: options.mobile ?? false,
    platform: options.platform ?? 'other',
    spawn: () => {
      const worker = fakeWorker();
      workers.push(worker);
      return worker;
    },
    schedule: (callback, ms) => {
      const timer: FakeTimer = { ms, fire: callback, cancels: 0 };
      timers.push(timer);
      return () => {
        timer.cancels++;
      };
    },
    now: options.now,
  });
  if (options.armed !== false) armShaderWarm();
  const stub = contextStub(options.granted ?? GRANTED);
  const decision = shaderWarmDecide(
    stub.context,
    options.priority ?? GPU_WORK_PRIORITY.VISIBLE_PREWARM,
    options.imminent ?? false,
  );
  return {
    workers,
    timers,
    decision,
    stub,
    context: stub.context,
    worker: () => workers[0],
    latest: () => workers[workers.length - 1],
    ready: (adapter = 'Test Adapter') =>
      workers[workers.length - 1]?.emit({
        kind: 'ready',
        ok: true,
        reason: null,
        extensions: GRANTED,
        adapter,
      }),
  };
}

const SOURCE = {
  vertex: 'void main() {}',
  fragment: 'void main() {}',
  index0Attribute: 'position',
};
const OTHER = { vertex: 'void main() {}', fragment: 'float f;', index0Attribute: 'position' };

describe('starting the shader warm worker', () => {
  it('arms the ready deadline the query pins, for a probe on a busy backend', () => {
    // Windows OpenGL: the worker's context queues behind the boot lane's
    // links on the GPU process and the 3 s default expired before it ever
    // linked; the probe knob is how that backend gets measured at all.
    const { timers } = start({ search: '?shaderwarm=all&shaderwarmready=15000' });
    expect(timers.map((timer) => timer.ms)).toEqual([15_000]);
    resetShaderWarmForTest();
    const plain = start({ search: '?shaderwarm=all' });
    expect(plain.timers.map((timer) => timer.ms)).toEqual([SHADER_WARM_READY_DEADLINE_MS]);
  });

  it('hands the worker the game context own attributes, extensions and caps', () => {
    // The worker's context must be created the same way and enable exactly
    // the same set, in the same order: the browser's program cache key
    // carries both, so a different contract warms keys the game never asks
    // for. The window and retention caps are the platform's.
    const { worker, stub } = start();
    const init = worker().ofKind('init');

    expect(init).toHaveLength(1);
    expect(init[0]).toEqual({
      kind: 'init',
      contextAttributes: { antialias: false },
      extensions: [
        'EXT_color_buffer_float',
        'WEBGL_debug_renderer_info',
        'KHR_parallel_shader_compile',
      ],
      maxWindow: 4,
      retain: 0,
    });
    // The sweep asks over the renderer's own list, in the renderer's order
    // (the backend read also asks for the debug-renderer extension; it is
    // not part of the sweep's order).
    const sweep = stub.asked.filter((name) => name !== 'WEBGL_debug_renderer_info');
    expect(sweep.slice(0, 3)).toEqual([
      'EXT_color_buffer_float',
      'WEBGL_clip_cull_distance',
      'OES_texture_float_linear',
    ]);
    expect(stub.asked).toContain('KHR_parallel_shader_compile');
  });

  it('gives a phone the smaller window, and no retention like the desktop', () => {
    // A phone's GPU is shared with the compositor: fewer links in flight and
    // fewer programs held after their resolve.
    const { worker } = start({ mobile: true });
    expect(worker().ofKind('init')[0]).toMatchObject({ maxWindow: 2, retain: 0 });
  });

  it('never spawns on iOS, whatever the setting, and names the refusal', () => {
    // A second WebGL2 context on a phone-class WebKit is a per-process memory
    // ceiling risk, not a frame cost: the explicit arm is for measuring a
    // backend, and Android keeps it.
    const ios = start({ search: '?shaderwarm=all', platform: 'ios', mobile: true });
    expect(ios.workers).toHaveLength(0);
    expect(shaderWarmSnapshot()).toMatchObject({
      mode: 'off',
      worker: 'idle',
      refusal: 'ios-webkit',
    });
    const android = start({ search: '?shaderwarm=all', platform: 'android', mobile: true });
    expect(android.workers).toHaveLength(1);
  });

  it('reads the mobile class off the page when the caller names no platform', () => {
    // The client's own signal is the body class the mobile controls set, not
    // a user-agent sniff and not the FPS governor.
    const scope = globalThis as { document?: unknown };
    const original = scope.document;
    scope.document = {
      body: { classList: { contains: (name: string) => name === 'mobile-touch' } },
    };
    try {
      const worker = fakeWorker();
      resetShaderWarmForTest({
        search: '?shaderwarm=reveal',
        mobile: undefined,
        spawn: () => worker,
        schedule: () => () => {},
      });
      armShaderWarm();
      shaderWarmDecide(contextStub(GRANTED).context, GPU_WORK_PRIORITY.VISIBLE_PREWARM, false);

      expect(worker.ofKind('init')[0]).toMatchObject({ maxWindow: 2, retain: 0 });
    } finally {
      if (original === undefined) delete scope.document;
      else scope.document = original;
    }
  });

  it('spawns once however many gates decide', () => {
    const { worker, workers, context } = start();
    shaderWarmDecide(context, GPU_WORK_PRIORITY.VISIBLE_PREWARM, false);
    shaderWarmDecide(context, GPU_WORK_PRIORITY.BACKGROUND, false);

    expect(workers).toHaveLength(1);
    expect(worker().ofKind('init')).toHaveLength(1);
  });

  it('is off by default: no mode named, no worker, no hold', () => {
    // The worker ships opt-in until a cell shows the win, so a player who
    // named nothing runs the pre-worker path to the byte.
    const { decision, workers } = start({ search: '' });

    expect(decision).toEqual({ hold: false, bypass: 'mode-off' });
    expect(workers).toEqual([]);
    expect(shaderWarmSnapshot()).toMatchObject({ mode: 'off', worker: 'idle' });
  });

  it('never spawns a worker in mode off', () => {
    const { decision, workers } = start({ search: '?shaderwarm=off' });

    expect(decision).toEqual({ hold: false, bypass: 'mode-off' });
    expect(workers).toEqual([]);
    expect(shaderWarmSnapshot()).toMatchObject({ mode: 'off', worker: 'idle' });
  });

  it('configures every arm silently: holding the live view is the policy, not a probe', () => {
    // Mode `all` is what `auto` and the stored On resolve to (the live view
    // waits behind its stand-in), so no arm earns a console warning.
    start({ search: '?shaderwarm=all' });
    start({ search: '?shaderwarm=reveal' });
    start({ search: '?shaderwarm=off' });
    expect(warned).toEqual([]);
  });

  it('reports refused with no worker at all, and fails what it was asked for', async () => {
    // Wherever module workers or OffscreenCanvas are missing, every gate
    // keeps its own path: the client says so instead of throwing.
    resetShaderWarmForTest({
      search: '?shaderwarm=reveal',
      spawn: () => null,
      schedule: () => () => {},
    });
    armShaderWarm();
    const stub = contextStub(GRANTED);
    const decision = shaderWarmDecide(stub.context, GPU_WORK_PRIORITY.VISIBLE_PREWARM, false);

    expect(decision).toEqual({ hold: false, bypass: 'unavailable' });
    expect(shaderWarmSnapshot()).toMatchObject({ worker: 'refused', refusal: 'no-worker' });
    expect(await warmShaderPrograms([SOURCE], GPU_WORK_PRIORITY.VISIBLE_PREWARM)).toEqual([
      'failed',
    ]);
  });

  it('routes the queue own floors into the policy', () => {
    // The floors are the queue's (GPU_WORK_PRIORITY), not a copy: a gate at
    // the actionable floor must never be held, whatever the mode.
    const { context } = start({ search: '?shaderwarm=reveal' });

    expect(shaderWarmDecide(context, GPU_WORK_PRIORITY.ACTIONABLE_VIEW, false)).toEqual({
      hold: false,
      bypass: 'actionable',
    });
    expect(shaderWarmDecide(context, GPU_WORK_PRIORITY.LIVE_VIEW, false)).toEqual({
      hold: false,
      bypass: 'live-view',
    });
    expect(shaderWarmDecide(context, GPU_WORK_PRIORITY.VISIBLE_PREWARM, false)).toEqual({
      hold: true,
    });
  });

  it('holds nothing before the first reveal', () => {
    const { decision } = start({ armed: false });
    expect(decision).toEqual({ hold: false, bypass: 'before-reveal' });
    expect(shaderWarmSnapshot().armed).toBe(false);
    // The worker is still started there: it is the reveal that is missing,
    // not the worker.
    expect(shaderWarmAvailable()).toBe(true);
  });
});

describe('the deadline a spawned worker has to answer ready', () => {
  it('pins the bound a silent worker is given', () => {
    // A module worker loads and creates its context in well under a second
    // on every tested platform; past this it is treated as absent.
    expect(SHADER_WARM_READY_DEADLINE_MS).toBe(3_000);
  });

  it('arms the deadline at the spawn, for that bound', () => {
    const { timers } = start();
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(SHADER_WARM_READY_DEADLINE_MS);
  });

  it('retires a worker that never answers, and fails what gates asked for', async () => {
    const { worker, timers, context } = start();
    const settled = warmShaderPrograms([SOURCE], GPU_WORK_PRIORITY.VISIBLE_PREWARM);

    timers[0].fire();

    expect(await settled).toEqual(['failed']);
    expect(shaderWarmSnapshot()).toMatchObject({ worker: 'refused', refusal: 'ready-timeout' });
    expect(worker().terminations).toBe(1);
    expect(shaderWarmDecide(context, GPU_WORK_PRIORITY.VISIBLE_PREWARM, false)).toEqual({
      hold: false,
      bypass: 'unavailable',
    });
  });

  it('cancels the deadline when the worker answers in time, and ignores it if it fires late', () => {
    const { timers, ready } = start();
    ready();
    expect(timers[0].cancels).toBe(1);

    // A timer that fires anyway (a cancel the host could not reach) must not
    // retire a worker that is up and serving.
    timers[0].fire();
    expect(shaderWarmSnapshot()).toMatchObject({ worker: 'ready', refusal: null });
  });
});

describe('sending programs to the worker', () => {
  it('queues what a gate asks for before ready, and sends it once ready', async () => {
    const { worker, ready } = start();
    const settled = warmShaderPrograms([SOURCE, OTHER], GPU_WORK_PRIORITY.VISIBLE_PREWARM);

    expect(worker().ofKind('warm')).toHaveLength(0);
    ready();
    const warm = worker().ofKind('warm');
    expect(warm).toHaveLength(1);
    expect(warm[0].sources).toEqual([
      { id: 1, ...SOURCE, priority: GPU_WORK_PRIORITY.VISIBLE_PREWARM },
      { id: 2, ...OTHER, priority: GPU_WORK_PRIORITY.VISIBLE_PREWARM },
    ]);

    worker().emit({ kind: 'warmed', id: 1, linkMs: 12 });
    worker().emit({ kind: 'failed', id: 2, reason: 'link-failed' });
    expect(await settled).toEqual(['warmed', 'failed']);
    expect(shaderWarmSnapshot()).toMatchObject({
      sent: 2,
      warmed: 1,
      failed: 1,
      adapter: 'Test Adapter',
      // Only a warm carries a link time; a failure has none to report.
      links: { count: 1, sumMs: 12, maxMs: 12 },
    });
  });

  it('sends straight through once the worker answered ready', async () => {
    const { worker, ready } = start();
    ready();
    const settled = warmShaderPrograms([SOURCE], GPU_WORK_PRIORITY.BACKGROUND);

    expect(worker().ofKind('warm')).toHaveLength(1);
    worker().emit({ kind: 'warmed', id: 1, linkMs: 5 });
    expect(await settled).toEqual(['warmed']);
  });

  it('asks the worker once for a program two gates want', async () => {
    const { worker, ready } = start();
    ready();
    const first = warmShaderPrograms([SOURCE], GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    const second = warmShaderPrograms([SOURCE], GPU_WORK_PRIORITY.LIVE_VIEW);

    expect(worker().ofKind('warm')).toHaveLength(1);
    worker().emit({ kind: 'warmed', id: 1, linkMs: 5 });
    expect(await Promise.all([first, second])).toEqual([['warmed'], ['warmed']]);
    expect(shaderWarmSnapshot()).toMatchObject({ asked: 2, sent: 1, deduped: 1 });
  });

  it('keeps the longest link the worker reported, and the sum', () => {
    const { worker, ready } = start();
    ready();
    warmShaderPrograms([SOURCE], GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    warmShaderPrograms([OTHER], GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    worker().emit({ kind: 'warmed', id: 1, linkMs: 140 });
    worker().emit({ kind: 'warmed', id: 2, linkMs: 20 });

    expect(shaderWarmSnapshot().links).toEqual({ count: 2, sumMs: 160, maxMs: 140 });
  });

  it('retires a worker that refuses, and every later gate bypasses as unavailable', async () => {
    // The refusal is the worker saying its context cannot reproduce the
    // contract; nothing it links after that would be a cache hit.
    const { worker, context } = start();
    const settled = warmShaderPrograms([SOURCE], GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    worker().emit({
      kind: 'ready',
      ok: false,
      reason: 'extension-mismatch',
      extensions: [],
      adapter: '',
    });

    expect(await settled).toEqual(['failed']);
    // Terminate only: a dispose message could not run before the terminate
    // that follows it, and the browser reclaims the context with the worker.
    expect(worker().kinds()).toEqual(['init']);
    expect(worker().terminations).toBe(1);
    expect(shaderWarmSnapshot()).toMatchObject({
      worker: 'refused',
      refusal: 'extension-mismatch',
      adapter: '',
    });
    expect(shaderWarmDecide(context, GPU_WORK_PRIORITY.VISIBLE_PREWARM, false)).toEqual({
      hold: false,
      bypass: 'unavailable',
    });
  });

  it('fails everything and marks the worker dead when its context is lost', async () => {
    const { worker, ready } = start();
    ready();
    const settled = warmShaderPrograms([SOURCE, OTHER], GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    worker().emit({ kind: 'warmed', id: 1, linkMs: 8 });
    worker().emit({ kind: 'lost' });

    expect(await settled).toEqual(['warmed', 'failed']);
    expect(shaderWarmSnapshot()).toMatchObject({ worker: 'dead', refusal: 'context-lost' });
    expect(shaderWarmAvailable()).toBe(false);
    expect(worker().terminations).toBe(1);
  });

  it('fails everything when the worker module itself blows up', async () => {
    const { worker } = start();
    const settled = warmShaderPrograms([SOURCE], GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    worker().fail();

    expect(await settled).toEqual(['failed']);
    expect(shaderWarmSnapshot()).toMatchObject({ worker: 'dead', refusal: 'worker-error' });
  });

  it('keeps the worker last readout for the snapshot', () => {
    const { worker, ready } = start();
    ready();
    worker().emit({
      kind: 'stats',
      pending: 4,
      inFlight: 2,
      windowLinks: 3,
      state: 'ramp',
      warmed: 11,
      failed: 1,
      retained: 12,
      cancelled: 2,
      backoffCount: 1,
      maxWindowObserved: 4,
      etalonMsPerKchar: 8.5,
      soloSamples: 3,
    });

    expect(shaderWarmSnapshot().workerStats).toEqual({
      pending: 4,
      inFlight: 2,
      windowLinks: 3,
      state: 'ramp',
      warmed: 11,
      failed: 1,
      retained: 12,
      cancelled: 2,
      backoffCount: 1,
      maxWindowObserved: 4,
      etalonMsPerKchar: 8.5,
      soloSamples: 3,
    });
  });
});

describe('the breaker on held gates that keep expiring', () => {
  it('retires the worker after three expiries in a row', () => {
    // Each expiry is a reveal delayed by the whole hold cap: a worker that
    // does that three times running is worse than no worker, so the rest of
    // the renderer's life runs the pre-worker path.
    const { worker, ready, context } = start();
    ready();

    for (let expiry = 0; expiry < SHADER_WARM_TIMEOUT_BREAKER - 1; expiry++) {
      noteShaderWarmHold(false, true, 5_000);
    }
    expect(shaderWarmSnapshot().worker).toBe('ready');

    noteShaderWarmHold(false, true, 5_000);
    expect(shaderWarmSnapshot()).toMatchObject({
      worker: 'dead',
      refusal: 'hold-timeouts:wedged',
      heldTimedOut: SHADER_WARM_TIMEOUT_BREAKER,
    });
    expect(worker().terminations).toBe(1);
    expect(shaderWarmDecide(context, GPU_WORK_PRIORITY.VISIBLE_PREWARM, false)).toEqual({
      hold: false,
      bypass: 'unavailable',
    });
  });

  it('keeps a slow worker that delivered during the expired holds', () => {
    // A cold D3D11 links a program in 400 ms and a hold waits its turn in
    // the queue: holds expire while the worker is answering other requests.
    // That is a slow worker, not a dead one, and worth more than none.
    let clock = 0;
    const { worker, ready } = start({ now: () => clock });
    ready();

    for (let expiry = 0; expiry < SHADER_WARM_TIMEOUT_BREAKER; expiry++) {
      clock += 5_000;
      // A warm the worker answered for some other request, inside the hold
      // that is about to expire (the hold started 5 s ago on this clock).
      worker().emit({ kind: 'warmed', id: 99, linkMs: 400 });
      noteShaderWarmHold(false, true, 5_000);
      // And a hold that came back warm between: most holds are served.
      noteShaderWarmHold(true, false, 400);
    }
    expect(shaderWarmSnapshot()).toMatchObject({
      worker: 'ready',
      heldTimedOut: SHADER_WARM_TIMEOUT_BREAKER,
    });
    expect(worker().terminations).toBe(0);
  });

  it('retires a worker too slow for the demand: half the recent holds expired, whatever it answered', () => {
    // Every expiry here has a warm inside it, so the wedged rule never
    // counts; a worker that keeps answering someone while the holds pay
    // the whole cap is still costing more than none.
    let clock = 0;
    const { worker, ready } = start({ now: () => clock });
    ready();
    for (let hold = 0; hold < SHADER_WARM_HOLD_WINDOW; hold++) {
      clock += 5_000;
      worker().emit({ kind: 'warmed', id: 99, linkMs: 400 });
      const expired = hold % 2 === 1;
      if (hold < SHADER_WARM_HOLD_WINDOW - 1) expect(shaderWarmSnapshot().worker).toBe('ready');
      noteShaderWarmHold(!expired, expired, expired ? 5_000 : 400);
    }
    expect(shaderWarmSnapshot()).toMatchObject({
      worker: 'dead',
      refusal: 'hold-timeouts:expired-share',
      heldTimedOut: SHADER_WARM_EXPIRED_SHARE_BREAKER,
    });
    expect(worker().terminations).toBe(1);
  });

  it('forgets holds past its window: old expiries do not add up forever', () => {
    let clock = 0;
    const { ready } = start({ now: () => clock });
    ready();
    // Three expiries with progress, then a run of warm holds, then three more.
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < SHADER_WARM_EXPIRED_SHARE_BREAKER - 1; i++) {
        clock += 5_000;
        noteShaderWarmHold(false, true, 5_000);
        noteShaderWarmHold(true, false, 400);
      }
      for (let i = 0; i < SHADER_WARM_HOLD_WINDOW; i++) noteShaderWarmHold(true, false, 400);
    }
    expect(shaderWarmSnapshot().worker).toBe('ready');
  });

  it('counts an expiry the worker answered nothing through, and three of those retire it', () => {
    let clock = 0;
    const { worker, ready } = start({ now: () => clock });
    ready();
    worker().emit({ kind: 'warmed', id: 99, linkMs: 400 });

    // Every hold below started after that warm.
    for (let expiry = 0; expiry < SHADER_WARM_TIMEOUT_BREAKER; expiry++) {
      clock += 6_000;
      expect(shaderWarmSnapshot().worker).toBe('ready');
      noteShaderWarmHold(false, true, 5_000);
    }
    expect(shaderWarmSnapshot()).toMatchObject({ worker: 'dead', refusal: 'hold-timeouts:wedged' });
    expect(worker().terminations).toBe(1);
  });

  it('counts expiries in a ROW: a hold that came back warm clears the streak', () => {
    const { ready } = start();
    ready();

    // Three expiries, as many as the breaker, but not in a row.
    noteShaderWarmHold(false, true, 10);
    noteShaderWarmHold(false, true, 10);
    noteShaderWarmHold(true, false, 10);
    noteShaderWarmHold(false, true, 10);

    expect(shaderWarmSnapshot()).toMatchObject({
      worker: 'ready',
      held: 4,
      heldWarm: 1,
      heldTimedOut: SHADER_WARM_TIMEOUT_BREAKER,
    });
  });
});

describe('the pause signal the client forwards', () => {
  it('stands a ready worker down when the frames are late and nothing waits on it', () => {
    const { worker, ready } = start();
    ready();
    for (let frame = 0; frame < 9; frame++) noteShaderWarmFrameMs(40);
    expect(worker().ofKind('pause')).toHaveLength(1);
    expect(shaderWarmSnapshot().paused).toBe(true);

    // Already stood down: more late frames are not a second message.
    for (let frame = 0; frame < 4; frame++) noteShaderWarmFrameMs(40);
    expect(worker().ofKind('pause')).toHaveLength(1);

    for (let frame = 0; frame < 6; frame++) noteShaderWarmFrameMs(16);
    expect(worker().ofKind('resume')).toHaveLength(1);
    expect(shaderWarmSnapshot()).toMatchObject({ paused: false });
    expect(shaderWarmSnapshot().frameEmaMs).toBeLessThan(25);
  });

  it('never pauses the worker while a held gate is waiting on a program', () => {
    // The pause is for BACKGROUND warming. A request that is out has a gate
    // holding its link behind it, and pausing there only delays that gate:
    // the first iGPU cell expired 35 of 57 held pieces at the hold cap.
    const { worker, ready } = start();
    ready();
    warmShaderPrograms([SOURCE], GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    for (let frame = 0; frame < 9; frame++) noteShaderWarmFrameMs(40);

    expect(shaderWarmSnapshot().paused).toBe(true);
    expect(worker().ofKind('pause')).toHaveLength(0);
  });

  it('pauses when the LAST waiting request settles, not the first', () => {
    const { worker, ready } = start();
    ready();
    warmShaderPrograms([SOURCE], GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    warmShaderPrograms([OTHER], GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    for (let frame = 0; frame < 9; frame++) noteShaderWarmFrameMs(40);

    worker().emit({ kind: 'warmed', id: 1, linkMs: 5 });
    expect(worker().ofKind('pause')).toHaveLength(0);

    // A failure ends a wait as surely as a warm does.
    worker().emit({ kind: 'failed', id: 2, reason: 'link-failed' });
    expect(worker().ofKind('pause')).toHaveLength(1);
  });

  it('resumes the moment a gate asks for a program under a paused average', () => {
    // And says each thing once: the worker is never sent the same message
    // twice in a row, whatever the frames and the requests do.
    const { worker, ready } = start();
    ready();
    for (let frame = 0; frame < 9; frame++) noteShaderWarmFrameMs(40);
    expect(worker().ofKind('pause')).toHaveLength(1);

    warmShaderPrograms([SOURCE], GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    expect(worker().ofKind('resume')).toHaveLength(1);
    warmShaderPrograms([OTHER], GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    expect(worker().ofKind('resume')).toHaveLength(1);

    worker().emit({ kind: 'warmed', id: 1, linkMs: 5 });
    expect(worker().ofKind('pause')).toHaveLength(1);
    worker().emit({ kind: 'warmed', id: 2, linkMs: 5 });
    expect(worker().ofKind('pause')).toHaveLength(2);

    expect(worker().kinds()).toEqual(['init', 'pause', 'warm', 'resume', 'warm', 'pause']);
  });

  it('posts nothing to a worker that is not ready, and hands it the pause on ready', () => {
    // The frames are late while the worker is still starting: it must not
    // begin linking the moment it comes up.
    const { worker, ready } = start();
    for (let frame = 0; frame < 9; frame++) noteShaderWarmFrameMs(40);
    expect(worker().ofKind('pause')).toHaveLength(0);

    ready();
    expect(worker().ofKind('pause')).toHaveLength(1);
  });

  it('lets a worker that comes up with work queued get straight to it', () => {
    const { worker, ready } = start();
    warmShaderPrograms([SOURCE], GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    for (let frame = 0; frame < 9; frame++) noteShaderWarmFrameMs(40);

    ready();
    expect(worker().ofKind('warm')).toHaveLength(1);
    expect(worker().ofKind('pause')).toHaveLength(0);
  });

  it('reads frames after the worker is gone without touching it', () => {
    const { worker, ready } = start();
    ready();
    const posted = worker().posted.length;
    disposeShaderWarm();
    for (let frame = 0; frame < 9; frame++) noteShaderWarmFrameMs(40);

    expect(worker().posted).toHaveLength(posted);
    expect(shaderWarmSnapshot().paused).toBe(true);
  });
});

describe('disposing the shader warm client', () => {
  it('terminates the worker without a word, and comes back idle', async () => {
    // The worker's context contract was this renderer's; the next
    // renderer's first gate spawns its own.
    const { worker, ready } = start();
    ready();
    const settled = warmShaderPrograms([SOURCE], GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    disposeShaderWarm();

    expect(await settled).toEqual(['failed']);
    expect(worker().kinds()).toEqual(['init', 'warm']);
    expect(worker().terminations).toBe(1);
    expect(shaderWarmSnapshot()).toMatchObject({
      worker: 'idle',
      refusal: null,
      adapter: '',
      armed: false,
      workerStats: null,
    });
  });

  it('starts the request book over: the counters and what was asked are the new renderer own', () => {
    const { worker, ready } = start();
    ready();
    warmShaderPrograms([SOURCE], GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    worker().emit({ kind: 'warmed', id: 1, linkMs: 7 });
    expect(shaderWarmSnapshot()).toMatchObject({ asked: 1, sent: 1, warmed: 1 });

    disposeShaderWarm();

    expect(shaderWarmSnapshot()).toMatchObject({
      asked: 0,
      sent: 0,
      warmed: 0,
      failed: 0,
      deduped: 0,
      held: 0,
      links: { count: 0, sumMs: 0, maxMs: 0 },
    });
  });

  it('asks the next worker again for a program the last one warmed', async () => {
    // The warmed programs went with the old worker's context, so a dedupe
    // across the dispose would leave the new renderer's gate waiting on an
    // id no worker will ever answer.
    const { workers, ready, context } = start();
    ready();
    const first = warmShaderPrograms([SOURCE], GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    workers[0].emit({ kind: 'warmed', id: 1, linkMs: 7 });
    expect(await first).toEqual(['warmed']);

    disposeShaderWarm();
    armShaderWarm();
    shaderWarmDecide(context, GPU_WORK_PRIORITY.VISIBLE_PREWARM, false);
    expect(workers).toHaveLength(2);
    const again = warmShaderPrograms([SOURCE], GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    workers[1].emit({ kind: 'ready', ok: true, reason: null, extensions: [], adapter: 'second' });

    expect(workers[1].ofKind('warm')[0].sources).toEqual([
      { id: 1, ...SOURCE, priority: GPU_WORK_PRIORITY.VISIBLE_PREWARM },
    ]);
    workers[1].emit({ kind: 'warmed', id: 1, linkMs: 7 });
    expect(await again).toEqual(['warmed']);
    expect(shaderWarmSnapshot()).toMatchObject({ asked: 1, sent: 1, deduped: 0 });
  });

  it('spawns a fresh worker for the next renderer', () => {
    const { context, workers } = start();
    disposeShaderWarm();
    armShaderWarm();
    const decision = shaderWarmDecide(context, GPU_WORK_PRIORITY.VISIBLE_PREWARM, false);

    expect(decision).toEqual({ hold: true });
    expect(workers).toHaveLength(2);
    expect(shaderWarmSnapshot().worker).toBe('starting');
  });

  /** Capture the page listeners the client installs, so a case can fire
   *  `pagehide` with (or without) the bfcache's `persisted` flag. */
  async function withPageListeners(
    run: (fire: (persisted?: boolean) => void) => void | Promise<void>,
  ): Promise<void> {
    const scope = globalThis as {
      addEventListener?: (type: string, cb: (event?: { persisted?: boolean }) => void) => void;
    };
    const original = scope.addEventListener;
    const listeners: Array<(event?: { persisted?: boolean }) => void> = [];
    scope.addEventListener = (
      type: string,
      callback: (event?: { persisted?: boolean }) => void,
    ) => {
      if (type === 'pagehide') listeners.push(callback);
    };
    try {
      await run((persisted?: boolean) => {
        expect(listeners).toHaveLength(1);
        for (const listener of listeners) {
          listener(persisted === undefined ? undefined : { persisted });
        }
      });
    } finally {
      scope.addEventListener = original;
    }
  }

  it('terminates the worker when the page goes away', async () => {
    // The worker holds one of the GPU process's handful of contexts, and it
    // lives in the worker, so the page's own release hook cannot reach it.
    await withPageListeners(async (firePagehide) => {
      const { worker, ready } = start();
      ready();
      const settled = warmShaderPrograms([SOURCE], GPU_WORK_PRIORITY.VISIBLE_PREWARM);

      firePagehide(false);

      expect(worker().terminations).toBe(1);
      expect(await settled).toEqual(['failed']);
    });
  });

  it('keeps the worker through a bfcache freeze, and holds nothing after a real teardown', async () => {
    // context_release.ts reads the same flag for the same reason: a page frozen
    // into the bfcache can come back, and startWorker only ever runs from
    // `idle`, so killing the worker on a persisted pagehide would leave the
    // session with no worker while availability still said yes.
    await withPageListeners((firePagehide) => {
      const { worker, workers, ready, context } = start();
      ready();

      firePagehide(true);
      expect(worker().terminations).toBe(0);
      expect(shaderWarmAvailable()).toBe(true);
      expect(shaderWarmSnapshot()).toMatchObject({ worker: 'ready' });

      // The real teardown retires it FOR CAUSE, so no later gate pays the dry
      // assembly for a worker that is gone: it bypasses as unavailable, and
      // nothing respawns a second context during the teardown.
      firePagehide(false);
      expect(worker().terminations).toBe(1);
      expect(shaderWarmAvailable()).toBe(false);
      expect(shaderWarmSnapshot()).toMatchObject({ worker: 'refused', refusal: 'pagehide' });

      const decision = shaderWarmDecide(context, GPU_WORK_PRIORITY.VISIBLE_PREWARM, false);
      expect(decision).toEqual({ hold: false, bypass: 'unavailable' });
      expect(shaderWarmSnapshot().bypassed.unavailable).toBe(1);
      expect(workers).toHaveLength(1);
    });
  });

  it('reads out the mode, the arm, the worker state and every counter', () => {
    const { ready } = start({ search: '?shaderwarm=all' });
    ready('Adapter 9000');

    expect(shaderWarmSnapshot()).toMatchObject({
      mode: 'all',
      armed: true,
      worker: 'ready',
      refusal: null,
      adapter: 'Adapter 9000',
      paused: false,
      asked: 0,
      sent: 0,
      held: 0,
      dryAssembleMs: 0,
      links: { count: 0, sumMs: 0, maxMs: 0 },
      bypassed: {
        'mode-off': 0,
        unavailable: 0,
        'before-reveal': 0,
        actionable: 0,
        'live-view': 0,
        imminent: 0,
        'piece-mismatch': 0,
        'nothing-to-warm': 0,
      },
    });
  });
});

describe('the auto setting follows the GPU backend', () => {
  const D3D11 =
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)';
  const OPENGL = 'ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3090/PCIe/SSE2, OpenGL 4.5.0)';
  function backendContext(renderer: string) {
    return {
      getContextAttributes: () => ({ antialias: false }),
      getExtension: (name: string) =>
        name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null,
      getParameter: (name: number) => (name === 0x9246 ? renderer : ''),
    };
  }

  it('is OFF until a context is seen, then the full policy on D3D11', () => {
    const worker = fakeWorker();
    resetShaderWarmForTest({ spawn: () => worker, search: '', stored: 'auto' });
    expect(shaderWarmSnapshot()).toMatchObject({ setting: 'auto', mode: 'off', backend: null });
    const decision = shaderWarmDecide(
      backendContext(D3D11),
      GPU_WORK_PRIORITY.VISIBLE_PREWARM,
      false,
    );
    expect(shaderWarmSnapshot()).toMatchObject({
      setting: 'auto',
      mode: 'all',
      backend: 'd3d11',
    });
    // Not armed yet: the first policy call still bypasses, but the worker
    // is starting for the arms to come.
    expect(decision).toEqual({ hold: false, bypass: 'before-reveal' });
    expect(shaderWarmAvailable()).toBe(true);
  });

  it('stays OFF on an OpenGL backend and never spawns the worker', () => {
    let spawned = 0;
    resetShaderWarmForTest({
      spawn: () => {
        spawned++;
        return fakeWorker();
      },
      search: '',
      stored: 'auto',
    });
    const decision = shaderWarmDecide(
      backendContext(OPENGL),
      GPU_WORK_PRIORITY.VISIBLE_PREWARM,
      false,
    );
    expect(decision).toEqual({ hold: false, bypass: 'mode-off' });
    expect(shaderWarmSnapshot()).toMatchObject({ setting: 'auto', mode: 'off', backend: 'opengl' });
    expect(spawned).toBe(0);
  });

  it('takes the stored graphics option, and lets the query pin an arm over it', () => {
    resetShaderWarmForTest({ spawn: () => fakeWorker(), search: '', stored: 'off' });
    shaderWarmDecide(backendContext(D3D11), GPU_WORK_PRIORITY.VISIBLE_PREWARM, false);
    expect(shaderWarmSnapshot()).toMatchObject({ setting: 'off', mode: 'off', backend: 'd3d11' });

    resetShaderWarmForTest({
      spawn: () => fakeWorker(),
      search: '?shaderwarm=reveal',
      stored: 'off',
    });
    shaderWarmDecide(backendContext(OPENGL), GPU_WORK_PRIORITY.VISIBLE_PREWARM, false);
    expect(shaderWarmSnapshot()).toMatchObject({
      setting: 'reveal',
      mode: 'reveal',
      backend: 'opengl',
    });
  });
});

describe('the backend class follows the renderer across rebuilds', () => {
  const D3D11 =
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)';
  const WARP = 'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)';
  function backendContext(renderer: string | null) {
    return {
      getContextAttributes: () => ({ antialias: false }),
      getExtension: (name: string) =>
        name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null,
      getParameter: (name: number) => (name === 0x9246 ? (renderer ?? '') : ''),
    };
  }

  it('reads again while the class is unknown, so one lost read never latches OFF', () => {
    resetShaderWarmForTest({ spawn: () => fakeWorker(), search: '', stored: 'auto' });
    shaderWarmDecide(backendContext(null), GPU_WORK_PRIORITY.VISIBLE_PREWARM, false);
    expect(shaderWarmSnapshot()).toMatchObject({ backend: 'unknown', mode: 'off' });
    shaderWarmDecide(backendContext(D3D11), GPU_WORK_PRIORITY.VISIBLE_PREWARM, false);
    expect(shaderWarmSnapshot()).toMatchObject({ backend: 'd3d11', mode: 'all' });
  });

  it('forgets the class on dispose, so a rebuilt renderer on software reads OFF', () => {
    resetShaderWarmForTest({ spawn: () => fakeWorker(), search: '', stored: 'auto' });
    shaderWarmDecide(backendContext(D3D11), GPU_WORK_PRIORITY.VISIBLE_PREWARM, false);
    expect(shaderWarmSnapshot()).toMatchObject({ backend: 'd3d11', mode: 'all' });
    disposeShaderWarm();
    expect(shaderWarmSnapshot()).toMatchObject({ backend: null, mode: 'off' });
    shaderWarmDecide(backendContext(WARP), GPU_WORK_PRIORITY.VISIBLE_PREWARM, false);
    expect(shaderWarmSnapshot()).toMatchObject({ backend: 'software', mode: 'off' });
  });
});

describe('a hold that gives up on its request', () => {
  it('tells the worker to drop the ids nobody else waits for', async () => {
    // The piece links cold now: a worker slot spent on it would warm a key
    // the game already holds. The program another gate still waits for
    // stays in the worker's queue.
    const { worker, ready } = start();
    ready();
    const hold = holdShaderPrograms([SOURCE, OTHER], GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    const shared = warmShaderPrograms([SOURCE], GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    expect(worker().ofKind('warm')).toHaveLength(1);

    hold.abandon();
    expect(worker().ofKind('cancel')).toEqual([{ kind: 'cancel', ids: [2] }]);

    worker().emit({ kind: 'failed', id: 2, reason: 'cancelled' });
    worker().emit({ kind: 'warmed', id: 1, linkMs: 9 });
    expect(await hold.settled).toEqual(['warmed', 'failed']);
    expect(await shared).toEqual(['warmed']);
    // A drop on the client's word is not a link the worker could not do.
    expect(shaderWarmSnapshot()).toMatchObject({ warmed: 1, failed: 0, cancelled: 1 });
    // Abandoning twice sends nothing more.
    hold.abandon();
    expect(worker().ofKind('cancel')).toHaveLength(1);
  });

  it('asks the worker again for text an abandoned hold gave up on', () => {
    const { worker, ready } = start();
    ready();
    const hold = holdShaderPrograms([SOURCE], GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    hold.abandon();
    worker().emit({ kind: 'failed', id: 1, reason: 'cancelled' });

    void warmShaderPrograms([SOURCE], GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    const warms = worker().ofKind('warm') as { sources: { id: number }[] }[];
    expect(warms).toHaveLength(2);
    expect(warms[1]?.sources.map((source) => source.id)).toEqual([2]);
    expect(shaderWarmSnapshot()).toMatchObject({ sent: 2, deduped: 0 });
  });

  it('does nothing against the next renderer worker: the book it was written in is gone', () => {
    // A renderer swap starts a new request book and a new worker whose ids
    // start over; a stale hold abandoning id 1 must not cancel the new
    // worker's id 1.
    const first = start();
    first.ready();
    const hold = holdShaderPrograms([SOURCE], GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    disposeShaderWarm();
    const second = start();
    second.ready();
    void warmShaderPrograms([OTHER], GPU_WORK_PRIORITY.VISIBLE_PREWARM);

    hold.abandon();
    expect(second.latest().ofKind('cancel')).toHaveLength(0);
  });

  it('drops the queued text and fails the wait when it gives up before the worker is ready', async () => {
    const { worker, ready } = start();
    const hold = holdShaderPrograms([SOURCE], GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    hold.abandon();
    expect(await hold.settled).toEqual(['failed']);

    ready();
    expect(worker().ofKind('warm')).toHaveLength(0);
    expect(worker().ofKind('cancel')).toHaveLength(0);
  });
});

describe('the registered stored-option source', () => {
  it('hands the corpus arm what the settings module registered, null by default', () => {
    expect(storedShaderWarmSetting()).toBeNull();
    setShaderWarmStoredSettingSource(() => 'off');
    expect(storedShaderWarmSetting()).toBe('off');
    setShaderWarmStoredSettingSource(() => null);
    expect(storedShaderWarmSetting()).toBeNull();
  });
});

describe('priority promotion', () => {
  it('posts a reprioritize for a pending program a higher-priority hold names again', () => {
    // A catalog held first at the prewarm priority; the live view naming the
    // same text must reach the worker's queue at ITS priority, not wait
    // behind the catalog until the hold cap.
    expect(GPU_WORK_PRIORITY.LIVE_VIEW).toBeGreaterThan(GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    const { ready, worker } = start({ search: '?shaderwarm=all' });
    ready();
    holdShaderPrograms([SOURCE], GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    holdShaderPrograms([SOURCE], GPU_WORK_PRIORITY.LIVE_VIEW);
    const w = worker();
    expect(w.ofKind('warm')).toHaveLength(1);
    expect(w.ofKind('reprioritize')).toEqual([
      { kind: 'reprioritize', updates: [{ id: 1, priority: GPU_WORK_PRIORITY.LIVE_VIEW }] },
    ]);
    // The same or a lower priority posts nothing more.
    holdShaderPrograms([SOURCE], GPU_WORK_PRIORITY.LIVE_VIEW);
    holdShaderPrograms([SOURCE], GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    expect(w.ofKind('reprioritize')).toHaveLength(1);
    expect(shaderWarmSnapshot().promoted).toBe(1);
  });

  it('carries the promotion on the copy still queued for a worker that is not ready', () => {
    const { ready, worker } = start({ search: '?shaderwarm=all' });
    holdShaderPrograms([SOURCE], GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    holdShaderPrograms([SOURCE], GPU_WORK_PRIORITY.LIVE_VIEW);
    const w = worker();
    expect(w.ofKind('reprioritize')).toEqual([]);
    ready();
    const flushed = w.ofKind('warm');
    expect(flushed).toHaveLength(1);
    expect((flushed[0].sources as Array<{ priority: number }>)[0].priority).toBe(
      GPU_WORK_PRIORITY.LIVE_VIEW,
    );
    expect(w.ofKind('reprioritize')).toEqual([]);
  });
});
