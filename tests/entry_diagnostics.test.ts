import { describe, expect, it, vi } from 'vitest';
import { ENTRY_HEARTBEAT_MS } from '../src/game/entry_crash_guard';
import {
  checkpointActiveEntryDiagnostics,
  createEntryDiagnosticsController,
  type EntryDiagnosticPersistence,
  resumeActiveEntryDiagnostics,
  stopActiveEntryDiagnostics,
  suspendActiveEntryDiagnostics,
} from '../src/game/entry_diagnostics';

function harness(opts: { heartbeat?: boolean; hidden?: () => boolean } = {}) {
  let wallNow = 1_000;
  const events: string[] = [];
  const logged: string[] = [];
  const persistence: EntryDiagnosticPersistence = {
    start: vi.fn((preset) => events.push(`start:${preset}`)),
    checkpoint: vi.fn((checkpoint) => events.push(checkpoint)),
    clear: vi.fn(() => events.push('clear')),
    ...(opts.heartbeat ? { heartbeat: vi.fn((now: number) => events.push(`alive:${now}`)) } : {}),
  };
  const controller = createEntryDiagnosticsController({
    baseSnapshot: () => ({ phase: 'base' }),
    renderSnapshot: () => ({ phase: 'render' }),
    persistence,
    wallNow: () => wallNow,
    log: vi.fn((message: string) => logged.push(message)),
    isHidden: opts.hidden ?? (() => false),
  });
  return {
    controller,
    events,
    logged,
    persistence,
    setWallNow: (value: number) => {
      wallNow = value;
    },
  };
}

describe('entry diagnostics controller', () => {
  it('stamps the repeating checkpoints without echoing them to the console', () => {
    const { controller, events, logged } = harness();
    controller.start(2);
    controller.renderedFrame(0);
    controller.renderedFrame(10_000);
    controller.checkpoint('character-open');
    controller.checkpoint('character-closed');
    controller.checkpoint('settings-open');
    controller.checkpoint('settings-closed');
    // Every one of them still reaches the crash probe, which is what diagnoses
    // a failed entry after the fact.
    expect(events).toEqual([
      'start:2',
      'scene-build-start',
      'first-frame',
      'rendering',
      'character-open',
      'character-closed',
      'settings-open',
      'settings-closed',
    ]);
    // The console only carries the one-shot entry milestones.
    expect(logged).toEqual([
      '[entry-diag] checkpoint=scene-build-start',
      '[entry-diag] checkpoint=first-frame',
    ]);
  });

  it('arms the probe before writing the initial scene checkpoint', () => {
    const { controller, events } = harness();
    controller.start(2);
    expect(events).toEqual(['start:2', 'scene-build-start']);
  });

  it('keeps a failure checkpoint sticky across routine render samples', () => {
    const { controller, events } = harness();
    controller.start(2);
    controller.checkpoint('webgl-context-lost', { contextLost: 1 });
    controller.renderedFrame(100);
    controller.checkpoint('first-paint');
    expect(events).toEqual(['start:2', 'scene-build-start', 'webgl-context-lost']);
  });

  it('keeps the first failure signal instead of replacing it with cascading failures', () => {
    const { controller, events } = harness();
    controller.start(2);
    controller.checkpoint('webgl-context-lost');
    controller.checkpoint('window-error');
    controller.checkpoint('unhandled-rejection');
    expect(events).toEqual(['start:2', 'scene-build-start', 'webgl-context-lost']);
  });

  it('allows routine checkpoints again after the matching restoration event', () => {
    const { controller, events } = harness();
    controller.start(2);
    controller.checkpoint('webgl-context-lost');
    controller.checkpoint('webgl-context-restored');
    controller.renderedFrame(100);
    expect(events).toEqual([
      'start:2',
      'scene-build-start',
      'webgl-context-lost',
      'webgl-context-restored',
      'first-frame',
    ]);
  });

  it('records the first frame immediately and throttles later render checkpoints', () => {
    const { controller, events } = harness();
    controller.start(2);
    controller.renderedFrame(100);
    controller.renderedFrame(500);
    controller.renderedFrame(2_099);
    controller.renderedFrame(2_100);
    expect(events).toEqual(['start:2', 'scene-build-start', 'first-frame', 'rendering']);
  });

  it('keeps the runtime probe armed after entry stabilizes and pins More until it closes', () => {
    const { controller, events } = harness();
    controller.start(2);
    controller.markStable('stable');
    controller.renderedFrame(10_000);
    checkpointActiveEntryDiagnostics('mobile-more-open');
    controller.renderedFrame(20_000);
    checkpointActiveEntryDiagnostics('mobile-more-closed');
    expect(events).toEqual([
      'start:2',
      'scene-build-start',
      'runtime-stable',
      'mobile-more-open',
      'mobile-more-closed',
    ]);
  });

  it('pins Settings as the latest runtime checkpoint until it closes', () => {
    const { controller, events } = harness();
    controller.start(2);
    controller.markStable('stable');
    controller.checkpoint('settings-open');
    controller.checkpoint('connection-lost');
    controller.checkpoint('settings-closed');
    expect(events).toEqual([
      'start:2',
      'scene-build-start',
      'runtime-stable',
      'settings-open',
      'settings-closed',
    ]);
  });

  it('pins Character as the latest runtime checkpoint until it closes', () => {
    const { controller, events } = harness();
    controller.start(2);
    controller.markStable('stable');
    controller.checkpoint('character-open');
    controller.checkpoint('connection-lost');
    controller.checkpoint('character-closed');
    expect(events).toEqual([
      'start:2',
      'scene-build-start',
      'runtime-stable',
      'character-open',
      'character-closed',
    ]);
  });

  it('pins an NPC quest dialog before its greeting workload until it closes', () => {
    const { controller, events } = harness();
    controller.start(2);
    controller.markStable('stable');
    controller.checkpoint('quest-dialog-open');
    controller.checkpoint('connection-lost');
    controller.checkpoint('quest-dialog-closed');
    expect(events).toEqual([
      'start:2',
      'scene-build-start',
      'runtime-stable',
      'quest-dialog-open',
      'quest-dialog-closed',
    ]);
  });

  it('clears and ignores all later checkpoints after a handled stop', () => {
    const { controller, events } = harness();
    controller.start(2);
    controller.stop('stable');
    controller.checkpoint('window-error');
    controller.renderedFrame(10_000);
    expect(events).toEqual(['start:2', 'scene-build-start', 'clear']);
  });

  it('clears while hidden and restores the last entry checkpoint on foreground', () => {
    const { controller, events } = harness();
    controller.start(2);
    controller.checkpoint('assets-await', { phase: 'assets' });
    suspendActiveEntryDiagnostics();
    controller.checkpoint('renderer-built');
    controller.renderedFrame(1_000);
    controller.markStable();
    resumeActiveEntryDiagnostics();
    expect(events).toEqual([
      'start:2',
      'scene-build-start',
      'assets-await',
      'clear',
      'start:2',
      'assets-await',
      'runtime-stable',
    ]);
    controller.markStable();
    expect(events.at(-1)).toBe('runtime-stable');
  });

  it('can resume under a newly applied live graphics preset', () => {
    const { controller, events } = harness();
    controller.start(2);
    controller.checkpoint('runtime-stable');
    suspendActiveEntryDiagnostics();
    resumeActiveEntryDiagnostics(4);
    expect(events).toEqual([
      'start:2',
      'scene-build-start',
      'runtime-stable',
      'clear',
      'start:4',
      'runtime-stable',
    ]);
  });

  it('heartbeats from the frame loop at the cadence, before and after stable alike', () => {
    const { controller, events, setWallNow } = harness({ heartbeat: true });
    controller.start(2);
    setWallNow(5_000);
    controller.renderedFrame(100); // first frame: immediate heartbeat
    setWallNow(6_000);
    controller.renderedFrame(2_000); // inside the cadence: no stamp
    setWallNow(11_000);
    controller.renderedFrame(100 + ENTRY_HEARTBEAT_MS); // cadence elapsed
    controller.markStable();
    setWallNow(30_000);
    controller.renderedFrame(100 + ENTRY_HEARTBEAT_MS * 3); // still heartbeating after stable
    expect(events).toEqual([
      'start:2',
      'scene-build-start',
      'alive:5000',
      'first-frame',
      'alive:11000',
      'rendering',
      'runtime-stable',
      'alive:30000',
    ]);
  });

  it('does not heartbeat while suspended, and re-stamps on foreground once the frame loop had run', () => {
    const { controller, events, setWallNow } = harness({ heartbeat: true });
    controller.start(2);
    setWallNow(2_000);
    controller.renderedFrame(50);
    suspendActiveEntryDiagnostics();
    setWallNow(60_000);
    controller.renderedFrame(50 + ENTRY_HEARTBEAT_MS * 10); // hidden: nothing persists
    setWallNow(61_000);
    resumeActiveEntryDiagnostics();
    expect(events).toEqual([
      'start:2',
      'scene-build-start',
      'alive:2000',
      'first-frame',
      'clear',
      'start:2',
      'first-frame',
      'alive:61000',
    ]);
  });

  it('does not claim liveness on foreground when no frame had ever rendered', () => {
    const { controller, events } = harness({ heartbeat: true });
    controller.start(2);
    controller.checkpoint('assets-await');
    suspendActiveEntryDiagnostics();
    resumeActiveEntryDiagnostics();
    expect(events).toEqual([
      'start:2',
      'scene-build-start',
      'assets-await',
      'clear',
      'start:2',
      'assets-await',
    ]);
  });

  it('arms without persisting when the boot starts hidden, then persists on the first foreground', () => {
    let hidden = true;
    const { controller, events, logged } = harness({ heartbeat: true, hidden: () => hidden });
    controller.start(3);
    controller.checkpoint('assets-await');
    controller.renderedFrame(100);
    expect(events).toEqual([]);
    expect(logged.at(-1)).toContain('started hidden');
    hidden = false;
    resumeActiveEntryDiagnostics();
    expect(events).toEqual(['start:3', 'scene-build-start']);
    controller.renderedFrame(200);
    expect(events.slice(2)).toEqual(['alive:1000', 'first-frame']);
  });

  it('keeps heartbeating while a sticky dialog checkpoint is held', () => {
    // The reported iOS shape: the More dialog is open (sticky, so routine checkpoints
    // are refused) for minutes before the reload. Liveness must keep flowing anyway,
    // or the verdict would read every such session as backgrounded.
    const { controller, events, setWallNow } = harness({ heartbeat: true });
    controller.start(2);
    controller.renderedFrame(100);
    controller.markStable();
    checkpointActiveEntryDiagnostics('mobile-more-open');
    setWallNow(90_000);
    controller.renderedFrame(100 + ENTRY_HEARTBEAT_MS * 20);
    expect(events.slice(-2)).toEqual(['mobile-more-open', 'alive:90000']);
  });

  it('uses wall time for persisted checkpoints rather than animation time', () => {
    const { controller, persistence, setWallNow } = harness();
    controller.start(2);
    setWallNow(1_750);
    controller.renderedFrame(15);
    expect(persistence.checkpoint).toHaveBeenLastCalledWith('first-frame', 1_750, {
      phase: 'render',
      frame: 1,
    });
  });

  it('routes global lifecycle signals through the active controller and its sticky policy', () => {
    const { controller, events } = harness();
    controller.start(2);
    checkpointActiveEntryDiagnostics('window-error', { errorType: 'TypeError' });
    controller.renderedFrame(100);
    stopActiveEntryDiagnostics();
    checkpointActiveEntryDiagnostics('unhandled-rejection');
    expect(events).toEqual(['start:2', 'scene-build-start', 'window-error', 'clear']);
  });
});
