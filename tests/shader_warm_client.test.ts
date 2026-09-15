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
  noteShaderWarmExtensionDrift,
  noteShaderWarmFrameMs,
  noteShaderWarmHold,
  noteShaderWarmSettingChanged,
  resetShaderWarmForTest,
  SHADER_WARM_READY_DEADLINE_MS,
  setShaderWarmStoredSettingSource,
  shaderWarmAvailable,
  shaderWarmChoiceAvailable,
  shaderWarmDecide,
  shaderWarmSnapshot,
  storedShaderWarmSetting,
  warmShaderPrograms,
} from '../src/render/shader_warm_client';
import {
  SHADER_WARM_AB_REFUSAL,
  SHADER_WARM_EVIDENCE_LINKS,
  SHADER_WARM_EXPIRED_SHARE_BREAKER,
  SHADER_WARM_HOLD_WINDOW,
  SHADER_WARM_RELEASE_BREAKER,
  SHADER_WARM_TIMEOUT_BREAKER,
} from '../src/render/shader_warm_client_core';
import { SHADER_WARM_HOLD_CAP_MS } from '../src/render/shader_warm_gate';
import { SHADER_WARM_LANE_HOLD_CAP_MS } from '../src/render/shader_warm_lane';
import type { ShaderWarmWorkerMessage } from '../src/render/shader_warm_protocol';
import { SHADER_WARM_LINK_DEADLINE_MS } from '../src/render/shader_warm_worker_core';

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

  it('retires a worker that fails every held program, the way it retires one that expires them', () => {
    // The RTX 4060 Ti capture's shape: the worker's own link deadline (4 s) is
    // shorter than the hold cap (5 s), so a single-program hold never expires
    // on its cap; it ends on the worker's failure, warm nothing. Three of
    // those in a row are the same evidence as three expiries: a worker that
    // answers nothing. Before this, a failure RESET the streak and the client
    // paid the deadline on every hold for the life of the renderer.
    let clock = 0;
    const { worker, ready, context } = start({ now: () => clock });
    ready();

    // Each hold: the worker gives its one program up at the deadline, the
    // hold resolves failed, not expired.
    for (let failure = 1; failure < SHADER_WARM_TIMEOUT_BREAKER; failure++) {
      clock += 4_000;
      worker().emit({ kind: 'failed', id: failure, reason: 'link-deadline', linkMs: 4_000 });
      noteShaderWarmHold(false, false, 4_000);
      expect(shaderWarmSnapshot().worker).toBe('ready');
    }
    clock += 4_000;
    worker().emit({
      kind: 'failed',
      id: SHADER_WARM_TIMEOUT_BREAKER,
      reason: 'link-deadline',
      linkMs: 4_000,
    });
    noteShaderWarmHold(false, false, 4_000);
    expect(shaderWarmSnapshot()).toMatchObject({
      worker: 'dead',
      refusal: 'hold-failures:wedged',
      held: SHADER_WARM_TIMEOUT_BREAKER,
      heldWarm: 0,
      heldTimedOut: 0,
    });
    expect(worker().terminations).toBe(1);
    expect(shaderWarmDecide(context, GPU_WORK_PRIORITY.VISIBLE_PREWARM, false)).toEqual({
      hold: false,
      bypass: 'unavailable',
    });
  });

  it('counts an expiry and a worker failure toward the same streak, named by the last one', () => {
    // A multi-program hold expires on its cap, the next single-program hold
    // ends on the worker's deadline, the next expires again: three holds the
    // worker answered nothing through. The cause names how the LAST hold
    // ended, since a capture wants to know whether the cap or the worker's
    // own deadline is what the player paid.
    let clock = 0;
    const { worker, ready } = start({ now: () => clock });
    ready();
    clock += 5_000;
    noteShaderWarmHold(false, true, 5_000);
    clock += 4_000;
    worker().emit({ kind: 'failed', id: 1, reason: 'link-deadline', linkMs: 4_000 });
    noteShaderWarmHold(false, false, 4_000);
    expect(shaderWarmSnapshot().worker).toBe('ready');
    clock += 5_000;
    noteShaderWarmHold(false, true, 5_000);
    expect(shaderWarmSnapshot()).toMatchObject({
      worker: 'dead',
      refusal: 'hold-timeouts:wedged',
      heldTimedOut: 2,
    });
    expect(worker().terminations).toBe(1);

    // The other order: two expiries, then the deadline. Named by the LAST.
    resetShaderWarmForTest();
    clock = 0;
    const second = start({ now: () => clock });
    second.ready();
    clock += 5_000;
    noteShaderWarmHold(false, true, 5_000);
    clock += 5_000;
    noteShaderWarmHold(false, true, 5_000);
    clock += 4_000;
    second.worker().emit({ kind: 'failed', id: 1, reason: 'link-deadline', linkMs: 4_000 });
    noteShaderWarmHold(false, false, 4_000);
    expect(shaderWarmSnapshot()).toMatchObject({
      worker: 'dead',
      refusal: 'hold-failures:wedged',
      heldTimedOut: 2,
    });
  });

  it('keeps a worker that failed some held programs while delivering others', () => {
    // The healthy path, pinned on purpose: a worker that links most of what
    // it is asked and fails the odd program (a text its context rejects) is
    // not wedged. Every failure below has a warm inside its hold, and a hold
    // that came back warm clears the streak.
    let clock = 0;
    const { worker, ready } = start({ now: () => clock });
    ready();
    const deadline = (id: number): void => {
      clock += 4_000;
      worker().emit({ kind: 'failed', id, reason: 'link-deadline', linkMs: 4_000 });
    };
    for (let hold = 0; hold < 2 * SHADER_WARM_TIMEOUT_BREAKER; hold++) {
      deadline(hold);
      worker().emit({ kind: 'warmed', id: 99, linkMs: 400 });
      noteShaderWarmHold(false, false, 4_000);
    }
    deadline(10);
    noteShaderWarmHold(false, false, 4_000);
    deadline(11);
    noteShaderWarmHold(false, false, 4_000);
    noteShaderWarmHold(true, false, 400);
    deadline(12);
    noteShaderWarmHold(false, false, 4_000);
    deadline(13);
    noteShaderWarmHold(false, false, 4_000);
    expect(shaderWarmSnapshot()).toMatchObject({ worker: 'ready', refusal: null });
    expect(worker().terminations).toBe(0);
  });

  it('never counts a hold that ended on a fast rejection: one bad program is not a wedged worker', () => {
    // A text the worker's context refuses fails at once, and a later root
    // that shares it resolves at once on the same failed entry. Such holds
    // paid nothing and say nothing about the worker's speed; a worker that
    // links everything else is kept.
    let clock = 0;
    const { worker, ready } = start({ now: () => clock });
    ready();
    for (let hold = 0; hold < 2 * SHADER_WARM_TIMEOUT_BREAKER; hold++) {
      clock += 10;
      worker().emit({ kind: 'failed', id: hold, reason: 'link-failed' });
      noteShaderWarmHold(false, false, 5);
    }
    expect(shaderWarmSnapshot()).toMatchObject({ worker: 'ready', refusal: null, held: 6 });
    expect(worker().terminations).toBe(0);
  });

  it('never counts a hold against a worker that is not ready yet', () => {
    // A hold entered while the worker is still starting settles on the
    // client's side, or expires waiting for it; neither says anything about
    // the worker, and the ready deadline owns a worker that never answers.
    const { latest } = start();
    for (let hold = 0; hold < SHADER_WARM_TIMEOUT_BREAKER; hold++) {
      noteShaderWarmHold(false, false, 10);
    }
    for (let hold = 0; hold < SHADER_WARM_TIMEOUT_BREAKER; hold++) {
      noteShaderWarmHold(false, true, 5_000);
    }
    expect(shaderWarmSnapshot()).toMatchObject({ worker: 'starting', refusal: null });
    expect(latest().terminations).toBe(0);
  });

  it('pins that the worker link deadline is shorter than the hold caps', () => {
    // The premise of the failure arm: a single-program hold on a machine
    // whose links never settle ends on the deadline, never on the cap.
    // Invert these and the arm silently stops describing reality.
    expect(SHADER_WARM_LINK_DEADLINE_MS).toBeLessThan(SHADER_WARM_HOLD_CAP_MS);
    expect(SHADER_WARM_LINK_DEADLINE_MS).toBeLessThan(SHADER_WARM_LANE_HOLD_CAP_MS);
  });
});

describe('the cannot-serve rule: giving up on the worker own evidence', () => {
  // The RTX 4070 laptop's numbers: links about 560 ms each, the AIMD window
  // open to four, and a boot burst that queues dozens of programs behind the
  // hold that has waited longest. The two rules above only learn any of that
  // once holds have paid whole caps; this one reads it off the worker.
  const LINK_MS = 560;
  const HOLD_CAP_MS = 5_000;

  /** `count` distinct programs, the way a gate piece's materials arrive;
   *  `from` shifts the texts so a later burst asks for new programs. */
  function programs(count: number, from = 0) {
    return Array.from({ length: count }, (_, index) => ({
      vertex: `void main() { float u${from + index}; }`,
      fragment: 'void main() {}',
      index0Attribute: 'position',
    }));
  }

  function windowOfFour(worker: FakeWorker): void {
    worker.emit({
      kind: 'stats',
      pending: 28,
      inFlight: 4,
      windowLinks: 4,
      state: 'steady',
      warmed: 0,
      failed: 0,
      retained: 0,
      cancelled: 0,
      backoffCount: 0,
      maxWindowObserved: 4,
      etalonMsPerKchar: null,
      soloSamples: 2,
    });
  }

  /** The verdict ended this burst's held gates and kept the worker. */
  function expectReleased(releases = 1): void {
    expect(shaderWarmSnapshot()).toMatchObject({
      worker: 'ready',
      refusal: null,
      releases,
      standingDown: true,
    });
  }

  /** Every request the worker still owes settles warm: the queue drains. */
  function drain(worker: FakeWorker, fromId: number, toId: number): void {
    for (let id = fromId; id <= toId; id++) worker.emit({ kind: 'warmed', id, linkMs: LINK_MS });
  }

  it('releases the held gates once the queue ahead of the oldest hold outruns its remaining cap', async () => {
    let clock = 0;
    const { worker, ready, context } = start({ now: () => clock });
    ready();
    windowOfFour(worker());

    // One gate piece, 32 programs, holding its link under the gates' own cap.
    const hold = holdShaderPrograms(programs(32), GPU_WORK_PRIORITY.VISIBLE_PREWARM, HOLD_CAP_MS);

    // Two links in: not enough evidence to condemn the worker, even though
    // the arithmetic already says the hold is lost.
    for (let link = 1; link <= SHADER_WARM_EVIDENCE_LINKS - 1; link++) {
      clock += LINK_MS;
      worker().emit({ kind: 'warmed', id: link, linkMs: LINK_MS });
      expect(shaderWarmSnapshot().worker).toBe('ready');
    }

    // The third settle is the first with a mean to stand on: 29 unsettled
    // requests at 560 ms, four at a time, is 4060 ms of service for a hold
    // with 3320 ms of its cap left.
    clock += LINK_MS;
    worker().emit({
      kind: 'warmed',
      id: SHADER_WARM_EVIDENCE_LINKS,
      linkMs: LINK_MS,
    });

    expectReleased();
    expect(shaderWarmSnapshot()).toMatchObject({
      warmed: SHADER_WARM_EVIDENCE_LINKS,
      held: 0,
      // The whole point: nothing paid a cap to learn this.
      heldTimedOut: 0,
    });
    expect(worker().terminations).toBe(0);
    // The hold gives up now rather than at its cap: the three the worker did
    // link stay warm, everything else reads failed, so the piece links cold.
    const outcomes = await hold.settled;
    expect(outcomes.slice(0, SHADER_WARM_EVIDENCE_LINKS)).toEqual(
      Array.from({ length: SHADER_WARM_EVIDENCE_LINKS }, () => 'warmed'),
    );
    expect(outcomes.slice(SHADER_WARM_EVIDENCE_LINKS)).toEqual(
      Array.from({ length: 32 - SHADER_WARM_EVIDENCE_LINKS }, () => 'failed'),
    );
    // The released requests go back to the worker: the game context links
    // those programs now, and a second link of the same text in the worker's
    // context would only compete for the driver the verdict found too busy.
    expect(worker().ofKind('cancel')).toEqual([
      {
        kind: 'cancel',
        ids: Array.from(
          { length: 32 - SHADER_WARM_EVIDENCE_LINKS },
          (_, index) => SHADER_WARM_EVIDENCE_LINKS + 1 + index,
        ),
      },
    ]);
    // No gate holds until the worker has answered what it still owed.
    expect(shaderWarmDecide(context, GPU_WORK_PRIORITY.VISIBLE_PREWARM, false)).toEqual({
      hold: false,
      bypass: 'standing-down',
    });
  });

  it('keeps a released program another request still waits on', () => {
    // The shared-interest book decides what the worker may drop: a program a
    // background request also asked for stays in the worker's queue.
    let clock = 0;
    const { worker, ready } = start({ now: () => clock });
    ready();
    windowOfFour(worker());
    const shared = programs(32);
    warmShaderPrograms(shared.slice(31), GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    holdShaderPrograms(shared, GPU_WORK_PRIORITY.VISIBLE_PREWARM, HOLD_CAP_MS);
    for (let link = 1; link <= SHADER_WARM_EVIDENCE_LINKS; link++) {
      clock += LINK_MS;
      worker().emit({ kind: 'warmed', id: link + 1, linkMs: LINK_MS });
    }
    expectReleased();
    const cancelled = worker()
      .ofKind('cancel')
      .flatMap((message) => message.ids as number[]);
    // Id 1 is the program both asked for (the background request came first).
    expect(cancelled).not.toContain(1);
    expect(cancelled).toHaveLength(32 - SHADER_WARM_EVIDENCE_LINKS - 1);
  });

  it('retires a worker that goes silent while the gates stand down', () => {
    // Every link the worker runs answers by its own deadline, and it posts
    // stats while it works. Two deadlines without a single message after a
    // release mean it is not ticking; standing down would otherwise keep its
    // context for the page, with no hold left for any rule to judge.
    let clock = 0;
    const { worker, ready } = start({ now: () => clock });
    ready();
    windowOfFour(worker());
    holdShaderPrograms(programs(32), GPU_WORK_PRIORITY.VISIBLE_PREWARM, HOLD_CAP_MS);
    for (let link = 1; link <= SHADER_WARM_EVIDENCE_LINKS; link++) {
      clock += LINK_MS;
      worker().emit({ kind: 'warmed', id: link, linkMs: LINK_MS });
    }
    expectReleased();
    clock += 2 * SHADER_WARM_LINK_DEADLINE_MS - 1;
    noteShaderWarmFrameMs(16);
    expect(shaderWarmSnapshot()).toMatchObject({ worker: 'ready', standingDown: true });
    clock += 1;
    noteShaderWarmFrameMs(16);
    expect(shaderWarmSnapshot()).toMatchObject({
      worker: 'dead',
      refusal: 'standing-down:silent',
    });
    expect(worker().terminations).toBe(1);
  });

  it('keeps a standing-down worker that is still answering, however slowly', () => {
    let clock = 0;
    const { worker, ready } = start({ now: () => clock });
    ready();
    windowOfFour(worker());
    holdShaderPrograms(programs(32), GPU_WORK_PRIORITY.VISIBLE_PREWARM, HOLD_CAP_MS);
    for (let link = 1; link <= SHADER_WARM_EVIDENCE_LINKS; link++) {
      clock += LINK_MS;
      worker().emit({ kind: 'warmed', id: link, linkMs: LINK_MS });
    }
    expectReleased();
    // A link in flight gives up at the deadline: the worker is alive.
    clock += SHADER_WARM_LINK_DEADLINE_MS;
    worker().emit({ kind: 'failed', id: 4, reason: 'link-deadline', linkMs: 4_000 });
    clock += SHADER_WARM_LINK_DEADLINE_MS + 500;
    noteShaderWarmFrameMs(16);
    expect(shaderWarmSnapshot()).toMatchObject({ worker: 'ready', standingDown: true });
    expect(worker().terminations).toBe(0);
  });

  it('still retires as wedged when the hold that trips a release is the third unanswered expiry', () => {
    // A release exempts the holds IT ends early, not the evidence the burst
    // already left: the two holds before this one paid their whole caps.
    let clock = 0;
    const { worker, ready } = start({ now: () => clock });
    ready();
    windowOfFour(worker());
    warmShaderPrograms(programs(3, 100), GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    for (let id = 1; id <= SHADER_WARM_EVIDENCE_LINKS; id++) {
      clock += LINK_MS;
      worker().emit({ kind: 'warmed', id, linkMs: LINK_MS });
    }
    clock += 6_000;
    noteShaderWarmHold(false, true, 5_000);
    clock += 6_000;
    noteShaderWarmHold(false, true, 5_000);
    clock += 6_000;
    holdShaderPrograms(programs(32), GPU_WORK_PRIORITY.VISIBLE_PREWARM, HOLD_CAP_MS, clock - 1_000);
    noteShaderWarmHold(false, true, 5_000);
    expect(shaderWarmSnapshot()).toMatchObject({
      worker: 'dead',
      refusal: 'hold-timeouts:wedged',
      releases: 1,
    });
  });

  it('stands down only until the links already in flight answer', () => {
    // Once the worker has answered the cancel and settled what it was linking,
    // it owes nothing and gates hold again, one window of links later, not one
    // backlog later.
    let clock = 0;
    const { worker, ready, context } = start({ now: () => clock });
    ready();
    windowOfFour(worker());
    holdShaderPrograms(programs(32), GPU_WORK_PRIORITY.VISIBLE_PREWARM, HOLD_CAP_MS);
    for (let link = 1; link <= SHADER_WARM_EVIDENCE_LINKS; link++) {
      clock += LINK_MS;
      worker().emit({ kind: 'warmed', id: link, linkMs: LINK_MS });
    }
    expectReleased();
    // The worker drops what it had not started and answers each as cancelled.
    for (let id = 8; id <= 32; id++) worker().emit({ kind: 'failed', id, reason: 'cancelled' });
    expect(shaderWarmSnapshot().standingDown).toBe(true);
    // The four links it was already running settle.
    for (let id = 4; id <= 7; id++) worker().emit({ kind: 'warmed', id, linkMs: LINK_MS });
    expect(shaderWarmSnapshot()).toMatchObject({ standingDown: false, cancelled: 25 });
    expect(shaderWarmDecide(context, GPU_WORK_PRIORITY.VISIBLE_PREWARM, false)).toEqual({
      hold: true,
    });
  });

  it('counts one release per burst, however many messages find the queue too long', () => {
    // The rule runs on every worker message. Once a release has emptied the
    // held gates there is nothing left to judge, so the rest of the burst's
    // messages must not count again: a change that evaluates before the
    // outstanding set is emptied would retire the worker in one burst.
    let clock = 0;
    const { worker, ready } = start({ now: () => clock });
    ready();
    windowOfFour(worker());
    holdShaderPrograms(programs(32), GPU_WORK_PRIORITY.VISIBLE_PREWARM, HOLD_CAP_MS);
    for (let link = 1; link <= 10; link++) {
      clock += LINK_MS;
      worker().emit({ kind: 'warmed', id: link, linkMs: LINK_MS });
    }
    expectReleased(1);
    expect(worker().terminations).toBe(0);
  });

  it('holds again once the worker has drained what it owed', () => {
    let clock = 0;
    const { worker, ready, context } = start({ now: () => clock });
    ready();
    windowOfFour(worker());
    holdShaderPrograms(programs(32), GPU_WORK_PRIORITY.VISIBLE_PREWARM, HOLD_CAP_MS);
    for (let link = 1; link <= SHADER_WARM_EVIDENCE_LINKS; link++) {
      clock += LINK_MS;
      worker().emit({ kind: 'warmed', id: link, linkMs: LINK_MS });
    }
    expectReleased();
    // One request still owed keeps the gates standing down.
    drain(worker(), SHADER_WARM_EVIDENCE_LINKS + 1, 31);
    expect(shaderWarmDecide(context, GPU_WORK_PRIORITY.VISIBLE_PREWARM, false)).toEqual({
      hold: false,
      bypass: 'standing-down',
    });
    worker().emit({ kind: 'failed', id: 32, reason: 'link-failed' });
    expect(shaderWarmSnapshot()).toMatchObject({
      worker: 'ready',
      standingDown: false,
      releases: 1,
    });
    expect(shaderWarmDecide(context, GPU_WORK_PRIORITY.VISIBLE_PREWARM, false)).toEqual({
      hold: true,
    });
  });

  it('retires only when the verdict repeats burst after burst', () => {
    let clock = 0;
    const { worker, ready, context } = start({ now: () => clock });
    ready();
    windowOfFour(worker());
    for (let burst = 0; burst < SHADER_WARM_RELEASE_BREAKER; burst++) {
      const firstId = burst * 32 + 1;
      holdShaderPrograms(programs(32, burst * 32), GPU_WORK_PRIORITY.VISIBLE_PREWARM, HOLD_CAP_MS);
      for (let link = firstId; link < firstId + SHADER_WARM_EVIDENCE_LINKS; link++) {
        clock += LINK_MS;
        worker().emit({ kind: 'warmed', id: link, linkMs: LINK_MS });
      }
      if (burst === SHADER_WARM_RELEASE_BREAKER - 1) break;
      expectReleased(burst + 1);
      drain(worker(), firstId, firstId + 31);
      expect(shaderWarmSnapshot().standingDown).toBe(false);
    }
    expect(shaderWarmSnapshot()).toMatchObject({
      worker: 'dead',
      refusal: 'cannot-serve:hold-cap',
      releases: SHADER_WARM_RELEASE_BREAKER,
    });
    expect(worker().terminations).toBe(1);
    expect(shaderWarmDecide(context, GPU_WORK_PRIORITY.VISIBLE_PREWARM, false)).toEqual({
      hold: false,
      bypass: 'unavailable',
    });
  });

  it('never counts a released hold toward the wedged streak, even with a deadline inside it', () => {
    // Released on censored evidence alone: no warm lands inside these holds and
    // a link deadline does, so nothing but the released flag keeps three
    // not-warm notes from retiring the worker as hold-failures:wedged.
    const DEADLINE_MS = 4_000;
    const run = (released: boolean) => {
      let clock = 0;
      const { worker, ready } = start({ now: () => clock });
      ready();
      windowOfFour(worker());
      holdShaderPrograms(programs(32), GPU_WORK_PRIORITY.VISIBLE_PREWARM, HOLD_CAP_MS);
      clock += DEADLINE_MS;
      for (let link = 1; link <= SHADER_WARM_EVIDENCE_LINKS; link++) {
        worker().emit({ kind: 'failed', id: link, reason: 'link-deadline', linkMs: DEADLINE_MS });
      }
      expectReleased();
      for (let gate = 0; gate < SHADER_WARM_TIMEOUT_BREAKER; gate++) {
        noteShaderWarmHold(false, false, clock, released);
      }
      return shaderWarmSnapshot();
    };
    expect(run(true)).toMatchObject({
      worker: 'ready',
      heldReleased: SHADER_WARM_TIMEOUT_BREAKER,
      heldTimedOut: 0,
    });
    // The same notes without the flag are exactly what the streak is for.
    expect(run(false)).toMatchObject({
      worker: 'dead',
      refusal: 'hold-failures:wedged',
      heldReleased: 0,
    });
  });

  it('counts a released hold that came back warm as an ordinary warm hold', () => {
    const { ready } = start();
    ready();
    noteShaderWarmHold(true, false, 100, true);
    expect(shaderWarmSnapshot()).toMatchObject({ held: 1, heldWarm: 1, heldReleased: 0 });
  });

  it('refuses a hold asked while standing down, so one burst never releases twice', async () => {
    // A gate decides before its assembly unit runs: it can ask for a hold
    // after the release although its decision said hold. Opened, that hold
    // would queue behind the backlog the release gave up on and release the
    // same burst again, twice more, which retires the worker.
    let clock = 0;
    const { worker, ready } = start({ now: () => clock });
    ready();
    windowOfFour(worker());
    holdShaderPrograms(programs(32), GPU_WORK_PRIORITY.VISIBLE_PREWARM, HOLD_CAP_MS);
    for (let link = 1; link <= SHADER_WARM_EVIDENCE_LINKS; link++) {
      clock += LINK_MS;
      worker().emit({ kind: 'warmed', id: link, linkMs: LINK_MS });
    }
    expectReleased();
    const sentBefore = worker().ofKind('warm').length;

    const late = holdShaderPrograms(
      programs(12, 32),
      GPU_WORK_PRIORITY.VISIBLE_PREWARM,
      HOLD_CAP_MS,
    );
    expect(late.wasReleased()).toBe(true);
    expect(await late.settled).toEqual(Array.from({ length: 12 }, () => 'failed'));
    expect(worker().ofKind('warm')).toHaveLength(sentBefore);
    for (let link = SHADER_WARM_EVIDENCE_LINKS + 1; link <= 13; link++) {
      clock += LINK_MS;
      worker().emit({ kind: 'warmed', id: link, linkMs: LINK_MS });
    }
    noteShaderWarmHold(false, false, 0, late.wasReleased());
    expectReleased(1);
    expect(shaderWarmSnapshot()).toMatchObject({ heldReleased: 1 });
    expect(worker().terminations).toBe(0);
  });

  it('keeps the hold wall time and the releases for the page across a renderer rebuild', () => {
    // The long-task total the A/B weighs them against lasts the page, so the
    // two cost terms must too.
    let clock = 0;
    const { worker, ready } = start({ now: () => clock });
    ready();
    windowOfFour(worker());
    holdShaderPrograms(programs(32), GPU_WORK_PRIORITY.VISIBLE_PREWARM, HOLD_CAP_MS);
    for (let link = 1; link <= SHADER_WARM_EVIDENCE_LINKS; link++) {
      clock += LINK_MS;
      worker().emit({ kind: 'warmed', id: link, linkMs: LINK_MS });
    }
    expectReleased();
    clock += 1_000;
    expect(shaderWarmSnapshot().holdWallMs).toBe(SHADER_WARM_EVIDENCE_LINKS * LINK_MS);
    disposeShaderWarm();
    expect(shaderWarmSnapshot()).toMatchObject({
      releases: 1,
      holdWallMs: SHADER_WARM_EVIDENCE_LINKS * LINK_MS,
    });
  });

  it('releases the RTX 3060 cold entry burst instead of retiring the worker', async () => {
    // A reconstruction of the shape the 2026-09-12 run left in its readout
    // (not a replay: that run kept one line taken after the verdict). The
    // window had reached three, six links settled at about 384 ms, one
    // program was rejected and the worker of the time halved its window to
    // one for it, with the entry burst still queued. Divided by one, the
    // queue read as ten seconds against a five second cap and the worker was
    // retired for a session that, on the next launch, warmed 174 programs.
    const ENTRY_LINK_MS = 384;
    let clock = 0;
    const { worker, ready } = start({ now: () => clock });
    ready();
    const stats = (windowLinks: number, state: string) =>
      worker().emit({
        kind: 'stats',
        pending: 26,
        inFlight: 2,
        windowLinks,
        state,
        warmed: 6,
        failed: state === 'backoff' ? 1 : 0,
        retained: 0,
        cancelled: 0,
        backoffCount: state === 'backoff' ? 1 : 0,
        maxWindowObserved: 3,
        etalonMsPerKchar: 4.5,
        soloSamples: 2,
      });
    stats(3, 'ramp');
    const burst = holdShaderPrograms(programs(34), GPU_WORK_PRIORITY.LIVE_VIEW, HOLD_CAP_MS);
    // Three links at a time: each settle lands a third of a link's wall later.
    for (let link = 1; link <= 6; link++) {
      clock += ENTRY_LINK_MS / 3;
      worker().emit({ kind: 'warmed', id: link, linkMs: ENTRY_LINK_MS });
    }
    worker().emit({ kind: 'failed', id: 7, reason: 'link-failed' });
    // Priced at the window of three, the same queue fits what is left of the cap.
    expect(shaderWarmSnapshot()).toMatchObject({ releases: 0, standingDown: false });
    stats(1, 'backoff');
    clock += ENTRY_LINK_MS / 3;
    worker().emit({ kind: 'warmed', id: 8, linkMs: ENTRY_LINK_MS });

    expectReleased();
    expect(worker().terminations).toBe(0);
    expect((await burst.settled).filter((outcome) => outcome === 'warmed')).toHaveLength(7);
    // The rejected program is named, so the next run can say whether the game
    // links it (a dry assembly mismatch) or nothing can.
    expect(shaderWarmSnapshot().failedPrograms).toEqual([
      { hash: expect.stringMatching(/\|position$/), reason: 'link-failed' },
    ]);
  });

  it('keeps a worker whose links are ten times shorter, on the same queue', () => {
    // The RTX 3060 desktop shape. Nothing here is a millisecond bound: the
    // same arithmetic that condemned the laptop leaves this one alone.
    let clock = 0;
    const { worker, ready } = start({ now: () => clock });
    ready();
    windowOfFour(worker());
    holdShaderPrograms(programs(32), GPU_WORK_PRIORITY.VISIBLE_PREWARM, HOLD_CAP_MS);

    for (let link = 1; link <= 8; link++) {
      clock += 50;
      worker().emit({ kind: 'warmed', id: link, linkMs: 50 });
    }
    expect(shaderWarmSnapshot()).toMatchObject({ worker: 'ready', warmed: 8, refusal: null });
    expect(worker().terminations).toBe(0);
  });

  it('keeps a worker whose queue fits the hold cap, at the very same wall', () => {
    // Four programs at 560 ms over a window of four is one link's wall: the
    // hold is served, so a slow worker that is not overloaded is kept.
    let clock = 0;
    const { worker, ready } = start({ now: () => clock });
    ready();
    windowOfFour(worker());
    holdShaderPrograms(programs(4), GPU_WORK_PRIORITY.VISIBLE_PREWARM, HOLD_CAP_MS);

    for (let link = 1; link <= SHADER_WARM_EVIDENCE_LINKS; link++) {
      clock += LINK_MS;
      worker().emit({ kind: 'warmed', id: link, linkMs: LINK_MS });
    }
    expect(shaderWarmSnapshot()).toMatchObject({ worker: 'ready', warmed: 3 });
  });

  it('reads a deadline failure as a censored link, and releases on three with nothing settled', async () => {
    // The RTX 4060 Ti capture: no link ever settles, so `links.count` stays
    // zero and the rule was blind on exactly the machine it would help most.
    // A link the worker gave up on at its deadline ran AT LEAST that long,
    // and a lower bound is enough for a rule that asks whether the queue
    // still fits the remaining cap.
    const DEADLINE_MS = 4_000;
    let clock = 0;
    const { worker, ready, context } = start({ now: () => clock });
    ready();
    windowOfFour(worker());
    const hold = holdShaderPrograms(programs(32), GPU_WORK_PRIORITY.VISIBLE_PREWARM, HOLD_CAP_MS);

    // Four links in flight give up together at the deadline.
    clock += DEADLINE_MS;
    for (let link = 1; link <= SHADER_WARM_EVIDENCE_LINKS - 1; link++) {
      worker().emit({ kind: 'failed', id: link, reason: 'link-deadline', linkMs: DEADLINE_MS });
      expect(shaderWarmSnapshot().worker).toBe('ready');
    }
    worker().emit({
      kind: 'failed',
      id: SHADER_WARM_EVIDENCE_LINKS,
      reason: 'link-deadline',
      linkMs: DEADLINE_MS,
    });

    expectReleased();
    expect(shaderWarmSnapshot()).toMatchObject({
      warmed: 0,
      failed: SHADER_WARM_EVIDENCE_LINKS,
      links: { count: 0, sumMs: 0, maxMs: 0 },
      censoredLinks: {
        count: SHADER_WARM_EVIDENCE_LINKS,
        sumMs: SHADER_WARM_EVIDENCE_LINKS * DEADLINE_MS,
        maxMs: DEADLINE_MS,
      },
      heldTimedOut: 0,
    });
    expect(worker().terminations).toBe(0);
    expect(await hold.settled).toEqual(Array.from({ length: 32 }, () => 'failed'));
    expect(shaderWarmDecide(context, GPU_WORK_PRIORITY.VISIBLE_PREWARM, false)).toEqual({
      hold: false,
      bypass: 'standing-down',
    });
  });

  it('names a retirement on censored evidence apart from the settled baseline', () => {
    // The censored arm names itself: the fleet must tell it from the
    // settled-evidence baseline.
    const DEADLINE_MS = 4_000;
    let clock = 0;
    const { worker, ready } = start({ now: () => clock });
    ready();
    windowOfFour(worker());
    for (let burst = 0; burst < SHADER_WARM_RELEASE_BREAKER; burst++) {
      const firstId = burst * 32 + 1;
      holdShaderPrograms(programs(32, burst * 32), GPU_WORK_PRIORITY.VISIBLE_PREWARM, HOLD_CAP_MS);
      clock += DEADLINE_MS;
      for (let link = firstId; link < firstId + SHADER_WARM_EVIDENCE_LINKS; link++) {
        worker().emit({ kind: 'failed', id: link, reason: 'link-deadline', linkMs: DEADLINE_MS });
      }
      if (burst === SHADER_WARM_RELEASE_BREAKER - 1) break;
      for (let id = firstId + SHADER_WARM_EVIDENCE_LINKS; id <= firstId + 31; id++) {
        worker().emit({ kind: 'failed', id, reason: 'link-deadline', linkMs: DEADLINE_MS });
      }
      expect(shaderWarmSnapshot()).toMatchObject({ releases: burst + 1, standingDown: false });
    }
    expect(shaderWarmSnapshot()).toMatchObject({
      worker: 'dead',
      refusal: 'cannot-serve:hold-cap:censored',
      links: { count: 0, sumMs: 0, maxMs: 0 },
    });
  });

  it('judges on the settled links once three exist, whatever the deadlines say', () => {
    // The healthy path, pinned on purpose: a worker that links in 50 ms and
    // had three links throttled past the deadline (a background tab) is
    // judged on the links it settled, exactly as before. Censored samples
    // never mix into a mean that has real evidence to stand on.
    let clock = 0;
    const { worker, ready } = start({ now: () => clock });
    ready();
    windowOfFour(worker());
    holdShaderPrograms(programs(32), GPU_WORK_PRIORITY.VISIBLE_PREWARM, HOLD_CAP_MS);
    for (let link = 1; link <= SHADER_WARM_EVIDENCE_LINKS; link++) {
      clock += 50;
      worker().emit({ kind: 'warmed', id: link, linkMs: 50 });
    }
    clock = 4_000;
    for (let link = 4; link <= 3 + SHADER_WARM_EVIDENCE_LINKS; link++) {
      worker().emit({ kind: 'failed', id: link, reason: 'link-deadline', linkMs: 4_000 });
    }
    expect(shaderWarmSnapshot()).toMatchObject({
      worker: 'ready',
      refusal: null,
      warmed: 3,
      censoredLinks: { count: SHADER_WARM_EVIDENCE_LINKS, sumMs: 12_000, maxMs: 4_000 },
    });
    expect(worker().terminations).toBe(0);
  });

  it('books a censored sample once per request, never for a give-up nobody waited on', () => {
    // A duplicate deadline for an id already settled, or one with no wall
    // on it, books nothing: the evidence is one lower bound per link.
    let clock = 0;
    const { worker, ready } = start({ now: () => clock });
    ready();
    windowOfFour(worker());
    holdShaderPrograms(programs(4), GPU_WORK_PRIORITY.VISIBLE_PREWARM, HOLD_CAP_MS);
    clock += 4_000;
    worker().emit({ kind: 'failed', id: 1, reason: 'link-deadline', linkMs: 4_000 });
    worker().emit({ kind: 'failed', id: 1, reason: 'link-deadline', linkMs: 4_000 });
    worker().emit({ kind: 'failed', id: 2, reason: 'link-deadline' });
    expect(shaderWarmSnapshot()).toMatchObject({
      worker: 'ready',
      censoredLinks: { count: 1, sumMs: 4_000, maxMs: 4_000 },
    });
  });

  it('never reads a genuine link failure as a censored sample', () => {
    // A program the worker's context rejects fails fast and says nothing
    // about link speed; only the deadline carries a wall, and a wall on any
    // other reason is ignored (the reason is the discriminator).
    let clock = 0;
    const { worker, ready } = start({ now: () => clock });
    ready();
    windowOfFour(worker());
    holdShaderPrograms(programs(32), GPU_WORK_PRIORITY.VISIBLE_PREWARM, HOLD_CAP_MS);
    clock += 100;
    for (let link = 1; link <= SHADER_WARM_EVIDENCE_LINKS; link++) {
      worker().emit({ kind: 'failed', id: link, reason: 'link-failed', linkMs: 4_000 });
    }
    expect(shaderWarmSnapshot()).toMatchObject({
      worker: 'ready',
      failed: 3,
      censoredLinks: { count: 0, sumMs: 0, maxMs: 0 },
    });
  });

  it('judges the oldest hold, and forgets a hold that gave up', () => {
    // A request nobody holds a link for (warmShaderPrograms) is not a hold and
    // never condemns the worker: the rule is about a reveal waiting, not about
    // background warming.
    let clock = 0;
    const { worker, ready } = start({ now: () => clock });
    ready();
    windowOfFour(worker());
    warmShaderPrograms(programs(32), GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    for (let link = 1; link <= SHADER_WARM_EVIDENCE_LINKS; link++) {
      clock += LINK_MS;
      worker().emit({ kind: 'warmed', id: link, linkMs: LINK_MS });
    }
    expect(shaderWarmSnapshot().worker).toBe('ready');

    // A hold that abandons its request stops being measured with it.
    const abandoned = holdShaderPrograms(
      programs(48).slice(32),
      GPU_WORK_PRIORITY.VISIBLE_PREWARM,
      HOLD_CAP_MS,
    );
    abandoned.abandon();
    clock += LINK_MS;
    worker().emit({ kind: 'warmed', id: 4, linkMs: LINK_MS });
    expect(shaderWarmSnapshot()).toMatchObject({ worker: 'ready', refusal: null });
  });

  it('does not charge a live view for the cosmetic backlog the worker serves after it', () => {
    // The worker takes priority first and arrival second, so a live view that
    // arrives behind a whole catalog is served BEFORE it. Counting the queue
    // by id alone charged this hold for 32 links it never waits on and
    // retired a worker that was about to serve it in one window.
    let clock = 0;
    const { worker, ready } = start({ now: () => clock });
    ready();
    windowOfFour(worker());
    warmShaderPrograms(programs(32), GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    holdShaderPrograms(programs(36).slice(32), GPU_WORK_PRIORITY.LIVE_VIEW, HOLD_CAP_MS);

    for (let link = 1; link <= SHADER_WARM_EVIDENCE_LINKS; link++) {
      clock += LINK_MS;
      worker().emit({ kind: 'warmed', id: link, linkMs: LINK_MS });
    }
    // Four programs of its own, four at a time: one link's wall against
    // 3320 ms of cap left.
    expect(shaderWarmSnapshot()).toMatchObject({ worker: 'ready', refusal: null });
    expect(worker().terminations).toBe(0);
  });

  it('charges a cosmetic hold for the live views that arrive after it', () => {
    // The mirror, and why the id compare is not merely conservative: these
    // requests arrive LATER than the hold's own and the worker still serves
    // every one of them first, so this hold really is lost.
    let clock = 0;
    const { worker, ready } = start({ now: () => clock });
    ready();
    windowOfFour(worker());
    holdShaderPrograms(programs(4), GPU_WORK_PRIORITY.VISIBLE_PREWARM, HOLD_CAP_MS);
    warmShaderPrograms(programs(36).slice(4), GPU_WORK_PRIORITY.LIVE_VIEW);

    for (let link = 1; link <= SHADER_WARM_EVIDENCE_LINKS; link++) {
      clock += LINK_MS;
      worker().emit({ kind: 'warmed', id: link, linkMs: LINK_MS });
    }
    expectReleased();
    expect(shaderWarmSnapshot().heldTimedOut).toBe(0);
  });

  it('judges nothing until the worker first stats message says how wide its window is', () => {
    // The window is the divisor: reading a worker
    // that links four at a time as one at a time condemns it four times too
    // fast, over the few hundred milliseconds before its first poll lands.
    let clock = 0;
    const { worker, ready } = start({ now: () => clock });
    ready();
    holdShaderPrograms(programs(32), GPU_WORK_PRIORITY.VISIBLE_PREWARM, HOLD_CAP_MS);
    for (let link = 1; link <= SHADER_WARM_EVIDENCE_LINKS; link++) {
      clock += LINK_MS;
      worker().emit({ kind: 'warmed', id: link, linkMs: LINK_MS });
    }
    expect(shaderWarmSnapshot()).toMatchObject({
      worker: 'ready',
      refusal: null,
      warmed: SHADER_WARM_EVIDENCE_LINKS,
    });

    // The message lands, and the next thing the client learns is judged.
    windowOfFour(worker());
    clock += LINK_MS;
    worker().emit({ kind: 'warmed', id: SHADER_WARM_EVIDENCE_LINKS + 1, linkMs: LINK_MS });
    expectReleased();
  });

  it('reads the rule at a hold note too, before the two expiry rules', () => {
    // The holds a gate notes are the other moment the client learns anything:
    // one expiry is not the expired-share rule's four, and the wedged rule
    // needs three in a row, but the worker's own wall already says the next
    // hold cannot be served either.
    let clock = 0;
    const { worker, ready } = start({ now: () => clock });
    ready();
    windowOfFour(worker());
    holdShaderPrograms(programs(32), GPU_WORK_PRIORITY.VISIBLE_PREWARM, HOLD_CAP_MS);
    for (let link = 1; link <= SHADER_WARM_EVIDENCE_LINKS; link++) {
      worker().emit({ kind: 'warmed', id: link, linkMs: LINK_MS });
    }
    // The settles above all landed on the same instant, so nothing has waited
    // yet; the hold note is where the wait is read.
    expect(shaderWarmSnapshot().worker).toBe('ready');

    clock += 2_000;
    noteShaderWarmHold(true, false, 400);
    expectReleased();
    expect(shaderWarmSnapshot()).toMatchObject({ held: 1, heldTimedOut: 0, heldReleased: 0 });
  });

  it('stays retired across the player switching the row off and back on', () => {
    // Same stickiness as the other causes: the reason is a property of this
    // renderer's worker, not of the setting.
    let clock = 0;
    let stored = 'all';
    setShaderWarmStoredSettingSource(() => stored);
    try {
      const { worker, ready } = start({ search: '', now: () => clock });
      ready();
      windowOfFour(worker());
      for (let burst = 0; burst < SHADER_WARM_RELEASE_BREAKER; burst++) {
        const firstId = burst * 32 + 1;
        holdShaderPrograms(
          programs(32, burst * 32),
          GPU_WORK_PRIORITY.VISIBLE_PREWARM,
          HOLD_CAP_MS,
        );
        for (let link = firstId; link < firstId + SHADER_WARM_EVIDENCE_LINKS; link++) {
          clock += LINK_MS;
          worker().emit({ kind: 'warmed', id: link, linkMs: LINK_MS });
        }
        if (burst < SHADER_WARM_RELEASE_BREAKER - 1) drain(worker(), firstId, firstId + 31);
      }
      expect(shaderWarmSnapshot().refusal).toBe('cannot-serve:hold-cap');

      stored = 'off';
      noteShaderWarmSettingChanged();
      stored = 'all';
      noteShaderWarmSettingChanged();
      expect(shaderWarmSnapshot()).toMatchObject({
        worker: 'dead',
        refusal: 'cannot-serve:hold-cap',
      });
    } finally {
      setShaderWarmStoredSettingSource(() => null);
    }
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

  it('reads out the mode, the worker state and every counter', () => {
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
      heldReleased: 0,
      dryAssembleMs: 0,
      links: { count: 0, sumMs: 0, maxMs: 0 },
      censoredLinks: { count: 0, sumMs: 0, maxMs: 0 },
      failedPrograms: [],
      holdWallMs: 0,
      releases: 0,
      standingDown: false,
      abArm: null,
      bypassed: {
        'mode-off': 0,
        unavailable: 0,
        'standing-down': 0,
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

describe('the A/B arm on D3D11 (one release, removed by the decision PR)', () => {
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

  /** A browser profile's storage, as the client reads and writes it. */
  function profileStore(initial: string | null = null) {
    const store = {
      value: initial,
      writes: 0,
      get: () => store.value,
      set: (value: string) => {
        store.writes++;
        store.value = value;
      },
    };
    return store;
  }

  function spawnCounter() {
    const counter = {
      spawned: 0,
      spawn: () => {
        counter.spawned++;
        return fakeWorker();
      },
    };
    return counter;
  }

  it('puts a profile drawn off on the pre-worker path and names the arm as the refusal', () => {
    const store = profileStore();
    const counter = spawnCounter();
    resetShaderWarmForTest({
      spawn: counter.spawn,
      search: '',
      stored: 'auto',
      abStore: store,
      random: () => 0.2,
    });
    const decision = shaderWarmDecide(
      backendContext(D3D11),
      GPU_WORK_PRIORITY.VISIBLE_PREWARM,
      false,
    );
    expect(decision).toEqual({ hold: false, bypass: 'mode-off' });
    expect(counter.spawned).toBe(0);
    expect(store.value).toBe('off');
    expect(shaderWarmSnapshot()).toMatchObject({
      setting: 'auto',
      mode: 'off',
      backend: 'd3d11',
      worker: 'idle',
      abArm: 'off',
      refusal: SHADER_WARM_AB_REFUSAL,
    });
  });

  it('keeps the worker for a profile drawn on, with no refusal', () => {
    const store = profileStore();
    const counter = spawnCounter();
    resetShaderWarmForTest({
      spawn: counter.spawn,
      search: '',
      stored: 'auto',
      abStore: store,
      random: () => 0.7,
    });
    shaderWarmDecide(backendContext(D3D11), GPU_WORK_PRIORITY.VISIBLE_PREWARM, false);
    expect(counter.spawned).toBe(1);
    expect(store.value).toBe('on');
    expect(shaderWarmSnapshot()).toMatchObject({ mode: 'all', abArm: 'on', refusal: null });
  });

  it('reads the stored arm on a later launch without drawing again', () => {
    const store = profileStore('off');
    resetShaderWarmForTest({
      spawn: () => fakeWorker(),
      search: '',
      stored: 'auto',
      abStore: store,
      random: () => {
        throw new Error('drew again');
      },
    });
    shaderWarmDecide(backendContext(D3D11), GPU_WORK_PRIORITY.VISIBLE_PREWARM, false);
    expect(store.writes).toBe(0);
    expect(shaderWarmSnapshot()).toMatchObject({ mode: 'off', abArm: 'off' });
  });

  it('never draws for an explicit setting or a backend auto leaves off', () => {
    const explicit = profileStore('off');
    resetShaderWarmForTest({
      spawn: () => fakeWorker(),
      search: '?shaderwarm=all',
      stored: 'auto',
      abStore: explicit,
      random: () => 0.2,
    });
    shaderWarmDecide(backendContext(D3D11), GPU_WORK_PRIORITY.VISIBLE_PREWARM, false);
    expect(shaderWarmSnapshot()).toMatchObject({ mode: 'all', abArm: null, refusal: null });
    expect(explicit.writes).toBe(0);

    const opengl = profileStore();
    resetShaderWarmForTest({
      spawn: () => fakeWorker(),
      search: '',
      stored: 'auto',
      abStore: opengl,
      random: () => 0.2,
    });
    shaderWarmDecide(backendContext(OPENGL), GPU_WORK_PRIORITY.VISIBLE_PREWARM, false);
    expect(shaderWarmSnapshot()).toMatchObject({ mode: 'off', abArm: null, refusal: null });
    expect(opengl.writes).toBe(0);
  });

  it('follows the player out of the experiment and back into the stored arm', () => {
    let stored = 'auto';
    setShaderWarmStoredSettingSource(() => stored);
    try {
      const store = profileStore();
      const counter = spawnCounter();
      resetShaderWarmForTest({
        spawn: counter.spawn,
        search: '',
        abStore: store,
        random: () => 0.2,
      });
      shaderWarmDecide(backendContext(D3D11), GPU_WORK_PRIORITY.VISIBLE_PREWARM, false);
      expect(shaderWarmSnapshot()).toMatchObject({ abArm: 'off', refusal: SHADER_WARM_AB_REFUSAL });

      // An explicit On leaves the experiment: the arm no longer applies.
      stored = 'all';
      noteShaderWarmSettingChanged();
      expect(shaderWarmSnapshot()).toMatchObject({ mode: 'all', abArm: null, refusal: null });
      shaderWarmDecide(backendContext(D3D11), GPU_WORK_PRIORITY.VISIBLE_PREWARM, false);
      expect(counter.spawned).toBe(1);

      // Back to Auto: the profile's arm, not a new draw.
      stored = 'auto';
      noteShaderWarmSettingChanged();
      expect(shaderWarmSnapshot()).toMatchObject({
        mode: 'off',
        abArm: 'off',
        worker: 'idle',
        refusal: SHADER_WARM_AB_REFUSAL,
      });
      expect(store.writes).toBe(1);
    } finally {
      setShaderWarmStoredSettingSource(() => null);
    }
  });

  it('keeps the arm token on the refusal column across a renderer swap', () => {
    // Between a dispose and the next context read the backend is unknown; a
    // beacon sent then must still name the off arm on the typed column.
    resetShaderWarmForTest({
      spawn: () => fakeWorker(),
      search: '',
      stored: 'auto',
      abStore: profileStore(),
      random: () => 0.2,
    });
    shaderWarmDecide(backendContext(D3D11), GPU_WORK_PRIORITY.VISIBLE_PREWARM, false);
    disposeShaderWarm();
    expect(shaderWarmSnapshot()).toMatchObject({ abArm: 'off', refusal: SHADER_WARM_AB_REFUSAL });
    // A rebuild that lands on a backend auto leaves off is out of the experiment.
    shaderWarmDecide(backendContext(OPENGL), GPU_WORK_PRIORITY.VISIBLE_PREWARM, false);
    expect(shaderWarmSnapshot()).toMatchObject({ abArm: null, refusal: null });
  });

  it('keeps the drawn arm in the profile storage under its key, and reads it back', () => {
    // The experiment rests on one draw per profile: the page default store
    // must write the arm where the next launch reads it.
    const saved = new Map<string, string>();
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => saved.get(key) ?? null,
        setItem: (key: string, value: string) => {
          saved.set(key, value);
        },
      },
    });
    try {
      resetShaderWarmForTest({
        spawn: () => fakeWorker(),
        search: '',
        stored: 'auto',
        abStore: undefined,
        random: () => 0.2,
      });
      shaderWarmDecide(backendContext(D3D11), GPU_WORK_PRIORITY.VISIBLE_PREWARM, false);
      expect(saved.get('woc.shaderWarm.abArm')).toBe('off');

      // The next launch draws the other way, and reads the stored arm instead.
      resetShaderWarmForTest({
        spawn: () => fakeWorker(),
        search: '',
        stored: 'auto',
        abStore: undefined,
        random: () => 0.9,
      });
      shaderWarmDecide(backendContext(D3D11), GPU_WORK_PRIORITY.VISIBLE_PREWARM, false);
      expect(shaderWarmSnapshot().abArm).toBe('off');
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it('keeps the arm token when the game context later enables an extension', () => {
    // The worker never ran in the off arm, so there is nothing to retire; the
    // drift must not overwrite the one token that says which arm this is.
    resetShaderWarmForTest({
      spawn: () => fakeWorker(),
      search: '',
      stored: 'auto',
      abStore: profileStore(),
      random: () => 0.2,
    });
    shaderWarmDecide(backendContext(D3D11), GPU_WORK_PRIORITY.VISIBLE_PREWARM, false);
    noteShaderWarmExtensionDrift('webgl_lose_context');
    expect(shaderWarmSnapshot()).toMatchObject({ abArm: 'off', refusal: SHADER_WARM_AB_REFUSAL });
  });

  it('never throws out of a gate when the storage property itself throws', () => {
    // Where site data is blocked, reading `localStorage` off the global throws
    // before any method call.
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    try {
      expect(() => {
        resetShaderWarmForTest({
          spawn: () => fakeWorker(),
          search: '',
          stored: 'auto',
          abStore: undefined,
          random: () => 0.2,
        });
        shaderWarmDecide(backendContext(D3D11), GPU_WORK_PRIORITY.VISIBLE_PREWARM, false);
      }).not.toThrow();
      expect(shaderWarmSnapshot()).toMatchObject({ abArm: 'off', refusal: SHADER_WARM_AB_REFUSAL });
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it('keeps the page load draw across renderer rebuilds when storage refuses', () => {
    // Drawn again at every rebuild, a blocked profile could change arm in the
    // middle of a session and land in both halves of the comparison.
    const draws = [0.2, 0.7, 0.7];
    let calls = 0;
    const blocked = {
      get: (): string | null => {
        throw new Error('blocked');
      },
      set: () => {
        throw new Error('blocked');
      },
    };
    resetShaderWarmForTest({
      spawn: () => fakeWorker(),
      search: '',
      stored: 'auto',
      abStore: blocked,
      random: () => draws[calls++] ?? 0.7,
    });
    shaderWarmDecide(backendContext(D3D11), GPU_WORK_PRIORITY.VISIBLE_PREWARM, false);
    expect(shaderWarmSnapshot().abArm).toBe('off');
    disposeShaderWarm();
    expect(shaderWarmSnapshot().abArm).toBe('off');
    shaderWarmDecide(backendContext(D3D11), GPU_WORK_PRIORITY.VISIBLE_PREWARM, false);
    expect(shaderWarmSnapshot()).toMatchObject({ abArm: 'off', refusal: SHADER_WARM_AB_REFUSAL });
    expect(calls).toBe(1);
  });

  it('reads the profile storage only where a draw can happen', () => {
    // A masked renderer string reads as an unknown backend at every policy
    // call, which is every gate: no storage read belongs there.
    let reads = 0;
    resetShaderWarmForTest({
      spawn: () => fakeWorker(),
      search: '',
      stored: 'auto',
      abStore: {
        get: () => {
          reads++;
          return null;
        },
        set: () => {},
      },
      random: () => 0.7,
    });
    for (let gate = 0; gate < 5; gate++) {
      shaderWarmDecide(backendContext(''), GPU_WORK_PRIORITY.VISIBLE_PREWARM, false);
    }
    expect(reads).toBe(0);
    shaderWarmDecide(backendContext(D3D11), GPU_WORK_PRIORITY.VISIBLE_PREWARM, false);
    expect(reads).toBe(1);
  });

  it('still draws when the profile storage refuses, once per page load', () => {
    const counter = spawnCounter();
    resetShaderWarmForTest({
      spawn: counter.spawn,
      search: '',
      stored: 'auto',
      abStore: {
        get: () => {
          throw new Error('blocked');
        },
        set: () => {
          throw new Error('blocked');
        },
      },
      random: () => 0.2,
    });
    const decision = shaderWarmDecide(
      backendContext(D3D11),
      GPU_WORK_PRIORITY.VISIBLE_PREWARM,
      false,
    );
    expect(decision).toEqual({ hold: false, bypass: 'mode-off' });
    expect(shaderWarmSnapshot()).toMatchObject({ abArm: 'off', refusal: SHADER_WARM_AB_REFUSAL });
    expect(counter.spawned).toBe(0);
  });
});

describe('what the readout adds up while gates hold', () => {
  it('counts the wall time at least one gate was held, and the releases', async () => {
    let clock = 0;
    const { worker, ready } = start({ now: () => clock });
    ready();
    const first = holdShaderPrograms(
      [{ vertex: 'void main() { float a; }', fragment: 'void main() {}', index0Attribute: 'p' }],
      GPU_WORK_PRIORITY.VISIBLE_PREWARM,
      5_000,
    );
    holdShaderPrograms(
      [{ vertex: 'void main() { float b; }', fragment: 'void main() {}', index0Attribute: 'p' }],
      GPU_WORK_PRIORITY.VISIBLE_PREWARM,
      5_000,
    );
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    clock = 300;
    worker().emit({ kind: 'warmed', id: 1, linkMs: 300 });
    await first.settled;
    await flush();
    clock = 500;
    worker().emit({ kind: 'warmed', id: 2, linkMs: 500 });
    await flush();
    clock = 2_000;
    expect(shaderWarmSnapshot()).toMatchObject({ holdWallMs: 500, releases: 0, abArm: null });
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

describe('whether the player is offered a shader warm-up choice at all', () => {
  it('refuses the platform the mode resolver refuses, and offers it everywhere else', () => {
    // The options window drops its row on the answer, so the rule has to be
    // the resolver's own: iOS is off whatever the setting (a second WebGL2
    // context is a per-process memory ceiling risk on phone-class WebKit),
    // and Android keeps the explicit arm even though `auto` reads off there.
    expect(shaderWarmChoiceAvailable('ios')).toBe(false);
    expect(shaderWarmChoiceAvailable('android')).toBe(true);
    expect(shaderWarmChoiceAvailable('other')).toBe(true);
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
