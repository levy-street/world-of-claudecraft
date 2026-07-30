import { describe, expect, it, vi } from 'vitest';
import {
  checkpointActiveEntryDiagnostics,
  createEntryDiagnosticsController,
  type EntryDiagnosticPersistence,
  stopActiveEntryDiagnostics,
} from '../src/game/entry_diagnostics';

function harness() {
  let wallNow = 1_000;
  const events: string[] = [];
  const persistence: EntryDiagnosticPersistence = {
    start: vi.fn((preset) => events.push(`start:${preset}`)),
    checkpoint: vi.fn((checkpoint) => events.push(checkpoint)),
    clear: vi.fn(() => events.push('clear')),
  };
  const controller = createEntryDiagnosticsController({
    baseSnapshot: () => ({ phase: 'base' }),
    renderSnapshot: () => ({ phase: 'render' }),
    persistence,
    wallNow: () => wallNow,
    log: vi.fn(),
  });
  return {
    controller,
    events,
    persistence,
    setWallNow: (value: number) => {
      wallNow = value;
    },
  };
}

describe('entry diagnostics controller', () => {
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
