import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildContextRecoveryCallbacks } from '../src/game/context_loss_diagnostics';
import {
  attachContextRecoveryHandlers,
  CONTEXT_LOSS_ESCALATE_MS,
  type ContextLossScheduler,
  WebglContextWatchdog,
} from '../src/render/context_loss_recovery';
import { DEFAULT_RECYCLE_TIMEOUT_MS } from '../src/render/context_recycle';

const ROOT = path.resolve(__dirname, '..');

function fakeScheduler() {
  let nextId = 1;
  const timers = new Map<number, () => void>();
  const scheduler: ContextLossScheduler = {
    setTimeout: vi.fn((callback: () => void) => {
      const id = nextId++;
      timers.set(id, callback);
      return id;
    }),
    clearTimeout: vi.fn((id: number) => {
      timers.delete(id);
    }),
  };
  return {
    scheduler,
    fire(id: number) {
      const cb = timers.get(id);
      // A real setTimeout is one-shot: firing consumes it, same as clearTimeout would.
      timers.delete(id);
      if (cb) cb();
    },
    pendingCount: () => timers.size,
  };
}

describe('WebglContextWatchdog', () => {
  it('does not call onStuck if restored before the timer fires', () => {
    const onStuck = vi.fn();
    const fake = fakeScheduler();
    const watchdog = new WebglContextWatchdog(onStuck, {
      escalateMs: 5000,
      scheduler: fake.scheduler,
    });

    watchdog.lost();
    expect(fake.scheduler.setTimeout).toHaveBeenCalledWith(expect.any(Function), 5000);
    watchdog.restored();

    expect(fake.scheduler.clearTimeout).toHaveBeenCalledWith(1);
    expect(fake.pendingCount()).toBe(0);
    expect(onStuck).not.toHaveBeenCalled();
  });

  it('calls onStuck once if the timer fires before a restore', () => {
    const onStuck = vi.fn();
    const fake = fakeScheduler();
    const watchdog = new WebglContextWatchdog(onStuck, {
      escalateMs: 5000,
      scheduler: fake.scheduler,
    });

    watchdog.lost();
    fake.fire(1);

    expect(onStuck).toHaveBeenCalledTimes(1);
    // A late restore after escalation is a no-op: the timer already cleared itself.
    watchdog.restored();
    expect(fake.scheduler.clearTimeout).not.toHaveBeenCalled();
  });

  it('a second loss while already armed does not re-arm the timer', () => {
    const onStuck = vi.fn();
    const fake = fakeScheduler();
    const watchdog = new WebglContextWatchdog(onStuck, {
      escalateMs: 5000,
      scheduler: fake.scheduler,
    });

    watchdog.lost();
    watchdog.lost();

    expect(fake.scheduler.setTimeout).toHaveBeenCalledTimes(1);
  });

  it('latches after onStuck fires: a later, separate loss never re-arms or escalates again', () => {
    // fatalOverlay clears the resume marker unconditionally before its own
    // first-reason-wins overlay guard, so a second escalation landing on an
    // overlay a caller raised with keepResumeMarker: true (the duplicate-
    // session case) would erase a marker that caller deliberately kept, even
    // though the DOM overlay itself never visibly changes. Once stuck, stuck.
    const onStuck = vi.fn();
    const fake = fakeScheduler();
    const watchdog = new WebglContextWatchdog(onStuck, {
      escalateMs: 5000,
      scheduler: fake.scheduler,
    });

    watchdog.lost();
    fake.fire(1);
    expect(onStuck).toHaveBeenCalledTimes(1);

    watchdog.restored(); // e.g. a caller's own webglcontextrestored handler still runs
    watchdog.lost(); // a later, separate loss

    expect(fake.scheduler.setTimeout).toHaveBeenCalledTimes(1); // never re-armed
    expect(onStuck).toHaveBeenCalledTimes(1); // never escalated again
  });

  it('restored() with no pending loss is a no-op', () => {
    const onStuck = vi.fn();
    const fake = fakeScheduler();
    const watchdog = new WebglContextWatchdog(onStuck, {
      escalateMs: 5000,
      scheduler: fake.scheduler,
    });

    watchdog.restored();

    expect(fake.scheduler.clearTimeout).not.toHaveBeenCalled();
  });

  it('dispose() cancels a pending loss with no callback', () => {
    const onStuck = vi.fn();
    const fake = fakeScheduler();
    const watchdog = new WebglContextWatchdog(onStuck, {
      escalateMs: 5000,
      scheduler: fake.scheduler,
    });

    watchdog.lost();
    watchdog.dispose();

    expect(fake.pendingCount()).toBe(0);
    expect(onStuck).not.toHaveBeenCalled();
  });

  it('defaults to CONTEXT_LOSS_ESCALATE_MS when no bound is given', () => {
    const fake = fakeScheduler();
    const watchdog = new WebglContextWatchdog(vi.fn(), { scheduler: fake.scheduler });

    watchdog.lost();

    expect(fake.scheduler.setTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      CONTEXT_LOSS_ESCALATE_MS,
    );
  });
});

describe('attachContextRecoveryHandlers', () => {
  function canvasFixture() {
    const canvas = new EventTarget() as HTMLCanvasElement;
    // The default isStillLost reads this; most tests exercise a genuinely
    // lost context, so default the stub context to reporting lost.
    Object.assign(canvas, {
      getContext: vi.fn(() => ({ isContextLost: () => true })),
    });
    return canvas;
  }

  it('requests automatic restoration (preventDefault) on every loss', () => {
    const canvas = canvasFixture();
    attachContextRecoveryHandlers(canvas, {
      onLost: vi.fn(),
      onRestored: vi.fn(),
      onStuck: vi.fn(),
    });

    const event = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('calls onLost on every loss and onRestored on every restore', () => {
    const canvas = canvasFixture();
    const onLost = vi.fn();
    const onRestored = vi.fn();
    attachContextRecoveryHandlers(canvas, { onLost, onRestored, onStuck: vi.fn() });

    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(onLost).toHaveBeenCalledTimes(1);

    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(onRestored).toHaveBeenCalledTimes(1);
  });

  it('calls onStuck only if restore never arrives within the escalation window', () => {
    const canvas = canvasFixture();
    const onStuck = vi.fn();
    const fake = fakeScheduler();
    attachContextRecoveryHandlers(
      canvas,
      { onLost: vi.fn(), onRestored: vi.fn(), onStuck },
      { escalateMs: 5000, scheduler: fake.scheduler },
    );

    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    fake.fire(1);

    expect(onStuck).toHaveBeenCalledTimes(1);
  });

  it('does not call onStuck if the context restores within the window', () => {
    const canvas = canvasFixture();
    const onStuck = vi.fn();
    const fake = fakeScheduler();
    attachContextRecoveryHandlers(
      canvas,
      { onLost: vi.fn(), onRestored: vi.fn(), onStuck },
      { escalateMs: 5000, scheduler: fake.scheduler },
    );

    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    canvas.dispatchEvent(new Event('webglcontextrestored'));

    expect(fake.pendingCount()).toBe(0);
    expect(onStuck).not.toHaveBeenCalled();
  });

  it('re-arms on a second loss after a restore (a genuine loss/restore/loss cycle)', () => {
    const canvas = canvasFixture();
    const onStuck = vi.fn();
    const fake = fakeScheduler();
    attachContextRecoveryHandlers(
      canvas,
      { onLost: vi.fn(), onRestored: vi.fn(), onStuck },
      { escalateMs: 5000, scheduler: fake.scheduler },
    );

    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(fake.pendingCount()).toBe(1);
    fake.fire(2);

    expect(onStuck).toHaveBeenCalledTimes(1);
  });

  it('does not escalate while the page is hidden, and gives the loss a fresh window once visible again', () => {
    const canvas = canvasFixture();
    const onStuck = vi.fn();
    const fake = fakeScheduler();
    let hidden = true;
    const state: { onVisible: (() => void) | null } = { onVisible: null };
    const visibility = {
      isHidden: () => hidden,
      onVisible: vi.fn((callback: () => void) => {
        state.onVisible = callback;
        return () => {
          state.onVisible = null;
        };
      }),
    };
    attachContextRecoveryHandlers(
      canvas,
      { onLost: vi.fn(), onRestored: vi.fn(), onStuck },
      { escalateMs: 5000, scheduler: fake.scheduler, visibility },
    );

    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    fake.fire(1); // the original window elapses while still hidden
    expect(onStuck).not.toHaveBeenCalled();
    expect(visibility.onVisible).toHaveBeenCalledTimes(1);

    hidden = false;
    state.onVisible?.(); // the page becomes visible: a fresh window is armed
    expect(fake.pendingCount()).toBe(1);
    fake.fire(2);

    expect(onStuck).toHaveBeenCalledTimes(1);
  });

  it('stands down instead of escalating if isStillLost reports the context already recovered', () => {
    const canvas = canvasFixture();
    const onStuck = vi.fn();
    const fake = fakeScheduler();
    attachContextRecoveryHandlers(
      canvas,
      { onLost: vi.fn(), onRestored: vi.fn(), onStuck },
      { escalateMs: 5000, scheduler: fake.scheduler, isStillLost: () => false },
    );

    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    fake.fire(1);

    expect(onStuck).not.toHaveBeenCalled();
  });

  it('defaults isStillLost to the canvas own live WebGL2 context state', () => {
    const canvas = canvasFixture();
    const onStuck = vi.fn();
    const fake = fakeScheduler();
    let contextLost = true;
    Object.assign(canvas, {
      getContext: vi.fn(() => ({ isContextLost: () => contextLost })),
    });
    attachContextRecoveryHandlers(
      canvas,
      { onLost: vi.fn(), onRestored: vi.fn(), onStuck },
      { escalateMs: 5000, scheduler: fake.scheduler },
    );

    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    contextLost = false; // restored, but this test never dispatches the event for it
    fake.fire(1);

    expect(onStuck).not.toHaveBeenCalled();
  });

  it('self-disposes on pagehide so a pending watchdog cannot outlive the page', () => {
    const canvas = canvasFixture();
    const onStuck = vi.fn();
    const fake = fakeScheduler();
    const pageTeardown = new EventTarget();
    attachContextRecoveryHandlers(
      canvas,
      { onLost: vi.fn(), onRestored: vi.fn(), onStuck },
      { escalateMs: 5000, scheduler: fake.scheduler, pageTeardown },
    );

    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(fake.pendingCount()).toBe(1);
    pageTeardown.dispatchEvent(new Event('pagehide'));

    expect(fake.pendingCount()).toBe(0);
  });

  it('does NOT dispose on a bfcache freeze (pagehide with persisted true)', () => {
    // context_release.ts deliberately keeps the WebGL context alive across a
    // freeze, so a loss the watchdog is already timing can still be
    // genuinely, still-lost on pageshow. Disposing here would strand it with
    // no watchdog left to ever report it.
    const canvas = canvasFixture();
    const onStuck = vi.fn();
    const fake = fakeScheduler();
    const pageTeardown = new EventTarget();
    attachContextRecoveryHandlers(
      canvas,
      { onLost: vi.fn(), onRestored: vi.fn(), onStuck },
      { escalateMs: 5000, scheduler: fake.scheduler, pageTeardown },
    );

    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(fake.pendingCount()).toBe(1);
    const freeze = new Event('pagehide');
    Object.assign(freeze, { persisted: true });
    pageTeardown.dispatchEvent(freeze);

    expect(fake.pendingCount()).toBe(1);
  });

  it('observes and arms a loss on persisted pageshow if webglcontextlost never reached this handler', () => {
    // The freeze can outlast the loss itself: nothing guarantees this
    // listener sees `webglcontextlost` before or during a bfcache freeze, so
    // the resume path must be able to discover a still-lost context on its
    // own rather than only ever re-arming an already-armed watchdog.
    const canvas = canvasFixture(); // isContextLost() reports lost by default
    const onLost = vi.fn();
    const onStuck = vi.fn();
    const fake = fakeScheduler();
    const pageTeardown = new EventTarget();
    attachContextRecoveryHandlers(
      canvas,
      { onLost, onRestored: vi.fn(), onStuck },
      { escalateMs: 5000, scheduler: fake.scheduler, pageTeardown },
    );

    expect(fake.pendingCount()).toBe(0); // nothing armed yet, no loss event has fired
    expect(onLost).not.toHaveBeenCalled();

    const resume = new Event('pageshow');
    Object.assign(resume, { persisted: true });
    pageTeardown.dispatchEvent(resume);

    expect(onLost).toHaveBeenCalledTimes(1);
    expect(fake.pendingCount()).toBe(1);
    fake.fire(1);
    expect(onStuck).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate onLost on persisted pageshow when the loss was already observed', () => {
    const canvas = canvasFixture(); // isContextLost() reports lost by default
    const onLost = vi.fn();
    const onStuck = vi.fn();
    const fake = fakeScheduler();
    const pageTeardown = new EventTarget();
    attachContextRecoveryHandlers(
      canvas,
      { onLost, onRestored: vi.fn(), onStuck },
      { escalateMs: 5000, scheduler: fake.scheduler, pageTeardown },
    );

    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(fake.pendingCount()).toBe(1);

    const resume = new Event('pageshow');
    Object.assign(resume, { persisted: true });
    pageTeardown.dispatchEvent(resume);

    expect(onLost).toHaveBeenCalledTimes(1);
    expect(fake.scheduler.setTimeout).toHaveBeenCalledTimes(1);
    fake.fire(1);
    expect(onStuck).toHaveBeenCalledTimes(1);
  });

  it('does not arm on an ordinary pageshow (persisted false)', () => {
    const canvas = canvasFixture();
    const fake = fakeScheduler();
    const pageTeardown = new EventTarget();
    attachContextRecoveryHandlers(
      canvas,
      { onLost: vi.fn(), onRestored: vi.fn(), onStuck: vi.fn() },
      { escalateMs: 5000, scheduler: fake.scheduler, pageTeardown },
    );

    const ordinaryShow = new Event('pageshow');
    Object.assign(ordinaryShow, { persisted: false });
    pageTeardown.dispatchEvent(ordinaryShow);

    expect(fake.pendingCount()).toBe(0);
  });

  it('does not arm on a persisted pageshow if isStillLost reports the context already recovered', () => {
    const canvas = canvasFixture();
    const fake = fakeScheduler();
    const pageTeardown = new EventTarget();
    attachContextRecoveryHandlers(
      canvas,
      { onLost: vi.fn(), onRestored: vi.fn(), onStuck: vi.fn() },
      { escalateMs: 5000, scheduler: fake.scheduler, pageTeardown, isStillLost: () => false },
    );

    const resume = new Event('pageshow');
    Object.assign(resume, { persisted: true });
    pageTeardown.dispatchEvent(resume);

    expect(fake.pendingCount()).toBe(0);
  });
});

describe('CONTEXT_LOSS_ESCALATE_MS', () => {
  it('stays comfortably above the deliberate graphics-rebuild recycle own worst-case timeout', () => {
    // A normal graphics-preset switch must never trip this watchdog mid-rebuild.
    expect(CONTEXT_LOSS_ESCALATE_MS).toBeGreaterThan(DEFAULT_RECYCLE_TIMEOUT_MS);
  });
});

describe('wiring pins (source scans, anchor style per docs/qa-gate.md)', () => {
  const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

  it('main.ts wires the context-recovery callbacks through the diagnostics builder', () => {
    // The callbacks themselves (and their onStuck -> fatalOverlay route) live in
    // src/game/context_loss_diagnostics.ts now, kept out of main.ts's own
    // zero-headroom line ceiling (tests/monolith_budget.test.ts); this pin only
    // proves main.ts still supplies that builder with a real fatalOverlay and a
    // real localized stuck message, at the real attach call.
    const mainSrc = read('src/main.ts');
    const attachAt = mainSrc.indexOf('attachContextRecoveryHandlers(');
    const builderAt = mainSrc.indexOf('buildContextRecoveryCallbacks({');
    const showFatalOverlayAt = mainSrc.indexOf('showFatalOverlay: fatalOverlay,');
    const stuckMessageAt = mainSrc.indexOf("stuckMessage: t('loading.rendererContextLost'),");
    expect(attachAt).toBeGreaterThanOrEqual(0);
    expect(builderAt).toBeGreaterThan(attachAt);
    expect(showFatalOverlayAt).toBeGreaterThan(builderAt);
    expect(stuckMessageAt).toBeGreaterThan(builderAt);
  });

  it('src/game/context_loss_diagnostics.ts routes onStuck to the caller-supplied fatalOverlay', () => {
    const src = read('src/game/context_loss_diagnostics.ts');
    const onStuckAt = src.indexOf('onStuck: () => {');
    const checkpointAt = src.indexOf(
      "deps.entryDiagnostics.checkpoint('webgl-context-stuck', deps.renderEntryDiagnostics());",
    );
    const consoleErrorAt = src.indexOf('console.error(');
    const showFatalOverlayCallAt = src.indexOf('deps.showFatalOverlay(deps.stuckMessage);');
    expect(onStuckAt).toBeGreaterThanOrEqual(0);
    expect(checkpointAt).toBeGreaterThan(onStuckAt);
    expect(consoleErrorAt).toBeGreaterThan(checkpointAt);
    expect(showFatalOverlayCallAt).toBeGreaterThan(consoleErrorAt);
  });
});

describe('buildContextRecoveryCallbacks', () => {
  function harness(overrides: Partial<Record<string, unknown>> = {}) {
    const checkpoints: Array<[string, unknown]> = [];
    const entryDiagnostics = {
      checkpoint: (checkpoint: string, diagnostics?: unknown) =>
        checkpoints.push([checkpoint, diagnostics]),
    };
    const ktx2MipsOnContextLost = vi.fn();
    const showFatalOverlay = vi.fn();
    const callbacks = buildContextRecoveryCallbacks({
      entryDiagnostics,
      renderEntryDiagnostics: () => ({ phase: 'render' }),
      ktx2MipsOnContextLost,
      contextLostCount: () => 0,
      showFatalOverlay,
      stuckMessage: 'reload prompt text',
      ...overrides,
    });
    return { callbacks, checkpoints, ktx2MipsOnContextLost, showFatalOverlay };
  }

  it('onLost runs the ktx2 hook and checkpoints webgl-context-lost with an incremented count', () => {
    const { callbacks, checkpoints, ktx2MipsOnContextLost } = harness({
      contextLostCount: () => 2,
    });
    callbacks.onLost();
    expect(ktx2MipsOnContextLost).toHaveBeenCalledTimes(1);
    expect(checkpoints).toEqual([['webgl-context-lost', { phase: 'render', contextLost: 3 }]]);
  });

  it('onRestored checkpoints webgl-context-restored', () => {
    const { callbacks, checkpoints } = harness();
    callbacks.onRestored();
    expect(checkpoints).toEqual([['webgl-context-restored', undefined]]);
  });

  it('onStuck checkpoints webgl-context-stuck and shows the fatal overlay with the caller message', () => {
    const { callbacks, checkpoints, showFatalOverlay } = harness();
    callbacks.onStuck();
    expect(checkpoints).toEqual([['webgl-context-stuck', { phase: 'render' }]]);
    expect(showFatalOverlay).toHaveBeenCalledOnce();
    expect(showFatalOverlay).toHaveBeenCalledWith('reload prompt text');
  });
});
