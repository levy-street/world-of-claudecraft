// The shader warm worker: a WebGL2 context on an OffscreenCanvas that links
// and RESOLVES programs the main thread will need, so the browser's shared
// program cache holds them before the game's own link (a hit, 5 to 15 ms on
// desktop, against 120 to 740 ms cold). It receives text and answers with
// ids (shader_warm_protocol.ts); nothing crosses back but bookkeeping.
//
// Why a worker at all, and why paced: the POC of 2026-08-28 (tmp/POC_worker-
// shader-warmup_2026-08-28.md and the cross-platform testers) showed the
// cache shared across contexts in one process, and showed that resolving a
// batch at once saturates the GPU process (1.3 to 3.5 s of frames lost on
// Linux GL) while two links in flight at a time keep the main thread near
// 60 fps. The scheduler (shader_warm_worker_core.ts) paces with the boot
// lane's AIMD; this file only carries the GL and the messages.
//
// Same GL discipline as the character-select cache (shader_warmup_gl_core.ts):
// the exact extension set the game context enabled, in order, or a refusal
// (the cache key carries the set); the location-0 bind; a resolved link.
// Imports nothing that reads document, navigator or the graphics tier.

import { enableRendererExtensions } from './renderer_extensions';
import type {
  ShaderWarmClientMessage,
  ShaderWarmRefusal,
  ShaderWarmSource,
  ShaderWarmWorkerMessage,
} from './shader_warm_protocol';
import {
  createWarmScheduler,
  SHADER_WARM_LINK_DEADLINE_MS,
  SHADER_WARM_RETAINED_DESKTOP,
  type WarmScheduler,
} from './shader_warm_worker_core';
import {
  deleteWarmProgram,
  pollWarmProgram,
  releaseWarmShaders,
  resolveWarmProgram,
  submitWarmProgram,
  type WarmProgramHandle,
  type WarmupGl,
} from './shader_warmup_gl_core';

/** Completion polls while links are in flight: one cheap query per link. */
const TICK_MS = 8;
const STATS_EVERY_TICKS = 60;
const WARM_CANVAS_PX = 8;

interface InFlight {
  handle: WarmProgramHandle;
  startedAt: number;
}

interface WorkerScope {
  postMessage(message: ShaderWarmWorkerMessage): void;
  onmessage: ((event: MessageEvent<ShaderWarmClientMessage>) => void) | null;
}

const scope = globalThis as unknown as WorkerScope;
const post = (message: ShaderWarmWorkerMessage): void => scope.postMessage(message);

let gl: (WarmupGl & { isContextLost?: () => boolean }) | null = null;
let scheduler: WarmScheduler | null = null;
/** KHR_parallel_shader_compile on the worker's context: poll, else block. */
let parallel = true;
let retainCap = SHADER_WARM_RETAINED_DESKTOP;
const sources = new Map<number, ShaderWarmSource>();
const inFlight = new Map<number, InFlight>();
const retained: WarmProgramHandle[] = [];
let warmed = 0;
let failed = 0;
let ticking = false;
let ticks = 0;
let disposed = false;

function adapterOf(context: WarmupGl): string {
  try {
    const debug = context.getExtension('WEBGL_debug_renderer_info') as {
      UNMASKED_RENDERER_WEBGL: number;
    } | null;
    return String(
      debug
        ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL)
        : context.getParameter(context.RENDERER),
    );
  } catch {
    return '';
  }
}

function refuse(reason: ShaderWarmRefusal, extensions: string[] = []): void {
  post({ kind: 'ready', ok: false, reason, extensions, adapter: '' });
}

function init(
  attributes: Record<string, unknown> | null,
  wanted: readonly string[],
  maxWindow: number,
  retain: number,
): void {
  retainCap = Math.max(0, Math.floor(retain));
  const Offscreen = (
    globalThis as { OffscreenCanvas?: new (w: number, h: number) => OffscreenCanvas }
  ).OffscreenCanvas;
  if (!Offscreen) {
    refuse('no-offscreen-canvas');
    return;
  }
  let context: WarmupGl | null = null;
  try {
    const canvas = new Offscreen(WARM_CANVAS_PX, WARM_CANVAS_PX);
    context = canvas.getContext('webgl2', attributes ?? undefined) as unknown as WarmupGl | null;
  } catch {
    context = null;
  }
  if (!context) {
    refuse('no-webgl2');
    return;
  }
  const sweep = enableRendererExtensions(context);
  if (
    sweep.enabled.length !== wanted.length ||
    sweep.enabled.some((name, i) => name !== wanted[i])
  ) {
    refuse('extension-mismatch', sweep.enabled);
    return;
  }
  // Without the completion query the worker resolves each link by blocking
  // its OWN thread on LINK_STATUS, one at a time: the cache is warmed the
  // same (the Linux Firefox tester shared it that way), the main thread
  // never waits, and the window stays at one so the GPU process sees no burst.
  parallel = sweep.parallelCompile;
  gl = context;
  scheduler = createWarmScheduler({ now: () => performance.now() }, parallel ? maxWindow : 1);
  post({
    kind: 'ready',
    ok: true,
    reason: null,
    extensions: sweep.enabled,
    adapter: adapterOf(context),
  });
}

function retain(handle: WarmProgramHandle): void {
  if (!gl) return;
  retained.push(handle);
  while (retained.length > retainCap) {
    const oldest = retained.shift();
    if (oldest) deleteWarmProgram(gl, oldest);
  }
}

function contextLost(): boolean {
  try {
    return gl?.isContextLost?.() === true;
  } catch {
    return false;
  }
}

function failEverything(reason: 'context-lost' | 'not-ready'): void {
  for (const id of inFlight.keys()) post({ kind: 'failed', id, reason });
  inFlight.clear();
  for (const id of sources.keys()) post({ kind: 'failed', id, reason });
  sources.clear();
}

function tick(): void {
  ticking = false;
  if (disposed || !gl || !scheduler) return;
  if (contextLost()) {
    failEverything('context-lost');
    post({ kind: 'lost' });
    gl = null;
    return;
  }
  // Settle what completed, oldest first. A link past its deadline is failed
  // and dropped, so one wedged link cannot close the window for good.
  const nowMs = performance.now();
  for (const [id, flight] of inFlight) {
    let result = parallel
      ? pollWarmProgram(gl, flight.handle)
      : resolveWarmProgram(gl, flight.handle);
    if (result === 'pending' && nowMs - flight.startedAt >= SHADER_WARM_LINK_DEADLINE_MS) {
      result = 'failed';
    }
    if (result === 'pending') continue;
    inFlight.delete(id);
    releaseWarmShaders(gl, flight.handle);
    if (result === 'linked') {
      scheduler.markSettled(id);
      warmed++;
      retain(flight.handle);
      post({ kind: 'warmed', id, linkMs: performance.now() - flight.startedAt });
    } else {
      scheduler.markFailed(id);
      failed++;
      deleteWarmProgram(gl, flight.handle);
      post({ kind: 'failed', id, reason: 'link-failed' });
    }
  }
  // Submit what the window allows.
  for (;;) {
    const next = scheduler.takeNext();
    if (!next) break;
    const source = sources.get(next.id);
    sources.delete(next.id);
    if (!source) {
      scheduler.markFailed(next.id);
      continue;
    }
    const handle = submitWarmProgram(gl, source);
    if (!handle) {
      scheduler.markFailed(next.id);
      failed++;
      post({ kind: 'failed', id: next.id, reason: 'link-failed' });
      continue;
    }
    inFlight.set(next.id, { handle, startedAt: performance.now() });
  }
  ticks++;
  if (ticks % STATS_EVERY_TICKS === 0) postStats();
  schedule();
}

function schedule(): void {
  if (ticking || disposed || !scheduler) return;
  // Paused with nothing in flight: nothing to poll, resume re-schedules.
  if (inFlight.size === 0 && (!scheduler.active() || scheduler.paused())) return;
  ticking = true;
  setTimeout(tick, TICK_MS);
}

function postStats(): void {
  if (!scheduler) return;
  const snapshot = scheduler.snapshot();
  post({
    kind: 'stats',
    pending: snapshot.pending,
    inFlight: inFlight.size,
    windowLinks: snapshot.budget.windowLinks,
    state: snapshot.budget.state,
    warmed,
    failed,
    retained: retained.length,
  });
}

scope.onmessage = (event: MessageEvent<ShaderWarmClientMessage>) => {
  const message = event.data;
  switch (message.kind) {
    case 'init':
      init(message.contextAttributes, message.extensions, message.maxWindow, message.retain);
      break;
    case 'warm':
      if (!gl || !scheduler) {
        for (const source of message.sources)
          post({ kind: 'failed', id: source.id, reason: 'not-ready' });
        break;
      }
      for (const source of message.sources) {
        sources.set(source.id, source);
        scheduler.enqueue({ id: source.id, priority: source.priority });
      }
      schedule();
      break;
    case 'cancel':
      if (!scheduler) break;
      for (const id of scheduler.cancel(message.ids)) {
        sources.delete(id);
        post({ kind: 'failed', id, reason: 'cancelled' });
      }
      break;
    case 'pause':
      scheduler?.pause();
      break;
    case 'resume':
      scheduler?.resume();
      schedule();
      break;
    case 'dispose':
      disposed = true;
      if (gl) {
        for (const flight of inFlight.values()) {
          releaseWarmShaders(gl, flight.handle);
          deleteWarmProgram(gl, flight.handle);
        }
        for (const handle of retained) deleteWarmProgram(gl, handle);
        (gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
      }
      inFlight.clear();
      retained.length = 0;
      sources.clear();
      gl = null;
      break;
  }
};
